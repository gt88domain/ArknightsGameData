/* 百妖灯阵 — canvas renderer (vector yokai art, no assets) */
(function () {
'use strict';
const C = window.Core;
const { COLS, ROWS, CLASS_COLOR, rangeCells } = C;

const RARITY_COLOR = ['#9aa4c0', '#7fe0a3', '#6db8ff', '#b07ce8', '#ffd166', '#ff9d5c'];

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.shake = 0;
    this.dmg = [];      // floating texts
    this.parts = [];    // particles
    this.rings = [];    // expanding rings
    this.bolts = [];    // attack lines
    this.stars = [];
    this.embers = [];
    this.mounts = [];
    this._seedBg();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  _seedBg() {
    let s = 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++)
      this.stars.push({ x: rnd(), y: rnd() * 0.55, r: 0.5 + rnd() * 1.1, p: rnd() * 6.28 });
    for (let i = 0; i < 26; i++)
      this.embers.push({ x: Math.random(), y: Math.random(), s: 0.15 + Math.random() * 0.3,
        p: Math.random() * 6.28, r: 1 + Math.random() * 2 });
    const mkMount = (base, amp, n) => {
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push([i / n, base + (rnd() - 0.5) * amp]);
      return pts;
    };
    this.mounts = [mkMount(0.62, 0.16, 9), mkMount(0.72, 0.2, 7)];
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const topPad = 54, botPad = 168;
    const cell = Math.min((this.W - 24) / COLS, (this.H - topPad - botPad) / ROWS);
    this.cell = Math.max(30, Math.min(96, cell));
    this.ox = (this.W - this.cell * COLS) / 2;
    this.oy = topPad + (this.H - topPad - botPad - this.cell * ROWS) / 2;
  }
  px(x) { return this.ox + (x + 0.5) * this.cell; }
  py(y) { return this.oy + (y + 0.5) * this.cell; }
  toWorld(sx, sy) {
    return { x: (sx - this.ox) / this.cell - 0.5, y: (sy - this.oy) / this.cell - 0.5 };
  }

  /* ---------------- effects API (called by UI each frame) ---------------- */
  onEvents(evts) {
    for (const ev of evts) {
      const r = this.cell;
      switch (ev.type) {
        case 'attack': {
          if (ev.e) { // enemy -> unit
            this.bolts.push({ x1: ev.e.x, y1: ev.e.y, x2: ev.target.x, y2: ev.target.y,
              t: 0, max: 0.12, c: 'rgba(255,120,90,', w: 2 });
          } else if (ev.u) {
            const magic = ev.kind === 'magic';
            this.bolts.push({ x1: ev.u.x, y1: ev.u.y, x2: ev.target.x, y2: ev.target.y,
              t: 0, max: magic ? 0.18 : 0.1,
              c: magic ? 'rgba(176,124,232,' : 'rgba(255,214,140,', w: magic ? 3.4 : 2.2,
              magic });
            this._spark(ev.target.x, ev.target.y, magic ? 4 : 3,
              magic ? '#b07ce8' : '#ffd98a', 0.5);
          }
          break;
        }
        case 'splash': this.rings.push({ x: ev.x, y: ev.y, r0: 0.2, r1: 1.3, t: 0, max: 0.25, c: '230,57,70' }); break;
        case 'aoe': this.rings.push({ x: ev.x, y: ev.y, r0: 0.3, r1: ev.r, t: 0, max: 0.3, c: '176,124,232' }); break;
        case 'skill':
          this.rings.push({ x: ev.u.x, y: ev.u.y, r0: 0.3, r1: 1.5, t: 0, max: 0.4,
            c: '255,209,102' }); break;
        case 'heal':
          this.dmg.push({ x: ev.x, y: ev.y, txt: '+' + Math.round(ev.v), c: '#7fe0a3', t: 0, max: 0.9 });
          break;
        case 'kill': {
          const e = ev.e;
          this._burst(e.x, e.y, e.arch.role === 'boss' ? 26 : (e.arch.role === 'elite' ? 14 : 9));
          if (e.arch.role !== 'basic')
            this.dmg.push({ x: e.x, y: e.y - 0.4, txt: '+' + e.reward + '油', c: '#ffd166', t: 0, max: 1 });
          if (e.arch.role === 'boss') { this.shake = Math.max(this.shake, 0.5); }
          break;
        }
        case 'leak':
          this.shake = Math.max(this.shake, 0.35);
          this.rings.push({ x: this.laneEndX(ev.e), y: this.laneEndY(ev.e), r0: 0.3, r1: 1.6, t: 0, max: 0.4, c: '255,80,80' });
          break;
        case 'unitDead': {
          this._burst(ev.u.x, ev.u.y, 12);
          this.rings.push({ x: ev.u.x, y: ev.u.y, r0: 0.2, r1: 1.2, t: 0, max: 0.4, c: '255,209,102' });
          break;
        }
        case 'deploy':
          this.rings.push({ x: ev.unit.x, y: ev.unit.y, r0: 0.2, r1: 1, t: 0, max: 0.35, c: '255,180,84' });
          break;
        case 'deploySlow':
          this.rings.push({ x: ev.x, y: ev.y, r0: 0.4, r1: 2.4, t: 0, max: 0.5, c: '120,170,255' });
          break;
        case 'deathBlast':
          this.rings.push({ x: ev.x, y: ev.y, r0: 0.3, r1: 4, t: 0, max: 0.5, c: '176,124,232' });
          break;
        case 'bossPhase':
          this.shake = Math.max(this.shake, 0.4);
          this.rings.push({ x: ev.e.x, y: ev.e.y, r0: 0.4, r1: 2.2, t: 0, max: 0.5, c: '255,80,80' });
          break;
        case 'counter':
          this.bolts.push({ x1: ev.u.x, y1: ev.u.y, x2: ev.enemy.x, y2: ev.enemy.y,
            t: 0, max: 0.12, c: 'rgba(255,150,150,', w: 2.4 });
          break;
      }
    }
    // damage numbers from engine events are attached here by UI via dmgAdd
  }
  laneEndX(e) { const ln = this.state && this.state.lanes ? this.state.lanes[e.lane].end : [COLS - 1, 3]; return ln[0]; }
  laneEndY(e) { const ln = this.state && this.state.lanes ? this.state.lanes[e.lane].end : [COLS - 1, 3]; return ln[1]; }
  dmgAdd(x, y, txt, c) {
    if (this.dmg.length > 46) this.dmg.shift();
    this.dmg.push({ x, y, txt: String(txt), c: c || '#fff', t: 0, max: 0.8 });
  }
  _spark(x, y, n, c, sp) {
    for (let i = 0; i < n && this.parts.length < 320; i++) {
      const a = Math.random() * 6.28, v = (0.5 + Math.random()) * sp;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, max: 0.3 + Math.random() * 0.2,
        c, r: 1.5 + Math.random() * 2, g: 0 });
    }
  }
  _burst(x, y, n) {
    for (let i = 0; i < n && this.parts.length < 360; i++) {
      const a = Math.random() * 6.28, v = 0.8 + Math.random() * 2.4;
      const ember = Math.random() < 0.4;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, t: 0,
        max: 0.5 + Math.random() * 0.5,
        c: ember ? (Math.random() < 0.5 ? '#ffb454' : '#ff8f5c') : '#231a3d',
        r: 2 + Math.random() * 3.5, g: 2.2 });
    }
  }

  /* ---------------- main draw ---------------- */
  draw(state) {
    this.state = state;
    const { ctx, W, H } = this;
    this.t += state.dtReal;
    // shake
    let shx = 0, shy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - state.dtReal * 1.6);
      shx = (Math.random() - 0.5) * this.shake * 9;
      shy = (Math.random() - 0.5) * this.shake * 9;
    }
    ctx.save();
    ctx.translate(shx, shy);
    this._bg();
    if (state.game) {
      this._lanes(state.game);
      this._grid(state.game);
      if (state.placing) this._placing(state);
      state.game.enemies.forEach(e => this._enemy(e));
      state.game.units.forEach(u => this._unit(u, state));
      this._fx();
    } else {
      this._fx();
    }
    ctx.restore();
  }

  _bg() {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f22');
    g.addColorStop(0.55, '#111936');
    g.addColorStop(1, '#181f40');
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, W + 24, H + 24);
    // stars
    for (const s of this.stars) {
      const a = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(this.t * 0.8 + s.p));
      ctx.fillStyle = `rgba(220,228,255,${a})`;
      ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
    }
    // moon
    const mx = W * 0.82, my = H * 0.17, mr = Math.min(W, H) * 0.055;
    const mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 3.2);
    mg.addColorStop(0, 'rgba(255,236,190,0.5)');
    mg.addColorStop(0.35, 'rgba(255,220,160,0.12)');
    mg.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(mx - mr * 3.2, my - mr * 3.2, mr * 6.4, mr * 6.4);
    ctx.fillStyle = '#ffe9bd';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(214,190,140,0.5)';
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my + mr * 0.2, mr * 0.22, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + mr * 0.35, my - mr * 0.25, mr * 0.14, 0, 7); ctx.fill();
    // mountains
    const mounts = [
      ['#141b38', this.mounts[0], 0],
      ['#0f1530', this.mounts[1], 0.02],
    ];
    for (const [col, pts, drift] of mounts) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-10, H);
      for (const [x, y] of pts) ctx.lineTo(x * W + Math.sin(this.t * 0.05 + drift) * 6, y * H);
      ctx.lineTo(W + 10, H);
      ctx.closePath(); ctx.fill();
    }
    // mist bands
    for (let i = 0; i < 3; i++) {
      const my = H * (0.5 + i * 0.16);
      const mx = ((this.t * (6 + i * 4) + i * 400) % (W + 700)) - 350;
      const mg2 = ctx.createRadialGradient(mx, my, 10, mx, my, 300);
      mg2.addColorStop(0, 'rgba(140,160,220,0.055)');
      mg2.addColorStop(1, 'rgba(140,160,220,0)');
      ctx.fillStyle = mg2;
      ctx.fillRect(mx - 300, my - 120, 600, 240);
    }
    // embers
    for (const e of this.embers) {
      e.y -= e.s * 0.0006 * (state ? 1 : 1) * 60 * 0.016;
      e.x += Math.sin(this.t * 0.7 + e.p) * 0.0004;
      if (e.y < -0.02) { e.y = 1.02; e.x = Math.random(); }
      const a = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(this.t * 2 + e.p));
      ctx.fillStyle = `rgba(255,180,90,${a})`;
      ctx.beginPath(); ctx.arc(e.x * W, e.y * H, e.r, 0, 7); ctx.fill();
    }
    // torii silhouette on the right edge (flavor)
    this._torii(W * 0.94, H * 0.78, Math.min(W, H) * 0.075);
  }
  _torii(x, y, s) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#7a2f2f';
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.86, y - s * 1.6);
    ctx.moveTo(x + s, y); ctx.lineTo(x + s * 0.86, y - s * 1.6);
    ctx.moveTo(x - s * 1.25, y - s * 1.5); ctx.lineTo(x + s * 1.25, y - s * 1.5);
    ctx.moveTo(x - s * 1.05, y - s * 1.15); ctx.lineTo(x + s * 1.05, y - s * 1.15);
    ctx.stroke();
    ctx.restore();
  }

  _lanes(game) {
    const { ctx } = this;
    for (const ln of game.lanes) {
      const wps = ln.cells;
      // ink strip
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(7,10,22,0.92)';
      ctx.lineWidth = this.cell * 0.74;
      ctx.beginPath();
      ctx.moveTo(this.px(wps[0][0]), this.py(wps[0][1]));
      for (const [c, r] of wps) ctx.lineTo(this.px(c), this.py(r));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(38,52,102,0.5)';
      ctx.lineWidth = this.cell * 0.5;
      ctx.beginPath();
      ctx.moveTo(this.px(wps[0][0]), this.py(wps[0][1]));
      for (const [c, r] of wps) ctx.lineTo(this.px(c), this.py(r));
      ctx.stroke();
      // flow dashes toward the gate
      ctx.strokeStyle = 'rgba(96,126,220,0.4)';
      ctx.lineWidth = this.cell * 0.12;
      ctx.setLineDash([this.cell * 0.22, this.cell * 0.42]);
      ctx.lineDashOffset = -this.t * this.cell * 0.9;
      ctx.beginPath();
      ctx.moveTo(this.px(wps[0][0]), this.py(wps[0][1]));
      for (const [c, r] of wps) ctx.lineTo(this.px(c), this.py(r));
      ctx.stroke();
      ctx.setLineDash([]);
      // spawn portal
      const s = ln.start;
      const sx = this.px(s[0]), sy = this.py(s[1]);
      const pr = this.cell * (0.3 + 0.04 * Math.sin(this.t * 3));
      ctx.strokeStyle = 'rgba(120,80,200,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, pr, this.t * 2, this.t * 2 + 4.4); ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, pr * 0.62, -this.t * 2.6, -this.t * 2.6 + 3.8); ctx.stroke();
      const pg = ctx.createRadialGradient(sx, sy, 2, sx, sy, pr * 1.6);
      pg.addColorStop(0, 'rgba(90,50,170,0.5)');
      pg.addColorStop(1, 'rgba(90,50,170,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(sx, sy, pr * 1.6, 0, 7); ctx.fill();
      // gate lantern (灯心)
      const e = ln.end;
      const gx = this.px(e[0]), gy = this.py(e[1]);
      this._gateLantern(gx, gy, game.baseHp / game.baseMaxHp);
    }
  }
  _gateLantern(x, y, ratio) {
    const { ctx } = this;
    const s = this.cell * 0.34;
    const glow = 0.35 + 0.25 * ratio + 0.12 * Math.sin(this.t * 3.2);
    const g = ctx.createRadialGradient(x, y, 1, x, y, s * 2.6);
    g.addColorStop(0, `rgba(255,190,90,${glow})`);
    g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, s * 2.6, 0, 7); ctx.fill();
    // body
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = ratio > 0.35 ? '#e8604c' : '#8a4038';
    ctx.strokeStyle = '#5a1f1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.72, s, 0, 0, 7);
    ctx.fill(); ctx.stroke();
    // ribs
    ctx.strokeStyle = 'rgba(90,31,26,0.7)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.36, s, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke();
    // caps + flame
    ctx.fillStyle = '#3d2b1f';
    ctx.fillRect(-s * 0.4, -s * 1.16, s * 0.8, s * 0.22);
    ctx.fillRect(-s * 0.34, s * 0.94, s * 0.68, s * 0.18);
    const fl = 1 + 0.18 * Math.sin(this.t * 9 + x);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.1, s * 0.2 * fl, s * 0.3 * fl, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#fff3d0';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.1, s * 0.16 * fl, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  _grid(game) {
    const { ctx, cell } = this;
    ctx.strokeStyle = 'rgba(90,110,180,0.14)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(this.ox + c * cell, this.oy);
      ctx.lineTo(this.ox + c * cell, this.oy + ROWS * cell);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(this.ox, this.oy + r * cell);
      ctx.lineTo(this.ox + COLS * cell, this.oy + r * cell);
      ctx.stroke();
    }
  }

  _placing(state) {
    const { ctx, cell } = this;
    const unit = state.placing;
    const ok = (c, r) => state.game.canDeploy(unit, c, r);
    const afford = state.game.oil >= state.game.deployCost(unit);
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (!ok(c, r)) continue;
      const x = this.ox + c * cell, y = this.oy + r * cell;
      ctx.fillStyle = afford ? 'rgba(255,180,84,0.10)' : 'rgba(255,90,90,0.10)';
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.strokeStyle = afford ? 'rgba(255,180,84,0.35)' : 'rgba(255,90,90,0.3)';
      ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
    }
    if (state.hover && ok(state.hover.c, state.hover.r)) {
      const x = this.ox + state.hover.c * cell, y = this.oy + state.hover.r * cell;
      ctx.fillStyle = 'rgba(255,214,140,0.16)';
      ctx.fillRect(x, y, cell, cell);
      // range preview
      const shape = C.UNITS[unit].range;
      ctx.fillStyle = 'rgba(255,180,84,0.13)';
      ctx.strokeStyle = 'rgba(255,180,84,0.5)';
      for (const [dr, dc] of rangeCells(shape)) {
        const c2 = state.hover.c + dc, r2 = state.hover.r + dr;
        if (c2 < 0 || r2 < 0 || c2 >= COLS || r2 >= ROWS) continue;
        ctx.fillRect(this.ox + c2 * cell + 2, this.oy + r2 * cell + 2, cell - 4, cell - 4);
      }
      ctx.globalAlpha = 0.55;
      this._unitShape(unit, state.hover.c, state.hover.r, true);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- units ---------------- */
  _unit(u, state) {
    const { ctx, cell } = this;
    const x = this.px(u.x), y = this.py(u.y);
    const sel = state.selected === u;
    // aura ring
    if (u.aura) {
      ctx.strokeStyle = 'rgba(255,209,102,0.35)';
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.t * 14;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, cell * 1.9, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (sel) {
      const shape = C.UNITS[u.uid].range;
      ctx.fillStyle = 'rgba(255,180,84,0.10)';
      for (const [dr, dc] of shape) {
        const c2 = u.col + dc, r2 = u.row + dr;
        if (c2 < 0 || r2 < 0 || c2 >= COLS || r2 >= ROWS) continue;
        ctx.fillRect(this.ox + c2 * cell + 1, this.oy + r2 * cell + 1, cell - 2, cell - 2);
      }
    }
    this._unitShape(u.uid, u.col, u.row, false, u, sel);
    // hp bar
    const bw = cell * 0.78;
    const ratio = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = 'rgba(8,10,20,0.85)';
    ctx.fillRect(x - bw / 2, y - cell * 0.62, bw, 5);
    ctx.fillStyle = ratio > 0.5 ? '#7fe0a3' : ratio > 0.25 ? '#ffd166' : '#ff6b6b';
    ctx.fillRect(x - bw / 2 + 0.5, y - cell * 0.62 + 0.5, (bw - 1) * ratio, 4);
    if (u.shield > 0) {
      ctx.fillStyle = 'rgba(120,180,255,0.9)';
      ctx.fillRect(x - bw / 2 + 0.5, y - cell * 0.62 - 3.5, (bw - 1) * Math.min(1, u.shield / u.maxHp), 2.5);
    }
    // sp bar
    const sk = u.skills.find(s => C.SKILLS[s.id].trigger === 'AUTO');
    if (sk) {
      const spc = C.SKILLS[sk.id].spCost;
      ctx.fillStyle = 'rgba(8,10,20,0.85)';
      ctx.fillRect(x - bw / 2, y - cell * 0.62 + 7, bw, 3);
      ctx.fillStyle = '#b07ce8';
      ctx.fillRect(x - bw / 2 + 0.5, y - cell * 0.62 + 7.5, (bw - 1) * Math.min(1, u.sp / spc), 2);
      if (u.sp >= spc * 0.98) {
        ctx.fillStyle = `rgba(176,124,232,${0.3 + 0.3 * Math.sin(this.t * 8)})`;
        ctx.beginPath(); ctx.arc(x, y - cell * 0.55, cell * 0.5, 0, 7); ctx.fill();
      }
    }
    // rarity pips
    const rar = C.UNITS[u.uid].rarity;
    for (let i = 0; i < rar; i++) {
      ctx.fillStyle = RARITY_COLOR[rar - 1];
      const px2 = x - (rar * 4 - 4) / 2 + i * 4;
      ctx.beginPath();
      ctx.moveTo(px2, y + cell * 0.44); ctx.lineTo(px2 + 2, y + cell * 0.44 + 2);
      ctx.lineTo(px2, y + cell * 0.44 + 4); ctx.lineTo(px2 - 2, y + cell * 0.44 + 2);
      ctx.closePath(); ctx.fill();
    }
    // status icon
    if (u.statuses.some(s => s.k === 'taunt')) {
      ctx.fillStyle = '#ffd166';
      ctx.font = `bold ${cell * 0.3}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x + cell * 0.42, y - cell * 0.45);
    }
  }
  _unitShape(uid, c, r, ghost, u, sel) {
    const { ctx, cell } = this;
    const arch = C.UNITS[uid];
    const x = this.px(c), y = this.py(r);
    const s = cell * 0.62;
    const col = CLASS_COLOR[arch.class];
    const seed = u ? (u.seed || 1) : 7;
    const t = this.t;
    // platform
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= ghost ? 0.9 : 1;
    ctx.fillStyle = 'rgba(10,14,28,0.6)';
    ctx.strokeStyle = sel ? '#ffd166' : 'rgba(90,110,180,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.62); ctx.lineTo(s * 0.62, 0); ctx.lineTo(0, s * 0.62); ctx.lineTo(-s * 0.62, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // class glow
    const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, s * 1.1);
    gg.addColorStop(0, this._rgba(col, 0.28));
    gg.addColorStop(1, this._rgba(col, 0));
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, 0, s * 1.1, 0, 7); ctx.fill();

    const bob = Math.sin(t * 2 + seed) * s * 0.04;
    ctx.translate(0, bob - s * 0.08);
    ctx.lineWidth = 1.6;
    switch (arch.class) {
      case 'RUNNER': {
        // paper lantern with flame
        const w = s * 0.46, h = s * 0.58;
        const bg = ctx.createLinearGradient(0, -h, 0, h);
        bg.addColorStop(0, '#ffd98a'); bg.addColorStop(1, '#f0a844');
        ctx.fillStyle = bg;
        ctx.strokeStyle = '#9a6420';
        ctx.beginPath();
        ctx.ellipse(0, 0, w, h * 0.78, 0, 0, 7);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(154,100,32,0.65)';
        ctx.beginPath(); ctx.ellipse(0, 0, w * 0.45, h * 0.78, 0, 0, 7); ctx.stroke();
        ctx.fillStyle = '#7a4a18';
        ctx.fillRect(-w * 0.5, -h * 0.78 - s * 0.08, w, s * 0.1);
        const fl = 1 + 0.25 * Math.sin(t * 10 + seed);
        ctx.fillStyle = '#fff6da';
        ctx.beginPath(); ctx.ellipse(0, 0, w * 0.28 * fl, h * 0.34 * fl, 0, 0, 7); ctx.fill();
        // legs
        ctx.strokeStyle = '#c98b3a';
        ctx.beginPath();
        ctx.moveTo(-w * 0.4, h * 0.78); ctx.lineTo(-w * 0.5, h * 0.78 + s * 0.16);
        ctx.moveTo(w * 0.4, h * 0.78); ctx.lineTo(w * 0.5, h * 0.78 + s * 0.16);
        ctx.stroke();
        break;
      }
      case 'GUARD': {
        // torii gate
        ctx.strokeStyle = col;
        ctx.fillStyle = 'rgba(127,179,213,0.28)';
        const pw = s * 0.14;
        ctx.fillRect(-s * 0.42, -s * 0.5, pw, s * 1.1);
        ctx.fillRect(s * 0.42 - pw, -s * 0.5, pw, s * 1.1);
        ctx.strokeRect(-s * 0.42, -s * 0.5, pw, s * 1.1);
        ctx.strokeRect(s * 0.42 - pw, -s * 0.5, pw, s * 1.1);
        // beams
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(-s * 0.62, -s * 0.52);
        ctx.quadraticCurveTo(0, -s * 0.66, s * 0.62, -s * 0.52);
        ctx.lineTo(s * 0.62, -s * 0.4);
        ctx.quadraticCurveTo(0, -s * 0.54, -s * 0.62, -s * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(-s * 0.5, -s * 0.28, s, s * 0.1);
        ctx.strokeStyle = 'rgba(127,179,213,0.8)';
        ctx.strokeRect(-s * 0.5, -s * 0.28, s, s * 0.1);
        break;
      }
      case 'WARRIOR': {
        // oni mask
        ctx.fillStyle = 'rgba(230,57,70,0.85)';
        ctx.strokeStyle = '#701c26';
        const m = s * 0.5;
        ctx.beginPath();
        ctx.moveTo(-m, -m * 0.5);
        ctx.quadraticCurveTo(0, -m * 0.9, m, -m * 0.5);
        ctx.lineTo(m * 0.8, m * 0.7);
        ctx.quadraticCurveTo(0, m * 1.05, -m * 0.8, m * 0.7);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // horns
        ctx.fillStyle = '#f4ead5';
        ctx.beginPath();
        ctx.moveTo(-m * 0.55, -m * 0.62); ctx.lineTo(-m * 0.85, -m * 1.25); ctx.lineTo(-m * 0.2, -m * 0.85);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(m * 0.55, -m * 0.62); ctx.lineTo(m * 0.85, -m * 1.25); ctx.lineTo(m * 0.2, -m * 0.85);
        ctx.closePath(); ctx.fill();
        // eyes
        ctx.fillStyle = '#ffd166';
        ctx.beginPath(); ctx.ellipse(-m * 0.34, -m * 0.12, m * 0.16, m * 0.1, -0.4, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(m * 0.34, -m * 0.12, m * 0.16, m * 0.1, 0.4, 0, 7); ctx.fill();
        ctx.fillStyle = '#701c26';
        ctx.beginPath(); ctx.arc(-m * 0.34, -m * 0.12, m * 0.05, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(m * 0.34, -m * 0.12, m * 0.05, 0, 7); ctx.fill();
        // fangs
        ctx.fillStyle = '#f4ead5';
        ctx.beginPath();
        ctx.moveTo(-m * 0.28, m * 0.34); ctx.lineTo(-m * 0.18, m * 0.58); ctx.lineTo(-m * 0.08, m * 0.34);
        ctx.moveTo(m * 0.28, m * 0.34); ctx.lineTo(m * 0.18, m * 0.58); ctx.lineTo(m * 0.08, m * 0.34);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'SHOOTER': {
        // tengu feather arrow facing left
        ctx.strokeStyle = col;
        ctx.lineWidth = s * 0.12;
        ctx.beginPath();
        ctx.moveTo(-s * 0.75, 0); ctx.lineTo(s * 0.55, 0);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(-s * 0.95, 0); ctx.lineTo(-s * 0.5, -s * 0.2); ctx.lineTo(-s * 0.5, s * 0.2);
        ctx.closePath(); ctx.fill();
        // fletch
        ctx.beginPath();
        ctx.moveTo(s * 0.55, 0); ctx.lineTo(s * 0.8, -s * 0.26);
        ctx.moveTo(s * 0.55, 0); ctx.lineTo(s * 0.8, s * 0.26);
        ctx.stroke();
        ctx.lineWidth = 1.6;
        // eye (tengu)
        ctx.fillStyle = 'rgba(82,212,163,0.9)';
        ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.34, s * 0.14, 0, 7); ctx.fill();
        ctx.fillStyle = '#083126';
        ctx.beginPath(); ctx.arc(-s * 0.16, -s * 0.34, s * 0.06, 0, 7); ctx.fill();
        break;
      }
      case 'WITCH': {
        // foxfire spiral
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 4.4; a += 0.15) {
          const rr = (a / (Math.PI * 4.4)) * s * 0.55;
          const px2 = Math.cos(a + t * 1.4) * rr;
          const py2 = Math.sin(a + t * 1.4) * rr;
          if (a === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.stroke();
        const og = ctx.createRadialGradient(0, 0, 1, 0, 0, s * 0.3);
        og.addColorStop(0, '#f2e0ff'); og.addColorStop(1, 'rgba(176,124,232,0.1)');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, 7); ctx.fill();
        break;
      }
      case 'MEDIC': {
        // paper talisman
        const tw = s * 0.4, th = s * 0.72;
        ctx.fillStyle = '#f4ead5';
        ctx.strokeStyle = '#b9a87e';
        ctx.fillRect(-tw / 2, -th, tw, th * 2);
        ctx.strokeRect(-tw / 2, -th, tw, th * 2);
        ctx.fillStyle = '#c94f4f';
        ctx.fillRect(-tw / 2, -th, tw, th * 0.42);
        ctx.strokeStyle = '#3f6f52';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-tw * 0.24, -th * 0.4); ctx.lineTo(tw * 0.24, -th * 0.4);
        ctx.moveTo(-tw * 0.24, th * 0.02); ctx.lineTo(tw * 0.24, th * 0.02);
        ctx.moveTo(0, -th * 0.4); ctx.quadraticCurveTo(tw * 0.2, th * 0.3, 0, th * 0.7);
        ctx.stroke();
        const hg = ctx.createRadialGradient(0, 0, 1, 0, 0, s * 0.5);
        hg.addColorStop(0, `rgba(123,224,173,${0.25 + 0.15 * Math.sin(t * 3 + seed)})`);
        hg.addColorStop(1, 'rgba(123,224,173,0)');
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, 7); ctx.fill();
        break;
      }
      case 'CHANT': {
        // orbiting bells
        ctx.strokeStyle = 'rgba(240,168,96,0.7)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, 7); ctx.stroke();
        ctx.fillStyle = '#f0a860';
        for (let i = 0; i < 3; i++) {
          const a = t * 1.6 + i * 2.09 + seed;
          const bx = Math.cos(a) * s * 0.42, by = Math.sin(a) * s * 0.42;
          ctx.beginPath(); ctx.arc(bx, by, s * 0.13, 0, 7); ctx.fill();
          ctx.fillStyle = '#5a3416';
          ctx.beginPath(); ctx.arc(bx, by + s * 0.05, s * 0.04, 0, 7); ctx.fill();
          ctx.fillStyle = '#f0a860';
        }
        ctx.fillStyle = 'rgba(240,168,96,0.9)';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, 7); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
  _rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------------- enemies ---------------- */
  _enemy(e) {
    const { ctx, cell } = this;
    const fly = e.arch.kind === 'fly';
    const x = this.px(e.x);
    const y = this.py(e.y) - (fly ? cell * 0.28 : 0);
    const role = e.arch.role;
    const baseR = (role === 'boss' ? 0.5 : role === 'elite' ? 0.34 : 0.26) * cell;
    const t = this.t;
    // ground shadow
    ctx.fillStyle = 'rgba(5,6,14,0.5)';
    ctx.beginPath();
    ctx.ellipse(this.px(e.x), this.py(e.y) + cell * 0.3, baseR * 0.8, baseR * 0.28, 0, 0, 7);
    ctx.fill();
    const squish = 1 + 0.06 * Math.sin(t * 3.4 + e.seed);
    ctx.save();
    ctx.translate(x, y);
    // aura for boss/enrage
    if (role === 'boss' || e.enraged) {
      ctx.strokeStyle = e.enraged ? 'rgba(255,80,80,0.65)' : 'rgba(160,90,255,0.5)';
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -t * 20;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, baseR * 1.5, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    // wings (fly)
    if (fly) {
      const fl = Math.sin(t * 12 + e.seed) * 0.5 + 0.5;
      ctx.strokeStyle = 'rgba(150,120,220,0.8)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-baseR * 0.5, -baseR * 0.2);
      ctx.quadraticCurveTo(-baseR * 1.5, -baseR * (1 + fl * 0.7), -baseR * 1.9, -baseR * (0.4 + fl * 0.5));
      ctx.moveTo(baseR * 0.5, -baseR * 0.2);
      ctx.quadraticCurveTo(baseR * 1.5, -baseR * (1 + fl * 0.7), baseR * 1.9, -baseR * (0.4 + fl * 0.5));
      ctx.stroke();
    }
    // body
    const bodyCol = role === 'boss' ? '#241238' : role === 'elite' ? '#1d1233' : '#171028';
    const bg = ctx.createRadialGradient(-baseR * 0.3, -baseR * 0.4, baseR * 0.1, 0, 0, baseR * 1.2);
    bg.addColorStop(0, '#332052');
    bg.addColorStop(1, bodyCol);
    ctx.fillStyle = bg;
    ctx.strokeStyle = 'rgba(120,90,190,0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, baseR, baseR * squish, 0, 0, 7);
    ctx.fill(); ctx.stroke();
    // spikes for elite/boss
    if (role !== 'basic') {
      ctx.fillStyle = role === 'boss' ? '#5a3b8f' : '#41306b';
      const n = role === 'boss' ? 8 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + t * 0.4 + e.seed;
        const r1 = baseR * 0.92, r2 = baseR * (role === 'boss' ? 1.42 : 1.24);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.22) * r1, Math.sin(a - 0.22) * r1 * squish);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2 * squish);
        ctx.lineTo(Math.cos(a + 0.22) * r1, Math.sin(a + 0.22) * r1 * squish);
        ctx.closePath(); ctx.fill();
      }
    }
    // eyes
    const eyeCol = e.enraged ? '#ff3860' : role === 'boss' ? '#ff5c8a' : role === 'elite' ? '#ff9d5c' : '#ff6b6b';
    const er = baseR * 0.16;
    const blink = (Math.sin(t * 0.9 + e.seed * 3) > 0.97) ? 0.2 : 1;
    ctx.fillStyle = eyeCol;
    ctx.beginPath(); ctx.ellipse(-baseR * 0.34, -baseR * 0.12, er, er * blink, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(baseR * 0.34, -baseR * 0.12, er, er * blink, 0, 0, 7); ctx.fill();
    const eg = ctx.createRadialGradient(0, -baseR * 0.1, 1, 0, -baseR * 0.1, baseR * 0.9);
    eg.addColorStop(0, this._rgba(eyeCol, 0.16));
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(0, -baseR * 0.1, baseR * 0.9, 0, 7); ctx.fill();
    // mouth
    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (role === 'basic') {
      ctx.moveTo(-baseR * 0.2, baseR * 0.3); ctx.lineTo(baseR * 0.2, baseR * 0.3);
    } else {
      for (let i = -2; i <= 2; i++) {
        const mx2 = i * baseR * 0.12;
        ctx.moveTo(mx2 - baseR * 0.05, baseR * 0.28);
        ctx.lineTo(mx2, baseR * 0.28 + (i % 2 ? baseR * 0.14 : baseR * 0.06));
        ctx.lineTo(mx2 + baseR * 0.05, baseR * 0.28);
      }
    }
    ctx.stroke();
    // shield ring
    if (e.shield > 0) {
      ctx.strokeStyle = `rgba(120,180,255,${0.5 + 0.3 * Math.sin(t * 4)})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, 0, baseR * 1.25, 0, 7); ctx.stroke();
    }
    // slow tint
    if (e.slow) {
      ctx.strokeStyle = 'rgba(120,180,255,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, baseR * 1.05, t * 3, t * 3 + 2); ctx.stroke();
    }
    // summoner sparks
    if (e.arch.traits.includes('summon')) {
      for (let i = 0; i < 2; i++) {
        const a = t * 2.4 + i * 3.14 + e.seed;
        ctx.fillStyle = 'rgba(200,140,255,0.8)';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * baseR * 1.2, Math.sin(a) * baseR * 1.2, 2.2, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();
    // hp bar
    const bw = Math.max(cell * 0.6, baseR * 2.2);
    const ratio = Math.max(0, e.hp / e.maxHp);
    const by = y - baseR * 1.55 - (role === 'boss' ? 10 : 4);
    ctx.fillStyle = 'rgba(8,10,20,0.85)';
    ctx.fillRect(x - bw / 2, by, bw, role === 'boss' ? 7 : 4.5);
    ctx.fillStyle = role === 'boss' ? '#ff3860' : role === 'elite' ? '#ff9d5c' : '#e05252';
    ctx.fillRect(x - bw / 2 + 0.5, by + 0.5, (bw - 1) * ratio, (role === 'boss' ? 7 : 4.5) - 1);
    if (e.shield > 0) {
      ctx.fillStyle = 'rgba(120,180,255,0.95)';
      ctx.fillRect(x - bw / 2 + 0.5, by - 3, (bw - 1) * Math.min(1, e.shield / e.maxShield), 2);
    }
    if (role === 'boss') {
      ctx.fillStyle = '#ffd166';
      ctx.font = `bold ${cell * 0.24}px "Noto Serif SC",serif`;
      ctx.textAlign = 'center';
      ctx.fillText(e.arch.name, x, by - 6);
    }
    if (e.dots.length) {
      ctx.fillStyle = 'rgba(255,150,60,0.9)';
      ctx.font = `${cell * 0.18}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('✕', x + bw * 0.45, by - 2);
    }
  }

  /* ---------------- fx ---------------- */
  _fx() {
    const { ctx } = this;
    const dtr = 1 / 60;
    // bolts
    for (const b of this.bolts) {
      b.t += dtr;
      const k = b.t / b.max;
      if (k > 1) continue;
      const x1 = this.px(b.x1), y1 = this.py(b.y1) - this.cell * 0.1;
      const x2 = this.px(b.x2), y2 = this.py(b.y2) - this.cell * 0.1;
      ctx.strokeStyle = b.c + (1 - k) * (b.magic ? 0.9 : 0.75) + ')';
      ctx.lineWidth = b.w * (1 - k * 0.5);
      if (b.magic) {
        ctx.shadowColor = 'rgba(176,124,232,0.8)';
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      if (b.magic) {
        const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 8;
        const my = (y1 + y2) / 2 + (Math.random() - 0.5) * 8;
        ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2);
      } else {
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    this.bolts = this.bolts.filter(b => b.t < b.max);
    // rings
    for (const rg of this.rings) {
      rg.t += dtr;
      const k = rg.t / rg.max;
      if (k > 1) continue;
      ctx.strokeStyle = `rgba(${rg.c},${(1 - k) * 0.8})`;
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(this.px(rg.x), this.py(rg.y), (rg.r0 + (rg.r1 - rg.r0) * k) * this.cell, 0, 7);
      ctx.stroke();
    }
    this.rings = this.rings.filter(r => r.t < r.max);
    // particles
    for (const p of this.parts) {
      p.t += dtr;
      p.x += p.vx * dtr;
      p.y += p.vy * dtr;
      p.vy += (p.g || 0) * dtr;
      const k = p.t / p.max;
      if (k > 1) continue;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(this.px(p.x), this.py(p.y), p.r * (1 - k * 0.5), 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.parts = this.parts.filter(p => p.t < p.max);
    // damage numbers
    ctx.textAlign = 'center';
    for (const d of this.dmg) {
      d.t += dtr;
      const k = d.t / d.max;
      if (k > 1) continue;
      const x = this.px(d.x), y = this.py(d.y) - k * this.cell * 0.8;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `bold ${Math.round(this.cell * 0.26)}px "Noto Serif SC",serif`;
      ctx.strokeStyle = 'rgba(5,6,14,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(d.txt, x, y);
      ctx.fillStyle = d.c;
      ctx.fillText(d.txt, x, y);
    }
    ctx.globalAlpha = 1;
    this.dmg = this.dmg.filter(d => d.t < d.max);
  }
}

window.Renderer = Renderer;
})();
