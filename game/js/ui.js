/* 百妖灯阵 — DOM UI, input, sound */
(function () {
'use strict';
const C = window.Core;
const { UNITS, SKILLS, ENEMIES, RELICS, EVENTS, CLASS_ORDER, CLASS_COLOR,
        CLASS_GLYPH, CLASS_INFO, D } = C;

const $ = id => document.getElementById(id);

/* ---------------- tiny synth ---------------- */
const Sfx = {
  ctx: null, muted: false,
  ac() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(f, dur, type, vol, delay) {
    if (this.muted) return;
    const ac = this.ac(); if (!ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(vol || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  deploy() { this.tone(520, 0.08, 'triangle', 0.07); this.tone(780, 0.1, 'triangle', 0.06, 0.06); },
  hit() { this.tone(190, 0.05, 'square', 0.025); },
  kill() { this.tone(300, 0.12, 'triangle', 0.05); this.tone(180, 0.16, 'triangle', 0.04, 0.05); },
  leak() { this.tone(90, 0.4, 'sine', 0.12); this.tone(60, 0.5, 'sine', 0.1, 0.05); },
  skill() { this.tone(660, 0.14, 'sine', 0.06); this.tone(990, 0.2, 'sine', 0.05, 0.05); },
  wave() { this.tone(130, 0.9, 'sine', 0.1); this.tone(196, 0.7, 'sine', 0.05, 0.02); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.08, i * 0.13)); },
  lose() { [330, 262, 196, 147].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.09, i * 0.16)); },
  click() { this.tone(880, 0.04, 'triangle', 0.04); },
};

function starStr(n) { return '★'.repeat(n); }
function rarClass(r) { return 'r' + r; }
function relicIcon(r) { return r.rarity === 3 ? '🔥' : r.rarity === 2 ? '🌀' : '🪔'; }

class UI {
  constructor(app) {
    this.app = app;
    this.lastHud = {};
    this.cardTab = 'ALL';
    this.cardEls = {};
    this._wire();
  }
  el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  _wire() {
    window.addEventListener('keydown', ev => this.app.onKey(ev));
    $('btn-pause').addEventListener('click', () => this.app.togglePause());
    $('btn-speed').addEventListener('click', () => this.app.cycleSpeed());
    $('btn-mute').addEventListener('click', () => this.app.toggleMute());
    $('m-start').addEventListener('click', () => { Sfx.click(); this.app.startRun(); });
    $('m-meta').addEventListener('click', () => { Sfx.click(); this.app.openMeta(); });
    $('m-codex').addEventListener('click', () => { Sfx.click(); this.app.openCodex(); });
    $('m-help').addEventListener('click', () => { Sfx.click(); this.app.openHelp(); });
    $('meta-back').addEventListener('click', () => this.app.backToTitle());
    $('codex-back').addEventListener('click', () => this.app.backToTitle());
    $('help-back').addEventListener('click', () => this.app.backToTitle());
    document.querySelectorAll('#codex-tabs button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#codex-tabs button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        this.app.renderCodex(b.dataset.t);
      });
    });
    const cv = $('cv');
    cv.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect();
      this.app.onCanvasDown(ev.clientX - r.left, ev.clientY - r.top, ev.button);
    });
    cv.addEventListener('pointermove', ev => {
      const r = cv.getBoundingClientRect();
      this.app.onCanvasMove(ev.clientX - r.left, ev.clientY - r.top);
    });
    cv.addEventListener('contextmenu', ev => { ev.preventDefault(); this.app.cancelPlacing(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.app.inBattle()) this.app.togglePause(true);
    });
  }

  /* ---------------- screens ---------------- */
  showScreen(name) {
    ['title', 'meta', 'codex', 'help'].forEach(s => $(s).classList.toggle('hidden', s !== name));
    const inBattle = name === null;
    $('hud').classList.toggle('hidden', !inBattle);
    $('dock').classList.toggle('hidden', !inBattle);
    if (inBattle) this.hideSide();
  }
  showHud(on) { $('hud').classList.toggle('hidden', !on); $('dock').classList.toggle('hidden', !on); }

  updateHud(g) {
    const L = this.lastHud;
    const set = (id, v) => { if (L[id] !== v) { L[id] = v; $(id).textContent = v; } };
    set('hud-stage', `夜巡 ${g.n}/${D.waves.curve.stageCount}`);
    set('hud-lamp', `灯焰 Lv.${this.app.lampLevel}`);
    const hpw = Math.max(0, g.baseHp / g.baseMaxHp * 100);
    if (L.hp !== hpw) { L.hp = hpw; $('hp-fill').style.width = hpw + '%'; }
    set('hp-num', Math.max(0, Math.ceil(g.baseHp)) + '/' + g.baseMaxHp);
    set('oil-num', Math.floor(g.oil));
    set('hud-wave', `波 ${Math.max(1, g.waveIdx + 1)}/${g.totalWaves()}` + (g.phase === 'prep' ? ' · 备战' : ''));
    const cap = g.units.length + '/' + g.deployCap;
    set('hud-cap', cap);
    if (L.cap !== cap) { L.cap = cap; }
  }

  /* ---------------- cards ---------------- */
  buildCards() {
    const tabs = $('tabs');
    tabs.innerHTML = '';
    const mkTab = (key, label) => {
      const t = this.el('div', 'tab' + (key === this.cardTab ? ' on' : ''), label);
      t.addEventListener('click', () => {
        this.cardTab = key;
        tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
        this.refreshCards();
        Sfx.click();
      });
      tabs.appendChild(t);
    };
    mkTab('ALL', '全部');
    CLASS_ORDER.forEach(c => mkTab(c, CLASS_INFO[c].name));
    this.refreshCards();
  }
  refreshCards() {
    const box = $('cards');
    box.innerHTML = '';
    this.cardEls = {};
    const g = this.app.game;
    for (const cls of (this.cardTab === 'ALL' ? CLASS_ORDER : [this.cardTab])) {
      const list = this.app.squad.filter(u => u.class === cls).sort((a, b) => a.rarity - b.rarity);
      for (const u of list) {
        const deployed = g && g.units.some(x => x.uid === u.id);
        const cost = g ? g.deployCost(u.id) : u.cost;
        const poor = g && !deployed && g.oil < cost;
        const sk = u.skills.map(s => SKILLS[s.id].name).join('·');
        const card = this.el('div', 'card' + (poor ? ' poor' : ''));
        card.innerHTML =
          `<div class="c-cost">${cost}</div>` +
          `<div class="c-star">${'★'.repeat(u.rarity)}</div>` +
          `<div class="c-glyph"><svg viewBox="0 0 40 40">` +
          `<circle cx="20" cy="20" r="17" fill="${this._rgba(CLASS_COLOR[u.class], 0.16)}" stroke="${CLASS_COLOR[u.class]}" stroke-width="1.6"/>` +
          `<text x="20" y="26" text-anchor="middle" font-size="17" fill="${CLASS_COLOR[u.class]}" font-family="serif">${CLASS_GLYPH[u.class]}</text>` +
          `</svg></div>` +
          `<div class="c-name">${u.name}</div>` +
          `<div class="c-class">${CLASS_INFO[u.class].name}</div>` +
          `<div class="c-skills">${sk}</div>` +
          (deployed ? '<div class="c-deployed">已布灯</div>' : '');
        card.addEventListener('click', () => {
          if (deployed) { this.app.selectUnit(g.units.find(x => x.uid === u.id)); return; }
          this.app.selectCard(u.id);
          Sfx.click();
        });
        box.appendChild(card);
        this.cardEls[u.id] = card;
      }
    }
  }
  clearCards() { $('cards').innerHTML = ''; }
  _rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------------- side panel ---------------- */
  showSide(u) {
    const s = $('side');
    const arch = UNITS[u.uid];
    const skLines = u.skills.map(sk => {
      const s2 = SKILLS[sk.id];
      const p = s2.trigger === 'PASSIVE'
        ? '被动'
        : `<span class="s-sp"><i style="width:${Math.min(100, u.sp / s2.spCost * 100)}%"></i></span>
           ${s2.spCost} 充能 · ${s2.duration ? '持续' + s2.duration + '秒' : '瞬间'}`;
      return `<div class="s-skill"><span class="sk-name">${s2.name}</span> — ${s2.desc}<br>${p}</div>`;
    }).join('');
    s.innerHTML =
      `<h4>${arch.name} · ${CLASS_INFO[arch.class].name}${starStr(arch.rarity)}</h4>` +
      `<div class="s-row"><span>生命</span><b>${Math.ceil(u.hp)}/${u.maxHp}</b></div>` +
      `<div class="s-row"><span>攻击</span><b>${u.atk}</b></div>` +
      `<div class="s-row"><span>防御</span><b>${u.def}</b></div>` +
      `<div class="s-row"><span>法抗</span><b>${u.res}</b></div>` +
      `<div class="s-row"><span>阻挡</span><b>${u.block || '—'}</b></div>` +
      `<div class="s-row"><span>攻速</span><b>${(1 / u.atkTime).toFixed(2)}/s</b></div>` +
      skLines +
      `<div class="s-btns">
        <button class="btn" id="s-recall">撤收 +${Math.floor(arch.cost * 0.8)}油</button>
        <button class="btn" id="s-close">关闭</button>
      </div>`;
    s.classList.remove('hidden');
    $('s-recall').addEventListener('click', () => this.app.recallSelected());
    $('s-close').addEventListener('click', () => this.hideSide());
  }
  hideSide() { $('side').classList.add('hidden'); }

  /* ---------------- tooltip ---------------- */
  showTip(x, y, e) {
    const t = $('tip');
    const a = e.arch;
    const traitNames = { regen: '再生', shield: '硬壳', summon: '唤俑', swift: '迅捷', slow: '迟缓',
      poison: '毒素', armored: '重甲', aoe: '范围', enrage: '狂化', phase: '变身', boss: '首领' };
    t.innerHTML =
      `<div class="t-name ${a.kind === 'fly' ? 'fly' : ''}">${a.name}${a.role === 'boss' ? ' · 首领' : a.role === 'elite' ? ' · 精英' : ''}</div>` +
      `<div class="t-line">生命 ${Math.ceil(e.hp)}/${e.maxHp}${e.shield > 0 ? `（壳 ${Math.ceil(e.shield)}）` : ''}</div>` +
      `<div class="t-line">攻击 ${e.atk} · 防御 ${e.def}${e.res ? ' · 法抗 ' + e.res : ''}</div>` +
      `<div class="t-line">${a.kind === 'fly' ? '飞行' : '地面'} · 击杀+${e.reward}油</div>` +
      (a.traits.length ? `<div class="t-line">特性：${a.traits.map(t2 => traitNames[t2] || t2).join('、')}</div>` : '');
    t.style.left = Math.min(x + 14, window.innerWidth - 230) + 'px';
    t.style.top = Math.min(y + 10, window.innerHeight - 130) + 'px';
    t.classList.remove('hidden');
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  hideTip() { $('tip').classList.add('hidden'); }

  /* ---------------- modal ---------------- */
  modal(html, opts) {
    const m = $('modal');
    m.innerHTML = `<div class="m-box">${html}</div>`;
    m.classList.remove('hidden');
    return m;
  }
  closeModal() { $('modal').classList.add('hidden'); $('modal').innerHTML = ''; }

  relicPick(relics, onPick) {
    const picks = relics.map(r =>
      `<div class="pick" data-id="${r.id}">
        <div class="p-rar ${rarClass(r.rarity)}">${r.rarity === 3 ? '绯 · 上' : r.rarity === 2 ? '青 · 中' : '素 · 下'}</div>
        <div class="p-icon">${relicIcon(r)}</div>
        <div class="p-name">${r.name}</div>
        <div class="p-desc">${r.desc}</div>
      </div>`).join('');
    const m = this.modal(`<h2>获得法器</h2><div class="m-sub">选择一件，整夜巡有效</div>
      <div class="pick-row">${picks}</div>
      <div class="m-btns"><button class="btn" id="m-skip">放弃</button></div>`);
    m.querySelectorAll('.pick').forEach(p => p.addEventListener('click', () => {
      Sfx.skill();
      onPick(RELICS[p.dataset.id]);
    }));
    $('m-skip').addEventListener('click', () => { Sfx.click(); onPick(null); });
  }
  eventPick(onPick) {
    const picks = EVENTS.map(ev =>
      `<div class="pick" data-id="${ev.id}">
        <div class="p-icon">🏮</div>
        <div class="p-name">${ev.name}</div>
        <div class="p-desc">${ev.desc}</div>
      </div>`).join('');
    const m = this.modal(`<h2>聚焰</h2><div class="m-sub">灯下的低语，给出四种可能</div>
      <div class="pick-row">${picks}</div>`);
    m.querySelectorAll('.pick').forEach(p => p.addEventListener('click', () => {
      Sfx.skill();
      onPick(EVENTS.find(e => e.id === p.dataset.id));
    }));
  }
  unitPickForUpgrade(used, onPick) {
    const list = this.app.squad.filter(u => !used.has(u.id));
    const picks = list.map(u =>
      `<div class="pick" data-id="${u.id}">
        <div class="p-rar r${Math.min(3, Math.ceil(u.rarity / 2))}">${'★'.repeat(u.rarity)}</div>
        <div class="p-name">${u.name}</div>
        <div class="p-desc">${CLASS_INFO[u.class].name} · 攻 ${u.atk} 生 ${u.hp}</div>
      </div>`).join('');
    const m = this.modal(`<h2>淬炼灯灵</h2><div class="m-sub">选择一名灯灵：攻击+25%，生命+25%</div>
      <div class="pick-row">${picks}</div>
      <div class="m-btns"><button class="btn" id="m-skip">算了</button></div>`);
    m.querySelectorAll('.pick').forEach(p => p.addEventListener('click', () => {
      Sfx.skill();
      onPick(p.dataset.id);
    }));
    $('m-skip').addEventListener('click', () => { Sfx.click(); onPick(null); });
  }
  stageClear(n, win, ember, exp, isLast, onContinue) {
    const html = `
      <div class="m-big">${win ? '🏮' : '💀'}</div>
      <h2>${win ? (isLast ? '浊潮退散' : '夜巡 · ' + n + ' 段 守住') : '灯心熄灭'}</h2>
      <div class="m-sub">${win ? '灯火未灭，浊妖退去' : '这一夜的灯阵，到此为止'}</div>
      <div class="reward-lines">
        ${win ? `残焰 +<b>${ember}</b>　·　灯焰经验 +<b>${exp}</b><br>` : `止步于第 <b>${n}</b> 段（共 18 段）`}
      </div>
      <div class="m-btns"><button class="btn big" id="m-next">${win ? '继续夜巡' : '返回'}</button></div>`;
    const m = this.modal(html);
    $('m-next').addEventListener('click', () => { Sfx.click(); onContinue(); });
  }
  runSummary(win, stages, flame, onAgain, onMenu) {
    const m = this.modal(`
      <div class="m-big">${win ? '🌅' : '🌑'}</div>
      <h2>${win ? '天将明' : '长夜未明'}</h2>
      <div class="m-sub">${win ? '十八段夜巡走完，浊潮缩回裂隙' : '下次，把灯阵布得更远一些'}</div>
      <div class="reward-lines">
        止步 <b>${stages}/18</b> 段 · 本轮残焰 <b>+${flame}</b>
      </div>
      <div class="m-btns">
        <button class="btn" id="m-again">再夜巡</button>
        <button class="btn" id="m-menu">回主菜单</button>
      </div>`);
    $('m-again').addEventListener('click', () => { Sfx.click(); onAgain(); });
    $('m-menu').addEventListener('click', () => { Sfx.click(); onMenu(); });
  }

  /* ---------------- meta screen ---------------- */
  renderMeta() {
    const M = this.app.meta;
    $('meta-flame').textContent = M.flame;
    const up = $('meta-upgs');
    up.innerHTML = '';
    for (const u of D.meta.upgrades) {
      const lvl = M.upg[u.id.replace('up_', '')] || 0;
      const row = this.el('div', 'upg-row');
      row.innerHTML = `<span class="u-name">${u.name}</span>
        <span class="u-lvl">${'●'.repeat(lvl)}${'○'.repeat(u.max - lvl)}</span>
        <span class="u-desc">${u.desc}</span>`;
      if (lvl < u.max) {
        const cost = u.costs[lvl];
        const btn = this.el('button', 'btn tiny', `强化 ${cost}焰`);
        if (M.flame < cost) btn.style.opacity = 0.45;
        btn.addEventListener('click', () => {
          if (M.flame < cost) return;
          M.flame -= cost;
          M.upg[u.id.replace('up_', '')] = lvl + 1;
          this.app.saveMeta();
          Sfx.skill();
          this.renderMeta();
        });
        row.appendChild(btn);
      }
      up.appendChild(row);
    }
    const box = $('meta-unlocks');
    box.innerHTML = '';
    for (const cls of CLASS_ORDER) {
      const units = Object.values(UNITS).filter(u => u.class === cls).sort((a, b) => a.rarity - b.rarity);
      for (const u of units) {
        const owned = !!M.unlocks[u.id];
        const row = this.el('div', 'unlock-row');
        row.innerHTML = `<span class="u-name">${u.name}</span>
          <span class="u-tag">${CLASS_INFO[cls].name} ${'★'.repeat(u.rarity)}</span>` +
          (owned ? `<span class="owned">已入阵</span>`
                 : `<span class="u-cost">${this.app.unlockCost(u.rarity)} 焰</span>`);
        if (!owned) {
          const cost = this.app.unlockCost(u.rarity);
          const btn = this.el('button', 'btn tiny', `解锁`);
          if (M.flame < cost) btn.style.opacity = 0.45;
          btn.addEventListener('click', () => {
            if (M.flame < cost) return;
            M.flame -= cost;
            M.unlocks[u.id] = 1;
            this.app.saveMeta();
            Sfx.skill();
            this.renderMeta();
          });
          row.appendChild(btn);
        }
        box.appendChild(row);
      }
    }
  }

  /* ---------------- codex ---------------- */
  renderCodex(tab) {
    const box = $('codex-body');
    box.innerHTML = '';
    const grid = this.el('div', 'codex-grid');
    if (tab === 'units') {
      for (const cls of CLASS_ORDER) {
        const h = this.el('h3', '', CLASS_INFO[cls].name + ' · ' + CLASS_INFO[cls].role);
        box.appendChild(h);
        const g = this.el('div', 'codex-grid');
        for (const u of Object.values(UNITS).filter(x => x.class === cls).sort((a, b) => a.rarity - b.rarity)) {
          const owned = !!this.app.meta.unlocks[u.id];
          g.appendChild(this.el('div', 'cx-card',
            `<div class="cx-name" style="color:${CLASS_COLOR[cls]}">${u.name} ${'★'.repeat(u.rarity)} ${owned ? '' : '<span style="color:#5f6b95">（未解锁）</span>'}</div>
             <div class="cx-stat">生 ${u.hp} · 攻 ${u.atk} · 防 ${u.def} · 油 ${u.cost} · 阻 ${u.block || '—'}</div>
             <div class="cx-desc">${u.skills.map(s => SKILLS[s.id].name).join(' / ')}</div>`));
        }
        box.appendChild(g);
      }
    } else if (tab === 'skills') {
      for (const cls of CLASS_ORDER) {
        const g = this.el('div', 'codex-grid');
        for (const s of D.skills.filter(x => x.class === cls)) {
          g.appendChild(this.el('div', 'cx-card',
            `<div class="cx-name" style="color:${CLASS_COLOR[cls]}">${s.name}</div>
             <div class="cx-sub">${s.trigger === 'PASSIVE' ? '被动' : '充能 ' + s.spCost + (s.duration ? ' · 持续 ' + s.duration + 's' : '')}</div>
             <div class="cx-desc">${s.desc}</div>`));
        }
        box.appendChild(this.el('h3', '', CLASS_INFO[cls].name));
        box.appendChild(g);
      }
    } else if (tab === 'enemies') {
      for (const e of D.enemies.enemies) {
        grid.appendChild(this.el('div', 'cx-card',
          `<div class="cx-name" style="color:${e.role === 'boss' ? '#ff3860' : e.role === 'elite' ? '#ff9d5c' : '#c7cfe8'}">${e.name}</div>
           <div class="cx-sub">${e.kind === 'fly' ? '飞行' : '地面'} · ${e.role === 'boss' ? '首领' : e.role === 'elite' ? '精英' : '基本'}</div>
           <div class="cx-stat">生 ${e.hp} · 攻 ${e.atk} · 防 ${e.def}${e.res ? ' · 抗 ' + e.res : ''}</div>
           <div class="cx-desc">${e.traits.join(' / ') || '—'}</div>`));
      }
      box.appendChild(grid);
    } else if (tab === 'relics') {
      for (const r of D.relics.relics) {
        grid.appendChild(this.el('div', 'cx-card',
          `<div class="cx-name" style="color:${r.rarity === 3 ? '#ff9d5c' : r.rarity === 2 ? '#6db8ff' : '#cfd8ff'}">${r.name}</div>
           <div class="cx-sub">${r.rarity === 3 ? '绯 · 上' : r.rarity === 2 ? '青 · 中' : '素 · 下'}</div>
           <div class="cx-desc">${r.desc}</div>`));
      }
      box.appendChild(grid);
    }
  }

  banner(txt) {
    let b = $('wave-banner');
    if (!b) { b = this.el('div', '', ''); b.id = 'wave-banner'; $('app').appendChild(b); }
    b.textContent = txt;
    b.classList.add('show');
    clearTimeout(this._bnT);
    this._bnT = setTimeout(() => b.classList.remove('show'), 1600);
  }
}

window.UI = UI;
window.Sfx = Sfx;
})();
