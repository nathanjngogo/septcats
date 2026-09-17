# TASK-T19-05 · 协作（CRDT）落地 4/4：desktop 接线 + 真机双实例冒烟

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T19-04 已交付（HEAD `96eb6ed`，开工 `git log -1` 确认）
> 依据：`TASK-T19-01-SPIKE-report.md` §1.5 T19-05 行；`T19-04-report.md` DEVIATIONS-4/5（rotateKey 真机、跨代快照聚合的设计输入在此消化）

## 0. PM 裁决（先定死，勿另择方案）

1. **每页 Y.Doc 缓存与释放**：主进程维护 pageId → YjsEditor 的生命周期。PageView 打开时 attach、关闭/销毁时释放（复用 T19-03 的 `YjsEditor`，含 destroy 幂等）。缓存 LRU 上限（建议 32 页）防泄漏。
2. **IPC/I/O 面**：`crdt_update` op 在主进程侧完成 core 组 Op（lamport/op_id 与普通 op 同管线，已由 core v2 支持）；下行在 `mergeRemote` 报告到账后按 pageId 路由，交给对应 YjsEditor.applyCrdtUpdate（T19-03 已实现幂等）。**不改 preload/window.d.ts 的既有 AI/同步 IPC**，如需新增通道走 `septcats.*` 命名并补 d.ts。
3. **跨代快照聚合（消化 T19-04 DEVIATION-5）**：新设备/清缓存首次打开页时，若快照 crdtUpdates 与实时 op 之间存在代差，**以「快照 crdtUpdates + 其后 op 补丁」为基重建 Y.Doc**；不允许只取一边（会丢文本）。**本期实现策略**：取快照区段全部 + 快照之后到账的 crdt_update op（opId 覆盖判断，Yjs 幂等应用天然安全）。
4. **rotateKey 真机（消化 T19-04 DEVIATION-4）**：completion 用真机测试钉住——轮换后旧会话/新会话文本均正常（sync 层已保证枚举不漏+字节保真）。
5. **功能开关**：协作能力默认开（无配置项追加；无伙伴时行为与现状逐字节一致——crdt_update 只在对端存在时产生，单端路径回归钉住）。
6. **真机双实例冒烟是验收底线**（可与 T19-03 CDP 脚本复用或新开脚本）：同网盘目录双实例、同页并发编辑，两端文本收敛一致、无丢失；实体层（DB 值）并发同 key 按字段 LWW 收敛；文本协作期间普通页面操作（新建/改名/删块）不受影响。

## 1. 实现清单（只动 apps/desktop/src/main + renderer 接线面）

- `main/`：YjsEditor 缓存管理（attach/detach/LRU）、crdt_update 上行组 Op 接线、下行路由（mergeRemote 报告 → applyCrdtUpdate）、快照播种（seedFromSnapshot.crdtUpdates → YjsEditor 构造注入）、rotateKey 全链（含 crdtUpdates 段重加密，复用既有重加密路径）。
- `renderer/`：PageView 打开时初始化协作层、关闭时销毁；**不加新 UI**（协作无可见控件，保持 UI 红线）。
- `shared/` + `preload/` + `types/window.d.ts`：仅当确需新 IPC 通道时才动（否则零改动）。
- 测试：`apps/desktop/test/` 单测尽量覆盖接线（IPC 路由、LRU 释放、快照播种、轮换后文本仍同步）；wide 冒烟由 PM 真机 CDP 承接。

## 2. 红线

- 不碰 `packages/{core,sync,editor,ui,schema}`（本任务只接线，不改已交付契约；对不上就是接线错）。
- 不加新运行时依赖（yjs 已随 editor 依赖树存在，desktop 直接用即可，不得重复声明锁定不同版本）。
- 改动面收敛：优先 `apps/desktop/src/main/**` + `renderer` 装配点；**UI 零视觉变化**（协作无控件）。
- 不碰 git；禁占位符/TODO；既有测试断言语义不变。

## 3. 交付物

`apps/desktop/src/**` 改动 + `apps/desktop/test/**` 新增 + `docs/tasks/TASK-T19-05-report.md`（交付表 / 接线图短说明 / 新增用例清单 / 命令输出摘要 / DEVIATIONS / PM 复跑节留「（PM 补）」）。

## 4. 收尾自跑

`pnpm -C apps/desktop test`（先 `node apps/desktop/scripts/ensure-abi.mjs node`）、`pnpm -r typecheck`（0 错）、`node packages/ui/tokens/no-magic.mjs`。全仓与真机双实例冒烟由 PM 收口。