# TASK-T19-04 · 协作（CRDT）落地 3/4：sync 分流 / 快照折叠与播种 / 收敛总测扩展

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T19-03 已交付（HEAD `94f8a08`，开工 `git log -1` 确认）
> 依据：`docs/tasks/TASK-T19-01-SPIKE-report.md` §1.5 T19-04 行 + 风险 3（base64 膨胀 ×4/3 与攒段）

## 0. PM 裁决（先定死，勿另择方案）

1. **sync 不引入 yjs 依赖**：sync 层对 `crdt_update` 的 payload 保持**字节不透明**（与加密层同思路）。折叠/合并 Yjs 增量是 desktop 层的事（T19-05）。
2. **快照里 crdt_update 不丢、不折叠**：快照新增独立区段承载 `crdt_update` 条目（按 pageId 分组的 `{opId, updateB64, svFromB64?}` 列表），与实体投影并列。语义：**实体投影仍由 LWW/字段级 LWW 折叠**；crdt_update 原样保留（Yjs 增量本身可重复应用、幂等，不需要在 sync 层合并）。
3. **播种扩展**：`seedFromSnapshot`（或等价 API）返回结构必须带上快照中的 `crdtUpdates`，供 desktop 层建 Y.Doc（否则新设备同步后文本层是空的）。
4. **merger 分流**：`ReplayReport.crdtUpdates` 跨报告合并 = 按 `opId` 去重取并集（顺序按既有全序 `(lamport, deviceId)` 稳定排序）；段合并路径**字节保真**（不得因未知 kind 丢弃或改写 payload）。
5. **攒段**：单条特大 update（base64 ×4/3 膨胀）由既有 `maxBytes` 攒段策略自然切段；补测试钉住「不变量不破 + 段内 lamport 严格升序」。

## 1. 实现清单（只动 packages/sync）

- `src/merger.ts`（或实际所在文件）：报告合并时并入 `crdtUpdates`（去重+稳定排序）；确认段合并/裁剪路径对 `crdt_update` 字节保真。
- `src/snapshot.ts`（或实际所在文件）：快照结构新增 crdtUpdates 区段（**向后兼容**：v1 快照无此区段 → 读成空数组；新写快照含之）；`seedFromSnapshot` 返回带 crdtUpdates。
- `src/` 其余按需：仅签名/类型随动，**不改既有行为**。
- 如 sync 内部有 kind 白名单/switch：补 `'crdt_update'` 分支（与 T19-02 core 的 `OP_KINDS` 对齐）。

## 2. 测试（必须真做）

1. **字节保真**：含 crdt_update 的段 → 合并/切段/再合并后，各条目 `updateB64` 与原值**逐字节相等**、`opId` 集合不变。
2. **报告合并去重**：两份含重叠 crdtUpdates 的报告 → 并集按 opId 去重、顺序稳定（同输入两次调用结果逐字节一致）。
3. **快照往返**：写快照（含 crdtUpdates）→ 读回/播种 → crdtUpdates 与实体投影双双无损；**v1 旧快照**（无该区段）读成空数组不报错。
4. **4 设备并发文本场景**（SPIKE §1.5 要求）：4 设备 × 各自发 crdt_update + 常规实体 op × 多次切分/乱序到达 → 全部设备实体投影逐字节相等 + crdtUpdates 集合相等（**可在测试中用 yjs 作 devDependency 生成/校验真实 Yjs 增量**；运行时仍不依赖）。
5. **特大 update 攒段**：构造接近 `maxBytes` 的 base64 大条目 → 段切分正确、无超限、lamport 序不变量保持。
6. **密钥轮换路径**（runtime.ts rotateKey/reencrypt）：含 crdt_update 的段/快照在目标集内被正常重加密（不得漏目标 → 假红条）。

## 3. 红线

- 只动 `packages/sync/**` + 报告；`packages/core`、`packages/editor`、`apps/**`、`packages/ui`、`packages/schema` 零改动。
- **运行时零新依赖**（yjs 只可作 devDependency，且需在报告说明理由）。
- 不碰 git；禁占位符/TODO；既有测试断言语义不变（只许追加/随动版本钉）。
- sync「纯逻辑零 IO」铁律保持（既有 grep 断言必须继续通过）。

## 4. 交付物

`packages/sync/` 改动 + `docs/tasks/TASK-T19-04-report.md`（交付表 / 关键决策落地 / 新增用例清单 / 命令输出摘要 / DEVIATIONS / PM 复跑节留「（PM 补）」）。

## 5. 收尾自跑

`pnpm -C packages/sync test`（全绿，含新增）、`pnpm -r typecheck`（0 错）、`node packages/ui/tokens/no-magic.mjs`。全仓与 selftest 由 PM 收口。