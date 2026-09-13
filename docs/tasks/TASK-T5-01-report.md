# TASK-T5-01 交付报告 · M4 编辑器（5a 模型/数据链路 + 5b React 视图）

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**待 PM 复跑**（`pnpm -r typecheck && pnpm -r test` 未在本地执行——任务书禁终端）
> 复述（写前）：真相=BlockDoc，PM doc 是投影；diff→Op→注入 commit；IME 组合期零 Op 零规则；复用 core 的 sortkey/op/clock/replay。

## 1. 交付物清单

### 5a · packages/editor（纯函数，零 React 依赖）
| 文件 | 内容 |
|---|---|
| `package.json` | deps：`@tiptap/core@3.31.3`、`@tiptap/pm@3.31.3`、`@septcats/core(workspace)`、`zod`；peer react/react-dom；devDeps 同 desktop。exports：`.`（5a）/`./react`（5b）/`./editor.css` |
| `src/model.ts` | `BlockDoc/Block` zod（content 收窄为 `PMDocJSON\|string\|null`）、`blocksToPMDoc`、`pmDocToBlocks`、`blockToPMNode`、`inlineDoc/inlineNodes/text`、`blockPayload`、`freshSortKey` |
| `src/diff.ts` | `diffBlocks(before, after, {actor, now}) → Op[]`；字段级 patch/upsert 阈值（>50% 字段）；最小 reorder（LIS 判定 + `sortBetween` 单条）+ 密集降级整层重平衡 |
| `src/history.ts` | `OpUndoStack`（apply/undo/redo，深度 100）：内部 core.Projection，逆 op 现场快照，撤销/重做**重新盖 lamport/op_id** |
| `src/seq.ts` | `EditSession`：debounce 聚合（默认 300ms）、coalesce、flush、commit reject→onError+冒泡、可选注入 clock 覆写 c |
| `src/types/*` | 9 块节点 + doc/text（**自写装配，不用 starter-kit**）；`editorExtensions()/editorSchema()`；history 走 `@tiptap/pm/history` |
| `src/marks.ts` | bold/italic/strike/code/link（href 白名单）+ mention/color 透传 mark |
| `src/rules/inputRules.ts` | 纯判定 `matchInputRule(text, composing)` + PM 插件（composition flag + handleTextInput） |
| `src/rules/slashMenu.ts` | 纯状态机 + `filterSlashCommands`（中文/全拼/首字母/英文，稳定排序） |
| `src/rules/markdownPaste.ts` | `parseMarkdown`（自写 ~190 行） |

### 5b · React 视图（`@septcats/editor/react`）
`Editor.tsx`（`new Editor(...)` 直装 + onChange 桥 + `blockIdAtPos/blockPosById`）、`BlockControls.tsx`（⋮⋮ 手柄 + 删除/复制/转为…11 项/颜色 5 项，键盘可达）、`SlashMenu.tsx`（浮层 + ↑↓/Enter/Esc）、`SelectionToolbar.tsx`（`selectionRect` 纯函数 + B/I/U(灰)/code/link）、`dnd.ts`（`planBlockDrop`/`applySortKeyAssignments`）、`icons.tsx`、`editor.css`（只用 `var(--sc-*)`）

### apps/desktop 接线
`src/renderer/src/pages/PageView.tsx`（Editor+BlockControls+SlashMenu+SelectionToolbar 组装，memorySession，拖拽经 dnd 纯函数）；`src/shared/ipc.ts`（blocks 通道常量，main 侧待 T6）；`preload/index.ts`（通道收口 shared + `septcats.blocks` 透传壳）；`types/window.d.ts`；`App.tsx` 内容区挂 PageView；`package.json` 加 `@septcats/editor`；`tsconfig.node.json` 加 `src/shared`；根 `vitest.config.ts` projects 加 `packages/editor`。

### 测试（7 文件 + 2 fixtures）
`model.test.ts`（每块型投影确定性 + roundtrip 恒等 + 边界）、`diff.test.ts`（3 黄金序列逐条相等 + 9 种动作 + 收敛性）、`rules.test.ts`（输入规则含 IME/全角 + 真 PM 执行 + 斜杠三通道 + markdown 25 例）、`history.test.ts`（×50 随机 + 逆 op 语义 + 深度上限）、`seq.test.ts`（batch/coalesce/错误不吞/clock）、`react.test.tsx`（Editor 冒烟/onChange 桥/卸载销毁、SlashMenu 键盘、BlockControls、selectionRect）、`fixtures/blocks.ts`（12 例含 9 块型）+ `fixtures/sequences.ts`（3 段编辑序列→Op 流）。

## 2. 关键裁决（实现期定案）

1. **lamport 取自物化版本**：`c = 旧 version + 1`、`base = 旧 version`（`diff.ts` 顶部注释）。理由：对同一输入完全确定，且同实体后写必胜（core.replay 的 LWW 判据）；需要时钟接管时 `EditSession` 的 `clock` 注入覆写 c。
2. **reorder 最小集合用 LIS**：求出「相对次序未变的极大子序列」，只给子序列外的块发 reorder；恰好 1 块 → `sortBetween` 单条；多块 → 逐个 `sortBetween`；放不下 → 整层重平衡（新块作固定锚点，其键随 upsert 走，避免同 target 双 op）。
3. **投影带 id**：每个块节点带 `attrs.id`（渲染 `data-id`），这是反投影认领旧块的唯一锚点；未知 type 投影为 `paragraph + attrs._unsupported/_raw`，反投影原样恢复。
4. **删除用 tombstone**：`pmDocToBlocks` 把「prev 在场但投影消失」的块原地转 `alive=0`（保留 sort_key/version），diff 据此发 delete，重复删除不再重复发事件。
5. **Op 顺序确定性**：upserts → patches → reorders → deletes（fixtures 逐条断言）。

## 3. SSIM-NOTE（与 01-editor.html 的视觉对齐）

- **可复现的部分**（jsdom 只能断言结构与 token 引用）：编辑器容器 = `.sc-editor` 居中、`--sc-space-editor-measure` 页宽；块序列用 mockup `.blocks` 的 11 块等价内容（段落/H2/两条待办/两条引用含 icon 的 callout/代码/无序/有序/分割线/图片占位）→ 冒烟测试断言 `≥9` 个 `.sc-block` 且标题文案一致。
- **手柄**：`.sc-blockcontrol` 对齐 mockup `.handle`——28px 命中区（`--sc-size-control-sm`）、hover 显形（opacity `--sc-motion-fast`）、⋮⋮ 位用自绘 `DotsHandleIcon`（不引 phosphor，因本包不得依赖 packages/ui）。
- **斜杠菜单**：`.sc-slashmenu` 对齐 `.menu`——`--sc-shadow-popover`、`--sc-radius-md`、标题行「转为块类型 · 输入 / 后继续过滤」文案与 mockup 一致；选中条用 `--sc-color-accent-soft`。
- **选区工具条**：`.sc-selectiontoolbar` 对齐 `.floating`——36px 高、popover 阴影、活跃态 accent-soft；B/I 用字面字形、code/link 用自绘 SVG。
- **拖拽落点**：`.pv-dropline` 对齐 mockup `.dragline`（2px accent 线 + 左端圆点）。
- **无法自证的**：字体渲染（Geist 未装则回落 PingFang/YaHei）、行高与块间距的真实观感、IME 候选窗位置——需 PM 真机截图复审。

## 4. DEVIATIONS（有意的偏离与理由）

1. **op_id 用 ULID（非确定）**：schema-v1 §1 规定 `op_id = ULID(26)`，与「纯函数同输入同输出」冲突。裁决：遵守 schema-v1 用 `ulid()`，测试改为「除 op_id 外逐字段相等 + op_id 全为合法 ULID 且唯一」（`diff.test.ts` 的 `stripOpId`）。
2. **实现 mention/color 两个 mark**：任务书括号里写「不做」，但 schema-v1 §3 明确在内联 mark 词汇表内；缺失会让含该 mark 的 content 载入 PM 时抛「Unknown mark type」（丢数据/崩渲染）。故实现为**无 UI 的透传 mark**（color 的 token 限 `[a-z0-9-]`，渲染 `var(--sc-color-*)`，防 CSS 注入）+ 1 条断言。
3. **U（下划线）置灰**：schema-v1 §3 无 underline，按契约不新增；mockup 的 U 按钮保留但 `disabled` + title 说明。
4. **numbered_list / quote.icon 归一化**：`start=1` 与无 icon 不写进投影 attrs（保证 roundtrip 恒等）；fixtures 采用该规范形状。
5. **last_edited**：patch 只带变化字段（按 §2 契约），upsert 带 `last_edited = ctx.now`；`pmDocToBlocks` 对新块置 0 由 upsert 覆盖。
6. **单 jsdom 工程**：`packages/editor/vitest.config.ts` 用单一 jsdom 工程全收（任务书允许二选一）；5a 的纯函数在 jsdom 下结果与 node 一致，拆两个 project 只会让同一导入图跑两遍。5a「零 React 依赖」由 `index.ts` / `react/index.ts` 的出口分离保证。
7. **`Op` 类型不从 editor 重导出**：PageView 从 `@septcats/core` 取 `Op`（避免 editor barrel 变成 core 的转发层，也避免 desktop 新增依赖）。
8. **PageView 的拖拽**：PM 侧先 `tr.delete + tr.insert` 让视觉立即生效（onUpdate→EditSession），再用 `planBlockDrop` 算 sort_key 并 `onDocChange`；两次调用被 debounce coalesce 成一批。`/` 斜杠菜单由宿主 keydown 开合（demo 壳不做「吞掉 `/` 字符」的精细处理）。
9. **markdownPaste 不覆盖**：表格、嵌套列表、图片、内联 HTML（超出 v1 子集）。
10. **lambda 依赖**：`history.test.ts` 相对 import `packages/core/test/helpers` 复用 `mulberry32/pick`（core 未导出该子路径）。若 vitest 的 fs root 限制导致解析失败，改为本地 10 行副本（不引依赖）。

## 5. 未决项（需 PM 裁决 / T6 处理）

1. **（复跑）`pnpm -r typecheck && pnpm -r test` 未在本地执行**——Tiptap v3 的 `Node.create`/`Mark.create`/`EditorOptions` 类型面按官方 docs + registry 元数据核对，若报类型错，优先怀疑三处：`renderHTML` 返回的 `DOMOutputSpec`、`addAttributes` 的 `renderHTML(attributes)` 形参、`Node.create` 的 `code: true`/`topNode: true` 键。
2. `@tiptap/core@3.31.3` 的 peerDependencies 是 `@tiptap/pm@3.31.3`（精确版），故两包**锁死 3.31.3**（任务书写 `^3.31`）；若 PM 想升版本，两包必须同步。
3. code 块高亮（lowlight/CodeMirror 6）未接：白名单里没有该包，M4.2 的「语法高亮」当前只有等宽 + 语言标记；需追加依赖白名单。
4. 图片落盘/附件解析（M4.6）：当前 `attachment://<sha>` 只是渲染占位。
5. mention 反链索引（M5）、冲突副本块（schema-v1 §5.4 的交互）、多选块批量操作、Tab 缩进层级（改 parent_id → 实为 page 操作）未做。
6. `apps/desktop` 的 `blocks` IPC 只有通道名与 preload 透传壳，main 侧未实现（T6 接 db 同事务）。
7. 1 万字不掉帧 / 中文输入法真机手感 = PM 手测（`pnpm dev` → 内容区即是编辑器）。

## 6. DoD 复跑指引（PM）

```
pnpm install
pnpm -r typecheck
pnpm -r test          # 含 packages/editor（jsdom）与 apps/desktop
pnpm -C apps/desktop build
# 手测：pnpm dev → PageView（/ 出斜杠菜单、hover 出 ⋮⋮ 手柄、拖手柄排序、选区出工具条、Cmd/Ctrl+Z 走 Op 逆 op）
```
