# TASK-T13-01 交付报告 · M8b 同步运行时（apps/desktop main 侧 + 同步状态 UI）

> 工程师：CodeBuddy ｜ 2026-09-15 ｜ 任务书：docs/tasks/TASK-T13-01.md
> 红线遵守：零 git 操作；**packages/sync 零改动**（git status 实证：packages/ 下无任何 sync 文件出现在变更清单）；
> 本报告由收尾会话完成——上一会话已交付全部实现代码，本会话修复遗留的 10 个 typecheck 错误并收尾 DoD。

## 1. 交付物清单（上一会话遗产 + 本会话修复）

| 文件 | 内容 | 状态 |
|---|---|---|
| `apps/desktop/src/main/sync/runtime.ts` | SyncRuntime：起停（FsWatchProvider watch + 60s 定时双触发）、onLocalCommit 攒段（硬条件立发 / 15s 空闲 flush）、首轮 ledger 计数校验（不一致 → rebuildFromSegments 自愈，log E_PROJECTION_REBUILT）、快照折叠、gc（dry-run 默认）、manifest 心跳、五态状态机 + errors[]（稳定 code） | ✅ 本会话删 2 个死字段 |
| `apps/desktop/src/main/sync/bridge.ts` | `withSyncHook` 装饰 StatementExecutor：batch 成功后抽 `opLedger.insert` 的 op 交 runtime（**不改动 commit.ts**） | ✅ |
| `apps/desktop/src/main/sync/ipc.ts` | sync:status / sync:setEnabled / sync:now 三通道 + runtime 缺失回 E_INVARIANT | ✅ |
| `apps/desktop/src/main/sync/provider.ts` | FsWatchProvider：SyncProvider 的本地 fs 实现（listSegments/get/put 走注入 SyncFs、watch 去抖 2s、probe=目录存在性+mtime） | ✅ |
| `apps/desktop/src/main/sync/keyring.ts` | DEK 生命周期（ensureDek/loadDek/rotateDek），DPAPI（platform CredentialStore）包裹落 `credentials/` | ✅ |
| `apps/desktop/src/main/sync/crypto.ts` | AES-256-GCM（`IV(12B)\|tag(16B)\|ciphertext` base64 落盘），AAD=逻辑文件名；EncryptingSyncFs 装饰器（`.enc` 透明写读、manifest 透传、ifAbsent 作用于实名） | ✅ |
| `apps/desktop/src/shared/sync.ts` | 线上契约：SyncRuntimeState 五态 / SyncStatusSnapshot / SyncDeviceEntry / SyncErrorEntry | ✅ |
| `apps/desktop/src/renderer/src/sync/SyncStatus.tsx` + `.css` | 顶栏同步状态钮（五态）+ 点击面板（设备列表/待发段/最近错误/立即同步/开关），onState 推流 | ✅ 本会话修 no-magic 违规 |
| `apps/desktop/src/main/index.ts` | 接线：registerSyncIpc（persistEnabled 持久化 sync.enabled）+ bootstrapDatabase 起 runtime + sync:state 广播 | ✅ 本会话修 persistEnabled |
| `apps/desktop/src/main/settings.ts` | AppSettings 增 `sync` 段透传（enabled/encrypt/gc） | ✅ |
| `apps/desktop/src/shared/settings.ts` + `src/shared/ipc.ts` + `src/preload/index.ts` + `src/types/window.d.ts` | `sync` 设置段契约 + sync:* 四通道常量 + `window.septcats.sync` 桥 | ✅ |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | sync 面板全部新文案 | ✅ |
| `packages/platform/src/settings.ts` | SeptcatsSettings schema 增 `sync` 段（zod，默认 true/false/false） | ✅ |
| `apps/desktop/test/sync-runtime.test.ts` | 双 runtime 集成 A–J 十场景（见 §2） | ✅ 10/10 |
| `apps/desktop/test/sync-crypto.test.ts` | 基元 6 + EncryptingSyncFs 6 | ✅ 12/12（本会话修 1 处断言） |
| `apps/desktop/test/sync-keyring.test.ts` | 内存后端 4 + 真 DPAPI 后端 1 | ✅ 5/5 |
| `apps/desktop/test/sync-ui.test.tsx` | 顶栏五态 5 + 面板 2 | ✅ 7/7 |

## 2. 时序对照清单（任务书 §2 逐条 → 实现位 → 测试）

| 任务书 §2 时序 | 实现位（runtime.ts 除注明外） | 测试 |
|---|---|---|
| 启动：读 manifest → 全量 mergeRemote → 新 op 落 op_ledger（复用 core 幂等）→ rebuildFromSegments 校验一致 | `start()` → `runCycle()` → `cycleBody()`：`loadManifest`（坏/缺失降级本地默认不崩）→ 空账本 `seedFromSnapshot`（S5）→ `mergeRemote` → `filterAgainstLedger`（Lamport 幂等过滤，修 S5 播种后等 lamport 决胜漂移）→ `commitOps` → 首轮 `verifyLedgerIntegrity`（不一致 → `rebuildFromSegments`，log `E_PROJECTION_REBUILT` 不崩） | sync-runtime A（投影逐字段相等）/ F（S5 快照播种 + patch 折叠无漂移）；server.test rebuild 组（selftest 内） |
| 写入：commitOps→onCommitted→builder→publishSegment（ifAbsent 幂等；S3 副本由 mergeRemote 消化，运行时只测发布文件名符合 naming） | bridge.ts `withSyncHook`（batch 成功才回调、非 ledger 语句不触发、失败不触发）→ `onLocalCommit`（硬条件立发，否则 15s 空闲 flush）→ `flushAndPublish`（publishSegment ifAbsent；失败暂存 `pendingPublish` 下轮重试不丢） | sync-runtime A（`parseSegmentFileName` 全过）/ G（桥装饰器三语义）/ D（断链期发布失败 pendingSegs=1、恢复后 0） |
| 收：watch 触发→去抖 2s→mergeRemote→新 op 落 op_ledger（已在账本的 op 跳过）→投影增量 apply | provider.ts `FsWatchProvider.watch`（fs.watch 去抖 2s）+ 60s 定时 → `runCycle`（并发触发合并为一轮：cycleRunning/cycleQueued）→ `commitOps` 增量物化 | sync-runtime C（seg (1).jsonl 副本注入 → `skipped[duplicate]` 不重复入账）；E 崩溃恢复半截段隔离自愈不再重试 |
| 崩溃恢复：写段中途 kill → mergeRemote 隔离半截段 → 重启自愈且不再重试该文件 | `quarantine()`（搬 `quarantine/`，ifAbsent 幂等）；mergeRemote 的 quarantined 清单驱动，隔离后文件消失故下轮不再报 | sync-runtime E（隔离、原位消失、quarantine/ 在位、再跑一轮 quarantined=0） |
| 断链：sync/ 被移走 → probe 失败 → state=degraded + 本地写入照常 | `cycleBody` probe 失败分支：`E_SYNC_DIR_UNAVAILABLE` 入 errors[]、仍 `flushAndPublish`（失败进重试暂存）、返回 degraded；恢复后下轮追平 | sync-runtime D（degraded + 写入照常 + 恢复追平） |
| 加密（§0.3）：DEK 经 DPAPI 包裹存 credentials/；段/快照 `.enc`；换钥/丢钥 → E_SYNC_KEY_MISMATCH 红条非静默 | crypto.ts（AES-256-GCM，AAD=文件名）+ keyring.ts（DPAPI）+ runtime（`encryptEnabled()` 每轮动态生效；SyncKeyError → state=error） | sync-runtime I（双端同 DEK E2E）/ J（错 DEK → error 态 + E_SYNC_KEY_MISMATCH 红条，不崩）；sync-crypto 12 条；sync-keyring 5 条（真 DPAPI 后端实测往返） |
| manifest 心跳 | `heartbeat()`：读远端 → `mergeManifest` → 更新本机水位（opLedger.maxLamport）→ 回写 | sync-runtime A（status.devices 两端 actorId + 水位） |
| ipc 状态机：setEnabled 后轮询起停（fake timers） | `setEnabled(on)`：停触发源回 idle；重开立即一轮 | sync-runtime H（假时钟 600s 不触发、重开 lastSyncAt 变化）；sync-ui setEnabled 面板两条 |
| gc：planCleanup 双门（retention + 全设备水位）；dry-run 默认 + 设置开启才真删；含 quarantine/ 清理 | `foldSnapshotAndGc()`：`planCleanup` 产清单 → `gcEnabled()` false 只计数 log；真删同时清 `quarantine/` | 引擎侧 planCleanup 已测（packages/sync 83 条一字未动）；运行时 dry-run 分支 log 路径 |

## 3. 本会话修复清单（10 错误逐条：选实现 / 选测试与理由）

| # | 位置 | 错误 | 选边 | 理由 |
|---|---|---|---|---|
| 1 | `src/main/index.ts:508` | `writeSettings(userDataDir, { sync: { enabled } })` 缺 encrypt/gc | **改实现** | `writeSettings` 的契约是"整份 SeptcatsSettings 原子落盘"（platform 层既定，packages/sync 同级的 platform 契约不动）。原实现漏读当前值直接写半个 sync 段，会把 encrypt/gc 一起抹掉——是接线 bug 不是类型 bug。改为：`readSettings` 读当前 → 只覆写 `sync.enabled` → 整份回写 |
| 2 | `runtime.ts:123` | `workspaceId` 无初始器且未用 | **改实现（删字段）** | options.workspaceId 已由 `workspaceIdFn` 承接（支持字符串直通/函数逐轮解析，`resolveWorkspaceId()` 在 commitOps 两处使用），该字段是重构残留死代码。删除字段，接口 `SyncRuntimeOptions.workspaceId` 保留（真实使用中） |
| 3 | `runtime.ts:133` | `policy` 未用 | **改实现（删字段）** | `options.policy` 已直接传入 `new SegmentBuilder(actor, options.policy)`，`this.policy` 字段无读者。删字段与构造器赋值行 |
| 4 | `test/diag.test.ts:76` | fixture 缺 `sync` 字段（`as SeptcatsSettings` 失败） | **改测试（补 fixture）** | T13 给 SeptcatsSettings 加了必填 `sync` 段（契约演进，非实现错）。该测试是"settings 进诊断包"的形状测试，fixture 应如实反映现行契约：补 `sync: { enabled: true, encrypt: false, gc: false }`。不走 `unknown` 中转——那会架空该用例的类型保障 |
| 5 | `test/settings-react.test.tsx:15` | `defaultSettings()` 缺 `sync` | **改测试（补 fixture）** | 同上：AppSettings 契约新增必填段，fixture 补 `sync: { enabled: true, encrypt: false, gc: false }`，渲染断言不变 |
| 6 | `test/sync-runtime.test.ts:131` | MemoryLedger 不满足 SyncDbAdapter | **改测试（对齐接口）** | 接口 `SyncDbAdapter` 是运行时真依赖的形状（db/rpc 的 all/get/batch 全异步）。假实现补 `async` + 可选 `params` 参数即语义等价，属 mock 与接口脱节，不是接口错 |
| 7 | `test/sync-runtime.test.ts:152` | `get(sqlId, params)` 传 2 参实收 1 | **改测试（对齐接口）** | 与 #6 同源：`SyncDbAdapter.get(sqlId, params?)` 带 params，mock 补 `_params?: unknown` 后调用点合法（测试桥与 main/index.ts 同构，两参调用是对的） |
| 8 | `test/sync-runtime.test.ts:153` | 同上（all） | **改测试（对齐接口）** | 同上 |
| 9 | `test/sync-runtime.test.ts:400` | `batch` 返回 `BatchData` 与 `Promise<BatchData>` 不匹配 | **改测试（对齐接口）** | mock 方法改 async（返回 Promise），行为零变化；被测函数 `withSyncHook` 的签名以真库 rpc 面为准，不动 |
| 10 | 连带 | `maxKeepSegs: options.maxKeepSegs`（`number \| undefined` 传给 exactOptionalPropertyTypes 的可选属性） | **改测试（条件展开）** | 测试 fixture 透传 undefined 撞上 `exactOptionalPropertyTypes`，改 `...(options.maxKeepSegs === undefined ? {} : { maxKeepSegs: options.maxKeepSegs })` |

**计划外修复（跑测试与 DoD 时发现，同为"测试/样式错改测试/样式"）：**

| 位置 | 问题 | 处置 |
|---|---|---|
| `test/sync-crypto.test.ts:35` | `expect(cipher).not.toContain('h')`——密文是 base64，字母表本身含小写 h/o，单字符断言概率性必炸（本轮密文恰好含 h）。本意是"密文不泄露明文" | 改测试：断言整段明文不出现在密文中 `not.toContain(PLAIN)`（base64 随机碰撞整段明文概率可忽略），并注释说明不能断言单字符 |
| `renderer/src/sync/SyncStatus.css:137` | no-magic 门禁：裸 `12px` 同文件重复 2 次（规则②：重复 ≥2 次即违规，单次豁免） | 改样式：`.sc-sync-status__v` 与 `.sc-sync-status__mono` 的字体声明完全相同，合并为一条共享规则后 `12px` 只出现一次（门禁语义内合法：提 token 或只出现一次）。视觉零变化；`.sc-sync-status__v` 的 `text-align: right` 保留独立规则 |

## 4. 验证原文（全部真跑）

### 4.0 收尾前置：pnpm -C apps/desktop typecheck 归零

```
> @septcats/desktop@0.1.2 typecheck
> tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit

（无输出，Exit Code: 0）
```

### 4.1 pnpm -r typecheck

```
packages/sync typecheck: Done
packages/schema typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
. typecheck: Done
Exit Code: 0
```

### 4.2 pnpm -r test（各包汇总原文）

```
packages/core test:       Test Files  8 passed (8)      Tests  38 passed (38)
packages/platform test:   Test Files  4 passed (4)      Tests  34 passed | 1 skipped (35)
packages/ui test:         Test Files  26 passed (26)    Tests  61 passed (61)
packages/schema test:     Test Files  1 passed (1)      Tests  3 passed (3)
packages/sync test:       Test Files  10 passed (10)    Tests  83 passed (83)   ← 引擎 83 条一字未动
packages/editor test:     Test Files  8 passed (8)      Tests  144 passed (144)
packages/dbview test:     Test Files  5 passed (5)      Tests  79 passed (79)
packages/importer test:   Test Files  4 passed (4)      Tests  59 passed (59)
apps/desktop test:        Test Files  20 passed (20)    Tests  194 passed (194)
Exit Code: 0
```

（platform 的 1 skipped 是 T9 遗留的 skipIf 探测用例，非本任务范围，历史各期报告同值。）

### 4.3 4 个 sync 测试文件（vitest --reporter=verbose，无 skip）

```
✓ test/sync-crypto.test.ts (12 tests)
✓ test/sync-runtime.test.ts (10 tests)   ← A–J 十场景全真跑，双 runtime 四场景（A 并发/断链/E 崩溃/F S5）无一 skip
✓ test/sync-keyring.test.ts (5 tests)    （含真实 DPAPI 后端往返 925ms）
✓ test/sync-ui.test.tsx (7 tests)
Test Files  4 passed (4)
Tests  34 passed (34)
```

### 4.4 pnpm -C apps/desktop selftest

```
PASS rebuildFromSegments 应用 2 段
PASS rebuild 后 op_ledger 事件数=3
PASS v4 后块正文进 FTS（触发器写入路径）
PASS FTS_RESYNC 2000 页全量重算耗时 15.1 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
（……共 40+ PASS，全文见运行日志）
SELFTEST OK
Exit Code: 0
```

### 4.5 node packages/ui/tokens/no-magic.mjs

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
Exit Code: 0
```

（首跑曾报 `SyncStatus.css:137 裸 px「12px」重复 2 次`，修复见 §3 计划外修复表。）

### 4.6 pnpm -C apps/desktop build

```
out/preload/index.js  9.07 kB
✓ built in 13ms
vite v7.3.6 building client environment for production...
✓ 4807 modules transformed.
../../out/renderer/index.html                     1.04 kB
../../out/renderer/assets/index-D4TYXaMk.css     61.59 kB
../../out/renderer/assets/index-CbNi_QLe.js   1,356.63 kB
✓ built in 3.45s
Exit Code: 0
```

（zod 的两条 Rollup comment 注释告警为依赖包内部注释，非本任务产物，构建成功不受影响。）

## 5. SSIM-NOTE（07 屏）

对齐 mockup 07「同步状态」屏：顶栏状态钮五态逐一落地——idle（灰点 +「同步未开启」）、syncing（琥珀呼吸点 +「同步中」）、ok（绿点 +「已同步 · 相对时间」）、degraded（橙点 +「同步文件夹不可访问」）、error（红点 +「同步错误」，E_SYNC_KEY_MISMATCH 红条入口）；点击弹面板：设备列表（actorId + Lamport 水位）、待发段数、最近错误（稳定 code + 中文人话 message）、「立即同步」按钮、同步启停开关。加密开关按任务书归设置页，面板不重复放。全部新文案进 `i18n/zh-CN.ts`；CSS 只用 `var(--sc-*)` token（no-magic 门禁过；唯一字面 12px 为共享规则内的单次出现，属门禁明文豁免语义）。无与 mockup 的结构性偏差。

## 6. DEVIATIONS

1. **`filterAgainstLedger` 是引擎幂等之上的运行时补丁**：任务书 §2 写"复用 core 幂等：已在账本的 op 跳过"。mergeRemote 的 op_id 去重已覆盖该字面，但 S5 快照播种后，旧段里与本机等 lamport 的 op 会因 op_id 决胜漂移被重复 apply，故 runtime 在落账本前追加了 Lamport 维度过滤（等值/落后跳过）。这是接线层的过滤而非引擎算法改动，packages/sync 仍零改动；已在代码注释中写明动机。
2. **sync:now 语义为 await 完成**：任务书 §1 写 `sync:now → 立即跑一轮`，实现为 `await runCycle()` 后回最新快照（面板「立即同步」按钮等待真实终态，避免按钮返回后状态仍是 syncing 的歧义）。
3. **恢复码 UI 一期不做**（任务书 §0.3 授权）：DEK 丢失 → E_SYNC_KEY_MISMATCH 红条，重加密/恢复流程归后续任务。
4. **`persistEnabled` 走整份读改写**：`writeSettings` 契约是整份落盘（见 §3 #1），sync:setEnabled 持久化时读当前设置只改 `sync.enabled`。若未来 platform 提供 partial 写口可简化，本期不动 platform。

## 7. 未决项

1. **双实例真机验收**（任务书 §5 尾注）：两个 `--user-data-dir` 起两个打包实例对拷，由 PM 组织，不在本任务内。
2. **恢复码 UI / DEK 轮换后的历史段重加密**：keyring.rotateDek 已备，旧段重加密与用户引导流程未做（§6.3）。
3. **probe 的「文件夹 N 分钟无写入」告警**：FsWatchProvider.probe 已返回目录 mtime，告警 UI 阈值策略待 PM 拍板后接入。
4. **工作区遗留 `_scratch/` 目录**（未跟踪）：上一会话的临时产物，未纳入本任务交付，待 PM 裁决保留或删除。
5. **gc 真删目前无运行时级集成测试**：引擎 planCleanup 已测（83 条内），运行时只走了 dry-run log 分支的隐式覆盖；真删分支建议在双实例验收时人工观察一轮。
