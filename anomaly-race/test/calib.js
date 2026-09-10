/* Boss 战校准：不同强度牌组 vs 各轮次 Boss，测真实胜率。
 * 运行：node test/calib.js
 */
'use strict';
var D = require('../data.js');
Object.assign(global, D);
var E = require('../engine.js');
Object.assign(global, E);

function fightOnce(G, id, round) {
  G.round = round;
  var ch = charOf(G, id);
  ch.hp = ch.maxhp;
  var C = createCombat(G, id, makeBoss(G), {});
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
  return { win: C.over === 'win', turns: C.turn, heroHp: ch.hp, bossHpLeft: C.enemy.hp };
}

function buildDeck(list) {
  return list.map(function (c) { return newCardInst(c, false); });
}
var STARTER = ['strike', 'strike', 'strike', 'strike', 'defend', 'defend', 'defend', 'defend', 'spark', 'guard'];
var DECKS = {
  W1_early: STARTER.concat(['ironwall', 'heavy', 'slash2']),
  M1_mid: STARTER.concat(['ironwall', 'heavy', 'slash2', 'dawn', 'stonewall', 'dance', 'pierce']),
  S1_late: STARTER.concat(['ironwall', 'heavy', 'slash2', 'dawn', 'stonewall', 'dance', 'pierce', 'infinity', 'meteor', 'charge', 'absolute', 'bandage']),
  Glass: STARTER.concat(['heavy', 'dawn', 'dance', 'meteor', 'infinity', 'slash2', 'pierce', 'charge', 'overdrive']),
  Turtle: STARTER.concat(['ironwall', 'stonewall', 'dodge', 'taunt', 'absolute', 'warcry', 'bandage', 'judgment', 'guard']),
};
var RELICS_BY_DECK = { W1_early: ['low_sword'], M1_mid: ['low_sword', 'anchor'], S1_late: ['low_sword', 'anchor', 'hourglass'], Glass: ['edge'], Turtle: ['anchor', 'charm2'] };

Object.keys(DECKS).forEach(function (dn) {
  [6, 10, 14].forEach(function (round) {
    var G = newGame('calib-' + dn + '-' + round, 'standard');
    var ch = charOf(G, 'ai');
    ch.deck = buildDeck(DECKS[dn]);
    ch.maxhp = 76 + 3 * 2; ch.hp = ch.maxhp;
    ch.relics = ['low_charm'].concat(RELICS_BY_DECK[dn]);
    var ds = deckStats(ch.deck);
    var wins = 0, turns = 0, bossLeft = 0, N = 25;
    for (var i = 0; i < N; i++) {
      var r = fightOnce(G, 'ai', round);
      if (r.win) wins++;
      turns += r.turns;
      if (!r.win) bossLeft += r.bossHpLeft;
    }
    var bp = bossPreview(G);
    G.round = round;
    var dec = aiBossChallenge(buildAIView(G, 'ai'));
    console.log(dn + ' R' + round + ' decide=' + dec.go + '(' + dec.why + ')', '||', dn + ' R' + round + ' (atk' + ds.atkDmg + '/blk' + ds.block + '/' + ch.deck.length + 'c vs bossHP' + bp.hp + '/dmg+' + bp.dmgBonus + '): win ' + wins + '/' + N + ' avgTurns ' + (turns / N).toFixed(1) + (wins < N ? ' avgBossLeft ' + Math.round(bossLeft / (N - wins)) : ''));
  });
});
