/* ============================================================
 * test/smoke.js —— 浏览器冒烟测试（node + jsdom）
 * 加载真实页面、开局、用通用点击器自动游玩数轮，断言无未捕获异常。
 * 运行：npm install jsdom && node test/smoke.js [seed] [maxRounds]
 * 无 jsdom 时自动跳过（exit 0）。
 * ============================================================ */
'use strict';
var JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.log('SKIP smoke: jsdom not installed (run: npm install jsdom)');
  process.exit(0);
}
var path = require('path');
var ROOT = path.join(__dirname, '..');
var SEED = process.argv[2] || 'smoke-1';
var MAXROUNDS = +(process.argv[3] || 4);

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function click(el, why, doc) {
  if (!el) return false;
  try {
    el.click();
    return true;
  } catch (e) {
    console.log('click failed (' + why + '): ' + (e && e.message));
    return false;
  }
}

var fs = require('fs');
var htmlRaw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// jsdom 的 CSS 解析器在某些规则下会栈溢出；冒烟测试只验证逻辑，去掉样式表
htmlRaw = htmlRaw.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '');
var dom = new JSDOM(htmlRaw, {
  url: 'file://' + path.join(ROOT, 'index.html'),
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
});
(async function () {
  var window = dom.window, document = window.document;
  var errors = [];
  window.addEventListener('error', function (e) {
    errors.push('window.onerror: ' + (e.message || (e.error && e.error.stack) || 'unknown'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    errors.push('unhandledrejection: ' + ((r && (r.stack || r.message || r)) || 'unknown'));
  });

  await sleep(2000); // 等脚本加载执行
  if (!document.querySelector('#btn-start')) {
    console.log('SMOKE FAIL: start screen did not render');
    process.exit(1);
  }
  // 4 倍速 + 开局
  document.querySelector('#seed-input').value = SEED;
  document.querySelector('#btn-speed').click();
  document.querySelector('#btn-start').click();
  await sleep(1500);
  if (!window.G) {
    console.log('SMOKE FAIL: game did not start (G undefined). errors=' + JSON.stringify(errors.slice(0, 3)));
    process.exit(1);
  }
  console.log('smoke: game started, seed=' + SEED);
  // 诊断：统计 updateTokens/renderAll 调用
  try {
    window.__ut = 0; window.__ra = 0;
    (function () {
      var origUT = window.updateTokens, origRA = window.renderAll;
      window.updateTokens = function () { window.__ut++; return origUT.apply(null, arguments); };
      window.renderAll = function () { window.__ra++; return origRA.apply(null, arguments); };
    })();
  } catch (e) { console.log('wrap fail: ' + e.message); }

  var t0 = Date.now(), TIMEOUT = 8 * 60 * 1000, actions = 0, combats = 0, autoOn = false;
  var lastPhaseLog = 0;

  function modalShown() { return document.querySelector('#modal-root.show'); }
  function combatShown() {
    var co = document.querySelector('#combat-overlay');
    return co && !co.classList.contains('hidden') && co.innerHTML.length > 50 ? co : null;
  }

  while (Date.now() - t0 < TIMEOUT) {
    if (errors.length) break;
    var g = window.G;
    if (g.over) { console.log('smoke: game over: ' + g.over.reason); break; }
    if (g.round > MAXROUNDS) { console.log('smoke: reached round ' + g.round); break; }
    if (Date.now() - lastPhaseLog > 5000) {
      lastPhaseLog = Date.now();
      console.log('... round=' + g.round + ' phase=' + g.phase + ' P(hp' + g.chars.player.hp + ' pos' + g.chars.player.pos + ') A(hp' + g.chars.ai.hp + ' pos' + g.chars.ai.pos + ') actions=' + actions +
        ' modal=' + (!!modalShown()) + ' combat=' + (!!combatShown()) + ' ut=' + window.__ut + ' ra=' + window.__ra);
    }
    var acted = false;
    // 1) AI 回合：一律点跳过（逻辑照常执行，只省动画）
    var skipBtn = document.querySelector('#btn-skip');
    if (g.phase === 'ai' && skipBtn && !skipBtn.classList.contains('hidden')) {
      acted = click(skipBtn, 'skip-ai', document) || acted;
      await sleep(600);
      continue;
    }
    // 2) 战斗界面：开自动战斗
    var co = combatShown();
    if (co) {
      combats++;
      var autoBtn = co.querySelector('#c-auto');
      if (autoBtn && autoBtn.textContent.indexOf('自动战斗') >= 0 && autoBtn.textContent.indexOf('取消') < 0) {
        acted = click(autoBtn, 'auto-battle', document) || acted;
        autoOn = true;
      }
      await sleep(700);
      continue;
    }
    autoOn = false;
    // 3) 弹窗：按优先级点
    var m = modalShown();
    if (m) {
      var done = false;
      // 信标（评估 favorable 才点，否则走正常骰子）
      var beacon = m.querySelector('[data-d="beacon"]');
      if (beacon && !beacon.disabled) {
        var t = beacon.textContent || '';
        if (t.indexOf('凶险') < 0) { done = click(beacon, 'beacon', document); }
      }
      if (!done) {
        var pri = ['.dicebtn:not([disabled])', '.numbtn:not([disabled])', '.dirbtn:not([disabled])',
          '.card-list.pick .card:not(.disabled)', '[data-buy-relic]:not([disabled])',
          '[data-buy-card]:not([disabled])', '[data-buy-dice]:not([disabled])',
          '[data-buy-heal]:not([disabled])', '[data-buy-remove]:not([disabled])',
          '[data-buy-upgrade]:not([disabled])'];
        for (var i = 0; i < pri.length && !done; i++) {
          var el = m.querySelector(pri[i]);
          if (el) done = click(el, pri[i], document);
        }
      }
      if (!done) {
        // 休息 modal：升级无牌可点时切删除模式或回血
        var rm = m.querySelector('#mode-rm');
        var heal = m.querySelector('#rest-heal');
        if (rm && heal) {
          var anyCard = m.querySelector('.card-list.pick .card:not(.disabled)');
          if (!anyCard) {
            var hint = m.querySelector('#rest-hint');
            if (hint && hint.textContent.indexOf('升级') >= 0) done = click(rm, 'rest-rm-mode', document);
            else done = click(heal, 'rest-heal', document);
          }
        }
      }
      if (!done) {
        // 通用按钮（第一个可用）
        var btns = m.querySelectorAll('.modal-btns .btn:not([disabled])');
        if (btns.length) done = click(btns[0], 'modal-btn:' + (btns[0].textContent || '').slice(0, 8), document);
      }
      if (done) { actions++; await sleep(500); continue; }
      await sleep(400);
      continue;
    }
    await sleep(400);
  }

  var g2 = window.G;
  console.log('smoke done: rounds=' + (g2 && g2.round) + ' actions=' + actions + ' combatSteps=' + combats +
    ' over=' + (g2 && g2.over ? g2.over.reason : 'no') + ' errors=' + errors.length);
  if (errors.length) {
    console.log('SMOKE FAIL with errors:');
    errors.slice(0, 8).forEach(function (e) { console.log('  - ' + String(e).slice(0, 400)); });
    process.exit(1);
  }
  if (g2 && (g2.round >= 2 || g2.over)) {
    console.log('SMOKE PASSED');
    process.exit(0);
  }
  console.log('SMOKE FAIL: game did not advance (round=' + (g2 && g2.round) + ')');
  process.exit(1);
})().catch(function (e) {
  console.log('SMOKE FAIL(harness): ' + ((e && e.stack) || e));
  process.exit(1);
});
