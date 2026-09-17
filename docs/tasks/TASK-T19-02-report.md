# TASK-T19-02 交付报告 · 协作（CRDT）落地 1/4：core op schema v2 + 字段级 LWW + `crdt_update`

> 工程师：CodeBuddy ｜ 日期：2026-09-17 ｜ 前置：T19-01 SPIKE 已交付（`e84476a` 在历史中，开工 `git log -1` 实际 HEAD=`7ff4218`，为任务书与发布清单两笔 docs 提交，晚于且不触碰 SPIKE 交付物）
> 纪律自检：不碰 git（无任何 git 写操作）；无占位符/TODO；既有测试断言仅版本钉随任务书前进（见 DEVIATIONS-3，语义未放宽）；无新增依赖。

---

## 1. 交付表

| 文件 | 内容 |
|---|---|
| `packages/core/src/op.ts` | `SCHEMA_VERSION` 1→2 + 新增 `MIN_SUPPORTED_SCHEMA_VERSION=1`；`OP_KINDS` 追加 `'crdt_update'`；`MERGE_POLICIES=['lww','lww-field','crdt']`（zod 字面量→`z.enum` union，v1 段只出现 `'lww'` 照旧可读）；`crdtUpdatePayloadSchema`（`{pageId, updateB64, svFromB64?}`，base64 文本对 core 不透明、不解码）；`validateOpSemantics` 补两条约束（crdt_update 的 payload/固定 policy；`'crdt'` 不得用于其他 kind）；三类 policy 的 replay 语义注释 |
| `packages/core/src/replay.ts` | 按 `merge_policy` 分派：`lww`（现状不变）/ `lww-field`（`applyLwwField` 按键合并 + `null` 删键 + 按键时钟决胜）/ `crdt`（`collectCrdtUpdate` 收集不投影）；`lww` 族胜出生效后 `stampFieldClocks` 推进字段时钟（upsert 整体盖章 = 全键 union，与实体级 LWW 一致）；`ReplayReport` 增加 `crdtUpdates` |
| `packages/core/src/projection.ts` | `Projection` 内部新增字段级时钟（`(实体, data key) → lamport`）：`getFieldClock/setFieldClock/fieldClockKeys`，随 `clone()` 复制；不进 Entity 外形、不进快照 |
| `packages/core/src/segment.ts` | 段校验不变量 1 改为 `schema_ver ∈ [MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION]`——v1 段照常可读（逐字节等价），未来段仍拒绝 |
| `packages/core/src/snapshot.ts` | 快照 `v` 校验同口径放行 v1（实体外形只增不改）；写入端仍写当前版本 |
| `packages/core/src/index.ts` | 无需改动（`export *` 已覆盖新常量/类型） |
| `packages/core/test/helpers.ts` | `makeOp` 的 `mergePolicy` 选项类型放宽为 `MergePolicy`（测试基建，非断言） |
| `packages/core/test/merge-policy.test.ts` | **新增 13 条用例**（§2 全覆盖，见 §3） |
| `packages/core/test/op.test.ts` / `index.test.ts` / `replay.test.ts` | 三处**版本钉**随任务书前进（`SCHEMA_VERSION` 1→2、快照字节钉 `v:1`→`v:2`），语义（钉住当前版本）不变 |
| `packages/core/test/convergence.test.ts` | 类型收敛：fuzz 的 kind 集显式 `Exclude<OpKind,'crdt_update'>`，仍是既有五种，穷尽性分支不放松 |
| `docs/tasks/TASK-T19-02-report.md` | 本报告 |

## 2. PM 裁决逐条消费

| 裁决 | 落地 |
|---|---|
| §0.2 OP_KINDS/CRDT payload | `op.ts:41`（kinds）、`op.ts:79-84`（payload zod）；core 全程不 base64 解码，`updateB64` 仅透传 |
| §0.2 MERGE_POLICIES union + v1 可读 | `op.ts:71-73`；v1 段/快照可读由 `segment.ts:98-104`、`snapshot.ts` 同口径保证 |
| §0.2 SCHEMA_VERSION 1→2 | `op.ts:11`；「读 v1 段与现状逐字节等价」由 §3 的字节级 roundtrip 用例证明（`encodeSegment(decodeSegment(V1))===V1` 原文） |
| §0.3 字段级 LWW | 写入侧 patch 语义：`applyLwwField`（replay.ts:104-135）——payload 只含变更 key、按键合并、`null` 删键、同 key 按 (lamport, deviceId) 全序决胜；未出现 key 保留原值 |
| §0.4 crdt_update 不参与 LWW | replay 主循环分派层（replay.ts:216-219）在进 LWW 判定**之前**拦截收集；不推进实体 lamport（`不与 lww op 抢占同一实体的 lamport 判定` 用例证明） |
| §0.5 不做 | 未引 Yjs、未动 editor/sync/desktop 接线（两处类型级例外见 DEVIATIONS-1/2）、未做 move/reorder 的 CRDT |

**crdtUpdates 收集结构（命名自洽说明）**：

```ts
interface CrdtUpdateEntry {
  opId: string;                                   // 来源 op 的 op_id（去重键，可回溯 op_ledger 审计链）
  target: { table: TargetTable; id: EntityId };   // op 的目标引用（crdt_update 固定 target=page）
  pageId: string;                                 // payload 声明的页级 Y.Doc 键（与 target.id 兜底关系）
  updateB64: string;                              // 原样透传的 base64 增量
  svFromB64?: string;                             // 可选状态向量水位，原样透传
}
// ReplayReport.crdtUpdates: CrdtUpdateEntry[]
```

命名理由：① 收集顺序 = replay 全序（lamport, deviceId, op_id 升序），与输入顺序无关，去重键取 `opId`（段内 op_id 本就唯一，且是 op_ledger 的审计主键，重复段合并时天然幂等）；② 保留 `target` 是为了 T19-04 merger 分流时不必再回查 payload（payload 的 `pageId` 是业务键、`target.id` 是路由键，正常两者相等，畸形时以 `target.id` 兜底）；③ `svFromB64` 保持 op payload 原名（下划线→驼峰与 report 既有字段 `conflicts` 的驼峰风格一致），供 T19-04 做增量裁剪（`Y.encodeStateAsUpdate(doc, sv)`）。core 对 `updateB64` 零解释，保证「Yjs 换任何 CRDT 引擎都不动 core」。

## 3. 测试与「修复前红→修复后绿」证据

新增 `packages/core/test/merge-policy.test.ts` 13 条：对照组（整对象 upsert 蒸发复现）1 + lww-field 6（per-key 核心收益 / 跨批次收敛 / 同 key 并发 / null 删键与未出现 key 保留 / 重复重放幂等 / 混合集 50 轮乱序全等）+ crdt_update 3（不进投影按全序收集 / 重复与乱序收集一致 / 不抢占实体 lamport）+ v1 兼容 3（v1 段字节级 roundtrip + 投影逐字段相等 / 未来段拒绝 / v1 快照可读）。

**修复前红**（将 `op.ts/projection.ts/replay.ts/segment.ts/snapshot.ts` 临时回退到 HEAD 版本，仅跑新测试文件；证据全文存 `_scratch/t19-02-wip/red-run.txt`）：

```
 Test Files  1 failed (1)
      Tests  7 failed | 6 passed (13)

 FAIL … > lww-field > 跨批次增量 replay 同样保留两处改动（分批顺序无关，收敛性）
AssertionError: expected { k2: 'B' } to deeply equal { k1: 'A', k2: 'B' }
  → A 的 k1 单元格写被整单蒸发（SPIKE §2 表 2 的 46.6% 在单测层面的复现）
 FAIL … > lww-field > null = 删除该 key；未出现的 key 保留原值
AssertionError: expected true to be false
  → 旧 patch 语义把 null 当普通值写入（k1 变 JSON null），未删键
 FAIL … > crdt_update（3 条）
Error: replay：不支持的 op.kind crdt_update
```

（对照组「同基线两端各改一个 key（整对象 upsert）→ 恰好一端的单元格写丢失」在修复前后都通过——它是**旧写入约定下损失存在性**的表征证明，与 SPIKE 原型对照组同构。）

**修复后绿**（恢复新实现，同文件）：

```
 ✓  core  test/merge-policy.test.ts (13 tests) 16ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

## 4. 自跑验证（最后一条命令输出摘要）

| 命令 | 最后一次输出 | 对账 |
|---|---|---|
| `pnpm -C packages/core test` | `Test Files 9 passed (9) / Tests 51 passed (51)` | 既有 38 条全绿（未放宽断言）+ 新增 13 条 = 51 ✓ |
| `pnpm -r typecheck` | 9 包（core/platform/ui/sync/schema/editor/dbview/importer/desktop）全部 `Done`，`error TS` 计数 **0** | ✓ |
| `node packages/ui/tokens/no-magic.mjs` | `✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px` | ✓ |
| `git status --porcelain` | 见 §6 红线核验 | 见 DEVIATIONS-1/2 |

全仓 `pnpm -r test` 与 selftest 未跑（PM 收口）。

## 5. DEVIATIONS（待 PM 追认）

1. **`packages/editor/src/history.ts:192-196`（1 处 case + 注释，+5 行）**：`OpUndoStack` 对 `op.kind` 的穷尽性 switch 因 `OpKind` 扩入 `'crdt_update'` 而编译失败（`never` 收窄）。补显式 `case 'crdt_update'` 抛出与原 unknown kind 完全同文案的 Error。**运行时行为逐字节不变**（crdt_update 本来就该被 undo 拒绝），纯类型收敛；不修则 `pnpm -r typecheck` 无法 0 错，与红线二选一，取验证门。
2. **`apps/desktop/src/main/commit.ts:366-373`（1 处，+7 行）**：同上，page 物化的穷尽性 switch，补显式 case 抛 `CommitError('E_MALFORMED_OP', '未知 page op.kind：crdt_update')`，文案与原 unknown 路径一致，运行时行为不变。
3. **既有测试版本钉更新 4 处**（`op.test.ts:74`、`index.test.ts:6`、`replay.test.ts:150`、`convergence.test.ts:21/31` 类型收敛）：任务书强制 `SCHEMA_VERSION` 1→2，版本钉断言（钉住「当前版本」这一语义）随之前进；无任何断言被放宽或删除。
4. **snapshot v1 放行（判断项）**：任务书只明示「v1 **段**」可读；快照 `v` 校验同步放行 `[1, SCHEMA_VERSION]`，理由：v1 快照实体外形与 v2 完全一致（本次变更是纯 op 层只增不改），不放行则升级后设备读自己升级前写的快照会炸，违背「v1 照旧可读」的裁决精神。已加显式用例。
5. **PM 收口预警**：`packages/schema/test/schema.test.ts:49` 钉死 `SCHEMA_VERSION` 为 1（schema 包 re-export core 常量），在本红线（只许动 packages/core）内不可改，PM 全仓测试时会红，需一行改动（1→2）。

## 6. 红线核验

`git status --porcelain` 实际输出：

```
 M apps/desktop/src/main/commit.ts          ← DEVIATION-2
 M packages/core/src/op.ts
 M packages/core/src/projection.ts
 M packages/core/src/replay.ts
 M packages/core/src/segment.ts
 M packages/core/src/snapshot.ts
 M packages/core/test/convergence.test.ts
 M packages/core/test/helpers.ts
 M packages/core/test/index.test.ts
 M packages/core/test/op.test.ts
 M packages/core/test/replay.test.ts
 M packages/editor/src/history.ts           ← DEVIATION-1
?? packages/core/test/merge-policy.test.ts
```

`packages/{sync,dbview,importer,ui}`、`docs/mockups/**` 零 diff；`docs/tasks/` 仅有本报告（写入后）。除 DEVIATIONS-1/2 两处类型级例外，改动全部落在 `packages/core/**`。

## 7. 已知边界（留给 T19-04）

- **快照折叠坍缩字段时钟**：字段级时钟是投影内部状态、不进快照（projection.ts 注释已写明）。折叠点之后若重放一条全序低于折叠 lamport 的 `lww-field` 旧 op，会因时钟缺失而「复活」该 key。sync 侧由 op_id 去重 + manifest 水位保证折叠点前的事件不重投，T19-04 的 ydoc/快照设计需保持该前提（建议加对应收敛用例）。
- `crdt_update` 的段内 lamport 严格升序不变量未动（每条照常领 lamport，SPIKE §1.4.1），segment 校验零特判。

## PM 复跑

（PM 补）
