# TASK-T7b-01 交付报告 · M6 数据接线（main IPC + preload + renderer 桥）

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**四条 DoD 全绿（本地已复跑）**
> 复述（写前）：行内数据库从库侧组件接到真进程链路——renderer 打开 `kind='database'` page → 渲染 DbView → 每个操作经 IPC → main 用 **commitOps 同源**（Op + 物化同事务）落 DbServer；写路径绝不绕过 commitOps。

## 1. 通道清单（`src/shared/ipc.ts` · `DB_CHANNELS`）

| 通道名 | 请求 | 应答 |
|---|---|---|
| `db:create` | `{ workspaceId, parentPageId?, title }` | `{ pageId, collectionId }` |
| `db:load` | `{ pageId }` | `{ collection, records }` |
| `db:rename` | `{ pageId, title }` | `{ ok: true }` |
| `db:record:create` | `{ pageId, values? }` | `{ record }` |
| `db:record:update` | `{ pageId, recordId, patch }` | `{ record }` |
| `db:record:delete` | `{ pageId, ids }` | `{ ok: true }` |
| `db:prop:add` | `{ pageId, type }` | `{ collection }` |
| `db:prop:update` | `{ pageId, pid, patch }` | `{ collection }` |
| `db:prop:remove` | `{ pageId, pid }` | `{ collection }` |
| `db:view:save` | `{ pageId, view }` | `{ collection }` |
| `db:relation:search` | `{ pageId, targetCollectionId, query }` | `{ candidates }` |
| `db:export:csv` | `{ pageId }` | `{ csv }` |

错误统一走 `DbViewApiError { code, message }`（E_NOT_FOUND / E_REFERRED / E_UNSUPPORTED / E_MALFORMED / E_INVARIANT / E_DB_UNAVAILABLE），IPC 侧以 `Error("CODE: message")` reject，不吞错。

## 2. 文件清单

### 已存在（上一会话落盘，typecheck 通过）
- `src/shared/ipc.ts` — `DB_CHANNELS` 12 通道常量 + `DbChannel` 类型
- `src/main/dbview.ts` — `createDbViewService` + `registerDbViewIpc`（1000+ 行，DI 不 import electron）
- `src/main/commit.ts` — `collection/record` 物化语句映射 + `extraStatements` 同事务追加
- `apps/desktop/package.json` — 加 `@septcats/dbview` 依赖
- `apps/desktop/electron.vite.config.ts` — `externalizeDepsPlugin` exclude 加 `@septcats/dbview`
- `src/db/statements.ts` — `record.upsert` 冲突分支不再覆盖 `backlinks_json`

### 本次新增
- `src/renderer/src/db/useDbPage.ts` — 四态状态机（loading/ready/empty/error + reload），挂载 `db:load`，写操作后 reload
- `src/renderer/src/db/DbPage.tsx` — 四态外壳（Skeleton/EmptyState/ErrorPanel）+ `DbView` props 全接
- `src/renderer/src/db/DbPage.css` — `.dbpage` 外壳，只用 `var(--sc-*)`
- `test/dbview.test.ts` — main 全链路 8 用例（create/load/record/rename/prop/view/relation/delete）
- `test/db-bridge.test.ts` — jsdom 6 用例（useDbPage 四态 + DbPage 冒烟）

### 本次修改
- `src/main/index.ts` — `bootstrapDatabase` 同起 pages + db 两服务；`registerIpcHandlers` 里 `registerDbViewIpc(services?.db ?? null, dbViewRegistrar())`
- `src/preload/index.ts` — `septcats.db` 桥（`DB_CHANNELS` 一对一）
- `src/types/window.d.ts` — `SeptcatsDbApi`（EOPT 风格可选成员 `?: T | undefined`）+ `SeptcatsApi.db`
- `src/renderer/src/pages/PageView.tsx` — `page.kind==='database'` 分发 + 顶栏「转为数据库」按钮
- `src/db/statements.ts` — 修正 `relation.countTargets`（见 DEVIATIONS #1）
- `apps/desktop/vitest.config.ts` — 顶层 `esbuild.jsx: automatic`；db-bridge 用文件头 `@vitest-environment jsdom` 覆盖环境
- `apps/desktop/tsconfig.node.json` — 加 `jsx: "react-jsx"`（node 工程需解析被 test 引用的 .tsx）
- `pnpm-lock.yaml`

## 3. 测试结果原文（四条 DoD）

### `pnpm -r typecheck`
```
Scope: 7 of 8 workspace projects
packages/core typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck$ tsc -p tsconfig.json --noEmit
packages/ui typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/dbview typecheck$ tsc -p tsconfig.json --noEmit
packages/editor typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
```

### `pnpm -C apps/desktop test`
```
> @septcats/desktop@0.0.0 pretest E:\Hermes Agent工作空间\Septcats\apps\desktop
> node scripts/ensure-abi.mjs node

> @septcats/desktop@0.0.0 test E:\Hermes Agent工作空间\Septcats\apps\desktop
> vitest run

 RUN  v3.2.7 E:/Hermes Agent工作空间/Septcats/apps/desktop

 ✓ test/statements.test.ts (17 tests) 54ms
 ✓ test/migrations.test.ts (18 tests) 108ms
 ✓ test/server.test.ts (12 tests) 180ms
 ✓ test/dbview.test.ts (8 tests) 150ms
 ✓ test/pages.test.ts (11 tests) 171ms
 ✓ test/db-bridge.test.ts (6 tests) 356ms

 Test Files  6 passed (6)
      Tests  72 passed (72)
   Start at 17:25:13
   Duration  5.41s (transform 630ms, setup 0ms, collect 5.71s, tests 1.02s, environment 554ms, prepare 731ms)
```

### `node packages/ui/tokens/no-magic.mjs`
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### `pnpm -C apps/desktop build`
```
> @septcats/desktop@0.0.0 build E:\Hermes Agent工作空间\Septcats\apps\desktop
> node scripts/ensure-abi.mjs electron && electron-vite build

- Searching dependency tree
√ Rebuild Complete
vite v7.3.6 building ssr environment for production...
transforming...
✓ 74 modules transformed.
rendering chunks...
out/main/chunks/rpc-ButtQbsY.js   17.70 kB
out/main/dbServer.js              55.10 kB
out/main/index.js                430.46 kB
✓ built in 720ms
vite v7.3.6 building ssr environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
out/preload/index.js  5.79 kB
✓ built in 10ms
vite v7.3.6 building client environment for production...
✓ 4788 modules transformed.
rendering chunks...
../../out/renderer/index.html                     1.00 kB
../../out/renderer/assets/index-M5T6RsJ-.css     45.71 kB
../../out/renderer/assets/index-zfr4z9tF.js   1,266.42 kB
✓ built in 3.60s
```
（build 中段有 2 条 zod 内部 `@__PURE__` 注释的 Rollup 提示，非错误，产物正常。）

## 4. 测试覆盖要点（`test/dbview.test.ts`）

- **create → load 全链路**：建页同事务 `page.upsert + collection.upsert` 两 op；load 回默认标题属性 + 默认视图 + 零记录。
- **op_ledger 恰好 N 条**：create=2、rename=2、createRecord=1、updateRecord(普通)=1、addProperty/removeProperty/saveView 各 1、deleteRecords=N。
- **payload 不含 backlinks_json**：遍历全部 `op_ledger.op_json`，断言不含 `backlinks_json`（派生态经 `extraStatements` 同 batch 写入）。
- **relation 双写**：`updateRecord` 写 relation 值 → opCount 增量 = 2（主记录 upsert + 对方记录 upsert），对方 `backlinks_json` 记录 `{collectionId:[sourceId]}`，主记录 values 里是 relation id 数组。
- **countTargets>0 拒删**：目标记录仍被引用 → `E_REFERRED`；未引用的来源记录可删。

## 5. SSIM-NOTE（视觉对齐）

- **DbPage 外壳** `.dbpage` 镜像 `PageView` 的 `.pv-root` 容器：`--sc-color-canvas` 底、`--sc-space-gutter` 边距、`--sc-space-editor-measure` 居中——与 mockup 内容区一致。
- **四态**直接复用 `@septcats/ui` 的 `Skeleton`（loading）、`EmptyState`（empty，新建记录 primary CTA）、`ErrorPanel`（error，重试）；ready 态交给 `@septcats/dbview` 的 `DbView`（其 TableGrid 内建与行同构的 Skeleton / EmptyState / ErrorPanel）。
- **无法自证的**：表格虚拟滚动的真实帧率、关系单元格只读态的 hover/聚焦、字体与行高观感——需 PM 真机截图复审。

## 6. DEVIATIONS（有意的偏离与理由）

1. **修正既有语句 `relation.countTargets` 的 SQL**（非新增语句）：原 SQL 用 `FROM record r, json_each(r.values_json) jt` + 内层 `EXISTS(json_each(jt.value))`，但 better-sqlite3 12（SQLite 3.45+）的 `json_each`/`json_type` 对**非 JSON 文本**（如裸值「来源」）直接抛 `malformed JSON` 而非返回空集，导致只要库里存在任何文本值记录，删除前的引用检查就整体炸掉。裁决：把内层 `json_each` 的入参用 `CASE WHEN json_valid(jt.value) AND json_type(jt.value)='array' THEN jt.value ELSE '[]' END` 收口，只对合法数组做二次展开。这是修正既有语句的 bug，未触碰 `packages/dbview` 语义、未新增 SQL 语句、未改语句白名单守卫（statements.test 仍绿）。

2. **relation 候选/跳转未接 renderer**：`db:relation:search` 通道已实现（main + preload 桥），但 `DbView` 的 `onOpenRelation`/`relationCandidates` 是可选成员，一期未传——DbView 的 `relationCandidates` 是「单份扁平列表」喂给所有 relation 列，与 §1「按 targetCollectionId 逐列搜索」形状不匹配；要在不破坏 dbview 语义的前提下接上，需给 `DbView` 增加可选回调成员（如 `onRelationSearch(pid, query)`）。按任务书「props 调整仅允许新增可选成员」，此扩展留待后续（relation 列一期在 DbView 内只读）。

3. **vitest 配置**：desktop 原为单一 node 工程，本次加顶层 `esbuild: { jsx: 'automatic', jsxImportSource: 'react' }`（供被 test 引用的 `.tsx` 源码转译），`test/db-bridge.test.ts` 用文件头 `// @vitest-environment jsdom` 单独覆盖环境。与 dbview 包的「projects 拆两个工程」不同：desktop 只有一个 jsdom 用例，单工程 + 文件头覆盖更省，且不改变其余 node 用例行为。

4. **tsconfig.node.json 加 `jsx: "react-jsx"`**：`test/db-bridge.test.ts` 在 node 工程内 import `DbPage.tsx`，node 工程缺 JSX 会报 TS6142；加 `jsx` 只影响被传递引入的 `.tsx`，对 main/preload/db 无副作用。

5. **「转为数据库」在 demo 壳里用本地状态承载跳转**：当前 renderer 仍是无路由的 M0 demo（`App.tsx` 未接 `pagesStore/selectedId`），PageView 用 `dbPageId` 本地 state 在「转为数据库」后切换到新 DB 页；`db:create` 未传 `parentPageId`（建在根层），且「当前页无 collection」判定在 demo 里恒为真（无真实 page 行）。M5 接树后此按钮应改走路由/选中态。

6. **CSV 导出**：`onExportCsv` 在 renderer 侧用 `Blob + <a download>` 触发浏览器下载（无第三方库）；导出内容 = main 侧 `applyView + toCsv` 的返回串，主进程不落盘。

## 7. 未决项

1. relation 候选渲染（见 DEVIATIONS #2）需给 `@septcats/dbview` 的 `DbView` 增可选回调成员后接线。
2. `page.kind` 列当前不存在（§4 的分发退化为「PageView prop 显式传 kind」；真实 page 行无该列时按「collection 存在性判定」的分支未在 demo 中落地，因 renderer 尚无真实页面选择态）。
3. 全链路真机验收（`pnpm dev` → 侧栏选中页 → 数据库页）依赖 M5 的树/路由接线，当前 demo 壳无法触达。

---

# ADDENDUM · 2026-09-13 复核与修复（方案 2：基于当前状态继续，不重写）

> 背景：旧会话关停后 PM 指示复核 T7b 遗产——先跑 `pnpm -C apps/desktop test` 与 `pnpm -r typecheck` 修红，
> 再确认四项交付物，最后 DoD 四条原文贴报告。纪律：不改 packages/dbview 语义、不新增 SQL、CSS 只用 var(--sc-*)。

## A1. 交付物齐全性核验（第 2 步）

| 项 | 结论 | 证据 |
|---|---|---|
| main `index.ts` 注册 | ✓ | `src/main/index.ts:33-34` 导入 `createDbViewService/registerDbViewIpc`；`:142` `db: createDbViewService({ executor, actor })`；`:321` `registerDbViewIpc(services?.db ?? null, dbViewRegistrar())`（DbServer 未就绪时 null → 通道返回 E_DB_UNAVAILABLE，与 pages 一致） |
| preload / window.d.ts 桥 | ✓ | `src/preload/index.ts:70` `db: {...}` 一对一映射 `DB_CHANNELS`；`src/types/window.d.ts:95` `SeptcatsDbApi`（EOPT 可选成员）、`:143` `db: SeptcatsDbApi` |
| renderer DbPage 四态 | ✓ | `db/useDbPage.ts:14` `DbPageStatus = 'loading'\|'ready'\|'empty'\|'error'`；`DbPage.tsx:60`(Skeleton)/`:71`(ErrorPanel+retry)/`:88`(EmptyState)/`:108`(ready→DbView) |
| 两个测试文件 | ✓ | `test/dbview.test.ts`（312 行，8 用例，op_ledger 计数/payload 卫生/relation 双写/E_REFERRED）；`test/db-bridge.test.ts`（145 行，6 用例，四态转换+冒烟） |

## A2. 第 1 步结果与修复（红 → 绿）

`pnpm -C apps/desktop test`：**72/72 绿，无红**。`pnpm -r typecheck`：**7 包全 Done，无红**。

`pnpm -r test` 首跑三处红，全部修复（**实现错改实现，非改测试期望**）：

1. **packages/ui 一批测试 ENOENT**（`open '<repoRoot>\src\Switch.css'` 等）。根因：`test/css-discipline.ts` 与
   `src/tokens.test.ts` 用 **cwd 相对路径** `readFileSync('src/...')`——包内跑（cwd=包根）通过，根
   vitest projects 聚合跑（cwd=仓库根）必炸。修复：新增 `test/pkg-root.ts` 的 `resolvePkgFile()`，
   以「@septcats/ui 的 package.json」为锚解析（先看 cwd 自身，再 workspace 根下钻 `packages/ui`），
   两处调用点改为包根锚定。不用 `import.meta.url`：vitest jsdom 环境下它不是 file:// scheme（实测抛
   "The URL must be of scheme file"）。
2. **packages/ui / editor 根聚合跑 React hook 组件集体 "Invalid hook call / null useState"**。根因
   （探针实证）：调用链传下来的 cwd 是**小写盘符**（`e:\...`）→ vite 给源码模块生成的 file URL 也是小写；
   而 pnpm 符号链接的 realpath 是**大写盘符**（`E:\...`）→ Node 模块缓存按路径字符串判身份，同一份
   react 出现两个实例（ESM 侧 e:\ vs require 侧 E:\）。包内单独跑时 pnpm 给的 cwd 是大写，两侧一致，
   故只有聚合跑炸。修复：根 `vitest.config.ts` 加载期做盘符归一（`normalizeDriveCase` + `process.chdir`
   + 显式 `root`），从源头统一两侧身份；`dedupe`/`alias`/`external`/`inline`/`vmThreads` 逐个试过均无效，
   最终以此方案 ui 58/58、editor 126/126 全绿。ui 配置恢复原样，未新增逐包补丁。
3. **packages/platform credentials「set → get 恒等」5s 超时**。根因：真后端（PowerShell+DPAPI）子进程
   冷启动可超默认 5s（实测 2167ms~5012ms 抖动）。修复：真后端 describe 内六个用例显式 `20_000` 超时
   （`REAL_BACKEND_TIMEOUT`），**断言零改动**——这是环境计时放宽，非期望放宽。

## A3. DoD 四条结果原文（第 3 步，本地复跑 2026-09-13）

### ① `pnpm -r typecheck`
```
Scope: all 8 workspace projects
. typecheck$ pnpm -r --no-bail run typecheck
packages/core typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck$ tsc -p tsconfig.json --noEmit
packages/ui typecheck$ tsc -p tsconfig.json --noEmit
. typecheck: Scope: 7 of 8 workspace projects
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
. typecheck: packages/dbview typecheck$ tsc -p tsconfig.json --noEmit
. typecheck: packages/editor typecheck$ tsc -p tsconfig.json --noEmit
. typecheck: packages/schema typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
. typecheck: apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
. typecheck: apps/desktop typecheck: Done
. typecheck: Done
（各包重复段输出同上，均 Done）
```

### ② `pnpm -r test`
```
packages/core test:       Tests  38 passed (38)                                        Done
packages/platform test:   Tests  31 passed | 1 skipped (32)                            Done
packages/ui test:         Tests  58 passed (58)                                        Done
. test:（根聚合）          Test Files  51 passed (51) / Tests  328 passed | 1 skipped (329)   Done
packages/schema test:     Tests  3 passed (3)                                          Done
packages/editor test:     Tests  126 passed (126)                                      Done
packages/dbview test:     Tests  79 passed (79)                                        Done
apps/desktop test:        Test Files  6 passed (6) / Tests  72 passed (72)             Done
```
（说明：根 `. test` 与各包自身脚本对同一批用例各跑一遍——既有设计；本次修复前根聚合是红的，
修复后 51 文件全绿。）

### ③ `node packages/ui/tokens/no-magic.mjs`
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### ④ `pnpm -C apps/desktop build`
```
> node scripts/ensure-abi.mjs electron && electron-vite build
- Searching dependency tree
√ Rebuild Complete
vite v7.3.6 building ssr environment for production...
✓ 74 modules transformed.
out/main/chunks/rpc-ButtQbsY.js   17.70 kB
out/main/dbServer.js              55.10 kB
out/main/index.js                430.46 kB
✓ built in 766ms
vite v7.3.6 building ssr environment for production...
✓ 2 modules transformed.
out/preload/index.js  5.79 kB
✓ built in 13ms
vite v7.3.6 building client environment for production...
✓ 4788 modules transformed.
../../out/renderer/index.html                     1.00 kB
../../out/renderer/assets/index-M5T6RsJ-.css     45.71 kB
../../out/renderer/assets/index-zfr4z9tF.js   1,266.42 kB
✓ built in 3.93s
（中段仍有 2 条 zod `@__PURE__` 注释的 Rollup 提示，非错误，与上轮一致。）
```

## A4. 纪律遵守

- `packages/dbview`：零改动（git 工作区可证）。
- SQL：零新增、零修改（本轮未触碰 statements/migrations）。
- renderer CSS：零改动；no-magic 全绿佐证 token 纪律未破。
- 本轮改动文件仅 4 个：`vitest.config.ts`（根，盘符归一）、`packages/ui/test/css-discipline.ts` 与
  `packages/ui/test/pkg-root.ts`（新增，路径锚定）、`packages/ui/src/tokens.test.ts`（同）、
  `packages/platform/test/credentials.test.ts`（超时常量）。

## A5. 未决项（沿袭上轮，无新增）

上轮 §7 三条不变；另注：根 vitest 聚合与各包脚本存在结构性重复跑（同一用例两遍），若未来用例量
膨胀可考虑根脚本改为 `pnpm -r --no-bail run test` 直通模式——本次未动，属架构裁决，留给 PM。
