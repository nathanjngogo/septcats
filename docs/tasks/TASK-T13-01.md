# TASK-T13-01 · M8b 同步运行时（apps/desktop main 侧 + 同步状态 UI）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T9 packages/sync（83 测试，引擎核心全绿）、T2 DbServer（op_ledger + commitOps + rebuildFromSegments）、T10 settings 通道。必读：docs/PROJECT_PLAN.md §3.2/3.3（D1/D2——本任务是它们的落地）、§6.3（同步文件夹布局）、§8.3（合并时序）、§9.3（S5/S7/S10 归本任务的纯逻辑/运行时面）；packages/sync/src 全部（**引擎零改动，只做接线**）；apps/desktop/src/db（op_ledger 表、rebuildFromSegments）；src/main/settings.ts 与 platform layout（rootPath=同步文件夹根）。
> 纪律：用 Write/Edit 落盘；每写完一个测试文件立即 `pnpm -C apps/desktop test` 该文件，绝不交没跑过的测试；不碰 git；禁占位符。**packages/sync 已合入文件不许改**（契约缺口写报告未决项）。

## 0. 范围裁决（PM 已定）
1. **同步文件夹 = `layout.root/sync/`**（用户在网盘客户端里把这个目录设为同步目标；应用不碰网络）。段文件命名/布局完全按 §6.3 与 sync 包既定实现（seg-*.jsonl、manifest.json、snapshots/、quarantine/）。
2. 引擎复用面（一个都不许重写）：`NodeFs`（fs.ts 已有）包 sync 目录；`SegmentBuilder`+`publishSegment`（攒段发布）；`mergeRemote`（收段合并）；`manifest` 读写合并；`snapshot` 折叠；`gc` 清理计划；`provider.ts` 的 InProcessProvider 换 **FsWatchProvider**（SyncProvider 的 fs 实现：listSegments=NodeFs.list、watch=fs.watch 去抖 2s、probe=目录存在性+最后 mtime）。
3. **一期默认明文**；加密=设置里开关，开启时 DEK（32B 随机）经 DPAPI 包裹存 `credentials/`，段/快照写盘 `.enc`（AES-256-GCM，naming 已识别后缀）、读时解；**换钥匙/DEK 丢失 → 明确 E_SYNC_KEY_MISMATCH 红条提示而非静默**（S10 运行时面；恢复码 UI 一期不做，报告注明）。
4. 设备身份 = meta.device_id 派生 actorId（pages.ts 已有 deriveActorId）；`--user-data-dir` 双实例即"两台设备"，runtime 不得依赖任何进程内全局。

## 1. 模块（apps/desktop/src/main/sync/）
```
runtime.ts   SyncRuntime：起停（provider 轮询 + watcher 双触发）、攒段订阅（commitOps 成功后把
             新 op 入 SegmentBuilder，达 WritePolicy 或 15s 定时 flush 发布）、每 60s 全量
             mergeRemote、manifest 心跳（水位更新+mergeManifest 回写）、快照折叠（段数>maxKeep）、
             gc 计划执行（只删 quarantine/ 与被全设备水位越过的过期段，dry-run 默认+设置开启）
bridge.ts    commitOps↔runtime 钩子：executor 层包一层 onCommitted(ops)（**不改动 commit.ts**，
             在 registerSync 处装饰 BatchExecutor）
ipc.ts       通道（shared/ipc.ts 补常量）：sync:status → {state,lastSyncAt,devices,pendingSegs,
             errors[]}；sync:setEnabled {on}；sync:now → 立即跑一轮；sync:state 推流（低频事件）
keyring.ts   DEK 生命周期（生成/DPAPI 包裹读回/轮换），复用 platform/credentials.ts 的 store
crypto.ts    encodeSegment→JSON→AES-GCM→bytes / 逆向；AAD=文件名；IV 随机前置
```

## 2. 关键时序（§8.3 的运行时实现，逐条有测试）
- 启动：读 manifest → 全量 mergeRemote（S5 纯逻辑面：**新设备只有 snapshot+段 → 追平后投影与源设备逐 op 相等**，用两 runtime 实例共享 temp 目录断言）→ rebuildFromSegments 校验一致（不一致=以合并后账本重建 SQLite，log E_PROJECTION_REBUILT 不崩）。
- 写入：commitOps→onCommitted→builder→publishSegment（ifAbsent 幂等，S3 副本由 mergeRemote 消化——引擎已测，运行时只测"发出去的文件名符合 naming"）。
- 收：watch 触发→去抖 2s→mergeRemote→新 op 落 op_ledger（**复用 core 幂等：已在账本的 op 跳过**）→投影增量 apply。
- 崩溃恢复：写段中途 kill → 重启 mergeRemote 把半截段隔离（S2 引擎已测，运行时测"重启后自愈且不再重试该文件"）。
- 断链：sync/ 目录被移走 → probe 失败 → state=degraded + 本地写入照常（S7：不丢数据，红条=UI 消费 state）。

## 3. UI（对齐 mockup 07，§16 全量适用）
- 顶栏「● 已同步」按钮改接 sync:status：idle/syncing(转圈)/ok(绿点+相对时间)/degraded(橙+「同步文件夹不可访问」)/error(红)+点击弹面板：设备列表(actorId+水位)、待发段数、最近错误、手动「立即同步」、加密开关（进 settings）。
- 全部新文案进 i18n zh-CN；CSS 只 var(--sc-*)。

## 4. 测试底线（test/sync-runtime.test.ts + keyring/crypto 单测）
- **双 runtime 集成**（同一 temp sync 目录，两个独立 MemoryDb+各自 actor）：A 建 5 页→B 收到 5 页投影逐字段相等；B 并发改同块→A/B 收敛同值+conflict 报告各 1；副本注入（手工复制 seg (1).jsonl）→去重；断链→恢复→追平。
- crypto roundtrip：明文==解密结果；AAD 篡改→解密拒；DEK 错→E_SYNC_KEY_MISMATCH（不 panic）。
- keyring：DPAPI 往返（真后端 skipIf 探测，与 credentials 测试同范式）。
- ipc 状态机：setEnabled 后轮询起停（fake timers）；publishSegment 名符合 naming.segmentFileName。
- UI：sync 面板四态渲染（vi.mock window.septcats.sync）。
- 存量全绿不许破；packages/sync 83 条一字不动。

## 5. DoD
```
pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告 docs/tasks/TASK-T13-01-report.md：时序实现对照 §2 清单 + SSIM-NOTE（07 屏）+ DEVIATIONS + 未决项（恢复码 UI 等）。
双实例真机验收由 PM 组织（两个 --user-data-dir 起两个打包实例），不在本任务内。
