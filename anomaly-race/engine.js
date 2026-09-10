/* ============================================================
 * engine.js —— 核心规则引擎（不依赖 DOM，可被 node 加载测试）
 *
 * 【公平性架构说明】
 * 1) 全局只有一条游戏随机数流 G.rngState，所有游戏内随机（掷骰、敌人、
 *    卡牌奖励、遗物、事件、商店进货）都从这条流消费。
 * 2) AI 决策函数（所有 ai*）只接收 buildAIView 构造的【公开视图】：
 *    - 完整：AI 自己的状态（位置/生命/金币/牌组/遗物/骰具/建筑）
 *    - 公开：对手的位置/生命/金币/圈数/建筑/遗物列表（遗物均为公开效果）
 *    - 公开：棋盘、轮次、侵蚀度、Boss 当前强度预览、商店当前进货（购物时）
 *    - 禁止：对手牌组构成与手牌、未揭示的卡牌奖励/遗物、未来随机数。
 *    AI 函数内部禁止访问 G.rngState；简单难度的“随机失误”使用独立的
 *    aiRand 流（种子 seed+999），不影响游戏随机流。
 * 3) 卡牌奖励在战斗结算时才生成，AI 与玩家一样只能看到已揭示的三选一。
 * 4) 双方共用同一套战斗/移动/建筑/商店/Boss结算函数，不存在暗改。
 * ============================================================ */
'use strict';

/* ================= 随机数 ================= */
function hashSeed(str) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngNextState(s) { // mulberry32 单步
  s = (s + 0x6D2B79F5) >>> 0;
  var t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { s: s, r: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}
function R(G) { var o = rngNextState(G.rngState); G.rngState = o.s; return o.r; }
function ri(G, a, b) { return a + Math.floor(R(G) * (b - a + 1)); }
function pick(G, arr) { return arr[Math.floor(R(G) * arr.length)]; }
function chance(G, p) { return R(G) < p; }
function shuffleInPlace(G, arr) {
  for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(R(G) * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}
/* AI 独立随机流（只用于简单难度的失误，不触碰游戏随机流） */
function aiR(G) { var o = rngNextState(G.aiRand); G.aiRand = o.s; return o.r; }

/* ================= 对局状态 ================= */
var _uid = 1;
function newCardInst(cid, up) { return { uid: _uid++, cid: cid, up: !!up }; }

function newChar(id) {
  return {
    id: id, pos: 0, hp: CONFIG.startHP, maxhp: CONFIG.startHP, gold: CONFIG.startGold,
    deck: STARTER_DECK.map(function (c) { return newCardInst(c, false); }),
    relics: [], dice: { swift: 0, precise: 0, double: 0 },
    buildings: [], laps: 0, alive: true,
    stats: { kills: 0, elites: 0, earned: 0, steps: 0 },
  };
}

function newGame(seedStr, difficulty) {
  _uid = 1;
  var seed = hashSeed(String(seedStr));
  var G = {
    seedStr: String(seedStr), seed: seed, rngState: seed >>> 0, aiRand: (seed ^ 0x9e3779b9) >>> 0,
    difficulty: difficulty, round: 1, phase: 'player',
    chars: { player: newChar('player'), ai: newChar('ai') },
    buildings: {}, // nodeId -> {owner, level}
    erosion: 0, erosionLv: 0,
    over: null, // {result:'win'|'lose', reason}
    aiBonusRelic: null,
    log: [],
  };
  // 标准/困难 AI：开局公开抽取一个随机低阶遗物（使用公开种子流的第一段，结果完全公开）
  if (DIFFICULTY[difficulty].bonusRelic) {
    var rid = pick(G, RELIC_POOL_LOW);
    G.chars.ai.relics.push(rid);
    G.aiBonusRelic = rid;
  }
  return G;
}

function charOf(G, id) { return G.chars[id]; }
function foeOf(G, id) { return G.chars[id === 'player' ? 'ai' : 'player']; }
function hasRelic(ch, rid) { return ch.relics.indexOf(rid) >= 0; }

function addRelic(G, ch, rid) {
  if (hasRelic(ch, rid)) return { ok: false, msg: '已拥有【' + RELICS[rid].name + '】，转化为 40 金币。', gold: 40 };
  ch.relics.push(rid);
  if (rid === 'heart') { ch.maxhp += 12; ch.hp = Math.min(ch.maxhp, ch.hp + 12); }
  return { ok: true, msg: '获得遗物【' + RELICS[rid].name + '】：' + RELICS[rid].text };
}

function healChar(ch, n) {
  if (!ch.alive) return 0;
  var real = Math.min(n, ch.maxhp - ch.hp);
  ch.hp += real;
  return real;
}

/* 对棋盘角色造成伤害。返回 {died}。凤凰之羽可抵挡致命伤（棋盘与战斗通用）。 */
function damageChar(G, ch, n) {
  if (!ch.alive || n <= 0) return { died: false };
  ch.hp -= n;
  if (ch.hp <= 0) {
    var idx = ch.relics.indexOf('feather');
    if (idx >= 0) {
      ch.relics.splice(idx, 1);
      ch.hp = Math.ceil(ch.maxhp * 0.5);
      return { died: false, revived: true };
    }
    ch.hp = 0; ch.alive = false;
    return { died: true };
  }
  return { died: false };
}

function addGold(G, ch, n) {
  if (n > 0) ch.stats.earned += n;
  ch.gold += n;
  if (ch.gold < 0) ch.gold = 0;
}

/* ================= 公开视图（AI 唯一信息来源） ================= */
function buildAIView(G, who) {
  var me = charOf(G, who), op = foeOf(G, who);
  return {
    who: who,
    difficulty: G.difficulty,
    round: G.round,
    erosion: G.erosion, erosionLv: G.erosionLv,
    shopFee: G.erosionLv >= 1 ? 0.2 : 0,
    enemyDmgBonus: enemyDmgBonus(G),
    boss: bossPreview(G),
    me: JSON.parse(JSON.stringify({ pos: me.pos, hp: me.hp, maxhp: me.maxhp, gold: me.gold, deck: me.deck, relics: me.relics, dice: me.dice, buildings: me.buildings, laps: me.laps, alive: me.alive })),
    // 对手仅公开信息：无牌组构成、无手牌
    op: { pos: op.pos, hp: op.hp, maxhp: op.maxhp, gold: op.gold, laps: op.laps, alive: op.alive, relics: op.relics.slice(), buildings: op.buildings.slice(), deckCount: op.deck.length },
    buildings: JSON.parse(JSON.stringify(G.buildings)),
  };
}

/* ================= 移动 ================= */
function nextOf(nodeId) { return BOARD_NEXT[nodeId]; }
function isFork(nodeId) { return nextOf(nodeId).length > 1; }

/* 沿主路/分支模拟行走（纯函数，供 AI 评估与 UI 预览使用，只用公开棋盘信息） */
function simWalk(from, steps, dirChoice) {
  // dirChoice: {forkNodeId: 'main'|'branch'}
  var path = [], cur = from;
  for (var s = 0; s < steps; s++) {
    var nx = nextOf(cur);
    if (nx.length === 1) cur = nx[0];
    else {
      var c = (dirChoice && dirChoice[cur]) || 'main';
      cur = (c === 'main') ? nx[0] : nx[1];
    }
    path.push(cur);
  }
  return path;
}

function rollDice(G, ch, diceId) {
  var rolls = [];
  if (diceId === 'precise') { return { rolls: [], total: 0, precise: true }; }
  if (diceId === 'double') {
    rolls.push(ri(G, 1, 6)); rolls.push(ri(G, 1, 6));
    ch.dice.double--;
  } else {
    rolls.push(ri(G, 1, 6));
    if (diceId === 'swift') ch.dice.swift--;
  }
  var total = rolls[0] + (rolls[1] || 0);
  if (diceId === 'swift') total += 2;
  if (hasRelic(ch, 'boots')) total += 1;
  if (hasRelic(ch, 'low_charm')) total += 1;
  return { rolls: rolls, total: total, precise: false };
}

function availableDice(ch) {
  var list = ['normal'];
  if (ch.dice.swift > 0) list.push('swift');
  if (ch.dice.precise > 0) list.push('precise');
  if (ch.dice.double > 0) list.push('double');
  return list;
}

/* ================= 建筑 ================= */
function tollFor(nodeId, level, ownerChar) {
  var price = nodeById(nodeId).price;
  var mult = [0, 0.25, 0.55, 1.0][level] || 0.25;
  var toll = Math.round(price * mult);
  if (ownerChar && hasRelic(ownerChar, 'landlord')) toll = Math.round(toll * 1.5);
  return toll;
}
function upgradeCost(nodeId, level) {
  var price = nodeById(nodeId).price;
  return Math.round(price * (level === 1 ? 0.5 : 0.8));
}
function lapIncome(ch, G) {
  var sum = 0;
  for (var i = 0; i < ch.buildings.length; i++) {
    var b = G.buildings[ch.buildings[i]];
    if (b) sum += b.level * 15;
  }
  return sum;
}

/* ================= 敌人强度（公开规则） ================= */
function enemyDmgBonus(G) {
  var b = Math.floor((G.round - 1) / CONFIG.enemyDmgEvery);
  if (G.erosionLv >= 2) b += 2;
  return b;
}
function enemyHpMult(G) { return 1 + CONFIG.enemyHpScale * (G.round - 1); }

function makeEnemy(G, def) {
  var hp = Math.round(ri(G, def.hp[0], def.hp[1]) * enemyHpMult(G));
  return {
    defId: def.id, name: def.name, icon: def.icon, hp: hp, maxhp: hp,
    block: 0, str: 0, vuln: 0, weak: 0,
    moves: def.moves, moveIdx: Math.floor(R(G) * def.moves.length) % def.moves.length,
    gold: [def.gold[0], def.gold[1]], isBoss: false, phase: 1,
  };
}
function makeBoss(G) {
  var hp = CONFIG.bossBaseHp + CONFIG.bossHpPerRound * (G.round - 1);
  return {
    defId: 'eclipse', name: BOSS_DEF.name, icon: BOSS_DEF.icon, hp: hp, maxhp: hp,
    block: 0, str: 0, vuln: 0, weak: 0,
    moves: BOSS_DEF.movesP1, moveIdx: 0,
    gold: [BOSS_DEF.gold[0], BOSS_DEF.gold[1]], isBoss: true, phase: 1,
  };
}
function bossPreview(G) {
  return {
    hp: CONFIG.bossBaseHp + CONFIG.bossHpPerRound * (G.round - 1),
    dmgBonus: enemyDmgBonus(G),
    name: BOSS_DEF.name,
  };
}

/* ================= 卡牌战斗引擎（双方共用） ================= */
function createCombat(G, heroId, enemy, opts) {
  opts = opts || {};
  var hero = charOf(G, heroId);
  var drawPile = hero.deck.map(function (c) { return { uid: c.uid, cid: c.cid, up: c.up }; });
  shuffleInPlace(G, drawPile);
  var C = {
    heroId: heroId, enemy: enemy, isBoss: !!enemy.isBoss,
    hero: { hp: hero.hp, maxhp: hero.maxhp, block: 0, energy: 0, str: 0, vuln: 0, weak: 0, hourglassUsed: false },
    draw: drawPile, hand: [], discard: [], exhaust: [],
    turn: 0, over: null, log: [],
    enemyDmgBonus: enemyDmgBonus(G),
  };
  // --- 战斗开始遗物结算（双方同一批钩子） ---
  var clog = C.log;
  if (hasRelic(hero, 'low_sword')) { C.hero.str += 1; clog.push('训练木剑：获得1点力量。'); }
  if (hasRelic(hero, 'anchor')) { C.hero.block += 8; clog.push('船锚：获得8点格挡。'); }
  if (hasRelic(hero, 'bomb')) { hurtEnemy(C, 12); clog.push('源石炸弹：对敌人造成12点伤害！'); }
  if (hasRelic(hero, 'warbanner')) { enemy.vuln += 2; clog.push('讨伐战旗：敌方获得2层易伤。'); }
  if (enemy.isBoss && hasRelic(hero, 'crown')) { C.hero.energy += 0; C._crownBonus = true; clog.push('讨伐王冠：Boss战首回合+2能量与12格挡。'); }
  startHeroTurn(G, C, true);
  // 狙击镜：开局多抽1
  if (hasRelic(hero, 'scope')) { drawCards(C, 1); clog.push('狙击镜：多抽1张牌。'); }
  return C;
}

function drawCards(C, n) {
  for (var i = 0; i < n; i++) {
    if (C.draw.length === 0) {
      if (C.discard.length === 0) return;
      C.draw = C.discard; C.discard = [];
      // 洗牌需要随机数：战斗内洗牌顺序对双方都是“未知但公平”的，
      // AI 视图只看法堆数量，不看法堆顺序，因此不构成偷看。
      var G = C._Gref;
      shuffleInPlace(G, C.draw);
    }
    if (C.hand.length >= 10) { C.discard.push(C.draw.pop()); }
    else C.hand.push(C.draw.pop());
  }
}

function startHeroTurn(G, C, first) {
  C._Gref = G;
  C.turn++;
  C.hero.block = 0;
  C.hero.hourglassUsed = false;
  C.hero.energy = CONFIG.energyPerTurn;
  var hero = charOf(G, C.heroId);
  if (first) {
    if (hasRelic(hero, 'battery')) C.hero.energy += 1;
    if (C._crownBonus) { C.hero.energy += 2; C.hero.block += 12; }
  }
  if (hasRelic(hero, 'charm2')) C.hero.block += 2;
  drawCards(C, CONFIG.cardsPerTurn);
}

/* 意图：敌人下个行动的公开信息 */
function intentOf(C) {
  var mv = C.enemy.moves[C.enemy.moveIdx % C.enemy.moves.length];
  if (mv.t === 'atk') {
    var per = mv.dmg + C.enemy.str + C.enemyDmgBonus;
    if (C.enemy.weak > 0) per = Math.floor(per * 0.75);
    return { t: 'atk', total: per * (mv.times || 1), per: per, times: mv.times || 1, name: mv.name };
  }
  return { t: 'buff', name: mv.name };
}

function hurtEnemy(C, raw) {
  var e = C.enemy;
  var dmg = raw;
  if (e.vuln > 0) dmg = Math.floor(dmg * 1.5);
  var absorbed = Math.min(e.block, dmg);
  e.block -= absorbed; dmg -= absorbed;
  e.hp -= dmg;
  return dmg;
}
function hurtHero(G, C, raw) {
  var h = C.hero, hero = charOf(G, C.heroId);
  var dmg = raw;
  if (hasRelic(hero, 'bell')) dmg += 1;             // 诅咒之铃：受伤+1
  if (!h.hourglassUsed && hasRelic(hero, 'hourglass') && dmg > 0) {
    var red = Math.min(3, dmg); dmg -= red; h.hourglassUsed = true;
    C.log.push('沙漏护符：减免' + red + '点伤害。');
  }
  if (h.vuln > 0) dmg = Math.floor(dmg * 1.5);
  var absorbed = Math.min(h.block, dmg);
  h.block -= absorbed; dmg -= absorbed;
  h.hp -= dmg;
  C._lastTaken = dmg;
  if (h.hp <= 0) {
    // 凤凰之羽（战斗内同样生效）
    var idx = hero.relics.indexOf('feather');
    if (idx >= 0) {
      hero.relics.splice(idx, 1);
      h.hp = Math.ceil(h.maxhp * 0.5);
      C.log.push('凤凰之羽碎裂！你在烈焰中重生，回复' + h.hp + '点生命！');
    } else {
      h.hp = 0; C.over = 'lose';
    }
  }
  return dmg;
}

function heroAttackBonus(G, C) {
  var hero = charOf(G, C.heroId), b = C.hero.str;
  if (hasRelic(hero, 'edge')) b += 1;
  if (hasRelic(hero, 'bell')) b += 2;
  return b;
}

/* 打出一张手牌，返回事件描述数组 */
function playCard(G, C, handIdx) {
  var ev = [];
  if (C.over) return ev;
  var card = C.hand[handIdx];
  if (!card) return ev;
  var def = CARDS[card.cid], e = cardEff(card.cid, card.up);
  if (C.hero.energy < def.cost) { ev.push('能量不足！'); return ev; }
  C.hero.energy -= def.cost;
  C.hand.splice(handIdx, 1);
  var cname = def.name + (card.up ? '+' : '');
  // 自伤（过载）
  if (e.selfDmg) { hurtHero(G, C, e.selfDmg); ev.push(cname + '：过载反噬' + e.selfDmg + '点。'); if (C.over) { toPile(C, card, !!e.exhaust); return ev; } }
  if (e.energy) { C.hero.energy += e.energy; ev.push(cname + '：获得' + e.energy + '点能量。'); }
  if (e.block) { C.hero.block += e.block; ev.push(cname + '：获得' + e.block + '点格挡。'); }
  if (e.str) { C.hero.str += e.str; ev.push(cname + '：获得' + e.str + '点力量。'); }
  if (e.draw) { drawCards(C, e.draw); ev.push(cname + '：抽' + e.draw + '张牌。'); }
  if (e.heal) {
    var real = Math.min(e.heal, C.hero.maxhp - C.hero.hp);
    C.hero.hp += real; ev.push(cname + '：回复' + real + '点生命。');
  }
  if (e.gold) { C._goldBonus = (C._goldBonus || 0) + e.gold; ev.push(cname + '：获得' + e.gold + '金币！'); }
  if (e.dmg) {
    var hits = e.hits || 1, total = 0;
    for (var i = 0; i < hits; i++) {
      var raw = e.dmg + heroAttackBonus(G, C);
      if (C.hero.weak > 0) raw = Math.floor(raw * 0.75);
      total += hurtEnemy(C, raw);
    }
    ev.push(cname + '：造成' + total + '点伤害' + (hits > 1 ? '（' + hits + '连击）' : '') + '！');
  }
  if (e.weak) { C.enemy.weak += e.weak; ev.push(cname + '：敌方获得' + e.weak + '层虚弱。'); }
  if (e.vuln) { C.enemy.vuln += e.vuln; ev.push(cname + '：敌方获得' + e.vuln + '层易伤。'); }
  toPile(C, card, !!e.exhaust);
  checkEnemyPhase(G, C);
  if (C.enemy.hp <= 0) { C.enemy.hp = 0; C.over = 'win'; }
  return ev;
}
function toPile(C, card, exhaust) {
  // 耗尽的牌移出本场战斗；其余进入弃牌堆
  if (exhaust) C.exhaust.push(card); else C.discard.push(card);
}

function checkEnemyPhase(G, C) {
  var e = C.enemy;
  if (e.isBoss && e.phase === 1 && e.hp <= e.maxhp * 0.5 && e.hp > 0) {
    e.phase = 2; e.moves = BOSS_DEF.movesP2; e.moveIdx = 0;
    e.str += 4; e.block += 12;
    C.log.push('异变核心·蚀 进入第二阶段！力量+4，获得12点格挡，攻击更加狂暴！');
  }
}

/* 结束英雄回合：敌人行动 → 新回合 */
function endHeroTurn(G, C) {
  var ev = [];
  if (C.over) return ev;
  // 弃掉手牌
  while (C.hand.length) C.discard.push(C.hand.pop());
  var e = C.enemy;
  // 超时狂暴
  if (C.turn >= CONFIG.maxCombatRounds) { e.str += 5; ev.push('敌人陷入狂暴！力量+5。'); }
  // 敌人格挡在自身回合开始时清空
  e.block = 0;
  var mv = e.moves[e.moveIdx % e.moves.length];
  e.moveIdx++;
  if (mv.t === 'atk') {
    var times = mv.times || 1;
    for (var i = 0; i < times; i++) {
      var raw = mv.dmg + e.str + C.enemyDmgBonus;
      if (e.weak > 0) raw = Math.floor(raw * 0.75);
      var dealt = hurtHero(G, C, raw);
      ev.push(e.name + '使用【' + mv.name + '】造成' + dealt + '点伤害！');
      if (C.over) break;
    }
    if (!C.over && mv.vuln) { C.hero.vuln += mv.vuln; ev.push('你获得' + mv.vuln + '层易伤。'); }
    if (!C.over && mv.weak) { C.hero.weak += mv.weak; ev.push('你获得' + mv.weak + '层虚弱。'); }
  } else {
    if (mv.block) { e.block += mv.block; ev.push(e.name + '使用【' + mv.name + '】获得' + mv.block + '点格挡。'); }
    if (mv.str) { e.str += mv.str; ev.push(e.name + '使用【' + mv.name + '】获得' + mv.str + '点力量！'); }
  }
  if (C.over) return ev;
  // 减益层数衰减
  if (C.hero.vuln > 0) C.hero.vuln--;
  if (C.hero.weak > 0) C.hero.weak--;
  if (e.vuln > 0) e.vuln--;
  if (e.weak > 0) e.weak--;
  startHeroTurn(G, C, false);
  return ev;
}

/* 战斗结算：把战斗内生命写回棋盘角色 */
function finishCombat(G, C) {
  var hero = charOf(G, C.heroId);
  hero.hp = Math.max(0, C.hero.hp);
  if (C.over === 'lose') {
    hero.alive = false;
    return { win: false };
  }
  var res = { win: true, gold: 0, goldBonus: C._goldBonus || 0, rest: 0 };
  // 金币奖励（双方同一公式）
  var g = ri(G, C.enemy.gold[0], C.enemy.gold[1]);
  if (hasRelic(hero, 'magnet')) g = Math.round(g * 1.3);
  if (hasRelic(hero, 'low_coin')) g += 12;
  res.gold = g + res.goldBonus;
  addGold(G, hero, res.gold);
  if (hasRelic(hero, 'low_bandage')) healChar(hero, 4);
  if (hasRelic(hero, 'bloodstone')) healChar(hero, 8);
  // 战后休整（双方同一规则）
  if (!C.enemy.isBoss) {
    hero.stats.kills++;
    var isElite = false;
    for (var i = 0; i < ENEMIES_ELITE.length; i++) if (ENEMIES_ELITE[i].id === C.enemy.defId) isElite = true;
    res.rest = healChar(hero, isElite ? CONFIG.victoryRestElite : CONFIG.victoryRestNormal);
  }
  return res;
}

/* ================= 奖励生成（结算时才揭示，AI 无法预知） ================= */
function rollRarity(G, weights) {
  // weights: [common, uncommon, rare]
  var r = R(G) * (weights[0] + weights[1] + weights[2]);
  if (r < weights[0]) return 'common';
  if (r < weights[0] + weights[1]) return 'uncommon';
  return 'rare';
}
function randomCardOfRarity(G, rarity, exclude) {
  var pool = [];
  for (var cid in CARDS) {
    if (CARDS[cid].rarity === rarity && (!exclude || exclude.indexOf(cid) < 0)) pool.push(cid);
  }
  if (!pool.length) pool = ['strike'];
  return pick(G, pool);
}
function genCardChoices(G, weights, n, deck) {
  var out = [], ex = [];
  for (var i = 0; i < n; i++) {
    var r = rollRarity(G, weights);
    var cid = randomCardOfRarity(G, r, ex);
    ex.push(cid); out.push(cid);
  }
  // 短板保底（双方同一规则，公开）：缺攻击/防御时，三选一必含一张对应牌（只补相对更缺的一项）
  if (deck && n >= 3) {
    var ds = deckStats(deck);
    var atkR = ds.atkDmg / Math.max(1, ds.size * 8);
    var blkR = ds.block / Math.max(1, ds.size * 4);
    var pool = null;
    if (ds.block < ds.size * 4 && blkR <= atkR) {
      pool = ['ironwall', 'dodge', 'taunt', 'stonewall', 'warcry'].filter(function (c) { return out.indexOf(c) < 0; });
    } else if (ds.atkDmg < ds.size * 6 && atkR < blkR) {
      pool = ['heavy', 'slash2', 'pierce', 'dance', 'dawn', 'hotblood'].filter(function (c) { return out.indexOf(c) < 0; });
    }
    if (pool && pool.length) out[0] = pick(G, pool);
  }
  return out;
}
function genRelic(G, tier) {
  var pool = tier === 'high' ? RELIC_POOL_HIGH : (tier === 'low' ? RELIC_POOL_LOW : RELIC_POOL_MID);
  return pick(G, pool);
}
function randomDice(G) { return pick(G, ['swift', 'precise', 'double']); }

function genShopStock(G) {
  var cards = [];
  var ws = [[70, 25, 5], [60, 30, 10], [50, 35, 15]];
  for (var i = 0; i < 3; i++) cards.push(randomCardOfRarity(G, rollRarity(G, ws[i]), cards));
  return {
    cards: cards,
    relic: chance(G, 0.15) ? genRelic(G, 'high') : genRelic(G, 'mid'),
    dice: randomDice(G),
  };
}
function shopPrice(G, ch, base) {
  var p = base;
  if (hasRelic(ch, 'guild')) p *= 0.75;
  if (G.erosionLv >= 1) p *= 1.2;
  return Math.max(1, Math.round(p));
}

/* ================= Boss 全局行动（每轮双方行动后） ================= */
function bossPhase(G) {
  var msgs = [];
  G.erosion = Math.min(100, G.erosion + CONFIG.erosionPerRound);
  // 侵蚀阈值（双方同等承受）
  if (G.erosion >= 33 && G.erosionLv < 1) { G.erosionLv = 1; msgs.push({ t: '侵蚀突破 33%！商店价格上涨 20%（双方相同）。', lv: 1 }); }
  if (G.erosion >= 66 && G.erosionLv < 2) { G.erosionLv = 2; msgs.push({ t: '侵蚀突破 66%！所有敌人伤害 +2（双方相同）。', lv: 2 }); }
  if (G.erosion >= 99 && G.erosionLv < 3) { G.erosionLv = 3; msgs.push({ t: '侵蚀突破 99%！异变冲击伤害 +5！', lv: 3 }); }
  // 定期异变冲击
  if (G.round % CONFIG.pulseEveryRounds === 0) {
    var dmg = CONFIG.pulseBase + G.round + (G.erosionLv >= 3 ? 5 : 0);
    msgs.push({ t: '异变核心释放【异变冲击】！双方各受到 ' + dmg + ' 点伤害！', pulse: dmg });
  } else {
    msgs.push({ t: '异变核心脉动着……侵蚀度 ' + G.erosion + '%，狂暴层数 ' + (G.round - 1) + '。' });
  }
  return msgs;
}

/* ============================================================
 * AI 决策（全部只读 view；easy 噪声用 aiRand 流）
 * 每个函数签名：aiXxx(view, 额外公开参数, rand?)
 * rand 由调用方注入：function(){ return aiR(G); }
 * ============================================================ */

/* --- 牌组评估 --- */
function deckStats(deck) {
  var atk = 0, atkDmg = 0, block = 0, draw = 0, energy = 0, heal = 0;
  for (var i = 0; i < deck.length; i++) {
    var e = cardEff(deck[i].cid, deck[i].up);
    if (e.dmg) { atk++; atkDmg += e.dmg * (e.hits || 1); }
    if (e.block) block += e.block;
    if (e.draw) draw += e.draw;
    if (e.energy) energy += e.energy;
    if (e.heal) heal += e.heal;
  }
  return { atk: atk, atkDmg: atkDmg, block: block, draw: draw, energy: energy, heal: heal, size: deck.length };
}
function scoreCardForDeck(cid, deck) {
  var ds = deckStats(deck), e = cardEff(cid, false), s = 0;
  var def = CARDS[cid];
  // 攻守平衡目标：每张牌约 8 点攻击总伤、4 点格挡；补短板者高分
  var atkR = ds.atkDmg / Math.max(1, ds.size * 8);
  var blkR = ds.block / Math.max(1, ds.size * 4);
  if (e.dmg) {
    var total = e.dmg * (e.hits || 1);
    s += total * 1.2 - def.cost * 3;
    if (ds.atk < 6) s += 6;
    s += (atkR <= blkR ? 10 : 3);
    if (e.vuln) s += 4;
  }
  if (e.block) {
    s += e.block * 0.9 - def.cost * 3;
    s += (blkR < atkR ? 10 : 3);
    if (e.draw) s += 3;
  }
  if (e.str) s += 8;
  if (e.draw && !e.dmg) s += 3;
  if (e.energy) s += 9;
  if (e.heal) s += e.heal * 0.5;
  if (e.gold) s += 2;
  if (e.weak) s += 3;
  if (def.cost === 0 && !e.exhaust) s += 2;
  if (def.cost >= 3) s -= 2;
  if (def.rarity === 'rare') s += 4;
  if (def.rarity === 'uncommon') s += 2;
  return s;
}

/* --- 地块评分（公开信息评估） --- */
function tileValue(view, nodeId) {
  var n = nodeById(nodeId), me = view.me;
  var hpPct = me.hp / me.maxhp;
  switch (n.kind) {
    case 'gold': return 4 + (n.amount || 40) / 25;
    case 'fight': return hpPct > 0.45 ? 6 : -6;
    case 'elite': return (hpPct > 0.7 && deckStats(me.deck).atk >= 5) ? 10 : -8;
    case 'building': {
      var b = view.buildings[nodeId];
      if (!b) return (me.gold > n.price + 60) ? 9 : (me.gold > n.price ? 4 : 1);
      if (b.owner === view.who) return me.gold > 150 ? 3 : 0;
      return -tollFor(nodeId, b.level, null) / 20;
    }
    case 'draft': return 7;
    case 'event': return 5;
    case 'rest': return hpPct < 0.55 ? 12 : 4;
    case 'shop': return me.gold > 120 ? 8 : 2;
    case 'boss': return view.round >= CONFIG.bossChallengeRound - 1 ? 0 : 2;
    case 'start': return 10;
    case 'chest': return 9;
    case 'vault': return 11;
    case 'fork': return n.fight ? tileValue(view, 3) : 5; // 按战斗/事件估
    default: return 1;
  }
}
/* 从某点出发，沿固定方向选择走 k 步的累计价值 */
function pathValue(view, from, steps, dirChoice) {
  var path = simWalk(from, steps, dirChoice), v = 0;
  for (var i = 0; i < path.length; i++) {
    v += tileValue(view, path[i]) * (1 - i * 0.12);
    if (path[i] === 0) v += 6; // 经过起点
  }
  // 精确落点加成
  var last = path[path.length - 1];
  if (last === 22) v += (view.round >= CONFIG.bossChallengeRound - 1 ? 25 : 2);
  return v;
}

/* --- 1) 骰具选择 --- */
function aiPickDice(view, rand) {
  var me = view.me;
  var opts = ['normal'];
  if (me.dice.swift > 0) opts.push('swift');
  if (me.dice.precise > 0) opts.push('precise');
  if (me.dice.double > 0) opts.push('double');
  // 期望步数评估（公开期望值，非未来随机数）
  var expSteps = { normal: 3.5, swift: 5.5, double: 7, precise: 0 };
  var best = 'normal', bestV = -1e9, bestNum = 3;
  // 精准骰：枚举 1..6 取最优落点
  if (me.dice.precise > 0) {
    var bv = -1e9, bn = 1;
    for (var n = 1; n <= 6; n++) {
      var v = pathValue(view, me.pos, n, null) + 2; // 精确性加分
      // 能精确命中关键格则大幅加分
      var dest = simWalk(me.pos, n, null);
      var last = dest[dest.length - 1];
      var nd = nodeById(last);
      if (last === 22) v += (view.round >= CONFIG.bossChallengeRound - 1 ? 30 : 0);
      if (nd.kind === 'building' && !view.buildings[last] && me.gold > nd.price) v += 12;
      if (nd.kind === 'rest' && me.hp / me.maxhp < 0.55) v += 12;
      if (nd.kind === 'shop' && me.gold > 150) v += 8;
      if (v > bv) { bv = v; bn = n; }
    }
    expSteps.precise = 0;
    if (bv > bestV) { bestV = bv; best = 'precise'; bestNum = bn; }
  }
  var arr = ['normal', 'swift', 'double'];
  for (var i = 0; i < arr.length; i++) {
    var d = arr[i];
    if (opts.indexOf(d) < 0) continue;
    var v2 = pathValue(view, me.pos, Math.round(expSteps[d]), null);
    if (d !== 'normal') v2 -= 3; // 消耗品成本
    // 残血时省着用
    if ((d === 'swift' || d === 'double') && me.hp / me.maxhp < 0.4) v2 -= 6;
    if (v2 > bestV) { bestV = v2; best = d; }
  }
  // 简单难度：一定概率随机换一个可用骰具
  if (rand && DIFFICULTY[view.difficulty].aiNoise > 0 && rand() < DIFFICULTY[view.difficulty].aiNoise) {
    best = opts[Math.floor(rand() * opts.length)];
    if (best === 'precise') bestNum = 1 + Math.floor(rand() * 6);
  }
  return { dice: best, num: bestNum };
}

/* --- 2) 岔路方向 --- */
function aiPickDir(view, forkId, rand) {
  var vMain = pathValue(view, forkId, 6, null); // 默认主路
  var dc = {}; dc[forkId] = 'branch';
  var vBranch = pathValue(view, forkId, 6, dc);
  var choice = vBranch > vMain ? 'branch' : 'main';
  if (rand && DIFFICULTY[view.difficulty].aiNoise > 0 && rand() < DIFFICULTY[view.difficulty].aiNoise) {
    choice = (rand() < 0.5) ? 'main' : 'branch';
  }
  return choice;
}

/* --- 3) 建筑买卖 --- */
function aiBuyBuilding(view, nodeId) {
  var me = view.me, price = nodeById(nodeId).price;
  var reserve = 60;
  if (me.hp / me.maxhp < 0.35) reserve = 110; // 残血留钱保命/购物
  return me.gold >= price + reserve;
}
function aiUpgradeBuilding(view, nodeId) {
  var me = view.me, cost = upgradeCost(nodeId, view.buildings[nodeId].level);
  return me.gold >= cost + 90;
}

/* --- 4) 休息：回血 / 特训删除 / 升级 --- */
function bestUpgradeUid(deck) {
  var best = null, bestS = -1;
  for (var i = 0; i < deck.length; i++) {
    var c = deck[i];
    if (c.up) continue;
    var e0 = cardEff(c.cid, false), e1 = cardEff(c.cid, true);
    var s = ((e1.dmg || 0) - (e0.dmg || 0)) * (e0.hits || 1) + ((e1.block || 0) - (e0.block || 0)) +
      ((e1.heal || 0) - (e0.heal || 0)) * 0.5 + ((e1.draw || 0) - (e0.draw || 0)) * 3 +
      ((e1.energy || 0) - (e0.energy || 0)) * 5 + ((e1.str || 0) - (e0.str || 0)) * 4;
    if (CARDS[c.cid].rarity !== 'starter') s += 2;
    if (s > bestS) { bestS = s; best = c.uid; }
  }
  return best;
}
function worstBasicUid(deck) {
  var order = [['strike', false], ['defend', false], ['strike', true], ['defend', true]];
  for (var k = 0; k < order.length; k++)
    for (var i = 0; i < deck.length; i++)
      if (deck[i].cid === order[k][0] && deck[i].up === order[k][1]) return deck[i].uid;
  return null;
}
function aiRest(view) {
  var me = view.me;
  if (me.hp / me.maxhp < 0.65) return { act: 'heal' };
  var rm = worstBasicUid(me.deck);
  if (rm != null && me.deck.length >= 13) return { act: 'remove', uid: rm };
  var up = bestUpgradeUid(me.deck);
  if (up != null) return { act: 'upgrade', uid: up };
  if (rm != null) return { act: 'remove', uid: rm };
  return { act: 'heal' };
}

/* --- 5) 商店：返回下一步动作 --- */
function aiShopNext(view, stock, services) {
  // services: {remove:[uid...], canHeal}
  var me = view.me, reserve = 60;
  var fee = 1 + (view.shopFee || 0);
  function price(base) {
    var p = base * fee;
    if (me.relics.indexOf('guild') >= 0) p *= 0.75;
    return Math.round(p);
  }
  // 遗物（未拥有才买）
  if (stock.relic && me.relics.indexOf(stock.relic) < 0) {
    var tier = RELICS[stock.relic].tier;
    var rp = price(tier === 'high' ? SHOP.relicPrice.high : SHOP.relicPrice.mid);
    if (me.gold >= rp + reserve) return { a: 'relic' };
  }
  // 卡牌：评分最高且负担得起
  var bi = -1, bs = 12;
  for (var i = 0; i < stock.cards.length; i++) {
    if (stock.cards[i] == null) continue;
    var s = scoreCardForDeck(stock.cards[i], me.deck);
    var cp = price(SHOP.cardPrice[CARDS[stock.cards[i]].rarity]);
    if (s > bs && me.gold >= cp + reserve) { bs = s; bi = i; }
  }
  if (bi >= 0) return { a: 'card', i: bi };
  // 升级卡牌
  var upUid = bestUpgradeUid(me.deck);
  if (upUid != null && me.gold >= price(SHOP.upgradePrice) + 80) return { a: 'upgrade', uid: upUid };
  // 骰具：没有存货时买
  if (stock.dice && (me.dice.swift + me.dice.precise + me.dice.double === 0)) {
    if (me.gold >= price(SHOP.dicePrice) + reserve) return { a: 'dice' };
  }
  // 治疗
  if (services.canHeal && me.hp / me.maxhp < 0.65 && me.gold >= price(SHOP.healPrice) + 20) return { a: 'heal' };
  // 删除打击
  if (me.gold >= price(SHOP.removePrice) + 100) {
    for (var j = 0; j < me.deck.length; j++) {
      if (me.deck[j].cid === 'strike' && !me.deck[j].up) return { a: 'remove', uid: me.deck[j].uid };
    }
    for (var k = 0; k < me.deck.length; k++) {
      if (me.deck[k].cid === 'defend' && !me.deck[k].up) return { a: 'remove', uid: me.deck[k].uid };
    }
  }
  return { a: 'leave' };
}

/* --- 6) 事件选项 --- */
function aiEvent(view, ev) {
  var me = view.me, hpPct = me.hp / me.maxhp;
  var best = ev.choices.length - 1, bestS = -1e9; // 默认离开
  for (var i = 0; i < ev.choices.length; i++) {
    var ch = ev.choices[i], s = 0, ok = true;
    if (ch.need) {
      if (ch.need.gold && me.gold < ch.need.gold) ok = false;
      if (ch.need.hp && me.hp < ch.need.hp) ok = false;
    }
    if (!ok) { s = -1e9; }
    else {
      var ef = ch.effect || {};
      if (ef.relic) s += 12;
      if (ef.heal) s += hpPct < 0.6 ? ef.heal * 0.8 : 1;
      if (ef.hurt) s -= hpPct < 0.4 ? 30 : ef.hurt;
      if (ef.pay) s -= ef.pay * 0.06;
      if (ef.gamble) s += (0.5 * ef.gamble.win - ef.gamble.cost) * 0.1 + 1; // 期望为正才赌
      if (!ef.relic && !ef.heal && !ef.gamble && !ef.pay) s = 0; // 离开
    }
    if (s > bestS) { bestS = s; best = i; }
  }
  return best;
}

/* --- 7) 卡牌三选一 --- */
function aiDraft(view, options) {
  var me = view.me, bi = -1, bs = -1e9;
  for (var i = 0; i < options.length; i++) {
    var s = scoreCardForDeck(options[i], me.deck);
    if (s > bs) { bs = s; bi = i; }
  }
  // 质量一般就跳过（牌组越精越好，跳过差牌是必修课）
  if (bs < 2 && me.deck.length >= 8) return -1;
  if (bs < 9 && me.deck.length >= 10) return -1;
  return bi;
}

/* 是否使用核心信标（第7轮起，投骰前直达 Boss 门，代替移动） */
function aiUseBeacon(view) {
  if (view.round < CONFIG.bossChallengeRound) return false;
  if (view.me.pos === 22) return false;
  var eva = aiBossChallenge(view);
  if (eva.go) return true;
  return false;
}

/* --- 8) 是否挑战 Boss（只用公开 Boss 情报 + 自身牌组；返回可解释的评估） --- */
function aiBossChallenge(view) {
  var me = view.me, ds = deckStats(me.deck);
  var hpPct = me.hp / me.maxhp;
  var cycleTurns = Math.max(1.5, ds.size / 5);
  // 我方每回合伤害（0.55：能量需在攻防间分配的诚实系数，经校准）
  var dmgPerTurn = Math.max(4, (ds.atkDmg / cycleTurns) * 0.55 + me.relics.length * 0.8 + ds.energy * 2);
  if (me.relics.indexOf('low_sword') >= 0) dmgPerTurn += 1.5;
  var ttk = view.boss.hp / dmgPerTurn;
  // Boss 每回合伤害（计入 P2/力量成长的诚实估计）
  var bossDps = 12 + view.boss.dmgBonus * 1.1 + view.round * 0.35;
  // 我方每回合有效防御（含防御遗物；0.6 为抽牌方差折扣）
  var relicBlock = 0;
  if (me.relics.indexOf('hourglass') >= 0) relicBlock += 2.5;
  if (me.relics.indexOf('charm2') >= 0) relicBlock += 2;
  if (me.relics.indexOf('anchor') >= 0) relicBlock += 0.8;
  if (me.relics.indexOf('crown') >= 0) relicBlock += 1.5;
  var blockPerTurn = (ds.block / cycleTurns) * 0.55 + relicBlock;
  var healPerTurn = (ds.heal / cycleTurns) * 0.5;
  var netDps = Math.max(4, bossDps - blockPerTurn - healPerTurn); // 4 为刀锋情形保底
  var ttd = me.hp / netDps;
  // 难度影响勇气边际（决策参数，非规则差异；经校准脚本验证）
  var bravery = (DIFFICULTY[view.difficulty].bossBravery || 0) / 100;
  var margin = 1.00 + bravery;
  if (view.op.alive && view.op.laps > me.laps) margin += 0.08; // 落后时更勇敢
  if (!view.op.alive) margin += 0.04;
  var needBlockRatio = 0.45 - bravery * 0.5;
  var go = true, why = '';
  if (hpPct < 0.5) { go = false; why = '生命过低'; }
  else if (view.round < CONFIG.bossChallengeRound) { go = false; why = '核心尚未成型'; }
  else if (blockPerTurn + healPerTurn < bossDps * needBlockRatio) { go = false; why = '防御不足'; }
  else if (ttk <= 7.5 && ttk * 1.15 <= ttd * margin) { go = true; why = '速杀：击杀需' + ttk.toFixed(1) + '回合、可存活' + ttd.toFixed(1) + '回合'; }
  else if (ds.block >= 100 && ttk <= 12 && ttk * 1.15 <= ttd * margin) { go = true; why = '坚守：击杀需' + ttk.toFixed(1) + '回合、可存活' + ttd.toFixed(1) + '回合'; }
  else if (view.round >= 20 && hpPct >= 0.5 && ttk <= 12 && blockPerTurn + healPerTurn >= bossDps * 0.25) { go = true; why = '背水一战：击杀需' + ttk.toFixed(1) + '回合、可存活' + ttd.toFixed(1) + '回合'; }
  else if (ttk > 12) { go = false; why = '击杀需' + ttk.toFixed(1) + '回合过久'; }
  else { go = false; why = '存活不足'; }
  if (typeof process !== 'undefined' && process.env && process.env.FORCE_BOSS === '1' && view.round >= CONFIG.bossChallengeRound) { go = true; why = 'FORCE(' + why + ')'; }
  return { go: go, why: why, ttk: Math.round(ttk * 10) / 10, ttd: Math.round(ttd * 10) / 10 };
}

/* --- 8.5) 是否挑战精英（绕行费 20G，金币不足则必须战斗） --- */
function aiEliteChallenge(view, rand) {
  var me = view.me, ds = deckStats(me.deck);
  var score = (me.hp / me.maxhp) * 100 + ds.atkDmg * 0.8 + ds.block * 0.3 + me.relics.length * 5 + (view.round >= 5 ? 8 : 0);
  var go = score >= 150;
  if (me.hp / me.maxhp < 0.45) go = false; // 残血必绕行（有钱的话）
  if (rand && DIFFICULTY[view.difficulty].aiNoise > 0 && rand() < DIFFICULTY[view.difficulty].aiNoise) {
    go = rand() < 0.5;
  }
  return go;
}

/* --- 9) 卡牌战斗：单步决策 --- */
function buildCombatView(C) {
  return {
    turn: C.turn,
    energy: C.hero.energy,
    hp: C.hero.hp, maxhp: C.hero.maxhp, block: C.hero.block,
    str: C.hero.str, vuln: C.hero.vuln, weak: C.hero.weak,
    hand: C.hand.map(function (c, i) { return { i: i, uid: c.uid, cid: c.cid, up: c.up, cost: CARDS[c.cid].cost, eff: cardEff(c.cid, c.up) }; }),
    drawCount: C.draw.length, discardCount: C.discard.length, exhaustCount: C.exhaust.length,
    enemy: { hp: C.enemy.hp, maxhp: C.enemy.maxhp, block: C.enemy.block, str: C.enemy.str, vuln: C.enemy.vuln, weak: C.enemy.weak, phase: C.enemy.phase, isBoss: C.enemy.isBoss },
    intent: intentOf(C),
    isBoss: C.isBoss,
  };
}

/* 估算一张攻击牌的实际伤害（公开信息计算） */
function estAttackDamage(v, card, atkBonus) {
  var e = card.eff, total = 0;
  for (var i = 0; i < (e.hits || 1); i++) {
    var raw = e.dmg + atkBonus;
    if (v.weak > 0) raw = Math.floor(raw * 0.75);
    var dmg = raw;
    if (v.enemy.vuln > 0) dmg = Math.floor(dmg * 1.5);
    // 注意：格挡是共享的，多段伤害顺序结算——这里做近似
    total += Math.max(0, dmg - (i === 0 ? v.enemy.block : 0));
  }
  return total;
}

function aiCombat(view, cv, rand) {
  var me = view.me;
  var atkBonus = cv.str + (me.relics.indexOf('edge') >= 0 ? 1 : 0) + (me.relics.indexOf('bell') >= 0 ? 2 : 0);
  var hard = !!DIFFICULTY[view.difficulty].combatSkill;
  var playable = cv.hand.filter(function (c) { return c.cost <= cv.energy; });

  function maybeNoise(act) {
    if (rand && DIFFICULTY[view.difficulty].aiNoise > 0 && rand() < DIFFICULTY[view.difficulty].aiNoise) {
      if (playable.length && rand() < 0.6) return { a: 'play', uid: playable[Math.floor(rand() * playable.length)].uid };
      return { a: 'end' };
    }
    return act;
  }
  if (!playable.length) return maybeNoise({ a: 'end' });

  var incoming = cv.intent.t === 'atk' ? cv.intent.total : 0;
  var needBlock = Math.max(0, incoming - cv.block);

  // (1) 0 费过牌/能量牌优先（肾上腺素/冥想），过载只在安全时用
  var zero = playable.filter(function (c) { return c.cost === 0 && (c.eff.draw || c.eff.energy) && !c.eff.dmg; });
  if (zero.length) {
    zero.sort(function (a, b) { return ((b.eff.energy || 0) * 3 + (b.eff.draw || 0)) - ((a.eff.energy || 0) * 3 + (a.eff.draw || 0)); });
    return maybeNoise({ a: 'play', uid: zero[0].uid });
  }
  var od = null;
  for (var i = 0; i < playable.length; i++) if (playable[i].cid === 'overdrive' && cv.hp / cv.maxhp > 0.5) od = playable[i];
  if (od) return maybeNoise({ a: 'play', uid: od.uid });

  // (2) 斩杀检测：当前能量能打出的攻击总伤 >= 敌方剩余
  var atks = playable.filter(function (c) { return c.eff.dmg; });
  var ehp = cv.enemy.hp + cv.enemy.block;
  var estTotal = 0;
  var sorted = atks.slice().sort(function (a, b) { return (estAttackDamage(cv, b, atkBonus) / b.cost) - (estAttackDamage(cv, a, atkBonus) / a.cost); });
  var eLeft = cv.energy;
  for (var k = 0; k < sorted.length; k++) {
    if (sorted[k].cost <= eLeft) { estTotal += estAttackDamage(cv, sorted[k], atkBonus); eLeft -= sorted[k].cost; }
  }
  if (atks.length && estTotal >= ehp) {
    return maybeNoise({ a: 'play', uid: sorted[0].uid });
  }

  // (2b) 长战斗开局铺垫：先挂力量/易伤（Boss/精英战的致胜关键）。
  // 只有当本回合缺口可接受（<=10）时才铺垫，否则先保命，下次循环再铺。
  var longFight = (cv.enemy.hp + cv.enemy.block) > 45;
  if (longFight && needBlock <= 10) {
    var strFirst = playable.filter(function (c) { return c.eff.str; });
    if (strFirst.length) {
      strFirst.sort(function (a, b) { return a.cost - b.cost; });
      return maybeNoise({ a: 'play', uid: strFirst[0].uid });
    }
    var vulnFirst = playable.filter(function (c) { return !c.eff.dmg && (c.eff.vuln || c.eff.weak) && atks.length > 0; });
    if (vulnFirst.length && cv.enemy.hp > 25) {
      vulnFirst.sort(function (a, b) { return ((b.eff.vuln || 0) * 2 + (b.eff.weak || 0)) - ((a.eff.vuln || 0) * 2 + (a.eff.weak || 0)); });
      return maybeNoise({ a: 'play', uid: vulnFirst[0].uid });
    }
  }

  // (3) 格挡缺口：补甲（困难模式：敌人是 buff 意图时不浪费大甲）
  if (needBlock > 0) {
    var blocks = playable.filter(function (c) { return c.eff.block; });
    if (blocks.length) {
      blocks.sort(function (a, b) { return (b.eff.block / b.cost) - (a.eff.block / a.cost); });
      if (!hard || cv.intent.t === 'atk') return maybeNoise({ a: 'play', uid: blocks[0].uid });
    }
  }

  // (4) 先挂易伤/虚弱再打伤害
  var setup = playable.filter(function (c) { return !c.eff.dmg && (c.eff.vuln || c.eff.weak) && (atks.length > 0); });
  if (setup.length && cv.enemy.hp > 25) {
    setup.sort(function (a, b) { return ((b.eff.vuln || 0) * 2 + (b.eff.weak || 0)) - ((a.eff.vuln || 0) * 2 + (a.eff.weak || 0)); });
    return maybeNoise({ a: 'play', uid: setup[0].uid });
  }

  // (5) 攻击：按 伤害/费用 排序
  if (atks.length) {
    // 困难模式：敌方残血时优先攻击而非其他动作（已在斩杀中处理）；长战斗优先力量
    return maybeNoise({ a: 'play', uid: sorted[0].uid });
  }

  // (6) 力量 / 治疗 / 其他
  var strC = playable.filter(function (c) { return c.eff.str; });
  if (strC.length && cv.enemy.hp > 30) return maybeNoise({ a: 'play', uid: strC[0].uid });
  var healC = playable.filter(function (c) { return c.eff.heal && cv.hp / cv.maxhp < (hard ? 0.7 : 0.45); });
  if (healC.length) return maybeNoise({ a: 'play', uid: healC[0].uid });
  var rest = playable.filter(function (c) { return !c.eff.selfDmg; });
  if (rest.length) {
    rest.sort(function (a, b) { return b.cost - a.cost; });
    return maybeNoise({ a: 'play', uid: rest[0].uid });
  }
  return maybeNoise({ a: 'end' });
}

/* 供 node 测试导出 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    hashSeed: hashSeed, R: R, ri: ri, pick: pick, chance: chance, shuffleInPlace: shuffleInPlace, aiR: aiR,
    newCardInst: newCardInst, newChar: newChar, newGame: newGame, charOf: charOf, foeOf: foeOf,
    hasRelic: hasRelic, addRelic: addRelic, healChar: healChar, damageChar: damageChar, addGold: addGold,
    buildAIView: buildAIView, nextOf: nextOf, isFork: isFork, simWalk: simWalk,
    rollDice: rollDice, availableDice: availableDice, tollFor: tollFor, upgradeCost: upgradeCost, lapIncome: lapIncome,
    enemyDmgBonus: enemyDmgBonus, enemyHpMult: enemyHpMult, makeEnemy: makeEnemy, makeBoss: makeBoss, bossPreview: bossPreview,
    createCombat: createCombat, drawCards: drawCards, intentOf: intentOf, playCard: playCard, endHeroTurn: endHeroTurn, finishCombat: finishCombat,
    rollRarity: rollRarity, randomCardOfRarity: randomCardOfRarity, genCardChoices: genCardChoices, genRelic: genRelic, randomDice: randomDice,
    genShopStock: genShopStock, shopPrice: shopPrice, bossPhase: bossPhase,
    deckStats: deckStats, scoreCardForDeck: scoreCardForDeck, tileValue: tileValue, pathValue: pathValue,
    aiPickDice: aiPickDice, aiPickDir: aiPickDir, aiBuyBuilding: aiBuyBuilding, aiUpgradeBuilding: aiUpgradeBuilding,
    aiRest: aiRest, aiShopNext: aiShopNext, aiEvent: aiEvent, aiDraft: aiDraft, aiBossChallenge: aiBossChallenge, aiUseBeacon: aiUseBeacon, aiEliteChallenge: aiEliteChallenge,
    buildCombatView: buildCombatView, aiCombat: aiCombat,
  };
}
