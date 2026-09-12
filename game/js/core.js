/* 百妖灯阵 — core utilities (no DOM) */
(function () {
'use strict';
const D = window.YO_DATA;

/* ---------------- RNG (mulberry32) ---------------- */
function RNG(seed) {
  this.s = seed >>> 0;
}
RNG.prototype.next = function () {
  let t = (this.s += 0x6D2B79F5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
RNG.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
RNG.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
RNG.prototype.chance = function (p) { return this.next() < p; };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }

/* ---------------- data indexes ---------------- */
const UNITS = {};
D.units.units.forEach(u => { UNITS[u.id] = u; });
const SKILLS = {};
D.skills.forEach(s => { SKILLS[s.id] = s; });
const ENEMIES = {};
D.enemies.enemies.forEach(e => { ENEMIES[e.id] = e; });
const RANGES = D.ranges;
const RELICS = {};
D.relics.relics.forEach(r => { RELICS[r.id] = r; });
const EVENTS = D.relics.events;
const META = D.meta;
const WAVES = D.waves;
const CLASSES = D.units.classes;
const CLASS_ORDER = ['RUNNER', 'GUARD', 'WARRIOR', 'SHOOTER', 'WITCH', 'MEDIC', 'CHANT'];
const CLASS_COLOR = {
  RUNNER: '#ffd166', GUARD: '#7fb3d5', WARRIOR: '#e63946', SHOOTER: '#52d4a3',
  WITCH: '#b07ce8', MEDIC: '#7be0ad', CHANT: '#f0a860'
};
const CLASS_GLYPH = {
  RUNNER: '疾', GUARD: '镇', WARRIOR: '破', SHOOTER: '远', WITCH: '咒', MEDIC: '辉', CHANT: '祝'
};

/* skill tier label by unit rarity (0-5) -> 'low'|'mid'|'high' */
function skillTierLabel(idx) { return idx <= 1 ? 'low' : (idx <= 3 ? 'mid' : 'high'); }
function skillParam(skillId, tierIdx) {
  const s = SKILLS[skillId];
  return s.params[skillTierLabel(tierIdx)];
}

/* ---------------- range shapes ----------------
   Reference shapes are directional (top-left normalized). We rebuild them
   centered on the unit cell, mirrored horizontally, so a unit covers a
   symmetric footprint around itself. 'plus4' is already centered. */
const _rangeCache = {};
function rangeCells(shapeKey) {
  if (_rangeCache[shapeKey]) return _rangeCache[shapeKey];
  const sh = RANGES[shapeKey];
  const out = [];
  const seen = {};
  const add = (r, c) => {
    const k = r + ',' + c;
    if (!seen[k]) { seen[k] = 1; out.push([r, c]); }
  };
  if (sh.symmetric) {
    sh.cells.forEach(c => add(c[0], c[1]));
  } else {
    const w = sh.w, h = sh.h;
    sh.cells.forEach(c => {
      const dr = Math.round(c[0] - (h - 1) / 2);
      const dc = Math.round(c[1] - (w - 1) / 2);
      add(dr, dc);
      add(dr, -dc);
    });
  }
  _rangeCache[shapeKey] = out;
  return out;
}

/* grid */
const COLS = 9, ROWS = 7;

window.Core = {
  D, RNG, clamp, lerp,
  UNITS, SKILLS, ENEMIES, RANGES, RELICS, EVENTS, META, WAVES, CLASSES,
  CLASS_ORDER, CLASS_COLOR, CLASS_GLYPH,
  skillTierLabel, skillParam, rangeCells, COLS, ROWS
};
})();
