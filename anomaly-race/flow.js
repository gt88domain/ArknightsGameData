/* ============================================================
 * flow.js —— 落点结算后半：事件效果 / 休息 / 商店 / 招募 / Boss门
 * 依赖：data.js engine.js ui.js（浏览器环境）
 * ============================================================ */
'use strict';

/* ---- 事件效果结算（双方同一函数） ---- */
function applyEventEffect(id, ef, ctx, ev) {
  var ch = charOf(G, id);
  var msgs = [];
  function add(m) { msgs.push(m); logMsg('【' + CHARS[id].name + '】' + m); }
  if (!ef) return Promise.resolve(msgs);
  if (ef.gold) {
    if (ef.gold > 0) { addGold(G, ch, ef.gold); sfx('coin'); add('💰 获得' + ef.gold + '金币！'); }
    else { var lose = Math.min(ch.gold, -ef.gold); ch.gold -= lose; add('🥷 失去' + lose + '金币……'); }
  }
  if (ef.pay) { ch.gold -= ef.pay; sfx('coin'); add('💰 支付' + ef.pay + '金币。'); }
  if (ef.heal) { var h = healChar(ch, ef.heal); sfx('heal'); add('💚 回复' + h + '点生命！'); }
  if (ef.hurt) {
    var res = damageChar(G, ch, ef.hurt); sfx('hurt');
    add('🩸 受到' + ef.hurt + '点伤害！（剩余' + ch.hp + '）');
    if (res.revived) add('🔥 凤凰之羽碎裂，重生！');
    if (res.died) add('💀 ' + CHARS[id].name + '倒下了……');
  }
  if (ef.randomCard) {
    var cid = genCardChoices([80, 15, 5], 1)[0];
    ch.deck.push(newCardInst(cid, false));
    add('🗡️ 领悟新招式：【' + CARDS[cid].name + '】加入牌组！');
  }
  if (ef.dice) { var d = randomDice(G); ch.dice[d]++; add('🎲 获得骰具【' + DICE_DEFS[d].name + '】！'); }
  if (ef.relic) { var r = addRelic(G, ch, genRelic(G, 'mid')); sfx('relic'); add('✨ ' + r.msg); if (r.gold) addGold(G, ch, r.gold); }
  if (ef.gamble) {
    ch.gold -= ef.gamble.cost; sfx('coin');
    if (chance(G, 0.5)) { addGold(G, ch, ef.gamble.win); sfx('win'); add('🎰 大获全胜！赢得' + ef.gamble.win + '金币！'); }
    else add('🎰 赌输了……' + ef.gamble.cost + '金币打了水漂。');
  }
  renderAll();
  // 跳跃（顺风车/迷雾）
  if (ef.jump) {
    if (ef.jump > 0) {
      add('🚚 搭车前进' + ef.jump + '格！');
      return walkSteps(id, ef.jump, ctx).then(function (walkRes) {
        if (walkRes && walkRes.stopped) return msgs; // 途中挑战 Boss，已结算
        return resolveLanding(id, charOf(G, id).pos, ctx, (ctx._depth || 0) + 1).then(function () { return msgs; });
      });
    }
    add('🌫️ 在迷雾中后退' + (-ef.jump) + '格……');
    return walkBack(id, -ef.jump, ctx).then(function () { return msgs; });
  }
  return Promise.resolve(msgs);
}

/* ---- 休息 ---- */
function doRest(id, ctx) {
  var ch = charOf(G, id);
  if (ctx.auto) {
    var dec = aiRest(buildAIView(G, id));
    if (dec.act === 'heal') {
      var h = healChar(ch, 30); sfx('heal');
      return finishMsg(ctx, id, '💤 休息回复' + h + '点生命！（' + ch.hp + '/' + ch.maxhp + '）');
    }
    if (dec.act === 'remove') {
      for (var ri = 0; ri < ch.deck.length; ri++) {
        if (ch.deck[ri].uid === dec.uid) {
          var rname = CARDS[ch.deck[ri].cid].name;
          ch.deck.splice(ri, 1);
          sfx('click');
          return finishMsg(ctx, id, '🗑️ 特训删除卡牌【' + rname + '】！牌组更精炼了。');
        }
      }
    }
    var card = null;
    for (var i = 0; i < ch.deck.length; i++) if (ch.deck[i].uid === dec.uid) card = ch.deck[i];
    if (card) { card.up = true; return finishMsg(ctx, id, '💤 升级卡牌【' + CARDS[card.cid].name + '+】！'); }
    var h2 = healChar(ch, 30);
    return finishMsg(ctx, id, '💤 休息回复' + h2 + '点生命！');
  }
  var html = '<p>💤 好好睡一觉（回复30点生命，当前 ' + ch.hp + '/' + ch.maxhp + '），还是打磨牌组？（三选一）</p>' +
    '<div class="modal-btns" style="margin:6px 0"><button class="btn blue" id="rest-heal">💤 睡觉回血</button><button class="btn small" id="mode-up">升级模式</button><button class="btn small" id="mode-rm">特训删除模式</button></div>' +
    '<p id="rest-hint">可升级的卡牌（点击一张升级）：</p><div class="card-list pick" id="rest-ups">' +
    ch.deck.map(function (c) { return cardHTML(c.cid, c.up, ' data-uid="' + c.uid + '"'); }).join('') + '</div>';
  return new Promise(function (resolve) {
    modal({
      title: '💤 移动医疗站', html: html, wide: true, buttons: [],
      onMount: function (box) {
        box.querySelector('#rest-heal').onclick = function () {
          sfx('heal');
          var h = healChar(ch, 30);
          $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = '';
          toast('💤 回复' + h + '点生命！', 1800);
          resolve(finishMsg(ctx, id, '💤 休息回复' + h + '点生命！'));
        };
        var restMode = 'up';
        function refreshRestList() {
          box.querySelector('#rest-hint').textContent = restMode === 'up' ? '点击一张牌进行升级：' : '点击一张牌进行特训删除（免费）：';
          box.querySelectorAll('#rest-ups .card').forEach(function (el) {
            var uid = +el.getAttribute('data-uid');
            var cd = null;
            for (var i = 0; i < ch.deck.length; i++) if (ch.deck[i].uid === uid) cd = ch.deck[i];
            el.classList.remove('disabled');
            el.onclick = null;
            if (restMode === 'up' && cd.up) { el.classList.add('disabled'); return; }
            el.onclick = function () {
              $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = '';
              if (restMode === 'up') {
                sfx('card'); cd.up = true;
                toast('✨【' + CARDS[cd.cid].name + '+】升级成功！', 2000);
                resolve(finishMsg(ctx, id, '💤 升级卡牌【' + CARDS[cd.cid].name + '+】！'));
              } else {
                sfx('click');
                var di = ch.deck.indexOf(cd);
                if (di >= 0) ch.deck.splice(di, 1);
                toast('🗑️删除【' + CARDS[cd.cid].name + '】！牌组更精炼了。', 2000);
                resolve(finishMsg(ctx, id, '💤 特训删除卡牌【' + CARDS[cd.cid].name + '】！'));
              }
            };
          });
        }
        box.querySelector('#mode-up').onclick = function () { sfx('click'); restMode = 'up'; refreshRestList(); };
        box.querySelector('#mode-rm').onclick = function () { sfx('click'); restMode = 'rm'; refreshRestList(); };
        refreshRestList();
      }
    });
  });
}

/* ---- 商店 ---- */
function doShop(id, ctx) {
  var ch = charOf(G, id);
  var stock = genShopStock(G);
  logMsg('【' + CHARS[id].name + '】🛒 进入黑市', 'land');
  if (ctx.auto) {
    // AI：按策略连续购买（同一价格规则），最后汇总
    var bought = [];
    for (var step = 0; step < 12; step++) {
      var canHeal = ch.hp < ch.maxhp;
      var act = aiShopNext(buildAIView(G, id), stock, { canHeal: canHeal });
      if (act.a === 'leave') break;
      if (act.a === 'relic' && stock.relic) {
        var rp = shopPrice(G, ch, RELICS[stock.relic].tier === 'high' ? SHOP.relicPrice.high : SHOP.relicPrice.mid);
        if (ch.gold < rp) break;
        ch.gold -= rp;
        var r = addRelic(G, ch, stock.relic);
        bought.push('遗物【' + RELICS[stock.relic].name + '】(' + rp + 'G)');
        if (r.gold) addGold(G, ch, r.gold);
        stock.relic = null;
      } else if (act.a === 'card' && stock.cards[act.i] != null) {
        var cid = stock.cards[act.i];
        var cp = shopPrice(G, ch, SHOP.cardPrice[CARDS[cid].rarity]);
        if (ch.gold < cp) break;
        ch.gold -= cp; ch.deck.push(newCardInst(cid, false));
        bought.push('卡牌【' + CARDS[cid].name + '】(' + cp + 'G)');
        stock.cards[act.i] = null;
      } else if (act.a === 'upgrade') {
        var upg = shopPrice(G, ch, SHOP.upgradePrice);
        var uc = null;
        for (var u = 0; u < ch.deck.length; u++) if (ch.deck[u].uid === act.uid) uc = ch.deck[u];
        if (!uc || uc.up || ch.gold < upg) break;
        ch.gold -= upg; uc.up = true;
        bought.push('升级【' + CARDS[uc.cid].name + '+】(' + upg + 'G)');
      } else if (act.a === 'dice' && stock.dice) {
        var dp = shopPrice(G, ch, SHOP.dicePrice);
        if (ch.gold < dp) break;
        ch.gold -= dp; ch.dice[stock.dice]++;
        bought.push('骰具【' + DICE_DEFS[stock.dice].name + '】(' + dp + 'G)');
        stock.dice = null;
      } else if (act.a === 'heal') {
        var hp = shopPrice(G, ch, SHOP.healPrice);
        if (ch.gold < hp || ch.hp >= ch.maxhp) break;
        ch.gold -= hp; var h = healChar(ch, SHOP.healAmount);
        bought.push('治疗+' + h + '(' + hp + 'G)');
      } else if (act.a === 'remove') {
        var mp = shopPrice(G, ch, SHOP.removePrice);
        if (ch.gold < mp) break;
        var di = -1;
        for (var i = 0; i < ch.deck.length; i++) if (ch.deck[i].uid === act.uid) di = i;
        if (di < 0) break;
        ch.gold -= mp;
        bought.push('删除【' + CARDS[ch.deck[di].cid].name + '】(' + mp + 'G)');
        ch.deck.splice(di, 1);
      } else break;
    }
    renderAll();
    return finishMsg(ctx, id, bought.length ? '🛒 黑市购物：' + bought.join('、') + '。' : '🛒 逛了逛黑市，什么也没买。');
  }
  // 玩家：交互式商店
  return new Promise(function (resolve) {
    function render() {
      var html = '<p class="shop-gold">💰 当前金币：' + ch.gold + '（❤️ ' + ch.hp + '/' + ch.maxhp + '）</p>';
      html += '<div class="shop-sec"><h4>🃏 卡牌</h4><div class="shop-items">';
      stock.cards.forEach(function (cid, i) {
        if (cid == null) { html += '<div class="shop-item sold">已售出</div>'; return; }
        var p = shopPrice(G, ch, SHOP.cardPrice[CARDS[cid].rarity]);
        html += '<div class="shop-item">' + cardHTML(cid, false) + '<button class="btn small" data-buy-card="' + i + '" ' + (ch.gold < p ? 'disabled' : '') + '>购买 ' + p + 'G</button></div>';
      });
      html += '</div></div><div class="shop-sec"><h4>✨ 遗物 & 🎲 骰具 & 🛠️ 服务</h4><div class="shop-items">';
      if (stock.relic) {
        var rp = shopPrice(G, ch, RELICS[stock.relic].tier === 'high' ? SHOP.relicPrice.high : SHOP.relicPrice.mid);
        var owned = hasRelic(ch, stock.relic);
        html += '<div class="shop-item"><div>✨【' + RELICS[stock.relic].name + '】<br><small>' + RELICS[stock.relic].text + '</small></div><button class="btn small" data-buy-relic="1" ' + ((ch.gold < rp || owned) ? 'disabled' : '') + '>' + (owned ? '已拥有' : '购买 ' + rp + 'G') + '</button></div>';
      } else html += '<div class="shop-item sold">遗物已售出</div>';
      if (stock.dice) {
        var dp = shopPrice(G, ch, SHOP.dicePrice);
        html += '<div class="shop-item"><div>🎲【' + DICE_DEFS[stock.dice].name + '】<br><small>' + DICE_DEFS[stock.dice].text + '</small></div><button class="btn small" data-buy-dice="1" ' + (ch.gold < dp ? 'disabled' : '') + '>购买 ' + dp + 'G</button></div>';
      } else html += '<div class="shop-item sold">骰具已售出</div>';
      var hp2 = shopPrice(G, ch, SHOP.healPrice);
      html += '<div class="shop-item"><div>💚 治疗 +' + SHOP.healAmount + '</div><button class="btn small" data-buy-heal="1" ' + ((ch.gold < hp2 || ch.hp >= ch.maxhp) ? 'disabled' : '') + '>购买 ' + hp2 + 'G</button></div>';
      var mp2 = shopPrice(G, ch, SHOP.removePrice);
      html += '<div class="shop-item"><div>🗑️ 删除一张牌</div><button class="btn small" data-buy-remove="1" ' + (ch.gold < mp2 ? 'disabled' : '') + '>购买 ' + mp2 + 'G</button></div>';
      var up3 = shopPrice(G, ch, SHOP.upgradePrice);
      html += '<div class="shop-item"><div>⬆️ 升级一张牌</div><button class="btn small" data-buy-upgrade="1" ' + (ch.gold < up3 ? 'disabled' : '') + '>购买 ' + up3 + 'G</button></div>';
      html += '</div></div>';
      modal({
        title: '🛒 黑市', html: html, wide: true,
        buttons: [{ label: '离开商店', value: 'leave', cls: 'primary' }],
        onMount: function (box) {
          box.querySelectorAll('[data-buy-card]').forEach(function (b) {
            b.onclick = function () {
              var i = +b.getAttribute('data-buy-card'), cid = stock.cards[i];
              var p = shopPrice(G, ch, SHOP.cardPrice[CARDS[cid].rarity]);
              ch.gold -= p; ch.deck.push(newCardInst(cid, false)); stock.cards[i] = null;
              sfx('card'); toast('🃏 获得【' + CARDS[cid].name + '】！', 1600);
              logMsg('【' + CHARS[id].name + '】🛒 购买卡牌【' + CARDS[cid].name + '】(-' + p + 'G)');
              render();
            };
          });
          var br = box.querySelector('[data-buy-relic]');
          if (br) br.onclick = function () {
            var cid = stock.relic;
            var p = shopPrice(G, ch, RELICS[cid].tier === 'high' ? SHOP.relicPrice.high : SHOP.relicPrice.mid);
            ch.gold -= p;
            var r = addRelic(G, ch, cid);
            if (r.gold) addGold(G, ch, r.gold);
            stock.relic = null; sfx('relic');
            toast('✨ ' + r.msg, 2000);
            logMsg('【' + CHARS[id].name + '】🛒 购买' + r.msg + '(-' + p + 'G)');
            render();
          };
          var bd = box.querySelector('[data-buy-dice]');
          if (bd) bd.onclick = function () {
            var p = shopPrice(G, ch, SHOP.dicePrice);
            ch.gold -= p; ch.dice[stock.dice]++;
            toast('🎲 获得【' + DICE_DEFS[stock.dice].name + '】！', 1600);
            logMsg('【' + CHARS[id].name + '】🛒 购买骰具【' + DICE_DEFS[stock.dice].name + '】(-' + p + 'G)');
            stock.dice = null; sfx('coin'); render();
          };
          var bh = box.querySelector('[data-buy-heal]');
          if (bh) bh.onclick = function () {
            var p = shopPrice(G, ch, SHOP.healPrice);
            ch.gold -= p; var h = healChar(ch, SHOP.healAmount);
            toast('💚 回复' + h + '点生命！', 1600); sfx('heal');
            render();
          };
          var bm = box.querySelector('[data-buy-remove]');
          if (bm) bm.onclick = function () {
            var p = shopPrice(G, ch, SHOP.removePrice);
            var html2 = '<p>选择一张牌删除（-' + p + 'G）：</p><div class="card-list pick" id="rm-list">' +
              ch.deck.map(function (c) { return cardHTML(c.cid, c.up, ' data-uid="' + c.uid + '"'); }).join('') + '</div>';
            modal({
              title: '🗑️ 删除卡牌', html: html2, wide: true, buttons: [{ label: '取消', value: -1 }],
              onMount: function (box2) {
                box2.querySelectorAll('#rm-list .card').forEach(function (el) {
                  el.onclick = function () {
                    var uid = +el.getAttribute('data-uid');
                    var di = -1;
                    for (var i = 0; i < ch.deck.length; i++) if (ch.deck[i].uid === uid) di = i;
                    ch.gold -= p;
                    toast('🗑️ 删除【' + CARDS[ch.deck[di].cid].name + '】', 1600);
                    logMsg('【' + CHARS[id].name + '】🛒 删除卡牌【' + CARDS[ch.deck[di].cid].name + '】(-' + p + 'G)');
                    ch.deck.splice(di, 1); sfx('click');
                    render();
                  };
                });
              }
            }).then(function (v) { if (v === -1) render(); });
          };
          var bu = box.querySelector('[data-buy-upgrade]');
          if (bu) bu.onclick = function () {
            var p = shopPrice(G, ch, SHOP.upgradePrice);
            var html2 = '<p>选择一张牌升级（-' + p + 'G）：</p><div class="card-list pick" id="up-list">' +
              ch.deck.map(function (c) { return cardHTML(c.cid, c.up, ' data-uid="' + c.uid + '"'); }).join('') + '</div>';
            modal({
              title: '⬆️ 升级卡牌', html: html2, wide: true, buttons: [{ label: '取消', value: -1 }],
              onMount: function (box2) {
                box2.querySelectorAll('#up-list .card').forEach(function (el) {
                  var uid = +el.getAttribute('data-uid');
                  var cd = null;
                  for (var i = 0; i < ch.deck.length; i++) if (ch.deck[i].uid === uid) cd = ch.deck[i];
                  if (cd.up) el.classList.add('disabled');
                  else el.onclick = function () {
                    ch.gold -= p; cd.up = true;
                    toast('✨【' + CARDS[cd.cid].name + '+】升级成功！', 1600);
                    logMsg('【' + CHARS[id].name + '】🛒 升级卡牌【' + CARDS[cd.cid].name + '+】(-' + p + 'G)');
                    sfx('card');
                    render();
                  };
                });
              }
            }).then(function (v) { if (v === -1) render(); });
          };
        }
      }).then(function (v) {
        if (v === 'leave') { renderAll(); resolve(finishMsg(ctx, id, '🛒 离开黑市。')); }
        // render() 内重新打开 modal 时，旧 promise 会悬空——但旧 modal DOM 已被替换，无影响
      });
    }
    render();
  });
}

/* ---- 招募 / 战后三选一 ---- */
function doDraft(id, weights, title, ctx) {
  var ch = charOf(G, id);
  // 奖励在此时才生成并揭示（AI 与玩家同时看到，不存在预知）
  var options = genCardChoices(G, weights, 3, ch.deck);
  if (ctx.auto) {
    var idx = aiDraft(buildAIView(G, id), options);
    if (idx < 0) return finishMsg(ctx, id, '🃏 卡牌三选一（' + options.map(function (c) { return CARDS[c].name; }).join('、') + '）：跳过。');
    ch.deck.push(newCardInst(options[idx], false));
    return finishMsg(ctx, id, '🃏 卡牌三选一：选择【' + CARDS[options[idx]].name + '】！');
  }
  var ds = deckStats(ch.deck);
  var atkR = ds.atkDmg / Math.max(1, ch.deck.length * 8);
  var blkR = ds.block / Math.max(1, ch.deck.length * 4);
  var pity = (ds.block < ch.deck.length * 4 && blkR <= atkR) ? '🛡️ 防御' : ((ds.atkDmg < ch.deck.length * 6 && atkR < blkR) ? '⚔️ 攻击' : null);
  var html = '<p>当前牌组（' + ch.deck.length + '张）：⚔️攻击总伤' + ds.atkDmg + ' · 🛡️格挡' + ds.block + '（建议攻守兼备）' + (pity ? '<br>' + pity + '保底生效：本次三选一必含一张' + pity.slice(0, 2) + '牌（双方同规则）。' : '') + '</p>' +
    '<div class="card-list pick" id="draft-list">' +
    options.map(function (cid, i) { return cardHTML(cid, false, ' data-i="' + i + '"'); }).join('') + '</div>';
  return new Promise(function (resolve) {
    modal({
      title: title, html: html, wide: true, buttons: [{ label: '跳过', value: -1 }],
      onMount: function (box) {
        box.querySelectorAll('#draft-list .card').forEach(function (el) {
          el.onclick = function () {
            var i = +el.getAttribute('data-i');
            ch.deck.push(newCardInst(options[i], false));
            sfx('card');
            $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = '';
            toast('🃏 获得【' + CARDS[options[i]].name + '】！', 1800);
            resolve(finishMsg(ctx, id, '🃏 卡牌三选一：选择【' + CARDS[options[i]].name + '】！'));
          };
        });
      }
    }).then(function (v) {
      if (v === -1) resolve(finishMsg(ctx, id, '🃏 跳过本次选牌。'));
    });
  });
}

/* ---- 精英格：挑战 / 绕行（双方同一规则） ---- */
function doEliteTile(id, nodeId, ctx) {
  var ch = charOf(G, id);
  // 侦察：先揭示敌人（消耗一次公开随机，双方相同），再做决策
  var enemy = makeEnemy(G, pick(G, ENEMIES_ELITE));
  logMsg('【' + CHARS[id].name + '】💀 遭遇精英：' + enemy.icon + ' ' + enemy.name + '（HP ' + enemy.hp + '）', 'land');
  var go = function () { return doCombat(id, enemy, 'elite', ctx); };
  if (ctx.auto) {
    if (aiEliteChallenge(buildAIView(G, id), randFn)) {
      ctx.collect.push('💀 遭遇精英【' + enemy.name + '】，迎战！');
      return go();
    }
    if (ch.gold >= CONFIG.eliteBypassCost) {
      ch.gold -= CONFIG.eliteBypassCost;
      return finishMsg(ctx, id, '💀 遭遇精英【' + enemy.name + '】，花费' + CONFIG.eliteBypassCost + '金币绕行。');
    }
    ctx.collect.push('💀 遭遇精英【' + enemy.name + '】，金币不足，只能迎战！');
    return go();
  }
  var html = '<div class="sum">💀 <b>' + enemy.icon + ' ' + enemy.name + '</b>（侦察）<br>生命 ' + enemy.hp +
    ' · 精英奖励更丰厚（稀有牌概率↑、55%遗物），但也更危险。<br>你的状态：❤️ ' + ch.hp + '/' + ch.maxhp + ' · 💰' + ch.gold + '</div>';
  return modal({
    title: '💀 精英遭遇', html: html,
    buttons: [
      { label: '⚔️ 迎战！', value: 'go', cls: 'danger' },
      { label: '💨 绕行（' + CONFIG.eliteBypassCost + 'G）', value: 'no', cls: 'blue', disabled: ch.gold < CONFIG.eliteBypassCost },
    ],
  }).then(function (v) {
    if (v === 'go') return go();
    ch.gold -= CONFIG.eliteBypassCost;
    sfx('coin');
    return finishMsg(ctx, id, '💀 花费' + CONFIG.eliteBypassCost + '金币绕过精英【' + enemy.name + '】。');
  });
}

/* ---- Boss 门 ---- */
function doBossTile(id, ctx) {
  var ch = charOf(G, id);
  var bp = bossPreview(G);
  logMsg('【' + CHARS[id].name + '】👁️ 抵达异变核心！（Boss HP ' + bp.hp + '，伤害 +' + bp.dmgBonus + '）', 'land');
  if (G.round < CONFIG.bossChallengeRound) {
    addGold(G, ch, 30); sfx('coin');
    var early = '👁️ 异变核心尚未成型（第' + CONFIG.bossChallengeRound + '轮后可挑战），领取调查经费30金币。';
    if (!ctx.auto) toast(early, 2200);
    return finishMsg(ctx, id, early);
  }
  if (ctx.auto) {
    // AI 按公开信息评估是否挑战（评估理由公开）
    var eva = aiBossChallenge(buildAIView(G, id));
    if (eva.go) {
      ctx.collect.push('👁️ 评估（' + eva.why + '），挑战最终 Boss！');
      return doCombat(id, makeBoss(G), 'boss', ctx);
    }
    return finishMsg(ctx, id, '👁️ 评估战力不足（' + eva.why + '），暂避锋芒，继续发育。');
  }
  sfx('boss');
  var ds = deckStats(ch.deck);
  var html = '<div class="sum">👁️ <b>异变核心·蚀</b>（公开侦察）<br>' +
    '生命 ' + bp.hp + ' · 伤害加成 +' + bp.dmgBonus + ' · 50%生命进入狂暴第二阶段<br>' +
    '你的状态：❤️ ' + ch.hp + '/' + ch.maxhp + ' · 攻击牌' + ds.atk + '张（总伤' + ds.atkDmg + '）· 格挡' + ds.block + ' · 遗物' + ch.relics.length + '件</div>' +
    '<p>击败它即赢得竞速！战败则死亡' + (id === 'player' ? '（= 竞速失败）' : '（= 出局）') + '。要现在挑战吗？</p>';
  return modal({
    title: '👁️ 最终 Boss：异变核心·蚀', html: html,
    buttons: [
      { label: '⚔️ 挑战！', value: 'go', cls: 'danger' },
      { label: '🛡️ 暂避锋芒', value: 'no', cls: 'blue' },
    ],
  }).then(function (v) {
    if (v === 'go') {
      logMsg('【' + CHARS[id].name + '】⚔️ 向异变核心发起挑战！', 'sys');
      return doCombat(id, makeBoss(G), 'boss', ctx);
    }
    return finishMsg(ctx, id, '👁️ 暂避锋芒，继续发育。');
  });
}

/* 经过黑市时的进店询问（进店前看不到进货，双方一致盲选） */
function askShopPassThrough(id, ctx) {
  var ch = charOf(G, id);
  if (ctx.auto) {
    if (ch.gold >= 120) {
      ctx.collect.push('🛒 经过黑市，进店逛逛（' + ch.gold + '金币）。');
      return doShop(id, ctx);
    }
    ctx.collect.push('🛒 经过黑市（囊中羞涩，直接离开）。');
    return D(300);
  }
  return modal({
    title: '🛒 经过黑市',
    html: '<p>路过黑市（你有 ' + ch.gold + ' 金币），要进去逛逛吗？进店后才能看到今日进货。</p>',
    buttons: [
      { label: '🛒 进店逛逛', value: 'go', cls: 'primary' },
      { label: '🏃 直接离开', value: 'no' },
    ],
  }).then(function (v) {
    if (v === 'go') return doShop(id, ctx);
  });
}
