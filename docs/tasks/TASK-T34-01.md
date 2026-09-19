# TASK-T34-01 · 🎨 设计对齐：侧栏与顶栏模仿 Notion（配色 + 层级）

> PM：Hermes ｜ 优先级 **P1（老板明确要求）** ｜ 前置：T33-01（手柄装订线）交付后
> 依据：老板提供的 **Notion 界面截图**（1315×859），PM 用 Python 逐像素采样得到真实色值（非主观估计）

## 0. 目标配色（**采样自老板的 Notion 截图**，浅色主题必须以这些值为准）

| 语义 | 目标值 | 采样依据 |
|---|---|---|
| 侧栏背景 | **`#F9F8F7`** | x=60 竖向 6 点全为该值（120,722 px 主导色） |
| 行悬停底色 | `#F1F0EF`（介于背景与选中之间；如 Notion 实测更浅则取实测） | 由 `#F9F8F7`/`#EEECEB` 推得，允许微调 |
| 行选中底色 | **`#EEECEB`** | 侧栏高频色第 2 位（8,526 px） |
| 主文字 | **`#2C2C2B`** | 侧栏暗色样本 |
| 次级文字 | **`#5F5E59`** | 侧栏高频色第 4 位（999 px） |
| 图标/弱化文字 | `#8E8B86`（更弱：`#9B9994`） | 侧栏高频色 |
| 内容区背景 | **`#FFFFFF`** | 主区 3 点采样全为白 |
| **顶栏背景** | **`#F9F8F7`（与侧栏同色！**不是白色） | 顶栏 y=20 在 x=600/1000 均为该值 |
| 分隔线（hairline） | `#EAE8E6` | 侧栏高频色 |
| 强调色 | `#FA5151` | 高频色第 3 位（3,322 px，红点/提醒类） |

**深色主题**（老板截图仅浅色）：按 Notion 深色同构对齐——侧栏 `#202020`、内容区 `#191919`、主文字 `#FFFFFFE6`、次级 `#FFFFFF7A`、hairline `#2F2F2F`；**若老板后续给深色截图，PM 会再采样一次做精修**。

## 1. 任务

1. **token 真源**：改 `DESIGN.md` → 跑 `node packages/ui/tokens/build-tokens.mjs --write` → `--check` 必须一致。侧栏/顶栏相关语义 token 一律换成本表值（浅色）；深色按 §0 对齐。
2. **顶栏（`sc-shell__topbar`）**：背景改为**与侧栏同色**（当前是白色画布色）；高度、面包屑字号（14px 量级）、右侧动作区排布向 Notion 靠拢；下边线用 hairline；**不要**在顶栏放重底色或强阴影。
3. **侧栏（`.app-side`）**：背景 `#F9F8F7`；行高 ~28–32px、左右内边距 ~8px、圆角 ~4–6px；**悬停**用 `#F1F0EF`、**选中**用 `#EEECEB`（选中不加粗到失真、可略加粗/加深文字）；分组标题（收藏/最近/回收站）用小字 + `#8E8B86` 弱化色；图标尺寸/间距与 Notion 观感一致；底部工具行（回收站等）弱化。
4. **不改变布局与功能**：只动配色/圆角/间距/层级，**不得**改动侧栏结构、折叠行为、块手柄装订线（T33-01 的几何成果必须保持）。
5. **可访问性**：文字类 token 必须过既有对比度门禁（`packages/ui/test/contrast.test.ts`，≥4.5）；`#8E8B86` 仅用于图标/非文字弱化元素，**不可**用于正文级文字（对比度不足）。
6. **双主题 × 四态**齐备（默认/hover/active/disabled 或 focus）。

## 2. 验收（必须全过）

1. **色值断言**（层测）：侧栏背景 = `#F9F8F7`、选中行 = `#EEECEB`、顶栏背景 = `#F9F8F7`、内容区 = `#FFFFFF`（浅色）；深色主题同构断言。
2. **对比度门禁**：既有 13 对断言全绿（≥4.5）；如因换色需要调整，**必须**在报告说明并保持 ≥4.5。
3. **真机**：浅/深双主题各一张**侧栏 + 顶栏**截图，与老板的 Notion 截图并排对比（交付时 PM 会给老板并排图）；顶栏与侧栏**同色**这一条要在截图里可辨。
4. **回归**：侧栏折叠（width→0）、窗口零滚动、侧栏不随内容滚（T30 成果）、块手柄装订线（T33 成果）全部保持；`no-magic`、`build-tokens --check`、`pnpm -r test`、`pnpm -r typecheck` 全绿。

## 3. 红线

- 允许动：`packages/ui/src/**`（含 `AppShell.css`、`tokens.css` 产物由脚本生成）、`packages/ui/tokens/**`、`DESIGN.md`（仓库根）、`apps/desktop/src/renderer/src/App.css`、`apps/desktop/src/renderer/src/pages/{SidebarTree,PageView}.css`、`apps/desktop/test/**`、`packages/ui/test/**`。
- 不碰：`packages/{core,sync,editor,dbview,importer}` 逻辑、`main/**`、CI/发布脚本、块手柄几何（T33-01 成果）。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。
- UI 红线：CSS **只走 token**、无字面 hex（颜色必须进 token 产物）、无非 1px 重复裸 px（本单新增间距/圆角取值须走 spacing/radius token，若 token 缺失则在 `DESIGN.md` 补语义 token）。

## 4. 交付物

`DESIGN.md` + token 产物 + 侧栏/顶栏 CSS 改动 + 测试（色值断言 + 对比度）+ **浅/深双主题截图**（侧栏+顶栏）+ `docs/tasks/TASK-T34-01-report.md`（PM 复跑节留「（PM 补）」；含色值对照表「目标 vs 实现」、DEVIATION 逐条）。