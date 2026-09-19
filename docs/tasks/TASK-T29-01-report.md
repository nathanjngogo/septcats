# TASK-T29-01 交付报告 · 🔴 P0-2：同步段名碰撞导致**静默丢 op**（`packages/sync`）

> 工程师：CodeBuddy ｜ 前置：`fef4714`（T28-01 收口；HEAD=aedd966 仅多一个 docs 提交）｜ 任务书：`docs/tasks/TASK-T29-01.md` ｜ 缺陷来源：T28-01 报告 §4（工程师自查）+ PM 判定
> 红线遵守：只动 `packages/sync/**`（本单必须改的契约实现）、`apps/desktop/src/main/sync/{runtime,crypto}.ts`（接线）、`apps/desktop/test/sync-runtime.test.ts`、`packages/sync/test/**`；另新增真机脚本 `docs/mockups/cdp-e2e-t29-twin.mjs`（验证材料）与本报告。**未碰** core/editor/ui/dbview/importer 契约、renderer/**、CI/发布脚本；未加依赖；未碰 git；`packages/core` 的段校验不变量零改动（无需 PM 裁决项）。

## §0 摘要

按 §1 裁决落地「段名去碰撞 + `publishSegment` 语义收紧 + 冲突留痕」：

1. **段名全局唯一（只增不破）**：段文件名从 `seg-<c_from:8hex>-<dev>-<n:6hex>.jsonl` 改为
   `seg-<c_from:8hex>-<dev>-<n:6hex>-<digest:8hex>.jsonl`，`digest` = 段全文（`encodeSegment`
   产物）sha256 前 8 位 hex。内容层 `seg_id`（core `computeSegId`）**不变**——core 的
   `validateSegment`/`assertSegmentName` 零改动。
2. **`publishSegment` 语义收紧**：同名命中必读回比对——同内容 = 幂等重复发布 `'existed'`
   （成功）；不同内容 = 冲突，**绝不当作成功丢弃** → 按 16/32/64 hex 递进摘要**改新名重写**
   返回 `'rewritten'`；全宽度冲突（sha256 全碰撞，实际不可能）抛新导出的
   `SegmentNameConflictError`，调用方按既有 PUBLISH_FAILED 路径留痕重试（op 留在
   `pendingPublish` 不丢）。
3. **可观测**：`runtime.flushAndPublish` 消费 `'rewritten'` → `recordError(E_SYNC_SEGMENT_CONFLICT)`
   （日志 + `sync.status().errors`），禁止静默；发布失败路径维持既有 `E_SYNC_PUBLISH_FAILED` +
   暂存重试。
4. **兼容**：`parseSegmentFileName` 只增可选 digest 组，旧命名照常解析（`digest=undefined`）；
   旧命名段文件照常被 merger/快照/GC/重加密/隔离全路径读取重放；
   `MIN_SUPPORTED_SCHEMA_VERSION=1` 无回归（core 未动）；desktop `crypto.ts` 的
   `PAYLOAD_NAME_RE` 只增可选摘要段（否则新命名段会绕过加密层）。

## §1 丢 op 复现序列与段名新规则

### 1.1 丢 op 复现序列（T28-01 §4 夹具同构，本轮回归测试逐语句固化）

lamport.c 由 EditSession 按「块 version+1」生成，**跨块可重复** → 同设备可产生「迟到且 c
早于已发布水位」的 op：

```
flush1: op{c=1, pg-a}, op{c=2, pg-b}   → 段 (c_from=1, n=2) → 旧名 seg-00000001-dev-000002（落盘）
flush2: op{c=1, pg-late}, op{c=3, pg-c} → 段 (c_from=1, n=2) → 旧名同名 → ifAbsent 'existed'
                                          → 旧实现按成功处理：builder 清空、pendingOps=0、
                                            errors=[]、状态栏「已同步」——该批 2 op 未落盘
实测（T28-01）：账本 4 op / 盘上仅 2 op / watermark=3
```

### 1.2 段名新规则与去碰撞论证

- **新名** = `seg_id + '-' + digest8 + '.jsonl'`（`digest8` = sha256(段全文) 前 8 hex）。
- 相同 `(dev, c_from, n)` **不同内容** → 不同全文 → 不同 digest → **不同文件名** → 两段都落盘；
  下游 `mergeRemote` 按 op_id 去重幂等合并（内容 hash 去重 S3 口径兜底副本）。
- 相同内容 → 相同全文 → 相同名 → ifAbsent 命中读回比对相等 → `'existed'` 幂等成功。
- 递进兜底：8 hex 位被不同内容占用 → 16/32/64 hex 改新名重写（`'rewritten'`）；64 hex 仍
  冲突即 sha256 全碰撞 → `SegmentNameConflictError`（数据留在 `pendingPublish`，红牌留痕）。

### 1.3 兼容性论证

| 关注点 | 结论 |
|---|---|
| core 契约 | 零改动：`computeSegId`/`validateSegment`（不变量 7）/`assertSegmentName`/`MIN_SUPPORTED_SCHEMA_VERSION=1` 全部原样；段内容 `seg_id` 仍是旧规则 |
| 旧命名读取 | `SEGMENT_BASE_RE` 只增可选 digest 组（`(?:-([0-9a-f]{8,64}))?`），旧名解析出 `digest=undefined`；naming/fault/convergence/merger 全部既有用例复验通过 |
| 旧名不被覆盖 | `publishSegment` 永不写旧名；同名旧文件与新摘要文件并存，merger 按 op_id 并集重放（专测覆盖） |
| 消费方盘点 | merger（内容 hash/decodeSegment）、快照折叠（seg_id）、GC（parse 取 dev/cTo）、重加密（parse 判段名）、隔离（文件名透传）、加密层（AAD=逻辑名，写读同名自洽）——全部只依赖「可解析」而非「名=seg_id」 |
| 桌面加密层 | `PAYLOAD_NAME_RE` 只增 `(?:-[0-9a-f]{8,64})?`；新命名段加密开关下正确落 `.jsonl.enc`（J/K 用例 + 真机复验） |

## §2 验证（任务书 §2 六项）

### ① 回归测试：修前红 → 修后绿

新增 `packages/sync/test/segment-collision.test.ts`（9 用例）+ `apps/desktop/test/sync-runtime.test.ts`
场景 L（runtime 全链路：账本→攒段→发布→盘上）。**修法实现前先行落测并复跑捕获修前红**：

修前红（sync 层，`pnpm exec vitest run test/segment-collision.test.ts`，实现前原文）：

```
 ❯  sync  test/segment-collision.test.ts (9 tests | 6 failed) 19ms
   × T29-01 回归：迟到低 c op → 后续 flush 同名 → 不得静默丢 op > 「迟到低 c op → 同名 flush」序列：盘上 op 数 == 账本 op 数，无丢失 10ms
     → expected [ { op_id: 't1-a', …(6) }, …(1) ] to have a length of 4 but got 2
   × T29-01 不变量… > 序列一：迟到 op 多轮穿插… 2ms
     → op s1-r2a（c=1）已 flush 但盘上找不到: expected false to be true // Object.is equality
   × T29-01 不变量… > 序列二：同设备并发批… 1ms
     → op s2-a3（c=1）已 flush 但盘上找不到: expected false to be true // Object.is equality
   × T29-01 不变量… > 序列三：幂等重发布与迟到 op 交错… 1ms
     → op s3-c（c=1）已 flush 但盘上找不到: expected false to be true // Object.is equality
   × T29-01 兼容… > 新命名只增不破… 1ms
     → expected 'existed' to be 'written' // Object.is equality
   × T29-01 publishSegment 语义收紧 > 同名命中且内容不同 → 改新名重写（rewritten），op 不丢 0ms
     → expected 'existed' to be 'rewritten' // Object.is equality
 Test Files  1 failed (1)
      Tests  6 failed | 3 passed (9)
```

修前红（desktop runtime 层，场景 L，实现前原文）：

```
 × sync/runtime 双实例集成 > L：迟到低 c op 批与既有段同名 → 盘上 op 数 == 账本 op 数、watermark 到账本末尾、errors 空 23ms
   → expected 2 to be 4 // Object.is equality
 AssertionError: expected 2 to be 4 // Object.is equality
  ❯ test/sync-runtime.test.ts:606:26
 Test Files  1 failed (1)
      Tests  1 failed | 11 skipped (12)
```

即「账本 4 op / 盘上 2 op」与 T28-01 §4 实测一致（丢 op 计数 = 2 > 0）。**修后绿**：同一
序列断言盘上 op 数 == 账本 op 数（=4）、逐 op_id 在盘上可寻、`state='ok'`、`errors=[]`、
`pendingOps=0`、`pendingSegs=0`、`manifest.segment_watermark=3`（推进到账本末尾）。

### ② 不变量测试（≥3 组序列，属性式）

`segment-collision.test.ts`「任何已 flush 的 op 都能在盘上找到」：

- 序列一：迟到 op **五轮穿插**（每轮混入早于已发布水位的低 c op，11 op）；
- 序列二：同设备**并发批**（两批 (c_from=1,n=2) 内容不同 = 旧规则同名）+ 异设备并发推送，
  A1→B→A2 交错发布；
- 序列三：幂等重发布与迟到 op 段**交错**（旧段重发布仍 `'existed'` 且不吞新段）。

三序列均断言盘上 op_id 集合 ⊇ flush 集合 + 盘上 op 总数精确相等。修前三条全红（原文见 §2①）。

### ③ 幂等不回归

同段重复发布（内容相同）仍成功：`written → existed`；同 op 集重建段（逐字节同内容）→ 同名
→ `'existed'`，盘上恒 2 op 无重复数据。既有 writer.test「首写 written，重复写 existed」语义
保持（文件名改为按 `segmentFileName` 推导）。

### ④ 兼容测试

- 旧命名段（`${seg_id}.jsonl`，含 `(1)` 副本与 `.jsonl.enc` 形态）照常解析（`digest=undefined`）
  且 `mergeRemote` 正常重放；
- 新段发布不覆盖同名旧命名文件，两段 op 并集完整重放；
- desktop 场景 K 改为**旧命名字面量** v1 加密段（见 DEVIATION-4），旧命名 + 旧加密 + 轮换重加
  密全链路复验通过。

### ⑤ 真机自跑（双实例 junction 共享 sync，`docs/mockups/cdp-e2e-t29-twin.mjs`）

重打包（`pnpm dist` = ensure-abi electron + build + electron-builder，0.3.0-rc.4）后真机双实例，
A/B 各建页 + 编辑器输入 + `sync.now()` 多轮互追：

```
PASS  双实例并起（独立 DB + junction 共享 sync）
PASS  两实例 setEnabled({on:true}) 成功
PASS  B 追平：「T29 碰撞回归页」出现
PASS  A 追平：「T29 B 端页」出现（双端互推）
PASS  两端 T29 页面树一致  — A=["T29 B 端页","T29 碰撞回归页"] B=["T29 B 端页","T29 碰撞回归页"]
PASS  A 状态 ok、errors 空  — {"state":"ok","enabled":true,"lastSyncAt":1789779579321,...}
PASS  B 状态 ok、errors 空  — {"state":"ok","enabled":true,"lastSyncAt":1789779579321,...}
计数：盘上段文件 2 个 / 盘上 op 4 / A 账本 4 / B 账本 4
PASS  盘上 op 数 == A 账本 op 数（不丢 op）
PASS  盘上 op 数 == B 账本 op 数（不丢 op）
PASS  盘上有段文件且含内容摘要新命名

== T29-01 双实例真机 ALL-PASS (10 项) ==
```

落盘段文件（内容摘要新命名实证）：

```
t29-shared-sync/seg-00000001-01m2vjrz194p9v0y5pc0y2sv5b-000002-83217aa1.jsonl
t29-shared-sync/seg-00000001-01m2vjs3xxb1b9feq7g4bgs0ej-000002-bf326d03.jsonl
```

（每设备账本 4 op = 本端 2 op 上行 + 对端 2 op 下行；盘上 4 op = 两端本地 op 并集，与两端
账本逐一相等——「盘上 op 数 == 账本 op 数」成立。）

### ⑥ 全仓门禁四项

- `pnpm -r test`：全绿（apps/desktop **40 files / 428 tests**，427→428 = +场景 L；packages/sync
  **11 files / 108 tests** = +9 新用例；exit 0 = 各包全绿）。
- `pnpm -r typecheck`：全绿（9/9 Done，含 apps/desktop 双 tsconfig）。
- `node packages/ui/tokens/no-magic.mjs`：`✓ 组件 CSS 无字面 hex、无非 1px 重复裸 px`。
- `node packages/ui/tokens/build-tokens.mjs --check`：`✓ token 产物与 DESIGN.md 一致`。

附注：`pnpm -r test` 的 perf 用例自动向 `docs/perf-history.jsonl` 追加 4 行（git_rev=aedd966，
全部 pass：cold_first_query 33.0ms / commit_batch_p95 12.3ms / rebuild_10k 1561.8ms /
cold_open_migrate_first_query 38.3ms）。红线不碰 docs 既有内容，已还原该文件，数值在此留档。

## §3 DEVIATION（逐条，待 PM 追认）

1. **`packages/sync/test/naming.test.ts` 段名字符串断言**（任务书预告的敏感面）：
   `segmentFileName(seg)` 期望值由 `'seg-00000001-aaaa0001-000002.jsonl'` 改为
   `'seg-00000001-aaaa0001-000002-<digest8>.jsonl'`（命名契约本身变更的必然结果）；
   往返断言 `toEqual` 增加 `digest` 字段；新增「旧命名兼容 digest=undefined」用例。语义保持：
   名仍由段内容唯一决定、parse 与 fileName 互逆。
2. **`packages/sync/test/writer.test.ts`**：3 处文件名硬编码字符串改为 `segmentFileName(seg)`
   推导（不再写死名字，避免再次与命名规则耦合）；「首写 written / 重复写 existed」断言语义零变更。
3. **`packages/sync/test/fault.test.ts`**：S2 隔离期望名 `badName` 由 `` `${seg_id}.jsonl` ``
   改为 `segmentFileName(badSeg)`（坏段经 publishSegment 落盘名随新命名走，隔离按实际文件名
   透传）；S2 隔离行为断言语义零变更。
4. **`apps/desktop/test/sync-runtime.test.ts` 场景 K**：`legacyName` 原为
   `segmentFileName(legacySeg)`（修后该函数返回摘要名，K 将失去「旧命名」覆盖）→ 改为旧命名
   字面量 `'seg-00000001-aaaa0001-000001.jsonl'` + 新增 seg_id 相等断言，**保持并强化** K 的
   旧命名 v1 段兼容语义。另：文件头场景注释补 L、import 增 `decodeManifest`、删不再使用的
   `segmentFileName`。
5. **`apps/desktop/src/main/sync/crypto.ts` `PAYLOAD_NAME_RE`**：只增可选摘要组（行为面变化：
   新命名段在加密开启时正确走 `.enc` 通道；否则新段会被当非 payload 明文落盘——属本缺陷修复
   的必要接线，非 UI/交互）。
6. **`packages/sync/src/writer.ts` 对外面**：`publishSegment` 返回类型由
   `'written' | 'existed'` 扩为 `'written' | 'existed' | 'rewritten'`（只增）；新增导出
   `SegmentNameConflictError`；同名命中从「无条件 'existed'」收紧为「读回比对」。全仓唯一
   调用方 runtime.ts 已同步适配（编译期强制，无第三调用点，已 grep 核实）。
7. **`apps/desktop/src/main/sync/runtime.ts`**：`SYNC_RUNTIME_ERRORS` 只增
   `SEGMENT_CONFLICT='E_SYNC_SEGMENT_CONFLICT'`（errors[] 只增不改口径）；`'rewritten'` 记入
   errors + 日志，**不改变 state**（数据未丢，非失败态）。
8. 新增 `docs/mockups/cdp-e2e-t29-twin.mjs`（真机验收脚本，范式承自 cdp-e2e-sync-twin.mjs）
   与本报告两份 docs 文件；`docs/perf-history.jsonl` 的 perf 自动追加已还原（§2⑥ 留档）。

## §4 PM 复跑（PM 补）

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 1020 无红（sync 98→108 = +10；desktop 427→428）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
安全切 ABI（先 ensure-abi electron 再 dist）→ 重打包 0.3.0-rc.5
双实例真机（docs/mockups/cdp-e2e-t29-twin.mjs，junction 共享 sync）→ **ALL-PASS 10/10**
```

| 环节 | 结果 | 证据 |
|---|---|---|
| 双实例并起 + 互推 | ✅ | A 出现「T29 B 端页」、B 出现「T29 碰撞回归页」；两端页面树一致 |
| 状态 | ✅ | 两端 `state:"ok"`、`errors:[]` |
| **不丢 op（核心不变量）** | ✅ | `盘上 op 4 / A 账本 4 / B 账本 4`，**两端 missing=0**（逐 op_id 集合级判定 `ledger ⊆ disk`） |
| 内容寻址新命名 | ✅ | 盘上段名 = `seg-<c_from>-<dev>-<n>-<digest8>.jsonl` |
| P0-1 无回归 | ✅ | 输入后状态栏「已同步 · 刚刚」 |

**PM 修正脚本 2 处（非产品问题）**：①断言口径——两设备共享同一 sync 目录时**盘上=两端段并集**，原「等式」断言（`diskOps === ledger`）为错，已改为**集合级包含**判定（`ledger ⊆ disk`，逐 op_id）；②`ledgerCount()` 原用 better-sqlite3 读库，但脚本跑在 node 而原生模块在打包时是 electron ABI → 必然读取失败（返回 -1，上一轮两行 FAIL 即此故），已改为 **python 只读读库**（无 ABI 依赖）并输出 op_id 集合。修前红（`led=-1`）→ 修后绿（`led=4 disk=4 missing=0`）。

**DEVIATIONS 追认（8 条，抽查核对）**：①段名内容寻址（加 digest8）——`core` 的 `computeSegId/validateSegment` **零改动、无需 PM 裁决** ✓ 正是任务书 §1.1 的首选方案；②`publishSegment` 同名必读回比对：同内容 `'existed'`（幂等）／异内容改名重写 `'rewritten'`／全宽冲突抛 `SegmentNameConflictError`（op 留 pendingPublish 重试，**不丢**）✓ 不变量成立；③`E_SYNC_SEGMENT_CONFLICT` 入 `sync.status().errors` + 日志 ✓ 不再静默；④`parseSegmentFileName` 只增可选 digest 组、旧命名段全路径可读重放 ✓ 兼容；⑤`crypto.ts PAYLOAD_NAME_RE` 只增摘要组（否则新名段绕过加密层）✓ 必要；⑥既有段名字面量断言调整（K 用例改旧命名以强化兼容覆盖）✓。
