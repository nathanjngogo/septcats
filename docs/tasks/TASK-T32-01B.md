# TASK-T32-01B · 补派：块身份 `data-id` 未落到 DOM → 块手柄结构性无法渲染

> PM：Hermes ｜ P1 ｜ 前置：T32-01（`a053da8` 之后）｜ 版本：`0.3.0-rc.7` 真机

## 0. T32-01 的成绩与遗留（PM 真机复核，rc.7）

| 项 | 结果 |
|---|---|
| **斜杠菜单在视口内** | ✅ 已修（`inViewport: false → true`，11 种块型齐全） |
| **块手柄 hover 出现** | ❌ **仍未出现**：`DOM-DIAG.blockCount = 0`、`bcAny = 0`（`[class*="blockcontrol"]` 一个都没有） |

## 1. 根因链（PM 取证 + 代码定位；请按此修，勿另采方向）

1. `PageView.tsx:73 blockIdentityOf()` 读的是 **`target.closest('[data-id]')`**（**注意是 `data-id`，不是 `data-block-id`**）
2. `packages/editor/src/types/shared.ts:34 blockIdAttribute`：`renderHTML` **仅当节点 `id` attr 为非空字符串时**才输出 `data-id`；`parseHTML` 亦读 `data-id`
3. 真机实测 **`[data-id]` 元素数量 = 0** → **页面里没有任何块带块身份** → `hoverBlockId` 恒 `null`（含键盘兜底 `activeBlockId` 也拿不到）→ `BlockControls` 永不渲染
4. 因此：**T32-01 的 hover 归属链、视口夹紧、拖拽逻辑都正确，但上游「块身份没进 DOM」使它们全部失效**

**待你查清并修**（二选一或都要）：
- `packages/editor/src/react/Editor.tsx` 的 `editorExtensions()` 中，段落/标题/列表等节点是否真的挂了 `blockIdAttribute`；
- `packages/editor/src/model.ts` 的 `block → node` 映射（`blockIdAttrs`）在**从 DB 装载**（`blocks:list` → doc）与**编辑产生新块**两条路径上是否都写入了 `id` attr（很可能装载路径漏了）。

## 2. 验收（以 PM 探针为准，必须全过）

探针：`docs/mockups/probe-blocks-visibility.mjs`（已修正选择器为 `data-id`；独立夹具根）

1. `DOM-DIAG.blockCount > 0`（段落带 `data-id`）
2. hover 任意段落 → `.sc-blockcontrol__handle` **存在且在视口内**（`width>0 && top>=0 && bottom<=innerHeight && left>=0`）
3. 点手柄 → 块菜单**存在且在视口内**，含可读项
4. `/` → 斜杠菜单在视口内（**回归项，必须保持 true**）→ ↑↓+Enter 应用后段落 DOM 标签变化
5. 用手柄**拖拽把第 2 块拖到第 1 块之前** → DOM 顺序变化 **且落库**（`blocks:list` 的 `sort_key` 顺序同步变化）
6. 双主题 × hover/active/focus 截图；`no-magic`、`build-tokens --check`、`pnpm -C packages/editor test`、`pnpm -C apps/desktop test`、`pnpm -r typecheck` 全绿

## 3. 红线（同 T32-01）

允许动：`packages/editor/**`、`apps/desktop/src/renderer/src/pages/PageView.tsx`（编辑器装配相关）、`apps/desktop/test/**`、`packages/editor/test/**`。
不碰：`packages/{core,sync,dbview,importer,ui}` 契约、`main/**` 业务逻辑、CI/发布脚本。
不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。

## 4. 交付物

代码 + 测试（**新增：装载路径的块身份断言**——从 DB doc 渲染后每个块节点必须带 `data-id`）+ 真机修复前后证据（截图 + 探针输出原文）+ 报告追加到 `docs/tasks/TASK-T32-01-report.md` 的「补派」节。