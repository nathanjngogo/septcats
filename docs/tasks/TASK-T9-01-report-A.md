# TASK-T9-01 交付报告 · A 阶段（M8a 同步引擎核心骨架）

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**A 阶段全绿（本地已复跑 sync 包 test + typecheck）**
> 范围：仅 A 阶段（共 A/B/C 三阶段）。B（manifest/merger/snapshot/gc/dedupe/quarantine + fault.test.ts）与 C 尚未动，DoD 的「≥45 it()」是完整任务门，A 阶段交付 28 例，待 B/C 补齐。

## 0. D2 复述（写前，≤5 行）

SQLite 是二进制随机写文件，A/B 两台机器各改一次后两个 `.db` 分叉，网盘同步只能「整库二选一」，丢一侧全部改动（冲突副本也救不回）。因此真相层必须是 append-only 事件日志分段（JSONL，每段 ≤256KB，命名含 Lamport+设备ID，永不重名/改写），SQLite 降级为「本机可重建的物化视图，绝不同步」。合并算法 = 集合并（新段落地就重放），无需三方合并/锁/联网协商。这就是 packages/sync 存在的理由。

## 1. 交付物清单（严格限于 A 阶段五项）

### 1.1 包骨架
| 文件 | 说明 |
|---|---|
| `packages/sync/package.json` | name `@septcats/sync`；**deps 仅 `@septcats/core: workspace:*`**；devDeps `@types/node`/`typescript`/`vitest`（与 core 同款）；exports `"." → ./src/index.ts` |
| `packages/sync/tsconfig.json` | extends `../../tsconfig.base.json`，`types: ["node"]`，include `src/**`+`test/**` |
| `packages/sync/vitest.config.ts` | 单 node 工程（name `sync`），见 DEVIATIONS #1 |
| `pnpm-workspace.yaml` | **无需改动**：`packages/*` glob 已自动纳入 `packages/sync`（见 DEVIATIONS #3） |
| `pnpm install` | 已跑；workspace 从 8 → **9 projects**，`packages/sync/node_modules/@septcats/core -> packages/core/` 链接已建立（唯一失败是 `apps/desktop` 的 electron-rebuild postinstall，better-sqlite3 ABI + 路径含空格，与 sync 无关，见 DEVIATIONS #4） |

### 1.2 `src/errors.ts`
- `SyncErrorCodes`（E_* 稳定码常量）：`E_ALREADY_EXISTS` / `E_NOT_FOUND` / `E_SEGMENT_INVALID` / `E_SEGMENT_TRUNCATED` / `E_SCHEMA_TOO_NEW` / `E_MANIFEST_INVALID` / `E_WRITE_FAILED`（只增不改，调用方按 code 分支）。
- `SyncError`（带 code + 可选 path）、`SkipError`（ifAbsent 幂等）、`NotFoundError`（read/size 缺失）。
- `SyncReport` 类型骨架 + `SyncSkippedEntry` / `SyncQuarantineEntry`（§4 签名，`conflicts` 复用 `core.replay` 的 `ReplayConflict`）。

### 1.3 `src/fs.ts`
- `SyncFs` 接口（§2 逐字）：`list/read/write/exists/size/remove`。
- `MemoryFs`：内存 Map，`injectFailure: 'halfwrite' | 'duplicate' | (op: FsWriteOp) => void`；`halfwrite` 截断写（S2）、`duplicate` 额外写 `xxx (1).jsonl` 网盘副本（S3）、自定义函数可改 `path/content` 或 throw。
- `NodeFs` 薄封装（`node:fs/promises`，`ifAbsent` 用 `flag:'wx'` 原子独占写，EEXIST→SkipError），**本任务不测**。

### 1.4 `src/naming.ts`
- `segmentFileName(seg)` → `seg-<c_from:8hex>-<dev>-<n:6hex>.jsonl`（复用 `seg.seg_id`）。
- `parseSegmentFileName(name)` → `{ cFrom, dev, n, copySuffix, encrypted } | null`；识别网盘副本两种位置（`x (1).jsonl` / `x.jsonl (1)`）与加密后缀 `.jsonl.enc`。
- `isSidecarCopy(name)` → `/ \(\d+\)(?=\.|$)/`。
- `contentFingerprint(text)` → sha256 hex（`node:crypto`）。

### 1.5 `src/writer.ts`
- `WritePolicy` + `DEFAULT_WRITE_POLICY`（500 / 256*1024 / 1000）。
- `SegmentBuilder`：`add` 攒 op 并追踪字节/时钟跨度/最近 op.at；`shouldFlush(atMs, idleMs)` 四触发（条数/字节/跨度/空闲）；`flush()` 复用 `core.buildSegment` + `core.validateSegment`（产出即自校验，非法 throw `SegmentValidationError`）；`pendingCount`。
- `publishSegment(fs, prefix, seg)`：`encodeSegment` 自校验 → `ifAbsent` 写入 → SkipError 转 `'existed'`（幂等，S3/S6）。
- `src/index.ts`：barrel 再导出上述四模块（B/C 阶段追加）。

## 2. 测试（全部本地实跑）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/fs.test.ts` | 10 | 读写/exists/size（UTF-8 字节）/list 不递归/ifAbsent SkipError/覆盖写/remove 幂等/read+size NotFound/halfwrite 截断/duplicate 副本/自定义 fault |
| `test/naming.test.ts` | 7 | segmentFileName 规范名/parse 往返/副本两种位置/加密段/非法名 null（缺扩展名·宽度不足·大写 dev·snapshot）/isSidecarCopy/contentFingerprint 稳定性 |
| `test/writer.test.ts` | 11 | 空 flush null/攒段产出合法段并清空/乱序入队排序/四触发器（条数·字节·跨度·空闲）/空 shouldFlush 恒 false/publishSegment 幂等 written→existed/encodeSegment 逐字节还原/空 prefix |
| `test/helpers.ts` | — | DEV_A/DEV_B + makeOp（同 core 风格） |

## 3. 命令结果原文（本地复跑 2026-09-13）

### ① `pnpm install`（关键行）
```
Scope: all 9 workspace projects
Already up to date
apps/desktop postinstall$ electron-rebuild -f -w better-sqlite3 && node scripts/ensure-abi.mjs node
apps/desktop postinstall: [Error: EPERM ... better_sqlite3.node]
apps/desktop postinstall: × Rebuild Failed
ELIFECYCLE Command failed with exit code 4294967295.
```
→ sync 包已纳入 workspace 并链接 `@septcats/core`（验证：`packages/sync/node_modules/@septcats/core -> /e/.../packages/core/`）。唯一失败是 `apps/desktop` 的 better-sqlite3 ABI 重编译（路径含空格），与本包无关，见 DEVIATIONS #4。

### ② `pnpm -C packages/sync test`（全量）
```
 ✓  sync  test/fs.test.ts (10 tests) 5ms
 ✓  sync  test/naming.test.ts (7 tests) 5ms
 ✓  sync  test/writer.test.ts (11 tests) 13ms

 Test Files  3 passed (3)
      Tests  28 passed (28)
```

### ③ `pnpm -C packages/sync typecheck`
```
> @septcats/sync@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

（无输出 = 通过）
```

### ④ 门禁（§7 DoD grep 二条 + it() 计数）
```
$ grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"
(无违规，通过)

$ grep -n "node:fs" packages/sync/src/fs.ts
1:import * as fsp from 'node:fs/promises';

$ grep -c "it(" packages/sync/test/*.test.ts
packages/sync/test/fs.test.ts:10
packages/sync/test/naming.test.ts:7
packages/sync/test/writer.test.ts:11
（合计 28；DoD「≥45」为完整任务 A+B+C 门，A 阶段后随 merger/snapshot/gc/dedupe/fault 补齐）
```

## 4. SSIM-NOTE

N/A。A 阶段交付物均为同步引擎内部纯逻辑（fs/naming/writer/errors），无任何 UI 表面，不涉及 `docs/mockups/*.html` 对齐；无待 PM 真机截图复审项。

## 5. DEVIATIONS（有意的偏离与理由）

1. **vitest.config.ts 用 node 环境而非 editor 的 jsdom**：任务书写「照 editor 范式」，但 editor 是 jsdom（为真 PM + IME 测试）；sync 是零 DOM 纯逻辑包（铁律 §0「纯 Node + 内存假 fs 跑全部测试」），node 范式才是对的。采用与 core/schema 完全一致的 node 单工程配置（`name:'sync'`），jsdom 会徒增无收益开销。
2. **测试 import 自具体模块（`../src/fs` 等）而非 `../src/index` barrel**：为满足「每个文件写完立即跑对应测试」的增量纪律——barrel 会要求 naming/writer 先于 fs.test 存在，与逐文件验证冲突。barrel `src/index.ts` 仍存在并再导出全部，对外消费不变。
3. **`pnpm-workspace.yaml` 未改动**：当前 `packages: ['apps/*', 'packages/*']` glob 已自动覆盖 `packages/sync`，`pnpm install` 实测 scope 8→9 确认纳入。无必要也不应新增显式条目（避免范围外改动）。
4. **`pnpm install` 尾部的 `apps/desktop` electron-rebuild 失败不处理**：`EPERM unlink better_sqlite3.node`（路径含空格 + ABI），是既有环境问题、与 sync 无关；属 memory 记录的「better-sqlite3 ABI 由 pretest/preselftest 守卫自愈」例外，留给 PM 验收流程，A 阶段不扩大范围去修。
5. **`SyncReport` 拆出 `SyncSkippedEntry`/`SyncQuarantineEntry` 命名子接口**：§4 用内联字面量；拆名便于 B 阶段 merger 与测试复用，语义与 §4 逐字段一致。
6. **`errors.ts` 额外补 `NotFoundError`**：§2 未点名但 `read`/`size` 对缺失文件需要可分支的错误类型（`SyncError` 子类 + `E_NOT_FOUND` 码），MemoryFs/NodeFs 共用，避免各自手写。
7. **`MemoryFs.size` 按 UTF-8 字节数（`Buffer.byteLength`）**：段内容可能含 CJK，字节触发器的「256KB」口径按 UTF-8 而非 UTF-16 才与磁盘体积一致。

## 6. 未决项

1. `shouldFlush` 的「空闲」触发器语义采用「`atMs - max(op.at) >= idleMs`」（op.at 为墙上时间），若 PM 意图是「距上次 add 调用的墙钟间隔」需在 EditSession 侧额外喂时间戳——当前签名 `shouldFlush(atMs, idleMs)` 已把时间源收敛为入参，可测、可注入，待 B 阶段与 EditSession 接线时确认。
2. `parseSegmentFileName` 不识别裸 `.enc`（core `stripKnownSuffix` 三后缀之一）：本包 `segmentFileName` 只产出 `.jsonl`，加密段为 `.jsonl.enc`（§6.3 `seg-...jsonl[.enc]`），裸 `.enc` 无产生路径，暂判 null；若 PM 要求兼容裸 `.enc` 再补。
3. 完整任务 DoD（§7 `pnpm -r typecheck && pnpm -r test`、≥45 it()）留待 B/C 完成后 PM 复跑；A 阶段已满足本阶段门（sync 包 test 28 绿 + typecheck 干净 + grep 门禁通过）。

## 7. PM 复跑指引（A 阶段）

```
pnpm install                              # 已跑，唯一失败为 apps/desktop better-sqlite3 postinstall（与本包无关）
pnpm -C packages/sync test                # 期望 3 files / 28 tests 全绿
pnpm -C packages/sync typecheck           # 期望无输出
grep -rn "node:fs\|better-sqlite3\|electron" packages/sync/src | grep -v "fs.ts"   # 期望空
grep -c "it(" packages/sync/test/*.test.ts                                        # 期望 10+7+11=28（A 阶段）
```
