/* ============================================================
 * ui.js —— 界面渲染 + 回合流程编排（浏览器环境）
 * 所有规则结算调用 engine.js；AI 决策只走 buildAIView 公开视图。
 * ============================================================ */
'use strict';

/* ---------------- 基础工具 ---------------- */
function $(sel) { return document.querySelector(sel); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* 全局 UI 状态 */
var G = null;
var UI = {
  speed: 1,            // 1 或 4（加速）
  skipAI: false,       // 本次 AI 回合直接跳过动画
  inAITurn: false,
  demo: false,         // 双AI演示模式
  muted: false,
  autoBattle: false,   // 玩家自动战斗开关
  aiEliminatedToast: false,
};
function D(ms) {
  if (UI.skipAI && UI.inAITurn) return sleep(0);
  var sp = (UI.inAITurn || UI.demo) ? UI.speed : 1;
  // 玩家回合也允许加速影响移动动画
  if (!UI.inAITurn && !UI.demo) sp = 1;
  return sleep(ms / sp);
}

/* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
var AudioSys = {
  ctx: null,
  ensure: function () {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
    return this.ctx;
  },
  tone: function (freq, dur, type, vol, when) {
    if (UI.muted) return;
    var ctx = this.ensure(); if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, ctx.currentTime + (when || 0));
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (when || 0) + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + (when || 0)); o.stop(ctx.currentTime + (when || 0) + dur + 0.02);
  },
};
function sfx(name) {
  switch (name) {
    case 'click': AudioSys.tone(660, 0.07, 'square', 0.06); break;
    case 'dice': AudioSys.tone(300, 0.06, 'square', 0.07); AudioSys.tone(420, 0.06, 'square', 0.07, 0.07); AudioSys.tone(560, 0.09, 'square', 0.08, 0.14); break;
    case 'step': AudioSys.tone(520, 0.05, 'triangle', 0.06); break;
    case 'coin': AudioSys.tone(880, 0.08, 'sine', 0.1); AudioSys.tone(1320, 0.12, 'sine', 0.1, 0.08); break;
    case 'card': AudioSys.tone(740, 0.07, 'triangle', 0.09); break;
    case 'hit': AudioSys.tone(180, 0.12, 'sawtooth', 0.1); break;
    case 'hurt': AudioSys.tone(140, 0.18, 'sawtooth', 0.12); break;
    case 'relic': AudioSys.tone(660, 0.1, 'sine', 0.1); AudioSys.tone(880, 0.1, 'sine', 0.1, 0.1); AudioSys.tone(1100, 0.16, 'sine', 0.1, 0.2); break;
    case 'heal': AudioSys.tone(520, 0.12, 'sine', 0.09); AudioSys.tone(780, 0.16, 'sine', 0.09, 0.1); break;
    case 'win': [523, 659, 784, 1047, 1319].forEach(function (f, i) { AudioSys.tone(f, 0.18, 'triangle', 0.11, i * 0.13); }); break;
    case 'lose': [400, 340, 280, 200].forEach(function (f, i) { AudioSys.tone(f, 0.22, 'sawtooth', 0.09, i * 0.16); }); break;
    case 'boss': AudioSys.tone(90, 0.5, 'sawtooth', 0.14); AudioSys.tone(65, 0.6, 'square', 0.1, 0.1); break;
    case 'pulse': AudioSys.tone(220, 0.3, 'sawtooth', 0.1); AudioSys.tone(165, 0.4, 'sawtooth', 0.1, 0.15); break;
  }
}

/* ---------------- 日志 & Toast ---------------- */
function logMsg(html, cls) {
  var box = $('#log');
  if (!box) return;
  var div = document.createElement('div');
  div.className = 'log-line' + (cls ? ' ' + cls : '');
  div.innerHTML = html;
  box.appendChild(div);
  while (box.children.length > 250) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function toast(html, ms) {
  var root = $('#toast-root');
  var div = document.createElement('div');
  div.className = 'toast';
  div.innerHTML = html;
  root.appendChild(div);
  setTimeout(function () { div.classList.add('out'); setTimeout(function () { div.remove(); }, 400); }, ms || 2200);
}

/* ---------------- 通用 Modal（Promise） ---------------- */
function modal(opts) {
  return new Promise(function (resolve) {
    var root = $('#modal-root');
    root.innerHTML = '';
    root.classList.add('show');
    var box = document.createElement('div');
    box.className = 'modal' + (opts.wide ? ' wide' : '');
    var h = '<div class="modal-title">' + opts.title + '</div>';
    h += '<div class="modal-body">' + (opts.html || '') + '</div>';
    h += '<div class="modal-btns"></div>';
    box.innerHTML = h;
    var btnRow = box.querySelector('.modal-btns');
    (opts.buttons || [{ label: '确定', value: true }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.innerHTML = b.label;
      if (b.disabled) btn.disabled = true;
      btn.onclick = function () { sfx('click'); close(b.value); };
      btnRow.appendChild(btn);
    });
    root.appendChild(box);
    if (opts.onMount) opts.onMount(box);
    function close(v) {
      root.classList.remove('show');
      root.innerHTML = '';
      resolve(v);
    }
    // 点击遮罩不关闭（避免误触跳过关键决策）
  });
}

/* ---------------- 卡牌 HTML ---------------- */
function cardHTML(cid, up, extra) {
  var c = CARDS[cid], cls = 'card rarity-' + c.rarity + (up ? ' upgraded' : '');
  var typeIcon = c.type === 'atk' ? '⚔️' : '🛡️';
  return '<div class="' + cls + '"' + (extra || '') + '>' +
    '<div class="card-cost">' + c.cost + '</div>' +
    '<div class="card-name">' + c.name + (up ? '<span class="up">+</span>' : '') + '</div>' +
    '<div class="card-type">' + typeIcon + ' ' + ({ starter: '初始', common: '普通', uncommon: '非普通', rare: '稀有' }[c.rarity]) + '</div>' +
    '<div class="card-text">' + cardText(cid, up) + '</div></div>';
}
function relicIcon(rid, bonus) {
  var r = RELICS[rid];
  return '<span class="relic tier-' + r.tier + '" title="【' + r.name + '】' + r.text + '">' + r.name + (bonus ? '<i>补偿</i>' : '') + '</span>';
}

/* ================= 棋盘渲染 ================= */
function renderBoard() {
  var svg = $('#edges'), tiles = $('#tiles');
  svg.innerHTML = ''; tiles.innerHTML = '';
  // 边
  var drawn = {};
  Object.keys(BOARD_NEXT).forEach(function (from) {
    BOARD_NEXT[from].forEach(function (to) {
      var k = from + '>' + to;
      if (drawn[k]) return; drawn[k] = 1;
      var a = nodeById(isNaN(+from) ? from : +from), b = nodeById(isNaN(+to) ? to : +to);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('class', 'edge' + ((from == 4 || from == 16) ? ' fork-edge' : ''));
      svg.appendChild(line);
    });
  });
  // 格子
  BOARD_NODES.forEach(function (n) {
    var d = document.createElement('div');
    d.className = 'tile kind-' + n.kind;
    d.id = 'tile-' + n.id;
    d.style.left = (n.x / 960 * 100) + '%';
    d.style.top = (n.y / 700 * 100) + '%';
    var b = G.buildings[n.id];
    var ownerDot = '';
    if (n.kind === 'building') {
      if (b) ownerDot = '<div class="binfo ' + b.owner + '">Lv' + b.level + '·' + (b.owner === 'player' ? '晓' : '阑') + '</div>';
      else ownerDot = '<div class="binfo none">' + n.price + 'G</div>';
    }
    var inner = n.kind === 'boss'
      ? '<img class="boss-mini" src="assets/boss.png" alt="boss"><div class="tname">' + n.name + '</div>' + ownerDot
      : '<div class="ticon">' + n.icon + '</div><div class="tname">' + n.name + '</div>' + ownerDot;
    d.innerHTML = inner;
    d.title = n.name + '：' + n.desc;
    tiles.appendChild(d);
  });
  // 棋子
  ['player', 'ai'].forEach(function (id) {
    var t = document.createElement('div');
    t.className = 'token ' + id;
    t.id = 'token-' + id;
    t.innerHTML = '<img src="' + CHARS[id].img + '" alt="' + CHARS[id].name + '"><span>' + CHARS[id].name + '</span>';
    tiles.appendChild(t);
  });
  updateTokens(true);
}
function updateTokens(instant) {
  ['player', 'ai'].forEach(function (id) {
    var ch = charOf(G, id), t = $('#token-' + id);
    if (!t) return;
    if (!ch.alive) { t.style.display = 'none'; return; }
    t.style.display = 'flex';
    var n = nodeById(ch.pos);
    var same = charOf(G, 'player').pos === charOf(G, 'ai').pos && charOf(G, 'player').alive && charOf(G, 'ai').alive;
    var dx = 0;
    if (same) dx = (id === 'player' ? -3.2 : 3.2);
    if (instant) t.style.transition = 'none'; else t.style.transition = '';
    t.style.left = 'calc(' + (n.x / 960 * 100) + '% + ' + dx + '%)';
    t.style.top = (n.y / 700 * 100) + '%';
  });
}
function highlightTile(nodeId, on) {
  var t = $('#tile-' + nodeId);
  if (t) t.classList.toggle('hl', !!on);
}

/* ================= 面板渲染 ================= */
function renderTop() {
  var order = (G.round % 2 === 1) ? '你 → 夜阑 → Boss' : '夜阑 → 你 → Boss';
  $('#round-info').innerHTML = '第 <b>' + G.round + '</b> 轮 <span class="pill">' + ((G.round % 2 === 1) ? '奇数轮' : '偶数轮') + '</span>';
  $('#order-info').textContent = '行动顺序：' + order;
  $('#seed-info').textContent = '种子 ' + G.seedStr + ' · ' + DIFFICULTY[G.difficulty].name + 'AI';
  var bp = bossPreview(G);
  $('#boss-chip').innerHTML = '<img src="assets/boss.png"> 异变核心·蚀 <span>HP ' + bp.hp + ' · 伤害+' + bp.dmgBonus + '</span>';
  $('#erosion-fill').style.width = G.erosion + '%';
  $('#erosion-text').textContent = '侵蚀 ' + G.erosion + '% (Lv' + G.erosionLv + ')';
  var eb = $('#erosion-fill');
  eb.className = 'fill' + (G.erosion >= 66 ? ' lv2' : (G.erosion >= 33 ? ' lv1' : ''));
}
function charPanelHTML(id) {
  var ch = charOf(G, id), info = CHARS[id];
  var isAI = id === 'ai';
  var hpPct = Math.max(0, Math.round(ch.hp / ch.maxhp * 100));
  var relics = ch.relics.map(function (r) { return relicIcon(r, isAI && r === G.aiBonusRelic); }).join('') || '<span class="none">无</span>';
  var dice = [];
  if (ch.dice.swift) dice.push('🌪️×' + ch.dice.swift);
  if (ch.dice.precise) dice.push('🎯×' + ch.dice.precise);
  if (ch.dice.double) dice.push('🎲🎲×' + ch.dice.double);
  var bds = ch.buildings.map(function (b) { var bb = G.buildings[b]; return nodeById(b).name + 'Lv' + (bb ? bb.level : 1); }).join('、') || '<span class="none">无</span>';
  var deckBtn = (!isAI) ? '<button class="btn small" onclick="showDeck(\'player\')">牌组(' + ch.deck.length + ')</button>'
    : '<span class="deckcount" title="对手牌组构成是隐藏信息">牌组(' + ch.deck.length + '张·隐藏)</span>';
  return '<div class="p-head"><img src="' + info.img + '"><div><div class="p-name" style="color:' + info.color + '">' + info.name +
    (isAI ? '<span class="aitag">AI</span>' : '<span class="youtag">YOU</span>') + '</div><div class="p-title">' + info.title + ' · 第' + (ch.laps + 1) + '圈</div></div></div>' +
    '<div class="hpbar"><div class="hpfill" style="width:' + hpPct + '%"></div><span>❤️ ' + ch.hp + '/' + ch.maxhp + '</span></div>' +
    '<div class="p-row">💰 <b>' + ch.gold + '</b>金币　📍 ' + esc(nodeById(ch.pos).name) + '</div>' +
    '<div class="p-row">🎲 骰具：' + (dice.join('　') || '<span class="none">普通骰（无限）</span>') + '</div>' +
    '<div class="p-row">🏠 建筑：' + bds + '</div>' +
    '<div class="p-row relics">✨ 遗物：' + relics + '</div>' +
    '<div class="p-row">' + deckBtn + '</div>' +
    (!ch.alive ? '<div class="dead-mask">' + (isAI ? '出局' : '阵亡') + '</div>' : '');
}
function renderPanels() {
  $('#panel-player').innerHTML = charPanelHTML('player');
  $('#panel-player').classList.toggle('active', G.phase === 'player');
  $('#panel-ai').innerHTML = charPanelHTML('ai');
  $('#panel-ai').classList.toggle('active', G.phase === 'ai');
  var bd = $('#panel-boss');
  var bp = bossPreview(G);
  bd.innerHTML = '<div class="p-head"><img src="assets/boss.png"><div><div class="p-name" style="color:#c084fc">异变核心·蚀</div><div class="p-title">最终 Boss · 侦察(公开)：HP ' + bp.hp + ' / 伤害加成 +' + bp.dmgBonus + '</div></div></div>' +
    '<div class="p-row">每轮行动后侵蚀 +' + CONFIG.erosionPerRound + '%；每' + CONFIG.pulseEveryRounds + '轮释放异变冲击。先击败它的人赢得竞速！</div>';
  bd.classList.toggle('active', G.phase === 'boss');
}
function renderAll() { renderTop(); renderPanels(); updateTokens(); }

/* 牌组查看（仅自己） */
function showDeck(id) {
  var ch = charOf(G, id);
  var html = '<div class="card-list">' + ch.deck.map(function (c) { return cardHTML(c.cid, c.up); }).join('') + '</div>';
  modal({ title: CHARS[id].name + '的牌组（' + ch.deck.length + '张）', html: html, wide: true, buttons: [{ label: '关闭', value: 1 }] });
}

/* ================= 起点结算（经过/停留，公共规则） ================= */
function passStartMsgs(ch) {
  var msgs = [];
  ch.laps++;
  var gold = CONFIG.passStartGold + lapIncome(ch, G);
  if (hasRelic(ch, 'meat')) gold += 25;
  if (hasRelic(ch, 'payday')) gold += 80;
  addGold(G, ch, gold);
  msgs.push('🔥 经过起点：第' + (ch.laps + 1) + '圈开始！+' + gold + '金币（含建筑收入）。');
  ch.maxhp += CONFIG.lapMaxHpBonus;
  healChar(ch, CONFIG.lapHealBonus);
  msgs.push('📈 圈数成长：最大生命+' + CONFIG.lapMaxHpBonus + '，回复' + CONFIG.lapHealBonus + '点。');
  if (hasRelic(ch, 'dicebag')) {
    var d = randomDice(G); ch.dice[d]++;
    msgs.push('🎲 骰子袋：获得【' + DICE_DEFS[d].name + '】。');
  }
  return msgs;
}
function landStartMsgs(ch) {
  var msgs = [];
  ch.laps++;
  var gold = CONFIG.landStartGold + lapIncome(ch, G);
  if (hasRelic(ch, 'meat')) gold += 25;
  if (hasRelic(ch, 'payday')) gold += 80;
  addGold(G, ch, gold);
  var h = healChar(ch, CONFIG.landStartHeal);
  msgs.push('🔥 停留起点：+' + gold + '金币，回复' + h + '点生命！第' + (ch.laps + 1) + '圈开始。');
  ch.maxhp += CONFIG.lapMaxHpBonus;
  healChar(ch, CONFIG.lapHealBonus);
  if (hasRelic(ch, 'dicebag')) {
    var d = randomDice(G); ch.dice[d]++;
    msgs.push('🎲 骰子袋：获得【' + DICE_DEFS[d].name + '】。');
  }
  return msgs;
}

/* ================= 决策：骰具 / 方向 / 数字 ================= */
function randFn() { return aiR(G); }

/* 骰具选择 UI（玩家手动） */
function decideDiceUI(id) {
  var ch = charOf(G, id);
  return new Promise(function (resolve) {
    var opts = availableDice(ch);
    var html = '<div class="dice-pick">' + opts.map(function (d) {
      var left = DICE_DEFS[d].infinite ? '∞' : ('×' + ch.dice[d]);
      return '<button class="btn dicebtn" data-d="' + d + '">' + DICE_DEFS[d].icon + '<br>' + DICE_DEFS[d].name + ' ' + left + '<small>' + DICE_DEFS[d].text + '</small></button>';
    }).join('') + '</div>';
    if (G.round >= CONFIG.bossChallengeRound && ch.pos !== 22) {
      var evaB = aiBossChallenge(buildAIView(G, id));
      html += '<div style="margin-top:8px"><button class="btn dicebtn" data-d="beacon">📡<br>信标直达核心<small>评估：' + evaB.why + (evaB.go ? '' : '（此去凶险）') + '</small></button></div>';
    }
    modal({
      title: '① 检查可用骰具并选择', html: html, buttons: [],
      onMount: function (box) {
        box.querySelectorAll('.dicebtn').forEach(function (b) {
          b.onclick = function () {
            sfx('click');
            $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = '';
            resolve({ dice: b.getAttribute('data-d'), num: 0 });
          };
        });
      }
    });
  });
}
function decideNumber(id, ctx) {
  if (ctx.auto) return Promise.resolve(ctx._preciseNum || 3);
  return new Promise(function (resolve) {
    var html = '<div class="num-pick">' + [1, 2, 3, 4, 5, 6].map(function (n) {
      var dest = simWalk(charOf(G, id).pos, n, null);
      var last = nodeById(dest[dest.length - 1]);
      return '<button class="btn numbtn" data-n="' + n + '">' + n + '<small>→' + last.name + '</small></button>';
    }).join('') + '</div>';
    modal({
      title: '🎯 精准骰：选择移动点数', html: html, buttons: [],
      onMount: function (box) {
        box.querySelectorAll('.numbtn').forEach(function (b) {
          b.onclick = function () {
            sfx('click');
            $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = '';
            resolve(+b.getAttribute('data-n'));
          };
        });
      }
    });
  });
}
function decideDir(id, forkId, ctx) {
  var n = nodeById(forkId);
  var mainPrev = simWalk(forkId, 3, null).map(function (x) { return nodeById(x).name; }).join(' → ');
  var dc = {}; dc[forkId] = 'branch';
  var brPrev = simWalk(forkId, 3, dc).map(function (x) { return nodeById(x).name; }).join(' → ');
  if (ctx.auto) {
    var c = aiPickDir(buildAIView(G, id), forkId, randFn);
    var msg = '🔀 岔路选择：' + (c === 'main' ? '主路（' + mainPrev + '）' : n.fork.branchName + '（' + brPrev + '）');
    ctx.collect.push(msg);
    if (!UI.skipAI) { toast(CHARS[id].name + '：' + msg, 1200); }
    return D(500).then(function () { return c; });
  }
  var html = '<div class="dir-pick">' +
    '<button class="btn dirbtn" data-c="main">🛤️ 主路<small>' + mainPrev + '</small></button>' +
    '<button class="btn dirbtn" data-c="branch">🌟 ' + n.fork.branchName + '<small>' + brPrev + '</small></button></div>';
  return new Promise(function (resolve) {
    modal({
      title: '🔀 经过岔路：选择方向', html: html, buttons: [],
      onMount: function (box) {
        box.querySelectorAll('.dirbtn').forEach(function (b) {
          b.onclick = function () {
            sfx('click');
            $('#modal-root').classList.remove('show'); $('#modal-root').innerHTML = '';
            resolve(b.getAttribute('data-c'));
          };
        });
      }
    });
  });
}

/* ================= 掷骰动画 ================= */
function diceAnim(finalRolls) {
  return new Promise(function (resolve) {
    var box = $('#dice-anim');
    box.classList.add('show');
    var faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    var n = 0;
    sfx('dice');
    var timer = setInterval(function () {
      box.innerHTML = '<div class="dice-face">' + finalRolls.map(function () { return faces[Math.floor(Math.random() * 6)]; }).join(' ') + '</div>';
      if (++n >= 6) {
        clearInterval(timer);
        box.innerHTML = '<div class="dice-face final">' + finalRolls.map(function (r) { return faces[r - 1]; }).join(' ') + '</div>';
        setTimeout(function () { box.classList.remove('show'); resolve(); }, 420);
      }
    }, 80);
  });
}

/* ================= 移动 ================= */
function walkSteps(id, steps, ctx) {
  var ch = charOf(G, id);
  var per = Math.max(70, Math.min(320, 1400 / Math.max(1, steps)));
  var chain = Promise.resolve();
  var cur = ch.pos;
  var walkStopped = false;
  for (var s = 0; s < steps; s++) {
    (function (s) {
      chain = chain.then(function () {
        if (walkStopped) return; // 已在 Boss 门停下挑战
        var nx = nextOf(cur);
        var p = Promise.resolve(nx[0]);
        if (nx.length > 1) {
          p = decideDir(id, cur, ctx).then(function (c) { return c === 'main' ? nx[0] : nx[1]; });
        }
        return p.then(function (next) {
          cur = next; ch.pos = next; ch.stats.steps++;
          updateTokens();
          highlightTile(next, true);
          (function (nn) { setTimeout(function () { highlightTile(nn, false); }, 600); })(next);
          sfx('step');
          renderPanels();
          var last = (s === steps - 1);
          if (next === 0 && !last) {
            var msgs = passStartMsgs(ch);
            msgs.forEach(function (m) { logMsg('【' + CHARS[id].name + '】' + m); ctx.collect.push(m); });
            if (!ctx.auto) msgs.forEach(function (m) { toast(m, 1800); });
            renderAll();
          }
          // 经过 Boss 门：可停下挑战（双方同一规则）
          if (next === 22 && !last) {
            return askBossPassThrough(id, ctx).then(function (stop) {
              if (stop) walkStopped = true;
              return D(per);
            });
          }
          if (next === 21 && !last) {
            return askShopPassThrough(id, ctx).then(function () { return D(per); });
          }
          return D(per);
        });
      });
    })(s);
  }
  return chain.then(function () { return { pos: cur, stopped: walkStopped }; });
}

/* 经过 Boss 门时的挑战询问。返回 Promise<bool>：是否停下挑战 */
function askBossPassThrough(id, ctx) {
  if (G.round < CONFIG.bossChallengeRound) {
    addGold(G, charOf(G, id), 30);
    var m = '👁️ 核心尚未成型，领取调查经费30金币，继续前进。';
    ctx.collect.push(m);
    logMsg('【' + CHARS[id].name + '】' + m);
    if (!ctx.auto) toast(m, 1600);
    renderAll();
    return Promise.resolve(false);
  }
  if (ctx.auto) {
    var eva = aiBossChallenge(buildAIView(G, id));
    if (eva.go) {
      ctx.collect.push('👁️ 经过异变核心，评估（' + eva.why + '），停下挑战！');
      return doCombat(id, makeBoss(G), 'boss', ctx).then(function () { return true; });
    }
    ctx.collect.push('👁️ 经过异变核心（暂不挑战，继续前进）。');
    return D(400).then(function () { return false; });
  }
  var ch = charOf(G, id), bp = bossPreview(G), ds = deckStats(ch.deck);
  sfx('boss');
  var html = '<div class="sum">👁️ <b>异变核心·蚀</b>（公开侦察）<br>生命 ' + bp.hp + ' · 伤害加成 +' + bp.dmgBonus +
    '<br>你的状态：❤️ ' + ch.hp + '/' + ch.maxhp + ' · 攻击总伤' + ds.atkDmg + ' · 格挡' + ds.block + ' · 遗物' + ch.relics.length + '件</div>' +
    '<p>要停下挑战最终 Boss 吗？击败它即赢得竞速，战败则死亡！</p>';
  return modal({
    title: '👁️ 经过异变核心', html: html,
    buttons: [
      { label: '⚔️ 停下挑战！', value: 'go', cls: 'danger' },
      { label: '🏃 继续前进', value: 'no', cls: 'blue' },
    ],
  }).then(function (v) {
    if (v === 'go') {
      logMsg('【' + CHARS[id].name + '】⚔️ 在途中向异变核心发起挑战！', 'sys');
      return doCombat(id, makeBoss(G), 'boss', ctx).then(function () { return true; });
    }
    return false;
  });
}

/* 后退（迷雾事件）：沿主路前驱回退，不触发落点与起点 */
var PREV = (function () {
  var p = {};
  for (var i = 0; i < 24; i++) p[i] = (i + 23) % 24;
  p['S0'] = 4; p['S1'] = 'S0'; p['S2'] = 'S1'; p['D0'] = 16; p['D1'] = 'D0';
  return p;
})();
function walkBack(id, steps, ctx) {
  var ch = charOf(G, id);
  var chain = Promise.resolve();
  for (var s = 0; s < steps; s++) {
    chain = chain.then(function () {
      ch.pos = PREV[ch.pos];
      updateTokens(); sfx('step'); renderPanels();
      return D(220);
    });
  }
  return chain;
}

/* ================= 落点结算 ================= */
function resolveLanding(id, nodeId, ctx, depth) {
  depth = depth || 0;
  if (depth > 4) return Promise.resolve(); // 防连锁过深
  var ch = charOf(G, id), n = nodeById(nodeId);
  highlightTile(nodeId, true);
  setTimeout(function () { highlightTile(nodeId, false); }, 1200);
  logMsg('【' + CHARS[id].name + '】落点：' + n.icon + ' ' + n.name, 'land');
  renderAll();
  var done = function (msgs) {
    (msgs || []).forEach(function (m) { logMsg('【' + CHARS[id].name + '】' + m); ctx.collect.push(m); });
    renderAll();
    return D(250);
  };
  switch (n.kind) {
    case 'start': {
      var msgs = landStartMsgs(ch);
      sfx('coin');
      if (!ctx.auto) msgs.forEach(function (m) { toast(m, 2000); });
      return done(msgs);
    }
    case 'gold': {
      addGold(G, ch, n.amount); sfx('coin');
      var m = '💰 获得' + n.amount + '金币！（当前' + ch.gold + '）';
      if (!ctx.auto) toast(m, 1600);
      return done([m]);
    }
    case 'vault': {
      addGold(G, ch, n.amount);
      var d = randomDice(G); ch.dice[d]++;
      sfx('coin');
      var m2 = '💎 宝库大丰收！+' + n.amount + '金币，获得骰具【' + DICE_DEFS[d].name + '】！';
      if (!ctx.auto) toast(m2, 2200);
      return done([m2]);
    }
    case 'chest': {
      var rid = genRelic(G, 'mid');
      var r = addRelic(G, ch, rid); sfx('relic');
      if (!ctx.auto) toast('🎁 ' + r.msg, 2400);
      return done(['🎁 开启宝箱：' + r.msg]);
    }
    case 'fight': return doCombat(id, makeEnemy(G, pick(G, ENEMIES_NORMAL)), 'normal', ctx);
    case 'elite': return doEliteTile(id, nodeId, ctx);
    case 'fork': {
      if (n.fight) return doCombat(id, makeEnemy(G, pick(G, ENEMIES_NORMAL)), 'normal', ctx);
      return doEvent(id, ctx);
    }
    case 'event': return doEvent(id, ctx);
    case 'draft': return doDraft(id, [60, 30, 10], '🃏 干员招募：免费三选一', ctx);
    case 'rest': return doRest(id, ctx);
    case 'shop': return doShop(id, ctx);
    case 'boss': return doBossTile(id, ctx);
    case 'building': return doBuilding(id, nodeId, ctx);
    default: return done([]);
  }
}

/* ---- 建筑 ---- */
function doBuilding(id, nodeId, ctx) {
  var ch = charOf(G, id), n = nodeById(nodeId), b = G.buildings[nodeId];
  if (!b) {
    // 无主：买 / 不买
    if (ctx.auto) {
      if (aiBuyBuilding(buildAIView(G, id), nodeId) && ch.gold >= n.price) {
        ch.gold -= n.price; G.buildings[nodeId] = { owner: id, level: 1 }; ch.buildings.push(nodeId);
        sfx('coin');
        return finishMsg(ctx, id, '🏠 花费' + n.price + '金币买下【' + n.name + '】！过路费' + tollFor(nodeId, 1, ch) + '。');
      }
      return finishMsg(ctx, id, '🏠 放弃购买【' + n.name + '】（' + n.price + '金币）。');
    }
    var html = '<p>【' + n.name + '】售价 <b>' + n.price + '</b> 金币（你当前 ' + ch.gold + '）。</p>' +
      '<p>拥有后：对手落点需支付过路费 Lv1=' + tollFor(nodeId, 1, null) + '；每圈为你带来收入；可升级提高 toll。</p>';
    return modal({ title: '🏠 ' + n.name + '（无主）', html: html, buttons: [
      { label: '购买（' + n.price + 'G）', value: 'buy', cls: 'primary', disabled: ch.gold < n.price },
      { label: '放弃', value: 'no' },
    ] }).then(function (v) {
      if (v === 'buy') {
        ch.gold -= n.price; G.buildings[nodeId] = { owner: id, level: 1 }; ch.buildings.push(nodeId);
        sfx('coin');
        toast('🏠 买下【' + n.name + '】！', 2000);
        return finishMsg(ctx, id, '🏠 花费' + n.price + '金币买下【' + n.name + '】！');
      }
      return finishMsg(ctx, id, '🏠 放弃购买【' + n.name + '】。');
    });
  }
  if (b.owner === id) {
    // 自己的：升级？
    if (b.level >= 3) return finishMsg(ctx, id, '🏠 【' + n.name + '】已满级，好好收租吧！');
    var cost = upgradeCost(nodeId, b.level);
    if (ctx.auto) {
      if (aiUpgradeBuilding(buildAIView(G, id), nodeId) && ch.gold >= cost) {
        ch.gold -= cost; b.level++;
        return finishMsg(ctx, id, '🏠 花费' + cost + '金币将【' + n.name + '】升级到 Lv' + b.level + '！过路费' + tollFor(nodeId, b.level, ch) + '。');
      }
      return finishMsg(ctx, id, '🏠 巡视自己的【' + n.name + '】（Lv' + b.level + '）。');
    }
    return modal({ title: '🏠 ' + n.name + '（你的 Lv' + b.level + '）', html: '<p>升级到 Lv' + (b.level + 1) + ' 需要 <b>' + cost + '</b> 金币（你当前 ' + ch.gold + '），过路费将提升到 ' + tollFor(nodeId, b.level + 1, ch) + '。</p>', buttons: [
      { label: '升级（' + cost + 'G）', value: 'up', cls: 'primary', disabled: ch.gold < cost },
      { label: '离开', value: 'no' },
    ] }).then(function (v) {
      if (v === 'up') { ch.gold -= cost; b.level++; sfx('coin'); toast('🏠 升级成功！', 1800); return finishMsg(ctx, id, '🏠 【' + n.name + '】升级到 Lv' + b.level + '！'); }
      return finishMsg(ctx, id, '🏠 巡视自己的【' + n.name + '】。');
    });
  }
  // 对手的：交租
  var owner = charOf(G, b.owner);
  var toll = tollFor(nodeId, b.level, owner);
  var paid = Math.min(ch.gold, toll);
  ch.gold -= paid; addGold(G, owner, paid);
  sfx('coin');
  var msg = '🏠 踩中' + CHARS[b.owner].name + '的【' + n.name + ' Lv' + b.level + '】，支付过路费' + paid + '金币！';
  if (paid < toll) {
    var short = toll - paid, dmg = Math.ceil(short / 4);
    msg += '金币不足，剩余' + short + '转为' + dmg + '点生命损失！';
    var res = damageChar(G, ch, dmg);
    sfx('hurt');
    if (res.died) { msg += '💀 ' + CHARS[id].name + '倒下了……'; }
  }
  if (!ctx.auto) toast(msg, 2400);
  return finishMsg(ctx, id, msg);
}
function finishMsg(ctx, id, m) {
  logMsg('【' + CHARS[id].name + '】' + m);
  ctx.collect.push(m);
  renderAll();
  return D(300);
}

/* ---- 事件 ---- */
function doEvent(id, ctx) {
  var ch = charOf(G, id);
  var ev = pick(G, EVENTS);
  logMsg('【' + CHARS[id].name + '】❓ 遭遇事件：' + ev.icon + ' ' + ev.name, 'land');
  if (!ev.choices) {
    return applyEventEffect(id, ev.effect, ctx, ev).then(function (msgs) {
      if (!ctx.auto) return modal({ title: ev.icon + ' ' + ev.name, html: '<p>' + ev.text + '</p><p>' + msgs.join('<br>') + '</p>', buttons: [{ label: '继续', value: 1, cls: 'primary' }] }).then(function () { renderAll(); });
      msgs.forEach(function (m) { ctx.collect.push(m); });
      renderAll();
    });
  }
  if (ctx.auto) {
    var idx = aiEvent(buildAIView(G, id), ev);
    ctx.collect.push('❓ 事件【' + ev.name + '】：选择「' + ev.choices[idx].label + '」');
    return applyEventEffect(id, ev.choices[idx].effect, ctx, ev).then(function (msgs) {
      msgs.forEach(function (m) { ctx.collect.push(m); });
      renderAll();
    });
  }
  var html = '<p>' + ev.text + '</p>';
  return modal({
    title: ev.icon + ' ' + ev.name, html: html,
    buttons: ev.choices.map(function (c, i) {
      var dis = false;
      if (c.need) {
        if (c.need.gold && ch.gold < c.need.gold) dis = true;
        if (c.need.hp && ch.hp < c.need.hp) dis = true;
      }
      return { label: c.label, value: i, disabled: dis };
    }),
  }).then(function (idx) {
    return applyEventEffect(id, ev.choices[idx].effect, ctx, ev).then(function (msgs) {
      return modal({ title: ev.icon + ' ' + ev.name, html: '<p>' + msgs.join('<br>') + '</p>', buttons: [{ label: '继续', value: 1, cls: 'primary' }] }).then(function () { renderAll(); });
    });
  });
}
