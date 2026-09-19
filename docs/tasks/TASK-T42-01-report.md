# TASK-T42-01 · R5：页面转 Wiki（口径 A）+ T40-01-2 闭环 —— 交付报告

> 执行：CodeBuddy ｜ 基线：HEAD d893ed0（T43-01，rc.18，工作树干净）｜ 日期：2026-09-20

## 0. §0 承载核实结论（任务书 §0，必须项）

**一句话结论：`page` 表确实没有任何类型列（真源 `apps/desktop/src/db/schema.sql.ts` migration #1，v2–v7 均未加过）；「转为数据库」的表达范式是「存活 `collection` 行与 page 关联」（`db.create` 同事务写 `page.upsert` + `collection.upsert`，读经 `collection.getByPage` 反查），本单**复用该范式**：database 判定仍以「存活 collection 行存在」为权威，wiki 用 migration #8 纯加列 `page.page_type`/`page.summary` 承载（随 page upsert op 走账本），不另造第二套机制。**

核实过程（三条均复核）：

1. **page 表实际列**：`schema.sql.ts` v1 = id/workspace_id/title/icon/cover/parent_id/sort_key/alive/version/updated_at；v2 加 `deleted_at`（schema.v2.ts）；v2–v7 无任何类型/kind 列。PM 用 sqlite 查真实库 schema_version=7 无该列 —— 与源码一致，**确认**。
2. **`main/pages.ts` 的 `kind`**：全部来自 `Op['kind']`（upsert/move/patch/reorder/delete），是 op 种类不是页面类型 —— **确认**。
3. **「转为数据库」范式**：`main/dbview.ts` `create()` 同事务 batch（page op + collection op，`collection.payload.page_id` 指向 page）；渲染层 T7b 的 `DbPage` 经 `db.load` → `collection.getByPage` 反查。任务书 §0.2 要求复用 —— **已复用**（见下）。

### 方案选择与理由

| 备选 | 判定 | 结论 |
|---|---|---|
| A. page 表加 `page_type` 列（wiki/database 都写列） | 读列 | database 旧数据（升级前建的库页）列值为默认 `'page'`，需数据回填才能识别 → 需要一条「扫描 collection 回填 page_type」的迁移写路径，风险高 |
| B. 新建 `wiki` 载体表（照 collection 样式） | 存活行存在 | 新目标表须扩 `packages/core` 的 `targetTableSchema` 枚举（**packages/** 红线，需 PM 裁决**，未动**） |
| **C.（采用）** 既有 collection 关联范式 + v8 加列 | **database = 存活 collection 行存在；wiki = `page.page_type='wiki'`** | 零 core 改动、零数据回填、旧库页照常识别；wiki 只需一个布尔承载 + 一列简介，加列即够；两者在 main 侧 `loadNodes` 统一注解成 `PageNodeView.pageType`，renderer 单一判定口 |

v8 迁移（`schema.v8.ts`，纯加列、`PRAGMA table_info` 存在性守卫、幂等）：
- `ALTER TABLE page ADD COLUMN page_type TEXT NOT NULL DEFAULT 'page'`
- `ALTER TABLE page ADD COLUMN summary TEXT`

`MIN_SUPPORTED_SCHEMA_VERSION`（core）**未动**（=1）；`SCHEMA_VERSION`（core）未动（payloadSchema 是开放 record，`page_type`/`summary` 键免校验直通 `encodeOp`）。

## 1. 实现（文件 → 改动）

**数据面（apps/desktop/src）**

| 文件 | 改动 |
|---|---|
| `db/schema.v8.ts`（新） | v8 加列清单（上表两列）+ 纪律注释 |
| `db/migrations.ts` | 追加 `{ id: 8, name: 'v8-page-type' }`（只追加，#1–#7 零触碰） |
| `db/statements.ts` | `page.upsert` SQL/params 追加 `page_type`（enum，默认 'page'）/`summary`（nullable）；**其余语句零改动**（`page.insert` 不写新列 → 默认值兜底，白名单语句总数不变，statements.test 预算不受影响） |
| `main/commit.ts` | `pageUpsertStatement` 追加 `page_type`（`readPageType`：缺省 'page'，非法值显式拒）与 `summary`（nullable）读取 |
| `main/pages.ts` | 新增 `PageType`/`PageNodeView`（PageNode + 可选 pageType/summary/updatedAt 注解）；`loadNodes` 并查 `collection.listByWorkspace` → database 页集合，权威判定后注解；`listTree` 返回 `PageNodeView[]` |
| `main/dbview.ts` | ① `create()` 的 page op payload 追加 `page_type:'database'`（入账审计，T40-01-2）；② 新增 `convertPage({pageId,to})`：整对象 page upsert op，仅 `page_type` 变化（正文块/子页/收藏/最近/页签零触碰）；多维数据页/回收站页拒绝（E_MALFORMED）；③ 新增 `setPageSummary({pageId,summary})`：仅 wiki 页可设；④ `registerDbViewIpc` 内注册 `page:convert`/`page:summary:set` 两通道（zod 校验） |
| `shared/ipc.ts` | 新增 `CHANNEL_PAGE_CONVERT`/`CHANNEL_PAGE_SUMMARY_SET`（+PAGE_TYPE_CHANNELS） |
| `preload/index.ts` | `pages.convert`/`pages.setSummary` 两方法接线（仅新增） |
| `types/window.d.ts` | `tree` 返回 `PageNodeView[]`；新增 convert/setSummary 声明；转出口 PageNodeView/PageType |

**渲染面（apps/desktop/src/renderer/src）**

| 文件 | 改动 |
|---|---|
| `state/pages.ts` | `nodes: PageNodeView[]`；`pageTypeOf()` 兜底读取（缺省='page'）；新 action `convertPage(id,to)`（IPC → refresh → 双语 toast） |
| `pages/SidebarTree.tsx` | ①「Wiki」独立分区（`Note` 图标走 @septcats/ui 出口，count=wiki 页数，默认展开，空态同 .app-nav-empty）：wiki 页为根的子树，嵌套 wiki 页截断独立成根；② 普通分区整枝剪除 wiki 子树（普通页不受影响）；③ 行 ⋯ 菜单：普通页加「转为 Wiki」、wiki 页加「转为普通页」、多维数据页无此项；行渲染抽取 `renderPageRow` 供两分区共用（testid：普通分区 `side-node-*` 不变，wiki 分区 `side-wiki-node-*`） |
| `pages/PageView.tsx` | **承载判定统一**：`activeNodeType = pageTypeOf(selectedNode)`（真树注解驱动）——database → `DbPage`（**T40-01-2 闭环**：重开/重载后树重拉，库页仍是 database 页）；wiki → `WikiLanding`；page → 编辑器。AI 面板的 `chatPageIsDb` 同步改用统一判定（原 `activePage.kind==='database'` 永不成立的死分支被替代）；`dbPageId` 本地态保留为转换瞬间兜底 |
| `pages/WikiLanding.tsx`（新） | 落地页 = 标题（双击行内重命名，复用 pages.rename）+ 简介（textarea 失焦自动保存 → setSummary）+ 子页索引（pagesStore 真树派生：alive+parentId+sortKey 序；行 = 图标/标题/末次更新时间，点击 openInTab，Enter/Space 可达）+「新建子页」（`pages.create({parentId: wikiId})` 既有通道）+「转为普通页」 |
| `pages/WikiLanding.css`（新） | 全 `var(--sc-*)` token、零字面 hex、零 transition（无 reduced-motion 义务）、focus-visible 环 |
| `i18n/zh-CN.ts` / `en-US.ts` | 新键：sidebar.wiki/emptyWiki；editor.convertToWiki/convertToPage/wikiSummaryLabel/wikiSummaryPlaceholder/wikiIndexTitle/wikiNewSubpage/wikiEmptyIndex/wikiUpdatedAt；pages.toastConvertedToWiki/toastConvertedToPage（两字典键集合等价，zh 值无「数据库」残留，en 值无 CJK） |

## 2. T40-01-2 闭环说明（PM 裁决 · 有界追加）

- **根因**：`PageView` 只在 `activePage.kind==='database'`（永不为真，page 行无 kind 列）或当次会话本地态 `dbPageId` 下渲染 DbPage；`db.create` 产的独立库页重开/重载后无人告诉 PageView 它是库页。
- **修复**：页面承载判定**一处统一**——main 侧 `loadNodes` 权威判定（存活 collection 行存在 → database，**正是任务书 §0.2 要求复用的既有范式**）注解进 `page:tree`；`PageView` 首分支按该注解分发 `DbPage`。重开/重载后树重拉 → 库页仍判为 database → 表格 + 属性条在。`db.create` 同时把 `page_type:'database'` 随 op 入账（同步重放/审计与投影一致）。
- **数据面证据**（test/wiki-page.test.ts）：db.create → `pageType='database'`；`dispose()` 后**新连接重开** → 仍 `'database'`，`db.load` 正常返回同一 collectionId。
- **真机证据（建库 → 重启应用 → 仍是数据库页）**：**留 PM**（本环境无真机/CDD 探针执行面；数据面等价断言已绿，见 §4）。

## 3. 验收对照（任务书 §2）

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 普通页→转 Wiki→分区在列；**重开保持**（type 持久化） | ✅ 数据面：wiki-page.test「注解 wiki 且重开保持」；UI 面：wiki-ui.test 分区 count/条目/testid |
| 2 | 简介编辑重开仍在；索引条目数=实际子页数；新建子页后索引 +1 且 parentId 正确 | ✅ setSummary 重开断言 ✓；「子页索引」用例断言 2 子页 parentId 全对 ✓；UI 面索引行数=2 ✓（+1 场景由 pages.create 假桥断言 parentId=wikiId ✓） |
| 3 | Wiki→转普通页→分区消失、回普通分区，正文与子页逐条不变 | ✅ 「双向转换内容零丢失」：块指纹（id+type+正文文本 JSON）往返前后相等；子页 id:title 集合相等；标题不变；注解回 'page'（分区消失由 SidebarTree 剪除逻辑保证，UI 面有 pageType=page 回编辑器用例） |
| 4 | 页签联动：转换后标题刷新；切换/重开还原不受影响 | ✅ 页签标题读 pagesStore 节点（TabsBar），convertPage 成功后 refresh() 对账 → 标题实时刷新；页签集合只按存活页裁剪、与类型无关（T37 行为零触碰，回归 570 用例全绿佐证） |
| 5 | 旧库兼容 | ✅ **自跑夹具旧库**：v7 迁移子集建库 + 旧风格直插行 → 新代码打开 from=7→to=8 → 存量行 page_type='page'、列表/转换/库页全链路无异常。**真机旧库（老板真实库副本）留 PM** |
| 6 | 回归：全仓无红；零滚动/侧栏收起/装订线/对比度门禁/T37–T41 行为不变 | ✅ 全仓 1189（desktop 570）无红；ui-interaction-audit（CSS 门禁）、tabs/t37、layout/t39、dbview-fields/t40、page-width/t41 全部既有用例通过；双 token 门禁 ✓ |
| 7 | 双主题 × 四态截图 | **留 PM**（真机） |

## 4. 自跑命令原始输出（数值如实）

```
$ pnpm -C apps/desktop test
 Test Files  52 passed (52)
      Tests  570 passed (570)          ← 基线 556 + 新增 14（wiki-page 7 + wiki-ui 7）
   Duration  28.17s

$ pnpm -r test（全仓）
 packages/core 51 · platform 41 passed|1 skipped · ui 79 · schema 3 · sync 109 ·
 editor 182 · dbview 95 · importer 59 · desktop 570
 合计 1189 passed（+1 skipped，skip 为既有 platform 用例）
   ← 基线 1173 + 14，全绿

$ pnpm -r typecheck
 9/9 包 Done（apps/desktop 为 node+web 双 tsconfig）

$ node packages/ui/tokens/no-magic.mjs
 ✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px（exit 0）

$ node packages/ui/tokens/build-tokens.mjs --check
 ✓ token 产物与 DESIGN.md 一致（exit 0）
```

性能巡检（perf.test 每次运行自动追加 `docs/perf-history.jsonl`，本次 12 条记录全部 `pass:true`，如 commit_batch_200_blocks_p95=11.8/11.9/12ms ≤16、rebuild_10k≈1.50–1.56s ≤5s）。

## 5. DEVIATION 逐条（待 PM 追认）

| # | 内容 | 理由 |
|---|---|---|
| D-1 | **改了 `main/commit.ts`**（红线清单未明列）：`pageUpsertStatement` 纯追加 page_type/summary 两参数读取 | page_type 走账本的必经之路：upsert 是唯一整对象物化口，不加则 op payload 里的类型在物化/同步重放时丢失（真相层与投影分叉）。缺省 'page' 保证旧 op 重放语义不变 |
| D-2 | **改了既有语句 `page.upsert`**（「纯新增」边界的扩张）：SQL/params 追加两列 | 同 D-1；STRICT 表加列向后兼容（DEFAULT 'page'），旧版本代码读新库不受影响（多列 SELECT * 直通） |
| D-3 | `test/migrations.test.ts` 最新迁移名称断言 `'v7-template'` → `'v8-page-type'`（一处，语义=「最新迁移由名称锁死」不变） | 迁移 #8 追加的直接后果；该文件其余用例（`MIGRATIONS[length-1]` 幂等重跑等）在新表下语义保持、未改 |
| D-4 | `types/window.d.ts` 改动（红线未明列）：tree 返回类型 + convert/setSummary 声明 | preload「仅新增通道」的类型面配套（window.d.ts 是 preload 契约的唯一真源，T40-01 同款先例） |
| D-5 | 转换/简介两个 page 域通道的**实现与注册放在 `main/dbview.ts`**（DbViewService.convertPage/setPageSummary） | 红线禁改 `main/index.ts`（pages 域 IPC 注册在彼），而 `registerDbViewIpc` 自持注册面（DI registrar，T40 追加允许动 dbview.ts）；域命名仍为 `page:convert`/`page:summary:set`，实现位置是红线约束下的取舍 |
| D-6 | `PageNodeView` 三个注解为**可选**字段（packages/editor 的 `PageNode` 零改动） | packages/** 红线禁碰（PageNode 在 editor/tree.ts）；代价：读取须走 `pageTypeOf` 兜底（缺省='page'），换来旧夹具/旧桥接数据结构兼容 |
| D-7 | 已知边界：**混合版本同步**下，旧版本设备对 wiki 页发整对象 upsert（payload 无 page_type）会把该页物化回 'page' | 与任何字段演进的 LWW 语义一致（缺省即值）；同版本（≥本 rc）双向转换正常；单机重放不受影响 |
| D-8 | Wiki 分区把 wiki 页的子树**整体**移入 Wiki 分区（普通分区剪除整枝）；普通页的行 ⋯ 菜单「全宽」等其余项不变 | 口径 A 未规定嵌套展示；该行为与 Notion 一致且确定性最高（一行剪除规则，无跨分区重复行） |
| D-9 | Wiki 落地页标题编辑 = **双击进入行内重命名**（Enter/Esc/失焦提交），非单击即编辑 | 与侧栏行内重命名同一交互语言（beginRename 口径），避免误触；任务书仅要求「可编辑」 |

## 6. 未做 / 留 PM（诚实清单）

1. **真机探针与截图**（任务书 §2.5/§2.7）：老板真实库副本打开、建库→重启→仍是数据库页、双主题 × 四态截图 —— 本环境无真机执行面，数据面等价断言已全绿。
2. 老板真实库副本的迁移演练（v7→v8 在真库副本上）。
3. 混合版本同步的 D-7 边界未做专项测试（需要双版本夹具，超出本单范围）。
4. `docs/perf-history.jsonl` 有本次测试运行自动追加的 12 条记录（全部 pass），随本单一起入库或还原由 PM 定夺。

## §PM 复跑

> PM：Hermes ｜ 日期：2026-09-20 ｜ 产物：**rc.19**（`0.3.0-rc.19`）
> 口径：PM **自写独立探针** `docs/mockups/cdp-e2e-t42-01-pm.mjs`；每条断言均有原始数值回显。
> **PM 探针结果：17 PASS / 0 FAIL**（50.1s）；pageerror 0；**console 错误 4 条（已定位，见 §2）**。

### 1. 任务书 §2 逐条对照 + ★T40-01-2 闭环

| 验收项 | PM 实测 |
|---|---|
| §2.1a Wiki 落地页渲染 | `.wiki-body` 存在 ✓ |
| §2.1b 侧栏出现 Wiki 分区 | `wikiLabel=true` ✓ |
| §2.1c **重开应用后仍是 Wiki 落地页**（type 持久化） | `openOk=true landing=true` ✓ |
| §2.1d 重开后 Wiki 分区仍在 | ✓ |
| §2.2a 新建 2 子页 → **索引条目数 = 2** | `rows=2` ✓ |
| §2.2b 简介重开仍在 | `summaryVal="这是 PM 写入的简介"`（= PM 写入值）✓ |
| §2.2c 子页索引重开仍 2 条 | `rows=2` ✓ |
| §2.3a 「转为普通页」成功且回编辑器页 | `ok=true editor=true landing=false` ✓ |
| §2.3b **正文块数逐条不变** | `before=2 after=2` ✓ |
| §2.3c **正文文本校验和不变** | `equal=true` ✓ |
| §2.4 页签联动 | 页签条在，标题含被转换页（`Wiki源页/子页甲/子页乙`）✓ |
| §2.6 回归：窗口零滚动 | `x=0 y=0` ✓ |
| §2.7 双主题 | 深色 `data-theme=dark` + 编辑器页正常 ✓ |
| **★ T40-01-2（P1）闭环** | **`db.create` 建库 → 重启应用 → 该页仍是数据库页**（`dbPage=true editor=false`，不再退化为文档页）✓ |

**§0 承载核实（PM 复核）**：报告结论与 PM 独立侦察**一致** —— `page` 表 v1–v7 确无类型列；
`main/pages.ts` 的 `kind` 全是 op 种类；「转为数据库」确为「存活 `collection` 行 + page 关联」范式。
**采用方案 C**（database = 存活 collection 行；wiki = v8 纯加列 `page_type`/`summary`）**PM 认可**：
零 core 改动、`SCHEMA_VERSION`/`MIN_SUPPORTED` 均未动、无边数据回填、旧库页识别不变。
**PM 核验**：`git status` 确认 `packages/**` **零改动**（未触红线）；`DESIGN.md`/tokens/CI/PM 探针均未动。

### 2. ⚠️ PM 挖出的缺陷：**T42-01-1**（P2，**T42-01 引入**）

**症状**：在 Wiki 落地页点「新建子页」→ 子页打开 → 返回 Wiki 落地页，每次复现 **2 条 console 错误**：

```
[YjsEditor] Y→PM 初始投影失败（pageId=<wiki页>）TypeError: Cannot read properties of null (reading 'topNodeType')
[PageView] 协作层接入失败（不阻断编辑）RangeError: Adding different instances of a keyed plugin (y-sync$)
```

**PM 定位过程（可复现、有步骤标签）**：
1. 给探针每条 console 错误打**步骤标签** → 首现时机 = **「新建子页 子页甲/乙」**，且 pageId 正是 **wiki 页自身**。
2. **归因 A/B**（PM 单独跑 `diag-t42-01-collab-ab.mjs`）：把「无编辑器页被重新进入」这一既有模式取出——目标页为**转为数据库的页**时 **0 错误（干净）**；为 **wiki 页**时报错。
   → 排除「无编辑器页重进」通病，**归因指向 T42-01 的 wiki 路径**。
3. **代码定位**：`PageView.tsx:289` 协作层接入 effect 的门控只有 `editor !== null && activePageId !== null`，
   **没有门控「当前页是否仍渲染编辑器」**——wiki 页渲染的是 `WikiLanding`（无编辑器），
   于是用（残留的）编辑器实例 + wiki 页 id 去 `attachCollab` → 投影到空文档失败 + `y-sync$` 插件重复注册。

**影响**：探针明确报 `不阻断编辑`（PM 亦实测：双向转换后**内容零丢失**、子页流程正常），
**无数据损坏、无功能阻断**；但属**正常用户流程上的 console 报错**（每次子页往返 2 条），
且协作层对 wiki 页产生了不应有的 attach 往返 —— **不应带病出包**。

**修法建议**：协作层接入门控补上「当前页类型为 `page`（即真的渲染编辑器）」，或在 wiki/database 页分派时
显式 `detachCollab` 并清空编辑器实例（约数行 + 单测）。**并在探针里保留此断言**。

### 3. 未覆盖 / 遗留

1. **T42-01-1**（P2）待修；修好后 PM 探针的 `console 错误` 应回到 **0**（当前 4 条）。
2. **真机旧库兼容（老板真实库副本）—— PM 已完成**：`docs/mockups/cdp-e2e-t42-01-olddb.mjs`
   **5 PASS / 0 FAIL**，双隔离、真实库 mtime 零改动。PM 另用 Python 独立核查副本库：
   `user_version = 8`（v7→v8 迁移执行）✓；`page` 表已含 `page_type` + `summary` ✓；
   **12 行存量页全部 `page_type='page'`**（无数据损坏、无边数据回填）✓；
   IPC 读出 12 页、界面侧栏 7 节点正常、**console 0 / pageerror 0** ✓。
3. **PM 探针自身的首跑 9 FAIL 已查明为探针问题、非产品问题**（诚实记录）：① DbPage 检测误用
   `.sc-propbar`（**空态下不存在**，DbPage 根是 `.dbpage`）② 侧栏 **Wiki 分区行前缀是 `side-wiki-node-`
   而非 `side-node-`**，导致 `openRow` 找不到 wiki 页。两处修正后 17/0。
4. `docs/perf-history.jsonl` 有 perf 测试自记追加（跑测试附带）。
5. git 提交：工程师未碰，由 PM 提交。
