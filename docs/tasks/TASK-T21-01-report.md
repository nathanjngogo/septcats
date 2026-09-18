# TASK-T21-01 · 交付报告：编辑器真实持久化（blocks IPC 实现 + PageView 接线）

> 工程师：CodeBuddy ｜ 前置：`805a3cd`（任务书提交）｜ 日期：2026-09-18
> 按 §0 PM 裁决实现，未另择方案；其中两处 **DEVIATION**（§2，任务书前提与代码事实不符，均只增不改）。
> SSIM-NOTE：本报告为唯一交付说明；§5 为 PM 复跑节留。

## §0 现状核实（任务书侦察的两处修正）

1. **commit.ts 的 block 物化并不完整**。任务书称「main/commit.ts 已支持 kind:'block' 的
   upsert/patch/move/reorder/delete」，实测旧代码只支持 `upsert`：

   ```ts
   // main/commit.ts 旧 materializeBlockStatement（原文）
   function materializeBlockStatement(op: Op, workspaceId: string): DbBatchStatement {
     switch (op.kind) {
       case 'upsert':
         return blockUpsertStatement(op, workspaceId);
       default:
         throw new CommitError('E_MALFORMED_OP', `block 暂不支持 op.kind=${op.kind}`);
     }
   }
   ```

   而 `EditSession` 的 diff（`packages/editor/src/diff.ts`）对**已存在的块**改正文/props 产
   `patch`、拖动产 `reorder`、删除产 `delete`——真机「建页→输入→重载→再输入」第二轮就会
   撞 `E_MALFORMED_OP`。**不补这三条物化路径，真实持久化不成立**，故按 §2 DEVIATION-1 补齐。
2. **statements.ts 无 `block.patch` / `block.setSort`**（`block.upsert/get/listByPage/softDelete`
   齐全），且 **block 表没有 parent_id 列**（`block.upsert` 从不落它）——patch 物化不得触碰该列。

## §1 修法

### 1.1 main/blocks.ts（新，IPC + 服务，范式照 main/search.ts 的 DI 写法）

- **`blocks:list`**：`{ pageId }` → `executor.all('block.listByPage', { page_id })`（既有语句，
  `ORDER BY sort_key, id`，与编辑器 `compareBlocksBySortKey` 同语义）→ 行映射为**编辑器
  Block 形状**（`id/page_id/type/props/content/parent_id/sort_key/alive/version/last_edited`，
  照 DEMO_PAGE 构造字段）。content 反序列化按 type 分派：`code` = 纯文本串、`divider/image`
  = null、其余 = JSON 化 PM doc（解析失败降级空段落，不丢块）。**口径**：DB 无
  `last_edited` 列，回读 `updated_at`（commitOps 写入路径把 updated_at 记为提交时刻）充当。
- **`blocks:commit`**：`{ ops: Op[] }` → 边界校验（ops 必为数组、每项为对象）→
  `await activeWorkspaceId()`（index.ts 注入，缺工作区抛 `PagesApiError('E_NO_WORKSPACE')`，
  `toBlocksError` 保留原码透传）→ **`commitOps(executor, ops, { workspaceId })` 原样透传**。
  executor 是 index.ts 里 withSyncHook 装饰后的同一执行面 → op_ledger + 物化 + FTS 同事务
  入库、batch 成功自动进 SyncRuntime 攒段器。深度校验由 `encodeOp` 负责（非法 op →
  `CommitError(E_MALFORMED_OP)` → `toBlocksError` 收敛 `E_MALFORMED`）。
- **错误**：`BlocksApiError{ code, message }` 与 PagesApiError 同形；code ∈
  `E_MALFORMED | E_NO_WORKSPACE | E_NOT_FOUND | E_INVARIANT`；IPC 层经 `fail()`
  以 `` `${code}: ${message}` `` 抛出（与 pages/importer 的透传口径一致）。
- **`blocks:changed`**：main → renderer 推送通道，本期**不注册 handler、不推送**（§0.3）；
  preload 订阅面原样保留，`test/blocks.test.ts` 钉「handler 不存在」。

### 1.2 main/index.ts 接线

`DatabaseServices` 增 `blocks`；`createBlocksService({ executor, activeWorkspaceId })` 用与
pages/dbview/importer 同一个 withSyncHook 装饰后 executor；`registerBlocksIpc(services?.blocks ?? null,
dbViewRegistrar())` 注册两通道（service=null → `E_INVARIANT` 降级，与 search 一致）。

### 1.3 preload/index.ts + types/window.d.ts（契约：载荷改对象形）

- `blocks.commit(input: { ops: Op[] })`、`blocks.list(input: { pageId: string }): Promise<Block[]>`。
  旧壳是位置参数（`commit(ops)` / `list(pageId)`）；§0 裁决明确载荷为 `{ ops }` / `{ pageId }`，
  故按裁决改形。renderer 侧旧签名调用点 grep 零命中（本任务前无消费者），无破坏面。
- `SeptcatsApi.blocks` 注释更新（main 已实现；changed 本期不推送）。

### 1.4 PageView.tsx（仅数据源与 commit 接线；既有编辑器/AI/协作接线不动）

- **数据源**：`usePages` 取 `pagesStore.selectedId + nodes` → 选中真实页则
  `blocks:list({ pageId })` 加载并组 `BlockDoc` 喂 `Editor`（`key={pageId}` 强制换页重建，
  Editor 的 doc 只在挂载时读一次）；**无选中页/显式 demo 入口走 `DEMO_PAGE` 兜底**（保留常量）。
- **四态**：demo / loading（`Skeleton`）/ error（`ErrorPanel` + 重试）/ ready（含空页
  `blocks=[]` → 空文档直接可输入）；均为 `@septcats/ui` 既有组件，token/类名零新增。
- **commit**：`EditSession` 工厂化（baseline 只能在构造时给定，随加载的 doc 重建）；
  真实页 commit = `window.septcats.blocks.commit({ ops })` 原样透传（renderer 不组 Op），
  失败 reject → 既有 `onError` 回调 + `flush()` 冒泡，**不吞**。换页/卸载前 flush 旧页在途
  轮次（commit 闭包捕获旧 pageId，落库目标正确）。**demo 页保持既有内存账本**：demo 页
  id 不在库中，走 IPC 会向 op_ledger 写脏数据（DEVIATION 记录于 §2-3）。
- **touchRecent**：打开真实页调一次 `recent.touch`（§0.6），失败只 console 记录。
- UI 视觉零变化：无新增组件/类名/token；ready 态的标题行/编辑器渲染与改前逐像素同构。

## §2 DEVIATIONS（三处，均已在代码注释标注 T21-01）

1. **DEVIATION-1**：`main/commit.ts` `materializeBlockStatement` **新增** `patch` →
   `block.patch`、`reorder` → `block.setSort`、`delete` → 复用既有 `block.softDelete` 三个
   case。upsert 路径零改动；未知 kind 仍显式拒绝。依据：§0-1 的核实（任务书前提与代码
   不符，不补则持久化在第二次编辑即断）。patch 的 FTS 由 v4/v6 触发器即时生效（单条
   常规路径 flag=0，`fts.deferOn` 只在 ≥2 条 upsert 的批量场景开启，语义零触碰）。
2. **DEVIATION-2**：`db/statements.ts` **只增不改**新增两条白名单语句：
   `block.patch`（COALESCE(@x, col) = 缺席字段不触碰；无 parent_id 列，不触碰）与
   `block.setSort`。随之**机械更新** `test/statements.test.ts` 的白名单总数钉
   `57 → 59`（该钉在 T15/T20 增语句时即同步过，见其测试标题自述；`< 60` 预算仍成立）。
   **口径说明**：这是「既有断言语义」的唯一触碰，语义=「白名单总数与新增语句同步」，
   与该测试自身演进口径一致，其余既有断言一律未动。
3. **DEVIATION-3**：任务书 §0.4「commit 回调改调 blocks:commit」在 **demo 兜底页**上保留
   旧内存路径。依据：DEMO_PAGE 的 id（`pg00000000000000000000demo`）非库中实体，提交会
   在 op_ledger/block 表写脏数据（block 表对 page_id 无外键约束）；§0.5「DEMO_PAGE 保留作
   兜底」与其一致。有选中页时全部走 IPC。

## §3 交付物清单

- `apps/desktop/src/main/blocks.ts`（新：服务 + IPC 注册器 + 行映射 + 错误映射）
- `apps/desktop/src/main/commit.ts`（DEVIATION-1：block patch/reorder/delete 物化）
- `apps/desktop/src/db/statements.ts`（DEVIATION-2：+`block.patch` / +`block.setSort`）
- `apps/desktop/src/main/index.ts`（服务装配 + 注册；shared/ipc.ts 通道常量复用未动）
- `apps/desktop/src/preload/index.ts` + `apps/desktop/src/types/window.d.ts`（契约对象形）
- `apps/desktop/src/renderer/src/pages/PageView.tsx`（数据源 + commit + touchRecent + 四态）
- `apps/desktop/test/blocks.test.ts`（新 10 用例）
- `apps/desktop/test/statements.test.ts`（仅白名单总数钉 57→59，DEVIATION-2）

## §4 测试（apps/desktop/test/blocks.test.ts，8+2 用例）

- **list 形状与排序**：先写 sort_key 靠后的块再写靠前的 → 返回按 sort_key 升序；逐字段
  断言 Block 形状（page_id/type/props/content/parent_id/sort_key/alive/version/last_edited）。
- **list 内容形态**：code 块 content = 纯文本、divider = null；**空页返回 `[]`**。
- **commit 真库 roundtrip**：upsert → patch（正文变 v2、version=2）→ reorder（sort_key 变）
  → delete（list 排除）→ `opLedger.count` 增 4（真相层同事务入账）。
- **commit 假 executor 断言 sqlId 与参数**：upsert batch =
  `[opLedger.insert, block.upsert, fts.clearPage, fts.syncBlock]`（workspace_id 注入、
  version=lamport.c、lamport_d=actor）；patch batch = `[opLedger.insert, block.patch]`
  （content_json 落、缺席字段 null=不触碰）；reorder → `block.setSort`；delete →
  `block.softDelete`。
- **非法入参**：ops 非数组 / op 非对象 / pageId 空 → `E_MALFORMED`；无工作区 →
  `E_NO_WORKSPACE`；service=null → `E_INVARIANT`；`blocks:changed` handler 不存在。

**修复前红**（本单为纯新增能力，红 = 旧代码的显式拒绝，原文见 §0-1 代码引文：
`throw new CommitError('E_MALFORMED_OP', 'block 暂不支持 op.kind=patch'）` + main 侧无
blocks 通道 handler（invoke 必 reject）+ PageView commit 只 console.info）。

**修复后绿**（自跑原文）：

```
 Test Files  32 passed (32)
      Tests  334 passed (334)
```

```
 packages/editor typecheck: Done
 ...
 apps/desktop typecheck: Done
```

```
 ✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

**口径说明**：`pnpm -r typecheck` 首跑报 `blocks.ts` 未使用接口（TS6196），已删。
`perf.test.ts` 的 commit-batch P95 在全量套件并行加载下偶发 18–24ms（预算 16ms），
隔离复跑与本轮全量收尾均绿——属机器负载噪声，本单 diff 未触碰 upsert 批量路径
（deferFts 逻辑零改动），提请 PM 收口复跑时留意。

## §5 PM 复跑（PM 补）

- （PM 补）全仓：`pnpm -r test` + `pnpm -r typecheck` + `node packages/ui/tokens/no-magic.mjs`
- （PM 补）selftest + 重打包
- （PM 补）真机 CDP：建页 → 编辑器输入中文 → 重载 app → 文本仍在（跨进程真落库）；
  断言 `blocks:list` 返回内容与输入一致；再输入一轮（验证 patch/reorder/delete 物化路径）
- （PM 补）无选中页时 DEMO_PAGE 兜底显示不被回归
