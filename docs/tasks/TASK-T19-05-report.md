# TASK-T19-05 交付报告 · 协作（CRDT）落地 4/4：desktop 接线 + 真机双实例冒烟

> 工程师：CodeBuddy ｜ 日期：2026-09-18 ｜ 前置：T19-04 已交付（开工 `git log -1` HEAD=`bb48f7b`，为 T19-05 任务书一笔 docs 提交，晚于 T19-04 交付 `df68d57` 及 docs 补充 `96eb6ed`）
> 纪律自检：不碰 git（无任何 git 写操作）；无占位符/TODO；既有测试断言零变更（全部为新增用例）；`packages/{core,sync,editor,ui,schema}` 零改动；UI 零视觉变化（协作无可见控件，未新增任何 DOM/i18n 键）。

---

## 1. 交付表

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/shared/collab.ts` | **新增**：协作 IPC 线上契约（`CollabUpdateEntry`/`CollabAttachResult`/`CollabUplinkInput`），纯形状不 import electron/node/@septcats/*（照 shared/sync.ts 纪律） |
| `apps/desktop/src/shared/ipc.ts` | `collab:attach`/`collab:detach`/`collab:apply` 三通道 + `collab:update` 推流通道 + `COLLAB_CHANNELS`（§0.2 允许的「新增通道走 septcats.* 命名」路径；既有 AI/同步 IPC 通道零改动） |
| `apps/desktop/src/main/collab.ts` | **新增**：`CollabHub`——pageId→YjsEditor 缓存（LRU 32 页、attach/detach、destroy 幂等）、上行组 Op（`crdt_update` op_id=ulid、lamport=op_ledger 全局水位+1、`merge_policy='crdt'`，只进真相层不物化）、下行 `applyRemote` 按 pageId 路由、attach 播种集（快照区段聚合 ∪ 账本 op，opId 覆盖去重）、`registerCollabIpc`（registrar 注入范式，纯 Node 可测） |
| `apps/desktop/src/main/sync/runtime.ts` | ① cycleBody 下行分流：`applied` 拆为实体 op（照走 filterAgainstLedger + commitOps）与 `crdt_update` op（绕开水位过滤、`ledgerStatement` 单独入真相层、不物化）→ `onCrdtUpdates` 监听器路由报告条目；② 首轮 ledger 计数校验并入 crdtOps 数；③ 新增 `getSnapshotCrdtUpdates()`：聚合**全部**快照文件的 crdtUpdates 区段（seq 升序、按 pageId 合并、opId 去重——消化 T19-04 DEVIATION-5 跨代接力） |
| `apps/desktop/src/main/index.ts` | 接线：SyncRuntime 构造后、`runtime.start()` 之前建 CollabHub（上行走 withSyncHook 装饰 executor；下行 onCrdtUpdates → hub.applyRemote + `collab:update` 广播各窗口；播种接 runtime 跨代聚合口）；`registerCollabIpc`；will-quit `hub.dispose()`。executor 装饰点上移（语义不变，协作与页面/行内库/搜索/导入器共用同一装饰面） |
| `apps/desktop/src/preload/index.ts` | `collab` 四方法（attach/detach/apply/onUpdate），通道名单一来源 |
| `apps/desktop/src/types/window.d.ts` | `SeptcatsCollabApi` + `septcats.collab` 字段（仅新增，不动既有接口） |
| `apps/desktop/src/renderer/src/collab/collabClient.ts` | **新增**：renderer 侧每页一个 `YjsEditor`（attach 到 Tiptap）；attach 先取 main 播种集再构造（Y 非空→Y→PM 投影 / Y 空+PM 有内容→PM→Y 种子，T19-03 语义，时序上保证双端不各自种子）；onOp→`collab:apply`；`collab:update` 按 pageId 路由；detach 先 sync() 冲防抖尾再 IPC 释放 |
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | 编辑器就绪后 `attachCollab(page.id, editor)`、销毁/换页 `detachCollab`（unmount 竞态用 cancelled 守卫）；无任何 UI 变更 |
| `apps/desktop/test/collab.test.ts` | **新增 12 条用例**（§4） |
| `apps/desktop/package.json` + `pnpm-lock.yaml` | devDependencies 新增 `yjs@13.6.32`（**仅测试用**，见 DEVIATIONS-1） |
| `docs/tasks/TASK-T19-05-report.md` | 本报告 |

## 2. 接线图（短说明）

```
renderer PageView ──collab:attach(pageId)──▶ main CollabHub（LRU 32 页：pageId → YjsEditor）
   │ YjsEditor(Tiptap 绑定,进程内)                  │ 创建时播种 = 全部快照 crdtUpdates 区段聚合
   │   ◀──────── collab:update 推流（下行）─────────┤   (runtime.getSnapshotCrdtUpdates) ∪ op_ledger crdt op
   │   onOp（Y.Doc 防抖 100ms → base64 payload）    │   （opId 覆盖去重，Yjs 幂等应用）
   └──collab:apply──▶ 组 crdt_update Op（op_id=ulid、lamport=账本全局水位+1、merge_policy='crdt'）
                       │ 只写 op_ledger（真相层，不物化）→ withSyncHook → SyncRuntime.onLocalCommit
                       ▼                            → 攒段 → publishSegment（既有管线，加密层不变）
              sync 文件夹（段/快照/manifest；rotateKey 复用 reencryptAllSegments 按文件全链覆盖）
                       ▼ 对端实例（同网盘目录）
              mergeRemote 报告.crdtUpdates ─▶ runtime.ts 下行分流：op 入真相层（不物化、
                                              绕开 lamport 水位过滤）→ onCrdtUpdates 监听
                                              → hub.applyRemote（按页应用）+ collab:update 广播
```

要点：①hub 是「已入账增量」的汇聚点（上行先入账再应用 doc，doc 状态 ⊆ 快照∪账本，任何时序下 attach 播种都能完整重建）；②主进程零直接 yjs import——Y 操作全部经 T19-03 `YjsEditor` 封装面；③实体 op 与 crdt op 同段共存，互不过滤（§0.6 单测代理）。

## 3. §0 PM 裁决逐条消费

| 裁决 | 落地 |
|---|---|
| §0.1 LRU 缓存/attach/detach | `CollabHub.pages`（Map 插入序即 LRU，命中刷新新近度）、默认 32、`evictOldest` flush+destroy、destroy 幂等（用例 D） |
| §0.2 IPC/组 Op/下行路由 | 三通道 + 推流；组 Op 与普通 op 同管线（真相层 batch → 装饰 hook → 攒段器）；下行按报告口径（opId 去重、仅远端新 op）路由（用例 A/B/E） |
| §0.3 跨代快照聚合 | attach 播种 = 全部快照区段（跨代聚合，消化 T19-04 DEVIATION-5）∪ 账本 crdt op，opId 覆盖去重，Yjs 幂等（用例 C/F） |
| §0.4 rotateKey 真机 | 代码零特殊处理：crdt_update 与实体 op 同走段/快照管线，重加密按文件枚举天然覆盖；单测 G 钉「加密段轮换重加密 → 新会话文本可还原」，真机 completion 归 PM |
| §0.5 默认开/单端一致 | 无配置项；单端可观察行为（实体投影/物化/普通管线）逐字节一致——用例 A 钉 crdt 只进真相层（独占单语句 batch、零物化语句）、用例 E 钉实体 op 不受影响。对「只在对端存在时产生」的字面解读见 DEVIATIONS-3 |
| §0.6 双实例冒烟 | 主代码接线完备（§2 接线图）；冒烟由 PM CDP 脚本承接。提示：单实例锁按 userData 隔离，双实例需两份 userData 指向同一网盘目录；建议先开 A 待段同步后再开 B（首开种子竞态见 DEVIATIONS-5） |

## 4. 新增用例清单（test/collab.test.ts，12 条）

**A. 上行组 Op（3）**：① lamport=账本水位+1、merge_policy='crdt'、payload 保真、**独占单语句 opLedger.insert batch（零物化——§0.5 钉）**；② 连续上行 lamport 严格递增 + hub Y.Doc 收到增量且 pendingOpCount=0（REMOTE origin 防回环）；③ 页未 attach 时上行照常入账（不丢数据）。

**B. 下行路由（1）**：④ applyRemote 按 pageId 路由、未开页忽略、跨页条目绝不串页。

**C. attach 播种（3）**：⑤ 快照区段 ∪ 账本 op（opId 覆盖去重、按页过滤）→ 种子重建三段文本齐全；⑥ 关闭重开文本从账本还原（PageView 生命周期）；⑦ 同页在途 attach 合并为同一 Promise（不重复建实例）。

**D. LRU（1）**：⑧ 超限淘汰最久未访问者（命中刷新新近度）、detach 幂等。

**E. 双实例集成（1）**：⑨ A 上行→段发布→B 追平：报告路由恰一次含 A 的 opId、真相层入账、实体投影逐字节追平、crdt batch 零物化、已见段不重复路由/入账（§0.6 普通管线不受影响的代理钉）。

**F. S5 跨代播种（1）**：⑩ 折叠快照 → 段移除 → 新设备（空账本）attach 纯快照还原文本。

**G. rotateKey 全链（1）**：⑪ 加密段含 crdt_update → rotateKey 重加密（failed=0）→ 新会话（空账本、持新钥）追平仍收到 crdt_update 且文本无损（DEVIATION-4 消化）。

**IPC 面（1）**：⑫ 三通道走 hub、hub 缺失回 E_INVARIANT、参数非法回 E_MALFORMED。

## 5. 命令输出摘要

```
pnpm -C apps/desktop test（pretest = node scripts/ensure-abi.mjs node）
  Test Files  30 passed (30)
       Tests  313 passed (313)          # 交付前 301 → 313（+12）
  注：首轮全量跑 perf 用例因并行负载出红（111.3ms > 16ms，性能史上有同款波动记录），
  静置后单独复跑 4/4 全绿，随后全量复跑 313/313 全绿。

pnpm -r typecheck
  9/9 通过（core/schema/sync/editor/dbview/importer/desktop(node+web)/root），0 错

node packages/ui/tokens/no-magic.mjs
  ✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px

pnpm -C apps/desktop build（附加自证：main 打包含协作枢纽，4863 modules transformed）
```

## 6. DEVIATIONS

- **DEVIATIONS-1（待 PM 追认）**：`apps/desktop/package.json` devDependencies 新增 `yjs@13.6.32` + 根 lockfile 相应变化——仅测试侧生成真实 Yjs 增量用（与 T19-04 的 sync devDep 同理由）；版本与 `packages/editor` 完全一致（同一 .pnpm 实例，无双实例风险），主进程运行时零 yjs import。任务书「desktop 直接用即可，不得重复声明锁定不同版本」按「同版本声明允许」口径执行；若 PM 认为 devDep 也不可，替代方案是测试内手造 base64（收敛说服力下降）。
- **DEVIATIONS-2（待 PM 追认）**：runtime.ts 下行入账让 `crdt_update` op **绕开 filterAgainstLedger**——该函数按 `(table,id)` 的 lamport 水位过滤（为 LWW 实体 op 的 S5 决胜漂移而设），会把跨设备低水位的文本 op 误杀（文本 op 的 lamport 取各设备本地全局水位，跨设备无单调性）；其幂等由 mergeRemote 的 op_id 去重 + Yjs 幂等应用双重保证。
- **DEVIATIONS-3（解读声明，待 PM 裁决）**：§0.5「crdt_update 只在对端存在时产生」按「单端可观察行为逐字节一致」消费（crdt op 仅进真相层、不碰任何实体/物化/普通管线，用例 A/E 钉住）；本机编辑产生的 crdt op 在无对端时**也会入账本**——它是本地文本的持久层与关页重开的还原来源，不入账则关页即丢文本，与 §0.3「不允许只取一边（会丢文本）」矛盾。若 PM 要求字面门控（无对端不产生），需引入对端存在性判定（新状态面），与「协作默认开、无配置项」冲突，故未实现。
- **DEVIATIONS-4（实现取舍，待 PM 追认）**：`collab:attach` 回包为「播种条目集」而非 Y.Doc 全量状态序列化（encodeStateAsUpdate）——语义等价（hub 只收已入账增量，快照区段 ∪ 账本 op ≡ hub 文档状态，renderer 注入重建 Yjs 幂等收敛），收益是主进程零直接 yjs import（Y 操作全部经 T19-03 `YjsEditor` 封装面，不新增 runtime 依赖声明）。若 PM 偏好状态序列化口径，需 desktop 声明 yjs 运行时依赖。
- **DEVIATIONS-5（观察项，冒烟提示）**：两台空设备**同时**首次打开同一页会各自种入初始内容（「双端不得各自种子」约定的跨设备版本，IPC 时序只能保证单设备内不重复）——真机冒烟建议先开 A、待段同步后再开 B；后续任务把页面内容接到真实 DB 内容源后，初始内容统一来自账本，该竞态自然消失。另：本地编辑时 sync 处于关闭态产生的 op 不进攒段器（与实体 op 的既有语义一致），重新开启同步后这部分历史不入段。

## 7. PM 复跑

（T19-05 交付后 PM 独立复跑，2026-09-18）
```
node apps/desktop/scripts/ensure-abi.mjs node   → Node ABI ✓（DB 测试不静默 skip）
pnpm -C apps/desktop test    →  Test Files 30 passed (30) / Tests 313 passed (313)   ← 301→313（+12 collab）
pnpm -r typecheck            →  9/9 Done，0 错
node packages/ui/tokens/no-magic.mjs → ✓
pnpm -C apps/desktop selftest → SELFTEST OK
pnpm -r test                 → 全仓 837/837 无红（core 51 / ui 61 / schema 3 / sync 98 / editor 157 / dbview 95 / importer 59 / desktop 313）
红线核验：git diff --stat packages/ = 0 行（core/editor/sync/ui/schema 零改动）✓
```
**DEVIATIONS 1–4 追认**：①desktop devDep yjs@13.6.32（与 editor 同版本，pnpm 提升为同实例，仅测试用）✓ ②crdt op 绕开 `filterAgainstLedger`——裁决**正确且必要**：该过滤按 (table,id) lamport 水位，page 维水位会被实体 op 抬高，跨设备低水位文本 op 必被误杀；幂等由 op_id 去重 + Yjs 应用天然幂等双保险 ✓ ③crdt op 单端也入账本——**接受**：账本是真相层，「关页重开还原」必须依赖它，符合 §0.5「无对端时行为逐字节一致」的正确读法（无对端 = 无 crdt op 产生，而非产生了不落）④attach 回播种条目集（非 state vector 压缩）——语义等价，且 hub 播种集 ⊆ 快照∪账本 的推导成立。
**DEVIATION-5（双空同开重复种子）登记为已知限制**：本期以「先开 A 同步、再开 B」为验收流程；根治方案 = attach 时若 hub 侧该页账本已有任何 crdt op 则跳过 PM→Y 种子（种子只在「账本为空」时上行）。真机双实例 CDP 冒烟由 PM 收口。
