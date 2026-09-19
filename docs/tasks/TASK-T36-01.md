# TASK-T36-01 · 🎯 P1：手柄与文字垂直对齐 + 换块型不得让文字上下跳

> PM：Hermes ｜ P1（老板实测）｜ 前置：T33-01（rc.9 已闭环手柄装订线）
> PM 量测探针：`docs/mockups/probe-align-typing.mjs`（已稳定复现）

## 0. PM 实测（rc.9，独立夹具根）

**① 手柄与首行文字不齐**
```
文字首行: top=75 bottom=96 centerY=85 h=21
手柄簇   : top=68 bottom=96 centerY=82 h=28
→ deltaCenterY = -3px（簇比文字中心高 3px）、deltaTop = -7px
```
根因判断：手柄簇按「**整块垂直居中**」定位，而人眼/Notion 的口径是「**与首行行框垂直居中**」→ 单行段落即差 3px；多行块或标题（行高不同）会更明显。

**② 换块型后文字上下跳**
```
P:  top=68 h=36   →  H1: top=64 h=42   （dTop=-4, dH=+6, scrollTop 未变）
再转回 P: top=68  ✓ 精确回位
```
短页仅 4px；但**长页中段**改块型时（字号/行高/margin 变化 + 视口锚定）会出现更明显的跳动感（老板体感「文字上下跑」）。

## 1. 任务

### 1.1 手柄簇与**首行**垂直居中（任何块型、任意行数）
- 口径：手柄簇的垂直中心 = **该块首行行框的垂直中心**，允许偏差 **≤1px**。
- 覆盖块型：段落、标题 1/2/3、无序/有序/待办列表、引用、代码块（各自行高不同）；**多行块**必须按首行对齐（不得按整块居中）。
- 手柄仍 28×28、仍不侵入文本（保持 T33 的 `gutter ≥ 8`）。
- 实现建议：由编辑器给出首行的行框位置（如 `coordsAtPos`/首行 range 的 rect），手柄簇据此定位并夹紧在视口内；**不要**用「块高度/2」的近似。

### 1.2 换块型不得让文字上下跳（视觉锚定）
- 硬指标（真机量测）：**长页中段**把某块在 文本↔H1↔H2↔H3↔列表↔引用↔代码块 之间切换时：
  1. `scrollTop` 变化 = 0（不得因切换滚动）；
  2. 该块**首行行框 top** 的变化 ≤ 业界可接受范围（目标 ≤1px；若因字号变化物理上不可能为 0，则**必须保持首行行框的垂直中心不动**，并在报告中用数值说明取舍口径）；
  3. 切换后光标/选区仍在该块内（不得跳到别处）。
- 若需在块型样式上补「margin/行高补偿」，补偿值走 token。
- 同样适用于斜杠菜单应用块型（`/标题 1`）路径。

### 1.3 顺带（同一单内的既有缺陷，T35-01 已立单，可一并修）
`/` 菜单 Enter 双处理（分块 + 应用同时发生 → 残留文本）。修完在报告说明；若判定风险高可只登记不改（须说明理由）。

## 2. 验收（必须全过，数值化）

1. 真机复用 PM 探针：`docs/mockups/probe-align-typing.mjs` →
   - ①`|deltaCenterY| ≤ 1`（段落 / H1 / 列表 / 引用 各测一遍）
   - ②切换块型前后：`dScroll = 0`，且首行行框中心位移 ≤1px（报告贴四个块型的数值）
2. **长页场景**：≥30 块、滚动到中段再切换块型（新增断言，证明不是只在顶部成立）。
3. 回归：`gutter ≥ 8`（T33）、手柄 hover 显形、块菜单 12 项、斜杠菜单 11 种块型（`probe-blocks-visibility.mjs` / `probe-text-overlap.mjs` 全绿）。
4. 双主题 × hover/active/focus 截图（含 H1 与列表各一张）。
5. `no-magic`、`build-tokens --check`、`pnpm -C packages/editor test`、`pnpm -C apps/desktop test`、`pnpm -r typecheck` 全绿。

## 3. 红线

- 允许动：`packages/editor/src/react/**`（`BlockControls.tsx` / `editor.css`）、`packages/editor/src/types/**`（仅样式/行高，**不改块模型语义**）、`apps/desktop/src/renderer/src/pages/PageView.{tsx,css}`（仅手柄定位/锚定相关，**注意与 T34-01 的 PageView.css 改动不要冲突**）、`apps/desktop/test/**`、`packages/editor/test/**`。
- 不碰：`packages/{core,sync,dbview,importer}`、`packages/ui` 的 token 真源（T34-01 正在改，勿同时改 DESIGN.md）、`main/**`、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。

## 4. 交付物

代码 + 测试（首行对齐 ≤1px 的几何断言；换块型 scrollTop 不变 + 首行中心位移 ≤1px 断言，≥2 个块型） + 真机前后数值与截图 + `docs/tasks/TASK-T36-01-report.md`（PM 复跑节留「（PM 补）」）。