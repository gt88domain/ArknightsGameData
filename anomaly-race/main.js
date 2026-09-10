/* ============================================================
 * main.js —— 回合流程 / Boss 行动 / 胜负判定 / 开局启动
 * 回合结构：奇数轮 玩家→AI→Boss；偶数轮 AI→玩家→Boss。
 * ============================================================ */
'use strict';

/* ---------------- 单个角色回合 ----------------
 * 流程：①检查骰具 → ②掷骰 → ③岔路选向 → ④移动 → ⑤落点
 *      → ⑥战斗 → ⑦结算 → ⑧结束
 */
function doTurn(id) {
  var ch = charOf(G, id);
  var ctx = { auto: (id === 'ai') || (UI.demo && id === 'player'), collect: [], _depth: 0 };
  if (id === 'ai') { UI.inAITurn = true; UI.skipAI = false; $('#btn-skip').classList.remove('hidden'); }
  G.phase = id;
  renderAll();
  logMsg('━━━ 第' + G.round + '轮 · ' + CHARS[id].name + ' 的回合 ━━━', 'sys');
  if (ctx.auto) toast('🤖 ' + CHARS[id].name + ' 行动中…' + (id === 'ai' ? '（可加速/跳过）' : '（演示模式）'), 1500);

  var chain = Promise.resolve();
  // ① 检查可用骰具
  chain = chain.then(function () {
    if (ctx.auto) {
      var vw = buildAIView(G, id);
      var v;
      if (aiUseBeacon(vw)) {
        v = { dice: 'beacon', num: 0 };
        ctx.collect.push('📡 启动核心信标，直达异变核心！');
      } else {
        v = aiPickDice(vw, randFn);
        ctx.collect.push('🎲 选择骰具：' + DICE_DEFS[v.dice].name + (v.dice === 'precise' ? '（定点' + v.num + '）' : ''));
      }
      ctx._preciseNum = v.num;
      if (!(UI.skipAI && UI.inAITurn)) toast(v.dice === 'beacon' ? ('📡 ' + CHARS[id].name + ' 启动核心信标！') : ('🎲 ' + CHARS[id].name + ' 选择' + DICE_DEFS[v.dice].name), 1200);
      return v;
    }
    return decideDiceUI(id);
  });
  // 精准骰选点
  chain = chain.then(function (diceSel) {
    ctx._diceSel = diceSel;
    if (diceSel.dice === 'precise') {
      if (ctx.auto) return ctx._preciseNum;
      return decideNumber(id, ctx);
    }
    return 0;
  });
  // ② 掷骰
  chain = chain.then(function (num) {
    var diceSel = ctx._diceSel;
    var res;
    if (diceSel.dice === 'beacon') {
      ch.pos = 22; sfx('dice');
      logMsg('【' + CHARS[id].name + '】📡 启动核心信标，直达异变核心！');
      ctx.collect.push('📡 传送落点：异变核心。');
      renderAll();
      res = { rolls: [], total: 0, beacon: true };
      ctx._roll = res;
      if (UI.skipAI && UI.inAITurn) return;
      return D(700);
    } else if (diceSel.dice === 'precise') {
      res = { rolls: [num], total: num, precise: true };
      ch.dice.precise--;
    } else {
      res = rollDice(G, ch, diceSel.dice);
    }
    ctx._roll = res;
    var faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    var msg = '🎲 掷骰（' + DICE_DEFS[diceSel.dice].name + '）：' + res.rolls.map(function (r) { return faces[r - 1]; }).join(' ') + ' → 移动' + res.total + '步！';
    logMsg('【' + CHARS[id].name + '】' + msg);
    ctx.collect.push(msg);
    if (UI.skipAI && UI.inAITurn) return;
    if (!ctx.auto) return diceAnim(res.rolls);
    // AI 掷骰：简短展示
    toast(msg, 1300);
    return D(600);
  });
  // ③④ 移动（含岔路选择、经过起点）
  chain = chain.then(function () {
    if (!ch.alive) return ch.pos;
    return walkSteps(id, ctx._roll.total, ctx);
  });
  // ⑤⑥⑦ 落点 + 战斗 + 结算（途中挑战 Boss 则已结算，不再处理落点）
  chain = chain.then(function (walkRes) {
    if (!ch.alive) return;
    if (walkRes && walkRes.stopped) return;
    return resolveLanding(id, ch.pos, ctx, 0);
  });
  // ⑧ 结束
  chain = chain.then(function () {
    logMsg('【' + CHARS[id].name + '】回合结束。', 'sys');
    renderAll();
    if (id === 'ai') {
      UI.inAITurn = false;
      $('#btn-skip').classList.add('hidden');
      return showAISummary(id, ctx);
    }
  });
  return chain;
}

/* ---- AI 回合摘要 ---- */
function showAISummary(id, ctx) {
  var lines = ctx.collect.length ? ctx.collect : ['（无事发生）'];
  lines.forEach(function () {});
  if (UI.skipAI) {
    UI.skipAI = false;
    toast('⏭ 已跳过夜阑的回合（详见日志）', 1600);
    return Promise.resolve();
  }
  UI.skipAI = false;
  return new Promise(function (resolve) {
    var done = false;
    function fin() { if (!done) { done = true; resolve(); } }
    modal({
      title: '🤖 夜阑的回合摘要（第' + G.round + '轮）',
      html: '<div class="sum">' + lines.map(function (l) { return '• ' + l; }).join('<br>') + '</div>',
      buttons: [{ label: '继续', value: 1, cls: 'primary' }],
    }).then(fin);
    setTimeout(function () { if (!done) { $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = ''; fin(); } }, 6000);
  });
}

/* ---------------- Boss 行动（每轮双方行动后） ---------------- */
function bossPhaseUI() {
  G.phase = 'boss';
  renderAll();
  logMsg('━━━ 第' + G.round + '轮 · Boss 行动 ━━━', 'sys');
  var msgs = bossPhase(G);
  var chain = Promise.resolve();
  msgs.forEach(function (m) {
    chain = chain.then(function () {
      logMsg('👁️ ' + m.t, m.pulse ? 'bad' : 'sys');
      if (m.lv) { sfx('boss'); toast('👁️ ' + m.t, 2600); }
      if (m.pulse) {
        sfx('pulse');
        toast('👁️ 异变冲击！双方受到' + m.pulse + '点伤害！', 2400);
        ['player', 'ai'].forEach(function (id) {
          var ch = charOf(G, id);
          if (!ch.alive) return;
          var res = damageChar(G, ch, m.pulse);
          if (res.revived) { logMsg('【' + CHARS[id].name + '】🔥 凤凰之羽碎裂，重生！', 'good'); toast('🔥 ' + CHARS[id].name + '的凤凰之羽碎裂，重生！', 2200); }
          if (res.died) logMsg('【' + CHARS[id].name + '】💀 在异变冲击中倒下了……', 'bad');
        });
        renderAll();
      }
      return D(700);
    });
  });
  return chain.then(function () { renderAll(); checkOver(); });
}

/* ---------------- 胜负判定 ---------------- */
function checkOver() {
  if (G.over) { showEndScreen(); return true; }
  var p = charOf(G, 'player'), a = charOf(G, 'ai');
  // 玩家生命归零 → 失败（优先于一切）
  if (!p.alive) {
    G.over = { result: 'lose', reason: '星晓生命归零，倒在了异变之中……竞速失败。' };
    showEndScreen();
    return true;
  }
  // AI 生命归零 → 出局（游戏继续，玩家仍须击败 Boss）
  if (!a.alive && !G.aiEliminated) {
    G.aiEliminated = true;
    logMsg('🏳️ 夜阑生命归零，退出竞速！但你仍须击败最终 Boss 才能完成异变！', 'sys');
    toast('🏳️ 夜阑出局！你仍须击败最终 Boss！', 3000);
    renderAll();
  }
  return false;
}

function showEndScreen() {
  if ($('#end-screen').classList.contains('show')) return; // 避免重复
  var win = G.over.result === 'win';
  sfx(win ? 'win' : 'lose');
  var p = charOf(G, 'player'), a = charOf(G, 'ai');
  var box = $('#end-screen');
  var confetti = '';
  if (win) {
    var icons = ['🎉', '⭐', '🎊', '✨', '🏆'];
    for (var i = 0; i < 24; i++) {
      confetti += '<div class="confetti" style="left:' + (Math.random() * 100) + '%;animation-delay:' + (Math.random() * 3) + 's">' + icons[i % icons.length] + '</div>';
    }
  }
  box.innerHTML = confetti + '<div class="end-box ' + (win ? 'win' : 'lose') + '">' +
    '<div class="end-title">' + (win ? '🏆 竞速胜利！' : '💔 竞速失败') + '</div>' +
    '<div class="end-reason">' + G.over.reason + '</div>' +
    '<div class="end-stats">第 ' + G.round + ' 轮 · 种子 ' + esc(G.seedStr) + ' · ' + DIFFICULTY[G.difficulty].name + 'AI<br>' +
    '🌸 星晓：❤️ ' + p.hp + '/' + p.maxhp + ' · 💰' + p.gold + ' · 🃏' + p.deck.length + '张 · ✨' + p.relics.length + '遗物 · 第' + (p.laps + 1) + '圈<br>' +
    '🌙 夜阑：' + (a.alive ? ('❤️ ' + a.hp + '/' + a.maxhp + ' · 💰' + a.gold + ' · 🃏' + a.deck.length + '张 · ✨' + a.relics.length + '遗物 · 第' + (a.laps + 1) + '圈') : '已出局') + '<br>' +
    'AI 补偿遗物：' + (G.aiBonusRelic ? '【' + RELICS[G.aiBonusRelic].name + '】' : '无') + '</div>' +
    '<button class="btn primary big" onclick="location.reload()">🔄 再来一局</button></div>';
  box.classList.remove('hidden');
  box.classList.add('show');
}

/* ---------------- 主循环 ---------------- */
function runGame() {
  logMsg('🌟 异变竞速开始！种子：' + G.seedStr + '，难度：' + DIFFICULTY[G.difficulty].name + 'AI。', 'sys');
  logMsg('⚖️ 公平性：双方地图/金币/建筑/卡牌/Boss规则完全相同；AI 仅使用公开信息决策。', 'sys');
  if (G.aiBonusRelic) logMsg('🎁 AI 开局补偿遗物（已公开）：【' + RELICS[G.aiBonusRelic].name + '】——' + RELICS[G.aiBonusRelic].text, 'sys');
  if (UI.demo) logMsg('🎬 双 AI 演示模式：双方自动进行。', 'sys');
  var chain = Promise.resolve();
  function loop() {
    if (G.over) return Promise.resolve();
    var odd = G.round % 2 === 1;
    var order = odd ? ['player', 'ai'] : ['ai', 'player'];
    var c = Promise.resolve();
    order.forEach(function (id) {
      c = c.then(function () {
        if (G.over) return;
        if (!charOf(G, id).alive) return; // AI 出局后跳过
        return doTurn(id).then(function () { checkOver(); });
      });
    });
    c = c.then(function () {
      if (G.over) return;
      return bossPhaseUI().then(function () {
        if (G.over) return;
        G.round++;
        renderAll();
        return loop();
      });
    });
    return c;
  }
  return loop();
}

/* ---------------- 规则 / 公平性说明 ---------------- */
function showRules() {
  modal({
    title: '📜 规则说明', wide: true,
    html: '<ul style="line-height:2;font-size:14px">' +
      '<li>🏁 <b>你先击败最终 Boss 获胜</b>；夜阑先击败则你失败；你生命归零则失败；夜阑归零则出局（你仍需击败 Boss）。</li>' +
      '<li>🔄 <b>奇数轮：你→夜阑→Boss；偶数轮：夜阑→你→Boss</b>。</li>' +
      '<li>🎲 每回合：检查骰具→掷骰→岔路选向→移动→落点→战斗→结算→结束。移动动画约1~2秒。</li>' +
      '<li>🃏 战斗：每回合4能量、抽5张，格挡每回合清空。易伤=受到伤害×1.5，虚弱=造成伤害×0.75，力量=每次攻击+伤。胜利后休整（普通+5/精英+10）。</li>' +
      '<li>🏠 建筑：购买后对手落点付过路费，可升级2次；每圈带来收入。金币不够时差额转为生命损失。</li>' +
      '<li>👁️ 异变核心第7轮后成型可挑战（此前到访领30金币调查经费）；落点/经过可停下挑战；第7轮起投骰前也可用📡核心信标直达（代替移动，双方同一规则）。</li>' +
      '<li>👁️ Boss 每轮侵蚀+%（33%商店涨价/66%敌伤+2/99%冲击+5），每3轮异变冲击；Boss 战力随轮次公开成长。</li>' +
      '<li>⏩ AI 回合可加速/跳过；AI 战斗同规则快速结算，只看摘要。</li></ul>',
    buttons: [{ label: '公平性说明', value: 'fair', cls: 'blue' }, { label: '关闭', value: 1, cls: 'primary' }],
  }).then(function (v) { if (v === 'fair') showFair(); });
}
function showFair() {
  var relic = G && G.aiBonusRelic ? '【' + RELICS[G.aiBonusRelic].name + '】' + RELICS[G.aiBonusRelic].text : '无（简单难度）';
  modal({
    title: '⚖️ 公平性说明', wide: true,
    html: '<ul style="line-height:2;font-size:14px">' +
      '<li>🗺️ 双方使用<b>相同的地图、金币规则、建筑价格、卡牌战斗与 Boss 规则</b>，共用同一套结算代码。</li>' +
      '<li>🔒 AI <b>不能</b>读取未来随机数、未揭示的卡牌/遗物奖励，也看不到你的牌组与手牌；它只能看到双方位置/生命/金币/遗物等公开信息。</li>' +
      '<li>🎁 本局 AI 开局补偿遗物（开局时已公开）：<b>' + relic + '</b>。除此之外没有任何暗中加成。</li>' +
      '<li>🎲 全局只有一条随机数流，种子 <b>' + (G ? esc(G.seedStr) : '?') + '</b> 决定一切随机；AI 的思考不消耗、不预支随机数。</li></ul>',
    buttons: [{ label: '关闭', value: 1, cls: 'primary' }],
  });
}

/* ---------------- 开局界面 ---------------- */
var selectedDiff = 'standard';

function refreshPreview() {
  var seed = $('#seed-input').value.trim() || 'preview';
  var pg = newGame(seed, selectedDiff);
  $('#diff-desc').textContent = '▶ ' + DIFFICULTY[selectedDiff].name + 'AI：' + DIFFICULTY[selectedDiff].desc;
  var box = $('#ai-relic-box');
  if (pg.aiBonusRelic) {
    var r = RELICS[pg.aiBonusRelic];
    box.innerHTML = '🎁 <b>AI 开局补偿遗物（公开）</b><br>【' + r.name + '】' + r.text + '<br><small> press·该补偿在开局界面展示，无其他暗中加成</small>';
  } else {
    box.innerHTML = '🎁 <b>AI 开局补偿遗物：无</b><br><small>简单难度 AI 没有补偿，但偶尔会犯错。</small>';
  }
}

function startGameFromUI() {
  var seed = $('#seed-input').value.trim();
  if (!seed) { seed = 'race-' + Math.floor(Math.random() * 1000000); }
  UI.demo = $('#demo-check').checked;
  G = newGame(seed, selectedDiff);
  $('#start-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  renderBoard();
  renderAll();
  sfx('win');
  runGame();
}

function boot() {
  // 默认随机种子（填入输入框，保证预览与实际开局一致）
  $('#seed-input').value = 'race-' + Math.floor(Math.random() * 1000000);
  document.querySelectorAll('.btn.diff').forEach(function (b) {
    b.onclick = function () {
      sfx('click');
      document.querySelectorAll('.btn.diff').forEach(function (x) { x.classList.remove('selected'); });
      b.classList.add('selected');
      selectedDiff = b.getAttribute('data-diff');
      refreshPreview();
    };
  });
  $('#seed-input').addEventListener('input', refreshPreview);
  $('#btn-random-seed').onclick = function () {
    sfx('click');
    $('#seed-input').value = 'race-' + Math.floor(Math.random() * 1000000);
    refreshPreview();
  };
  $('#btn-start').onclick = function () { sfx('click'); startGameFromUI(); };
  $('#btn-speed').onclick = function () {
    UI.speed = UI.speed === 1 ? 4 : 1;
    $('#btn-speed').textContent = UI.speed === 1 ? '⏩ 加速:关' : '⏩ 加速:开';
    toast(UI.speed === 1 ? '⏩ AI 回合正常速度' : '⏩⏩ AI 回合 4 倍速！', 1400);
    sfx('click');
  };
  $('#btn-skip').onclick = function () { UI.skipAI = true; sfx('click'); toast('⏭ 跳过本次 AI 回合动画…', 1200); };
  $('#btn-sound').onclick = function () {
    UI.muted = !UI.muted;
    $('#btn-sound').textContent = UI.muted ? '🔇' : '🔊';
    if (!UI.muted) sfx('click');
  };
  $('#btn-rules').onclick = function () { sfx('click'); showRules(); };
  $('#btn-restart').onclick = function () { if (confirm('确定要重新开始吗？当前进度将丢失。')) location.reload(); };
  refreshPreview();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
