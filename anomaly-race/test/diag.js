/* 战斗诊断：初始牌组 vs 普通敌人，统计回合数与承伤 */
'use strict';
var D = require('../data.js');
Object.assign(global, D);
var E = require('../engine.js');
Object.assign(global, E);

['standard', 'hard'].forEach(function (diff) {
  var G = newGame('diag-' + diff, diff);
  var tot = { turns: 0, dmg: 0, n: 0, lost: 0 };
  ENEMIES_NORMAL.forEach(function (def) {
    for (var i = 0; i < 20; i++) {
      var ch = charOf(G, 'ai'); ch.hp = ch.maxhp;
      var C = createCombat(G, 'ai', makeEnemy(G, def), {});
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
      finishCombat(G, C);
      tot.turns += C.turn; tot.dmg += (ch.maxhp - ch.hp); tot.n++;
      if (C.over === 'lose') tot.lost++;
    }
  });
  console.log(diff, 'avgTurns=' + (tot.turns / tot.n).toFixed(1), 'avgDmg=' + (tot.dmg / tot.n).toFixed(1), 'lost=' + tot.lost + '/' + tot.n);
});
