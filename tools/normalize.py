#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
百妖灯阵 (Lantern Array) — data normalization pipeline.

Reads the public reference dataset (this repo) and distills it into clean,
IP-free schemas for the original game:

  game/data/units.json    unit classes + 1-6★ stat curves (original yokai names)
  game/data/skills.json   ability system (trigger types + effect categories)
  game/data/enemies.json  enemy archetypes (ground/air, roles, behaviors)
  game/data/waves.json    stage/wave generator curves + lane templates
  game/data/relics.json   roguelike relics, events, lamp-level & meta curves
  game/data/ranges.json   normalized attack-range shapes
  game/js/data.js         all of the above bundled as window.YO_DATA

Reference sources (paths relative to repo root):
  zh_CN/gamedata/excel/character_table.json     profession & per-rarity stats
  zh_CN/gamedata/excel/skill_table.json         skill trigger/effect taxonomy
  zh_CN/gamedata/levels/enemydata/enemy_database.json   enemy archetypes
  zh_CN/gamedata/excel/stage_table.json + zh_CN/gamedata/levels/obt/main/*.json
  zh_CN/gamedata/excel/range_table.json         range shapes
  zh_CN/gamedata/excel/roguelike_table.json     relics & run progression

All original character/enemy/stage/relic NAMES are stripped and replaced with
original themed names.  Only structural/statistical information is carried over.
Run:  python3 tools/normalize.py   (from repo root)
"""
import json, math, os, re, statistics, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EX = os.path.join(ROOT, 'zh_CN', 'gamedata', 'excel')
LV = os.path.join(ROOT, 'zh_CN', 'gamedata', 'levels')
OUT = os.path.join(ROOT, 'game', 'data')
JS_OUT = os.path.join(ROOT, 'game', 'js')

def jload(p):
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)

def jdump(name, obj):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print('wrote', p)

def mv(x):
    """unwrap {m_defined,m_value}"""
    if isinstance(x, dict) and 'm_value' in x:
        return x['m_value']
    return x

def rnd(x, n=0):
    if x is None: return None
    return round(x, n) if n else int(round(x))

# ----------------------------------------------------------------------------
# 1. RANGE SHAPES
# ----------------------------------------------------------------------------
class Shapes:
    def __init__(self):
        self.shapes = {}      # key -> {'cells': [(r,c)...]}
        self._keymap = {}     # original range id -> shape key

SHAPES = Shapes()

def shape_key(cells):
    # normalize: translate min r/c to 0, then canonical order (sort tuples),
    # then try 4 rotations + mirror to get canonical min-string
    def canon(cs):
        rmin = min(r for r, c in cs); cmin = min(c for r, c in cs)
        cs = sorted((r - rmin, c - cmin) for r, c in cs)
        def rot(cs): return sorted((c, -r) for r, c in cs)
        def mir(cs): return sorted((r, -c) for r, c in cs)
        cur = cs; best = None
        for i in range(4):
            for cand in (cur, mir(cur)):
                rr = min(r for r, c in cand); cc = min(c for r, c in cand)
                key = tuple(sorted((r - rr, c - cc) for r, c in cand))
                s = json.dumps(list(key))
                if best is None or s < best: best = s
            cur = rot(cur)
        return best
    return canon(cells)

def build_shapes():
    rt = jload(os.path.join(EX, 'range_table.json'))
    groups = defaultdict(list)
    for rid, r in rt.items():
        g = r.get('grids') or []
        if not g: continue
        cells = [(c['row'], c['col']) for c in g]
        groups[shape_key(cells)].append((rid, cells))
    keys = sorted(groups.keys(), key=lambda k: (len(groups[k][0][1]), k))
    out = {}
    for i, k in enumerate(keys, 1):
        key = f's{i:02d}'
        rid, cells = groups[k][0]
        # cells are directional (dir=1: extends from anchor); store as offsets
        rmin = min(r for r, c in cells); cmin = min(c for r, c in cells)
        norm = sorted((r - rmin, c - cmin) for r, c in cells)
        out[key] = {'cells': [[r, c] for r, c in norm], 'n': len(cells),
                    'w': max(c for r, c in norm) + 1, 'h': max(r for r, c in norm) + 1}
        for orig, _ in groups[k]:
            SHAPES._keymap[orig] = key
    # symmetric melee adjacency (unit cell + 4-neighbours)
    out['plus4'] = {'cells': [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]],
                    'n': 5, 'w': 3, 'h': 3, 'symmetric': True}
    return out

# ----------------------------------------------------------------------------
# 2. UNITS (character_table)
# ----------------------------------------------------------------------------
PROFS = ['PIONEER', 'TANK', 'WARRIOR', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT']
CLASS_OF = {
    'PIONEER': 'RUNNER', 'TANK': 'GUARD', 'WARRIOR': 'WARRIOR',
    'SNIPER': 'SHOOTER', 'CASTER': 'WITCH', 'MEDIC': 'MEDIC', 'SUPPORT': 'CHANT',
}
CLASS_INFO = {
    'RUNNER':  {'name': '疾风', 'role': '轻量突进，攻击产出灯油'},
    'GUARD':   {'name': '镇石', 'role': '驻守灯道，阻挡浊妖'},
    'WARRIOR': {'name': '破阵', 'role': '近身强攻，破甲反击'},
    'SHOOTER': {'name': '远影', 'role': '远距单体，可击飞空'},
    'WITCH':   {'name': '咒焰', 'role': '咒术群伤，无视防御'},
    'MEDIC':   {'name': '回辉', 'role': '恢复友方灯灵'},
    'CHANT':   {'name': '祝言', 'role': '范围光环，强化友军'},
}
# 42 original names: 7 classes x 6 rarities (1★..6★)
NAMES = {
    'RUNNER':  ['灯蝉', '纸鹤', '风铃童', '迅萤', '铃驹', '千羽'],
    'GUARD':   ['石坊', '岩座', '灯守翁', '铁塔', '玄岳', '不动'],
    'WARRIOR': ['赤鬼', '角刃', '轰鼓', '牙狼', '狱炎', '天鼓'],
    'SHOOTER': ['青羽', '一矢', '鸦影', '风切', '月翎', '贯空'],
    'WITCH':   ['火玉', '绯狐', '三尾', '灼文', '咒蝶', '九焰'],
    'MEDIC':   ['白纸', '药露', '樱符', '铃兰', '净灯', '大巫'],
    'CHANT':   ['小铃', '诵词', '梵钟', '祝句', '歌行', '太鼓'],
}

def sample_units(char_table):
    """one sampled reference char per (class, tier); stats from level-1 keyframe"""
    picked = {}
    for char_id, v in char_table.items():
        prof = v.get('profession')
        if prof not in PROFS: continue
        rarity = v.get('rarity')
        if not rarity or not rarity.startswith('TIER_'): continue
        tier = int(rarity.split('_')[1])
        ph = v.get('phases') or []
        if not ph: continue
        kf = ph[0].get('attributesKeyFrames') or []
        if not kf: continue
        a = kf[0].get('data') or {}
        if not a.get('maxHp') or not a.get('atk'): continue
        cls = CLASS_OF[prof]
        key = (cls, tier)
        if key in picked: continue
        picked[key] = {
            'cls': cls, 'tier': tier,
            'hp': a['maxHp'], 'atk': a['atk'], 'def': a.get('def', 0),
            'res': a.get('magicResistance', 0) or 0,
            'cost': a.get('cost', 5), 'block': a.get('blockCnt', 0),
            'atkTime': a.get('baseAttackTime', 1.5),
            'spRegen': a.get('spRecoveryPerSec', 1.0) or 1.0,
            'respawn': a.get('respawnTime', 30) or 30,
            'position': v.get('position'),
            'rangeId': ph[0].get('rangeId'),
            'subProf': v.get('subProfessionId'),
        }
    missing = [f'{c} t{t}' for c in PROFS for t in range(1, 7)
               if (CLASS_OF[c], t) not in picked]
    if missing:
        print('WARN missing samples:', missing, file=sys.stderr)
    return picked

def _class_curves(char_table, cls):
    """avg level-1 stats per tier for one class (None when no data)"""
    prof = next((p for p in PROFS if CLASS_OF[p] == cls), None)
    curves = {}
    for v in char_table.values():
        if v.get('profession') != prof: continue
        rarity = v.get('rarity')
        if not rarity or not rarity.startswith('TIER_'): continue
        t = int(rarity.split('_')[1])
        ph = v.get('phases') or []
        if not ph: continue
        kf = ph[0].get('attributesKeyFrames') or []
        if not kf: continue
        a = kf[0].get('data') or {}
        if not a.get('maxHp'): continue
        curves.setdefault(t, []).append(a)
    return {t: {k: statistics.mean(x[k] for x in xs) for k in ('maxHp','atk','def')}
            for t, xs in curves.items() if len(xs) >= 1}

COST_LADDER = {1: 3, 2: 5, 3: 8, 4: 11, 5: 15, 6: 19}
# class range defaults (reference rangeId shapes are directional; the engine
# mirrors them about the unit cell — see engine `rangeCells`).  'plus4' is the
# symmetric melee adjacency derived from the 1-cell melee family.
RANGE_DEFAULT = {'RUNNER': 'plus4', 'GUARD': 'plus4', 'WARRIOR': 'plus4',
                 'SHOOTER': 's23', 'WITCH': 's15', 'MEDIC': 's20', 'CHANT': 's15'}
def _smoothing(cur, key, tmin=1, tmax=6):
    """interpolate missing tiers then enforce monotonic non-decreasing"""
    xs = sorted(t for t in cur if tmin <= t <= tmax)
    if not xs: return None
    out = {}
    for t in range(tmin, tmax + 1):
        if t in cur:
            out[t] = cur[t][key]
        else:
            lo = max((x for x in xs if x < t), default=None)
            hi = min((x for x in xs if x > t), default=None)
            if lo is not None and hi is not None:
                f = (t - lo) / (hi - lo)
                out[t] = cur[lo][key] + (cur[hi][key] - cur[lo][key]) * f
            elif lo is not None:
                out[t] = cur[lo][key] * 1.3
            else:
                out[t] = cur[hi][key] / 1.3
    prev = None
    for t in range(tmin, tmax + 1):
        if prev is not None and out[t] < prev * 0.98:
            out[t] = prev * 1.05
        prev = out[t]
    return out

def build_units(picked, char_table, shape_map):
    units, curve = [], {}
    for cls in [CLASS_OF[p] for p in PROFS]:
        cur = _class_curves(char_table, cls)
        hp_c = _smoothing(cur, 'maxHp')
        atk_c = _smoothing(cur, 'atk')
        def_c = _smoothing(cur, 'def')
        ranged = cls in ('SHOOTER', 'WITCH', 'MEDIC', 'CHANT')
        for tier in range(1, 7):
            if not hp_c or tier not in hp_c:
                continue
            p = {
                'cls': cls, 'tier': tier,
                'hp': hp_c[tier], 'atk': atk_c[tier], 'def': def_c[tier],
                'res': 0, 'cost': COST_LADDER[tier],
                'block': 2 if cls == 'GUARD' else (1 if cls in ('WARRIOR', 'RUNNER') else 0),
                'atkTime': 1.6 if ranged else 1.25,
                'spRegen': 1.5, 'respawn': 30,
                'position': 'RANGED' if ranged else 'MELEE',
                'rangeId': None, 'fromCurve': True,
            }
            curve.setdefault(cls, []).append({
                'tier': tier,
                'hp': rnd(p['hp']), 'atk': rnd(p['atk']), 'def': rnd(p['def']),
                'cost': rnd(p['cost'], 1), 'atkTime': rnd(p['atkTime'], 2),
            })
            # class-default symmetric range (reference shapes are directional;
            # the engine mirrors them, and melee needs full adjacency)
            range_key = RANGE_DEFAULT[cls]
            u = {
                'id': f"u_{cls.lower()}{tier}",
                'name': f"{NAMES[cls][tier-1]}",
                'title': CLASS_INFO[cls]['name'],
                'class': cls, 'rarity': tier,
                'hp': int(p['hp']), 'atk': int(p['atk']),
                'def': int(p['def']), 'res': int(p['res'] or 0),
                'cost': int(p['cost']), 'block': p['block'],
                'atkTime': rnd(p['atkTime'], 2), 'spRegen': rnd(p['spRegen'], 2),
                'range': range_key, 'hitsAir': ranged,
                'desc': CLASS_INFO[cls]['role'] + ('；可攻击空中目标' if ranged else ''),
            }
            units.append(u)
    units.sort(key=lambda u: (u['class'], u['rarity']))
    return units, curve

# ----------------------------------------------------------------------------
# 3. SKILLS (skill_table taxonomy -> original ability system)
# ----------------------------------------------------------------------------
# Reference taxonomy extracted from skill_table.json:
#   trigger : MANUAL (sp charge, player-fired) | AUTO (sp charge, auto-fired)
#             | PASSIVE (always on)
#   sp gain : INCREASE_WITH_TIME | INCREASE_WHEN_ATTACK | INCREASE_WHEN_TAKEN_DAMAGE
#   effects : damage burst / AoE / heal / shield / atk-up / def-up / attack-speed
#             / cost-gain / taunt / summon / DoT
# We map these categories onto original yokai-themed abilities below.
def build_skills():
    S = []
    def add(cls, key, name, trigger, sp, dur, kind, params, tiers, desc):
        S.append({'id': f'sk_{cls.lower()}_{key}', 'class': cls, 'name': name,
                  'trigger': trigger, 'spCost': sp, 'duration': dur,
                  'kind': kind, 'params': tiers, 'desc': desc})
    # RUNNER 疾风
    add('RUNNER','a','火花','PASSIVE',0,0,'oil_on_attack',{'low':2,'mid':2,'high':3},[2,2,3],'攻击时每发产出灯油')
    add('RUNNER','b','疾步','AUTO',55,6,'atk_speed_self',{'low':0.6,'mid':0.7,'high':0.8},[0.6,0.7,0.8],'自身攻击速度大幅提升，持续6秒')
    add('RUNNER','c','灯流','AUTO',95,8,'oil_rush',{'low':3,'mid':3,'high':4},[3,3,4],'8秒内攻速+50%，每次攻击额外产出灯油')
    # GUARD 镇石
    add('GUARD','a','磐衣','PASSIVE',0,0,'dmg_taken_down_self',{'low':0.12,'mid':0.15,'high':0.18},[0.12,0.15,0.18],'自身受到的伤害降低')
    add('GUARD','b','铁壁','AUTO',70,8,'shield_self_pct',{'low':0.5,'mid':0.6,'high':0.7},[0.5,0.6,0.7],'获得等于最大生命比例的法术护盾，持续8秒')
    add('GUARD','c','镇魂','AUTO',100,6,'taunt_zone',{'low':0.35,'mid':0.35,'high':0.4},[0.35,0.35,0.4],'6秒内嘲讽范围内全部敌人，且受到伤害降低')
    # WARRIOR 破阵
    add('WARRIOR','a','反击','PASSIVE',0,0,'counter_hit',{'low':0.25,'mid':0.35,'high':0.45},[0.25,0.35,0.45],'被近身攻击时一定概率反击，造成60%伤害')
    add('WARRIOR','b','奋击','AUTO',65,6,'atk_up_self',{'low':0.45,'mid':0.55,'high':0.65},[0.45,0.55,0.65],'攻击力大幅提升，持续6秒')
    add('WARRIOR','c','鬼哭','AUTO',100,8,'splash_pct',{'low':0.3,'mid':0.3,'high':0.35},[0.3,0.3,0.35],'8秒内攻击溅射目标相邻敌人的30%伤害')
    # SHOOTER 远影
    add('SHOOTER','a','锐眼','PASSIVE',0,0,'dmg_vs_elite',{'low':0.2,'mid':0.3,'high':0.4},[0.2,0.3,0.4],'对精英与首领伤害提升')
    add('SHOOTER','b','连射','AUTO',60,6,'atk_speed_self',{'low':0.45,'mid':0.45,'high':0.5},[0.45,0.45,0.5],'攻速大幅提升（攻击间隔缩短），持续6秒')
    add('SHOOTER','c','贯空','AUTO',95,6,'burst_atk',{'low':0.8,'mid':0.9,'high':1.0},[0.8,0.9,1.0],'攻击力与对精英伤害大幅提升，持续6秒')
    # WITCH 咒焰
    add('WITCH','a','咒蚀','PASSIVE',0,0,'dot_on_hit',{'low':0.08,'mid':0.10,'high':0.12},[0.08,0.10,0.12],'攻击附加3秒灼烧（每秒造成攻击力比例的法术伤害）')
    add('WITCH','b','咒爆','AUTO',75,0,'aoe_burst_pct',{'low':1.4,'mid':1.7,'high':2.0},[1.4,1.7,2.0],'立即对目标周围造成攻击力比例的群咒术伤害')
    add('WITCH','c','焚空','AUTO',100,6,'ignore_def_atk',{'low':0.35,'mid':0.4,'high':0.45},[0.35,0.4,0.45],'6秒内攻击无视防御且攻击力提升')
    # MEDIC 回辉
    add('MEDIC','a','辉泽','PASSIVE',0,0,'heal_tick_pct_hp',{'low':0.05,'mid':0.06,'high':0.07},[0.05,0.06,0.07],'每4秒恢复范围内生命最低友方最大生命的比例')
    add('MEDIC','b','回春','AUTO',70,0,'heal_zone_pct_hp',{'low':0.25,'mid':0.3,'high':0.35},[0.25,0.3,0.35],'立即恢复范围内全体友方最大生命的比例')
    add('MEDIC','c','不灭','AUTO',100,8,'dmg_taken_down_zone',{'low':0.4,'mid':0.45,'high':0.5},[0.4,0.45,0.5],'范围内友方受到伤害大幅降低，持续8秒')
    # CHANT 祝言
    add('CHANT','a','祝文','PASSIVE',0,0,'atk_up_zone_pct',{'low':0.10,'mid':0.12,'high':0.15},[0.10,0.12,0.15],'范围内友方攻击力提升')
    add('CHANT','b','疾咏','AUTO',70,8,'atk_speed_zone_pct',{'low':0.5,'mid':0.5,'high':0.55},[0.5,0.5,0.55],'范围内友方攻速提升，持续8秒')
    add('CHANT','c','天鼓','AUTO',100,10,'stat_up_zone',{'low':0.4,'mid':0.45,'high':0.5},[0.4,0.45,0.5],'范围内友方攻击与最大生命提升（并回满差额），持续10秒')
    return S

# ----------------------------------------------------------------------------
# 4. ENEMIES (enemy_database)
# ----------------------------------------------------------------------------
def load_enemy_db():
    d = jload(os.path.join(LV, 'enemydata', 'enemy_database.json'))
    db = {}
    buckets = defaultdict(list)
    for e in d['enemies']:
        for lv in e['Value']:
            v = lv.get('enemyData') or {}
            a = {k: mv(val) for k, val in (v.get('attributes') or {}).items()}
            tags = mv(v.get('enemyTags')) or []
            rec = {
                'id': e['Key'], 'level': lv.get('level'),
                'name': mv(v.get('name')),
                'hp': a.get('maxHp'), 'atk': a.get('atk'), 'def': a.get('def'),
                'res': a.get('magicResistance'), 'speed': a.get('moveSpeed'),
                'atkTime': a.get('baseAttackTime'), 'atkSpd': a.get('attackSpeed'),
                'mass': a.get('massLevel'), 'regen': a.get('hpRecoveryPerSec'),
                'applyWay': mv(v.get('applyWay')), 'motion': mv(v.get('motion')),
                'levelType': mv(v.get('levelType')), 'tags': tags,
            }
            db[rec['id']] = rec
            b = (rec['levelType'], rec['motion'], rec['applyWay'], rec['mass'])
            if rec['hp'] and rec['atk'] and rec['motion'] in ('WALK','FLY') and rec['applyWay'] in ('MELEE','RANGED'):
                buckets[b].append(rec)
    return db, buckets

def build_enemies(db, buckets):
    # reference bucket averages (used as scale anchors, values anonymized)
    anchors = {}
    for (lt, mo, aw, mass), recs in buckets.items():
        if lt == 'BOSS': continue
        if len(recs) < 5: continue
        anchors[f'{mo}_mass{mass}'] = {
            'hp': rnd(statistics.mean(r['hp'] for r in recs)),
            'atk': rnd(statistics.mean(r['atk'] for r in recs)),
            'def': rnd(statistics.mean(r['def'] or 0 for r in recs)),
            'n': len(recs),
        }
    # original archetypes (names fully original; roles mirror reference
    # ground/fly x tank/attacker/caster/summoner taxonomy)
    A = [
        # id, name, kind, role, hp, atk, def, res, speed, atkTime, attack, mass, traits
        ('e_ki',   '浊滴',     'ground','basic', 140, 30,  0, 0, 0.55, 1.6,'melee',1, []),
        ('e_ka',   '墨蛙',     'ground','basic', 120, 34,  0, 0, 0.75, 1.4,'melee',1, []),
        ('e_ne',   '腐鼠',     'ground','basic',  80, 28,  0, 0, 1.00, 1.2,'melee',1, []),
        ('e_kotsu','骨兵',     'ground','basic', 300, 45, 25, 0, 0.55, 1.8,'melee',2, []),
        ('e_you',  '沙蛹',     'ground','basic', 520, 30, 35, 0, 0.35, 2.2,'melee',2, ['slow']),
        ('e_doku', '毒瘤兽',   'ground','basic', 260, 55, 10, 0, 0.60, 1.5,'melee',2, ['poison']),
        ('e_gani', '铁壳蟹',   'ground','elite', 700, 60, 90,0, 0.45, 2.0,'melee',3, ['armored']),
        ('e_hayate','疾影鸦',  'ground','elite', 260, 70,  0, 0, 1.50, 1.0,'melee',3, ['swift']),
        ('e_shoku','蚀藤妖',   'ground','elite', 620, 40, 10, 0, 0.55, 1.8,'melee',3, ['regen']),
        ('e_kan',  '唤俑师',   'ground','elite', 480, 35,  0, 0, 0.50, 2.5,'melee',3, ['summon']),
        ('e_ketsu','壳妖',     'ground','elite', 500, 50, 20, 0, 0.55, 1.6,'melee',3, ['shield']),
        ('e_tou',  '投岩妖',   'ground','elite', 560, 85, 15, 0, 0.50, 2.2,'ranged',3, []),
        ('e_oni',  '鬼武者',   'ground','elite', 900,110, 60,0, 0.60, 1.5,'melee',4, []),
        ('e_kara', '雾鸦',     'fly',   'basic', 130, 35,  0, 0, 0.90, 1.5,'melee',1, []),
        ('e_hou',  '灯蛾',     'fly',   'basic', 180, 40,  0, 0, 1.20, 1.2,'melee',2, ['swift']),
        ('e_ha',   '冥蝠',     'fly',   'elite', 380, 70,  0,20, 1.40, 1.0,'ranged',3, []),
        ('b_sho',  '浊潮大将', 'ground','boss', 2600,120, 80,10, 0.35, 2.0,'melee',10, ['summon','boss_tank']),
        ('b_fu',   '渊影巫',   'ground','boss', 1800,160,  0,30, 0.30, 2.5,'ranged',12, ['aoe','boss']),
        ('b_hyakume','百目鬼', 'ground','boss', 2200, 90, 20, 0, 0.50, 1.5,'melee',14, ['summon','enrage']),
        ('b_shu',  '灯蚀之主', 'ground','boss', 6000,200, 60,30, 0.25, 2.0,'melee',30, ['summon','enrage','phase']),
    ]
    out = []
    for (eid, name, kind, role, hp, atk, df, res, spd, at, aw, mass, traits) in A:
        out.append({'id': eid, 'name': name, 'kind': kind, 'role': role,
                    'hp': hp, 'atk': atk, 'def': df, 'res': res,
                    'speed': spd, 'atkTime': at, 'attack': aw, 'mass': mass,
                    'traits': traits,
                    'reward': max(2, mass * 2),
                    'desc': {
                        'basic': '浊潮凝聚的基本妖形', 'elite': '凝聚了浊气核心的精英',
                        'boss': '浊潮的化身，击破它'}[role]})
    return {'enemies': out, 'anchors': anchors}

# ----------------------------------------------------------------------------
# 5. WAVES (stage_table + level files) -> generator curves
# ----------------------------------------------------------------------------
def _boss_cadence(profiles):
    idx = [i for i, p in enumerate(profiles) if p['hasBoss']]
    if len(idx) < 2: return None
    gaps = [b - a for a, b in zip(idx, idx[1:])]
    return rnd(statistics.mean(gaps), 2)

def build_waves(enemy_db):
    stage_table = jload(os.path.join(EX, 'stage_table.json'))['stages']
    ids = [k for k in stage_table if re.match(r'main_\d+-\d+$', k)]
    ids.sort(key=lambda k: (int(k.split('_')[1].split('-')[0]), int(k.split('-')[1])))
    profiles = []
    base_dir = os.path.join(LV, 'obt', 'main')
    for sid in ids[:48]:
        lf = os.path.join(base_dir, f'level_{sid}.json')
        if not os.path.exists(lf): continue
        try:
            lv = jload(lf)
        except Exception:
            continue
        routes = [r for r in (lv.get('routes') or []) if r.get('motionMode') == 'WALK']
        if not routes: continue
        # distinct lanes = distinct spawn positions
        lane_set = {(r['startPosition']['row'], r['startPosition']['col']) for r in routes}
        refs = lv.get('enemyDbRefs') or []
        waves = []
        total_mass = 0; total_cnt = 0; elite_mass = 0; boss_mass = 0
        intervals = []
        for w in (lv.get('waves') or []):
            for fr in (w.get('fragments') or []):
                spawns = []
                for ac in (fr.get('actions') or []):
                    if ac.get('actionType') != 'SPAWN': continue
                    key = ac.get('key'); cnt = ac.get('count') or 1
                    mass = 1; etype = 'basic'
                    for ref in refs:
                        if ref.get('id') == key:
                            rec = enemy_db.get(key) or {}
                            mass = rec.get('mass') or 1
                            etype = {'NORMAL':'basic','ELITE':'elite','BOSS':'boss'}.get(rec.get('levelType'),'basic')
                            break
                    intervals.append(ac.get('interval') or 1.0)
                    total_cnt += cnt; total_mass += mass * cnt
                    if etype == 'elite': elite_mass += mass * cnt
                    if etype == 'boss': boss_mass += mass * cnt
                    spawns.append({'type': etype, 'count': cnt, 'interval': rnd(ac.get('interval') or 1.0, 1)})
                if spawns:
                    waves.append({'preDelay': rnd(fr.get('preDelay') or 0.0, 1), 'spawns': spawns})
        if not waves: continue
        prof = {
            'code': f's{len(profiles)+1:02d}',
            'lanes': len(lane_set),
            'waves': len(waves),
            'enemies': total_cnt,
            'mass': total_mass,
            'eliteRatio': rnd(elite_mass / total_mass, 3) if total_mass else 0,
            'hasBoss': boss_mass > 0,
            'avgInterval': rnd(statistics.mean(intervals), 2) if intervals else 1.0,
            'stages': stage_table.get(sid, {}),
        }
        del prof['stages']
        prof['difficulty'] = stage_table.get(sid, {}).get('difficulty')
        prof['bossMark'] = bool(stage_table.get(sid, {}).get('bossMark'))
        prof['danger'] = stage_table.get(sid, {}).get('dangerLevel')
        profiles.append(prof)
    # lane templates (original, monotone-left-to-right)
    lane_templates = [
        {'id':'lt1','lanes':[[[0,3],[8,3]]]},
        {'id':'lt2','lanes':[[[0,2],[5,2],[5,4],[8,4]]],},
        {'id':'lt3','lanes':[[[0,2],[8,2]],[[0,4],[8,4]]]},
        {'id':'lt4','lanes':[[[0,1],[3,1],[3,5],[8,5]],[[0,4],[6,4],[6,2],[8,2]]]},
        {'id':'lt5','lanes':[[[0,1],[4,1],[4,5],[8,5]],[[0,3],[2,3],[2,1],[5,1],[5,3],[8,3]]]},
        {'id':'lt6','lanes':[[[0,1],[8,1]],[[0,3],[3,3],[3,5],[8,5]],[[0,5],[8,5]]]},
    ]
    curve = {
        'stageCount': 18,
        'budget': {'a': 10, 'b': 5.5, 'c': 1.4, 'd': 1.25},   # B(n)=a+b*n+c*n^d
        'statMul': {'a': 1.0, 'b': 0.14, 'c': 0.012},          # 1+b*(n-1)+c*(n-1)^2
        'eliteFrom': 4, 'eliteRate': 0.02, 'eliteMax': 0.28,
        'bossStages': [5, 10, 15, 18],
        'bossPicks': ['b_sho', 'b_fu', 'b_hyakume', 'b_shu'],
        'lanesByStage': {1: 'lt1', 2: 'lt1', 3: 'lt2', 4: 'lt2', 5: 'lt3', 6: 'lt3',
                         7: 'lt4', 8: 'lt4', 9: 'lt5', 10: 'lt4', 11: 'lt5', 12: 'lt5',
                         13: 'lt6', 14: 'lt6', 15: 'lt5', 16: 'lt6', 17: 'lt6', 18: 'lt6'},
        'wavesPerStage': '3 + floor(n/4)',
        'referenceSummary': {
            'sampled': len(profiles),
            'avgLanes': rnd(statistics.mean(p['lanes'] for p in profiles), 2),
            'avgWaves': rnd(statistics.mean(p['waves'] for p in profiles), 2),
            'avgEnemies': rnd(statistics.mean(p['enemies'] for p in profiles), 1),
            'avgMass': rnd(statistics.mean(p['mass'] for p in profiles), 1),
            'bossCadenceAvg': _boss_cadence(profiles),
            'profiles': profiles[:30],
        },
    }
    return {'laneTemplates': lane_templates, 'curve': curve}

# ----------------------------------------------------------------------------
# 6. RELICS (roguelike_table)
# ----------------------------------------------------------------------------
def build_relics(rl):
    # reference: 190 relics keyed by buff blackboards; classified by buff key
    relics_ref = rl['itemTable']['relics']
    keycats = Counter()
    for r in relics_ref.values():
        for b in (r.get('buffs') or []):
            keycats[b.get('key') or b.get('buffKey') or 'unknown'] += 1
    # original relic set mapped onto those categories
    R = []
    def add(rid, name, rar, kind, params, desc):
        R.append({'id': rid, 'name': name, 'rarity': rar, 'kind': kind,
                  'params': params, 'desc': desc})
    add('r1_oilpot',  '素·油灯盏', 1,'start_oil',      40, '每关开局灯油+40')
    add('r1_hpjar',   '素·厚灯罩', 1,'unit_hp_pct',    0.08, '所有灯灵最大生命+8%')
    add('r1_spwick',  '素·快灯芯', 1,'sp_regen_pct',   0.15, '技能充能速度+15%')
    add('r1_coinbag', '素·小钱袋', 1,'kill_oil_flat',  2, '击杀获得的灯油+2')
    add('r1_whet',    '素·磨石',   1,'phys_dmg_pct',   0.06, '物理伤害+6%')
    add('r1_ink',     '素·符墨',   1,'magic_dmg_pct',  0.06, '咒术伤害+6%')
    add('r1_shoes',   '素·草履',   1,'atk_speed_pct',  0.06, '全体攻速+6%')
    add('r2_ped',     '青·铁灯座', 2,'unit_def_flat',  12, '所有灯灵防御+12')
    add('r2_dew',     '青·回春露', 2,'heal_wave_pct',  0.10, '每波结束后全体灯灵回复10%最大生命')
    add('r2_oilskin', '青·灯油囊', 2,'oil_regen_pct',  0.25, '灯油自然恢复+25%')
    add('r2_nails',   '青·破甲钉', 2,'dmg_vs_elite',   0.15, '对精英与首领伤害+15%')
    add('r2_bell',    '青·鸣钟',   2,'deploy_slow',    0.40, '部署灯灵时，范围内敌人减速40%持续2秒')
    add('r2_weave',   '青·织网',   2,'block_plus',     1, '镇石与破阵的阻挡数+1')
    add('r2_coal',    '青·煤炭',   2,'unit_atk_pct',   0.08, '全体攻击+8%')
    add('r2_talis',   '青·名绘',   2,'unit_res_flat',  10, '全体法术抗性+10')
    add('r2_feather', '青·剪羽',   2,'kill_sp_pct',    0.30, '击杀时技能充能+30%')
    add('r2_stone',   '青·石灯',   2,'base_hp_flat',   20, '灯心最大生命+20')
    add('r2_lamp',    '青·夜明',   2,'start_hp_pct',   0.20, '每关开局灯心回复20%最大生命')
    add('r2_air',     '青·风铃',   2,'dmg_vs_fly',     0.20, '对空中目标伤害+20%')
    add('r3_core',    '绯·焰心',   3,'all_dmg_pct',    0.18, '全体伤害+18%')
    add('r3_eternal', '绯·不灭',   3,'low_hp_shield',  0.50, '灯心低于30%时：全体灯灵受伤-50%持续10秒（每关一次）')
    add('r3_thousand','绯·千灯',   3,'deploy_cap',     2, '部署上限+2')
    add('r3_bloodoil','绯·血油',   3,'wave_shield',    0.15, '每波结束后灯灵获得15%最大生命护盾')
    add('r3_thunder', '绯·天罚',   3,'dmg_vs_boss',    0.30, '对首领伤害+30%')
    add('r3_soulbell','绯·魂钟',   3,'death_blast',    450, '灯灵倒下时，对其所在灯道全体敌人造成450点咒术伤害')
    add('r3_lampspirit','绯·灯灵', 3,'oil_cap_up',     100, '灯油上限+100且恢复速度+40%')
    add('r3_free',    '绯·刻印',   3,'first_free',     1, '每关首次部署免费')
    add('r3_mountain','绯·山岳',   3,'unit_hp_pct2',   0.15, '所有灯灵最大生命+15%')
    # events (roguelike_table choices taxonomy: BATTLE/SHOP/REST/INCIDENT/TREASURE)
    events = [
        {'id':'ev_forging','name':'聚焰·淬炼','kind':'unit_upgrade',
         'desc':'选择一名灯灵：攻击+25%，最大生命+25%（每名灯灵仅限一次）'},
        {'id':'ev_oil','name':'聚焰·灌油','kind':'next_stage_oil',
         'params':150,'desc':'下一关开局灯油+150'},
        {'id':'ev_repair','name':'聚焰·修复','kind':'heal_base',
         'desc':'灯心生命完全恢复'},
        {'id':'ev_reroll','name':'聚焰·重塑','kind':'relic_reroll',
         'desc':'将最近获得的一件法器替换为新的随机法器'},
    ]
    # lamp-level curve (from playerLevelTable, rescaled to exp units)
    plt = rl['constTable']['playerLevelTable']
    exp = [int(plt[k]['exp']) for k in sorted(plt, key=int)]
    levels = [{'level': i+1, 'exp': e,
               'bonus': ('deploy_cap' if i+1 in (3,6,9) else ('relic_choice' if i+1 in (4,8) else 'oil'))}
              for i, e in enumerate(exp)]
    return {'relics': R, 'events': events, 'lampLevels': levels,
            'referenceRelicCount': len(relics_ref),
            'referenceBuffCategories': dict(keycats.most_common(12))}

# ----------------------------------------------------------------------------
# 7. META (cross-run progression)
# ----------------------------------------------------------------------------
def build_meta(units):
    cost = {1: 0, 2: 25, 3: 60, 4: 140, 5: 300, 6: 600}
    unlocks = []
    for u in units:
        unlocks.append({'id': u['id'], 'rarity': u['rarity'],
                        'cost': cost[u['rarity']],
                        'unlocked': u['rarity'] == 1 or
                        (u['rarity'] == 2 and u['class'] in ('RUNNER','GUARD','SHOOTER','WITCH'))})
    return {
        'currency': '残焰',
        'earnPerStage': {'base': 6, 'perIndex': 2, 'hpBonus': [[0.8, 15], [0.5, 8]]},
        'unlocks': unlocks,
        'upgrades': [
            {'id': 'up_wick',  'name': '灯芯加固', 'max': 5,
             'costs': [40, 80, 150, 260, 420], 'per': 8,
             'desc': '每级：灯心最大生命+8（100→140）'},
            {'id': 'up_oil',   'name': '预热灯油', 'max': 5,
             'costs': [40, 80, 150, 260, 420], 'per': 40,
             'desc': '每级：开局灯油+40（100→300）'},
            {'id': 'up_array', 'name': '灯阵扩展', 'max': 5,
             'costs': [40, 80, 150, 260, 420], 'per': 1,
             'desc': '每级：部署上限+1（8→12）'},
        ],
    }

# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    print('loading reference tables...')
    char_table = jload(os.path.join(EX, 'character_table.json'))
    skill_table = jload(os.path.join(EX, 'skill_table.json'))
    ranges_raw = jload(os.path.join(EX, 'range_table.json'))
    rl = jload(os.path.join(EX, 'roguelike_table.json'))
    enemy_db, buckets = load_enemy_db()
    print(f'  chars={len(char_table)} skills={len(skill_table)} '
          f'ranges={len(ranges_raw)} enemies={len(enemy_db)}')

    shapes = build_shapes()
    units, curve = build_units(sample_units(char_table), char_table, SHAPES._keymap)
    skills = build_skills()
    # attach skills to units: passive always; active by rarity tier
    skill_by = {}
    for s in skills:
        cls = s['class']
        k = s['id'].split('_')[-1]
        skill_by[(cls, k)] = s
    for u in units:
        cls = u['class']
        a = skill_by[(cls, 'a')]
        u['skills'] = [{'id': a['id'], 'tier': u['rarity'] - 1}]
        if u['rarity'] >= 3:
            s2 = skill_by[(cls, 'b' if u['rarity'] <= 4 else 'c')]
            u['skills'].append({'id': s2['id'], 'tier': {1:0,2:0,3:0,4:1,5:0,6:1}[u['rarity']]})
    enemies = build_enemies(enemy_db, buckets)
    waves = build_waves(enemy_db)
    relics = build_relics(rl)
    meta = build_meta(units)

    jdump('ranges.json', shapes)
    jdump('units.json', {'classes': CLASS_INFO, 'statCurve': curve, 'units': units})
    jdump('skills.json', skills)
    jdump('enemies.json', enemies)
    jdump('waves.json', waves)
    jdump('relics.json', {'relics': relics['relics'], 'events': relics['events'],
                          'lampLevels': relics['lampLevels'],
                          'reference': {'relicCount': relics['referenceRelicCount'],
                                        'buffCategories': relics['referenceBuffCategories']}})
    jdump('meta.json', meta)

    bundle = {
        'game': {'title': '百妖灯阵', 'subtitle': 'Lantern Array', 'version': '1.0.0'},
        'units': jload(os.path.join(OUT, 'units.json')),
        'skills': skills,
        'enemies': enemies,
        'waves': waves,
        'relics': jload(os.path.join(OUT, 'relics.json')),
        'meta': meta,
        'ranges': shapes,
    }
    os.makedirs(JS_OUT, exist_ok=True)
    with open(os.path.join(JS_OUT, 'data.js'), 'w', encoding='utf-8') as f:
        f.write('// 百妖灯阵 — normalized game data (generated by tools/normalize.py)\n')
        f.write('window.YO_DATA = ')
        json.dump(bundle, f, ensure_ascii=False)
        f.write(';\n')
    print('wrote', os.path.join(JS_OUT, 'data.js'))
    print(f'OK: units={len(units)} skills={len(skills)} enemies={len(enemies["enemies"])} '
          f'relics={len(relics["relics"])} shapes={len(shapes)} '
          f'waveProfiles={len(waves["curve"]["referenceSummary"]["profiles"])}')

if __name__ == '__main__':
    main()
