# TASK-T44-01-1 交付报告 · 双链解析语义与页面存活对账（P2 缺陷修复）

> 基线：rc.21（git HEAD aaf7266，工作树改前干净）｜完成：2026-09-20｜工程师：CodeBuddy
> 触发：TASK-T44-01 §1 claim#3 自报「点指向已删页 id 的链接同样走新建路径」被 PM 真机
> 探针 B3/B3b（`docs/mockups/cdp-e2e-t44-01-pm.mjs`）证伪：删除目标页后 `unresolved=0`，
> reload 后仍 `unresolved=0`。

## §1 症状

- 源页链接指向目标页（`[[链接目标页]]`，target=页 id）→ 删除目标页（`pages.remove` 返回 `{"deleted":1}`）。
- 期望：链接转 `.sc-wikilink--unresolved`，reload 后仍 unresolved；点击走「新建该标题页」路径。
- 实测（PM 探针 B3/B3b）：删除后与 reload 后均 `wikilinks=3, unresolved=0` —— 仍显示为已解析。
  对照组 A10（`[[不存在的页]]` 从未存在）`unresolved=1` 行为正确 → 缺陷只在「目标曾存在、后被删」一支。

## §2 根因

解析语义**物化在 wikilink 节点 attrs**，且渲染层无任何「存活重估」路径，三处证据：

1. **resolved ⇔ attrs.target 非空**（`packages/editor/src/types/wikilink.ts:57`）：
   ```ts
   class: target !== null ? 'sc-wikilink' : 'sc-wikilink sc-wikilink--unresolved',
   ```
   `target` 是补全/收口时写进 Y.Doc/块 content 的**页 id 快照**（rules/wikilink.ts
   `insertWikilinkSelection` / `handleTextInput` 收口）。目标页软删不回头改 attrs →
   target 永远非空 → 永远渲染为已解析。reload 后文档从 CRDT 账本/块 content 重建，
   attrs 原样回来 → B3b 复现，不是界面刷新问题。
2. **`pages.tree()` 返回 alive+deleted 全量**（`apps/desktop/src/db/statements.ts:220`
   `'page.listAll'`：`SELECT * FROM page WHERE workspace_id = @workspace_id`，注释明写
   「alive+deleted 全量」；`state/pages.ts` store 注释同样声明「视图层自行过滤」）。
   渲染层却把全量树当存活口径用：
   - `PageView.handleWikilinkClick`（原 460-461 行）`targetAlive = pageNodes.some(n => n.id === info.target)`
     —— 已删页也命中 → 点已删目标会 `openInTab(死页)` 而非新建路径（claim#3 被破坏的另一半）；
   - `wikilinkHost.candidates = pageNodes.map(...)` —— 已删页仍出现在 `[[` 补全候选里。
3. **排除项（PM 的怀疑方向，证实不成立）**：main/links.ts 与 SQL 白名单无此病——
   `links.backlinks` 本就带 `AND p.alive = 1`（db/statements.ts，源页存活过滤正确）；
   `pages.tree` 派生层不去重不假，但**没有任何解析查询按标题在 tree 里查目标**
   （解析只发生在编辑器输入时刻的 candidates，见上）。

## §3 修法

**对账规则**（新增 `apps/desktop/src/renderer/src/pages/wikilinkResolve.ts`，纯函数 + 编辑器遍历）：
以「存活页集合」（`alive === 1`，软删/彻底删除都不算）为唯一真源，对当前文档 wikilink 节点双向收敛：

- `target` 非空但 id 已死 → 置 `target = null`（转未解析样式；点击走新建路径）；
- `target` 为空且 `title` 与**唯一**存活页标题精确相等 → 回填该 id
  （回收站恢复、或先有 `[[名]]` 后建/恢复同名页时自动接上；重名歧义不回填）。

**接线点**（`PageView.tsx`，均在 apps/desktop 内）：

1. 协作 attach 完成后（`collabReady` 门）执行一次对账——排在 Y→PM 投影/PM→Y 种子之后，
   防投影覆盖对账结果；`pageNodes.length === 0`（树未就绪）绝不对账，防误杀全部链接。
2. 页面树存活态变化时（`aliveKey` 签名 = id:alive:title 拼接）重对账——删页/恢复随
   refresh 到来即时生效，对已打开的其它页签同样收敛。
3. 对账走**正常编辑事务**（`setNodeMarkup` 单事务）：onUpdate → pmDocToBlocks →
   EditSession commit 落库 + Y.Doc 上行入账 + 双链派生索引随 blocks:commit 增量重算
   —— **不是纯显示层修改**：落库后「解析语义」与「页面是否存活」在存储层一致，
   reload 后无需再次对账也保持 unresolved（B3b 语义由挂载对账 + 落库双保险）。
4. `handleWikilinkClick` 判活加 `node.alive === 1`（死 id 即使对账未跑也走新建路径）。
5. `wikilinkHost.candidates` 改用 `aliveNodes(pageNodes)`（已删页不再出现在 `[[` 候选）。

**不做 main/links.ts 变更的理由**：派生索引保留死 target 行是**正确**且必要的——回链面板
挂在目标页上（死页不可视），恢复后无需重建即恢复回链；`syncOnePage` 对 target=null 的行
本就不入索引，对账落库后索引随增量自然收敛。

## §4 改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/renderer/src/pages/wikilinkResolve.ts` | **新增**：`aliveIdSet` / `aliveTitleIndex`（重名歧义标记）/ `nextWikilinkTarget`（纯函数）/ `reconcileWikilinkTargets`（单事务幂等对账） |
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | collab effect 加 `collabReady` 门；新增对账 effect（editor+collabReady+aliveKey）；`handleWikilinkClick` 判活过滤 `alive===1`；candidates 改 `aliveNodes(pageNodes)` |
| `apps/desktop/test/wikilink-resolve.test.tsx` | **新增**回归：纯函数 2 例 + 组件 4 例（见 §5） |

`packages/**` **零改动**（红线遵守）。迁移：无 DB 变更。

## §5 回归测试（apps/desktop/test/wikilink-resolve.test.tsx，6 例全绿）

纯函数（node 语义，jsdom 容器）：
- `aliveIdSet` 只收 alive=1；`aliveTitleIndex` 已删页不入索引、重名置歧义标记；
- `nextWikilinkTarget` 双向规则逐支：活 target 保持 / 死 target → null / null+唯一标题命中 → 回填 / 死页标题、重名、未命中、空标题 → 保持 null。

组件（PageView 真编辑器 + jsdom + 假桥，pageview-blocks-ui.test.tsx 同款纪律）：
1. 目标页已删 → 挂载即渲染 `.sc-wikilink--unresolved`（挂载对账 = reload 后仍 unresolved 的 B3b 语义）；
2. 目标页存活 → 正常解析（`.sc-wikilink--unresolved` 不出现，不误杀）；
3. 回收站恢复（存活态 0→1 翻转，restorePage 乐观更新同形）→ 链接重新变为已解析（双向收敛，无单向 bug）；
4. 点击未解析链接 → `pages.create` + `pages.rename({title:'链接目标页'})`（claim#3 新建路径）。

## §6 自跑原始数值

| 命令 | 结果 |
| --- | --- |
| `pnpm -C apps/desktop test` | **Test Files 55 passed (55) / Tests 594 passed (594)**（修复前 588，+6 新增） |
| `pnpm -C packages/editor test` | **Test Files 11 passed (11) / Tests 197 passed (197)** |
| `pnpm -C packages/dbview test` | **Test Files 5 passed (5) / Tests 98 passed (98)** |
| `pnpm -r typecheck` | 全部 `Done`（desktop 双 tsconfig 通过） |
| `node packages/ui/tokens/no-magic.mjs` | `✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px` |
| `node packages/ui/tokens/build-tokens.mjs --check` | `✓ token 产物与 DESIGN.md 一致` |

测试侧已知噪声（不影响判定）：对账触发的 debounced commit 在 `vi.unstubAllGlobals` 之后
偶发一次 `[PageView] commit 失败` 日志（EditSession onError 捕获；生产面 `window.septcats`
恒存在，不受影响）。

## §7 DEVIATION（待 PM 追认）

1. **D-1** `wikilinkResolve.ts` 用字面量 `'wikilink'` 匹配节点类型名——
   `WIKILINK_NODE_NAME` 常量在 `packages/editor/src/types/wikilink.ts` 定义但**未从包出口**
   （`types/index.ts` 只装配 schema 未 re-export）。为守「不碰 packages/**」红线采用字面量；
   若 PM 认可，后续可让 editor 包 re-export 该常量后替回。
2. **D-2** 对账时机选渲染层（挂载 + 存活态变化），而非 main 侧 `pages.remove` 时批量重写
   块 content：main 重写需伪造 block patch op + 复制 PM doc JSON 变换（或改 packages 投影层），
   且会先丢 target id 再靠标题回溯；渲染层对账经正常编辑管线落库，语义等价、增量天然入
   账本与派生索引。代价：未重新打开的页其存储 content 在打开前仍持死 id（**惰性收敛**，
   视图语义始终正确；启动重建的索引口径见 D-3）。
3. **D-3** 启动 `rebuildLinksIndex` 重扫时死 target 行仍会入索引（content 未对账前）——
   回链面板只挂存活目标页，死行不可视、恢复后反而即席可用；与 §3「保留死 target 行」同口径。
4. **D-4** 对账回填（null→id）按**精确标题唯一命中**（与 `resolveTitleToId` exact 路径同口径）；
   重名歧义保持未解析。改名后链接节点 title attr 是旧标题（T44-01 既有「改名不改写节点」
   语义），恢复分支按**节点 title**（旧标题）匹配——若恢复的页已用新标题且与旧标题不同，
   该链接保持未解析（与「新建同名旧标题页」等效，Obsidian 同款）。
5. **D-5** 测试用 `Range.prototype.getClientRects` 桩 + `document.elementFromPoint` 钉住，
   使 jsdom 能走 PM `handleClickOn` 全路径（mousedown→mouseup→click）；仅测试文件内生效。

## §PM 真机验收（补 §8.1）

> PM：Hermes ｜ 产物：**rc.22** ｜ 口径：PM 独立探针，**同一考卷、红→绿**。

### 1. 主考卷 `docs/mockups/cdp-e2e-t44-01-pm.mjs`（18 条断言）

| 断言 | 修复前 | 修复后 |
|---|---|---|
| **[B3] 删目标 → unresolved（真机路径）** | FAIL `{w:3,u:0}` | **PASS `{w:3,u:1}`** |
| **[B3b] 删后 reload 复查** | FAIL `{w:3,u:0}` | **PASS `{w:3,u:1}`** |
| 其余 16 条 | PASS | PASS（无回归）|
| **汇总** | 17 PASS / 2 FAIL | **18 PASS / 0 FAIL** |
| console / pageerror | 0 / 0 | **0 / 0** |

**★ 考卷自身修正（PM 自报）**：上一轮 B3 的红，根因是**我的考卷走了非真机路径**——
直连 `pages.remove` 桥不触发渲染层 store 刷新，而真机删页走「侧栏 ⋯ → 删除 → 二次确认」
会 refresh store。已把 B3 改为真机路径（实测菜单 `["固定宽度","转为 Wiki","删除"]`
＋ `page-delete-confirm` 弹层均正常）。**产品侧本无遗留，这条红是我考卷的问题。**

### 2. 补充考卷 `docs/mockups/cdp-e2e-t44-01-restore-pm.mjs`（回收站恢复，§8.1）

干净用例（**不涉及改名**，避免撞 D-4 的歧义口径）：

| 断言 | 结果 |
|---|---|
| R1 建链后已解析 | PASS `{w:1,u:0}` |
| R2 真机删除 → unresolved | PASS `{w:1,u:1}` |
| **R3 回收站恢复 → 重新已解析** | **PASS `{w:1,u:0}`**（**无单向 bug**）|
| R4 reload 后仍已解析 | PASS `{w:1,u:0}` |
| 汇总 | **4 PASS / 0 FAIL**，console 0 / pageerror 0 |

### 3. 门禁与红线

- 全仓 **1225 → 1231**（desktop 588 → **594**，+6 回归测试）· typecheck 9/9 · token 双门禁 ✓
- **`packages/**` 零改动** ✓（本次遵守了红线，未再出现 T44-01 的流程偏差）
- **未修改 PM 任何探针** ✓

### 4. DEVIATION 裁决

D-1 ~ D-5 **全部受理**。其中 **D-2（惰性收敛：未重开的页其存储 content 仍持死 id）**
PM 予以确认：**视图语义在任何路径下都正确**（B3/B3b/R2/R3/R4 五路实测），
索引重建口径与 D-3 自洽；「即时全库收敛」作为立账另议项接受。

### 5. 结论

**T44-01-1 闭环**。原红断言 2 条全部转绿；回收站恢复分支经真机验证无单向 bug。
**R1–R7 需求全部交付并验收完毕。**

## §8 未做项（PM 已确认接受）

1. ~~真机验收~~ → **已完成**，见上 §PM 真机验收（主考卷 18/0 + 恢复分支 4/0）。
2. 第二批既有登记项（T44-01 §4.1：改名批量改写、未链接提及）不受本单影响，仍未做。
3. 「新建同名页 → 全库未解析链接批量回填」目前只在**打开对应源页时**惰性发生（D-2 同因）；
   若要即时全库收敛，需 main 侧扫描（立账另议）。
