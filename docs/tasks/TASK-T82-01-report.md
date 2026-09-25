# TASK-T82-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T82-01.md` · 发现：`docs/Bug-hunt-R29.md` H-04（P0）
> 落盘方式：只 Write/Edit，未碰 git。

## §0 开工侦察结论（四问）

### ① 现判据的误判面有哪些

现判据（`runtime.ts:807` 传 `ledger.length + applied.length + crdtOps.length` 作 `expectedTotal`，`runtime.ts:1117` 取 `opLedger.count` 全表 COUNT 作实测值，不等即以段重建）。偏差来源逐条：

| # | 误判面 | 机制 | 方向 |
| -- | -- | -- | -- |
| 1 | **快照竞态（窗口）** | `ledger` 在 `runtime.ts:749` 读取，**早于**本轮 `commitOps`（783/787）与 `reconcileUnpublished`（802）；窗口内任何 `op_ledger` 写入都不在 expectedTotal 里——渲染器 `commitOps`（用户同期编辑）、后台导入器写页、CRDT 落账、迁移回填 | 双向（老板日志 `7387 ≠ 7386` 的 off-by-one 正是此型） |
| 2 | **过滤漏斗** | `applied` 是 `filterAgainstLedger`（779）**之前**的条数，实际落库的是过滤后的；被 (table,id) 水位判掉的 op 不增行 | 期望系统性偏高 N |
| 3 | **幂等去重** | `opLedger.insert` 是 `INSERT OR IGNORE`（`statements.ts:648`），`op_id` 已存在不增行；crdtOps 经 `ledgerStatement` 同样幂等 | 期望再偏高 |
| 4 | **非法 op 行** | `loadLedgerOps`（833-847）解码失败的行**跳过并留痕**，但 `opLedger.count` 数全表 | 双向差 N（老板日志里正是先两行「op_ledger 存在非法 op」再出现计数偏移） |
| 5 | **计数相等 ≠ 内容一致（漏报面）** | 数字巧合相等时账本仍可能缺段里的 op（或反之）；计数判据对**内容层**一致/不一致都没有判别力 | 漏报 |
| 6 | **无覆盖度概念（致命放大器）** | 即使判据为真，修复动作是「以段替换账本」，而段集只是**同步目录里的存量**；首轮开启同步时段集必然远小于账本 → 一次误报立即放大为不可逆抹除（7384 → 2） | 毁灭性 |

结论：①②③④ 使「计数不等」在真机上**近乎必然偶发**，⑤说明它连真不一致都测不准，⑥把偶发误报变成永久数据丢失。故判据必须换成集合语义，且重建动作必须带覆盖度闸门。

### ② `replace` 语义的所有调用点清单

| 调用点 | 现状 | 本单处置 | 理由 |
| -- | -- | -- | -- |
| `main/sync/runtime.ts:1127`（自愈） | 隐式 replace | **改 `merge`**，且永远先过覆盖度守卫 | 唯一生产自愈点；段集可能不完整，绝不可 replace |
| `db/selftest.ts:400` | 隐式 replace | 显式 `replace` | 空库造 2 段，两态等价；显式表达「以段为准」 |
| `test/server.test.ts:341 / 376` | 隐式 | 显式 `replace` | 用例断言的就是「清表 → 重放」 |
| `test/fts-defer.test.ts:252 / 302` | 隐式 | 显式 `replace` | 账本为空（用例注释：seed 只走物化未写 ledger），两态等价；保持「全量重放」口径 |
| `test/perf.test.ts:435` | 隐式 | 显式 `replace` | 1 万页全量重建基线，断言 `ops/entities == 夹具 op 数` |
| `packages/sync/src/portableZip.ts:11` | 仅注释提及（T80-02 导入侧） | **不改**（红线） | 未来导入侧应显式 `replace`（包内段=全量） |
| `main/portable.ts` | 无调用（T80-01 只做导出） | 不改 | — |
| `db/client.ts:156` + `DbHandle:64` | 签名 | 加 `mode?: RebuildMode`，**默认 merge** | 安全侧缺省 |

### ③ `merge` 语义下 FTS 与派生索引怎么重建

`server.ts:586` 事务体内，两种模式**共用同一条尾部重建路径**，逐字节相同（不造第二套逻辑）：

1. `UPDATE fts_defer SET flag = 1`（v6 触发器 `WHEN` 守卫跳过逐行整页重算，T15-01 的 O(n²) 根因）；
2. `REBUILD_CLEAR_SQL`（`page_block_fts` / `record` / `block` / `collection` / `page` / `op_ledger`）——**清单不动**；
3. `op_ledger` 灌 op：**这一条是两模式唯一差异**——`replace` = 段 ops；`merge` = **本机 ledger ops ∪ 段 ops**（按 `op_id` 去重，本机版本优先，保留其原 `seg_id`）；
4. 实体按 `TABLE_INSERT_ORDER` 物化（page → collection → record → block；`template` 有 upsert、不在清表清单）；
5. `FTS_RESYNC_SQL` 全量重算**一次**（事务内唯一一次）；
6. `UPDATE fts_defer SET flag = 0`。

派生索引 caveat（两模式同样存在，属**既有缺口**，见 §5）：`page_link_index`（v9/T44-01）与 `mention`（v2）都不在清表清单里，重建不触碰它们——`page_link_index` 由 `main/links.ts rebuildLinksIndex` 启动全量重建兜底，`mention` 按 schema.v2 注释本就无回填。本单不改清单（红线）。

### ④ 覆盖度校验成本

实测（临时基准脚本，跑完即删；口径 = `decodeOp` + 本机 Set 构建 + 段 Set 构建 + 双向差集，**不含** DB 读与段文件 I/O）：

| 规模 | 实测 |
| -- | -- |
| 963 op（老板当前库量级） | **6.27 ms** |
| 1 万 op（perf 基线量级） | **30.91 ms** |

加上真机的 `opLedger.listAll` 读 963 行与段文件解码 I/O，量级仍在毫秒级——远小于 60s 同步周期与首轮 merge 本身，**每次启动都跑也完全可接受**。

## §1 修复实现

### 1.1 `main/sync/runtime.ts`（核心：覆盖度守卫 + 去竞态判据）

- 错误码新增 `SYNC_RUNTIME_ERRORS.LEDGER_UNCOVERED_OPS = 'E_LEDGER_UNCOVERED_OPS'`。
- `SyncDbAdapter.rebuildFromSegments?(segmentsJson, mode?: RebuildMode)`（默认 `merge`）。
- `loadLedgerOps()` 拆出 `loadLedgerRows()`：**连 seg_id 一起读**（守卫需要区分「快照承载」的 op）。
- 调用点（原 `runtime.ts:807`）不再传 `ledger.length + applied.length + crdtOps.length`——**过期快照计数彻底退场**。
- `verifyLedgerIntegrity()` 重写为三分支：
  1. **实时读数**：`loadLedgerRows()` + `collectSegments()` 都在**检查时刻**现取（无竞态窗口）；
  2. **`uncovered > 0`（本机 op_id ∉ 段 op_id 集）→ 拒绝重建**：`recordError(E_LEDGER_UNCOVERED_OPS, '段集未覆盖本机 N 条 op（段 op=X，本机账本=Y）：拒绝重建以免数据丢失…')` 后 **直接 return，数据面一行不动**；
  3. **`missing > 0`（段里有、本机没有、且按写入路径同款 lamport 过滤本应入账的 op）→ `merge` 重建**：`rebuildFromSegments(JSON.stringify(segs), 'merge')`，log `E_PROJECTION_REBUILT …以并集（merge）重建投影`；
  4. 两者皆 0 → 一致，不动。

判据口径说明：`missing` 用**与写入路径同一把 `filterAgainstLedger`**（并同口径排除 `crdt_update`）过滤，否则历史段里「被 (table,id) 水位判掉」的 op 会被当成缺失 → 每次启动都触发一次全量重建（见 §4 D-2）。

### 1.2 `db/rpc.ts` · `db/server.ts` · `db/client.ts`（`mode` 参数）

- `rpc.ts`：新增 `export type RebuildMode = 'replace' | 'merge'`；`DbRequest` 的 `rebuildFromSegments` 增 `mode?: RebuildMode`（缺省 merge）；`RebuildData` 增 `mode`（回显）与 `keptOps`（merge 下被并集保留的 op 数）。
- `server.ts:580` case：`const mode = request.mode === 'replace' ? 'replace' : 'merge'`；merge 时先用 `readLedgerRows()` 取本机账本，把「段未覆盖」的 op 连同其原 `seg_id` 并入重放集；**`REBUILD_CLEAR_SQL` 清单未动一字**；FTS defer 包裹、`FTS_RESYNC_SQL` 全量重算、`TABLE_INSERT_ORDER` 物化顺序与 replace 完全一致。
- `client.ts`：`DbHandle.rebuildFromSegments(segmentsJson, mode?)` + 实现 `mode: RebuildMode = 'merge'`。
- 既有 replace 语义调用点全部显式补 `mode: 'replace'`（`db/selftest.ts`、`test/server.test.ts`、`test/fts-defer.test.ts`、`test/perf.test.ts`），见 §0-②。

## §2 测试

| 用例 | 文件 | 内容 | 结果 |
| -- | -- | -- | -- |
| **红测 N** | `test/sync-runtime.test.ts` | 复现 442→1：段只含 1 op + 本机账本 11 op（含 1 条「快照之后才落账」的同期写入）→ 断言 `rebuildCount === 0`、账本 **12** 条（修前 1 条）、`E_LEDGER_UNCOVERED_OPS` 且消息含「11」「未覆盖」、11 个本机页标题仍在投影里 | ✅ 绿；**已在旧语义下复跑验证为红**（详见下） |
| 绿测 O | `test/sync-runtime.test.ts` | 覆盖完整但入账缺失（`dropLedgerInserts`）→ 重建 1 次且 `lastRebuildMode === 'merge'`（断言自愈**绝不用 replace**）、无 `E_LEDGER_UNCOVERED_OPS` | ✅ 绿 |
| merge 并集测 + replace 绿测 | `test/server.test.ts` | 同一份「只含 pg-1 页 + 1 块」的段打在已有 1 条本机独有 op 的库上：默认 `merge` → `ops=3 / keptOps=1 / mode='merge'`，`pg-local` 仍在且 FTS 命中；显式 `replace` → `ops=2 / keptOps=0 / mode='replace'`，`pg-local` 被抹除（= H-04 的抹除面，只在守卫通过时才允许） | ✅ 绿 |
| 测试桩语义修正 | `test/sync-runtime.test.ts` | 旧桩无条件 `ops.clear()`（把「以段替换账本」编码成唯一语义，掩盖了 H-04）→ 新桩**区分模式**（`merge`=并集 / `replace`=清表重放），并记录 `lastRebuildMode`；`opLedger.listAll` 补 `seg_id` 列；新增两个夹具开关 `dropLedgerInserts` / `midCycleOp` | ✅ 绿 |

**红测红的实证**（临时把 `verifyLedgerIntegrity` 与测试桩改回旧语义后复跑，随后已还原、无残留）：

```
 FAIL  test/sync-runtime.test.ts > … > N：账本多、段少 → 覆盖度守卫拒绝重建，账本零丢失 + 留痕 E_LEDGER_UNCOVERED_OPS
AssertionError: 修前此处为 1（段里那一条）——442→1 的复现点: expected 1 to be 12 // Object.is equality
- Expected
+ Received
- 12
+ 1
 ❯ test/sync-runtime.test.ts:811:59
```

即：旧判据下「11 条本机 op + 1 条段内 op」被 `ops.clear()` 抹到只剩 1 条——与老板真机 7384 → 2 / 442 页 → 1 页同构。

## §3 门禁原始输出

### 3.1 `pnpm --filter @septcats/sync test`

```
> @septcats/sync@0.0.0 test E:\Hermes Agent工作空间\Septcats\packages\sync
> vitest run


 RUN  v3.2.7 E:/Hermes Agent工作空间/Septcats/packages/sync

 ✓  sync  test/fs.test.ts (10 tests) 6ms
 ✓  sync  test/gc.test.ts (7 tests) 4ms
 ✓  sync  test/manifest.test.ts (11 tests) 6ms
 ✓  sync  test/naming.test.ts (8 tests) 10ms
 ✓  sync  test/dedupe.test.ts (9 tests) 10ms
 ✓  sync  test/snapshot.test.ts (19 tests) 15ms
 ✓  sync  test/writer.test.ts (14 tests) 19ms
 ✓  sync  test/fault.test.ts (8 tests) 20ms
 ✓  sync  test/segment-collision.test.ts (9 tests) 21ms
 ✓  sync  test/merger.test.ts (12 tests) 24ms
 ✓  sync  test/convergence.test.ts (2 tests) 70ms

 Test Files  11 passed (11)
      Tests  109 passed (109)
   Start at  13:50:05
   Duration  728ms (transform 468ms, setup 0ms, collect 3.08s, tests 204ms, environment 2ms, prepare 1.69s)
```

### 3.2 `pnpm --filter @septcats/desktop test`（尾部摘要 + 与本单相关的 perf 基线）

```
 ✓ test/perf.test.ts (4 tests) 27246ms
   ✓ perf：G4 §9.2 硬指标基线（TASK-T14-01） > 冷进程打开 1 万页真库 → 第一次搜索 ≤150ms（搜索红线的冷态账）  306ms
   ✓ perf：G4 §9.2 硬指标基线（TASK-T14-01） > 1 万字页 200 块 commitOps batch 落库 P95 ≤16ms（输入延迟的提交路径等价物）  556ms
   ✓ perf：G4 §9.2 硬指标基线（TASK-T14-01） > 1 万页账本 rebuildFromSegments 全量重建 <5000ms（投影重建基线）  1713ms

 Test Files  105 passed (105)
      Tests  1161 passed (1161)
   Start at  13:50:17
   Duration  28.05s (transform 3.88s, setup 0ms, collect 42.84s, tests 103.50s, environment 36.15s, prepare 13.76s)
```

```
stdout | test/perf.test.ts > … > 1 万页账本 rebuildFromSegments 全量重建 <5000ms（投影重建基线）
  [perf] rebuild 夹具：14 段 / 34244 op / 13.8 MB segmentsJson
  [perf] rebuildFromSegments 1 万页 = 1545.7 ms （segments=14 ops=34244 entities=34244，预算 5000 ms）
```

另（定向复跑，改动面）：`npx vitest run test/server.test.ts test/sync-runtime.test.ts` → **28 passed**（server 13 / sync-runtime 15）；`npx tsc -p tsconfig.node.json --noEmit` → **0 error**。

收尾已执行 `node apps/desktop/scripts/ensure-abi.mjs electron`（`.abi-target` = `electron`）。

## §4 DEVIATION 清单

| # | 偏离/新增 | 理由 | 需 PM |
| -- | -- | -- | -- |
| D-1 | 覆盖度守卫给「快照承载」的 op 开口子：`seg_id` 形如 `snapshot-\d+.json(.enc)?` 的 op 视为已覆盖 | 快照是段的折叠形态、本身即传播载体（T31-01 播种时已把快照名写进 seg_id）。否则「从快照播种过的新设备」每次启动都会误报未覆盖（`snapshotToOps` 生成的是新 ulid op_id，永远匹配不到段内 op_id） | 追认 |
| D-2 | 「缺失面」判据复用写入路径同款 `filterAgainstLedger`（并排除 `crdt_update`） | 不复用则历史段里被水位判掉的 op 恒被当缺失 → 每次启动触发一次全量重建（1 万页 1.5 s）。副作用见 D-3 | 追认 |
| D-3 | 自愈重建的触发条件事实上收窄到「入账缺失」等异常路径 | 一轮成功的同步之后，段内 op 要么已入账、要么被同一把过滤器判掉 → `missing` 恒为 0。即旧判据的频繁误触发不再存在，自愈变成真正的兜底而非常态动作 | 知悉/追认 |
| D-4 | `RebuildData` 增 `mode` / `keptOps` 两字段 | 回包回显便于调用方核对 + 测试可断言「这次若走 replace 会丢几条」；既有 `segments/ops/entities` 断言不变 | 追认 |
| D-5 | 既有 replace 语义调用点显式补 `mode: 'replace'`（selftest / server.test / fts-defer.test / perf.test） | 默认改 merge 后不改会静默变语义（这些用例断言的正是「清表后仅重放段」） | 追认 |
| D-6 | 拒绝重建时只 `recordError`（errors[] + 日志），**不改状态机**（仍 `ok`） | 任务书「置状态提示」走既有红条通道即可，新增状态态会牵动 UI/状态机面。若 PM 要独立态（如 `degraded`）请指定 | 确认 |
| D-7 | 测试桩新增夹具开关 `dropLedgerInserts` / `midCycleOp`，`listAll` 补 `seg_id` 列 | 否则无法在纯内存桩上复现「快照竞态」与「入账缺失」两类真机形态 | 追认 |

## §5 遗留与观察项

1. **派生索引不在清表清单**：`page_link_index`（v9/T44-01）与 `mention`（v2）都不在 `REBUILD_CLEAR_SQL` 里，两种模式的重建都不触碰它们。`page_link_index` 由 `main/links.ts rebuildLinksIndex` 启动全量重建兜底，`mention` 按 schema.v2 注释本就无回填。这是 replace 时代就有的缺口（本单受红线约束未改清单），建议后续单独立账：重建事务尾部补 links 全量重建。
2. **无独立状态态 / 无 i18n 文案**：`E_LEDGER_UNCOVERED_OPS` 目前只进 `errors[]`（红条）与日志，UI 未加对应文案键。若要在设置页同步区显性提示「本机遇上未覆盖 op，未自动重建」，需另开单。
3. **merge 自愈缺真机验证**：收窄后的触发路径（入账失败等异常）在真机上难以自然复现，建议 PM 在 0.6.0 冒烟时用「坏库/删段」夹具人工触发一次，确认重建后投影与 FTS 正确。
4. **守卫覆盖面只到「重建」这一条**：purge/GC/便携包导入整库替换（T80-02）等破坏面不在本守卫范围——T80-02 导入侧须自带覆盖度确认，并显式传 `mode: 'replace'`。
5. **H-04 数据救援**（`septcats.db.bak-v5` 442 页恢复）仍待老板授权，与本单独立，未动真实档案（全程只读/拷贝纪律）。
6. （观察）`verifyLedgerIntegrity` 只在 `firstCycleDone` 前跑一次：若 PM 希望「每轮都查」，成本实测 963 op ≈ 6.3 ms / 1 万 op ≈ 30.9 ms（§0-④），可承受，但需另开单改语义。

## §6 同类面排查表（preload 无参 invoke × main 对象守卫）

排查口径：① 列 preload 全部**不传第二参**的 `ipcRenderer.invoke`（19 处）；② 逐个回查 main 侧 handler 是否要求对象入参（对照 13 处「IPC 参数必须是对象」守卫与 zod/字段级等价守卫）。

| # | channel | preload 形态 | main 注册点 / 守卫要求 | 判定 |
| -- | -- | -- | -- | -- |
| 1 | `app:ping` | 无参 | `index.ts:866` `() =>` | 不需修（两侧同为无参） |
| 2 | `app:meta` | 无参 | `index.ts:872` `() =>` | 不需修 |
| 3 | `fav:list` | 无参 | `index.ts:798` `onIdle`（无参） | 不需修 |
| 4 | `recent:list` | 无参 | `index.ts:800` `onIdle` | 不需修 |
| 5 | `workspace:list` | 无参 | `index.ts:802` `onIdle` | 不需修 |
| 6 | `import:pick` | 无参 | `index.ts:1092` `async ()` | 不需修 |
| 7 | `settings:get` | 无参 | `index.ts:881` `() =>` | 不需修 |
| 8 | `diag:export` | 无参 | `index.ts:908` `() =>` | 不需修 |
| 9 | `diag:confirm` | 无参 | `index.ts:909` `async ()` | 不需修 |
| 10 | `update:check` | 无参 | `updater.ts:433` `async ()` | 不需修 |
| 11 | `update:download` | 无参 | `updater.ts:435` `async ()` | 不需修 |
| 12 | `update:rollbackHint` | 无参 | `updater.ts:470` `async ()` | 不需修 |
| 13 | `sync:status` | 无参 | `sync/ipc.ts:68` `async ()` | 不需修 |
| 14 | `sync:now` | 无参 | `sync/ipc.ts:80` `async ()` | 不需修 |
| 15 | `sync:exportRecovery` | 无参 | `sync/ipc.ts:86` `async ()` | 不需修 |
| 16 | `sync:rotateKey` | 无参 | `sync/ipc.ts:105` `async ()` | 不需修 |
| 17 | `ai:state` | 无参 | `ai/ipc.ts:144` `async ()` | 不需修 |
| 18 | `workbenchTemplates:list` | 无参 | `workbenchTemplates.ts:162` `async ()` | 不需修 |
| 19 | `links:rebuild` | 无参 | `links.ts:261` `async ()` | 不需修 |
| 20 | `portable:export:preview` | **`{}`** | `portable.ts:415-419` `on` 包装 → `typeof raw !== 'object'` 抛 `E_MALFORMED` | **已修（PM 先例）**：preload 补 `{}`，与守卫对齐；本单复核仍在位 |
| 21 | `portable:export:confirm` | 传 `input` 对象 | 同上 `on` 包装 | 不需修（一贯） |
| — | 其余 ~60 通道（blocks/pages/db/search/importer/templates/lock/pageExport/shell/collab/ai/dbview…） | preload 一律传对象 | main 侧为「IPC 参数必须是对象」守卫（`blocks/links/index/pageExport/portable/search/shell/templates/lockIpc/importer`）或 zod schema（`dbview.ts:1448`）或字段级守卫（`collab.readPageId` / `ai.readProviderId`） | 不需修（形态一致） |

**结论**：全仓**无遗留的「preload 无参 invoke ↔ main 要求对象」错配**；唯一命中（`portable:export:preview`）已被 PM 修掉，本单仅复核。反向面（main 声明无参、preload 多传一个参）也不存在——多传的参被 handler 忽略，无失败路径。