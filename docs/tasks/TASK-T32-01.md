# TASK-T32-01 · 🔴 P1：块编辑器「看得见」——块手柄未渲染 + 斜杠菜单在视口外

> PM：Hermes ｜ 优先级 **P1（老板实测反馈：「我没发现编辑区有块编辑器」）** ｜ 前置：`a8523ae`（台账对齐）
> 版本：`0.3.0-rc.6` 真机取证

## 0. 症状（老板原话）与 PM 取证（决定性证据）

老板：「**我没发现编辑区有块编辑器**」。PM 在 rc.6 真机实测（`docs/mockups/probe-blocks-visibility.mjs`，独立夹具根）：

| 对象 | 实测 |
|---|---|
| `/` 斜杠菜单 | **存在且选项齐全**：文本/标题 1-3/无序/有序/待办/引用/代码块/分割线/图片（11 种块型）；`role="listbox"`、11 个 `role="option"` ✓ |
| 斜杠菜单位置 | ❌ **`inViewport: false`**（宽 320 / 高 380 / `display:block`，但**落在视口之外**）→ 用户看不到 |
| 块手柄 `BlockControls` | ❌ **hover 块时 DOM 中不存在**：`.sc-blockcontrol__handle` = null、`[class*="sc-blockcontrol"]` = null、按钮列表为空 |
| 代码现状 | `PageView.tsx:722` 有 `<BlockControls blockId={activeBlockId} onAction={handleBlockAction} visible />`；`packages/editor/src/react/BlockControls.tsx`(189 行) 与 `editor.css`(24 条相关规则) 均已实现 |

**结论**：块模型与块类型都齐，问题在**可见性/挂载**——①块手柄未渲染（或渲染条件永远不满足）②斜杠菜单定位算错落在视口外。老板的体感因此为「没有块编辑器」。

## 1. 任务

### 1.1 块手柄（`BlockControls`）必须可见可用
- 鼠标**悬停任意块**（含空段落）时，该块左侧出现手柄（`＋` 与 `⋮⋮` 或既有的两枚控件），**位于视口内**、不遮挡正文、不随滚动错位。
- 点击 `＋` → 新增块；`⋮⋮`/块操作 → 打开块菜单（现有 `.sc-blockcontrol__menu`，需同样保证在视口内）；**拖拽排序**沿用既有 `react/dnd.ts`。
- 先查明「为何没渲染」：`activeBlockId` 的赋值时机（是否只在选中/聚焦时才有值）与 hover 的关系；**修好后 hover 即出现**（Notion 手感），不要要求用户先选中。
- 键盘可达（至少 `Tab`/方向键能到、Esc 可关菜单）。

### 1.2 斜杠菜单必须出现在光标处且在视口内
- 输入 `/` 弹出的菜单**紧贴当前块光标位置**，且**必须落在视口内**（靠近底边时向上翻转/夹紧）。
- 键盘：↑↓ 选择、Enter 应用、Esc 关闭；应用后**块型真的切换**（如 `/标题 1` → 该块变 H1）。
- 中文输入法场景：`/` 在 IME 组合态后仍能唤起（若已有处理则验证）。

### 1.3 不做（避免范围膨胀）
- 不新增块型、不改块模型/数据层、不做富文本模板、不做块级评论。

## 2. 验收（可量化，真机）

1. hover 段落 → `.sc-blockcontrol__handle` 存在且 `getBoundingClientRect()` **在视口内**（`top>=0 && bottom<=innerHeight && width>0`）。
2. 点击手柄菜单 → 菜单存在且**在视口内**，含可读项（≥3 项，含「删除/复制/转换」类）。
3. 输入 `/` → `[data-testid="septcats-slashmenu"]` **在视口内**；↑↓+Enter 能把段落变成所选块型（断言 DOM 标签变化）。
4. 拖拽排序（用手柄）能把第 2 块拖到第 1 块之前（断言块顺序变化 + **落库**）。
5. **双主题 × hover/active/focus 四态**截图；`no-magic` 与 `build-tokens --check` 通过。
6. PM 会另跑：升级库夹具回归 + 既有全仓门禁。

## 3. 红线

- 允许动：`packages/editor/**`（含 `react/*`、`rules/*`、`editor.css`）、`apps/desktop/src/renderer/src/**` 中与编辑器装配相关处（`PageView.tsx` 的块手柄/斜杠接线）、`apps/desktop/test/**`、`packages/editor/test/**`。
- **不碰**：`packages/{core,sync,dbview,importer,ui}` 契约、`main/**` 业务逻辑、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。
- UI 红线：CSS 只走 `var(--sc-*)`、无字面 hex、无非 1px 重复裸 px、图标只从 `@septcats/ui` 出口、双主题四态齐备。

## 4. 交付物

代码 + 测试（手柄渲染条件 / 菜单视口内夹紧 / 斜杠应用后块型切换 等可断言项）+ **真机修复前后证据**（截图 + `getBoundingClientRect` 数值）+ `docs/tasks/TASK-T32-01-report.md`（PM 复跑节留「（PM 补）」；含 §0 复现原文与 §2 数值对照；DEVIATION 逐条）。

## 5. 自跑（全仓/selftest/重打包/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -C packages/editor test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。
**PM 收口**：全仓 + 重打包（**先 `node apps/desktop/scripts/ensure-abi.mjs electron`**）+ 上述 §2 数值化真机验收 + 双主题截图。