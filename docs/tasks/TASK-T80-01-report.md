# T80-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T80-01.md` · PRD：`docs/PRD-R28-便携包.md`
> 落盘方式：只 Write/Edit，未碰 git（无 commit/reset/checkout）。基线 `main 761fbd9`。

## §0 开工侦察结论（四问）

### ① 段重放入口与导出段清单对齐

**入口与调用链**（逐行核过）：

- RPC：`db/rpc.ts:68` `{ t:'rebuildFromSegments', segmentsJson }` → `db/server.ts:570`
  → `parseSegments()`（`server.ts:411`）→ **`Segment[]` 对象数组**（不是段文件原文！
  逐段 `core.validateSegment` + 逐 op `opSchema.safeParse`，非法即 `E_BAD_PARAMS`）。
- 事务体（`server.ts:586`）：`fts_defer.flag=1` → `REBUILD_CLEAR_SQL`（`server.ts:118`，
  依次清 `page_block_fts / record / block / collection / page / op_ledger`）→ 逐 op
  `opLedger.insert`（带 `seg_id` 回填）→ `applyEntity` 物化（`TABLE_INSERT_ORDER`：
  page→collection→record→block）→ `FTS_RESYNC_SQL` → `flag=0`。
- 谁在调：`SyncRuntime.verifyLedgerIntegrity`（`main/sync/runtime.ts:1112`，ledger 计数
  与合并后 op 数不一致的自愈路径）→ `collectSegments()`（`runtime.ts:1132`：`provider.
  listSegments()` → `provider.get(file)` → `decodeSegment`）。

**本单对齐结论（导入侧逐字节可直接复用）**：

| 项 | 本单口径 |
| --- | --- |
| 段条目名 | `sync/<seg 文件名>`，文件名须 `parseSegmentFileName() !== null`（含网盘副本 ` (1)`；`.enc` 密文段排除） |
| 段内容 | **磁盘原文**（`encodeSegment` 产出的 jsonl），导入侧 `decodeSegment` 后 `JSON.stringify(Segment[])` 喂 `rebuildFromSegments` |
| 快照 | `sync/snapshot-NNNNNN.json` **不入包**（不在 rebuild 输入里，只服务 CRDT 播种 `seedFromSnapshot`）→ 写进 `excluded` |
| 同步 manifest | `sync/manifest.json` **不入包**（设备水位/心跳，非账本）→ 写进 `excluded` |
| 坏段隔离 | `sync/quarantine/` 不入包（`runtime.ts:1097` 产生） |

副作用：包内段集合 == `listSegments()` 集合，导入侧「全段重放」= 对干净库跑一次
`rebuildFromSegments`，不造第二套重建逻辑（PRD §0.4 意图落地）。

### ② 未 flush 本地写的封段选择（含实证与取舍）

**未 flush 的写在哪**（三处实证）：

1. `commit` → `withSyncHook`（`main/index.ts:427`）→ `runtime.onLocalCommit` →
   `SegmentBuilder.add`（**内存缓冲**，`runtime.ts:265` 的 `pendingOps` 就是它）；
2. 已落 `op_ledger` 但 `seg_id` 尚未回填的行（回填在 `markOpsPublished`，`runtime.ts:463`）；
3. 发布失败的段暂存 `runtime.pendingPublish`（`runtime.ts:457`，下轮重试）。

刷段时机（`runtime.ts:400-418`）：条数/字节/时钟跨度三硬条件立即 `flushAndPublish()`，
否则排 15s 空闲 flush。**→ 导出时刻盘上段目录可能缺最近 ≤15s 的改动。**

**本单选择**（`D-3`）：

- confirm 里调 **`SyncRuntime.flushAndPublish()`**（既有 public 方法，`runtime.ts:435`）：
  把已落账 op 封成段文件 + 回填 `seg_id`。**零新增 op**（不造 op、不改 op 语义、不建表），
  红线「op-log 零新增」按此口径满足——它走的是同步既有发布路径，不是导出自造重建逻辑。
- 封段后 `getStatus().pendingOps > 0`（发布失败）→ **硬闸 `E_PORTABLE_PENDING_UNSEALED`**，
  不静默丢数据（段是导入侧真相）。
- **preview 不封段**（保持预览零副作用，`D-4`）；checkpoint 也只在 confirm 做。
- `syncRuntime === null`（同步未启用/启动失败）→ 视为 0（无攒段器即无未封段 op），
  段清单可能为空 → 走 warning + 主库兜底（`D-8`）。

### ③ attachments 真相目录与排除规则先例

- **真相 = `<root>/attachments`**：`packages/platform/src/layout.ts:56`（`layoutFromRoot`
  唯一拼接点）；R27 页面导出用的就是它（`main/index.ts:483/527` → `attachmentsDir:
  ctx.layout.attachments`，`main/pageExport.ts:275` 读它）。
- **`attachment/` 单数不存在**：全仓唯一同名物是 `main/assets.ts:18` 的
  `ATTACHMENT_SCHEME = 'attachment'`（私有协议 scheme，非目录）。PRD §0.2 的
  `attachments/` 即真相无误。
- **排除先例**：`*.db.bak-*` 由 `db/migrations.ts:395` 产出（`${dbPath}.bak-v${from}`），
  且**同函数第一行就是 `db.pragma('wal_checkpoint(TRUNCATE)')`（`migrations.ts:391`）**——
  正是本单 checkpoint 前置的先例出处；`logs/ tmp/ crashDumps/` 见 `layout.ts:51-61`；
  `sync/quarantine/` 见 `runtime.ts:1097`。

### ④ fflate zipSync 限制与 STORED/DEFLATE 取舍

- 版本 **0.8.2**（`apps/desktop/package.json:35`，零新增依赖）；读侧先例
  `main/importer.ts:27` `unzipSync` + `importer.ts:111` `entryNameSafe`（zip slip 三查）。
- **写侧只写 32 位**：`esm/index.mjs:2278` `zipSync` → `wzh`/`wzf` 全走 `b4()`，
  **zip64 只在读侧解析**（`1839/2571/2651` 行的 `== 4294967295` 判定）。
  → **单条目或归档总量 ≥ 4 GiB 会被静默截断成坏包**；另条目名 > 65535 字节 `err(11)`。
  **本单处理**：`assertZip32Size()` 前置硬闸（单条目 + 总字节，越界 `E_TOO_LARGE`），
  把 PRD「>2GB 附件 v1 显性不做分卷」落成确定性拒绝而非坏包。
- **压缩档选择**（`zipSync` 第 2292 行 `p.level == 0 ? 0 : 8` → level 0 = STORED）：
  附件（PNG/JPEG/WEBP/MP4/PDF/zip/woff 等已内嵌压缩）→ **level 0 STORED**（二次 deflate
  收益≈0 且白耗 CPU、还更慢）；清单 / 主库 / 段（JSONL 文本与 sqlite 页，重复率高）
  → **默认 level 6 DEFLATE**。测试用 `unzipSync(..., {filter})` 取每条 `compression`
  硬断言：PNG=0、db/段=8。

## §1 写侧工具

- `packages/sync/src/portableZip.ts`（**新增，纯逻辑**：不 import electron / fflate /
  node:fs；sha256 走 `node:crypto`，与 `naming.ts` 同源）：
  - `PORTABLE_FORMAT='septcats-portable'` / `PORTABLE_FORMAT_VERSION=1` /
    `PORTABLE_MANIFEST_NAME='manifest-portable.json'` / `PORTABLE_DB_ENTRY='septcats.db'` /
    `PORTABLE_SYNC_PREFIX='sync'` / `PORTABLE_ATTACHMENT_PREFIX='attachments'` /
    `PORTABLE_EXCLUDED`（7 条）/ `ZIP32_MAX_BYTES=0xffffffff` /
    `DEFLATE_LEVEL=6` / `STORED_LEVEL=0`；
  - `portableEntryNameSafe()`（importer 同口径 + 收紧反斜杠/盘符/NUL，`D-10`）、
    `assertPortableEntryName()`（`E_ENTRY_NAME`）、`portableSegmentEntry()` /
    `portableAttachmentEntry()`、`storedOf()`、`sha256Hex()`、`portableEntryMeta()`、
    `assertZip32Size()`（`E_TOO_LARGE`）、`buildPortableManifest()` / `encodePortableManifest()`、
    `portableSlug()` / `portableStamp()` / `portableArchiveBase()` / `uniquePortableArchiveName()`
    （同名 `-2 -3`，绝不覆盖）；
- `packages/sync/src/index.ts`：`export * from './portableZip'`（仅加一行）。
- zip 容器组装（fflate）与 fs 落盘**只住 desktop**（`main/portable.ts`），packages 侧保持纯。

## §2 IPC 契约与 UI

- `apps/desktop/src/shared/portable.ts`（**新增**，纯类型契约，照 `shared/pageExport.ts` 形状）：
  `PortableExportInput{dir?}` / `PortableExportFilePreview{relPath,kind,bytes}` /
  `PortableExportPreview{fileName,files,counts{segments,attachments,db,entries},totalBytes,warnings}` /
  `PortableExportConfirmResult{...preview,canceled:false,path,dir,renamed}` /
  `PortableExportCanceled{canceled:true}`。
- `shared/ipc.ts`：`CHANNEL_PORTABLE_EXPORT_PREVIEW='portable:export:preview'`、
  `CHANNEL_PORTABLE_EXPORT_CONFIRM='portable:export:confirm'`（+ `PORTABLE_EXPORT_CHANNELS`）。
- `main/portable.ts`（**新增**）：`createPortableExportService` + `registerPortableExportIpc`
  + `PortableExportIo`（DI，可 node 直测）+ `nodePortableExportIo`。
  **confirm 语句序固定**：加密闸 → `checkpoint()` → `sealSegments()` → 读字节 →
  `zipSync` → `mkdir` → `uniquePortableArchiveName` → 写 `.tmp` → `rename`。
  错误码：`E_MALFORMED / E_INVARIANT / E_PORTABLE_ENCRYPTED_UNSUPPORTED /
  E_PORTABLE_PENDING_UNSEALED / E_TOO_LARGE / E_ENTRY_NAME`。
- db 层（`D-6`，纯加法）：`rpc.ts` 加 `t:'checkpoint'` + `CheckpointData` + 请求类型集合；
  `server.ts` 加 case（`current.pragma('wal_checkpoint(TRUNCATE)')`，非 WAL 返回全 0 不失败）；
  `client.ts` 加 `checkpoint()`。
- `main/index.ts`：Services 加 `portable`；接线 `dbPath/syncDir/attachmentsDir/libraryName
  (活动工作区名)/appVersion/schemaVersion(handle.migrate().to)/checkpoint(handle.checkpoint)/
  sealSegments(runtime.flushAndPublish + pendingOps)/encrypted(settings.sync.encrypt)/
  pickDirectory(默认 `<数据根>/export`)`；注册 `registerPortableExportIpc`。
- preload + `types/window.d.ts`：`window.septcats.portable.preview/confirm`。
- UI：设置页「数据与隐私」区新增「导出便携包」行 → 预览块（条目清单 + 条目数/总字节
  + warning）→ 「取消 / 确认保存」；复用既有 `.settings-*` 类与 `Button/Dialog` 骨架，
  全部文案走 i18n（`settings.privacy.portable.*`，zh/en 双份），**无「数据库」字样**
  （门禁⑥），无 CJK 字面量（门禁⑤）。

## §3 测试与门禁

新增 `apps/desktop/test/portable-export.test.ts`（18 用例）：

```
 ✓ test/portable-export.test.ts (18 tests) 26ms
 Test Files  1 passed (1)      Tests  18 passed (18)
```

覆盖：条目名安全 8 断言 / 不安全名 → `E_ENTRY_NAME` / STORED 选择 / ZIP32 硬闸 /
manifest（checksums+排除清单+库名版本 schema）/ 归档名与序号 /
**preview 零落盘** / **zip roundtrip（中文+空格条目名逐字节一致，unzipSync 读回）** /
**STORED 断言（compression 0 vs 8）** / **checksums 逐条对** / **zip slip 拒绝（零落盘）** /
**checkpoint 语句序（checkpoint→seal→read，checkpoint 为第 0 条）** / **取消 = 零落盘**
（且取消发生在 checkpoint 之前）/ **原子写 .tmp→rename + 同名 `-2` 不覆盖** /
**加密库硬闸** / **未封段残留硬闸** / 段清单为空 warning / IPC `service=null` → `E_INVARIANT`。

门禁原始输出：

```
$ pnpm typecheck
Scope: 9 of 10 workspace projects
packages/core typecheck: Done      packages/platform typecheck: Done
packages/ui typecheck: Done        packages/dbview typecheck: Done
packages/editor typecheck: Done    packages/schema typecheck: Done
packages/sync typecheck: Done      packages/importer typecheck: Done
apps/desktop typecheck: Done
（9/9，0 error）
```

```
$ cd apps/desktop && npx vitest run
 Test Files  105 passed (105)
      Tests  1158 passed (1158)          # 基线 1140 → 1158（+18）
```

```
$ cd packages/editor  && npx vitest run →  Test Files 15 passed (15)  Tests 270 passed (270)   # 基线 270
$ cd packages/ui      && npx vitest run →  Test Files 33 passed (33)  Tests 168 passed (168)   # 基线 168
$ cd packages/importer&& npx vitest run →  Test Files  5 passed (5)   Tests  99 passed (99)    # 基线  99
$ cd packages/sync    && npx vitest run →  Test Files 11 passed (11)  Tests 109 passed (109)
$ cd packages/core    && npx vitest run →  Test Files  9 passed (9)   Tests  51 passed (51)
```

```
$ npx vitest run            # 根聚合（projects 模式，cwd=仓库根）
 Test Files  2 failed | 165 passed (167)
      Tests  2 failed | 1691 passed | 1 skipped (1694)
 FAIL  @septcats/desktop test/page-width.test.tsx > 静态 CSS 契约 …
 FAIL  @septcats/desktop test/tabs.test.tsx > 溢出横向滚动不换行（静态样式契约）
```

两红均为**既有 cwd 依赖**用例（读 `process.cwd()/src/renderer/...`，根聚合时 cwd=仓库根
→ ENOENT），**与本单无关**：在 `apps/desktop` 目录下跑 105 文件 1158 用例全绿（含这两
个文件）。根聚合另有一红（i18n 门禁⑤：模板串里的中文全角冒号）已修，现仅剩上述两红。

其它：no-magic ✓（新增常量全部命名，`1024/0xffffffff/0/6/60/2/1000` 均有名或直接是
常量声明）；未建表、未加依赖（fflate 已在 `apps/desktop` 依赖里）、启动零外联（本单无
网络调用）、未动 `serialize.ts` 与 pageExport 已收口逻辑、无省略号占位。

## §4 DEVIATION 记录（请 PM 追认）

- **D-1 主库 `septcats.db` 入包**。PRD §1 条目清单只写「manifest + 全部段 + attachments/」，
  但同节前置句明写「打包对象 = checkpoint 后的主库 + sync 段 + attachments」，且 checkpoint
  前置**只对主库入包有意义**；另「从未启用同步」的用户段清单为空，主库是唯一兜底。
- **D-2 `sync/manifest.json` 与 `sync/snapshot-*.json` 不入包**（rebuild 输入只吃
  `seg-*.jsonl`；快照只服务 CRDT 播种）。若 T80b 要保 CRDT 态，需回补并另定口径。
- **D-3 封段复用 `runtime.flushAndPublish()`**（既有 public 方法）。这是导出路径上唯一的
  「包外写」：写同步目录 + 回填 `op_ledger.seg_id`；零新增 op。红线「op-log 零新增」
  按「不造新 op / 不改 op 语义」解释。
- **D-4 preview 不触发 checkpoint**（保持预览零副作用），checkpoint 在 confirm 第一步。
- **D-5 缺 `dir` 时走系统目录选择，默认 `<数据根>/export`**；取消回 `{canceled:true}`
  且零落盘（PRD 的固定产物路径落为对话框默认路径，非硬编码落盘）。
- **D-6 新增 db RPC `t:'checkpoint'`**（rpc/server/client 三处纯加法，不动语句白名单）。
- **D-7 新增错误码 `E_PORTABLE_PENDING_UNSEALED`**（封段后仍有未入段 op → 拒导，防静默丢数据）。
- **D-8 段清单为空不拒导**（仅 warning + 主库兜底），避免「未启用同步」用户完全导不出。
- **D-9 未生成 README 条目**：排除清单改由 `manifest.excluded` + 设置页预览承载
  （受 CJK 字面量门禁与 i18n 面约束，信息等价）。
- **D-10 条目名防护比 importer 的 `entryNameSafe` 多收紧两处**（反斜杠、Windows 盘符）。
- **D-11 `portableSlug` 截断 60 字**（pageExport 的 `sanitizeFileName` 是 120）。

## §5 遗留与观察项

1. **T80b 未做**：导入侧重放、验签（checksums）、冲突预检、半截包拒导、换库三段式与回滚。
   包格式已按「导入侧可直接 `decodeSegment` → `rebuildFromSegments`」对齐（§0-①）。
2. **真机 CDP 未跑**（本单 UI 只加一行 + 预览块，未改既有交互路径）：建议 PM 探针顺序 =
   设置页「导出便携包」→ 预览条目数 → 确认（目录选择）→ zip 逐条目清点 → `unzip -l` 看
   中文条目名 → T80b 就位后回灌导入。
3. **加密库路径**只做到「拒导 + 文案」；若老板要「加密库也能出门」，需另设计跨机密钥方案
   （DEK 走 DPAPI 机器绑定，见 PRD §0.5）。
4. 未封段硬闸的真实触发面很窄（同步发布失败时），真机若遇到「导出被拒」多半是同步异常，
   红条口径建议后续与同步错误面板统一。
5. >4 GiB 单附件目前是硬拒（无分卷）；老板真机若逼近该量级，需回补分卷或改走目录形态。
