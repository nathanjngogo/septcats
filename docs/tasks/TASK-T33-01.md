# TASK-T33-01 · 🔴 P1：块手柄压在行首文字上（「输入文本有重叠」）

> PM：Hermes ｜ 优先级 **P1（老板真机实测：「输入文本有重叠」）** ｜ 前置：T32-01B（`100b37f`，rc.8）
> 复现证据：`docs/mockups/probe-text-overlap.mjs`（PM 已稳定复现）

## 0. 现象与 PM 测量（rc.8，独立夹具根）

老板反馈「输入文本有重叠」。PM 用 `document.createRange()` 精确量「手柄矩形 × 文本矩形」：

| 窗口宽 | 手柄 [left→right] | 文本 [left→right] | 重叠 | 装订线 gutter |
|---|---|---|---|---|
| 1280 | 375 → 403 | 385 → 433 | **18 × 21 px** ❌ | **−18** ❌ |
| 900 | 270 → 298 | 280 → 328 | 18 × 21 px ❌ | −18 ❌ |
| 760 | 270 → 298 | 280 → 328 | 18 × 21 px ❌ | −18 ❌ |
| 640 | 270 → 298 | 280 → 328 | 18 × 21 px ❌ | −18 ❌ |

- 文本内容本身**不重叠**（`dupIds: []`、重载后段落完好）——**视觉重叠来自手柄与行首字符**。
- `gutter = 文本左缘 − 手柄右缘`，当前为 **负值**：手柄落在正文列**内部**（正文列未为其预留左侧装订线）。

## 1. 任务

**为块手柄预留左侧装订线，任何窗口宽/缩放/缩进下都不得与文本相交。**

1. 手柄（`＋` + `⋮⋮` 整簇）必须完整落在**文本左缘之外**：`gutter >= 8`（建议 12–16，且与正文左侧留白协调）。
2. **不得靠改窄手柄来糊弄**（手柄命中区 ≥ 24×24 的可点击面积，符合既有 a11y 口径）。
3. 窗口宽 640–1600 全区间、以及**正文列居中/最大宽度约束**下都成立；缩进块（列表/引用）同样不得相交。
4. 手柄 hover 命中区（用于触发显示的透明热区）**不得覆盖文本**（否则会抢走文本点击/选择）。
5. 实现口径：正文列容器**预留左侧装订线**（如给编辑器内容容器加左内边距/把手柄簇整体移到文本左缘外侧），CSS **只走 token**（`var(--sc-*)`），满足 `no-magic`（无字面 hex、无非 1px 重复裸 px）。
6. 顺带核对：`＋` 与 `⋮⋮` 的先后顺序与间距在当前窗口宽下是否与设计稿一致（不一致以设计稿为准，若设计稿缺失则报告说明）。

## 2. 验收（必须全过）

1. 真机复用 PM 探针：`docs/mockups/probe-text-overlap.mjs` → 对 **1280/900/760/640** 四个宽度输出 `overlap:false` 且 `gutter >= 8`（报告贴输出原文）。
2. 列表/引用缩进块上重复同一测量（新增 1–2 条断言）。
3. 手柄仍**可见可用**（回归）：hover 出现、点开菜单、`/` 斜杠菜单仍正常（`docs/mockups/probe-blocks-visibility.mjs` 全绿）。
4. 双主题 × hover/active/focus 截图（含窄窗 640 一张）；`no-magic`、`build-tokens --check`、`pnpm -C packages/editor test`、`pnpm -C apps/desktop test`、`pnpm -r typecheck` 全绿。

## 3. 红线

- 允许动：`packages/editor/src/react/**`（`editor.css`/`BlockControls.tsx`）、`apps/desktop/src/renderer/src/pages/PageView.{tsx,css}`（编辑器容器留白）、`apps/desktop/test/**`、`packages/editor/test/**`。
- 不碰：`packages/{core,sync,dbview,importer,ui}` 契约、`main/**` 业务逻辑、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。

## 4. 交付物

代码 + 测试（手柄与文本矩形不相交的几何断言；至少覆盖两个窗口宽） + 真机前后测量原文 + `docs/tasks/TASK-T33-01-report.md`（PM 复跑节留「（PM 补）」）。