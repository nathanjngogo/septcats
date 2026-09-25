# TASK-T80-04 交付报告（工程师填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T80-04.md` · 来源：T80-02 真机探针 run-B/run-C（H-08/H-09）

## §0 开工侦察结论（必答）

### ① db 连接的真实持有者与最小 close/reopen 路径

**真实持有者（代码定位）**：唯一 better-sqlite3 连接实例住 **DbServer utilityProcess**——
`apps/desktop/src/db/server.ts:874` `new SqliteCtor(dbPath)`，由 `createDbServerCore(database, dbPath)`
（`server.ts:532`）的闭包变量 `current` 持有；迁移的文件级还原会把 `current` 换成新连接
（`server.ts:531-533`）。主进程侧**没有**文件句柄，只有一个 RPC 代理句柄 `DbClient`
（`db/client.ts:87`，实现 `DbHandle`），由模块级 `dbHandle`（`main/index.ts:153`）持有并分发给
pages/db/search/importer/blocks/templates/links/lock 七套服务与 SyncRuntime/CollabHub。

**既有 close/reopen 通道（报告 T80-02 §0-② 清单第 1 行）两条**：
1. **进程级**：`DbHandle.dispose()`（`client.ts:177`，kill utilityProcess）+ `startDbServer()`
   （`client.ts:290`，另起新进程）。代价：新 `DbClient` 身份 → 七套服务持有的 `executor` 与
   SyncRuntime/CollabHub 的 handle 引用**全部失效**（T80-02 D-1 已明确警告，且这正是造「第二套
   close/reopen 通道」的红线）。
2. **进程内文件级换库先例**：`migrations.tryFileLevelRestore`（`migrations.ts:411-432`）——
   `db.close()` → `removeSidecarFiles` → `copyFileSync(backup, dbPath)` → `reopenDatabase(dbPath)`
   换**新连接**（同进程、同 `current` 变量语义）。

**本单选型：走 2 的进程内形态——新增 DbServer RPC `closeConnection` / `reopenConnection`。**
只关主库连接、**不杀进程**；`DbClient` 句柄身份不变，七套服务与 SyncRuntime 的引用全程有效。
这满足任务书「只关主库连接不杀进程」的判据，并复用 `tryFileLevelRestore` 的既有语义（`close` +
`loadSqliteConstructor` + `applyPragmaBaseline` + 换 `current`）。进程级 dispose+startDbServer
因破坏全部服务引用而不采用（`§2` 记选型依据，`§4` 记与任务书「停库→还原→重建服务」措辞的偏差）。

### ② 攒段缓冲的暴露面与既有 flush 入口

**缓冲位置**：`SyncRuntime.builder: SegmentBuilder`（`runtime.ts:192` / `246`），未 flush 的 op 在
`SegmentBuilder.ops`（`packages/sync/src/writer.ts:46`），计数 `SegmentBuilder.pendingCount`
（`writer.ts:167`），经 `getStatus().pendingOps` 暴露（`runtime.ts:273`）。
**既有 flush 入口**：`SyncRuntime.flushAndPublish()`（公开方法，`runtime.ts:444`，T31-01 起用
`builder.flushAll()` 全缓冲清空）；同款先例 = T80-01 便携包导出的 `sealSegments`
（`main/index.ts:605-612` `await runtime.flushAndPublish()`）。
**最低成本路径**：给 `createPortableImportService` 新增可选注入
`flushSegments?: () => Promise<void>`（照 T80-01 `sealSegments` 注入面），`index.ts` 注
`() => syncRuntime?.flushAndPublish()`（runtime 为 null 时视为无缓冲）；`execute` 在
`pauseSync` 之后、覆盖度 `coverage()` 之前 await 它。**不新增跨模块 getter**（选任务书 a 路线）。

## §1 改动清单（文件 × 要点）

| # | 文件 | 要点 | 缺陷 |
| -- | -- | -- | -- |
| 1 | `apps/desktop/src/db/rpc.ts` | `DbRequest` 新增 `closeConnection` / `reopenConnection` 两型；新增 `ConnectionData{open}` 并入 `DbResponseData`；`REQUEST_TYPES` 放行两通道 | H-09 |
| 2 | `apps/desktop/src/db/server.ts` | `DbServerCore` 新增 `closeConnection()/reopenConnection()`；`createDbServerCore(database, dbPath=database.name)` 记 `connectionOpen/disposed`；两 case 走 `loadSqliteConstructor`+`applyPragmaBaseline` 换 `current`（照 `reopenDatabase`）；释放态下除两通道外一律 `E_NOT_READY`；入口传 `dbPath` | H-09 |
| 3 | `apps/desktop/src/db/client.ts` | `DbHandle` 声明两方法；`DbClient` 实现两 RPC（**不 kill 进程**，句柄身份不变） | H-09 |
| 4 | `apps/desktop/src/main/portableImport.ts` | ①`PortableImportDb` 增 `closeConnection/reopenConnection`；②`restorePairs` 进入前对每件 `to` **逐字节快照**，任一步失败按快照回滚（该在的写回、不该在的删掉）→「失败不留半成品」；③新增 `withConnectionClosed(restore)`：先 close → restore → **无论成败** reopen（reopen 失败抛 `E_PORTABLE_REOPEN_FAILED`；restore+reopen 双失败抛 `E_PORTABLE_ROLLBACK_FAILED`）；④`revert` 与 `execute` 失败回滚改走该入口；⑤新增注入 `flushSegments`（execute 预检前强制封段，失败拒导 `E_PORTABLE_FLUSH_FAILED`）与 `pendingOpIds`（plan 并集面）；⑥`coverage()` 自「账本」改为「账本 ∪ 缓冲」，回执增 `pendingOps` | H-09/H-08 |
| 5 | `apps/desktop/src/main/index.ts` | db 端口注入 `closeConnection/reopenConnection`（转 `handle.*`）；注 `flushSegments: () => syncRuntime?.flushAndPublish()` 与 `pendingOpIds: () => syncRuntime?.pendingOpIds() ?? []` | H-09/H-08 |
| 6 | `packages/sync/src/writer.ts` | `SegmentBuilder` 新增只读 `pendingOpIds()`（不 flush、不改缓冲） | H-08 |
| 7 | `apps/desktop/src/main/sync/runtime.ts` | `SyncRuntime` 新增只读 `pendingOpIds()` 转发（run-A 时序的 plan 可见面） | H-08 |
| 8 | `apps/desktop/test/portable-import.test.ts` | `MemIo` 增 `removeGuard`；`FakeDb` 增 `close/reopenConnection`、连接存活校验、重放写坏钩子；新增 **H-08 四例**（run-A 缓冲有 op→plan blocked + execute 强制 flush 后 blocked、run-B 账本有 op→双双 blocked、缓冲已被包覆盖不误拒、封段失败 `E_PORTABLE_FLUSH_FAILED` 零落盘）与 **H-09 五例**（execute 回滚先关后开逐字节、revert 必败半成品归零、revert 成功 close→reopen 序、真连接 revert 成功、未 close 删主库必失败实证） | H-08/H-09 |

**未动**（红线）：`restorePairs` 备份三件套语义（`db`/`-wal`/`-shm`、顺序、缺失者保持已清理）保持；
T80-02 已收口安全闸与既有错误码语义一字未改（仅**新增** `E_PORTABLE_REOPEN_FAILED` /
`E_PORTABLE_FLUSH_FAILED` 两个 additive 码）；`packages/*` 未 import electron；启动零外联。

## §2 选型依据

- **H-09：选「进程内 close/reopen（新增 DbServer RPC）」，不选「还原到暂存 + 请求应用重启生效」。**
  依据：①任务书 §缺陷1 首选即「先经 IPC 让 db 侧 close() 释放句柄 → restorePairs → reopen」；
  ②进程内 close/reopen **不破坏**七套服务与 SyncRuntime 持有的 `executor` 引用（`DbClient` 身份不变），
  而进程级 dispose+startDbServer 会让全部引用失效；③复用了 `migrations.tryFileLevelRestore` 的既有
  `close → 换连接` 语义，未造第二套通道。
  **真机证据（T80-02 run-E P5-1 原始）**：`E_PORTABLE_ROLLBACK_FAILED: 还原前清理失败 ...septcats.db：EBUSY: resource busy...`；
  P5-3 重启后包外页仍在（半成品实证）。修复后本单真连接单测（`better-sqlite3` 直连夹具）：
  `连接存活时 revert 成功：close 释放句柄 → 还原 → reopen 且数据可继续读` PASS，
  `未 close 就删主库在 Windows 必失败（EBUSY 根因实证）` PASS（证明必须先关连接）。
  *（说明：本机沙箱内原生模块为 Electron ABI，真机复跑归 PM §5。）*

- **H-08：a) execute 前强制 flush 与 b) 预检并集，两条同时落地（只押 a 会漏 plan 路径）。**
  依据：任务书 PM 倾向 a（复用既有 flush，不新增跨模块 getter）——本单照 a 实现 execute 前置
  `flushSegments`；但 run-A 的失败证据是 **plan** 路径（plan 必须保持只读零副作用，不能 flush），
  故 plan 侧补 b 的只读并集面（`SyncRuntime.pendingOpIds()`）。二者叠加：**execute** 先封段再预检
  （盲区压到零），**plan** 直读「账本 ∪ 缓冲」。任务书要求「钉两种时序」，正是 run-A（缓冲态）与
  run-B（账本态）两例；仅 a 会让 plan 仍报 `uncovered=0`，与 DoD「两轮 `rBusyLive.pass.target.uncovered`
  值一致」冲突。
  **时序证据**：新增用例 `时序 run-A（缓冲有 op、账本无）`：plan `uncovered=1 / willReplace=false /
  blocked=E_PORTABLE_NOT_EMPTY`，execute `E_PORTABLE_NOT_EMPTY`（且断言缓冲 op 确已落账）；
  `时序 run-B（flush 后账本有 op）`：plan 与 execute 均 `E_PORTABLE_NOT_EMPTY`。两态 **值一致**。

## §3 门禁原始输出（贴命令原文）

### 3.1 环境说明（沙箱约束，非产品问题）

本机沙箱（workspace-write）**禁止带管道 stdio 的子进程**，而 `vitest` 依赖 esbuild 的
`child_process.spawn(stdio:['pipe','pipe','inherit'])` 服务，且 vite 在 Windows 会
`exec('net use')`；两者均被拒（`spawn EPERM`）。审批通道不可用 → 无法在原生 `pnpm test` 下起
vitest。为**不交没跑过的测试**，本单用等价进程内垫片在沙箱内跑**同一份测试文件**：
① net use 探测短路（无网络盘映射 → 空输出，语义等价）；② esbuild → TypeScript 进程内转译；
③ `better-sqlite3`（Electron ABI 136，Node 需 127）→ `node:sqlite` 验证垫片，使 DB 用例真跑。
垫片仅用于本次验证，**未落产线**（收尾已删）。PM 在正常环境直接跑原生命令即为最终口径。

### 3.2 `test/portable-import.test.ts`（含 H-08/H-09 新测试）

```
$ pnpm --config.enable-pre-post-scripts=false --filter @septcats/desktop exec vitest run \
    --config vitest.t80verify.config.mts --configLoader native test/portable-import.test.ts --reporter=verbose
✓ 时序 run-A（缓冲有 op、账本无）：plan 必 blocked；execute 强制 flush 后必 blocked 1ms
✓ 时序 run-B（flush 后账本有 op）：plan 与 execute 都 blocked E_PORTABLE_NOT_EMPTY 1ms
✓ 缓冲 op 已被包覆盖（本机导出场景）：并集后 uncoverable=0，不误拒 1ms
✓ execute 前封段失败 → E_PORTABLE_FLUSH_FAILED，零落盘（不静默放过盲区） 1ms
✓ execute 重放失败回滚：先关连接 → 还原 → 重开；三件套逐字节回调用前 1ms
✓ revert 必败（删到一半失败）→ 三件套逐字节回到调用前，不留半成品 1ms
✓ revert 成功：先 close 释放句柄 → 还原 → reopen（撤销按钮真能点活） 1ms
✓ 连接存活时 revert 成功：close 释放句柄 → 还原 → reopen 且数据可继续读 76ms
✓ 未 close 就删主库在 Windows 必失败（EBUSY 根因实证）；close 后可删 3ms
Test Files  1 passed (1)
      Tests  33 passed (33)
```

### 3.3 `apps/desktop` 全量（原生 `pnpm --filter @septcats/desktop test` 等价口径）

```
$ pnpm --config.enable-pre-post-scripts=false --filter @septcats/desktop exec vitest run \
    --config vitest.t80verify.config.mts --configLoader native
 Test Files  1 failed | 105 passed (106)
      Tests  2 failed | 1191 passed | 1 skipped (1194)

⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯
 FAIL  test/perf.test.ts > perf：... > 冷进程打开 1 万页真库 → 第一次搜索 ≤150ms
Error: spawn EPERM   ❯ test/perf.test.ts:128 runColdChild
 FAIL  test/perf.test.ts > perf：... > 1 万页库冷打开 + migrate + 首查 <800ms
Error: spawn EPERM   ❯ test/perf.test.ts:128 runColdChild
```

仅 `perf.test.ts` 的 2 例红：它 `spawn` 冷子进程（`test/perf-cold-child.ts`），命中本沙箱
**同一 spawn 限制**，与本次改动无关（未碰 perf 路径）。其余 **1191 用例全绿**，含 H-08/H-09 九例。

### 3.4 `packages/sync`（改过 `writer.ts`）

```
$ pnpm --config.enable-pre-post-scripts=false --filter @septcats/sync exec vitest run \
    --config vitest.t80-04.config.mts --configLoader native
 Test Files  1 passed (1)      # test/writer.test.ts
      Tests  14 passed (14)
```

### 3.5 `pnpm typecheck`（9/9 工程：8 packages + apps/desktop）

```
$ node node_modules/typescript/bin/tsc -p <each project>/tsconfig.json --noEmit
packages/core     exit 0
packages/schema   exit 0
packages/platform exit 0
packages/ui       exit 0
packages/editor   exit 0
packages/dbview   exit 0
packages/sync     exit 0
packages/importer exit 0
apps/desktop/tsconfig.node.json  exit 0
apps/desktop/tsconfig.web.json   exit 0     → 9/9 Done（0 error）
```

## §4 DEVIATION

| # | 偏离/前提与代码不符 | 处置（最小改动） | 需 PM |
| -- | -- | -- | -- |
| D-1 | 任务书把 close/reopen 描述为「停库 → 还原 → 重建服务」，暗示走进程级 `dispose()+startDbServer()`。但代码事实：`DbHandle` 被七套服务 + SyncRuntime/CollabHub 按引用持有，换进程会让引用全失效（T80-02 D-1 明令） | 改为**进程内** close/reopen：新增 DbServer RPC `closeConnection`/`reopenConnection`，复用 `tryFileLevelRestore` 的 `close → 换 current` 语义；`DbClient` 身份不变 | 追认 |
| D-2 | 任务书把 H-08 写成「二选一」。但 plan 必须只读零副作用（不能 flush），仅押 a 会让 plan 的 `uncovered` 仍不可见，与 DoD「两轮值一致」冲突 | **a+b 叠加**：execute 前置 `flushSegments`（a），plan 用只读并集 `pendingOpIds`（b）。新增的 `pendingOpIds` 是**只读 getter**（不 flush、不改缓冲） | 追认 |
| D-3 | 任务书 §缺陷1 要求「revert 必带新测试：断言失败后库与调用前逐字节一致」。原 `restorePairs` 失败时 -wal/-shm 已被删（半成品），不能只加测试 | 在 `restorePairs` 内加**调用前逐字节快照 + 失败回滚**（不改三件套语义，只补原子性）；测试用 `removeGuard` 制造「删到一半失败」 | 追认 |
| D-4 | 新增两个结构化错误码 `E_PORTABLE_REOPEN_FAILED`（还原成功但连接未重建）与 `E_PORTABLE_FLUSH_FAILED`（封段失败拒导） | 与既有 `E_PORTABLE_ROLLBACK_FAILED`（还原本身失败）区分收场路径，UI/日志可辨；**未被要求**但为「失败不留半态」所必需 | 追认 |
| D-5 | 沙箱禁带管道 stdio 的 `spawn`（esbuild 服务 / `net use` / perf 冷子进程），原生 `pnpm test` 无法起 vitest；审批通道不可用 | 用**进程内等价垫片**跑同一份测试文件（见 §3.1），验证后删除垫片；`perf.test.ts` 2 例因同一限制留红（与改动无关）。PM 环境请以原生命令复跑 §3.2–3.5 | 知悉 |

## §5 PM 复跑（PM 补）

（待填：cdp-e2e-t80-02.mjs ≥2 轮结果 + 新增测试计数）

---

DSH-T80-04-EXIT=0
