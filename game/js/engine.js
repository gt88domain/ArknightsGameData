/* 百妖灯阵 — engine: pure simulation, no DOM */
(function () {
'use strict';
const C = window.Core;
const { RNG, clamp, UNITS, SKILLS, ENEMIES, rangeCells, COLS, ROWS,
        WAVES, META } = C;

/* ================= lanes & map ================= */
function buildLane(wps) {
  // wps: [[col,row],...] axis-aligned. returns {segs, total, cells:[ordered], cellStart:{}}
  const segs = []; let total = 0; const cells = []; const seen = {}; const cellStart = {};
  for (let i = 0; i < wps.length - 1; i++) {
    const [c0, r0] = wps[i], [c1, r1] = wps[i + 1];
    const len = Math.abs(c1 - c0) + Math.abs(r1 - r0);
    if (!len) continue;
    segs.push({ x0: c0, y0: r0, x1: c1, y1: r1, len, start: total });
    total += len;
    // cells covered (including endpoints)
    const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
    let c = c0, r = r0;
    cells.push([c, r]);
    if (!seen[c + ',' + r]) { seen[c + ',' + r] = 1; cellStart[c + ',' + r] = total - len; }
    while (c !== c1 || r !== r1) {
      c += dc; r += dr;
      cells.push([c, r]);
      if (!seen[c + ',' + r]) { seen[c + ',' + r] = 1; cellStart[c + ',' + r] = total - Math.abs(c1 - c) - Math.abs(r1 - r); }
    }
  }
  return { segs, total, cells, cellStart, start: wps[0], end: wps[wps.length - 1] };
}
function posAt(lane, d) {
  d = clamp(d, 0, lane.total);
  for (const s of lane.segs) {
    if (d <= s.start + s.len) {
      const t = (d - s.start) / s.len;
      return { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t };
    }
  }
  const s = lane.segs[lane.segs.length - 1];
  return { x: s.x1, y: s.y1 };
}
function cellAt(lane, d) {
  const p = posAt(lane, d);
  return [clamp(Math.round(p.x), 0, COLS - 1), clamp(Math.round(p.y), 0, ROWS - 1)];
}

/* ================= wave plan generation ================= */
const LANE_TMPL = {};
WAVES.laneTemplates.forEach(t => { LANE_TMPL[t.id] = t; });

function poolFor(n) {
  const p = ['e_ki', 'e_ka', 'e_ne'];
  if (n >= 3) p.push('e_kara');
  if (n >= 5) p.push('e_kotsu', 'e_you', 'e_doku', 'e_hou');
  if (n >= 7) p.push('e_gani', 'e_hayate');
  if (n >= 10) p.push('e_shoku', 'e_kan', 'e_ketsu', 'e_tou', 'e_ha');
  if (n >= 13) p.push('e_oni');
  if (n >= 15) p.push('e_gani', 'e_ha');
  return p;
}
function elitePoolFor(n) {
  const p = [];
  if (n >= 4) p.push('e_gani', 'e_hayate');
  if (n >= 7) p.push('e_shoku', 'e_kan');
  if (n >= 10) p.push('e_ketsu', 'e_tou', 'e_ha');
  if (n >= 13) p.push('e_oni');
  return p.length ? p : ['e_gani'];
}

function genStagePlan(n, rng) {
  const cv = WAVES.curve;
  const B = cv.budget.a + cv.budget.b * n + cv.budget.c * Math.pow(n, cv.budget.d);
  const sm = cv.statMul.a + cv.statMul.b * (n - 1) + cv.statMul.c * Math.pow(n - 1, 2);
  const tpl = LANE_TMPL[cv.lanesByStage[n]];
  const laneCount = tpl.lanes.length;
  const W = 3 + Math.floor(n / 4);
  const eliteP = n >= cv.eliteFrom ? Math.min(cv.eliteMax, cv.eliteRate * (n - cv.eliteFrom + 1)) : 0;
  const bossIdx = cv.bossStages.indexOf(n);
  const boss = bossIdx >= 0 ? cv.bossPicks[bossIdx] : null;
  let budget = B - (boss ? ENEMIES[boss].mass : 0);
  const weights = [];
  for (let i = 0; i < W; i++) weights.push(0.55 + 0.45 * (W > 1 ? i / (W - 1) : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const waves = [];
  for (let i = 0; i < W; i++) {
    const wb = budget * weights[i] / wsum;
    const spawns = [];
    let b = wb, guard = 0;
    while (b >= 1 && guard++ < 60) {
      let eid, count = 1;
      const ep = elitePoolFor(n);
      if (ep.length && b >= 3 && rng.chance(eliteP)) {
        eid = rng.pick(ep);
      } else {
        eid = rng.pick(poolFor(n));
        if (b > 4 && rng.chance(0.45)) count = 2;
      }
      let mass = ENEMIES[eid].mass * count;
      if (mass > b && count > 1) { count = 1; mass = ENEMIES[eid].mass; }
      if (mass > b) {
        const small = poolFor(n).filter(x => ENEMIES[x].mass <= b);
        eid = small.length ? rng.pick(small) : 'e_ki';
        mass = ENEMIES[eid].mass; count = 1;
      }
      b -= mass;
      spawns.push({ enemyId: eid, count, interval: rng.range(0.8, 1.7),
                    lane: rng.int(0, laneCount - 1), pre: spawns.length ? rng.range(0.4, 1.4) : 0 });
    }
    waves.push(spawns);
  }
  if (boss) {
    const escort = [];
    let eb = Math.min(14, B * 0.18);
    let g = 0;
    while (eb >= 1 && g++ < 12) {
      const eid = rng.pick(poolFor(n).filter(x => ENEMIES[x].mass <= Math.max(1, eb)));
      if (!eid) break;
      const mass = ENEMIES[eid].mass;
      escort.push({ enemyId: eid, count: 1, interval: 1.2, lane: rng.int(0, laneCount - 1),
                    pre: 3 + rng.range(0, 6) });
      eb -= mass;
    }
    waves[waves.length - 1] = [
      { enemyId: boss, count: 1, interval: 1, lane: rng.int(0, laneCount - 1), pre: 1.5 }
    ].concat(escort);
  }
  return { n, sm, laneCount, waves, boss: !!boss, prep: n === 1 ? 16 : 10 };
}

/* ================= modifiers (relics + meta) ================= */
function makeMod(relicIds) {
  const m = {
    startOil: 0, oilRegenPct: 0, oilCap: 0, killOil: 0, startHpPct: 0,
    unitHpPct: 0, unitAtkPct: 0, unitDef: 0, unitRes: 0, spRegenPct: 0,
    physPct: 0, magicPct: 0, allPct: 0, vsElite: 0, vsBoss: 0, vsFly: 0,
    atkSpeedPct: 0, killSpPct: 0, baseHp: 0, deployCap: 0, blockPlus: 0,
    healWavePct: 0, waveShieldPct: 0, deploySlow: 0, firstFree: 0,
    deathBlast: 0, lowHpShield: 0, oilOnKillCh: 0, oilOnKillAmt: 0,
  };
  for (const id of relicIds) {
    const r = C.RELICS[id];
    if (!r) continue;
    switch (r.kind) {
      case 'start_oil': m.startOil += r.params; break;
      case 'unit_hp_pct': case 'unit_hp_pct2': m.unitHpPct += r.params; break;
      case 'sp_regen_pct': m.spRegenPct += r.params; break;
      case 'kill_oil_flat': m.killOil += r.params; break;
      case 'phys_dmg_pct': m.physPct += r.params; break;
      case 'magic_dmg_pct': m.magicPct += r.params; break;
      case 'atk_speed_pct': m.atkSpeedPct += r.params; break;
      case 'unit_def_flat': m.unitDef += r.params; break;
      case 'heal_wave_pct': m.healWavePct += r.params; break;
      case 'oil_regen_pct': m.oilRegenPct += r.params; break;
      case 'dmg_vs_elite': m.vsElite += r.params; break;
      case 'deploy_slow': m.deploySlow = Math.max(m.deploySlow, r.params); break;
      case 'block_plus': m.blockPlus += r.params; break;
      case 'unit_atk_pct': m.unitAtkPct += r.params; break;
      case 'unit_res_flat': m.unitRes += r.params; break;
      case 'kill_sp_pct': m.killSpPct += r.params; break;
      case 'base_hp_flat': m.baseHp += r.params; break;
      case 'start_hp_pct': m.startHpPct += r.params; break;
      case 'dmg_vs_fly': m.vsFly += r.params; break;
      case 'all_dmg_pct': m.allPct += r.params; break;
      case 'low_hp_shield': m.lowHpShield = Math.max(m.lowHpShield, r.params); break;
      case 'deploy_cap': m.deployCap += r.params; break;
      case 'wave_shield': m.waveShieldPct = Math.max(m.waveShieldPct, r.params); break;
      case 'dmg_vs_boss': m.vsBoss += r.params; break;
      case 'death_blast': m.deathBlast = Math.max(m.deathBlast, r.params); break;
      case 'oil_cap_up': m.oilCap += r.params; m.oilRegenPct += 0.4; break;
      case 'first_free': m.firstFree = 1; break;
    }
  }
  return m;
}

/* ================= Game ================= */
let _uid = 1, _eid = 1;

class Game {
  constructor(opts) {
    this.n = opts.n;                      // 1..18
    this.seed = opts.seed || 1;
    this.rng = new RNG(this.seed);
    this.meta = opts.meta || { wick: 0, oil: 0, array: 0 };
    this.relics = opts.relics || [];      // relic ids
    this.lampLevel = opts.lampLevel || 1;
    this.upgraded = new Set(opts.upgraded || []);
    this.mod = makeMod(this.relics);
    this.events = [];                     // consumed by UI each frame
    this.over = false; this.result = null;

    // stage plan + lanes
    this.plan = genStagePlan(this.n, this.rng);
    this.lanes = LANE_TMPL[WAVES.curve.lanesByStage[this.n]].lanes
      .map(w => buildLane(w));
    this.pathCells = {};                  // "c,r" -> laneIdx (last wins, fine)
    this.lanes.forEach((ln, i) => {
      ln.cells.forEach(c => { this.pathCells[c[0] + ',' + c[1]] = i; });
    });
    this.cellOfUnit = {};

    // economy
    this.baseMaxHp = 100 + 8 * this.meta.wick + this.mod.baseHp;
    this.baseHp = this.baseMaxHp;
    const lampLvl = C.D.relics.lampLevels;
    this.oilMax = 999 + this.mod.oilCap;
    this.oil = Math.min(this.oilMax, 100 + 40 * this.meta.oil + this.mod.startOil + (opts.nextStageOil || 0));
    this.oilTick = 0;
    this.deployCap = 8 + this.meta.array + this.mod.deployCap +
      ([3, 6, 9].includes(this.lampLevel) ? Math.min(3, Math.floor((this.lampLevel - 1) / 3)) : 0);
    this.lowHpShieldUsed = false;
    this.firstFreeUsed = false;

    // state
    this.t = 0;
    this.phase = 'prep';
    this.phaseT = 0;
    this.waveIdx = -1;
    this.spawnQ = [];
    this.units = [];
    this.enemies = [];
    this.speed = 1;
    this.paused = false;
    this.stats = { kills: 0, oilEarned: 0, leaked: 0, deployed: 0 };
    // unit upgrades from events: pre-applied set
    this.upgBoost = {};                   // unitId -> {atk,hp}
  }

  emit(type, data) { this.events.push(Object.assign({ type }, data)); }

  /* ---------- deployment ---------- */
  canDeploy(unitId, c, r) {
    if (this.over) return false;
    const u = UNITS[unitId];
    if (!u) return false;
    if (this.units.length >= this.deployCap) return false;
    if (this.units.some(x => x.uid === unitId)) return false;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    if (this.cellOfUnit[c + ',' + r]) return false;
    return true;
  }
  deployCost(unitId) {
    const u = UNITS[unitId];
    if (this.mod.firstFree && !this.firstFreeUsed) return 0;
    return u.cost;
  }
  deploy(unitId, c, r) {
    if (!this.canDeploy(unitId, c, r)) return null;
    const cost = this.deployCost(unitId);
    if (this.oil < cost) return null;
    this.oil -= cost;
    if (cost === 0 && this.mod.firstFree) this.firstFreeUsed = true;
    const arch = UNITS[unitId];
    const up = this.upgBoost[unitId] || (this.upgraded.has(unitId) ? { atk: 0.25, hp: 0.25 } : null);
    const hpMul = (1 + this.mod.unitHpPct) * (up ? 1 + up.hp : 1);
    const atkMul = (1 + this.mod.unitAtkPct) * (up ? 1 + up.atk : 1);
    const unit = {
      uid: unitId, arch, col: c, row: r, x: c, y: r,
      maxHp: Math.round(arch.hp * hpMul), hp: 0,
      atk: Math.round(arch.atk * atkMul), def: arch.def + this.mod.unitDef,
      res: arch.res + this.mod.unitRes,
      block: arch.block + (this.mod.blockPlus && (arch.class === 'GUARD' || arch.class === 'WARRIOR') ? this.mod.blockPlus : 0),
      atkTime: arch.atkTime, cd: 0.3, sp: 0, spRegen: arch.spRegen,
      skills: arch.skills, statuses: [], aura: null, auraT: 0,
      blocked: [], healCd: 0, hurtCd: 0, dead: false,
      range: rangeCells(arch.range),
      seed: this.rng.int(1, 9999),
    };
    unit.hp = unit.maxHp;
    this.units.push(unit);
    this.cellOfUnit[c + ',' + r] = unit;
    this.stats.deployed++;
    if (this.mod.deploySlow > 0) {
      for (const e of this.enemies) {
        if (Math.hypot(e.x - c, e.y - r) <= 2.4) e.slow = { t: 2, m: 1 - this.mod.deploySlow };
      }
      this.emit('deploySlow', { x: c, y: r });
    }
    this.emit('deploy', { unit });
    return unit;
  }
  recall(unit) {
    if (unit.dead) return;
    const refund = Math.floor(unit.arch.cost * 0.8);
    this.oil = Math.min(this.oilMax, this.oil + refund);
    this.cellOfUnit[unit.col + ',' + unit.row] = null;
    unit.dead = true;
    unit.blocked.forEach(e => { if (e.blockedBy === unit) e.blockedBy = null; });
    this.units = this.units.filter(x => x !== unit);
    this.emit('recall', { uid: unit.uid, refund });
  }

  /* ---------- enemies ---------- */
  spawnEnemy(eid, laneIdx, dist) {
    const a = ENEMIES[eid];
    const sm = this.plan.sm;
    const e = {
      id: _eid++, arch: a, lane: laneIdx, dist: dist || 0,
      x: 0, y: 0,
      maxHp: Math.round(a.hp * sm), hp: 0,
      atk: Math.round(a.atk * sm), def: Math.round(a.def * (0.7 + 0.3 * sm)),
      res: a.res, speed: a.speed, atkTime: a.atkTime, atkCd: a.atkTime * 0.6,
      shield: 0, maxShield: 0,
      traits: a.traits, slow: null, dots: [],
      state: 'move', blockedBy: null, queueSlot: 0,
      sumCd: a.traits.includes('summon') ? (a.role === 'boss' ? 6 : 4) : 0,
      enraged: false, leaked: false, dead: false,
      seed: this.rng.int(1, 9999),
      reward: a.reward,
    };
    if (a.traits.includes('shield')) { e.shield = Math.round(e.maxHp * 0.4); e.maxShield = e.shield; }
    e.hp = e.maxHp;
    const p = posAt(this.lanes[laneIdx], e.dist);
    e.x = p.x; e.y = p.y;
    this.enemies.push(e);
    this.emit('spawn', { e });
    return e;
  }

  /* ---------- damage ---------- */
  damageEnemy(e, raw, kind, src) {
    if (e.dead) return 0;
    let dmg = raw;
    if (e.traits.includes('armored') && kind === 'phys') dmg *= 0.85;
    let dealt = 0;
    if (dmg > 0) {
      if (e.shield > 0) {
        const s = Math.min(e.shield, dmg);
        e.shield -= s; dealt += s; dmg -= s;
      }
      const hpBefore = e.hp;
      e.hp -= dmg;
      dealt += Math.max(0, Math.min(dmg, hpBefore));
    }
    if (e.hp <= 0) this.killEnemy(e, src);
    return dealt;
  }
  killEnemy(e, src) {
    if (e.dead) return;
    e.dead = true;
    this.stats.kills++;
    this.oil = Math.min(this.oilMax, this.oil + e.reward + this.mod.killOil);
    if (this.mod.oilOnKillCh && this.rng.chance(this.mod.oilOnKillCh))
      this.oil = Math.min(this.oilMax, this.oil + this.mod.oilOnKillAmt);
    if (src && src.sp !== undefined) src.sp = Math.min(100, src.sp + 5 * (1 + this.mod.killSpPct));
    if (e.blockedBy) {
      const u = e.blockedBy;
      u.blocked = u.blocked.filter(x => x !== e);
      // reindex queue slots
      u.blocked.forEach((q, i) => q.queueSlot = i);
    }
    this.emit('kill', { e, src });
    if (e.arch.role === 'boss') this.emit('bossDown', { e });
  }
  damageUnit(u, raw, src) {
    if (u.dead) return;
    let dmg = raw;
    for (const s of u.statuses) if (s.k === 'dmgDown') dmg *= s.v;
    // zone damage-down auras
    for (const other of this.units) {
      if (other === u || other.dead || !other.aura) continue;
      if (other.aura.k === 'zoneDmgDown' && this.inRange(other, u)) dmg *= other.aura.v;
    }
    if (u.shield > 0) {
      const s = Math.min(u.shield, dmg);
      u.shield -= s; dmg -= s;
    }
    u.hp -= dmg;
    u.hurtCd = 0.25;
    u.sp = Math.min(100, u.sp + 2.5);
    this.emit('unitHit', { u, dmg: dmg + (raw - dmg) });
    if (u.hp <= 0) {
      u.dead = true;
      this.cellOfUnit[u.col + ',' + u.row] = null;
      u.blocked.forEach(e => e.blockedBy = null);
      this.units = this.units.filter(x => x !== u);
      this.emit('unitDead', { u });
      if (this.mod.deathBlast > 0) {
        const li = this.laneOfCell(u.col, u.row);
        let blast = this.mod.deathBlast;
        for (const e of this.enemies) {
          if (!e.dead && (li === -1 ? true : e.lane === li)) {
            this.damageEnemy(e, blast, 'magic', u);
          }
        }
        this.emit('deathBlast', { x: u.x, y: u.y });
      }
    }
  }

  /* ---------- targeting helpers ---------- */
  inRange(u, target) {
    const dx = Math.round(target.x) - u.col, dy = Math.round(target.y) - u.row;
    return u.range.some(r => r[0] === dy && r[1] === dx);
  }
  laneOfCell(c, r) {
    const k = this.pathCells[c + ',' + r];
    return k === undefined ? -1 : k;
  }
  pickTarget(u) {
    let best = null, bestD = -1;
    for (const e of this.enemies) {
      if (e.dead || e.leaked) continue;
      if (e.arch.kind === 'fly' && !u.arch.hitsAir) continue;
      if (e.blockedBy === u) { /* always in range */ }
      else if (!this.inRange(u, e)) continue;
      if (e.dist > bestD) { bestD = e.dist; best = e; }
    }
    return best;
  }
  unitAtk(u) {
    let m = 1;
    for (const s of u.statuses) if (s.k === 'atk') m *= s.v;
    for (const other of this.units) {
      if (other !== u || other.dead || !other.aura) continue;
      if ((other.aura.k === 'zoneAtk' || other.aura.k === 'zoneStat') && this.inRange(other, u))
        m *= other.aura.k === 'zoneStat' ? 1 + other.aura.p : other.aura.v;
    }
    return u.atk * m;
  }
  unitAtkSpeed(u) {
    let m = 1 + this.mod.atkSpeedPct;
    for (const s of u.statuses) if (s.k === 'atkSpd') m *= s.v;
    for (const other of this.units) {
      if (other !== u || other.dead || !other.aura) continue;
      if (other.aura.k === 'zoneAtkSpd' && this.inRange(other, u)) m *= other.aura.v;
    }
    return m;
  }
  hitsAir(u) { return u.arch.hitsAir; }

  doAttack(u) {
    const target = this.pickTarget(u);
    if (!target) return;
    let atk = this.unitAtk(u);
    let kind = u.arch.class === 'WITCH' ? 'magic' : 'phys';
    let ignoreDef = false, splash = 0, oilGain = 0;
    for (const s of u.statuses) {
      if (s.k === 'ignoreDef') ignoreDef = true;
      if (s.k === 'splash') splash = s.v;
      if (s.k === 'oilPerHit') oilGain = Math.max(oilGain, s.v);
    }
    let raw;
    if (kind === 'phys') {
      raw = Math.max(atk * 0.1, atk - target.def);
      raw *= (1 + this.mod.physPct);
    } else {
      raw = atk * 100 / (100 + target.res);
      raw *= (1 + this.mod.magicPct);
    }
    if (ignoreDef && kind === 'phys') raw = atk * (1 + this.mod.physPct);
    raw *= (1 + this.mod.allPct);
    if (target.arch.role !== 'basic') raw *= (1 + this.mod.vsElite);
    if (target.arch.role === 'boss') raw *= (1 + this.mod.vsBoss);
    if (target.arch.kind === 'fly') raw *= (1 + this.mod.vsFly);
    // elite/boss skill multipliers
    for (const s of u.statuses) {
      if (s.k === 'elite' && target.arch.role !== 'basic') raw *= s.v;
    }
    raw *= 0.92 + this.rng.next() * 0.16;
    this.damageEnemy(target, raw, kind, u);
    this.emit('attack', { u, target, raw, kind });
    // witch passive dot
    const sk = u.skills.find(x => x.id === 'sk_witch_a');
    if (sk && !target.dead) {
      const p = C.skillParam('sk_witch_a', sk.tier);
      target.dots.push({ dps: atk * p, t: 3, kind: 'magic' });
    }
    // warrior passive counter is applied on enemy hit (see hitUnit)
    if (splash > 0) {
      for (const e2 of this.enemies) {
        if (e2 === target || e2.dead) continue;
        if (Math.hypot(e2.x - target.x, e2.y - target.y) <= 1.3) {
          this.damageEnemy(e2, raw * splash, kind, u);
        }
      }
      this.emit('splash', { u, x: target.x, y: target.y });
    }
    const oilHit = oilGain + (u.skills.some(x => x.id === 'sk_runner_a') ? C.skillParam('sk_runner_a', u.skills[0].tier) : 0);
    if (oilHit) this.oil = Math.min(this.oilMax, this.oil + oilHit);
    u.sp = Math.min(100, u.sp + 3);
  }

  hitUnit(u, enemy) {
    // warrior counter
    const sk = u.skills.find(x => x.id === 'sk_warrior_a');
    if (sk && enemy && enemy.arch.kind === 'ground') {
      const p = C.skillParam('sk_warrior_a', sk.tier);
      if (this.rng.chance(p)) {
        const dmg = this.unitAtk(u) * 0.6;
        this.damageEnemy(enemy, Math.max(dmg * 0.1, dmg - enemy.def), 'phys', u);
        this.emit('counter', { u, enemy });
      }
    }
  }

  /* ---------- skills ---------- */
  castSkill(u, sk) {
    const s = SKILLS[sk.id];
    const p = C.skillParam(s.id, sk.tier);
    switch (s.kind) {
      case 'atk_speed_self': u.statuses.push({ k: 'atkSpd', v: 1 + p, t: s.duration }); break;
      case 'oil_rush':
        u.statuses.push({ k: 'atkSpd', v: 1.5, t: s.duration });
        u.statuses.push({ k: 'oilPerHit', v: p, t: s.duration });
        break;
      case 'shield_self_pct':
        u.shield = Math.round(u.maxHp * p); u.shieldT = s.duration; break;
      case 'taunt_zone':
        u.statuses.push({ k: 'taunt', v: 0, t: s.duration });
        u.statuses.push({ k: 'dmgDown', v: 1 - p, t: s.duration });
        break;
      case 'atk_up_self': u.statuses.push({ k: 'atk', v: 1 + p, t: s.duration }); break;
      case 'splash_pct': u.statuses.push({ k: 'splash', v: p, t: s.duration }); break;
      case 'burst_atk':
        u.statuses.push({ k: 'atk', v: 1 + p, t: s.duration });
        u.statuses.push({ k: 'elite', v: 1 + p * 0.75, t: s.duration });
        break;
      case 'aoe_burst_pct': {
        const t = this.pickTarget(u);
        if (t) {
          const dmg = this.unitAtk(u) * p;
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (e === t || Math.hypot(e.x - t.x, e.y - t.y) <= 1.6)
              this.damageEnemy(e, dmg, 'magic', u);
          }
          this.emit('aoe', { u, x: t.x, y: t.y, r: 1.6 });
        }
        break;
      }
      case 'ignore_def_atk':
        u.statuses.push({ k: 'ignoreDef', v: 1, t: s.duration });
        u.statuses.push({ k: 'atk', v: 1 + p, t: s.duration });
        break;
      case 'heal_zone_pct_hp':
        for (const a of this.units) {
          if (a.dead || a === u) continue;
          if (this.inRange(u, a)) {
            a.hp = Math.min(a.maxHp, a.hp + a.maxHp * p);
            this.emit('heal', { x: a.x, y: a.y, v: a.maxHp * p });
          }
        }
        break;
      case 'dmg_taken_down_zone': u.aura = { k: 'zoneDmgDown', v: 1 - p }; u.auraT = s.duration; break;
      case 'atk_up_zone_pct': u.aura = { k: 'zoneAtk', v: 1 + p }; u.auraT = s.duration; break;
      case 'atk_speed_zone_pct': u.aura = { k: 'zoneAtkSpd', v: 1 + p }; u.auraT = s.duration; break;
      case 'stat_up_zone': u.aura = { k: 'zoneStat', p }; u.auraT = s.duration; break;
      default: break;
    }
    this.emit('skill', { u, skill: s });
  }

  /* ---------- wave flow ---------- */
  startWave(i) {
    this.waveIdx = i;
    this.phase = 'wave';
    this.spawnQ = [];
    let t = 0;
    for (const sp of this.plan.waves[i]) {
      for (let k = 0; k < sp.count; k++) {
        this.spawnQ.push({ t: t + sp.pre, eid: sp.enemyId, lane: sp.lane });
        t += sp.interval;
      }
      t += 1.2;
    }
    this.spawnT = 0;
    this.emit('wave', { i: i + 1, total: this.plan.waves.length });
  }
  totalWaves() { return this.plan.waves.length; }
  waveAlive() {
    return this.enemies.filter(e => !e.dead && !e.leaked).length;
  }

  /* ================= main tick ================= */
  tick(dtRaw) {
    if (this.over || this.paused) return;
    let dt = dtRaw * this.speed;
    const STEP = 1 / 60;
    let guard = 0;
    while (dt > 0 && guard++ < 240) {
      const h = Math.min(STEP, dt);
      dt -= h;
      this.step(h);
    }
  }
  step(dt) {
    this.t += dt;
    // 绯·不灭: once per stage, when base is low, units take 50% less damage for 10s
    if (this.mod.lowHpShield > 0 && !this.lowHpShieldUsed &&
        this.baseHp / this.baseMaxHp < 0.3 && this.baseHp > 0) {
      this.lowHpShieldUsed = true;
      for (const u of this.units)
        u.statuses.push({ k: 'dmgDown', v: 1 - this.mod.lowHpShield, t: 10 });
      this.emit('lowHpShield', {});
    }
    // oil regen: 1 per 1.1s
    this.oilTick += dt;
    const oilEvery = 1.1 / (1 + this.mod.oilRegenPct);
    while (this.oilTick >= oilEvery) {
      this.oilTick -= oilEvery;
      this.oil = Math.min(this.oilMax, this.oil + 1);
    }
    // phase logic
    if (this.phase === 'prep') {
      this.phaseT += dt;
      if (this.phaseT >= this.plan.prep) this.startWave(0);
    } else if (this.phase === 'wave') {
      this.spawnT += dt;
      while (this.spawnQ.length && this.spawnQ[0].t <= this.spawnT) {
        const s = this.spawnQ.shift();
        if (this.enemies.filter(e => !e.dead && !e.leaked).length < 45)
          this.spawnEnemy(s.eid, s.lane);
        else this.spawnQ.unshift(s);
        break;
      }
      if (!this.spawnQ.length && this.waveAlive() === 0) {
        if (this.waveIdx + 1 >= this.plan.waves.length) {
          this.phase = 'cleared'; this.over = true; this.result = 'win';
          this.emit('cleared', {});
        } else {
          this.onWaveEnd();
          this.phase = 'inter'; this.phaseT = 0;
        }
      }
    } else if (this.phase === 'inter') {
      this.phaseT += dt;
      if (this.phaseT >= 2.5) this.startWave(this.waveIdx + 1);
    }

    this.updateEnemies(dt);
    this.updateUnits(dt);
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.dead || e.leaked) continue;
      const lane = this.lanes[e.lane];
      // regen trait
      if (e.arch.traits.includes('regen')) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.03 * dt);
      // dots
      for (const d of e.dots) {
        d.t -= dt;
        this.damageEnemy(e, d.dps * dt, d.kind, null);
      }
      e.dots = e.dots.filter(d => d.t > 0 && !e.dead);
      if (e.dead) continue;
      // slow
      if (e.slow) { e.slow.t -= dt; if (e.slow.t <= 0) e.slow = null; }
      const spd = e.speed * (e.slow ? e.slow.m : 1);
      // summoners
      if (e.arch.traits.includes('summon')) {
        e.sumCd -= dt;
        if (e.sumCd <= 0) {
          e.sumCd = e.arch.role === 'boss' ? 10 : 8;
          const mine = this.enemies.filter(x => !x.dead && x.summonedBy === e).length;
          if (mine < 4) {
            const sub = e.arch.role === 'boss' ? (e.arch.id === 'b_shu' ? 'e_ha' : 'e_kotsu') : 'e_ki';
            for (let k = 0; k < (e.arch.role === 'boss' ? 2 : 2); k++) {
              const s = this.spawnEnemy(sub, e.lane, Math.max(0, e.dist - 0.4 - k * 0.3));
              s.summonedBy = e;
            }
          }
        }
      }
      // final boss: summon burst at 66%
      if (e.arch.traits.includes('phase') && !e.phaseDone) {
        if (e.hp <= e.maxHp * 0.66) {
          e.phaseDone = true;
          for (let k = 0; k < 3; k++) {
            const s = this.spawnEnemy(k < 2 ? 'e_ha' : 'e_kotsu', e.lane, Math.max(0, e.dist - 0.4 - k * 0.3));
            s.summonedBy = e;
          }
          this.emit('bossPhase', { e });
        }
      }
      // enrage at 50% (hyakume / final boss second half)
      if (e.arch.traits.includes('enrage') && !e.enraged && e.hp <= e.maxHp * 0.5) {
        e.enraged = true; e.speed *= 1.5; e.atk = Math.round(e.atk * 1.4);
        this.emit('bossPhase', { e });
      }

      // --- movement / blocking ---
      if (e.arch.kind === 'ground') {
        // taunt check first
        let tauntU = null;
        if (!e.tauntedBy || e.tauntedBy.dead) e.tauntedBy = null;
        for (const u of this.units) {
          const s = u.statuses.find(x => x.k === 'taunt');
          if (s && !u.dead && Math.hypot(u.x - e.x, u.y - e.y) <= 3.2) { tauntU = u; break; }
        }
        if (tauntU) {
          if (e.tauntedBy !== tauntU) {
            if (e.blockedBy) e.blockedBy.blocked = e.blockedBy.blocked.filter(x => x !== e);
            e.tauntedBy = tauntU;
          }
          this.enemyAttackUnit(e, tauntU, dt);
          continue;
        } else if (e.tauntedBy) {
          e.tauntedBy = null;
        }
        // find first blocker ahead
        const dNext = e.dist + spd * dt;
        const cellNext = cellAt(lane, dNext);
        const key = cellNext[0] + ',' + cellNext[1];
        const blocker = this.cellOfUnit[key];
        if (blocker && blocker.block > 0) {
          const ahead = blocker;
          if (e.blockedBy !== ahead) {
            if (e.blockedBy) e.blockedBy.blocked = e.blockedBy.blocked.filter(x => x !== e);
            e.queueSlot = ahead.blocked.length;
            ahead.blocked.push(e);
            e.blockedBy = ahead;
          }
          let stopAt;
          if (e.arch.attack === 'ranged') {
            stopAt = Math.max(0.05, (lane.cellStart[key] || 0) - 2.2 - 0.5 * e.queueSlot);
          } else {
            stopAt = Math.max(0.02, (lane.cellStart[key] || 0) - 0.3 - 0.5 * e.queueSlot);
          }
          if (e.dist < stopAt) {
            e.dist = Math.min(stopAt, dNext);
            e.state = 'blocked';
          }
          if (e.dist >= stopAt - 0.01) {
            this.enemyAttackUnit(e, ahead, dt);
            const p = posAt(lane, e.dist); e.x = p.x; e.y = p.y;
            continue;
          }
        } else if (e.blockedBy) {
          // blocker gone: resume
          e.blockedBy = null; e.queueSlot = 0;
        }
      }
      // move
      e.dist += spd * dt;
      if (e.dist >= lane.total) {
        e.leaked = true;
        const dmg = e.arch.role === 'boss' ? 30 : (e.arch.role === 'elite' ? 10 : 5);
        this.baseHp -= dmg;
        this.stats.leaked++;
        this.emit('leak', { e, dmg });
        if (this.baseHp <= 0 && !this.over) {
          this.baseHp = 0; this.over = true; this.result = 'lose';
          this.emit('lost', {});
        }
        continue;
      }
      const p = posAt(lane, e.dist);
      e.x = p.x; e.y = p.y;
      e.state = 'move';
    }
    this.enemies = this.enemies.filter(e => !e.dead && !e.leaked);
  }

  enemyAttackUnit(e, u, dt) {
    if (u.dead) { e.blockedBy = null; return; }
    e.atkCd -= dt;
    if (e.atkCd > 0) return;
    e.atkCd = e.atkTime;
    let raw = Math.max(e.atk * 0.1, e.atk - u.def);
    let kind = 'phys';
    if (e.arch.traits.includes('aoe')) {
      // splash to nearby units
      this.damageUnit(u, raw * 1.2, e);
      for (const a of this.units) {
        if (a === u || a.dead) continue;
        if (Math.hypot(a.x - u.x, a.y - u.y) <= 1.6) this.damageUnit(a, raw * 0.6, e);
      }
      this.emit('attack', { e, target: u, raw, kind: 'aoe' });
    } else {
      this.damageUnit(u, raw, e);
      this.emit('attack', { e, target: u, raw, kind });
      if (e.arch.traits.includes('poison')) { u.poisonT = 3; u.poisonDps = e.atk * 0.15; }
    }
    this.hitUnit(u, e);
  }

  updateUnits(dt) {
    for (const u of this.units) {
      if (u.dead) continue;
      // statuses
      for (const s of u.statuses) s.t -= dt;
      u.statuses = u.statuses.filter(s => s.t > 0);
      if (u.aura) {
        u.auraT -= dt;
        if (u.auraT <= 0) u.aura = null;
      }
      if (u.shield > 0) {
        u.shieldT = (u.shieldT || 0) - dt;
        if (u.shieldT <= 0) u.shield = 0;
      }
      // poison from doku enemies
      if (u.poisonT > 0) {
        u.poisonT -= dt;
        this.damageUnit(u, (u.poisonDps || 0) * dt, null);
        if (u.dead) continue;
      }
      // sp regen
      u.spRegen = u.arch.spRegen;
      u.sp = Math.min(100, u.sp + u.spRegen * (1 + this.mod.spRegenPct) * dt);
      // heal tick (medic passive)
      const hsk = u.skills.find(x => x.id === 'sk_medic_a');
      if (hsk) {
        u.healCd -= dt;
        if (u.healCd <= 0) {
          u.healCd = 4;
          let best = null, br = 2;
          const p = C.skillParam('sk_medic_a', hsk.tier);
          for (const a of this.units) {
            if (a.dead || a === u) continue;
            if (!this.inRange(u, a)) continue;
            const ratio = a.hp / a.maxHp;
            if (ratio < br) { br = ratio; best = a; }
          }
          if (best && br < 0.999) {
            best.hp = Math.min(best.maxHp, best.hp + best.maxHp * p);
            this.emit('heal', { x: best.x, y: best.y, v: best.maxHp * p });
          }
        }
      }
      // attack
      u.cd -= dt;
      if (u.cd <= 0) {
        const t = this.pickTarget(u);
        if (t) {
          this.doAttack(u);
          u.cd = u.atkTime / this.unitAtkSpeed(u);
        } else {
          u.cd = 0.12; // keep checking
        }
      }
      // skill cast
      const sk = u.skills.find(x => SKILLS[x.id].trigger === 'AUTO');
      if (sk) {
        const s = SKILLS[sk.id];
        if (u.sp >= s.spCost) {
          u.sp = 0;
          this.castSkill(u, sk);
        }
      }
    }
    // shield tick for relic wave-shield is applied at wave end (see UI layer)
  }

  /* wave-end relic hooks called by the run controller between stages */
  onWaveEnd() {
    if (this.mod.healWavePct > 0) {
      for (const u of this.units)
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * this.mod.healWavePct);
    }
    if (this.mod.waveShieldPct > 0) {
      for (const u of this.units) {
        u.shield = Math.max(u.shield || 0, u.maxHp * this.mod.waveShieldPct);
        u.shieldT = Math.max(u.shieldT || 0, 20);
      }
    }
  }
  onStageStart() {
    if (this.mod.startHpPct > 0)
      this.baseHp = Math.min(this.baseMaxHp, this.baseHp + this.baseMaxHp * this.mod.startHpPct);
  }
}

/* relic roll helper: weighted by rarity (r1 most common), no dupes */
function rollRelics(rng, count, owned) {
  const pool = C.D.relics.relics.filter(r => !owned.includes(r.id));
  const out = [];
  const used = new Set();
  const w = r => (r.rarity === 1 ? 5 : r.rarity === 2 ? 3 : 1.4);
  while (out.length < count && used.size < pool.length) {
    let tw = 0;
    for (const r of pool) if (!used.has(r.id)) tw += w(r);
    if (tw <= 0) break;
    let x = rng.next() * tw, r = null;
    for (const c of pool) {
      if (used.has(c.id)) continue;
      x -= w(c);
      if (x <= 0) { r = c; break; }
    }
    if (!r) r = pool.find(c => !used.has(c.id));
    used.add(r.id);
    out.push(r);
  }
  return out;
}

window.Engine = { Game, genStagePlan, rollRelics, buildLane, posAt, cellAt };
})();
