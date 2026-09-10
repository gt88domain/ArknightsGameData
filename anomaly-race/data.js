/* ============================================================
 * data.js —— 异变竞速：循环棋盘 × 卡牌讨伐
 * 纯数据 + 数值定义，不依赖 DOM，可被 node 直接加载做逻辑测试。
 * ============================================================ */
'use strict';

/* ---------------- 全局数值 ---------------- */
var CONFIG = {
  startHP: 80,
  startGold: 140,
  energyPerTurn: 4,
  cardsPerTurn: 5,
  victoryRestNormal: 5,   // 普通战斗胜利后休整回复（双方相同）
  victoryRestElite: 10,    // 精英战斗胜利后休整回复（双方相同）
  eliteBypassCost: 20,
  bossChallengeRound: 7, // 第7轮起核心成型可挑战（此前到访领调查经费）    // 精英格绕行费用（双方相同，金币不足则必须战斗）
  passStartGold: 60,      // 经过起点
  landStartGold: 100,     // 停留起点
  landStartHeal: 15,
  lapMaxHpBonus: 3,       // 每圈成长
  lapHealBonus: 5,
  erosionPerRound: 7,     // Boss 每轮侵蚀增长
  pulseEveryRounds: 3,    // 每 N 轮异变冲击
  pulseBase: 2,           // 冲击伤害 = base + round
  enemyHpScale: 0.05,     // 敌人 HP 每轮 +6%
  enemyDmgEvery: 3,       // 敌人伤害每 2 轮 +1
  bossBaseHp: 125,
  bossHpPerRound: 2,
  maxCombatRounds: 40,
  relicDropNormal: 0.18,
  relicDropElite: 0.65,
  aiReserveGold: 60,      // AI 留存金（决策参数，非规则差异）
};

/* ---------------- 棋盘 ----------------
 * 24 格主环 + 3 格捷径(S) + 2 格宝库小径(D)
 * kind: start/gold/building/fight/elite/draft/event/rest/shop/boss/vault/chest
 */
var BOARD_NODES = [
  // 主环（顺时针）
  { id: 0,  x: 90,  y: 610, kind: 'start',    name: '罗德岛篝火', icon: '🔥', desc: '起点：经过+60金币，停留+100金币并回复12生命' },
  { id: 1,  x: 225, y: 618, kind: 'gold',     name: '源石碎片', icon: '💰', desc: '+40金币', amount: 40 },
  { id: 2,  x: 355, y: 620, kind: 'building', name: '源石矿场', icon: '⛏️', desc: '可购买的建筑', price: 120 },
  { id: 3,  x: 485, y: 620, kind: 'fight',     name: '荒野遭遇', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 4,  x: 605, y: 615, kind: 'fork',      name: '岔路·荒野', icon: '🔀', desc: '战斗格，且前方出现岔路：主路 / 遗迹捷径', fork: { main: 5, branch: 'S0', branchName: '遗迹捷径' }, fight: 'normal' },
  { id: 5,  x: 720, y: 605, kind: 'fight',     name: '荒野遭遇', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 6,  x: 820, y: 580, kind: 'gold',     name: '旅行者补给', icon: '💰', desc: '+50金币', amount: 50 },
  { id: 7,  x: 870, y: 505, kind: 'fight',     name: '荒野遭遇', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 8,  x: 885, y: 415, kind: 'elite',    name: '粉碎者巢穴', icon: '💀', desc: '与精英敌人战斗（更好奖励）' },
  { id: 9,  x: 880, y: 325, kind: 'building', name: '龙门商铺', icon: '🏪', desc: '可购买的建筑', price: 160 },
  { id: 10, x: 850, y: 235, kind: 'gold',     name: '赏金告示', icon: '💰', desc: '+50金币', amount: 50 },
  { id: 11, x: 790, y: 160, kind: 'draft',    name: '干员招募', icon: '🃏', desc: '免费三选一获得一张卡牌' },
  { id: 12, x: 685, y: 105, kind: 'fight',     name: '雪原遭遇', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 13, x: 570, y: 85,  kind: 'elite',    name: '冰原哨站', icon: '💀', desc: '与精英敌人战斗（更好奖励）' },
  { id: 14, x: 455, y: 80,  kind: 'event',    name: '未知信号', icon: '❓', desc: '触发一个随机事件' },
  { id: 15, x: 340, y: 85,  kind: 'rest',     name: '移动医疗站', icon: '💤', desc: '休息：回复30生命，或升级一张卡牌' },
  { id: 16, x: 230, y: 105, kind: 'fork',      name: '岔路·信号', icon: '🔀', desc: '事件格，且前方出现岔路：主路 / 宝库小径', fork: { main: 17, branch: 'D0', branchName: '宝库小径' }, fight: null, event: true },
  { id: 17, x: 135, y: 145, kind: 'fight',     name: '雪原遭遇', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 18, x: 85,  y: 215, kind: 'building', name: '企鹅物流站', icon: '🐧', desc: '可购买的建筑', price: 200 },
  { id: 19, x: 62,  y: 300, kind: 'event',    name: '未知信号', icon: '❓', desc: '触发一个随机事件' },
  { id: 20, x: 58,  y: 385, kind: 'fight',     name: '核心外围', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 21, x: 70,  y: 470, kind: 'shop',     name: '黑市',     icon: '🛒', desc: '用金币购买卡牌、遗物、骰具与服务' },
  { id: 22, x: 105, y: 545, kind: 'boss',     name: '异变核心', icon: '👁️', desc: '最终Boss！落点可选择挑战或暂避' },
  { id: 23, x: 160, y: 585, kind: 'gold',     name: '凯旋补给', icon: '💰', desc: '+60金币', amount: 60 },
  // 遗迹捷径（4 -> S0 -> S1 -> S2 -> 10）
  { id: 'S0', x: 590, y: 510, kind: 'gold',  name: '遗迹金库', icon: '💰', desc: '+80金币', amount: 80 },
  { id: 'S1', x: 660, y: 425, kind: 'fight', name: '遗迹守卫', icon: '⚔️', desc: '与普通敌人战斗' },
  { id: 'S2', x: 745, y: 350, kind: 'chest', name: '遗迹宝箱', icon: '🎁', desc: '免费获得一个随机遗物' },
  // 宝库小径（16 -> D0 -> D1 -> 20）
  { id: 'D0', x: 200, y: 200, kind: 'vault', name: '异变宝库', icon: '💎', desc: '+120金币并获得一个随机骰具', amount: 120 },
  { id: 'D1', x: 150, y: 295, kind: 'elite', name: '核心守卫', icon: '💀', desc: '与精英敌人战斗（更好奖励）' },
];

/* 后继表：fork 格有两个出口，其余一个出口 */
var BOARD_NEXT = (function () {
  var next = {};
  for (var i = 0; i < 24; i++) {
    if (i === 4) next[i] = [5, 'S0'];
    else if (i === 16) next[i] = [17, 'D0'];
    else next[i] = [(i + 1) % 24];
  }
  next['S0'] = ['S1']; next['S1'] = ['S2']; next['S2'] = [10];
  next['D0'] = ['D1']; next['D1'] = [20];
  return next;
})();

function nodeById(id) {
  for (var i = 0; i < BOARD_NODES.length; i++) if (BOARD_NODES[i].id === id) return BOARD_NODES[i];
  return null;
}

/* ---------------- 卡牌 ----------------
 * eff: dmg/hits/block/draw/energy/str/vuln/weak/heal/gold/selfDmg/exhaust
 * up: 升级后的增量（exhaust 不变）
 */
var CARDS = {
  strike:   { name: '打击',     cost: 1, type: 'atk',   rarity: 'starter',  eff: { dmg: 6, hits: 1 }, up: { dmg: 3 }, text: '造成6点伤害。' },
  defend:   { name: '防御',     cost: 1, type: 'skill', rarity: 'starter',  eff: { block: 5 }, up: { block: 3 }, text: '获得5点格挡。' },
  spark:    { name: '星火斩',   cost: 2, type: 'atk',   rarity: 'starter',  eff: { dmg: 9, hits: 1, draw: 1 }, up: { dmg: 3 }, text: '造成9点伤害，抽1张牌。' },
  guard:    { name: '守望',     cost: 1, type: 'skill', rarity: 'starter',  eff: { block: 7 }, up: { block: 4 }, text: '获得7点格挡。' },

  heavy:    { name: '重击',     cost: 2, type: 'atk',   rarity: 'common',   eff: { dmg: 15, hits: 1 }, up: { dmg: 4 }, text: '造成15点伤害。' },
  slash2:   { name: '连斩',     cost: 1, type: 'atk',   rarity: 'common',   eff: { dmg: 4, hits: 2 }, up: { dmg: 1 }, text: '造成4点伤害两次。' },
  pierce:   { name: '穿刺',     cost: 1, type: 'atk',   rarity: 'common',   eff: { dmg: 5, hits: 1, vuln: 2 }, up: { dmg: 2, vuln: 1 }, text: '造成5点伤害，施加2层易伤。' },
  ironwall: { name: '铁壁',     cost: 2, type: 'skill', rarity: 'common',   eff: { block: 13 }, up: { block: 4 }, text: '获得13点格挡。' },
  dodge:    { name: '闪避',     cost: 1, type: 'skill', rarity: 'common',   eff: { block: 4, draw: 1 }, up: { block: 2 }, text: '获得4点格挡，抽1张牌。' },
  taunt:    { name: '挑衅',     cost: 1, type: 'skill', rarity: 'common',   eff: { block: 5, weak: 2 }, up: { block: 3 }, text: '获得5点格挡，施加2层虚弱。' },
  bandage:  { name: '包扎',     cost: 1, type: 'skill', rarity: 'common',   eff: { heal: 6 }, up: { heal: 3 }, text: '回复6点生命。' },
  meditate: { name: '冥想',     cost: 0, type: 'skill', rarity: 'common',   eff: { draw: 1 }, up: { block: 4 }, text: '抽1张牌。' },
  quickrich:{ name: '富贵险中求', cost: 0, type: 'skill', rarity: 'common', eff: { gold: 20, exhaust: true }, up: { gold: 10 }, text: '获得20金币。耗尽。' },

  dance:    { name: '乱舞',     cost: 1, type: 'atk',   rarity: 'uncommon', eff: { dmg: 3, hits: 3 }, up: { dmg: 1 }, text: '造成3点伤害三次。' },
  dawn:     { name: '破晓',     cost: 3, type: 'atk',   rarity: 'uncommon', eff: { dmg: 26, hits: 1 }, up: { dmg: 8 }, text: '造成26点伤害。' },
  charge:   { name: '蓄势',     cost: 1, type: 'skill', rarity: 'uncommon', eff: { str: 3 }, up: { str: 1 }, text: '获得3点力量。' },
  hotblood: { name: '热血',     cost: 0, type: 'skill', rarity: 'common',   eff: { str: 2, exhaust: true }, up: { str: 1 }, text: '获得2点力量。耗尽。' },
  warcry:   { name: '战吼',     cost: 1, type: 'skill', rarity: 'uncommon', eff: { block: 4, vuln: 1, weak: 1 }, up: { block: 4 }, text: '获得4点格挡，施加1层易伤与1层虚弱。' },
  overdrive:{ name: '过载',     cost: 1, type: 'skill', rarity: 'uncommon', eff: { energy: 2, selfDmg: 4 }, up: { selfDmg: -2 }, text: '获得2点能量，受到4点伤害。' },
  stonewall:{ name: '源石壁垒', cost: 2, type: 'skill', rarity: 'uncommon', eff: { block: 17 }, up: { block: 5 }, text: '获得17点格挡。' },
  adrenaline:{ name: '肾上腺素', cost: 0, type: 'skill', rarity: 'uncommon', eff: { energy: 1, draw: 1, exhaust: true }, up: { energy: 1 }, text: '获得1点能量，抽1张牌。耗尽。' },

  meteor:   { name: '陨星坠',   cost: 3, type: 'atk',   rarity: 'rare',     eff: { dmg: 9, hits: 2, weak: 1 }, up: { dmg: 3 }, text: '造成9点伤害两次，施加1层虚弱。' },
  judgment: { name: '天使制裁', cost: 2, type: 'skill', rarity: 'rare',     eff: { heal: 14, energy: 1, exhaust: true }, up: { heal: 6 }, text: '回复14点生命，获得1点能量。耗尽。' },
  infinity: { name: '无限剑制', cost: 3, type: 'atk',   rarity: 'rare',     eff: { dmg: 7, hits: 3 }, up: { dmg: 2 }, text: '造成7点伤害三次。' },
  absolute: { name: '绝对防御', cost: 3, type: 'skill', rarity: 'rare',     eff: { block: 32, exhaust: true }, up: { block: 8 }, text: '获得32点格挡。耗尽。' },
};

var STARTER_DECK = ['strike', 'strike', 'strike', 'strike', 'defend', 'defend', 'defend', 'defend', 'spark', 'guard'];

function cardEff(cid, up) {
  var base = CARDS[cid].eff, out = {};
  for (var k in base) out[k] = base[k];
  if (up) { var d = CARDS[cid].up || {}; for (var k2 in d) out[k2] = (out[k2] || 0) + d[k2]; }
  return out;
}
function cardText(cid, up) {
  // 动态文本：把升级数值代入
  var c = CARDS[cid], e = cardEff(cid, up), parts = [];
  if (e.dmg) parts.push('造成' + e.dmg + '点伤害' + (e.hits > 1 ? e.hits + '次' : ''));
  if (e.block) parts.push('获得' + e.block + '点格挡');
  if (e.draw) parts.push('抽' + e.draw + '张牌');
  if (e.energy) parts.push('获得' + e.energy + '点能量');
  if (e.str) parts.push('获得' + e.str + '点力量');
  if (e.vuln) parts.push('施加' + e.vuln + '层易伤');
  if (e.weak) parts.push('施加' + e.weak + '层虚弱');
  if (e.heal) parts.push('回复' + e.heal + '点生命');
  if (e.gold) parts.push('获得' + e.gold + '金币');
  if (e.selfDmg) parts.push('受到' + e.selfDmg + '点伤害');
  if (e.exhaust) parts.push('耗尽');
  return parts.join('，') + '。';
}

/* ---------------- 遗物 ---------------- */
var RELICS = {
  // 低阶补偿池（标准/困难 AI 开局公开补偿，只能从此池抽取）
  low_coin:   { name: '幸运金币', tier: 'low',  text: '每场战斗胜利后，额外获得12金币。' },
  low_bandage:{ name: '旧绷带',   tier: 'low',  text: '每场战斗胜利后，回复4点生命。' },
  low_sword:  { name: '训练木剑', tier: 'low',  text: '每场战斗开始时，获得1点力量。' },
  low_charm:  { name: '骰子挂坠', tier: 'low',  text: '每次移动步数+1。' },
  // 中阶
  anchor:   { name: '船锚',     tier: 'mid', text: '每场战斗开始时，获得8点格挡。' },
  battery:  { name: '备用电池', tier: 'mid', text: '每场战斗的第一个回合，能量+1。' },
  scope:    { name: '狙击镜',   tier: 'mid', text: '每场战斗开始时，多抽1张牌。' },
  guild:    { name: '商会徽章', tier: 'mid', text: '商店所有价格降低25%。' },
  landlord: { name: '地契包',   tier: 'mid', text: '收取过路费时+50%。' },
  boots:    { name: '疾行长靴', tier: 'mid', text: '掷骰结果+1。' },
  magnet:   { name: '聚宝磁石', tier: 'mid', text: '战斗金币奖励+30%。' },
  meat:     { name: '风干肉',   tier: 'mid', text: '每次经过起点时，额外获得25金币。' },
  charm2:   { name: '护盾徽章', tier: 'mid', text: '每个回合开始时，获得2点格挡。' },
  edge:     { name: '开刃石',   tier: 'mid', text: '攻击牌伤害+1。' },
  bell:     { name: '诅咒之铃', tier: 'mid', text: '你造成的伤害+2，你受到的伤害+1。' },
  bomb:     { name: '源石炸弹', tier: 'mid', text: '每场战斗开始时，对敌人造成12点伤害。' },
  hourglass:{ name: '沙漏护符', tier: 'mid', text: '每回合第一次受到的伤害-3。' },
  dicebag:  { name: '骰子袋',   tier: 'mid', text: '每次经过起点时，获得一个随机骰具。' },
  warbanner:{ name: '讨伐战旗', tier: 'mid', text: '每场战斗开始时，敌方获得2层易伤。' },
  // 高阶（精英/宝箱/Boss）
  heart:    { name: '生命核心', tier: 'high', text: '获得时：最大生命+12，并回复12点生命。' },
  feather:  { name: '凤凰之羽', tier: 'high', text: '受到致命伤害时抵挡并回复50%生命（一次性，触发后消失）。' },
  crown:    { name: '讨伐王冠', tier: 'high', text: 'Boss战开始时，获得2点能量与12点格挡。' },
  bloodstone:{ name: '血源石',  tier: 'high', text: '每场战斗胜利后，回复8点生命。' },
  payday:   { name: '发薪徽章', tier: 'high', text: '每次经过/停留起点时，额外获得80金币。' },
};
var RELIC_POOL_LOW = ['low_coin', 'low_bandage', 'low_sword', 'low_charm'];
var RELIC_POOL_MID = ['anchor', 'battery', 'scope', 'guild', 'landlord', 'boots', 'magnet', 'meat', 'charm2', 'edge', 'bell', 'bomb', 'hourglass', 'dicebag', 'warbanner'];
var RELIC_POOL_HIGH = ['heart', 'feather', 'crown', 'bloodstone', 'payday'];

/* ---------------- 敌人 ----------------
 * moves: 循环行动；atk{dmg,times,vuln,weak} buff{block,str} 
 */
var ENEMIES_NORMAL = [
  { id: 'slug',   name: '源石虫', hp: [26, 32], gold: [25, 40], icon: '🐛',
    moves: [
      { t: 'atk', name: '撕咬', dmg: 7 },
      { t: 'buff', name: '硬化', block: 6 },
      { t: 'atk', name: '撕咬', dmg: 8 },
    ] },
  { id: 'thug',   name: '街头暴徒', hp: [30, 38], gold: [30, 45], icon: '🔨',
    moves: [
      { t: 'atk', name: '重拳', dmg: 9 },
      { t: 'buff', name: '挑衅', str: 2 },
      { t: 'atk', name: '连打', dmg: 4, times: 2 },
    ] },
  { id: 'caster', name: '荒野术师', hp: [24, 30], gold: [30, 45], icon: '🔮',
    moves: [
      { t: 'atk', name: '火球', dmg: 8, vuln: 1 },
      { t: 'buff', name: '冥想', block: 5, str: 1 },
      { t: 'atk', name: '爆裂火球', dmg: 10 },
    ] },
];
var ENEMIES_ELITE = [
  { id: 'crusher', name: '粉碎者', hp: [58, 68], gold: [80, 110], icon: '🦍',
    moves: [
      { t: 'atk', name: '碾压', dmg: 12 },
      { t: 'buff', name: '加固', block: 8, str: 2 },
      { t: 'atk', name: '横扫', dmg: 8, times: 2 },
    ] },
  { id: 'frost',   name: '冰霜术师', hp: [54, 64], gold: [80, 110], icon: '❄️',
    moves: [
      { t: 'atk', name: '冰锥', dmg: 10, weak: 1 },
      { t: 'atk', name: '暴风雪', dmg: 5, times: 3 },
      { t: 'buff', name: '冰盾', block: 10 },
    ] },
  { id: 'captain', name: '重装组长', hp: [62, 72], gold: [90, 120], icon: '🛡️',
    moves: [
      { t: 'atk', name: '盾猛', dmg: 10, vuln: 2 },
      { t: 'buff', name: '号令', str: 2 },
      { t: 'atk', name: '突进', dmg: 14 },
    ] },
];
/* 最终 Boss：两阶段。双方共用同一规则，强度随全局轮次成长（公开信息）。 */
var BOSS_DEF = {
  id: 'eclipse', name: '异变核心·蚀', icon: '👁️', gold: [200, 260],
  movesP1: [
    { t: 'atk', name: '侵蚀重锤', dmg: 14 },
    { t: 'atk', name: '异变脉冲', dmg: 10, vuln: 2 },
    { t: 'buff', name: '结晶硬化', block: 12, str: 2 },
    { t: 'atk', name: '横扫', dmg: 7, times: 2 },
  ],
  movesP2: [
    { t: 'atk', name: '终焉重锤', dmg: 18 },
    { t: 'atk', name: '脉冲风暴', dmg: 6, times: 3 },
    { t: 'buff', name: '吞噬成长', block: 18, str: 3 },
    { t: 'atk', name: '湮灭射线', dmg: 16, vuln: 1, weak: 1 },
  ],
};

/* ---------------- 事件 ----------------
 * effect 立即结算；choices 则由玩家/AI二选一（双方同一事件池，触发时才公开）。
 */
var EVENTS = [
  { id: 'evt_gold_found', name: '拾获钱包', icon: '👛', text: '你在路边捡到一个鼓鼓的钱包。', effect: { gold: 60 } },
  { id: 'evt_gold_lose',  name: '遭遇扒手', icon: '🥷', text: '一个黑影擦肩而过，你的钱包轻了。', effect: { gold: -40 } },
  { id: 'evt_heal',       name: '温泉',     icon: '♨️', text: '温热的泉水治愈了你的疲惫。', effect: { heal: 15 } },
  { id: 'evt_hurt',       name: '落石',     icon: '🪨', text: '山崖落石砸中了你！', effect: { hurt: 8 } },
  { id: 'evt_card',       name: '流浪剑客', icon: '🗡️', text: '流浪剑客欣赏你的勇气，传授了新的招式。', effect: { randomCard: 'common' } },
  { id: 'evt_dice',       name: '骰子小贩', icon: '🎲', text: '小贩送了你一颗神奇的骰子。', effect: { dice: 1 } },
  { id: 'evt_forward',    name: '顺风车',   icon: '🚚', text: '企鹅物流的顺风车载你前进3格！（触发落点）', effect: { jump: 3, trigger: true } },
  { id: 'evt_back',       name: '迷雾',     icon: '🌫️', text: '浓雾让你迷失方向，后退3格。', effect: { jump: -3, trigger: false } },
  { id: 'evt_merchant',   name: '神秘商人', icon: '🧙', text: '兜帽商人向你展示一件宝物。', choices: [
    { label: '花费80金币购买随机遗物', need: { gold: 80 }, effect: { pay: 80, relic: 'mid' } },
    { label: '离开', effect: {} },
  ] },
  { id: 'evt_shrine',     name: '古老祭坛', icon: '⛩️', text: '祭坛渴求祭品，也乐意赐福。', choices: [
    { label: '献祭10点生命，获得随机遗物', need: { hp: 11 }, effect: { hurt: 10, relic: 'mid' } },
    { label: '献祭50金币，回复15点生命', need: { gold: 50 }, effect: { pay: 50, heal: 15 } },
    { label: '离开', effect: {} },
  ] },
  { id: 'evt_gambler',    name: '赌徒',     icon: '🎰', text: '赌徒邀请你来一局，赢了翻三倍！', choices: [
    { label: '花费30金币赌一把（50%得90）', need: { gold: 30 }, effect: { gamble: { cost: 30, win: 90 } } },
    { label: '离开', effect: {} },
  ] },
  { id: 'evt_doctor',     name: '巡回医生', icon: '⚕️', text: '医生可以为你治疗伤势。', choices: [
    { label: '花费60金币回复25点生命', need: { gold: 60 }, effect: { pay: 60, heal: 25 } },
    { label: '离开', effect: {} },
  ] },
];

/* ---------------- 骰具 ---------------- */
var DICE_DEFS = {
  normal:  { name: '普通骰子', icon: '🎲', text: '掷出1~6点，步数即点数。', infinite: true },
  swift:   { name: '疾风骰',   icon: '🌪️', text: '消耗品：掷骰结果+2。' },
  precise: { name: '精准骰',   icon: '🎯', text: '消耗品：自选1~6点，精确移动。' },
  double:  { name: '双骰',     icon: '🎲🎲', text: '消耗品：掷两次骰子，步数为两次之和。' },
};

/* ---------------- 商店 ---------------- */
var SHOP = {
  cardPrice: { common: 50, uncommon: 80, rare: 150 },
  relicPrice: { mid: 170, high: 300, low: 60 },
  dicePrice: 40,
  removePrice: 80,
  upgradePrice: 100,
  healPrice: 50, healAmount: 25,
};

/* ---------------- 角色 ---------------- */
var CHARS = {
  player: { name: '星晓', title: '罗德岛见习干员', img: 'assets/player.png', color: '#ff7ab8', desc: '开朗的新人干员，为了证明自己参加了异变竞速。' },
  ai:     { name: '夜阑', title: '神秘的竞速对手', img: 'assets/rival.png',  color: '#4aa8ff', desc: '沉默寡言的天才少年，行动快如夜风。' },
};

var DIFFICULTY = {
  easy:     { name: '简单', aiNoise: 0.25, bossBravery: -25, bonusRelic: false, desc: 'AI 偶尔会犯错，且没有补偿遗物。适合新手。' },
  standard: { name: '标准', aiNoise: 0.0,  bossBravery: 0,   bonusRelic: true,  desc: 'AI 稳定决策，开局公开获得一个随机低阶遗物作为补偿。' },
  hard:     { name: '困难', aiNoise: 0.0,  bossBravery: 18,  combatSkill: true, bonusRelic: true, desc: 'AI 决策更激进、战斗更精细，开局同样公开获得低阶遗物补偿。' },
};

/* 供 node 测试导出（浏览器环境下 window 已有这些变量） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG: CONFIG, BOARD_NODES: BOARD_NODES, BOARD_NEXT: BOARD_NEXT, nodeById: nodeById, CARDS: CARDS, STARTER_DECK: STARTER_DECK, cardEff: cardEff, cardText: cardText, RELICS: RELICS, RELIC_POOL_LOW: RELIC_POOL_LOW, RELIC_POOL_MID: RELIC_POOL_MID, RELIC_POOL_HIGH: RELIC_POOL_HIGH, ENEMIES_NORMAL: ENEMIES_NORMAL, ENEMIES_ELITE: ENEMIES_ELITE, BOSS_DEF: BOSS_DEF, EVENTS: EVENTS, DICE_DEFS: DICE_DEFS, SHOP: SHOP, CHARS: CHARS, DIFFICULTY: DIFFICULTY };
}
