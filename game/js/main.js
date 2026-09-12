/* 百妖灯阵 — app controller: screens, run loop, meta progression */
(function () {
'use strict';
const C = window.Core;
const { UNITS, SKILLS, EVENTS, D, RNG, rangeCells } = C;
const { Game, rollRelics } = window.Engine;

const META_KEY = 'hyakuyou_lantern_v1';

class App {
  constructor() {
    this.meta = this.loadMeta();
    this.ui = new window.UI(this);
    this.renderer = new window.Renderer($('cv'));
    this.game = null;
    this.screen = 'title';
    this.placing = null;      // unit id being placed
    this.selected = null;     // unit instance
    this.hover = null;
    this.run = null;
    this.lastCardRefresh = 0;
    this.ui.showScreen('title');
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  /* ---------------- meta persistence ---------------- */
  loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        const m = JSON.parse(raw);
        m.upg = Object.assign({ wick: 0, oil: 0, array: 0 }, m.upg || {});
        m.unlocks = m.unlocks || {};
        // default unlocks
        for (const u of D.meta.unlocks)
          if (u.unlocked && !m.unlocks[u.id]) m.unlocks[u.id] = 1;
        return m;
      }
    } catch (e) {}
    const m = { flame: 0, upg: { wick: 0, oil: 0, array: 0 }, unlocks: {} };
    for (const u of D.meta.unlocks) if (u.unlocked) m.unlocks[u.id] = 1;
    return m;
  }
  saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(this.meta)); } catch (e) {}
  }
  unlockCost(rarity) {
    const t = { 1: 0, 2: 25, 3: 60, 4: 140, 5: 300, 6: 600 };
    return t[rarity] || 0;
  }
  get squad() {
    return Object.values(UNITS).filter(u => this.meta.unlocks[u.id]);
  }

  /* ---------------- screens ---------------- */
  inBattle() { return this.screen === 'battle'; }
  backToTitle() {
    this.game = null; this.placing = null; this.selected = null;
    this.ui.hideSide(); this.ui.hideTip(); this.ui.closeModal();
    this.ui.showScreen('title');
    this.screen = 'title';
  }
  openMeta() { this.screen = 'meta'; this.ui.showScreen('meta'); this.ui.renderMeta(); }
  openCodex() { this.screen = 'codex'; this.ui.showScreen('codex'); this.ui.renderCodex('units'); }
  openHelp() { this.screen = 'help'; this.ui.showScreen('help'); }
  renderCodex(t) { this.ui.renderCodex(t); }

  /* ---------------- run flow ---------------- */
  startRun() {
    this.run = {
      stage: 1, relics: [], upgraded: new Set(),
      lampExp: 0, lampLevel: 1, nextStageOil: 0,
      flameGained: 0, seed: (Date.now() % 100000) + 1,
      cleared: 0,
    };
    this.lampLevel = 1;
    this.screen = 'battle';
    this.ui.showScreen(null);
    this.ui.buildCards();
    this.startStage(1, 0);
  }
  lampThresholds() {
    const exps = D.relics.lampLevels.map(l => l.exp);
    const out = [0];
    let sum = 0;
    for (const e of exps) { sum += e * 10; out.push(sum); }
    return out;
  }
  gainLampExp(n) {
    const r = this.run;
    r.lampExp += 12 + 2 * n;
    const th = this.lampThresholds();
    while (r.lampLevel < th.length && r.lampExp >= th[r.lampLevel]) {
      r.lampLevel++;
      const lv = r.lampLevel;
      let bonus = null;
      if (lv === 3 || lv === 6 || lv === 9) bonus = `部署上限 +1`;
      else if (lv === 4 || lv === 8) bonus = `法器选择 +1`;
      else bonus = `初始灯油 +20`;
      this.ui.banner(`灯焰 Lv.${lv} · ${bonus}`);
      window.Sfx.skill();
      if (lv === 4 || lv === 8) r.extraPick = 1;
    }
    this.lampLevel = r.lampLevel;
  }
  startStage(n, nextOil) {
    this.game = new Game({
      n, seed: this.run.seed * 7 + n * 131,
      meta: this.meta.upg,
      relics: this.run.relics,
      lampLevel: this.run.lampLevel,
      upgraded: [...this.run.upgraded],
      nextStageOil: nextOil,
    });
    this.run.stage = n;
    this.placing = null; this.selected = null;
    this.ui.hideSide();
    this.ui.buildCards();
    this.game.onStageStart();
    this.ui.banner(`夜巡 ${n}/18 · ${this.game.plan.boss ? '有首领现世' : '浊妖将至'}`);
    window.Sfx.wave();
  }
  afterStage() {
    const g = this.game;
    const n = g.n;
    const win = g.result === 'win';
    const isLast = n >= D.waves.curve.stageCount;
    let ember = 0, exp = 0;
    if (win) {
      const e = D.meta.earnPerStage;
      const ratio = g.baseHp / g.baseMaxHp;
      ember = e.base + e.perIndex * n;
      for (const [th, bonus] of e.hpBonus) if (ratio >= th) { ember += bonus; break; }
      exp = 12 + 2 * n;
      this.meta.flame += ember;
      this.run.flameGained += ember;
      this.run.cleared = n;
      this.saveMeta();
      this.gainLampExp(n);
      this.ui.banner(`残焰 +${ember} · 灯焰经验 +${exp}`);
    }
    const finishRun = (victory) => {
      this.ui.stageClear(n, victory, ember, exp, isLast, () => {
        this.ui.runSummary(victory, victory ? n : this.run.cleared, this.run.flameGained,
          () => { this.ui.closeModal(); this.startRun(); },
          () => { this.ui.closeModal(); this.backToTitle(); });
      });
    };
    if (!win) { finishRun(false); return; }
    if (isLast) { finishRun(true); return; }
    // event stages 7 & 13, then relic pick
    const isEvent = (n === 7 || n === 13);
    const doRelicPick = () => {
      const count = 3 + (this.run.extraPick ? 1 : 0);
      const picks = rollRelics(new RNG(this.run.seed + n * 977), count, this.run.relics);
      this.ui.relicPick(picks, r => {
        if (r) this.run.relics.push(r.id);
        this.ui.closeModal();
        this.advanceStage();
      });
    };
    if (isEvent) {
      this.ui.eventPick(ev => {
        this.ui.closeModal();
        if (!ev) { doRelicPick(); return; }
        this.applyEvent(ev, doRelicPick);
      });
    } else {
      doRelicPick();
    }
  }
  applyEvent(ev, done) {
    switch (ev.kind) {
      case 'unit_upgrade':
        this.ui.unitPickForUpgrade(this.run.upgraded, uid => {
          if (uid) this.run.upgraded.add(uid);
          done();
        });
        break;
      case 'next_stage_oil':
        this.run.nextStageOil = (this.run.nextStageOil || 0) + (ev.params || 150);
        done();
        break;
      case 'heal_base':
        this.run.baseHeal = true; // applied in startStage via nextStageOil-like flag
        done();
        break;
      case 'relic_reroll':
        if (this.run.relics.length) {
          const removed = this.run.relics.pop();
          const rng = new RNG(this.run.seed + 555);
          const pool = Object.values(C.RELICS).filter(r => r.id !== removed && !this.run.relics.includes(r.id));
          const pick = pool[Math.floor(rng.next() * pool.length)];
          this.run.relics.push(pick.id);
          this.ui.banner(`法器已换：${pick.name}`);
        }
        done();
        break;
    }
  }
  advanceStage() {
    const next = this.run.stage + 1;
    const oil = this.run.nextStageOil || 0;
    this.run.nextStageOil = 0;
    this.startStage(next, oil);
    if (this.run.baseHeal) { this.run.baseHeal = false; this.game.baseHp = this.game.baseMaxHp; }
  }

  /* ---------------- battle actions ---------------- */
  selectCard(uid) {
    this.placing = uid;
    this.selected = null;
    this.ui.hideSide();
  }
  cancelPlacing() { this.placing = null; }
  selectUnit(u) {
    this.selected = u;
    this.placing = null;
    if (u) this.ui.showSide(u);
  }
  recallSelected() {
    if (this.selected && this.game) {
      this.game.recall(this.selected);
      this.selected = null;
      this.ui.hideSide();
    }
  }
  togglePause(force) {
    if (!this.game || this.game.over) return;
    this.game.paused = force !== undefined ? force : !this.game.paused;
    $('btn-pause').textContent = this.game.paused ? '▶' : '❚❚';
  }
  cycleSpeed() {
    if (!this.game) return;
    this.game.speed = this.game.speed === 1 ? 2 : this.game.speed === 2 ? 3 : 1;
    $('btn-speed').textContent = this.game.speed + '×';
  }
  toggleMute() {
    window.Sfx.muted = !window.Sfx.muted;
    $('btn-mute').textContent = window.Sfx.muted ? '×' : '♪';
  }
  onKey(ev) {
    if (this.screen !== 'battle') return;
    if (ev.code === 'Space') { ev.preventDefault(); this.togglePause(); }
    else if (ev.key === '1') this.game && (this.game.speed = 1);
    else if (ev.key === '2') this.game && (this.game.speed = 2);
    else if (ev.key === '3') this.game && (this.game.speed = 3);
    else if (ev.key === 'r' || ev.key === 'R') this.recallSelected();
    else if (ev.key === 'm' || ev.key === 'M') this.toggleMute();
    else if (ev.key === 'Escape') { this.cancelPlacing(); this.selectUnit(null); }
    else if (ev.key === 'f' || ev.key === 'F') this.cycleTab();
    if (this.game) $('btn-speed').textContent = this.game.speed + '×';
  }
  cycleTab() {
    const tabs = document.querySelectorAll('#tabs .tab');
    let idx = [...tabs].findIndex(t => t.classList.contains('on'));
    idx = (idx + 1) % tabs.length;
    tabs[idx].click();
  }

  /* ---------------- canvas input ---------------- */
  onCanvasDown(sx, sy, button) {
    if (!this.game || this.game.over) return;
    const w = this.renderer.toWorld(sx, sy);
    const c = Math.round(w.x), r = Math.round(w.y);
    if (button === 2) { this.cancelPlacing(); return; }
    if (this.placing) {
      const cost = this.game.deployCost(this.placing);
      if (!this.game.canDeploy(this.placing, c, r)) { window.Sfx.hit(); return; }
      if (this.game.oil < cost) { window.Sfx.hit(); return; }
      this.game.deploy(this.placing, c, r);
      window.Sfx.deploy();
      this.placing = null;
      this.ui.refreshCards();
      return;
    }
    // select unit
    const u = this.game.units.find(x => x.col === c && x.row === r);
    if (u) { this.selectUnit(u); window.Sfx.click(); return; }
    // enemy tooltip
    let best = null, bd = 0.6;
    for (const e of this.game.enemies) {
      const d = Math.hypot(e.x - w.x, e.y - w.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { this.ui.showTip(sx, sy, best); return; }
    this.selectUnit(null);
    this.ui.hideTip();
  }
  onCanvasMove(sx, sy) {
    if (!this.game) return;
    const w = this.renderer.toWorld(sx, sy);
    this.hover = { c: Math.round(w.x), r: Math.round(w.y) };
  }

  /* ---------------- main loop ---------------- */
  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this._last) / 1000;
    this._last = now;
    dt = Math.min(dt, 0.1);
    const g = this.game;
    if (g && !g.over) {
      g.tick(dt);
      // consume events -> renderer + sfx
      const evts = g.events.splice(0);
      this.renderer.onEvents(evts);
      for (const ev of evts) {
        if (ev.type === 'kill') {
          window.Sfx.kill();
        } else if (ev.type === 'attack' && ev.u) {
          this.renderer.dmgAdd(ev.target.x, ev.target.y, Math.round(ev.raw),
            ev.kind === 'magic' ? '#d8b4ff' : '#fff');
          window.Sfx.hit();
        } else if (ev.type === 'leak') {
          window.Sfx.leak();
        } else if (ev.type === 'wave') {
          window.Sfx.wave();
          this.ui.banner(ev.i === g.totalWaves() ? '最终波 · 浊潮压境' : `第 ${ev.i}/${ev.total} 波`);
        } else if (ev.type === 'skill') {
          window.Sfx.skill();
        } else if (ev.type === 'cleared') {
          window.Sfx.win();
        } else if (ev.type === 'lost') {
          window.Sfx.lose();
        }
      }
      if (g.over) {
        clearTimeout(this._advT);
        this._advT = setTimeout(() => this.afterStage(), 900);
      }
      // side panel + cards refresh (throttled)
      if (now - this.lastCardRefresh > 250) {
        this.lastCardRefresh = now;
        this.ui.refreshCards();
        if (this.selected && !this.selected.dead) this.ui.showSide(this.selected);
        else if (this.selected) this.selectUnit(null);
      }
      this.ui.updateHud(g);
    }
    this.renderer.draw({
      game: this.game, dtReal: dt,
      placing: this.placing, selected: this.selected, hover: this.hover,
    });
  }
}

window.App = App;
window.app = new App();
})();
