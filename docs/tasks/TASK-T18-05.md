# TASK-T18-05 · 缺陷修复：记录标题「双击改名」在打包应用中不生效（T18-04-1）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T18-04 已交付（HEAD `cef3e53`，开工 `git log -1` 确认）
> 类型：**既有缺陷**（T7b 时代引入，非 T18-04 引入）——T18-04 真机 CDP 验收时由 PM 探针实证暴露。
> 纪律：不碰 git；禁占位符/TODO；不改既有测试断言语义（只许追加）；不新增依赖；不要跑全仓 `pnpm -r test` / selftest（PM 收口）。

## 1. 症状（PM 探针实证，2026-09-17）

打包应用（`dist/win-unpacked`）数据库表格里，**双击标题单元格无法进入改名编辑态**：标题保持「未命名」。

探针证据（真机 CDP，真实鼠标双击）：
- `mousedown` detail 序列 `[1,2]`（确为 OS 级双击）；
- 文档级捕获监听器可见原生 `dblclick` **确实到达** `SPAN.sc-dbcell__title`；
- 但 `MutationObserver` 全程未见 `input[aria-label="编辑标题"]`（`inputSeen=0`）→ React 的 `onDoubleClick` 未产生任何状态变化；
- 标题文本不变；`pageerror` 0。

相关事实：
- 全应用只有 **`packages/dbview/src/react/TableGrid.tsx:147`** 一处 `dblclick` 处理器（`TitleCell` 的 `onDoubleClick` → `setDraft(title)`），**无全局 dblclick 拦截**；
- `focused` 提示（「双击改名」）能正常出现（说明单元格 `onMouseDown`/焦点态仍工作）；
- 该路径**无任何单测/CDP 覆盖**（`packages/dbview/test/react.test.tsx` 只传 `onRenameRecord: NOOP`，从未断言改名）；
- 代码注释称「聚焦后可直接双击/Enter 改标题」，但实现里**没有** Enter 改名分支（注释与实现不一致）。

## 2. 任务目标

1. **修复**：标题单元格双击能稳定进入编辑态（输入框出现并聚焦），`Enter` 提交、`Esc` 取消、失焦提交的既有语义不变（`TableGrid.tsx:106-140` 的 `draft` 提交逻辑保持）。
2. **加回归测试**（必须）：`packages/dbview/test/react.test.tsx` 追加用例，覆盖真实交互序列：
   - `mouseDown` 单元格（先聚焦）→ `doubleClick` 标题 span → **`input[aria-label="编辑标题"]` 出现** → `fireEvent.change` 写值 → `keyDown Enter` → `onRenameRecord` 收到 `(rowId, 新标题)`，且输入框消失、新标题显示；
   - 再加一条：`Esc` → `onRenameRecord` **不被调用**（既有语义）。
3. **一致性**：注释与实现对齐——裁决为**仅双击改名**（Enter 改名不在本轮范围）；请把 `TableGrid.tsx:92-93` 的注释改为与实现一致（去掉 Enter 说法）。

## 3. 调查提示（不限定方案，任选其一根因）

现有实现是「span 上挂 React `onDoubleClick`」。可能根因（请自行用最小代价验证后择一修，并在报告里写清证据链）：
- React 事件委托未在该节点生效（例如该 span 位于某个 portal/独立 root 之外，或祖先存在原生 `stopPropagation` 的转发层）；
- 首次 mousedown 引起的重渲染替换了目标节点，使第二次点击落在新节点上、双击序列被判为两段单点；
- `TitleCell` 的 `autoFocus` 输入框与 `TableGrid.tsx:284-299` 的「焦点落到单元格」effect 争夺焦点（输入框出现即被 `node.focus()` 抢走 → `onBlur` → `commit()` → `draft=null`）。
建议方案（不强制）：把双击判定下沉到**单元格容器**（`TableGrid` 行单元格 wrapper）或使用 `onMouseDown` 的 `event.detail === 2` 判定，避免依赖 span 上的委托；若涉及焦点争夺，则让编辑态下的输入框免于被焦点 effect 抢焦（effect 内跳过 `editingCell`/`draft` 态）。

## 4. 交付物与红线

| 交付 | 说明 |
|---|---|
| `packages/dbview/src/react/TableGrid.tsx` | 双击改名修复（最小改动）+ 注释与实现一致 |
| `packages/dbview/test/react.test.tsx` | 追加回归用例（§2.2，两条；既有断言不动） |
| `docs/tasks/TASK-T18-05-report.md` | 症状→根因（证据链）→修复→自跑输出 + DEVIATIONS（PM 复跑节留「（PM 补）」） |

红线（零改动）：`apps/desktop/**`（含 main/preload/shared/types/renderer）、`packages/{sync,core,editor,importer,ui}`、`docs/mockups/**`；只动上表两文件 + 新建报告。

## 5. 验证与收尾

```bash
pnpm -C packages/dbview test          # 既有 93 用例 + 新增，全绿
pnpm -r typecheck                     # 9 包 0 错
node packages/ui/tokens/no-magic.mjs  # ✓
```
PM 侧收口（不必你做）：全仓 `pnpm -r test`、`selftest`、**重打包 + 真机 CDP 复验**（`SEPTCATS_AI_REAL=1 node docs/mockups/cdp-e2e-ai.mjs` 中「AI属性：UI 建 2 条记录并改名」一项须由 FAIL 转 PASS —— 脚本已保留该检查并标注缺陷编号）。
尾回复：改动文件清单 + 每条命令最后一次输出摘要 + 根因证据链。