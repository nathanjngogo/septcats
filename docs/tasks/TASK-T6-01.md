# TASK-T6-01 · M5 页面树与工作区（数据层 + 视图）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T5（packages/editor）已合入。必读：docs/schema-v1.md §4（page 实体）、docs/mockups/02-sidebar-tree.html（视觉+交互基准）、docs/PROJECT_PLAN.md §7 M5。
> 纪律：只 Write/Edit；不跑终端命令、不碰 git；禁占位符。

## 0. 范围
1. `packages/core` 不动；页面树的派生逻辑进 `packages/editor`（已有 model 层）新文件 `tree.ts`（纯函数：blocks↔树、重平衡、回收站级联）。
2. apps/desktop 主进程新增 `pagesApi`（走 DbServer RPC，白名单语句在 db/statements.ts **追加 migration v2 + 新白名单**，别改 v1）：page.create/rename/move/delete/restore/listTree/favorites/recent。
3. renderer：Sidebar 树（虚拟列表）、PageHeader（标题/图标/面包屑）、回收站页、工作区切换器（多工作区 CRUD）。

## 1. tree.ts（packages/editor/src/tree.ts + test/tree.test.ts）
```ts
export interface PageNode { id: string; title: string; icon: string|null; childIds: string[]; parentId: string|null; depth: number; alive: 1|0 }
export function buildTree(pages: PageNode[]): { roots: PageNode[]; childrenOf: Map<string,PageNode[]>; maxDepth: number }
export function flattenVisible(roots, expanded: Set<string>): FlatRow[]  // {node, depth, hasChildren}；折叠子树跳过；稳定序 sort_key 升序
export function collectDescendants(id: string, childrenOf: Map<string,string[]>): string[]  // 级联删除/恢复用，防环（visited 集 + 深度上限 50 → 遇环 throw TreeCycleError，这是数据损坏信号）
export function cascadeDeleteOps(pages, id, ctx:{actor,now}): Op[]      // 自身+后代 → delete op 列表
export function restoreOps(pages, id, ctx): Op[]                        // 只复活 alive=0 链；父仍死→不复活该链（返回空数组 + reason 'parent-gone'）
export function rebalanceLayer(ids: string[], gen: (i:number,n:number)=>string): Op[]  // 重平衡=对同层全部 alive 兄弟重发 reorder（配合 editor/diff 的失败降级）
```
测试：2000 页随机树（mulberry32）：buildTree O(n)、flatten 幂等、级联删除不含环、restore 半链、rebalance 有序。

## 2. db 层（apps/desktop/src/db）
- `migrations.ts` 追加 **v2**（禁改 #1）：`favorite(user_key TEXT, page_id TEXT, added_at INTEGER, PK(user_key,page_id))`、`recent(user_key TEXT, page_id TEXT, last_opened INTEGER, PK(user_key,page_id))`、`page` 加列 `deleted_at INTEGER`（ALTER TABLE，STRICT 表加列用建新→拷→改名三步或 SQLite 原生支持；你验 better-sqlite3 12 的行为）、`mention(source_page_id TEXT, target_page_id TEXT, PK(source_page_id,target_page_id))`。索引：recent(user_key,last_opened DESC)、page(workspace_id, deleted_at IS NULL)。
- 白名单新增（params zod 校验，全部带 workspace_id）：`page.insert/page.rename/page.setSort/page.setDeleted/page.setChildrenOrder?/page.listByWorkspace/page.listTrash/favorite.add/favorite.remove/favorite.list/recent.touch/recent.list`（recent.touch=UPSERT last_opened；list 排除已删；上限 20 条）。
- 语句总数 < 40；`statements.test.ts` 追加每条 happy + 越界 workspace_id 拒绝。

## 3. 主进程 pagesApi（apps/desktop/src/main/pages.ts + preload 扩展）
- IPC channels（shared/ipc.ts 追加）：`page:create {parentId?} → {id}`（title='未命名'，sort_key=该父下 max+1；父不存在→E_PARENT_GONE）、`page:rename`、`page:move {id,newParentId,newSortKey}`（**防环：newParent ∈ descendants(id) → E_CYCLE**）、`page:delete {id}`（级联 op batch：同事务）、`page:restore {id}`、`page:tree {workspaceId}`（返回 alive+deleted 全量 PageNode[]，renderer 组树）、`fav:set/list`、`recent:touch/list`、`workspace:create/rename/list/switch`（switch=设 settings 活动 ws + 重建 DbHandle 指向不变【单库分片 Q4】，只换活动 id + 通知 renderer 重载树）。
- **一切写路径先造 Op 再落库**：`commitOps(ops)` helper = batch{opLedger.insert × N + 对应物化 *.upsert}，与编辑器 commit 同构（复用/下沉 T5 的 EditSession.commit 抽象到 `src/main/commit.ts`，别让 pages 走裸 SQL 旁路——**旁路=审计打回**）。
- preload：`window.septcats.pages.*` 一一对应（类型 window.d.ts 更新）。

## 4. renderer
- `pages/WorkspacePage.tsx`：左树右编辑器。树=虚拟列表（自写 windowing：行高 26、overscan 10，不引库），行 hover/展开三角/插入线/hover ⋮⋮（复用 editor 的 dnd 语义：拖=move+sort_key，drop 到行中=改 parent）。右键菜单（重命名 F2/复制链/收藏/删除 Del→确认 Dialog 引用 ui）。回收站入口侧栏底部。
- `pages/TrashPage.tsx`：按 deleted_at 倒序分组（≤30 天），行内 恢复/彻底删除（danger Dialog 文案对齐 mockup 10）。
- 顶栏：面包屑（page:tree 派生 parent 链）+ 工作区切换器（Popover 列表 + 新建）。
- App 数据流：tree 状态在 Zustand store（`renderer/src/state/pages.ts`）：load/invalidate 乐观更新（失败回滚 + Toast error）。
- **视觉：与 02 mockup 对齐是验收项**；组件只用 @septcats/ui；新增 CSS 只 var(--sc-*)（no-magic 门禁覆盖到 apps/desktop/src/renderer —— 把它扫 src/**/*.css 一起，你顺手扩 no-magic 的目录参数）。

## 5. 性能红线（测试可测部分）
- buildTree+flatten 2000 页 < 30ms（vitest bench 或计时断言）；主进程 page:tree 2000 页 < 80ms（SQLite 单查询）。

## 6. DoD（PM 复跑）
```
pnpm install && pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest     # v2 迁移不破重建链路（selftest 加一步 migrate→v2→rebuild 断言）
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告格式同前（SSIM-NOTE 对齐 02/10 mockup）。
