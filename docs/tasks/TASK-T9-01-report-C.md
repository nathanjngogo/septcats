# TASK-T9-01 交付报告 · C 阶段（快照 / GC / 去重 / 隔离 / fault / convergence + DoD 四条）

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**C 阶段全绿（sync 包 test 83 例 + typecheck 干净）**
> 范围：C 阶段收尾（A+B 已合入：errors/fs/naming/writer/manifest/merger/provider，45 例全绿；本会话做剩余文件与两个总测）。
> 纪律遵守：只读不写已合入 src 文件（merger.ts 经核对无需改动，见 DEVIATIONS #5）；每文件写完立即跑对应测试；不碰 git；禁占位符。

## 0. D2 复述（写前，≤5 行）

SQLite 是二进制随机写文件，A/B 两台机器各改一次后两个 `.db` 分叉，网盘同步只能「整库二选一」，丢一侧全部改动（冲突副本也救不回）。因此真相层必须是 append-only 事件日志分段（JSONL，命名含 Lamport+设备 ID，永不重名/改写），SQLite 降级为「本机可重建的物化视图，绝不同步」。合并算法 = 集合并（新段落地就重放），无需三方合并/锁/联网协商。这就是 packages/sync 存在的理由，也是快照（折叠旧段防日志膨胀）与 GC（retention + 设备水位双重门后才物理清除）存在的根因。

## 1. 交付物清单

### 1.1 `src/snapshot.ts`（新增，§4 三函数）
- `planSnapshot(allSegs, current, maxKeepSegs) → { through, foldSegIds } | null`：折叠条件 = retention 已过（段 `created_at` 距今超过 `retention_days`，参考时间取 `current.updated_at`，见 DEVIATIONS #1）**或** 段数 > maxKeepSegs；两者取较大折叠数；`through` 恒为某段的 `c_to`（绝不切在段中间）；已折叠段（`c_to <= covers_through`）不重复折；无段可折返回 null。
- `buildSnapshotText(segments, through, dev) → string`：只折整段（`c_to <= through`），重放成投影后 `opsToSnapshot` 压平为稳定键序 `{v, entities}` 文本；自检「可被 dev 经 `snapshotToOps` 播种回读」（S5 前置不变量，见 DEVIATIONS #2 的 dev 用法）。
- `publishSnapshot(fs, prefix, seq, text) → 'written' | 'existed'`：ifAbsent 幂等写 `snapshot-<seq:6hex>.json`；SkipError → 'existed'（S6 崩溃后重跑不产生第二个快照）。

### 1.2 `src/gc.ts`（新增，§4 单函数）
- `planCleanup(manifest, segs, knownDeviceWatermarks, now) → string[]`：**双重门**——① retention 已过（目录静默满 `retention_days`，参考 `manifest.updated_at`，见 DEVIATIONS #3）；② 所有已知设备水位 `>= 段 cTo`；未知/掉线设备（manifest 有、watermarks 无）按 `last_seen_at + 7 天` 宽限期**保守不放行**，静默超 7 天视为离场不再阻塞。只产出「可删清单」，真删由 runtime 决定。

### 1.3 `src/dedupe.ts`（新增，§4 单函数）
- `buildFileIndex(files) → { byHash, duplicates }`：按 `sha` 归组（byHash 含单文件组，便于按 hash 查路径）；同 hash 多副本字典序首个为规范副本，其余进 `duplicates`（S3 网盘副本去重）；无 `sha` 的文件不参与内容去重。

### 1.4 `src/quarantine.ts`（新增，§4 坏段隔离清单）
- `planQuarantine(candidates) → SyncQuarantineEntry[]`：对每个候选段 `decodeSegment` 失败则记入 `{file, reason}`；reason 分类口径与 merger 一致（半截 `E_SEGMENT_TRUNCATED` / 未来 schema `E_SCHEMA_TOO_NEW` / 其余 `E_SEGMENT_INVALID`）；空内容按 empty 处理不隔离。搬移语义在 runtime。

### 1.5 `src/index.ts`（改，出口补全）
`export * from './snapshot' / './gc' / './dedupe' / './quarantine'`（原有 7 个出口不变）。

### 1.6 `test/helpers.ts`（改，测试工具）
补 `DEV_C`/`DEV_D` 与 `makeManifest()`（测试专用 manifest 构造），供 snapshot/gc/fault 复用。

### 1.7 已合入 src 文件核对
`merger.ts` 的 `SyncReport.needsSnapshot` 类型已存在于 `errors.ts`（含 `needsSnapshot: boolean`），**无需补类型引用，merger.ts 本会话零改动**。其余已合入文件（errors/fs/naming/writer/manifest/provider）均未动。

## 2. 测试（全部本地实跑，sync 包 10 files / 83 tests）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/fs.test.ts` | 10 | （A 阶段，未动） |
| `test/naming.test.ts` | 7 | （A 阶段，未动） |
| `test/writer.test.ts` | 11 | （A 阶段，未动） |
| `test/manifest.test.ts` | 11 | （B 阶段，未动） |
| `test/merger.test.ts` | 6 | （B 阶段，未动） |
| `test/snapshot.test.ts` | 13 | planSnapshot 空集/未过/超限/retention 已过/同时触发/已折叠不重复折；buildSnapshotText 稳定键序+可播种回读+不切段中间+**S5 纯逻辑面**（snapshot+增量段重建==全量重放逐字节）；publishSnapshot 幂等+空 prefix+**S6 半写崩溃重跑 existed 不产生第二个快照**+写失败抛错后重试 written |
| `test/gc.test.ts` | 7 | **S9 双向**：retention 未过不放行 / 某设备水位未越过不放行 / 全过放行 / 水位恰等于 cTo 越过 / 掉线设备 7 天宽限期内不放行 / 静默超 7 天不再阻塞 / retention_days=0 恒过 |
| `test/dedupe.test.ts` | 9 | buildFileIndex 按 sha 归组/多副本字典序规范+duplicates/无 sha 跳过/空输入；planQuarantine 合法不隔离/半截 TRUNCATED/未来 schema TOO_NEW/非 JSON INVALID/空内容不隔离 |
| `test/fault.test.ts` | 8 | **S1–S6/S8/S9 端到端内存复现**（MemoryFs injectFailure 走 merger+snapshot+gc 全管线，每条一个 `it`，无 skip 无合并） |
| `test/convergence.test.ts` | 1 | **收敛性总测**：4 设备 × 30 随机 op（自实现 mulberry32）× 4 种段切分（每 op 一段/整段一份/随机切/按 target 切）→ merge 后最终投影逐字节相等 |

## 3. fault 矩阵覆盖清单（计划书 §9.3）

| # | 场景 | 状态 | 落点 |
|---|---|---|---|
| S1 | 双端并发改同块 | ✅ | fault.test.ts（同 c 异设备 → conflict 恰 1 条 kept/lost + 高版胜出） |
| S2 | 段文件写一半被同步 | ✅ | fault.test.ts（injectFailure halfwrite → 隔离 1 条，其余正常，不抛） |
| S3 | 网盘生成 `xxx (1)` 副本 | ✅ | fault.test.ts（injectFailure duplicate → 首轮去重、次轮全 skipped.duplicate） |
| S4 | B 设备时间早 1 年 | ✅ | fault.test.ts（判定只看 lamport，两次 merge 投影相等） |
| S5 | 新设备首次接入空目录 | ✅ | fault.test.ts（snapshot-1 + 增量段追平 == 老设备投影逐字节）+ snapshot.test.ts 纯逻辑面 |
| S6 | 快照写后崩溃 | ✅ | fault.test.ts（publishSnapshot 半写 → 重跑 existed，水位不乱）+ snapshot.test.ts |
| S7 | 同步文件夹被移走/断链 | ➖ | runtime（T10），任务书 §6 明确不做 |
| S8 | 两端同时删除同页 | ✅ | fault.test.ts（不同 lamport 各发 delete → 收敛 alive=0 且 conflicts 空） |
| S9 | retention 未过期即手工删段 | ✅ | fault.test.ts（retention 未过不放行）+ gc.test.ts 双向 |
| S10 | 加密后换钥匙 | ➖ | runtime（T10），任务书 §6 明确不做 |

## 4. 命令结果原文（DoD 四条，本地复跑 2026-09-13）

### ① `pnpm -r typecheck`
```
Scope: 8 of 9 workspace projects
packages/core typecheck: Done
packages/platform typecheck: Done
packages/ui typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
apps/desktop typecheck: Done
```
（全部 Done，通过）

### ② `pnpm -r test`
```
packages/core:     Test Files  8 passed | Tests 38 passed
packages/platform: Test Files (settings/layout/logger/credentials) 全绿（32 例，1 skip）
packages/ui:       全绿（含 theme/Menu/Popover/Switch/SyncPill/Input）
packages/schema:   Tests 3 passed
packages/sync:     Test Files 10 passed | Tests 83 passed
packages/editor:   Test Files 7 passed | Tests 126 passed
packages/dbview:   Test Files 5 passed | Tests 79 passed
apps/desktop:      pretest FAILED（环境问题，与 sync 无关，见 DEVIATIONS #6）
```
`apps/desktop pretest` 失败原文（`node scripts/ensure-abi.mjs node`）：
```
prebuild-install warn install EBUSY: resource busy or locked, open '...\better-sqlite3\build\Release\better_sqlite3.node'
node-gyp rebuild ... gyp ERR! stack Error: EPERM: operation not permitted, unlink '...\better_sqlite3.node'
ensure-abi: node-gyp rebuild failed
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @septcats/desktop pretest
```

### ③ `node packages/ui/tokens/no-magic.mjs`
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### ④ `pnpm -C apps/desktop build`
```
vite v7.3.6 building ssr environment for production...
✓ 77 modules transformed.
out/main/index.js 444.03 kB
✓ built in 587ms
✓ built in 9ms
✓ 4798 modules transformed.
out/renderer/index.html 1.00 kB
out/renderer/assets/index-CgavUZi6.css 52.05 kB
out/renderer/assets/index-tTS0lRUC.js 1,308.37 kB
✓ built in 3.33s
```
（退出码 0，通过）

### ⑤ 门禁 grep（§7 DoD 二条 + it() 计数）
```
$ grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"
（无违规，通过；仅 fs.ts 一处 node:fs）

$ grep -n "node:fs" packages/sync/src/fs.ts
1:import * as fsp from 'node:fs/promises';

$ grep -c "it(" packages/sync/test/*.test.ts
packages/sync/test/convergence.test.ts:1
packages/sync/test/dedupe.test.ts:9
packages/sync/test/fault.test.ts:8
packages/sync/test/fs.test.ts:10
packages/sync/test/gc.test.ts:7
packages/sync/test/manifest.test.ts:11
packages/sync/test/merger.test.ts:6
packages/sync/test/naming.test.ts:7
packages/sync/test/snapshot.test.ts:13
packages/sync/test/writer.test.ts:11
（合计 83；DoD「≥45」门远超）
```

## 5. SSIM-NOTE

N/A。C 阶段交付物均为同步引擎内部纯逻辑（快照/GC/去重/隔离/fault/convergence），无任何 UI 表面，不涉及 `docs/mockups/*.html` 对齐；无待 PM 真机截图复审项。

## 6. DEVIATIONS（有意偏离与理由）

1. **`planSnapshot` 的 retention 参考时间取 `current.updated_at`**：§4 契约签名只有 `(allSegs, current, maxKeepSegs)`，无 `now` 参数；`current.updated_at`（fallback `current.created_at`）是契约内唯一的墙钟时间来源。语义：段 `created_at + retention_days ≤ updated_at` 视为 retention 已过。可辩护且可测（测试用 40 天前的段 + 距今的 updated_at 触发折叠）。
2. **`buildSnapshotText` 的 `dev` 用于「播种回读自检」而非写入快照内容**：快照文本是 `{v, entities}`（core 定稿 schema 无 dev 字段），`dev` 无法也不该写进文本。为避免 `noUnusedParameters` 且保留 §4 签名，用它跑一次 `snapshotToOps(text, dev)` 自检「该快照可被 dev 播种」（S5 前置不变量），失败即抛。
3. **`planCleanup` 的 retention 门取 `manifest.updated_at`（全局门）而非逐段年龄**：§4 契约 `segs` 只带 `{file, cTo, dev}`、无 `created_at`，无法逐段算年龄。采用「目录静默满 retention_days 才允许物理清除」的全局门 + 逐段设备水位门（所有已知设备 `last_lamport >= cTo`），掉线设备按 `last_seen_at + 7 天` 宽限期保守不放行。语义与「retention 未过不放行、全过才放行」（S9）一致。
4. **`quarantine.ts` 的 `classifySegmentError` 与 `merger.ts` 内联副本重复**：约束「唯一允许的已合入文件改动 = merger.ts 补 needsSnapshot 类型引用，其余不许动」，而 needsSnapshot 类型已存在、无需改动；故无法把 merger.ts 里的分类函数抽到 quarantine.ts 共享。两处口径一致（同一稳定错误码输出），重复约 15 行，已在代码注释标注。
5. **`merger.ts` 本会话零改动**：§4 `SyncReport` 已含 `needsSnapshot: boolean`（定义在 `errors.ts`，B 阶段已落），无需「补类型引用」，故严格未动 merger.ts。
6. **`pnpm -r test` 在 `apps/desktop pretest` 失败 = 环境问题，非本任务代码缺陷**：`apps/desktop/.abi-target = electron` 且本机有多个 `electron.exe` 进程占用 `better_sqlite3.node`（当前为 Electron ABI）；`ensure-abi.mjs node` 试图 `node-gyp rebuild` 切换回 Node ABI，被 `EBUSY`/`EPERM`（资源锁定）拒绝。此路径与 packages/sync 完全无关——sync 83 例、core 38、editor 126、dbview 79、schema 3、platform 32（1 skip）、ui 全绿。`pnpm -C apps/desktop build` 走 Electron ABI（marker 已是 electron，无需重编）正常通过。**建议 PM 关掉 electron 进程后复跑 `pnpm -r test` 以全绿。**
7. **S1 并发场景用「同 lamport c、异设备」而非任务书字面「38/41」**：延续 B 阶段 DEVIATIONS #3 的结论——core.replay 只在「同 c、异 d」时记 conflict，38/41（不同 c）在 replay 下为因果覆盖、0 conflict。被要求复用 core.replay 且不改 core，故 S1 用同 c 触发真实冲突路径。

## 7. PM 复跑指引（C 阶段）

```
pnpm -C packages/sync test                # 期望 10 files / 83 tests 全绿
pnpm -C packages/sync typecheck           # 期望无输出
grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"   # 期望空
grep -c "it(" packages/sync/test/*.test.ts                                        # 期望合计 83（≥45）

# DoD 四条
pnpm -r typecheck                          # 期望 8/9 projects Done
pnpm -r test                               # 期望除 apps/desktop pretest（electron 锁，DEVIATIONS #6）外全绿
node packages/ui/tokens/no-magic.mjs       # 期望 ✓ no-magic
pnpm -C apps/desktop build                 # 期望 built in ~3.3s，退出码 0
```
