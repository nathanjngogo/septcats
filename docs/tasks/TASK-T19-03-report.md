# TASK-T19-03 交付报告 · editor Yjs 绑定（协作 CRDT 落地 2/4）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 状态：完成（含 T19-03B 收尾补派全部内容）
> 前置：T19-02 已交付（crdt_update 契约既定，本任务未改 packages/core）。

## 1. 交付物

| 文件 | 内容 | 状态 |
|---|---|---|
| `packages/editor/src/yjs.ts` | `YjsEditor` 类：Y.Doc ↔ Tiptap(ProseMirror) 双向绑定、防抖上行、applyCrdtUpdate 下行、pageId 分区、attach 种子/投影、YUndoPlugin | ✓ |
| `packages/editor/test/yjs.test.ts` | 单元 6 + 集成 4 + 回归 3，共 13 用例 | ✓ 全绿 |
| `docs/tasks/TASK-T19-03-report.md` | 本报告 | ✓ |

依赖（上一轮已装，本轮未新增）：`yjs@13.6.32`、`y-prosemirror@1.3.7`（写入 `packages/editor/package.json` + lockfile）。

## 2. Yjs 版本与依赖理由

- **yjs@13.6.32**：Yjs 13.x 最新稳定版，CRDT 引擎本体（Y.Doc / XmlFragment / applyUpdate / mergeUpdates / encodeStateVector / UndoManager），唯一被维护的版本线。
- **y-prosemirror@1.3.7**：Yjs 官方 ProseMirror 绑定（ySyncPlugin 双向映射、yUndoPlugin、yXmlFragmentToProseMirrorRootNode、prosemirrorToYXmlFragment），peer 兼容本仓 prosemirror-view@1.42.3 / @tiptap/core@3.31.3。
- 不引入 y-websocket / y-indexeddb：传输与持久化分别是 packages/sync、core 事件账的职责，本包只产出/消费 payload。

## 3. 中断现场修复（T19-03B）

### 3.1 修复前（PM 复跑原文）

```
Test Files  1 failed | 8 passed (9)
     Tests  11 failed | 146 passed (157)
```
```
test/yjs.test.ts(339,30): error TS2339: Property 'undo' does not exist on type 'SingleCommands'.
test/yjs.test.ts(342,30): error TS2339: Property 'redo' does not exist on type 'SingleCommands'.
```

### 3.2 每条红的根因（一行）

| # | 用例 | 根因 | 修在 |
|---|---|---|---|
| 1 | 单元·防抖窗口合并为单 op（onOp 0 次） | Y.Doc `'update'` 事件是**四参** `(update, origin, doc, tr)`，回调只取三参、把第三参 Doc 当 Transaction 用，`tr.local` 恒 undefined → 本地增量全被当远端过滤，pending 恒空 | yjs.ts（签名改正，已注释防复发） |
| 2 | 单元·sync() 产出 payload | 同 #1（pending 恒空 → sync() 恒 null） | yjs.ts |
| 3 | 单元·core encodeOp/replay 链路 | 同 #1 | yjs.ts |
| 4 | 单元·远端不回灌（防回环） | 同 #1（seed 端 sync() null；防回环过滤本身正确，applyUpdate 传 origin → tr.local=false 语义保留） | yjs.ts |
| 5 | 单元·pageId 分区 | 同 #1（seed 端 sync() null） | yjs.ts |
| 6 | 单元·坏 base64 不抛 | 同 #1（localYEdit 后 sync() null） | yjs.ts |
| 7 | 集成·双向同步（对端为 ''） | ySyncPlugin 注册时首渲染以 Y 为真相、**Y 空即清空 PM 初始内容**，attach 缺 PM→Y 种子分支；且用例 A/B 双端各自种子违反文件头冷启动约定（互相 apply 会内容重复） | yjs.ts（补种子）+ 测试（B 改构造注入） |
| 8 | 集成·并发编辑收敛 | 同 #1（种子 sync() null）＋ 用例在 sleep(60) 后才 sync（防抖 10ms 已自动 flush，种子已被带走）；A 端用 content 自种子违反冷启动约定 | yjs.ts + 测试（A/B 均注入回放、种子显式收集） |
| 9 | 集成·注入冷启动 attach 即投影 | 同 #8（种子被自动 flush 走 + a 端 content 自种子 + a 的 onOp 为 no-op，A1 永远到不了 B） | 测试（种子即时 sync、a 端改注入、onOp 接通） |
| 10 | 集成·优先本地不回滚 | 同 #8；且 a 自种子的 Y 项与 b 引用的种子项不同源，b 的 op 在 a 侧缺邻接项挂 pending structs 不渲染 | 测试（a 端改注入同一种子） |
| 11 | 回归·撤销/重做（Position 5 out of range） | 文档被 ySyncPlugin 首渲染清空（缺 PM→Y 种子）致位置越界；且 Tiptap 未注册 History 命令、`commands.undo/redo` 不存在（TS2339×2）→ 改走 Yjs UndoManager | yjs.ts（种子 + yUndoPlugin）+ 测试（undoCommand/redoCommand、插入位置改 doc 末尾） |

测试侧修改均为用例自身错误（违反其文件头写明的冷启动约定 / 位置算术 / jsdom 无布局下 focus 滚动崩），**未放宽、未删除断言**；双向用例还补了一条「注入后内容为 base」前置断言。

### 3.3 typecheck 修复（5 处）

| 位置 | 错误 | 处置 |
|---|---|---|
| test 339/342 | TS2339 undo/redo 不存在（PM 复跑原文所列） | 改用 y-prosemirror `undoCommand`/`redoCommand`（见 §4 决策） |
| src/index.ts 22 | TS2308 `./seq` 与 `./yjs` star 导出重名 `DEFAULT_DEBOUNCE_MS` | yjs 常量改名 `YJS_DEFAULT_DEBOUNCE_MS`（seq 300ms / yjs 100ms 语义本就不同） |
| yjs.ts flush | TS2345 `pending[0]` 可能 undefined（noUncheckedIndexedAccess） | 统一走 `Y.mergeUpdates([...pending])`（单元素同样成立） |
| yjs.ts destroy | TS2345 unregisterPlugin 形参是 PluginKey/string 而非 Plugin | 改按 `yUndoPluginKey` 注销（view.destroy 级联销毁 UndoManager） |
| test makeClient | TS6133 未用 `Lamport`；TS2379 exactOptionalPropertyTypes 下可选字段显式传 undefined | 删未用导入；options 改条件赋值 |

## 4. 决策说明：撤销走 YUndoPlugin 而非 ProseMirror history

协作编辑器里撤销的正确语义是「只撤我自己的、不撤别人的」。prosemirror-history 的撤销栈以事务为单位、不区分变更来源，会把远端协作者的变更卷进本地撤销，一按撤销可能撤掉他人的编辑。y-prosemirror 的 `yUndoPlugin` 内建 Yjs `UndoManager`，`trackedOrigins` 只含 ySyncPluginKey（即只追踪本地 PM→Y 事务），undo/redo 由 Yjs CRDT 结构承载并经 ySyncPlugin 投影回 PM，天然只作用于本地变更；其产出的 Y 增量走 tr.local=true 正常上行（有用例钉住）。`yjs.ts` 已在注册处注明「**撤销由 Yjs UndoManager 承载**」。上层调用 y-prosemirror 导出的 `undoCommand`/`redoCommand`。

## 5. 修复后自跑结果

```
pnpm -C packages/editor test
  Test Files  9 passed (9)
       Tests  157 passed (157)      ← yjs.test.ts 13/13 全绿

pnpm -r --no-bail typecheck
  packages/{core,editor,ui,schema,sync,dbview,importer} typecheck: Done
  apps/desktop typecheck: Done      ← 0 错

node packages/ui/tokens/no-magic.mjs
  ✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

## 6. 行为要点（供 PM 验收对照）

- **上行**：本地 Y 增量（编辑器事务 / attach 种子 / 本地 undo-redo）→ pending → 防抖（默认 100ms）合并为单 payload `{pageId, updateB64, svFromB64}`，与 T19-02 `CrdtUpdatePayload` 契约逐字段对齐（有用例走 encodeOp→replay 全链路）。
- **下行**：`applyCrdtUpdate` 按 pageId 分区拒绝跨页；坏 base64/非法增量只记录不抛；远端 apply（tr.local=false）绝不回灌生成 op（防回环）。
- **冷启动**：构造注入 `ReplayReport.crdtUpdates` → attach 时 Y→PM 投影；种子客户端（Y 空、PM 有内容）attach 时 PM→Y 种子并走正常上行通道。双端不得各自种子（内容重复），集成用例已按此约定改写。
- **资源**：destroy 幂等；注销 ySyncPlugin/yUndoPlugin、摘事务监听、清防抖计时器、销毁 Y.Doc。

## 7. DEVIATIONS

1. `DEFAULT_DEBOUNCE_MS` → `YJS_DEFAULT_DEBOUNCE_MS` 改名：为修 TS2308 star 导出重名（index.ts 同时导出 seq/yjs 两个同名常量）。行为不变，待 PM 追认。
2. attach 新增「PM→Y 种子」分支：原实现只处理 Y→PM 投影，Y 空时 ySyncPlugin 首渲染会清空 PM 初始内容；种子分支是集成用例成立的前提，语义为「种子客户端初始内容上行」，待 PM 追认。
3. 测试文件 4 处集成用例 setup 修正 + 撤销用例插入位置修正（§3.2），均系用例自身错误，断言未放宽未删除。
4. `undoPlugin` 实例不落字段，按 `yUndoPluginKey` 注销（Tiptap unregisterPlugin 只收 key/string）。

## 8. PM 复跑

```
（T19-03B 交付后 PM 独立复跑，2026-09-17）
pnpm -C packages/editor test    →  Test Files 9 passed (9) / Tests 157 passed (157)   ← 11 红全绿
pnpm -C packages/editor typecheck →  0 错（undo/redo TS2339 已消）
pnpm -r typecheck               →  9/9 Done
pnpm -r test                    →  全仓 707/707（schema 3 / sync 83 / editor 157 / dbview 95 / importer 59 / desktop 301；desktop 含 perf 4 全绿——此前 perf 红系并行负载，机器静置后通过）
node packages/ui/tokens/no-magic.mjs → ✓
pnpm -C apps/desktop selftest   → SELFTEST OK
红线核验：packages/core、packages/sync、apps/desktop/src、packages/ui、packages/schema 零改动 ✓
DEVIATIONS 1–4 全部追认：①YJS_DEFAULT_DEBOUNCE_MS 改名（消 star 导出歧义，语义更清晰）②attach PM→Y 种子分支（种子客户端正确语义，且是集成用例前提）③测试侧 4 处用例自身错误修正（断言未放宽未删除）④yUndoPluginKey 注销（Tiptap API 约束）
```
