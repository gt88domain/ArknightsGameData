/* 百妖灯阵 — headless smoke test + difficulty calibration.
   Usage: node tools/smoke.mjs
   Stubs a minimal window, loads data/core/engine (DOM-free), then
   auto-plays full runs with a fixed deployment bot. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameDir = path.join(ROOT, 'game');

const sandbox = { window: {}, console, performance: { now: () => Date.now() }, Math };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const f of ['js/data.js', 'js/core.js', 'js/engine.js']) {
  vm.runInContext(readFileSync(path.join(gameDir, f), 'utf8'), sandbox, { filename: f });
}
const { Core, Engine } = sandbox.window;
const { Game, rollRelics } = Engine;

/* ---------- auto-play bot ---------- */
let RAR_CAP = 99;
const squadIds = () =>
  Object.values(Core.UNITS).filter(u => u.rarity <= RAR_CAP).map(u => u.id);

function pickClass(game, cls) {
  const list = squadIds().filter(id => Core.UNITS[id].class === cls);
  if (!list.length) return null;
  const oil = game ? game.oil : 99;
  const afford = list.filter(id => Core.UNITS[id].cost <= Math.max(3, oil * 0.75));
  const pool = (afford.length ? afford : list)
    .sort((a, b) => Core.UNITS[b].rarity - Core.UNITS[a].rarity);
  const top = pool.slice(0, Math.max(1, Math.floor(pool.length / 2)));
  return top[Math.floor(Math.random() * top.length)];
}

function deployBot(game, opts = {}) {
  const tryDeploy = (id, c, r) => {
    if (!id) return false;
    if (c < 0 || r < 0 || c >= Core.COLS || r >= Core.ROWS) return false;
    if (!game.canDeploy(id, c, r) || game.oil < game.deployCost(id)) return false;
    game.deploy(id, c, r);
    return true;
  };
  const lanes = game.lanes;
  // per-lane coverage: guard on path + witch above + shooter beside
  for (const ln of lanes) {
    const mid = ln.cells[Math.floor(ln.cells.length * 0.45)];
    const alt = ln.cells[Math.floor(ln.cells.length * 0.68)];
    if (!tryDeploy(pickClass(game, 'GUARD'), mid[0], mid[1]))
      tryDeploy(pickClass(game, 'GUARD'), alt[0], alt[1]);
    for (const [c, r] of [[mid[0], mid[1] - 1], [mid[0], mid[1] + 1]]) {
      if (tryDeploy(pickClass(game, 'WITCH'), c, r)) break;
    }
    for (const [c, r] of [[mid[0] + 1, mid[1]], [mid[0] - 1, mid[1]],
                          [alt[0] + 1, alt[1]], [alt[0] - 1, alt[1]]]) {
      if (tryDeploy(pickClass(game, 'SHOOTER'), c, r)) break;
    }
  }
  // economy + support
  const l0 = lanes[0].cells[Math.floor(lanes[0].cells.length * 0.3)];
  tryDeploy(pickClass(game, 'RUNNER'), l0[0], l0[1] + (l0[1] < 3 ? 1 : -1));
  const midL = lanes[Math.floor(lanes.length / 2)];
  const midC = midL.cells[3];
  tryDeploy(pickClass(game, 'MEDIC'), midC[0] + 1, midC[1]);
  tryDeploy(pickClass(game, 'CHANT'), midC[0], midC[1] + (midC[1] < 3 ? 1 : -1));
  // top-ups: more ranged on busy lanes
  if (opts.aggressive) {
    const mL = lanes[lanes.length - 1];
    const m3 = mL.cells[Math.floor(mL.cells.length * 0.8)];
    tryDeploy(pickClass(game, 'WITCH'), m3[0], m3[1] + (m3[1] < 3 ? 1 : -1));
    const m4 = mL.cells[Math.floor(mL.cells.length * 0.25)];
    tryDeploy(pickClass(game, 'GUARD'), m4[0], m4[1]);
  }
}

/* ---------- run simulation ---------- */
function simulateRun(cfg) {
  const relics = [];
  const runRng = new Core.RNG(cfg.seed);
  const result = { stages: [], win: false };
  for (let n = 1; n <= 18; n++) {
    const g = new Game({ n, seed: cfg.seed * 7 + n * 131, meta: cfg.meta,
                         relics, lampLevel: 1, upgraded: [] });
    g.speed = 4;
    deployBot(g, cfg);
    const t0 = Date.now();
    let lastDeploy = 0, guard = 0;
    while (!g.over && guard++ < 400000) {
      g.tick(1 / 30);
      g.events.length = 0;
      // keep topping up the formation as oil accrues (like a player)
      if (g.t - lastDeploy > 7 && g.units.length < g.deployCap) {
        deployBot(g, cfg);
        lastDeploy = g.t;
      }
      if (Date.now() - t0 > 90000) { result.stages.push({ n, note: 'timeout' }); break; }
    }
    g.events.length = 0;
    const won = g.result === 'win';
    result.stages.push({ n, won, hp: Math.max(0, Math.round(g.baseHp)),
                         kills: g.stats.kills, leaked: g.stats.leaked });
    if (!won) { result.win = false; break; }
    if (n === 18) { result.win = true; break; }
    if (cfg.relicsPerStage) {
      const picks = rollRelics(runRng, cfg.relicsPerStage, relics);
      picks.sort((a, b) => b.rarity - a.rarity);
      if (picks[0]) relics.push(picks[0].id);
    }
  }
  return result;
}

console.log('=== 百妖灯阵 headless simulation ===\n');
const configs = [
  { name: 'A: meta0 / 1-2★ squad / no relics',    seed: 42,  meta: { wick: 0, oil: 0, array: 0 }, relicsPerStage: 0, cap: 2 },
  { name: 'B: meta0 / full squad / no relics',    seed: 42,  meta: { wick: 0, oil: 0, array: 0 }, relicsPerStage: 0, cap: 99 },
  { name: 'C: meta3 / 1-4★ squad / 1 relic/stage',seed: 42,  meta: { wick: 3, oil: 3, array: 3 }, relicsPerStage: 1, cap: 4 },
  { name: 'D: meta5 / full squad / 1 relic/stage',seed: 42,  meta: { wick: 5, oil: 5, array: 5 }, relicsPerStage: 1, cap: 99, aggressive: true },
  { name: 'E: meta5 / full squad / 1 relic (s777)',seed: 777, meta: { wick: 5, oil: 5, array: 5 }, relicsPerStage: 1, cap: 99, aggressive: true },
  { name: 'F: meta5 / full squad / 1 relic (s1234)',seed:1234, meta: { wick: 5, oil: 5, array: 5 }, relicsPerStage: 1, cap: 99, aggressive: true },
];
let fail = 0;
for (const cfg of configs) {
  RAR_CAP = cfg.cap;
  const r = simulateRun(cfg);
  const cleared = r.stages.filter(s => s.won).length;
  const line = r.stages.map(s => (s.won ? 'W' : 'L') + s.n).join(' ');
  console.log(`${cfg.name}\n  cleared ${cleared}/18  win=${r.win}\n  ${line}\n`);
}
// basic sanity: stage-1 stage should not take absurdly long
console.log('smoke done');
