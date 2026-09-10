/* ============================================================
 * combat.js —— 卡牌战斗界面
 * 玩家：交互式打牌；AI/演示：同一规则引擎快速结算 + 简短摘要。
 * ============================================================ */
'use strict';

/* ---- 战斗入口（双方同一函数） ---- */
function doCombat(id, enemy, kind, ctx) {
  var ch = charOf(G, id);
  var hpBefore = ch.hp;
  logMsg('【' + CHARS[id].name + '】⚔️ 进入战斗：' + enemy.icon + ' ' + enemy.name + '（HP ' + enemy.hp + '）' + (kind === 'boss' ? '【最终Boss】' : kind === 'elite' ? '【精英】' : ''), 'land');
  var C = createCombat(G, charOf(G, id).id, enemy, {});

  // AI 回合的战斗：快速结算，只显示摘要
  if (ctx.auto && id === 'ai') return doCombatFast(id, C, kind, ctx, hpBefore);

  // 玩家战斗（演示模式下强制自动）
  var overlay = $('#combat-overlay');
  overlay.classList.remove('hidden');
  var savedAuto = UI.autoBattle;
  if (ctx.auto) UI.autoBattle = true;
  if (kind === 'boss') sfx('boss');
  return combatPlayerAction(C, id).then(function () {
    UI.autoBattle = ctx.auto ? savedAuto : UI.autoBattle;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    var res = finishCombat(G, C);
    ch = charOf(G, id);
    renderAll();
    if (!res.win) {
      logMsg('【' + CHARS[id].name + '】💀 战斗失败，倒下了……', 'bad');
      sfx('lose');
      return combatDefeat(id, ctx);
    }
    sfx('win');
    if (kind === 'boss') {
      // 击败最终 Boss：直接决定竞速胜负
      if (id === 'player') { G.over = { result: 'win', reason: '星晓击败了异变核心·蚀，成功解决异变，赢得竞速！' }; }
      else { G.over = { result: 'lose', reason: '夜阑先一步击败了异变核心·蚀……竞速失败。' }; }
      logMsg('【' + CHARS[id].name + '】🏆 击败了最终 Boss！', 'good');
      ctx.collect.push('🏆 击败最终 Boss！');
      renderAll();
      return Promise.resolve();
    }
    ch.stats.kills++;
    if (kind === 'elite') ch.stats.elites++;
    var msg = '🏆 战斗胜利！失去' + (hpBefore - ch.hp) + '点生命，获得' + res.gold + '金币' + (res.rest ? '，休整回复' + res.rest + '点生命' : '') + '！';
    logMsg('【' + CHARS[id].name + '】' + msg, 'good');
    ctx.collect.push(msg);
    if (!ctx.auto) toast(msg, 2200);
    // 战后奖励：卡牌三选一 + 遗物抽取
    var weights = kind === 'elite' ? [25, 45, 30] : [55, 35, 10];
    return doDraft(id, weights, '🏆 战斗胜利：卡牌三选一（+ ' + res.gold + 'G）', ctx).then(function () {
      var rp = kind === 'elite' ? CONFIG.relicDropElite : CONFIG.relicDropNormal;
      if (chance(G, rp)) {
        var tier = (kind === 'elite' && chance(G, 0.3)) ? 'high' : 'mid';
        var r = addRelic(G, ch, genRelic(G, tier));
        if (r.gold) addGold(G, ch, r.gold);
        sfx('relic');
        logMsg('【' + CHARS[id].name + '】✨ ' + r.msg, 'good');
        ctx.collect.push('✨ ' + r.msg);
        if (!ctx.auto) toast('✨ ' + r.msg, 2400);
      }
      renderAll();
    });
  });
}

function combatDefeat(id, ctx) {
  ctx.collect.push('💀 战斗失败，倒下了……');
  renderAll();
  if (!ctx.auto) {
    var txt = id === 'player'
      ? '星晓倒在了讨伐途中……<br>生命归零，竞速失败。'
      : '夜阑倒在了讨伐途中，退出了竞速。<br>但你仍须击败最终 Boss 才能完成异变！';
    return modal({ title: '💀 战斗失败', html: '<p>' + txt + '</p>', buttons: [{ label: '继续', value: 1, cls: 'primary' }] });
  }
  return Promise.resolve();
}

/* ---- AI 战斗：同一规则快速结算 + 简短摘要 ---- */
function doCombatFast(id, C, kind, ctx, hpBefore) {
  var overlay = $('#combat-overlay');
  overlay.classList.remove('hidden');
  if (!(UI.skipAI && UI.inAITurn)) {
    overlay.innerHTML = '<div class="ai-battle-box"><div class="spinner">🌀</div><h3>' + CHARS[id].name + ' 战斗结算中…</h3><p>' + C.enemy.icon + ' ' + C.enemy.name + '（HP ' + C.enemy.hp + '）</p></div>';
  }
  var run = function () {
    var guard = 0;
    while (!C.over && guard++ < 800) {
      var cv = buildCombatView(C);
      var act = aiCombat(buildAIView(G, id), cv, randFn);
      if (act.a === 'end') endHeroTurn(G, C);
      else {
        var idx = -1;
        for (var i = 0; i < C.hand.length; i++) if (C.hand[i].uid === act.uid) idx = i;
        if (idx < 0) endHeroTurn(G, C);
        else playCard(G, C, idx);
      }
    }
    var res = finishCombat(G, C);
    var ch = charOf(G, id);
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    renderAll();
    if (!res.win) {
      sfx('lose');
      var msg = '⚔️ 战斗：' + C.enemy.icon + C.enemy.name + '（' + C.turn + '回合）—— 战败，' + CHARS[id].name + '倒下了……';
      logMsg('【' + CHARS[id].name + '】' + msg, 'bad');
      ctx.collect.push(msg);
      return Promise.resolve();
    }
    sfx('win');
    if (kind === 'boss') {
      G.over = { result: 'lose', reason: '夜阑先一步击败了异变核心·蚀……竞速失败。' };
      logMsg('【夜阑】🏆 击败了最终 Boss！', 'bad');
      ctx.collect.push('🏆 夜阑击败了最终 Boss！');
      renderAll();
      return Promise.resolve();
    }
    ch.stats.kills++;
    if (kind === 'elite') ch.stats.elites++;
    // 战后奖励（与玩家同一概率，奖励揭示后 AI 再选）
    var weights = kind === 'elite' ? [25, 45, 30] : [55, 35, 10];
    var options = genCardChoices(G, weights, 3, ch.deck);
    var di = aiDraft(buildAIView(G, id), options);
    var cardMsg = '跳过';
    if (di >= 0) { ch.deck.push(newCardInst(options[di], false)); cardMsg = '【' + CARDS[options[di]].name + '】'; }
    var relicMsg = '无';
    var rp = kind === 'elite' ? CONFIG.relicDropElite : CONFIG.relicDropNormal;
    if (chance(G, rp)) {
      var tier = (kind === 'elite' && chance(G, 0.3)) ? 'high' : 'mid';
      var r = addRelic(G, ch, genRelic(G, tier));
      if (r.gold) addGold(G, ch, r.gold);
      relicMsg = r.msg;
    }
    var sum = '⚔️ 战斗：' + C.enemy.icon + C.enemy.name + '（' + C.turn + '回合）—— 失去' + (hpBefore - ch.hp) + '生命，+' + res.gold + '金币，选牌' + cardMsg + '，遗物' + relicMsg + (res.rest ? '，休整+' + res.rest : '') + '。';
    logMsg('【' + CHARS[id].name + '】' + sum, 'good');
    ctx.collect.push(sum);
    renderAll();
    // 摘要弹窗（可跳过/自动关闭）
    if (UI.skipAI && UI.inAITurn) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function fin() { if (!done) { done = true; resolve(); } }
      modal({
        title: '⚔️ ' + CHARS[id].name + ' 战斗摘要', buttons: [{ label: '继续', value: 1, cls: 'primary' }],
        html: '<div class="sum">👹 敌人：' + C.enemy.icon + ' ' + C.enemy.name + '（' + C.turn + '回合）<br>' +
          '🩸 失去生命：' + (hpBefore - ch.hp) + '<br>💰 获得金币：' + res.gold +
          '<br>🃏 选择卡牌：' + cardMsg + '<br>✨ 获得遗物：' + relicMsg + '</div><p style="color:#8f86ad;font-size:12px">（AI 战斗使用与你完全相同的规则快速结算）</p>',
      }).then(fin);
      setTimeout(function () { if (!done) { $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = ''; fin(); } }, 3200);
    });
  };
  if (UI.skipAI && UI.inAITurn) return run();
  return D(900).then(run);
}

/* ---- 交互式战斗渲染 ---- */
function flushClog(C, evs) {
  (C.log.splice(0).concat(evs)).forEach(function (m) {
    var box = $('#c-log');
    if (!box) return;
    var div = document.createElement('div');
    div.textContent = m;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  });
}
function syncCombatToChar(G, C) { charOf(G, C.heroId).hp = Math.max(0, C.hero.hp); }

function renderCombatInt(C, id) {
  var overlay = $('#combat-overlay');
  var cv = buildCombatView(C);
  var info = CHARS[id];
  var it = cv.intent;
  var intentTxt = it.t === 'atk' ? '🎯 意图：' + it.name + '（' + it.per + '×' + it.times + ' = ' + it.total + '）' : '🎯 意图：' + it.name + '（增益）';
  var e = cv.enemy;
  var eHpPct = Math.max(0, Math.round(e.hp / e.maxhp * 100));
  var hHpPct = Math.max(0, Math.round(cv.hp / cv.maxhp * 100));
  var enemyFace = C.enemy.isBoss ? '<img src="assets/boss.png">' : '<div class="enemy-icon">' + C.enemy.icon + '</div>';
  var html = '<div class="combat-field"><div class="combat-top">' +
    (C.enemy.isBoss ? '👁️ 最终 Boss 战：第 ' + cv.turn + ' 回合' : '⚔️ 战斗：第 ' + cv.turn + ' 回合 · ' + (C._kindLabel || '')) + '</div>' +
    '<div class="enemy-card' + (C.enemy.isBoss ? ' boss' : '') + '">' + enemyFace +
    '<div class="enemy-info"><div class="enemy-name">' + C.enemy.icon + ' ' + C.enemy.name + (e.phase === 2 ? '【狂暴】' : '') + '</div>' +
    '<div class="hpbar"><div class="hpfill" style="width:' + eHpPct + '%;background:linear-gradient(90deg,#ef4444,#f87171)"></div><span>❤️ ' + e.hp + '/' + e.maxhp + (e.block ? ' · 🛡️' + e.block : '') + '</span></div>' +
    '<div class="enemy-buffs">' + (e.str ? '💪力量' + e.str + '　' : '') + (e.vuln ? '💔易伤' + e.vuln + '　' : '') + (e.weak ? '🥀虚弱' + e.weak : '') + '</div>' +
    '<div class="intent">' + intentTxt + '</div></div></div>' +
    '<div class="hero-row"><div class="hero-chip"><img src="' + info.img + '">' + info.name +
    '　<span class="energy" title="能量">⚡' + cv.energy + '</span></div>' +
    '<div class="hero-chip">❤️ ' + cv.hp + '/' + cv.maxhp + (cv.block ? '　🛡️' + cv.block : '') +
    (cv.str ? '　💪' + cv.str : '') + (cv.vuln ? '　💔' + cv.vuln : '') + (cv.weak ? '　🥀' + cv.weak : '') + '</div>' +
    '<div class="piles">🂠 抽牌堆' + cv.drawCount + '　🗑️ 弃牌堆' + cv.discardCount + '　🔥 耗尽' + cv.exhaustCount + '</div></div>' +
    '<div class="hpbar" style="max-width:560px;margin:0 auto 6px"><div class="hpfill" style="width:' + hHpPct + '%"></div><span>❤️ ' + cv.hp + ' / ' + cv.maxhp + '</span></div>' +
    '<div class="hand" id="c-hand">' + cv.hand.map(function (c) {
      return cardHTML(c.cid, c.up, ' data-uid="' + c.uid + '"').replace('class="card ', 'class="card' + (c.cost > cv.energy ? ' cant' : '') + ' ');
    }).join('') + '</div>' +
    '<div class="combat-btns"><button class="btn primary big" id="c-end" style="font-size:18px;padding:10px 34px">🛡️ 结束回合</button>' +
    '<button class="btn small" id="c-auto">' + (UI.autoBattle ? '⏸️ 取消自动' : '▶️ 自动战斗') + '</button></div>' +
    '<div class="combat-log" id="c-log"></div></div>';
  overlay.innerHTML = html;
  // 绑定手牌
  overlay.querySelectorAll('#c-hand .card').forEach(function (el) {
    el.onclick = function () {
      if (UI.autoBattle || !C._uiResume) return;
      var uid = +el.getAttribute('data-uid');
      var card = null;
      for (var i = 0; i < C.hand.length; i++) if (C.hand[i].uid === uid) card = C.hand[i];
      if (!card || CARDS[card.cid].cost > C.hero.energy) { toast('能量不足！', 1200); return; }
      el.classList.add('playing');
      sfx('card');
      var r = C._uiResume; C._uiResume = null;
      setTimeout(function () { r({ a: 'play', uid: uid }); }, 120);
    };
  });
  overlay.querySelector('#c-end').onclick = function () {
    if (UI.autoBattle || !C._uiResume) return;
    sfx('click');
    var r = C._uiResume; C._uiResume = null;
    r({ a: 'end' });
  };
  overlay.querySelector('#c-auto').onclick = function () {
    UI.autoBattle = !UI.autoBattle;
    sfx('click');
    if (UI.autoBattle && C._uiResume && !C.over) {
      // 中途开启自动：唤醒等待中的手动回调，转入自动循环
      var r = C._uiResume; C._uiResume = null;
      r({ __auto: true });
    } else {
      renderCombatInt(C, id);
    }
  };
  // 自动战斗循环（玩家开启自动 / 演示模式）
  if (UI.autoBattle && !C.over && !C._autoRunning) {
    C._autoRunning = true;
    var autoStep = function () {
      if (!UI.autoBattle || C.over) {
        C._autoRunning = false;
        if (C._uiResume) { var r = C._uiResume; C._uiResume = null; r({ __auto: true }); }
        else renderCombatInt(C, id);
        return;
      }
      var cv2 = buildCombatView(C);
      var act = aiCombat(buildAIView(G, id), cv2, randFn);
      if (act.a === 'end') {
        var evs = endHeroTurn(G, C);
        flushClog(C, evs);
      } else {
        var idx = -1;
        for (var i = 0; i < C.hand.length; i++) if (C.hand[i].uid === act.uid) idx = i;
        if (idx < 0) { var evs2 = endHeroTurn(G, C); flushClog(C, evs2); }
        else { var evs3 = playCard(G, C, idx); sfx('hit'); flushClog(C, evs3); }
      }
      syncCombatToChar(G, C);
      renderCombatInt(C, id);
      if (!C.over) setTimeout(autoStep, (UI.demo || UI.inAITurn) ? 350 : 200);
      else { C._autoRunning = false; if (C._uiResume) { var r2 = C._uiResume; C._uiResume = null; r2({ __auto: true }); } }
    };
    setTimeout(autoStep, 250);
  }
}

/* 交互式战斗主循环 */
function combatPlayerAction(C, id) {
  C._kindLabel = C.enemy.isBoss ? '最终Boss' : '';
  renderCombatInt(C, id);
  flushClog(C, []);
  var guard = 0;
  function next() {
    if (C.over || guard++ > 600) return Promise.resolve();
    return new Promise(function (resolve) { C._uiResume = resolve; }).then(function (act) {
      C._uiResume = null;
      if (!act || act.__auto) { renderCombatInt(C, id); return next(); } // 自动循环接管/唤醒
      if (act.a === 'end') {
        var evs = endHeroTurn(G, C);
        sfx('hurt');
        syncCombatToChar(G, C);
        renderCombatInt(C, id);
        flushClog(C, evs);
        return next();
      }
      var idx = -1;
      for (var i = 0; i < C.hand.length; i++) if (C.hand[i].uid === act.uid) idx = i;
      if (idx < 0) { renderCombatInt(C, id); return next(); }
      var evs2 = playCard(G, C, idx);
      sfx('hit');
      syncCombatToChar(G, C);
      renderCombatInt(C, id);
      flushClog(C, evs2);
      return next();
    });
  }
  return next();
}
