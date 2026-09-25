# T80-02 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T80-02.md` · PRD：`docs/PRD-R28-便携包.md` §2
> 落盘方式：只 Write/Edit，未碰 git。

## §0 开工侦察结论（四问）

### ① 重放入口复用

**结论：零新机制，可整条复用**（T80-01 §0-① 的对齐结论在代码里逐行复核通过）。

| 环节 | 复用物 | 位置 |
| --- | --- | --- |
| 段文本 → `Segment[]` | `decodeSegment()`（内含 `validateSegment` + `schema_ver` 全校验） | `packages/core/src/segment.ts:235` |
| 段名合法性 | `parseSegmentFileName()`（含网盘副本 ` (1)`） | `packages/sync/src/naming.ts:44` |
| 重放落库 | `DbHandle.rebuildFromSegments(segmentsJson, mode)` | `db/client.ts:161` → `db/server.ts:580` |
| 清空到「新库态」 | `REBUILD_CLEAR_SQL`（fts/record/block/collection/page/**op_ledger**） | `db/server.ts:119` |
| FTS 重建 | `fts_defer` 包裹 + `FTS_RESYNC_SQL` 事务内一次全量 | `db/server.ts:620/640` |
| 备份前 checkpoint | `handle.checkpoint()`（T80-01 D-6 加的 RPC，`wal_checkpoint(TRUNCATE)`） | `db/server.ts:665` |

**最小包装只需三件事**（本单新增，全部是「读 zip + 拼参数」级别，不碰重放语义）：

1. 逐段 `decodeSegment(new TextDecoder().decode(bytes))` → `Segment[]` → `JSON.stringify(segments)`；
2. **执行前自检**：实收段条目数 == `manifest.segments`，且解码后数组长度 == `manifest.segments`
   （H-04 P0 硬要求：包内段清单 ⊇ 预期；不符即 `E_PORTABLE_SEGMENT_COUNT` 拒，**不落库**）；
3. 显式传 `mode: 'replace'`（T82-01 §1.2：缺省是 `merge`，导入侧禁依赖缺省值）。

**为什么是 replace 而不是 merge**：包 = 换机迁移的权威全量（PRD §2「不 merge」）；包内段就是
导出时刻 `listSegments()` 的全集（T80-01 §0-①），`REBUILD_CLEAR_SQL` 后的重放 = 对干净库跑
一次全段重放。但 T82-01 的 H-04 教训（段集不完整 → replace 抹除数据）在导入侧同样成立，
故 replace 的前置闸门是「**覆盖度自检**」而不是「拍脑袋」（见 ③）。

### ② 停机边界（换库要动的持有者与既有 close/reopen 通道）

**持有者清单**（逐项查过构造与生命周期）：

| # | 持有者 | 持有什么 | 既有 close/reopen 通道 | 本单处置 |
| -- | -- | -- | -- | -- |
| 1 | `dbHandle`（`DbClient` → `utilityProcess`，**唯一** better-sqlite3 连接） | 打开的文件连接 | `dispose()`（`client.ts:177`）+ `startDbServer()`（`client.ts:290`）；另 `migrations.tryFileLevelRestore`（`migrations.ts:411`）是「close → `copyFileSync` → `reopenDatabase()` 换**新连接**」的文件级换库先例 | **不重启进程、不换连接**：重放走既有 `rebuildFromSegments` RPC；文件级备份/还原走 `migrations` 同款顺序（清 sidecar → 覆写主库字节）。见 DEVIATION D-1 |
| 2 | `syncRuntime`（`FsWatchProvider.watch` + 60s 定时器 + `pendingOps` 攒段器，会并发写 `op_ledger` 与段目录） | 段目录 watcher、定时器、内存攒段 | **`stop()` / `start()`**（`runtime.ts:365 / 332`，will-quit 与 `sync.setEnabled` 已在走） | 导入期间 **pause → 导入 → resume**（DI 注入，不造第二套） |
| 3 | `collabHub`（按页缓存 Y.Doc / 会话态） | 内存 Y.Doc | `dispose()`（`index.ts:1204`） | 不重建；导入后页内容全换 → 记入 §5 遗留（下次 `collab:attach` 重新取种子） |
| 4 | `pages` / `db` / `search` / `blocks` / `templates` / `links` / `lock` | 只持 `executor`（= handle 或 `withSyncHook(handle)`），**无内存缓存**（每次读库） | 无需停机 | 不动 |
| 5 | `page_link_index`（v9 派生表） | 派生行 | 启动 `rebuildLinksIndex`（`index.ts:473`） | **不在 `REBUILD_CLEAR_SQL` 清单里**（T82-01 §5-1 既有缺口）→ 导入后索引会陈旧，本单不动清单，记 §5 |

**关键取舍**：换库**不需要**关 db 进程——因为「新库」不是新文件，而是 `REBUILD_CLEAR_SQL`
把 6 张表清空后的**新库态**（正是 T80-01 §0-① 里「对干净库跑一次全段重放」的口径）。
这样 ①不造第二套 close/reopen 通道；②所有服务的 `executor` 引用全程有效；③重放是**单事务**，
失败即 better-sqlite3 回滚（文件级还原是双保险，不是唯一保命手段）。

### ③ 冲突预检「非空库」判据

**结论：判据 = 「本机 `op_ledger` 里存在包内段未覆盖的 op_id」**（集合语义，不是行数阈值）。

- **为什么不用 `page alive > 0`**：页面可全在回收站（tombstone）而账本仍有历史；反之「已建工作区
  但没建页」的库页面为空、账本也可能非空。页级判据对「整机替换」没有判别力。
- **为什么不用「行数 > 0」而用集合**：首启种子（`requireActiveWorkspace` → `workspace.upsert`，
  `pages.ts:294/311`）走的是**直接建表写入，不进 op_ledger**（`workspace` 不在 `TargetTable` 里），
  所以「全新空库」的 `op_ledger` 行数确实是 0；但**同包重复导入**时目标库必然非空
  （刚被同一个包灌满）——若判据是「非空即拒」，§幂等 要求的「同包重复导入 = 同结果」会被自己的
  预检拒掉，自相矛盾。故细化为**覆盖度判据**：
  - `uncovered = 本机 op_id ∉ 包内段 op_id 集合`；
  - `uncovered === 0`（含空库这一平凡情形）→ 放行（包是本机的超集或全集，replace 不丢数据）；
  - `uncovered > 0` → `E_PORTABLE_NOT_EMPTY` 拒，**不 merge、不落库**。
- **与 `ledgerHasCrdt` 种子门不冲突**：后者（T19-05-1，`collab.ts:225`）是**页级**判据
  （该页账本是否已有任何 `crdt_update` op），只服务 Y.Doc 播种；本判据是**库级**、
  按 `op_id` 全集比对，两者粒度与用途不相交，且导入后新库 crdt 态由包内段自带
  （T80-01 D-2 的快照缺口见 §5）。
- 读取面复用 `opLedger.listAll`（`statements.ts:661`，含 `op_json`），成本量级与 T82-01 §0-④
  实测同款（963 op ≈ 6 ms / 1 万 op ≈ 31 ms）。

### ④ 回滚通道与 `*.db.bak-*` 既有消费者

**既有消费者全表**（`grep -rn "bak-"` 全仓，排除 test/mockup）：

| 位置 | 作用 | 会不会误动 `bak-portable-<ts>` |
| -- | -- | -- |
| `db/migrations.ts:395` | 产出 `${dbPath}.bak-v${from}`；`createPreMigrationBackup` 开头 `removeFile(backupPath)` **只删这个精确名** | 否（名字不同：`bak-v<N>` vs `bak-portable-<stamp>`） |
| `main/portable.ts:191` `isExcludedDataFile` | 导出时排除 `name.includes('.bak-')` | 否（反而是**好处**：新备份不会被下一次导出打进包里） |
| `packages/sync/src/portableZip.ts:75` `PORTABLE_EXCLUDED` | 同上，写进 `manifest.excluded` | 否 |
| 清理/GC/定时任务 | **全仓无任何删除 `*.bak-*` 的清理面**（T81 墓碑 GC 只管 db 行） | 否 |

**结论**：`septcats.db.bak-portable-<ts>` 是全新名字，**无既有消费方、无 GC 误删面**；
且天然被下一次导出的排除规则挡在包外（不会自我膨胀）。三件套 = `db` / `db-wal` / `db-shm`
（checkpoint(TRUNCATE) 之后 `-wal` 为 0 字节，但**仍逐字节备份**，还原时按同一份集合回写，
保证「逐字节还原」可断言）。还原顺序照 `migrations.ts:375/419-423` 的先例：
先清 sidecar（`-wal` / `-shm`）→ 覆写主库字节 → 回写 sidecar 字节。

## §1 三段式换库实现

### 1.1 纯逻辑（新增 `packages/sync/src/portableImport.ts`，写侧 portableZip.ts 一字未改）

`PORTABLE_BACKUP_MARK='bak-portable'` / `PORTABLE_DB_SIDECAR_SUFFIXES=['-wal','-shm']` /
`PORTABLE_ENCRYPTED_SUFFIX='.enc'`；`portableBackupName` / `portableBackupPlan`（备份三件套）/
`portableBackupOrigin` / `portableRestorePlan`（撤销入口反解）/ `classifyPortableEntry` /
`portableSegmentNames`（排除 `.enc`）/ `portableAttachmentNames` / `isPortableEncrypted` /
`assertPortableImportEntryName(s)`（zip slip 同口径）/ `parsePortableManifest`（三重闸）/
`verifyPortableChecksums` + `portableChecksumsOk` / `assertPortableSegmentCount` /
`portableSchemaCompatible`。零 fflate、零 fs、零 electron（sha256 复用写侧的 `sha256Hex`）。

### 1.2 服务（新增 `apps/desktop/src/main/portableImport.ts`，DI 可 node 直测）

`createPortableImportService({ dbPath, db, schemaVersion, pickArchive?, pauseSync?, resumeSync?, now?, io?, log? })`
→ `plan / execute / revert`。`execute` 语句序固定：

```
安全闸（与 plan 同一份 openPackage，不信任 plan 结论）
  ├ 闸1  zip slip 条目名        → E_ENTRY_NAME
  ├ 闸2  清单在场 + 本格式       → E_PORTABLE_BAD_MANIFEST
  ├ 闸3  加密包（双判据）        → E_PORTABLE_ENCRYPTED_UNSUPPORTED
  ├ 闸4  checksums 全验          → E_PORTABLE_CHECKSUM（缺/多/篡改三面）
  └ 闸5  段数 == manifest.segments → E_PORTABLE_SEGMENT_COUNT（H-04 P0）
包 schema ≤ 当前                                    → E_PORTABLE_SCHEMA_NEWER
pauseSync()  （既有 SyncRuntime.stop）
  ├ 覆盖度复检（本机 op_id ⊆ 包内 op_id，否则拒）   → E_PORTABLE_NOT_EMPTY
  ├ ① checkpoint(TRUNCATE) + 备份三件套 bak-portable-<ts>  → E_PORTABLE_BACKUP_FAILED
  ├ ② rebuildFromSegments(json, **'replace'**)
  └ ③ 任一失败 → restorePairs（先清 sidecar → 逐字节回写）→ 抛原错 + rolledBack:true
                 还原自身失败 → E_PORTABLE_ROLLBACK_FAILED
resumeSync() （finally；既有 SyncRuntime.start）
```

错误码（新增 9 个，全部结构化、无未捕获异常面）：
`E_PORTABLE_BAD_ZIP` / `E_PORTABLE_BAD_MANIFEST` / `E_PORTABLE_CHECKSUM` /
`E_PORTABLE_BAD_SEGMENT` / `E_PORTABLE_SEGMENT_COUNT` / `E_PORTABLE_SCHEMA_NEWER` /
`E_PORTABLE_NOT_EMPTY` / `E_PORTABLE_BACKUP_FAILED` / `E_PORTABLE_ROLLBACK_FAILED`
（另复用既有 `E_MALFORMED` / `E_INVARIANT` / `E_ENTRY_NAME` / `E_PORTABLE_ENCRYPTED_UNSUPPORTED`）。

**红线落点**：无备份不落库（备份写失败即抛、半成品清理、重放从未被调用）；禁静默覆盖
（覆盖度闸 + 备份 + 回滚三件套）；op-log 零新增语义（只调既有 rebuild）；packages 不 import
electron；启动零外联（本单无网络调用）。

## §2 IPC 契约与入口（设置页 / `--import-portable`）

- `shared/portable.ts`（纯类型契约）：`PortableImportInput{zipPath?,dir?}` /
  `PortableImportPlan{zipPath,manifest,counts,bytes,schema{package,current,compatible},
  target{ledgerOps,uncovered,willReplace},warnings,blocked}` / `PortableImportResult{ok,
  zipPath,backupPath,backupFiles,replay{segments,ops,entities,mode:'replace',keptOps}}` /
  `PortableImportRevertInput{backupPath,confirm:true}` + `PortableImportRevertResult`。
- `shared/ipc.ts`：`CHANNEL_PORTABLE_IMPORT_PLAN/EXECUTE/REVERT` = `portable:import:plan|execute|revert`
  + `PORTABLE_IMPORT_CHANNELS`（`PortableImportChannel`）。
- preload + `types/window.d.ts`：`window.septcats.portable.importPlan / importExecute / importRevert`
  （与 T82-01 §6 的「preload 必须传对象」纪律一致：三通道一律传对象）。
- `main/index.ts`：Services 加 `portableImport`；db 端口就地适配（`handle.checkpoint()` /
  `handle.all('opLedger.listAll')` 取 op_id / `handle.rebuildFromSegments(json, mode)`）；
  `schemaVersion = (await handle.migrate()).to`；`pickArchive` 走系统文件对话框（filters zip，
  默认 `<数据根>/export`）；`pauseSync/resumeSync` = 既有 `syncRuntime.stop()/start()`；注册 IPC。
- **命令行**：`readImportPortableArg(process.argv)` 解析 `--import-portable <zip|dir>`
  （`.zip` 结尾按包路径，否则按 dir 契约），`bootstrapApplication` 里**开窗之前**跑完
  （首启迁移工作流），失败只留日志不阻断启动。
- **设置页**：「数据与隐私」区新增「导入便携包」行 → 预览块（条目/段/字节 + 来源库 + 阻断项 +
  未覆盖提示 + warning）→ 「取消 / 确认导入」（`blocked !== null` 时禁用）→ 完成后显示备份路径 +
  「撤销导入」→ 显式确认 Dialog（骨架同恢复码三件套）→ `importRevert`。全部文案走 i18n
  （`settings.privacy.portable.import*`，zh/en 双份），无「数据库」字样（门禁⑥）。

## §3 测试与门禁

新增 `apps/desktop/test/portable-import.test.ts`（**24 用例**）：

```
$ npx vitest run test/portable-import.test.ts
 ✓ test/portable-import.test.ts (24 tests) 34ms
 Test Files  1 passed (1)      Tests  24 passed (24)
```

覆盖：备份名/三件套/反解与还原计划 / 条目分类四态 / 加密双判据 / 清单四闸 / checksums 四面
（相符·篡改·缺·多）/ 段数自检 / zip slip 四类坏名 / schema 兼容 / **roundtrip（T80-01 导出
夹具产真 zip → 导入：counts 逐值等、段内 op_id 逐一等、mode=='replace'、keptOps==0）** /
**三段式顺序（重放时刻三件套已在；checkpoint 先于重放）** / 备份内容逐字节等 / **幂等（同包
第二遍 target.uncovered==0 且 replay 逐值等）** / 非空冲突预检（plan.blocked + execute 拒 +
零落盘）/ checksums 篡改拒 / 段数自检拒 / 缺条目 checksums 拒 / zip slip 拒 / 半截 zip 与非 zip
结构化拒 / 加密包拒 / **失败注入（重放前把库写坏 → 抛错 + rolledBack + 三件套逐字节还原）** /
**无备份不落库（备份写失败 → E_PORTABLE_BACKUP_FAILED、rebuild 从未调用、半成品已清）** /
撤销还原 / dir 显式契约（含「两者皆缺 → E_MALFORMED」）/ confirm 守卫与 IPC（`service=null`
→ E_INVARIANT、非对象入参 → E_MALFORMED）。

**失败注入用例的红测实证**（临时把 `restorePairs(...)` 那一行换成注释后复跑，随后已还原、无残留）：

```
 FAIL  test/portable-import.test.ts > 便携包导入服务 > 失败注入：重放中途抛错 → 原库三件套逐字节还原 + rolledBack 标记
      Tests  1 failed | 23 passed (24)
```

即：关掉还原后「半截库」字节留在原地 → 断言红；还原在位才绿（不是恒真断言）。

门禁原始输出：

```
$ pnpm typecheck
Scope: 9 of 10 workspace projects
packages/core typecheck: Done      packages/platform typecheck: Done
packages/ui typecheck: Done        packages/dbview typecheck: Done
packages/editor typecheck: Done    packages/schema typecheck: Done
packages/sync typecheck: Done      packages/importer typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
（9/9，0 error）
```

```
$ pnpm --filter @septcats/desktop test
 ✓ test/perf.test.ts (4 tests) 28452ms
   ✓ …冷进程打开 1 万页真库 → 第一次搜索 ≤150ms  328ms
   ✓ …1 万字页 200 块 commitOps batch 落库 P95 ≤16ms  334ms
   ✓ …1 万页账本 rebuildFromSegments 全量重建 <5000ms  1707ms

 Test Files  106 passed (106)
      Tests  1185 passed (1185)
   Start at  14:38:25
   Duration  29.31s
```

基线对比（合入时报告记载基线 → 现在）：desktop **1161 → 1185（+24）** · editor **270 → 270** ·
importer **99 → 99** · ui **168 → 168** · sync **109 → 109** · core **51 → 51**（只增不减）。

```
$ cd packages/editor  && npx vitest run →  Test Files 15 passed (15)   Tests 270 passed (270)
$ cd packages/ui      && npx vitest run →  Test Files 33 passed (33)   Tests 168 passed (168)
$ cd packages/importer&& npx vitest run →  Test Files  5 passed (5)    Tests  99 passed (99)
$ cd packages/sync    && npx vitest run →  Test Files 11 passed (11)   Tests 109 passed (109)
$ cd packages/core    && npx vitest run →  Test Files  9 passed (9)    Tests  51 passed (51)
```

其它：no-magic ✓（新增量全部命名常量或常量声明）；未建表、未加依赖（fflate 已在 desktop 依赖里）；
启动零外联；未动 T80-01 导出面与 T82-01 已收口的 rebuild 面；跑测前已
`node apps/desktop/scripts/ensure-abi.mjs node`（收尾再切回 electron，见 §5）。

## §4 DEVIATION 记录（请 PM 追认）

| # | 偏离/新增 | 理由 | 需 PM |
| -- | -- | -- | -- |
| D-1 | 换库**不重启 db 进程**：「新库」= `REBUILD_CLEAR_SQL` 后的新库态 + 就地重放；文件级备份/还原照 `migrations.tryFileLevelRestore` 先例（清 sidecar → 覆写字节） | 造第二套 close/reopen 通道会让 7 套服务持有的 executor 全部失效；重放本身是**单事务**，失败即 better-sqlite3 回滚，文件还原是双保险 | 追认 + 真机验收 |
| D-2 | 冲突预检从 PRD 的「目标库非空 → 拒」细化为「**本机存在包未覆盖的 op → 拒**」 | 判据若是「非空即拒」，同包重复导入（任务书 §幂等 硬要求）会被自己的预检拒掉，自相矛盾；细化后空库是覆盖度判据的平凡情形，语义统一 | 追认 |
| D-3 | 加密包双判据：`manifest.encrypted === true` **或** 包内含 `.enc` 条目 | T80-01 的清单里**没有** encrypted 字段（它直接拒导加密库），故导入侧补上条目面判据；未改写侧一字 | 追认 |
| D-4 | 新增 9 个结构化错误码（见 §1.2） | 半截 zip / 校验和 / 段数 / 备份 / 回滚 各有独立收场路径，混用会让 UI 无法区分「包坏了」与「库没动」 | 追认 |
| D-5 | 备份三件套含 `-wal` / `-shm`（checkpoint 后 -wal 为 0 字节仍备份），还原按「备份里没有这一件就删掉它」 | 「逐字节还原」必须可断言；只备份主库会在 -wal 残留时出现「新库 + 旧 wal」混写窗口 | 追认 |
| D-6 | execute 期间 `pauseSync/resumeSync`（既有 `SyncRuntime.stop()/start()`） | 同步运行时有 watcher + 60s 定时 + 攒段器，会并发写 op_ledger 与段目录；不停机则覆盖度预检与重放都可能被污染 | 追认 |
| D-7 | UI 成功反馈用既有 inline `settings-saved` 块（显示备份路径 + 「撤销导入」），**未新造 toast 基建** | 设置页没有 toast 通道；与导出侧「已保存到 <path>」同形，信息量等价 | 确认 |
| D-8 | dir 显式契约的导入侧解释：`zipPath` > `dir`（目录内取**最新** `septcats-portable-*.zip`，名字含时间戳故字典序即时间序）> 系统文件对话框（取消 `{canceled:true}`） | 原生对话框不可 CDP 驱动（T79 教训），须留一条可脚本驱动的显式路径 | 追认 |
| D-9 | 本机 `op_ledger` 行解不出 `op_id` 时按「未覆盖」计（安全侧拒导） | 解不出的行无法证明被包覆盖；宁可拒导，不可抹数据（H-04 同款取向） | 追认 |
| D-10 | 段清单为空的包**只 warning 不拒**（导入后库为空） | 与 T80-01 D-8（段空仍可导出）对称；且在覆盖度判据下，本机非空时这类包本就被拒 | 确认 |
| D-11 | 导入后**不**重建 `page_link_index`，也**不**重建 collabHub 内存 Y.Doc | 前者是 T82-01 §5-1 已登记的既有缺口（派生表不在清表清单，红线未改清单）；后者下次 `collab:attach` 会重新取种子 | 知悉（建议各立一单） |

## §5 遗留与观察项

1. **真机 CDP 未跑**（PM 探针）：建议顺序 = 设置页「导出便携包」产包 → 另起空数据根
   `--user-data-dir <tmp>` + `--import-portable <zip>` → IPC 读回页/块/附件逐条对 →
   设置页「导入便携包」二次导入（幂等）→ 「撤销导入」还原。
2. **文件级还原发生在 db 连接仍打开时**（D-1）：真机上重放失败路径极窄，但一旦发生，
   建议导入成功后重启应用再继续编辑；若要彻底消除该窗口，需另开单做「停库 → 换文件 → 重建服务」。
3. **`page_link_index` 导入后陈旧**（D-11）：建议后续单在重建事务尾部补 links 全量重建。
4. **快照不随包迁移**（T80-01 D-2）：包内只有段，CRDT 播种态与快照折叠态不在包里；
   若老板要「换机后协作历史零重算」，需回补快照入包并另定口径。
5. **收尾已执行** `node apps/desktop/scripts/ensure-abi.mjs electron`（把 better-sqlite3
   换回 Electron ABI；跑测期间临时切过 node，见 §3）。
6. 未碰 git（全程只 Write/Edit）。

## §5.5 PM 复跑与真机判定（PM 补，2026-09-25）
- 门禁复跑：typecheck 9/9 Done / desktop 1185（基线 1161+24 CB 新增）/ sync 109 / editor 270 / importer 99 / ui 168 / no-magic OK / ensure-abi electron OK。
- 真机探针 cdp-e2e-t80-02.mjs（19 断言，PM 修正 4 处探针侧后）：19 PASS / 2 FAIL（run-E）。
  - PASS 面：导出→plan→execute（显式 replace）三段式、备份在场、roundtrip、幂等二次、四道安全闸（半截/CHECKSUM/缺段/slip）、缺 confirm 拒、flush 后覆盖度 blocked、真实根 untouched。
  - FAIL 面=真缺陷（立案 T80-04）：H-09 revert 进程存活必 EBUSY 且失败留半成品（-wal/-shm 已删）→「撤销导入」按钮真实场景失效；H-08 覆盖度预检对未 flush op 盲区（run-A uncovered=0 vs run-B 2，时序窗口内可放行抹数据）。
- D-1~D-10 全部追认（与 T80-01 口径一致）；其中 D-1「不重启 db 进程」正是 H-09 根因——文件级还原的前提（连接已关）在 revert 路径不成立，修复走 close/reopen 既有通道。
- 探针侧修正记录：① 桥名 workspace.list→workspaces.list；② roundtrip 判据改页 id（pages.create 契约无 title、传了被静默忽略——rename op 才带标题）；③ 段标题断言先 JSON 反解（中文被 JSON 转义）；④ 夹具目录唯一化（上轮句柄锁 EBUSY）。
