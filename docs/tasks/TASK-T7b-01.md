# TASK-T7b-01 — M6 数据接线（main IPC + preload + renderer 桥）

> 前置：T7 已交付 `packages/dbview`（79 tests 绿）与 db v3 statements，本任务**只做接线**，
> 不改 packages/dbview 的纯逻辑与组件语义（若确需微调 props/回调形状，改动必须向后兼容且附测试）。

## 0. 一句话
把「行内数据库」从库侧组件接到真进程链路上：renderer 打开一个 `kind='database'` 的 page
→ 渲染 DbView → 每个操作经 IPC → main 用 **commitOps 同源**（Op + 物化同事务）落 DbServer。

## 1. shared/ipc.ts — 通道契约（一次定死，禁止中途改名）
```
// renderer → main 请求（pageId 为锚，collection 通过 collection.getByPage 反查）
db:create   { workspaceId, parentPageId?, title }  -> { pageId, collectionId }   // 同事务 batch：page.upsert + collection.upsert
db:load     { pageId }                            -> { collection, records }     // collection.getByPage → record.listByCollection
db:rename   { pageId, title }                     -> { ok: true }                // 双写 page.rename + collection 主键名？→ 只写 collection.name 与 page.title 同一 batch
db:record:create { pageId, values? }              -> { record }                  // sort_key=层尾（maxSortKey+fractional 尾），Op{target:'record'} upsert
db:record:update { pageId, recordId, patch }      -> { record }                  // patch=Partial<values>；relation 走双写 batch（主写 + 对方 backlinks），一个 batch 原子
db:record:delete { pageId, ids }                  -> { ok: true }                // 每条一个 delete op（soft），批量一个 batch
db:prop:add      { pageId, type }                 -> { collection }              // 新 pid=id('p')，Op{target:'collection'} schema patch
db:prop:update   { pageId, pid, patch }           -> { collection }              // rename/type 变更；type 变更需值迁移 → 一期只允许 rename，type 变更返回 E_UNSUPPORTED（写死在任务里，防 CodeBuddy 自由发挥）
db:prop:remove   { pageId, pid }                  -> { collection }
db:view:save     { pageId, view }                 -> { collection }              // collection.setViews 局部 patch
db:relation:search { pageId, targetCollectionId, query } -> { candidates }       // record.listByCollection + 前缀过滤，≤50 条
db:export:csv    { pageId }                       -> { csv }                     // 可见行按当前 view 过滤后导出（applyView + toCsv）
```
错误统一走 `PagesApiError` 同形的 `{ code, message }`（reject，不吞错）。

## 2. main 侧（apps/desktop/src/main/dbview.ts，新文件）
- `createDbViewService({ executor, workspaceId })`，仿 `pages.ts` 的 `createPagesService` 结构：
  - 每个写方法：造 Op（`opLedger` 经 `commitOps`，`commitOps(executor, ops, { workspaceId })`）→
    物化表 upsert/delete 在**同一个 batch** 内（参考 pages.ts 的写法与 T7 的 `record.upsert`/`setBacklinks` 语句）。
  - `relation` 值变更：主 record upsert + 对方 record backlinks upsert，**一个 batch**（§2 双写原子）。
  - Op payload 不含 `backlinks_json`（派生态，见 v3 注释）。
  - collection 的 `views_json/schema_json` 整体替换只在 `prop:*` 与 `view:save` 时发生，且必须 `version+lamport` 前进。
- `registerDbViewIpc(service)`：`ipcMain.handle` 逐个通道，参数 `zod` 再校验一次（不信任 renderer）。
- `index.ts` 里与 pages 同样式注册（service 可为 null：DbServer 未就绪时通道返回 `E_DB_UNAVAILABLE`，与 pages 一致）。

## 3. preload（src/preload/index.ts）
- `septcats.db = { create, load, renameRecord?→recordUpdate, ... }` 一对一映射 §1 通道；
  形状 `src/types/window.d.ts` 同步补 `db: { ... }`（EOPT 风格：可选成员一律 `?: T | undefined`）。

## 4. renderer 桥（src/renderer/src/db/）
- `useDbPage(pageId)`：状态机（loading/ready/empty/error + retry）；挂载时 `db:load`，操作后按需局部刷新（乐观可不做，一期以 IPC 回包为准）。
- `DbPage.tsx`：渲染 `@septcats/ui` 的 token 外壳 + `@septcats/dbview/react` 的 `DbView`，
  props 全接上（onChangeValue→record:update，onAddProperty→prop:add...）。
  - **UI 红线 §16 全量适用**：所有自定义 CSS 走 `var(--sc-*)`，禁字面 hex / 非 1px 裸 px（no-magic 扫描含 apps/desktop/src/renderer）。
  - 四态齐（loading→Skeleton、empty→EmptyState、error→ErrorPanel 重试）。
- `PageView.tsx` 内容区分发：`page.kind==='database'`（page 行有该列则用；无则用 collection 存在性判定）→ `<DbPage/>`，否则编辑器；
  PageView 顶栏加「转为数据库」按钮：当前页无 collection → `db:create`（标题=页标题）→ 跳转。

## 5. 约束
- **不改 packages/dbview 语义**；DbView 组件 props 需要调整时仅允许新增可选成员。
- 写路径绝不绕过 commitOps（不许直接 `run('record.upsert')` 不落 op_ledger）。
- 新语句需求若超出 v3 statements 白名单：**先停下来**，在报告里列出需要的语句（PM 扩白名单需同步改 statements.test 守卫断言）。
- Electron ABI：跑 desktop 测试必须 `pnpm test`（pretest 守卫），不许直跑 `npx vitest`。

## 6. 测试最低要求
- main：`test/dbview.test.ts` —— create/load/rename/record 全链路（better-sqlite3 直连 + 真 commitOps），
  断言每个写操作在 op_ledger **恰好 1 条/批 N 条**且 payload 不含 backlinks_json；relation 双写：一个 batch 两 op；删除前 `relation.countTargets>0` 拒删（E_REFERRED）。
- renderer 桥：`test/db-bridge.test.ts`（vitest jsdom，vi.mock window.septcats.db）——useDbPage 四态转换 + DbPage 渲染 smoke。
- 全仓：`pnpm -r typecheck && pnpm -r test` 绿；`pnpm -C apps/desktop build` 绿。

## 7. DoD
```
pnpm -r typecheck
pnpm -r test
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告：通道清单 + 文件清单 + 测试结果原文粘贴。
