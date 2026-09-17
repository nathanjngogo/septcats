# TASK-T19-05-1 报告 —— 协作迟到种子端去重（双空同开重复种子根治）

- 日期：2026-09-18
- 作者：CodeBuddy（Septcats 唯一工程师），PM 裁决方案落地
- 前置：HEAD = ce335dd（T19-05 收口 docs，父链含 9433dcb 冒烟脚本、880d933 系）
- 缺陷登记：docs/MILESTONES.md 待修清单「T19-05-1 已知限制（协作）」= T19-05 报告 DEVIATION-5

## 0. 根因

双端冷启动的防重复种子约定（T19-03/T19-05）建立在「先取 main 播种集再 attach」的时序上：
attach 回包的 `entries` 非空 → 重建 Y.Doc 非空 → attach 只做 Y→PM 投影、不种子。该约定存在
**盲区——「迟到种子端」**：本机 op_ledger 已有该页 crdt_update op（对端种子已同步入账），
但 renderer 侧 PM 编辑器仍带着本地初始内容；只要重建出的 Y.Doc 为空（如本机账本的 op 尚未
入账、或 attach 与下行存在窗口），T19-03 的 attach 内建 PM→Y 种子分支就会把本地初始内容
再上行一份。两份种子的 Yjs client ID 不同，CRDT 合并后同一份文本变成两份——即冒烟脚本
（docs/mockups/cdp-e2e-collab.mjs 阶段 2）观察的「无重复种子」红线。

## 1. 方案（PM 裁决逐条）

> 裁决原文：attach 时若该页账本已有任何 crdt_update op，则跳过 PM→Y 种子（种子只在
> 「该页账本 crdt op 数=0」时上行）；实现落点自选，倾向 main CollabHub 在 attach 返回值里
> 带 `ledgerHasCrdt` 布尔（账本只在 main 可见）。

- **main 口径**（账本只在 main 可见，落 CollabHub）：attach 时机内扫描 op_ledger，
  该页存在任何 `kind='crdt_update'` 且 `target` 为本页的 op → `ledgerHasCrdt=true`。
  计数只看「op 存在」这一事实，与 payload 可否重放无关（decoded 但 payload 畸形的 op
  也计数——协作历史事实不变）；快照区段**不**计入（裁决明写「账本」口径；快照非空时
  entries 非空 → Y 非空 → 种子分支天然不触发，两口径在此场景等价）。
- **renderer 消费**：`attachCollab` 以 `seed: !result.ledgerHasCrdt` 调 `YjsEditor.attach`。
  账本为空（`false`）→ 种子照旧（首开设备的种子客户端语义不变，既有用例全数保持）；
  `true` → 关掉初始种子，用空 Y.Doc attach，内容随后续下行增量补齐。
- **editor 最小面**（动了一处，见 §3）：`YjsEditor.attach` 增 `options.seed`（默认 true），
  仅在「Y 侧为空 + PM 有内容」的种子分支前置该开关；Y→PM 投影、上行/下行/防抖/撤销
  通道零改动。

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/shared/collab.ts` | `CollabAttachResult` 增 `ledgerHasCrdt: boolean`（契约注释含口径与依据） |
| `apps/desktop/src/main/collab.ts` | `collectSeedEntries` → `collectSeed`：账本扫描中「decoded 且 target=本页的 crdt_update op」置位 `ledgerHasCrdt`（payload 畸形也计数），随 entries 一起回传；`attachBody` 两条返回路径（缓存命中/新建）均带上该字段；模块头注释同步 |
| `apps/desktop/src/renderer/src/collab/collabClient.ts` | `yjs.attach(editor, { seed: !result.ledgerHasCrdt })`（种子门一行 + 头注释更新）；`window.d.ts`/preload 零改动（类型经 shared 契约自然流转） |
| `packages/editor/src/yjs.ts` | 新增 `YjsAttachOptions.seed?: boolean`（默认 true），`attach(editor, options = {})`；种子分支条件 `seed && editor.state.doc.content.size > 0`。**本期唯一一处 editor 改动** |
| `apps/desktop/test/collab.test.ts` | 新增 §H 两用例（见 §4）+ IPC 用例补 `ledgerHasCrdt` 断言 |
| `packages/editor/test/yjs.test.ts` | `makeClient` 增 `attachOptions` 透传；新增 `attach({seed:false})` 集成用例；文件头冷启动约定补 T19-05-1 说明 |

红线核验：`git diff --stat` = 上表 6 个文件（另有 `docs/perf-history.jsonl` 为本次自跑
perf 用例自动追加的基线记录，非代码改动）；core/sync/ui/schema/dbview 零改动 ✓

## 3. 是否动了 editor 及理由

**动了，一处**（`packages/editor/src/yjs.ts`：attach 增 `seed` 选项）。理由：种子分支内建于
`YjsEditor.attach`（T19-03 语义），且「PM 是否有内容」只有绑定到编辑器后才可知——关种子的
决定点在 renderer（拿到 `ledgerHasCrdt` 之后、attach 之前），不经 editor 面无法从外部关闭。
改动收窄为：新增可选参数（默认 true，既有调用方零改动零语义漂移）、种子分支单一条件前置，
投影/上行/下行/防抖/undo 全部不动；editor 157→158 用例全绿证明既有种子语义逐条保持。

## 4. 测试摘要

| 套件 | 结果 | 新增 |
|---|---|---|
| `pnpm -C apps/desktop test` | **315/315 绿**（30 文件） | §H-1「迟到端」：账本已有本页 crdt op → `ledgerHasCrdt=true` 且 entries 播种集完整（重建 Y.Doc 含对端种子文本）；空账本 → `false` + entries=[]（首开种子语义不变钉）。§H-2：跨页 crdt op 不点亮本页种子门。IPC 用例补 `ledgerHasCrdt` 透传断言 |
| `pnpm -C packages/editor test` | **158/158 绿**（9 文件） | `attach({seed:false})`：PM 带初始内容 + Y 空 → 不产生任何种子上行（`ups` 空、`sync()` null）、PM 对齐为空文档；本地编辑（PM 事务路径）照常上行；对端种子经下行 applyCrdtUpdate → PM 投影可见 |
| `pnpm -r typecheck` | 全仓 Done（9 包，含 desktop node+web 双 tsconfig） | — |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 无字面 hex / 无非 1px 重复裸 px | — |

钉的闭环：main 钉「ledgerHasCrdt 口径与透传」+ editor 钉「seed:false → 不重复上行种子且下行
可补齐」，两钉组合即任务要求的「账本已有 crdt op 的迟到种子端 attach → 不重复上行种子」。
renderer `collabClient` 的 `seed: !ledgerHasCrdt` 一行未单独建 desktop 单测——desktop 测试环境
（vitest root=apps/desktop，pnpm 严格依赖）无法解析 `@tiptap/core`（非 desktop 声明依赖），
构造真实 Tiptap 编辑器不可行；该行已由上述两钉从两端夹住，并在本节留痕。

## 5. PM 复跑（2026-09-18）

```
pnpm -C packages/editor test  →  Test Files 9 passed / Tests 158 passed   ← 157→158
pnpm -C apps/desktop test     →  Tests 315 passed (315)（collab 14 全绿含 §H×2；perf 曾 16.7ms 红→静置隔离复跑 13.3ms 绿，既有环境敏感性非回归）
pnpm -r typecheck             →  9/9 Done，0 错
node packages/ui/tokens/no-magic.mjs → ✓
pnpm -r test                  → 全仓无红（core 51 / platform 38 / ui 61 / schema 3 / sync 98 / editor 158 / dbview 95 / importer 59 / desktop 315 = 878）
红线核验：改动 = editor/yjs.ts 一处选项（任务书预授权最小面）+ desktop 三源面 + 两测试文件；core/sync/ui/schema 零改动 ✓
真机回归：重打包 asar 含 ledgerHasCrdt×7 实证 → cdp-e2e-collab.mjs 复跑 ALL-PASS 10/10（含「无重复种子 count=1」、并发收敛逐字符一致）
```
追认 CB 两处诚实留痕：① collabClient `seed:!ledgerHasCrdt` 一行无独立 desktop 单测（desktop vitest 环境解析不了 @tiptap/core，由 main/editor 两端夹击钉住）——接受；② §6「真同时双空」边界——**接受为已知限制**：该时序下 attach 时刻双方账本皆空，种子门必开；生产网盘同步天然错峰（段发布→对端轮询到账有秒级窗口），真同帧首开概率极低，二期网络层（状态向量协商）根治。待修清单按此口径改写。

## 6. 遗留与边界说明

- 「两台设备**真同时**（attach 时双方账本都为空）首次打开同一页」仍会各自种子——这是
  裁决方案的已知边界（attach 时刻账本为空 = 种子门开）；裁决原文以「迟到种子端」为根治
  对象，真机验收建议以错峰时序（先开 A 同步完再开 B）+ 并发编辑收敛为主口径。
- `svFromB64` 上行、快照区段聚合、rotateKey、LRU 等既有链路零改动（相关用例 C/F/G 原样绿）。
