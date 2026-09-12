# 百妖灯阵 · Lantern Array

原创 HTML5 塔防 + 肉鸽（键鼠 + 触屏，单玩家，纯 Canvas 矢量美术，无外部素材）。
数据仅参考公开数据集结构与数值曲线，已全量剥离原作名称（见 [DESIGN.md](DESIGN.md)）。

## 当前阶段

当前为**可玩 Prototype**，尚未达到生产发布 Gate。下一步只做 **P0 正确性 + P1 快节奏爽感 Vertical Slice**；P2/P3 内容扩张暂时冻结。

完整的可执行任务、所有权、测试命令与验收 Gate 见：**[PRODUCTION_PLAN.md](PRODUCTION_PLAN.md)**。

## 直接玩

```bash
# 任意静态托管均可（也可用 VSCode Live Server / npx serve）
cd game
python3 -m http.server 8080
# 打开 http://localhost:8080
```

`js/data.js` 已内嵌全部数据，双击 `game/index.html` 用 `file://` 直开也能运行。

## 目录

| 文件 | 说明 |
|---|---|
| `PRODUCTION_PLAN.md` | 生产化执行计划、Chat/Codex 分工、P0–P5 Gate 与验收清单 |
| `DESIGN.md` | 当前原型设计与规则 |
| `index.html` / `css/style.css` | 页面与 UI 样式 |
| `js/data.js` | 归一化数据（由管线生成，勿手改） |
| `js/core.js` | RNG / 数据索引 / 范围形状 |
| `js/engine.js` | 纯模拟引擎（无 DOM，可无头测试） |
| `js/render.js` | Canvas 矢量渲染（夜色/山月/灯阵/灯灵/浊妖/特效） |
| `js/ui.js` | DOM UI、输入、WebAudio 小音效 |
| `js/main.js` | 屏幕/局流程/肉鸽/元进度 |
| `data/*.json` | 归一化数据源（units/skills/enemies/waves/relics/ranges/meta） |

## 数据管线（可选，重跑生成）

```bash
python3 tools/normalize.py   # 仓库根目录执行：6 张参考表 -> game/data/*.json + js/data.js
node tools/smoke.mjs         # 当前为无头模拟；P0 将升级为带 assertions 的规则测试 Gate
```

## 当前原型规则速记

- 守住「灯心」，当前原型每局 18 段夜巡；P1 默认 run 将收敛为 12 关。
- 镇石/破阵/疾风可站灯道阻挡；远影/咒焰/回辉/祝言可打飞行。
- 灯灵技能满充能自动释放；当前每关结束 3 选 1 法器，7/13 关有「聚焰」事件。
- 回合外：用「残焰」在百炼炉解锁灯灵与永久强化（localStorage 存档）。
