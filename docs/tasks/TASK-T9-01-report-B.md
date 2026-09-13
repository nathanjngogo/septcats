# TASK-T9-01 交付报告 · B 阶段（manifest + merger + 出口补全）

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**B 阶段全绿（sync 包 test 45 例 + typecheck 干净）**
> 范围：仅 B 阶段（manifest.ts / merger.ts / index.ts 出口 + 必要支持文件 provider.ts）。
> A 阶段（errors/fs/naming/writer，28 例）已合入且未改动；C 阶段（快照/GC/去重模块/隔离模块/fault/convergence，S5–S10）**本会话一个未碰**。

## 0. D2 复述（写前，≤5 行）

SQLite 是二进制随机写文件，A/B 两台机器各改一次后两个 `.db` 分叉，网盘同步只能「整库二选一」，丢一侧全部改动（冲突副本也救不回）。因此真相层必须是 append-only 事件日志分段（JSONL，命名含 Lamport+设备 ID，永不重名/改写），SQLite 降级为「本机可重建的物化视图，绝不同步」。合并算法 = 集合并（新段落地就重放），无需三方合并/锁/联网协商。这就是 packages/sync 存在的理由，也是 B 阶段 merger 复用 core.replay（而非在 sync 另写冲突判定）的根因。

## 1. 交付物清单

### 1.1 `src/manifest.ts`（新增）
- `Manifest` / `ManifestDevice` 类型（§4 逐字段：schema_ver / created_at / updated_at / devices / snapshot{seq,lamport,covers_through} / retention_days / segment_watermark）。
- `encodeManifest(m)`：复用 `core.stableStringify`（键序稳定，「同内容同字节」）。
- `decodeManifest(text)`：非法一律返回 `null` 不抛（坏 JSON / 截断 / 缺字段 / 类型错 / 非法设备键 / **未来 schema_ver** 均 null）。
- `mergeManifest(local, remote)`：设备表**并集**、`last_lamport`/`last_seen_at`/`segment_watermark`/快照水位取 **max**、`schema_ver` 取 **min**（保守）、**冲突不丢设备**（并集键一个不落）。

### 1.2 `src/merger.ts`（新增）
- `MergeInput`（§4 签名：provider / localLedger / seenContentHashes / now）。
- `mergeRemote(input): Promise<SyncReport>`：
  - 远端文件索引 = byHash 内容去重 + duplicates（复用 §4 buildFileIndex 语义，不建 dedupe.ts 模块）；
  - 副本识别用 `naming.isSidecarCopy`（同内容组内非副本优先为规范文件）；
  - 半截段/坏段隔离：`decodeSegment` 失败 → `quarantined` 条目，**不抛、不中断整轮**（S2）；
  - `schema_ver` 过高 → `quarantined`（reason=`E_SCHEMA_TOO_NEW`，读段头首行判定）；
  - 乱序容忍：内部统一 sort by (c_from, dev, n)，不依赖 `list()` 顺序（§4 规则 e）；
  - 合并判定**复用 `core.replay`**（冲突直接取 replay 的 `report.conflicts`，sync 内零冲突判定代码）；
  - `applied` 只回写「本地没有的 op_id」（幂等）；`seenContentHashes` 追加已处理段 hash（跨轮去重记忆）。

### 1.3 `src/provider.ts`（新增，必要支持文件）
`SyncProvider` 接口（§3 逐字段）+ `InProcessProvider`（包装 MemoryFs）。mergeRemote 签名依赖它、测试依赖它，故随 B 阶段补上（见 DEVIATIONS #1）。

### 1.4 `src/index.ts`（改）
出口补 `export * from './provider' / './manifest' / './merger'`。

## 2. 测试（全部本地实跑）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/manifest.test.ts` | 11 | encode→decode 往返 / 键序稳定 / 非法 JSON·截断→null / 未来 schema_ver→null / 缺字段·类型错·非法设备键→null / 空设备表合法 / 设备并集+水位 max / 重叠设备字段 max / schema_ver min / 冲突不丢设备 / 快照水位·retention·created·updated 合并 |
| `test/merger.test.ts` | 6 | S1 双端并发改同块（1 conflict 含 kept/lost + 高版胜出）/ 乱序容忍（反转 list 结果全等）/ S2 截断段隔离且其余正常·不抛 / S3 同内容副本首轮收 1 弃 1·次轮双双 duplicate / S3 异内容同前缀两段都收 / S4 时钟回拨投影快照相等 |

## 3. 命令结果原文（本地复跑 2026-09-13）

### ① `pnpm -C packages/sync test`（全量）
```
 ✓  sync  test/fs.test.ts (10 tests) 4ms
 ✓  sync  test/naming.test.ts (7 tests) 5ms
 ✓  sync  test/manifest.test.ts (11 tests) 5ms
 ✓  sync  test/writer.test.ts (11 tests) 11ms
 ✓  sync  test/merger.test.ts (6 tests) 14ms

 Test Files  5 passed (5)
      Tests  45 passed (45)
```

### ② `pnpm -C packages/sync typecheck`
```
> @septcats/sync@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

（无输出 = 通过）
```

### ③ 门禁（§7 DoD grep 二条 + it() 计数）
```
$ grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"
（无违规，通过；仅 fs.ts 一处 node:fs）

$ grep -n "node:fs" packages/sync/src/fs.ts
1:import * as fsp from 'node:fs/promises';

$ grep -c "it(" packages/sync/test/*.test.ts
packages/sync/test/fs.test.ts:10
packages/sync/test/manifest.test.ts:11
packages/sync/test/merger.test.ts:6
packages/sync/test/naming.test.ts:7
packages/sync/test/writer.test.ts:11
（合计 45；DoD「≥45」门已在本阶段达成，C 阶段 fault/convergence 仍会继续叠加）
```

## 4. SSIM-NOTE

N/A。B 阶段交付物均为同步引擎内部纯逻辑（manifest/merger/provider），无任何 UI 表面，不涉及 `docs/mockups/*.html` 对齐；无待 PM 真机截图复审项。

## 5. DEVIATIONS（有意偏离与理由）

1. **新增 `src/provider.ts`（不在「严格限于」四清单内）**：mergeRemote 的 §4 签名 `MergeInput.provider: SyncProvider` 依赖该接口，而 A 阶段未交付 provider；不补则 merger 无法编译与测试。§3 明确「本任务只定义接口 + 一个 InProcessProvider 测试实现」，故作为 B 阶段的必要支持文件随 merger 落地。已合入文件（errors/fs/naming/writer）未动。
2. **manifest 校验用手写类型守卫而非 zod**：§4 注释写「zod 校验」，但 §1 包结构铁定「deps: @septcats/core；无其它」、A 阶段已锁定无 zod 直连。为不违反依赖约束，`decodeManifest` 采用手写守卫（ActorId 用 `^[a-z0-9]{8,32}$`，与 core.actorIdSchema 同源）。语义与 §4 一致（非法→null、未来 schema_ver→null）。
3. **S1 并发场景用「同 lamport c、异设备」而非任务书字面的「38/41」**：core.replay（D3 定稿）只在 `c 相同、d 不同` 时记 conflict——`core/replay.ts` 注释「只有两条写入并发（同一逻辑时间 c、不同设备）…严格更晚（c 更大）属因果正常覆盖」，`core/replay.test.ts` L71-95 亦把「双写」定义为 c 相同。38/41（不同 c）在 replay 下为因果覆盖、产出 0 conflict。我被要求「复用 core.replay、禁止在 sync 另写冲突判定、不改已合入 core」，故 S1 用 c=5 双设备触发真实冲突路径（恰 1 条 kept/lost + 高版胜出）。任务书字面 38/41 与 core 定稿语义冲突，留 PM 裁决是否需改 core 冲突判定（本会话不动 core）。
4. **快照播种（§4 规则 a 的 S5）与 `needsSnapshot` 归 C 阶段，本会话不碰**：用户明示「快照/GC/去重/隔离/fault/convergence 归下一会话，一个都不碰」。故 `mergeRemote` 不 `listSnapshots`、不播种基线；`needsSnapshot` 恒 false（B 阶段的合法默认值，其真实信号由 C 阶段 `planSnapshot` 计算）。`MergeInput.now` 同样仅冻结签名、B 阶段未消费（供 C 阶段 retention/快照决策）。
5. **mergeManifest 未明示字段的合并口径**：§4 只点名 schema_ver 取 min、水位取 max。其余采用——`created_at` 取 min、`updated_at` 取 max、`retention_days` 取 max（保守：不缩短保留窗口）、`snapshot` 三字段各取 max、重叠设备 `client_ver` 取最近活跃侧。均为可辩护的保守/单调选择，已在代码注释标注。
6. **测试 import 自具体模块（`../src/manifest` / `../src/merger` / `../src/provider`）而非 barrel**：延续 A 阶段增量纪律，逐文件验证不依赖 barrel 先后。

## 6. 未决项

1. **`needsSnapshot` / 快照播种的接线**：待 C 阶段 `snapshot.ts`（planSnapshot/buildSnapshotText/publishSnapshot）落地后，在 `mergeRemote` 里补 §4 规则 a 的快照基线（S5）并把 `needsSnapshot` 接到真实判定。
2. **S1 字面「38/41」与 core.replay 冲突语义的出入**（DEVIATIONS #3）：需 PM 裁决——是维持 core 的「同 c=并发」定义（本阶段据此实现），还是另立「跨设备同 target 即冲突」判定并改 core。后者属 core 范围变更，B 阶段按纪律未动。
3. 完整任务 DoD（§7 `pnpm -r typecheck && pnpm -r test`、≥45 it()）留待 C 阶段完成后 PM 复跑；B 阶段已达成 sync 包 45 例 + typecheck 干净 + grep 门禁通过（it 计数已跨过 45 门，C 阶段仍会继续叠加）。

## 7. PM 复跑指引（B 阶段）

```
pnpm -C packages/sync test                # 期望 5 files / 45 tests 全绿
pnpm -C packages/sync typecheck           # 期望无输出
grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"   # 期望空
grep -c "it(" packages/sync/test/*.test.ts                                        # 期望 10+11+6+7+11=45
```
