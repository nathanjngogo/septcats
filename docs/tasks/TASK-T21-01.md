# TASK-T21-01 · 关键路径 1/2：编辑器真实持久化（blocks IPC + PageView 接线）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T20-02 已交付（`315defb`）
> 背景（PM 侦察实证）：`shared/ipc.ts` 里 `blocks:commit` / `blocks:list` / `blocks:changed` 通道 **T5 只定了名、main 侧从未实现**；`PageView` 的 EditSession 是 `memorySession`（`commit: (ops) => { ledgerRef.push(...); console.info(...) }`，`PageView.tsx:189-204`）——**编辑内容从不落库**。DB 面其实已就绪：`statements.ts` 有 `block.upsert/get/listByPage/softDelete`，`main/commit.ts` 已支持 `kind:'block'` 的 upsert/patch/move/reorder/delete。本单只补「IPC + renderer 接线」这一层。

## 0. PM 裁决（先定死，勿另择方案）

1. **读**：新增 `blocks:list`（`{ pageId }` → `BlockDoc[]`）→ main 内部走既有 `block.listByPage`（`statements.ts:265`，先读它的真实列名）；返回形状 = **编辑器 Block 形状**（照 `PageView.tsx` 里 `DEMO_PAGE` 构造的字段：`id/page_id/type/props/content/parent_id/sort_key/alive/version/last_edited`）。**排序按 `sort_key`**（与编辑器一致）。
2. **写**：新增 `blocks:commit`（`{ ops: Op[] }`，Op 为 core 契约）→ main 复用既有 `commitOps(db, ops, { workspaceId })`（`main/commit.ts`）+ `withSyncHook`（进真相层 + 攒段），错误按既有 `PagesApiError` 风格映射（`E_MALFORMED` 等）。**renderer 不组 Op**：沿用既有 `EditSession`（`packages/editor/src/seq.ts`）产出的 ops 原样透传。
3. **事件**：`blocks:changed` 本期**只注册不推送**（保留通道名给后续协作/多窗口），不做订阅实现——避免超范围。
4. **PageView 接线**：改为按 `pagesStore.selectedId` 加载该页 blocks（`blocks:list`）并喂给现有编辑器/`EditSession`；`commit` 回调改调 `window.septcats.blocks.commit({ ops })`（失败照既有 onError 路径，不吞）。选中页为空/加载失败 → 走既有四态（加载/空/错误），**不改 UI 视觉**（token 不变、无组件新增）。
5. `DEMO_PAGE` 常量**保留**（T21-02 之前浏览器环境/无选中页时的兜底显示），但**有选中页时必须显示真实页**。
6. `touchRecent({pageId})`：打开页时调用一次（既有 API），失败只记录。

## 1. 交付物

- `apps/desktop/src/shared/ipc.ts`（通道常量，若已存在则复用不新增）、`main/blocks.ts`（新，IPC 注册器 + 服务实现，范式照 `main/search.ts` 的 DI 注册器写法）、`main/index.ts`（接线）、`preload/index.ts` + `types/window.d.ts`（`septcats.blocks.{list,commit}`）。
- `renderer/src/pages/PageView.tsx`：按选中页加载/提交（保持既有编辑器、AI、协作接线不动）。
- 测试：`apps/desktop/test/blocks.test.ts`（新）——list 形状与排序 / commit 落库（用内存假 executor 断言 sqlId 与参数）/ 非法入参 E_MALFORMED / 空页返回 []；renderer 侧若有环境限制则用 store/IPC 级测试并在报告说明口径。
- `docs/tasks/TASK-T21-01-report.md`（根因 → 修法 → 修复前红/修复后绿原文 + PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：`shared/ipc.ts`、`main/blocks.ts`(新)、`main/index.ts`、`preload/index.ts`、`types/window.d.ts`、`renderer/src/pages/PageView.tsx`(仅数据源与 commit 接线)、`apps/desktop/test/**`(新/追加)。
- **不碰**：`packages/{core,sync,editor,ui,schema,dbview,importer}`（既有一切契约）、`main/{collab,sync,search,dbview,pages}.ts` 既有逻辑、`statements.ts` 既有语句（如需新语句 → 报告说明并只新增不改旧）、CI/发布脚本、侧栏（T21-02 范围）。
- 不加新依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（只许追加）。

## 3. 自跑（全仓与真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`。
**PM 收口会跑**：全仓 + selftest + 重打包 + **真机 CDP**：建页 → 编辑器输入中文 → 重载 app → 文本仍在（跨进程真落库）；并断言 `blocks:list` 返回内容与输入一致。

## 4. 边界（本单不做，T21-02 承接）

侧栏真树渲染/展开折叠/新建重命名入口、选中页的 UI 呈现细节、搜索命中跳转、AI/协作在真实页上的回归——**本单只保证「数据真实落库 + 按选中页加载」**。