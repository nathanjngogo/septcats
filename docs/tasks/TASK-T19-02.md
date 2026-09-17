# TASK-T19-02 · 协作（CRDT）落地 1/4：core op schema v2 + 字段级 LWW + `crdt_update`

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T19-01 SPIKE 已交付（HEAD `e84476a`，开工 `git log -1` 确认）
> 依据：**先通读 `docs/tasks/TASK-T19-01-SPIKE-report.md` 的 §1.4 / §1.5（T19-02 行）**，本任务书是其落地化；报告里的 E 编号与 `file:line` 即为取证索引。
> 纪律：不碰 git；禁占位符/TODO；不改既有测试断言语义（只许追加）；不新增依赖；不要跑全仓 `pnpm -r test` / selftest（PM 收口）。

## 0. PM 裁决（照此实现，勿另择方案）

1. **范围 = 只动 `packages/core`**（+ 其测试）。sync / editor / desktop 的接线是 T19-03/04/05，本任务不碰。
2. `packages/core/src/op.ts`：
   - `OP_KINDS` 追加 `'crdt_update'`；其 payload 为 `{ pageId: string; updateB64: string; svFromB64?: string }`（base64 文本，**core 不 base64 解码、视为不透明**）。
   - `MERGE_POLICIES` 由 `['lww']` 扩为 `['lww','lww-field','crdt']`（zod 由字面量改 union；**远端 v1 段照旧可读**）：`crdt_update` 固定 `'crdt'`；record 值写入固定 `'lww-field'`；其余实体 op 保持 `'lww'`。
   - `SCHEMA_VERSION` 1→2（导出常量），并保证**读 v1 段语义与现状逐字节等价**。
3. **record 值改字段级（key 粒度）LWW**：
   - 写入侧 op payload 只携带**变更的 key**（`patch: { [key]: value }`），不再整对象 upsert；
   - replay 对 `lww-field` op **按键合并**进现有投影：payload 里出现的 key 覆盖，未出现的 key **保留原值**；
   - **`null` = 删除该 key**（写清语义并测试）；并发同 key → 按既有全序（lamport，deviceId）确定胜者。
4. **`crdt_update` 不参与 LWW**：replay **不**将其作用于实体投影，而是按序**收集**到返回值（结构由你定，如 `crdtUpdates: { target: string; updateB64: string }[]`，命名自洽并在报告说明）。core 只需保证：① 不进 LWW 判定；② 重复/乱序应用不影响收集结果；③ 段内 lamport 严格升序不变量保持不变。
5. **不做**：Yjs 依赖引入（T19-03 才引）、editor/sync 接线、move/reorder 的 CRDT（SPIKE §1.5 明确不建议）。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/core/src/op.ts` | 上述 §0.2 全部（kinds/policies/SCHEMA_VERSION/payload zod + 注释写清 policy 语义） |
| `packages/core/src/replay.ts` | 按 `merge_policy` 分派：`lww`（现状不变）/ `lww-field`（按键合并 + `null` 删键）/ `crdt`（收集不投影）；保持全序与幂等语义 |
| `packages/core/src/index.ts`（如需要） | 导出新常量/类型 |
| `packages/core/test/*.test.ts` | §2 用例（追加，既有断言不动） |
| `docs/tasks/TASK-T19-02-report.md` | 交付表 / 裁决消费 / 「修复前红→修复后绿」证据 / 自跑输出 / DEVIATIONS（PM 复跑节留「（PM 补）」） |

## 2. 测试（必须真做，含「修复前红」证明）

1. **per-key 并发（核心收益）**：两客户端同基线，A 改 `k1`、B 改 `k2` → 按任意顺序 replay，**两端投影同时保留两处改动**。请先写一条**对照用例**证明「整对象 upsert 语义下会丢失其中一处」（修复前红），再写通过用例（修复后绿）——即 SPIKE §2 表 2 的 46.6% 蒸发在单测层面的复现与修复。
2. **同 key 并发**：两端同 key 不同值 → 全序（lamport，deviceId）确定胜者，两端结果一致。
3. **`null` 删键**与「未出现 key 保留」两条边界。
4. **`crdt_update`**：不进投影；按段序收集；同一条重复出现 / 乱序段合并后收集结果一致（幂等说明）；不与 `lww` op 抢占同一实体的 lamport 判定。
5. **v1 兼容回归**：既有 core 测试全绿即证（若有 v1 段夹具，补一条显式断言：v1 段投影结果与升级前逐字段相等）。

## 3. 验证与收尾

```bash
pnpm -C packages/core test        # 既有用例 + 新增全绿
pnpm -r typecheck                 # 9 包 0 错
node packages/ui/tokens/no-magic.mjs   # ✓
```
红线核验：`git status --porcelain` 只应出现 `packages/core/**` 与 `docs/tasks/TASK-T19-02-report.md`；`packages/{sync,editor,dbview,importer,ui}`、`apps/**`、`docs/mockups/**` 零 diff。
尾回复：改动文件清单 + 每条命令最后一次输出摘要（含计数对账）+「修复前红→修复后绿」原文 + 你为 `crdtUpdates` 收集结构选定的命名与理由。