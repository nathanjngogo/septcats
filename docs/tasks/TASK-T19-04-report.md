# TASK-T19-04 交付报告 · 协作（CRDT）落地 3/4：sync 分流 / 快照折叠与播种 / 收敛总测扩展

> 工程师：CodeBuddy ｜ 日期：2026-09-18 ｜ 前置：T19-03 已交付（`94f8a08` 在历史中，开工 `git log -1` 实际 HEAD=`5657930`，为本任务书一笔 docs 提交，晚于且不触碰 T19-03 交付物）
> 纪律自检：不碰 git（无任何 git 写操作）；无占位符/TODO；既有测试断言语义零变更（全部为追加）；`packages/core`、`packages/editor`、`apps/**`、`packages/ui`、`packages/schema` 零改动；sync「纯逻辑零 IO」铁律保持（src/ 未新增任何 node:fs 引用，唯一 IO 面仍是 fs.ts）。

---

## 1. 交付表

| 文件 | 内容 |
|---|---|
| `packages/sync/src/errors.ts` | `SyncReport` 新增 `crdtUpdates: CrdtUpdateEntry[]` 字段（类型随动，`CrdtUpdateEntry` 复用 core.replay 导出；desktop 只消费不构造该类型，typecheck 零波及） |
| `packages/sync/src/merger.ts` | ① `mergeRemote` 报告并入 `crdtUpdates`：取 `core.replay` 收集结果中「opId ∈ 本轮远端新 op」的子集（与 applied 的幂等口径一致，本地已有的 update 不重复透出，避免上层重复应用）；② 新增导出 `mergeCrdtUpdates(existing, incoming)`：跨报告按 opId 去重取并集，保序（各输入假定已处 replay 全序，不重排、先到者留），同输入确定性；③ 模块头注释补规则 f（crdt_update 分流语义：不进 LWW、payload 字节保真、applied 照常入 op_ledger） |
| `packages/sync/src/snapshot.ts` | ① 新类型 `SnapshotCrdtUpdate`（`{opId, updateB64, svFromB64?}`）/ `SnapshotCrdtPage`（按 pageId 分组）/ `SeedFromSnapshotResult`；② `buildSnapshotText`：折叠集重放后，在 core `{v, entities}` 文本之上并列 `crdtUpdates` 区段（`groupCrdtUpdates` 按 pageId 首次出现序分组、页内保持 replay 全序、opId 已由 replay 去重；稳定键序序列化 → 同内容同字节）；自检升级为 `seedFromSnapshot` 往返；③ 新增 `seedFromSnapshot(snap, dev)`：seedOps 复用 `core.snapshotToOps`（v1 快照照常可读），crdtUpdates 读顶层区段——缺失（v1/v2 旧快照）→ 空数组，存在但畸形 → `SnapshotValidationError`（不静默吞坏行）；手写校验、零 zod 引入（保持 sync 零运行时依赖，见 DEVIATIONS-1） |
| `packages/sync/package.json` | devDependencies 新增 `yjs@13.6.32`（**仅测试用**，理由见 §2 裁决 6 行与 DEVIATIONS-2） |
| `packages/sync/test/merger.test.ts` | **新增 6 条用例**（字节保真 ×2、跨报告合并 ×3、轮换路径 ×1，见 §3） |
| `packages/sync/test/snapshot.test.ts` | **新增 6 条用例**（crdtUpdates 区段往返/确定性/空区段/v1 兼容/畸形校验/S5 播种追平） |
| `packages/sync/test/writer.test.ts` | **新增 2 条用例**（特大 update 攒段不变量） |
| `packages/sync/test/convergence.test.ts` | **新增 1 条用例**（4 设备 × 3 轮并发文本场景，yjs 生成/校验真实增量） |
| `docs/tasks/TASK-T19-04-report.md` | 本报告 |

`packages/sync/src/writer.ts`：**零改动**——攒段四触发器对 crdt_update 天然成立（§0.5 只补测试钉）。

## 2. PM 裁决逐条消费

| 裁决 | 落地 |
|---|---|
| §0.1 sync 不引 yjs 运行时依赖、payload 字节不透明 | sync 全程不解码 `updateB64`（base64 文本透传，与加密层同思路）；yjs 仅 devDependencies（测试 §2.4 生成真实增量用），`src/` 无任何 yjs import |
| §0.2 快照新增 crdtUpdates 区段、不丢不折叠；v1 读成空数组 | `snapshot.ts`：`buildSnapshotText` 把折叠集 replay 收集的条目按 pageId 分组并列进快照顶层（`{v, entities, crdtUpdates}`）；`seedFromSnapshot` 缺区段 → `[]`；core 的 `snapshotSchema` 对未知键 strip → **v2 core 直接读 sync 快照不受影响**（实体外形照常解析），向后兼容由「读端忽略 + 写端追加」双保证 |
| §0.3 播种返回带 crdtUpdates | `seedFromSnapshot(): { seedOps, crdtUpdates }`；desktop 建 Y.Doc 的消费面归 T19-05 |
| §0.4 merger 报告合并 crdtUpdates（opId 去重 + 既有全序稳定排序）；段合并字节保真 | `mergeRemote` 报告透出（全序、opId 去重、仅远端新 op）；`mergeCrdtUpdates` 保序并集助手供跨轮积累；字节保真由 §3 用例 1 钉死（`encodeOp(applied) === encodeOp(original)` 逐字节，含 `+/=` 真实 base64 字符与可选 svFromB64） |
| §0.5 攒段：特大 update 由 maxBytes 自然切段 + 测试钉不变量 | `writer.ts` 零改动；§3 用例 9/10 钉住：全部 op 无丢失、段内 lamport 严格升序（validateSegment []）、段边界恒切在「第一个越限 op」处（多 op 段去掉末位 op 后 < maxBytes）、单条超限者独占段、op 行绝不被截破、base64 ×4/3 膨胀后 updateB64 逐字节保真 |
| §2.4 yjs 作 devDependency 理由 | 4 设备并发文本场景需要**真实 Yjs 增量**（而非手造 base64）才有收敛说服力：用 yjs 生成每轮 diff update（`encodeStateAsUpdate(doc, prevSv)`），经 sync 段管线合并后回灌 Y.Doc，以「4 设备文本逐字符一致 + 等于全量增量灌入新 Doc 的真值」作断言。仅进 `devDependencies`，运行时零依赖（§0.1 红线不受影响）；版本 13.6.32 与 T19-01 SPIKE 原型一致 |

## 3. 新增用例清单（15 条）

**merger.test.ts（+6）**

1. `mergeRemote T19-04 crdt_update 字节保真`：含 2 条 crdt_update + 1 条 upsert 的段合并后，applied 逐字节等于原编码（`encodeOp` 相等）、`opId` 集合不变、报告 crdtUpdates 按 c 升序原样透传（含 svFromB64 一带一缺）。
2. `本地已有的 crdt_update 不重复透出`：localLedger 含该 op → already-applied + crdtUpdates 空（与 applied 幂等口径一致）。
3. `mergeCrdtUpdates 并集按 opId 去重（先到者留），各自全序保持`。
4. `mergeCrdtUpdates 确定性：同输入两次调用结果逐项一致`（§2.2）。
5. `mergeCrdtUpdates 两份相同列表合并 → 等于自身（自并集幂等）`。
6. `轮换路径不漏目标（§2.6，sync 层不变量）`：含 crdt_update 的段与快照都在 provider `listSegments`/`listSnapshots` 枚举内（不漏目标）；模拟重加密的「读→重写→读」逐字节相等；重写后的段再合并 applied/crdtUpdates 与原结果一致、重写后的快照播种 seedOps+crdtUpdates 双双无损。

**snapshot.test.ts（+6）**

7. `折叠含 crdt_update 的段 → 区段按 pageId 分组原样保留；播种返回 seedOps+crdtUpdates`（§2.3：实体投影与 crdtUpdates 双双无损）。
8. `确定性：同输入两次 buildSnapshotText 输出逐字节一致`。
9. `无 crdt_update 的段 → 区段为空数组（新写快照恒含该键）`。
10. `v1 旧快照（无该区段）→ 读成空数组不报错，seedOps 正常`（§2.3）。
11. `畸形 crdtUpdates 区段 → SnapshotValidationError`（6 种坏形逐一拒收）。
12. `S5 纯逻辑面：含 crdt 的快照播种 + 增量段重建 → 实体投影逐字节追平 + crdtUpdates 集合追平`。

**writer.test.ts（+2）**

13. `接近 maxBytes 的大条目：段切分正确、边界恒切在第一个越限 op 处、lamport 序不变量保持、字节保真`（§2.5）。
14. `多条大 update 相邻：字节触发把段边界切在 op 之间，绝不切破单条 op`（逐行 JSON 可解析钉行完整性）。

**convergence.test.ts（+1）**

15. `4 设备并发文本收敛（§2.4）`：4 设备 × 3 轮——每设备本地编辑 Y.Text 生成真实 Yjs 增量（crdt_update op）+ 2 条常规实体 op，随机切成 1..3 段、写入顺序确定性洗牌（乱序到达），每设备各自 `mergeRemote` 入账 + crdtUpdates 逐条 `applyUpdate`。断言：① 4 设备 Yjs 文本逐字符一致且等于全部增量灌入新 Doc 的真值；② 4 设备实体投影（opsToSnapshot）逐字节相等；③ 4 设备已应用 crdtUpdates 的 opId 集合相等且 = 全集（一台不漏）。

## 4. 命令输出摘要

```
pnpm -C packages/sync test
  Test Files  10 passed (10)
       Tests  98 passed (98)          # 交付前 83 → 98（+15）

pnpm -r typecheck
  9/9 通过（core/schema/sync/editor/dbview/importer/desktop(node+web)/root），0 错

node packages/ui/tokens/no-magic.mjs
  ✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

## 5. DEVIATIONS

- **DEVIATIONS-1（待 PM 追认）**：`seedFromSnapshot` 的 crdtUpdates 区段校验为**手写守卫**而非 zod schema——sync 包运行时依赖集原本只有 `@septcats/core`，引 zod 即新运行时依赖，与 §3 红线「运行时零新依赖」冲突；校验严格度对齐 encodeOp 边界（坏行显式抛 `SnapshotValidationError`，不静默跳过）。若 PM 希望口径统一到 zod，需一并批准 sync 增加 zod 依赖。
- **DEVIATIONS-2（任务书已预告）**：`packages/sync/package.json` devDependencies 新增 `yjs@13.6.32` + 根 `pnpm-lock.yaml` 相应变化（任务书 §3 明示允许，理由见 §2 末行）。`src/` 零 import，运行时零依赖红线不破。
- **DEVIATIONS-3（待 PM 追认）**：`SyncReport` 新增字段 `crdtUpdates` 的口径为「仅本轮对本地为新 op 的 crdt_update」——replay 收集结果里来自 localLedger 的条目被过滤（避免 desktop 每轮把本地已有 update 重复 applyUpdate）。若 PM 认为报告应透出全量（含本地），改为不过滤是一行改动，但幂等性依赖上层自行保证。
- **DEVIATIONS-4（范围说明，非偏差）**：§2.6 轮换路径的真机 `rotateKey`/`reencryptAllSegments` 在 `apps/desktop/src/main/sync/runtime.ts`（红线禁触），本任务在 sync 层钉住其依赖的两个不变量——provider 枚举不漏含 crdt_update 的段/快照 + 文件读-写-读字节保真；真机轮换冒烟归 T19-05/PM 收口。
- **DEVIATIONS-5（观察项）**：快照 crdtUpdates 区段在「多代快照接力 + 老段已被 GC」场景下的语义（新快照只携带本轮折叠段的 update，更早 update 由 desktop 侧 Y.Doc 状态与更老快照文件承接）属 T19-05 接线设计输入，sync 层已按「不丢不折叠」原样透传，不做跨快照聚合。

## 6. PM 复跑

（T19-04 交付后 PM 独立复跑，2026-09-17）
```
pnpm -C packages/sync test   →  Test Files 10 passed (10) / Tests 98 passed (98)   ← 83→98（+15）
pnpm -r typecheck            →  9/9 Done
node packages/ui/tokens/no-magic.mjs → ✓
红线核验：git status 仅 packages/sync/** + 报告 + package.json/lockfile（yjs devDep）；core/editor/apps/ui/schema 零改动 ✓
DEVIATIONS 1–5 全部追认：①手写守卫替代 zod（sync 引 zod = 新运行时依赖，拒）②yjs devDependency（任务书明示允许）③报告 crdtUpdates 仅远端新 op（与 applied 幂等口径一致）④rotateKey 真机归 T19-05（sync 层钉两不变量已足）⑤跨代快照聚合为 T19-05 设计输入
```
