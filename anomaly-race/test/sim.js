/* 无头模拟测试：在 node 中验证引擎 + AI 决策 + 一整局竞速可正常跑完。
 * 运行：node test/sim.js
 */
'use strict';
var D = require('../data.js');
Object.assign(global, D);
var E = require('../engine.js');
Object.assign(global, E);

var failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('ASSERT FAIL:', msg); }
}

/* ---------- 1) 公平性不变量 ---------- */
(function fairness() {
  var G = newGame('fair-test', 'standard');
  var v = buildAIView(G, 'ai');
  assert(!('deck' in v.op), 'AI视图不应包含对手牌组');
  assert(!('hand' in v.op), 'AI视图不应包含对手手牌');
  assert(v.me.deck.length === 10, 'AI应看到自己完整牌组');
  var s0 = G.rngState;
  var r = function () { return aiR(G); };
  aiPickDice(v, r); aiPickDir(v, 4, r); aiEvent(v, EVENTS[9]);
  aiDraft(v, ['heavy', 'dawn', 'bandage']); aiBossChallenge(v); aiRest(v);
  aiBuyBuilding(v, 2);
  var C = createCombat(G, 'ai', makeEnemy(G, ENEMIES_NORMAL[0]), {});
  var s1 = G.rngState;
  for (var i = 0; i < 20; i++) aiCombat(v, buildCombatView(C), r);
  assert(G.rngState === s1, 'AI决策不应消耗游戏随机数');
  // 确定性（标准难度无噪声）
  var a1 = JSON.stringify(aiPickDice(v, r));
  var a2 = JSON.stringify(aiPickDice(v, r));
  assert(a1 === a2, '标准AI决策应确定');
  var c1 = JSON.stringify(aiCombat(v, buildCombatView(C), r));
  var c2 = JSON.stringify(aiCombat(v, buildCombatView(C), r));
  assert(c1 === c2, '标准AI战斗决策应确定');
  console.log('fairness ok, bonus relic =', G.aiBonusRelic);
})();

/* ---------- 2) 战斗引擎冒烟测试 ---------- */
(function combats() {
  var diffs = ['easy', 'standard', 'hard'];
  diffs.forEach(function (diff) {
    var G = newGame('combat-' + diff, diff);
    // 普通战斗 x30
    for (var i = 0; i < 30; i++) {
      var ch = charOf(G, 'ai'); ch.hp = ch.maxhp;
      var C = createCombat(G, 'ai', makeEnemy(G, ENEMIES_NORMAL[i % 3]), {});
      var guard = 0;
      while (!C.over && guard++ < 800) {
        var act = aiCombat(buildAIView(G, 'ai'), buildCombatView(C), function () { return aiR(G); });
        if (act.a === 'end') endHeroTurn(G, C);
        else {
          var idx = -1;
          for (var k = 0; k < C.hand.length; k++) if (C.hand[k].uid === act.uid) idx = k;
          if (idx < 0) endHeroTurn(G, C); else playCard(G, C, idx);
        }
      }
      assert(C.over === 'win' || C.over === 'lose', '战斗应结束');
      finishCombat(G, C);
    }
    // 精英 x10（给AI一套成型牌组）
    for (var j = 0; j < 10; j++) {
      var ch2 = charOf(G, 'player'); ch2.hp = ch2.maxhp;
      ch2.deck = ['heavy', 'heavy', 'slash2', 'dance', 'ironwall', 'ironwall', 'pierce', 'charge', 'bandage', 'defend', 'defend', 'strike'].map(function (c) { return newCardInst(c, false); });
      var C2 = createCombat(G, 'player', makeEnemy(G, ENEMIES_ELITE[j % 3]), {});
      var g2 = 0;
      while (!C2.over && g2++ < 800) {
        var a2 = aiCombat(buildAIView(G, 'player'), buildCombatView(C2), function () { return aiR(G); });
        if (a2.a === 'end') endHeroTurn(G, C2);
        else {
          var ix = -1;
          for (var k2 = 0; k2 < C2.hand.length; k2++) if (C2.hand[k2].uid === a2.uid) ix = k2;
          if (ix < 0) endHeroTurn(G, C2); else playCard(G, C2, ix);
        }
      }
      assert(C2.over, '精英战斗应结束');
      finishCombat(G, C2);
    }
    console.log('combats ok [' + diff + ']');
  });
})();

/* ---------- 3) 整局无头竞速 ---------- */
var PREV = {};
for (var pi = 0; pi < 24; pi++) PREV[pi] = (pi + 23) % 24;
PREV['S0'] = 4; PREV['S1'] = 'S0'; PREV['S2'] = 'S1'; PREV['D0'] = 16; PREV['D1'] = 'D0';

function passStart(G, ch) {
  ch.laps++;
  var gold = CONFIG.passStartGold + lapIncome(ch, G);
  if (hasRelic(ch, 'meat')) gold += 25;
  if (hasRelic(ch, 'payday')) gold += 80;
  addGold(G, ch, gold);
  ch.maxhp += CONFIG.lapMaxHpBonus;
  healChar(ch, CONFIG.lapHealBonus);
  if (hasRelic(ch, 'dicebag')) { var d = randomDice(G); ch.dice[d]++; }
}
function landStart(G, ch) {
  ch.laps++;
  var gold = CONFIG.landStartGold + lapIncome(ch, G);
  if (hasRelic(ch, 'meat')) gold += 25;
  if (hasRelic(ch, 'payday')) gold += 80;
  addGold(G, ch, gold);
  healChar(ch, CONFIG.landStartHeal);
  ch.maxhp += CONFIG.lapMaxHpBonus;
  healChar(ch, CONFIG.lapHealBonus);
  if (hasRelic(ch, 'dicebag')) { var d = randomDice(G); ch.dice[d]++; }
}

function runCombatHeadless(G, id, enemy, kind) {
  var ch = charOf(G, id);
  tr('    combat start: ' + enemy.name + ' hp=' + enemy.hp + ' vs hero hp=' + ch.hp + ' deck=' + ch.deck.length);
  var C = createCombat(G, id, enemy, {});
  var guard = 0;
  var rand = function () { return aiR(G); };
  while (!C.over && guard++ < 800) {
    var act = aiCombat(buildAIView(G, id), buildCombatView(C), rand);
    if (act.a === 'end') endHeroTurn(G, C);
    else {
      var idx = -1;
      for (var i = 0; i < C.hand.length; i++) if (C.hand[i].uid === act.uid) idx = i;
      if (idx < 0) endHeroTurn(G, C); else playCard(G, C, idx);
    }
  }
  var res = finishCombat(G, C);
  tr('    combat end: ' + C.over + ' turns=' + C.turn + ' heroHp=' + ch.hp + ' bossLeft=' + C.enemy.hp);
  if (!res.win) return { win: false, turns: C.turn };
  if (kind === 'boss') return { win: true, boss: true, turns: C.turn };
  ch.stats.kills++;
  var weights = kind === 'elite' ? [25, 45, 30] : [55, 35, 10];
  var opts = genCardChoices(G, weights, 3, ch.deck);
  var di = aiDraft(buildAIView(G, id), opts);
  if (di >= 0) ch.deck.push(newCardInst(opts[di], false));
  var rp = kind === 'elite' ? CONFIG.relicDropElite : CONFIG.relicDropNormal;
  if (chance(G, rp)) {
    var tier = (kind === 'elite' && chance(G, 0.3)) ? 'high' : 'mid';
    var r = addRelic(G, ch, genRelic(G, tier));
    if (r.gold) addGold(G, ch, r.gold);
  }
  return { win: true, turns: C.turn, gold: res.gold };
}

function applyEffectHeadless(G, id, ef, depth) {
  var ch = charOf(G, id);
  if (ef.gold) { if (ef.gold > 0) addGold(G, ch, ef.gold); else ch.gold = Math.max(0, ch.gold + ef.gold); }
  if (ef.pay) ch.gold = Math.max(0, ch.gold - ef.pay);
  if (ef.heal) healChar(ch, ef.heal);
  if (ef.hurt) damageChar(G, ch, ef.hurt);
  if (ef.randomCard) ch.deck.push(newCardInst(genCardChoices(G, [80, 15, 5], 1)[0], false));
  if (ef.dice) { var d = randomDice(G); ch.dice[d]++; }
  if (ef.relic) { var r = addRelic(G, ch, genRelic(G, 'mid')); if (r.gold) addGold(G, ch, r.gold); }
  if (ef.gamble) { ch.gold = Math.max(0, ch.gold - ef.gamble.cost); if (chance(G, 0.5)) addGold(G, ch, ef.gamble.win); }
  if (ef.jump && ch.alive) {
    if (ef.jump > 0) {
      for (var s = 0; s < ef.jump; s++) {
        var nx = nextOf(ch.pos);
        ch.pos = nx[0]; // 事件跳跃默认走主路（公开规则）
        if (ch.pos === 0) passStart(G, ch);
      }
      resolveLandingHeadless(G, id, depth + 1);
    } else {
      for (var b = 0; b < -ef.jump; b++) ch.pos = PREV[ch.pos];
    }
  }
}

function doShopHeadless(G, id) {
  var ch = charOf(G, id);
      var stock = genShopStock(G);
      for (var st = 0; st < 12; st++) {
        var act = aiShopNext(buildAIView(G, id), stock, { canHeal: ch.hp < ch.maxhp });
        if (act.a === 'leave') break;
        if (act.a === 'relic' && stock.relic) {
          var rp = shopPrice(G, ch, RELICS[stock.relic].tier === 'high' ? SHOP.relicPrice.high : SHOP.relicPrice.mid);
          if (ch.gold < rp) break;
          ch.gold -= rp;
          var rr = addRelic(G, ch, stock.relic);
          if (rr.gold) addGold(G, ch, rr.gold);
          stock.relic = null;
        } else if (act.a === 'card' && stock.cards[act.i] != null) {
          var cc = stock.cards[act.i];
          var cp = shopPrice(G, ch, SHOP.cardPrice[CARDS[cc].rarity]);
          if (ch.gold < cp) break;
          ch.gold -= cp; ch.deck.push(newCardInst(cc, false)); stock.cards[act.i] = null;
        } else if (act.a === 'upgrade') {
          var upg = shopPrice(G, ch, SHOP.upgradePrice);
          var uc = null;
          for (var u = 0; u < ch.deck.length; u++) if (ch.deck[u].uid === act.uid) uc = ch.deck[u];
          if (!uc || uc.up || ch.gold < upg) break;
          ch.gold -= upg; uc.up = true;
        } else if (act.a === 'dice' && stock.dice) {
          var dp = shopPrice(G, ch, SHOP.dicePrice);
          if (ch.gold < dp) break;
          ch.gold -= dp; ch.dice[stock.dice]++; stock.dice = null;
        } else if (act.a === 'heal') {
          var hp = shopPrice(G, ch, SHOP.healPrice);
          if (ch.gold < hp || ch.hp >= ch.maxhp) break;
          ch.gold -= hp; healChar(ch, SHOP.healAmount);
        } else if (act.a === 'remove') {
          var mp = shopPrice(G, ch, SHOP.removePrice);
          if (ch.gold < mp) break;
          var ri2 = -1;
          for (var q = 0; q < ch.deck.length; q++) if (ch.deck[q].uid === act.uid) ri2 = q;
          if (ri2 < 0) break;
          ch.gold -= mp; ch.deck.splice(ri2, 1);
        } else break;
      }
}

function resolveLandingHeadless(G, id, depth) {
  if (depth > 4) return null;
  var ch = charOf(G, id);
  if (!ch.alive) return null;
  var n = nodeById(ch.pos);
  var rand = function () { return aiR(G); };
  tr('  [R' + G.round + ' ' + id + '] landed ' + ch.pos + ' (' + n.kind + '/' + n.name + ') hp=' + ch.hp);
  switch (n.kind) {
    case 'start': landStart(G, ch); return null;
    case 'gold': addGold(G, ch, n.amount); return null;
    case 'vault': addGold(G, ch, n.amount); { var d = randomDice(G); ch.dice[d]++; } return null;
    case 'chest': { var r = addRelic(G, ch, genRelic(G, 'mid')); if (r.gold) addGold(G, ch, r.gold); } return null;
    case 'fight': {
      runCombatHeadless(G, id, makeEnemy(G, pick(G, ENEMIES_NORMAL)), 'normal');
      if (!charOf(G, id).alive) { var ddx = deckStats(ch.deck); tr('  [R' + G.round + ' ' + id + '] DIED-normal deck=' + ch.deck.length + ' atk=' + ddx.atkDmg + ' blk=' + ddx.block + ' rel=' + ch.relics.length); return 'dead'; }
      return null;
    }
    case 'elite': {
      var scout = makeEnemy(G, pick(G, ENEMIES_ELITE));
      if (!aiEliteChallenge(buildAIView(G, id), rand) && ch.gold >= CONFIG.eliteBypassCost) {
        ch.gold -= CONFIG.eliteBypassCost;
        return null; // 绕行
      }
      runCombatHeadless(G, id, scout, 'elite');
      if (!charOf(G, id).alive) { var ddx2 = deckStats(ch.deck); tr('  [R' + G.round + ' ' + id + '] DIED-elite deck=' + ch.deck.length + ' atk=' + ddx2.atkDmg + ' blk=' + ddx2.block + ' rel=' + ch.relics.length); return 'dead'; }
      charOf(G, id).stats.elites++;
      return null;
    }
    case 'fork': {
      if (n.fight) {
        runCombatHeadless(G, id, makeEnemy(G, pick(G, ENEMIES_NORMAL)), 'normal');
        if (!charOf(G, id).alive) { var ddx0 = deckStats(ch.deck); tr('  [R' + G.round + ' ' + id + '] DIED-fork deck=' + ch.deck.length + ' atk=' + ddx0.atkDmg + ' blk=' + ddx0.block + ' rel=' + ch.relics.length); return 'dead'; }
        return null;
      }
      var ev0 = pick(G, EVENTS);
      if (ev0.choices) applyEffectHeadless(G, id, ev0.choices[aiEvent(buildAIView(G, id), ev0)].effect, depth);
      else applyEffectHeadless(G, id, ev0.effect, depth);
      return charOf(G, id).alive ? null : 'dead';
    }
    case 'event': {
      var ev = pick(G, EVENTS);
      if (ev.choices) applyEffectHeadless(G, id, ev.choices[aiEvent(buildAIView(G, id), ev)].effect, depth);
      else applyEffectHeadless(G, id, ev.effect, depth);
      return charOf(G, id).alive ? null : 'dead';
    }
    case 'draft': {
      var opts = genCardChoices(G, [60, 30, 10], 3, ch.deck);
      var di = aiDraft(buildAIView(G, id), opts);
      if (di >= 0) ch.deck.push(newCardInst(opts[di], false));
      return null;
    }
    case 'rest': {
      var dec = aiRest(buildAIView(G, id));
      if (dec.act === 'heal') healChar(ch, 30);
      else if (dec.act === 'remove') { for (var ri3 = 0; ri3 < ch.deck.length; ri3++) if (ch.deck[ri3].uid === dec.uid) { ch.deck.splice(ri3, 1); break; } }
      else { for (var i = 0; i < ch.deck.length; i++) if (ch.deck[i].uid === dec.uid) ch.deck[i].up = true; }
      return null;
    }
    case 'shop': {
      doShopHeadless(G, id);
      return null;
    }
    case 'boss': {
      if (G.round < CONFIG.bossChallengeRound) { addGold(G, ch, 30); return null; }
      var evaL = aiBossChallenge(buildAIView(G, id));
      var dsL = deckStats(ch.deck);
      tr('  [R' + G.round + ' ' + id + '] LAND boss gate: hp=' + ch.hp + '/' + ch.maxhp + ' atkDmg=' + dsL.atkDmg + ' block=' + dsL.block + ' relics=' + ch.relics.length + ' bossHP=' + bossPreview(G).hp + ' decide=' + evaL.go + '(' + evaL.why + ')');
      if (evaL.go) {
        var br = runCombatHeadless(G, id, makeBoss(G), 'boss');
        if (br.win && br.boss) return 'boss-win';
        if (!charOf(G, id).alive) return 'dead';
      }
      return null;
    }
    case 'building': {
      var b = G.buildings[ch.pos];
      if (!b) {
        if (aiBuyBuilding(buildAIView(G, id), ch.pos) && ch.gold >= n.price) {
          ch.gold -= n.price;
          G.buildings[ch.pos] = { owner: id, level: 1 };
          ch.buildings.push(ch.pos);
        }
      } else if (b.owner === id) {
        if (b.level < 3) {
          var uc = upgradeCost(ch.pos, b.level);
          if (aiUpgradeBuilding(buildAIView(G, id), ch.pos) && ch.gold >= uc) { ch.gold -= uc; b.level++; }
        }
      } else {
        var owner = charOf(G, b.owner);
        var toll = tollFor(ch.pos, b.level, owner);
        var paid = Math.min(ch.gold, toll);
        ch.gold -= paid; addGold(G, owner, paid);
        if (paid < toll) damageChar(G, ch, Math.ceil((toll - paid) / 4));
        if (!ch.alive) return 'dead';
      }
      return null;
    }
    default: return null;
  }
}

var TRACE = process.env.TRACE === '1';
function tr() { if (TRACE) console.log.apply(console, arguments); }

function doTurnHeadless(G, id) {
  var ch = charOf(G, id);
  if (!ch.alive) return null;
  tr('  [R' + G.round + ' ' + id + '] turn start hp=' + ch.hp + ' pos=' + ch.pos + ' gold=' + ch.gold);
  var rand = function () { return aiR(G); };
  if (aiUseBeacon(buildAIView(G, id))) {
    ch.pos = 22;
    tr('  [R' + G.round + ' ' + id + '] BEACON to boss gate');
    return resolveLandingHeadless(G, id, 0);
  }
  var ds = aiPickDice(buildAIView(G, id), rand);
  var steps;
  if (ds.dice === 'precise') { steps = ds.num; ch.dice.precise--; }
  else steps = rollDice(G, ch, ds.dice).total;
  for (var s = 0; s < steps; s++) {
    var nx = nextOf(ch.pos);
    if (nx.length > 1) {
      var c = aiPickDir(buildAIView(G, id), ch.pos, rand);
      ch.pos = (c === 'main') ? nx[0] : nx[1];
    } else ch.pos = nx[0];
    ch.stats.steps++;
    if (ch.pos === 0 && s < steps - 1) passStart(G, ch);
    if (ch.pos === 21 && s < steps - 1 && ch.gold >= 120) doShopHeadless(G, id);
    if (ch.pos === 22 && s < steps - 1 && G.round < CONFIG.bossChallengeRound) addGold(G, ch, 30);
    if (ch.pos === 22 && s < steps - 1) {
      var ev = buildAIView(G, id), dsx = deckStats(ev.me.deck), eva = aiBossChallenge(ev);
      tr('  [R' + G.round + ' ' + id + '] pass boss gate: hp=' + ev.me.hp + '/' + ev.me.maxhp + ' atkDmg=' + dsx.atkDmg + ' block=' + dsx.block + ' relics=' + ev.me.relics.length + ' bossHP=' + ev.boss.hp + ' decide=' + eva.go + '(' + eva.why + ')');
      if (eva.go) {
        var pb = runCombatHeadless(G, id, makeBoss(G), 'boss');
        if (pb.win && pb.boss) return 'boss-win';
        return 'dead';
      }
    }
  }
  return resolveLandingHeadless(G, id, 0);
}

function playGame(seed, diff) {
  var G = newGame(seed, diff);
  var winner = null;
  while (G.round <= 120 && !winner) {
    var order = (G.round % 2 === 1) ? ['player', 'ai'] : ['ai', 'player'];
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      if (!charOf(G, id).alive) continue;
      var r = doTurnHeadless(G, id);
      if (r === 'boss-win') { winner = id; break; }
      if (!charOf(G, 'player').alive) { winner = 'none(player-dead)'; break; }
    }
    if (winner) break;
    var msgs = bossPhase(G);
    msgs.forEach(function (m) {
      if (m.pulse) {
        ['player', 'ai'].forEach(function (id) {
          if (charOf(G, id).alive) damageChar(G, charOf(G, id), m.pulse);
        });
      }
    });
    if (!charOf(G, 'player').alive) { winner = 'none(player-dead-pulse)'; break; }
    G.round++;
  }
  return { winner: winner || ('timeout(p:' + charOf(G, 'player').alive + ',a:' + charOf(G, 'ai').alive + ',r:' + G.round + ')'), rounds: G.round, p: charOf(G, 'player'), a: charOf(G, 'ai'), relic: G.aiBonusRelic };
}

var wins = { player: 0, ai: 0, other: 0 };
var NSEEDS = Math.max(1, +(process.env.SEEDS || 6));
for (var s = 1; s <= NSEEDS; s++) {
  var out = playGame('race-sim-' + s, 'standard');
  var w = out.winner;
  if (w === 'player') wins.player++;
  else if (w === 'ai') wins.ai++;
  else wins.other++;
  console.log('game race-sim-' + s + ': winner=' + w + ' rounds=' + out.rounds +
    ' | P(hp' + out.p.hp + '/' + out.p.maxhp + ' g' + out.p.gold + ' d' + out.p.deck.length + ' r' + out.p.relics.length + ' lap' + out.p.laps + ')' +
    ' A(hp' + out.a.hp + '/' + out.a.maxhp + ' g' + out.a.gold + ' d' + out.a.deck.length + ' r' + out.a.relics.length + ' lap' + out.a.laps + ')' +
    ' bonus=' + out.relic);
}
console.log('wins:', JSON.stringify(wins));
assert(wins.player + wins.ai > 0, 'should have at least one decided game');

if (failures) { console.error('FAILURES: ' + failures); process.exit(1); }
console.log('ALL SIM TESTS PASSED');