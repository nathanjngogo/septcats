# TASK-T18-05 · 报告：缺陷修复 —— 记录标题「双击改名」不生效（T18-04-1）

> 工程师：CodeBuddy ｜ PM：Hermes ｜ 日期：2026-09-17 ｜ 前置 HEAD `cef3e53`（T18-04，开工 `git log -1` 已确认）
> 红线遵守：`apps/desktop/**`、`packages/{sync,core,editor,importer,ui}`、`docs/mockups/**` **零 diff**（`git status --porcelain` 核验，见 §5）；不碰 git（全程未 add/commit）；不新增依赖；无占位符/TODO；既有测试断言零改动（只追加）；未跑全仓 `pnpm -r test` 与 selftest（PM 收口）。

## 1. 症状（消费任务书 §1，PM 真机 CDP 探针实证）

打包应用（`dist/win-unpacked`）数据库表格中双击标题单元格（`SPAN.sc-dbcell__title`）无法进入改名编辑态：

- 原生 `dblclick` 确实到达 span（文档级捕获可见），`mousedown` detail 序列 `[1,2]`；
- 但 React `onDoubleClick` 未产生任何状态变化：`MutationObserver` 全程未见 `input[aria-label="编辑标题"]`（`inputSeen=0`）；
- `focused` 提示（「双击改名」）能出现（`onMouseDown`/焦点路径正常）；`pageerror` 0。

## 2. 根因证据链（候选③：焦点 effect 争夺焦点 → 编辑态闪退）

三个候选的排除与锁定，全部可在 `packages/dbview/test/react.test.tsx` 新增用例中复现：

1. **排除「React 事件委托失效 / 全局拦截」**（候选①）：打包产物 `out/renderer/assets/index-BzqzlOUw.js:35016` 确有 `onDoubleClick` 挂在 title span 上（React-dom `ff("dblclick","onDoubleClick")` 委托注册齐全）；全应用无第二处 dblclick 处理器、无 portal/多 root/捕获层 stopPropagation（renderer 仅 `main.tsx` 一个 `createRoot` + `StrictMode`，production 下无双重 effect）。
2. **排除「目标节点被替换」**（候选②）：首次 mousedown 只改 `focusedCell`/`tabIndex`/追加 hint 子节点——span 自身经 reconcile 复用（同 type 同 key），doubleClick 的目标仍是同一 React 管理节点。
3. **锁定候选③（焦点争夺），证据链四步**：
   - **步 1**：双击 → `onDoubleClick` → `setDraft(title)` → 编辑态 `input` 挂载，`autoFocus` 生效（TableGrid.tsx:118），**input 获焦成功**。
   - **步 2**：input 的 **`focusin` 会冒泡**（React 17+ 的 `onFocus` 底层监听 `focusin`）→ 命中单元格 div 的 `onFocus`（TableGrid.tsx:531-533）→ `onFocusCell(rowIndex, prop)` → DbView `setFocusedCell({…})`（DbView.tsx:274-276，**每次都造新对象**）。
   - **步 3**：`focusedCell` 引用变化 → TableGrid「焦点落 DOM」effect（TableGrid.tsx:284-299）**重跑**；修复前守卫是 `document.activeElement !== node`——此刻 activeElement 是编辑 input（div 的后代）≠ div → 判真 → `node.focus()` **把焦点从编辑输入框抢回单元格**。
   - **步 4**：input `onBlur={commit}`（TableGrid.tsx:138）触发 → `commit()` 里 `draft` 尚未变更（`next === title`）→ 只 `setDraft(null)` 不回调 `onRename` → **编辑态同一提交内闪退**。整条链同步完成于 dblclick 后的同一 act/任务内，故探针 `MutationObserver` 采样窗口 `inputSeen=0`、标题保持「未命名」——与 PM 探针逐项吻合。
   - **测试实证（修复前红）**：新增用例经 `DbView` 渲染（持有 `focusedCell` 状态、接通 effect 与 `onFocus`，TableGrid 单挂无法复现）执行「mouseDown → doubleClick → 查 input」：`getByLabelText('编辑标题')` 抛错——input 从未存活到断言时刻，即本缺陷的 jsdom 复现。
   - **波及面**：`CellEditor` 的 `PlainEditor`（单击/Enter 进入的普通单元格编辑）与编辑态输入框同构（`autoFocus` + `onBlur=submit`，且同在带 `onFocus` 的单元格 div 内），真机上是**同族闪退**——本修复一并解决。
   - **既有测试为何没拦住**：react.test.tsx 的 CellEditor 用例单挂组件（无 TableGrid 的 div.onFocus/焦点 effect），TableGrid/DbView 用例从不触发改名/编辑焦点链——该路径此前零覆盖。

## 3. 修复（最小改动）

| 文件 | 改动 |
|---|---|
| `packages/dbview/src/react/TableGrid.tsx` | ① 焦点 effect 守卫 `document.activeElement !== node` → **`!node.contains(document.activeElement)`**：焦点已在本单元格内部（编辑态输入框持焦）时不抢焦；焦点在体外（body/其他单元格，方向键导航场景）时行为与原来完全一致。② 加注释说明守卫原因（T18-05）。③ `TitleCell` 头注释与实现对齐：仅**双击**进入改名（去掉「Enter 改名」说法），保留「Enter 提交、Esc 取消、失焦提交；空串 = 清空标题」的提交语义描述 |
| `packages/dbview/test/react.test.tsx`（追加） | 新 describe「标题双击改名（T18-05 回归）」2 用例：① `mouseDown` 单元格 → `doubleClick` 标题 span → `input[aria-label="编辑标题"]` 出现且值 = 原标题 → `change` 写「新书名」→ `keyDown Enter` → `onRenameRecord` 收 `('rec-1','新书名')` 且输入框消失 → rerender（模拟父层写回）后新标题显示；② 写值后 `keyDown Escape` → `onRenameRecord` **不被调用**、输入框消失、原标题保持。实现注记：用例必须经 `DbView` 渲染才能复现焦点链；jsdom 未实现 `scrollIntoView`，本 describe 内换原型桩并在 `afterAll` 还原（不触碰既有断言/setup.ts） |

Enter 提交 / Esc 取消 / 失焦提交 / 空串清空的既有语义零改动（`draft` 提交逻辑一字未动）。

## 4. 验证（每条命令最后一次输出）

| 命令 | 结果摘要 |
|---|---|
| `pnpm -C packages/dbview test`（修复前，新增用例入列后） | `Tests 2 failed \| 93 passed (95)`——两条新用例红（`Unable to find … 编辑标题`，即缺陷复现），既有 93 全绿 |
| `pnpm -C packages/dbview test`（修复后） | `Test Files 5 passed (5) / Tests 95 passed (95)`（既有 93 + 新增 2，全绿） |
| `pnpm -r typecheck` | 9 包全部 `typecheck: Done`，0 错 |
| `node packages/ui/tokens/no-magic.mjs` | `✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px` |

## 5. 差域核验与 PM 复跑

- `git status --porcelain` 仅：`M packages/dbview/src/react/TableGrid.tsx`、`M packages/dbview/test/react.test.tsx`、`?? docs/tasks/TASK-T18-05-report.md`——红线域零 diff。
### 5.1 PM 复跑与裁决（2026-09-17，PM 手跑）

**静态 / 测试门禁**
- `pnpm -C packages/dbview test`：**95/95**（既有 93 + 新增 2）。修复前实测 `2 failed | 93 passed` —— 缺陷在 jsdom 可复现、修复后全绿（红→绿实证）。
- 全仓 `pnpm -r test` 无红（本轮 perf 环境敏感用例亦绿）；`pnpm -r typecheck` 9/9 Done；`node packages/ui/tokens/no-magic.mjs` ✓；`pnpm -C apps/desktop selftest` SELFTEST OK。

**根因裁决（PM 采纳本文证据链）**
- CB 排除候选①②（React 委托链完好；首次 mousedown 后 span 被 reconcile 复用、未被替换），锁定③**焦点争夺**；四步闭环与 PM 探针逐项吻合（dblclick 到达但无可观察状态变化 / `inputSeen=0` / 标题不变 / pageerror 0）——尤其解释了「输入框挂载后同帧闪退」为何让 MutationObserver 全程未见。
- 修复：`TableGrid.tsx:293` 守卫 `document.activeElement !== node` → `!node.contains(document.activeElement)`。**顺带修好普通单元格编辑（PlainEditor）同病**（同一抢焦 effect 路径），方向键导航语义不变（焦点在体外时守卫仍判真）。
- 注释与实现对齐（去掉「Enter 改名」不实说法）✓。

**真机 CDP 复验（PM 跑；重打包 03:45 且 asar 已含修复）**
- **ALL-PASS 21/21（离线层 + 真机层）**。关键一条 `AI属性：UI 建 2 条记录并改名` 由 FAIL → **PASS**（`r1=ok r2=ok titles=哥德尔、艾舍尔、巴赫|时间简史`）。
- 同轮真机：LM Studio 生成 → 应用 → 单元格值 → 落库全链通过；pageerror 0。
- CDP 脚本**第 6 处**流程缺陷由 PM 亲修：首次改名提交触发集合重载，脚本未等表格恢复两行即改第二条（`r2=no-cell`）→ 加就绪等待；脚本内已标注缺陷号与「本检查现应 PASS，若再红 = 回归」。

**验收结论**：T18-04-1 修复成立，由**真机 CDP + 新增回归测试**双重锁定；无遗留红。

## DEVIATIONS

- 无红线突破。注记两条（非偏差，供 PM 参考）：① 回归用例渲染层级选 `DbView` 而非 `TableGrid` 单挂——根因链含 DbView 持有的 `focusedCell` 状态与单元格 `onFocus` 接线，单挂无法复现，属根因决定测试挂载点；② 新 describe 内对 `HTMLElement.prototype.scrollIntoView` 的桩只作用于本 describe（`afterAll` 还原），因 setup.ts 列为不可改、jsdom 又确缺该 API。
