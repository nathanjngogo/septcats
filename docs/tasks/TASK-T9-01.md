# TASK-T9-01 · M8a 同步引擎核心（packages/sync，纯逻辑零 IO 副作用）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T6（页面树）已合入。必读：docs/PROJECT_PLAN.md §3（D2/D3 两条架构决策，**本任务的存在理由**）、§6.3（同步文件夹布局）、§8.3（合并时序）、§9.3（故障注入矩阵 S1–S10）；packages/core/src/segment.ts（Segment 编解码/自校验，**复用禁止重写**）；docs/schema-v1.md §5。
> 纪律：用 Write/Edit 落盘全部交付物；可以且必须跑 `pnpm -C packages/sync test` 验证自己写的每个测试（绝不交没跑过的测试），不碰 git；禁占位符。**本包必须能在纯 Node + 内存假 fs 下跑全部测试**（真网盘/真双机由 PM 真机做）。

## 0. 铁律（违反=打回）
1. **不碰网络、不碰 electron、不碰 better-sqlite3**。唯一 IO 抽象 = `SyncFs` 接口（§2）。所有 fs 访问经注入，测试用 `MemoryFs`。
2. **段是不可变的**：写出后永不改写；去重靠内容 hash 与 op_id 幂等，绝不"读回来改"。
3. **删除永远先写 tombstone**，retention（默认 30 天）未越过前不得物理清除（计划书 §6.3）。
4. 时钟只用 Lamport；墙上时间 `at` 仅作展示与 retention 计算的辅助，**绝不参与排序判定**。

## 1. 包结构
```
packages/sync/
  package.json            # deps: @septcats/core；无其它
  tsconfig.json vitest.config.ts
  src/
    index.ts
    fs.ts                 # SyncFs 接口 + MemoryFs（测试用，支持注入故障）+ NodeFs（薄封装，导出但本任务不测）
    provider.ts           # SyncProvider 接口（§3）
    naming.ts             # 段文件名 <-> Segment 双向：生成/解析/规范化（含网盘副本 xxx (1).jsonl 识别）
    writer.ts             # 攒段：EditSession 产出的 op -> Segment 边界与原子写
    manifest.ts           # manifest.json 读写：设备表/水位/快照号/retention/salt_hint（zod 校验 + 版本协商）
    merger.ts             # 核心：远端段集合 + 本地账 -> 新段列表 + 合并报告（S1/S2/S3/S4/S9 全在这）
    snapshot.ts           # 快照生成：折叠旧段 -> snapshot-N.json + 保留集计算（S6）
    gc.ts                 # 保留窗口与清理计划（只产出"可删清单"，真删由 runtime 决定；S9）
    dedupe.ts             # 内容寻址附件索引：sha256 -> 路径；网盘副本去重
    errors.ts             # 稳定错误码（E_*），merge 报告结构 SyncReport
    quarantine.ts         # 坏段隔离清单生成（搬入 quarantine/ 的语义在 runtime，这里只算）
  test/
    naming.test.ts writer.test.ts manifest.test.ts merger.test.ts snapshot.test.ts gc.test.ts dedupe.test.ts
    fault.test.ts        # S1-S4, S6, S8, S9 的内存级复现（S5/S7/S10 属 runtime，PM 真机）
    fixtures/            # 手写段样例：正常/乱序/半截/超schema_ver/重复副本
```

## 2. SyncFs（唯一 IO 面）
```ts
export interface SyncFs {
  list(dir: string): Promise<string[]>                       // 仅文件名，不递归
  read(path: string): Promise<string>                        // UTF-8 文本
  write(path: string, content: string, opts?: { ifAbsent?: boolean }): Promise<void>  // ifAbsent=true 时存在即 SkipError（幂等关键）
  exists(path: string): Promise<boolean>
  size(path: string): Promise<number>
  remove(path: string): Promise<void>                        // 幂等（不存在不抛）
}
export class MemoryFs implements SyncFs { /* 支持 injectFailure: 'halfwrite'|'duplicate'|(op)=>void，供 fault 测试 */ }
```

## 3. SyncProvider（本任务只定义接口 + 一个 InProcessProvider 测试实现）
```ts
export interface SyncProvider {
  readonly name: string
  init(rootDir: string): Promise<void>
  listSegments(): Promise<Array<{ file: string; bytes: number }>>
  listSnapshots(): Promise<Array<{ file: string; bytes: number }>>
  listFiles(prefix: string): Promise<Array<{ file: string; bytes: number }>>
  get(file: string): Promise<string | null>                  // 不存在 -> null（不抛）
  put(file: string, content: string): Promise<'written' | 'existed'>  // 幂等 ifAbsent
  putBinary?(file: string, srcAbsPath: string, onProgress?: (done: number, total: number) => void): Promise<'written'|'existed'>
  watch(onChange: () => void): () => void                    // 去抖由调用方管
  probe(): Promise<{ ok: boolean; lastWriteSeenAt: number | null; reason?: string }>  // 「文件夹 14 分钟无写入」告警的数据源
}
```
真实 provider（Quark/Baidu = 指向本地同步目录 + FSWatcher）**归 T10**，本任务只要接口冻结 + InProcessProvider（包装 MemoryFs）。

## 4. 关键契约（签名级，PM 逐条测）
```ts
// naming.ts
export function segmentFileName(seg: Segment): string                 // 'seg-<c_from:8hex>-<dev>-<n:6hex>.jsonl'
export function parseSegmentFileName(name: string): { cFrom: number; dev: string; n: number; copySuffix: number; encrypted: boolean } | null
export function isSidecarCopy(name: string): boolean                  // 识别 'x.jsonl (1)' / 'x (2).jsonl' 网盘副本
export function contentFingerprint(text: string): string              // sha256 hex（node:crypto 可用；MemoryFs 测试同源）

// writer.ts —— 攒段
export interface WritePolicy { maxOps: number; maxBytes: number; maxLamportSpan: number }  // 默认 500 / 256*1024 / 1000
export class SegmentBuilder {
  constructor(dev: ActorId, policy?: WritePolicy)
  add(op: Op): void
  shouldFlush(atMs: number, idleMs: number): boolean                  // 条数/字节/时钟跨度/空闲四触发
  flush(): Segment | null                                             // 空则 null；产出即自校验（core.validateSegment）
  get pendingCount(): number
}
export async function publishSegment(fs: SyncFs, providerPrefix: string, seg: Segment): Promise<'written'|'existed'>
// 原子：先写 seg 名，ifAbsent=true；已存在=内容重复→'existed'（幂等，S3）

// manifest.ts
export interface Manifest {
  schema_ver: number; created_at: number; updated_at: number
  devices: Record<ActorId, { last_lamport: number; last_seen_at: number; client_ver: string }>
  snapshot: { seq: number; lamport: number; covers_through: number }   // covers_through = 已折叠的最大 lamport
  retention_days: number
  segment_watermark: number                                            // 本目录已见最大 lamport
}
export function decodeManifest(text: string): Manifest | null          // 非法 -> null（调用方决定降级）
export function mergeManifest(local: Manifest, remote: Manifest): Manifest  // 设备表并集、水位取 max、schema_ver 取 min（保守）；冲突不丢设备

// merger.ts —— 心脏
export interface MergeInput {
  provider: SyncProvider
  localLedger: Op[]                        // 本地已应用（op_ledger 导出）
  seenContentHashes: Set<string>           // 去重记忆（段文件 sha256）
  now: number
}
export interface SyncReport {
  pulled: number; applied: Op[]; skipped: { file: string; reason: 'duplicate'|'already-applied'|'empty' }[]
  quarantined: { file: string; reason: string }[]     // 半截/超版本/校验失败 -> 隔离，绝不污染库（S2）
  conflicts: ReplayConflict[]                          // 交 core.replay 产出，UI 用（S1）
  highWatermark: number; needsSnapshot: boolean
}
export async function mergeRemote(input: MergeInput): Promise<SyncReport>
// 规则：
//  a) 先 listSnapshots 取最新合法快照 -> 播种基线；再只拉 covers_through 之后的段（S5 新设备追平）
//  b) 段解析失败/schema_ver 过高 -> quarantined（不 throw，不中断整轮）
//  c) 段内容 hash 命中 seenContentHashes -> skipped.duplicate（S3 副本）
//  d) 全部合法段 + localLedger 交 core.replay -> 只回写「本地没有的 op_id」到 applied（幂等）
//  e) 顺序无关性：实现里不得依赖 list() 的顺序（内部统一 sort by (c_from, dev, n)）

// snapshot.ts
export function planSnapshot(allSegs: Segment[], current: Manifest, maxKeepSegs: number): { through: number; foldSegIds: string[] } | null
// 折叠条件：retention 已过 或 段数 > maxKeepSegs；through 必须是某段的 c_to（不得切在段中间）
export function buildSnapshotText(segments: Segment[], through: number, dev: ActorId): string
export async function publishSnapshot(fs: SyncFs, prefix: string, seq: number, text: string): Promise<'written'|'existed'>  // 幂等（S6）

// gc.ts
export function planCleanup(manifest: Manifest, segs: Array<{file:string; cTo:number; dev:ActorId}>, knownDeviceWatermarks: Map<ActorId,number>, now: number): string[]
// 双重门：retention 已过 **且** 所有已知设备水位越过；未知/掉线设备按 last_seen_at+宽限期（7天）保守不放行

// dedupe.ts
export function buildFileIndex(files: Array<{file:string; sha?:string}>): { byHash: Map<string,string[]>; duplicates: string[] }
```

## 5. 测试底线（fault.test.ts = 计划书 §9.3 的内存复现）
- **S1 双端并发改同块**：两设备各产一段（同 target，lamport 38/41）→ merge → 高版胜出、`report.conflicts` 恰 1 条含 lost/kept。
- **S2 半截文件**：MemoryFs injectFailure 写截断 → quarantined 1 条，`applied` 不含该段任何 op，其余段正常应用，**不抛**。
- **S3 网盘副本**：`seg-x.jsonl` 与 `seg-x (1).jsonl` 同内容 → 第二轮 skipped.duplicate；不同内容同名前缀 → 两段都收。
- **S4 时钟回拨**：B 设备 `at` 比 A 早 1 年 → 合并结果与 S1 同（判定只看 lamport），断言两次 merge 结果 snapshot 相等。
- **S5 新设备**：空目录只有 snapshot-18 + 2 段 → 追平后与老设备投影全等（用 core.opsToSnapshot 比字符串）。
- **S6 快照崩溃**：publishSnapshot 写一半异常 → 重跑幂等（'existed'），水位不乱。
- **S8 双端同删**：两设备各发同 target 的 delete（不同 lamport）→ 收敛为 alive=0 且无冲突告警（幂等）。
- **S9 提前删段**：retention 未过或某设备水位未越过 → planCleanup 不放行；全过才放行。
- **收敛性总测**：随机 4 设备各 30 op，4 种段切分方式（每 op 一段/全部一段/随机切/按 target 切）分别合并 → 最终投影逐字节相等。**这条是同步正确性的数学保证，必须过。**
- manifest 损坏（截断/非法 JSON/未来 schema_ver）→ decodeManifest null 且 merger 降级为"只用现有段"不崩。

## 6. 明确不做（T10）
真实 provider、加密（§8.7）、附件流式上传、调度器、UI、双机真机、watch/probe 的 fs 实现。

## 7. DoD（PM 复跑）
```
pnpm install && pnpm -r typecheck && pnpm -r test
grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"    # 只允许 fs.ts 一处 import node:fs
grep -c "it(" packages/sync/test/*.test.ts | awk -F: '{s+=$2} END {print s}'        # ≥ 45
```
报告格式同前。先复述你对 D2「为什么不能同步 SQLite 文件」的理解（≤5 行）再动笔——这是本包存在的理由，答不对就别写。
