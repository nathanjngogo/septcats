# TASK-T23-01 · 模板子系统（方案 B）· 数据面：`template` 表 + 服务层 + IPC

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T22-01（`6f000cf` 之后）
> 老板裁决（`docs/模板功能-PRD草案.md`）：**方案 B = 页面模板 + 数据库模板都做**；两处入口（侧栏「新建页面」下拉 + 命令面板）；模板列表显示**名称+图标**；数据库模板**现在做**（不分批）。

## 0. PM 裁决（先定死，勿另择方案）

### A. 存储：新表 `template`，走 op 账本（**不用文件、不塞块表**）

理由（PM 侦察实证）：库内一切数据都在账本上（`commitOps` + 段文件 + 同步），模板若放 `<root>/templates/*.json` 会**绕过账本**（不同步、无审计、无隔离）；塞进 `block` 表则必须到处加过滤（搜索/最近/树/回收站）且易漏。新表天然满足 PRD 的「模板不进搜索、不进最近」。

- `SCHEMA_VERSION` **2 → 3**（0.3.0 尚未发布，其 schema 仍可演化；`MIN_SUPPORTED` 保持 1，v1/v2 数据照旧可读 → 已装机数据与 rc 食客数据均不受影响）。
- 表结构（照既有表风格与 `docs/schema-v1.md` 纪律）：
  `template(id PK, kind TEXT, title TEXT, icon TEXT NULL, payload TEXT(JSON) NOT NULL, alive INTEGER, version INTEGER, created_at, updated_at, deleted_at NULL)`
  - `kind ∈ {'page','database'}`；`payload` 为 JSON 安全的普通对象（**零 React、零 IO**，照 dbview/types.ts 的纪律）。
  - **页面模板 payload**：`{ title, icon, blocks: Block[] }`（块树，含 sort_key/parent 关系，id 保留但仅作结构参照）。
  - **数据库模板 payload**：`{ title, icon, collection: { name, schema, views } , blocks?: Block[] }` —— **不含 record 行**（PM 决定：模板=结构，不是数据副本；行数会让模板体积不可控且用户预期混乱）。
- op 侧：`OP_KINDS` + `'template'`，`MERGE_POLICIES` 保持既有三项（模板走默认 LWW 整对象即可），statements 增 `template.upsert/patch/get/list/softDelete`（**只增不改**既有语句）。

### B. 服务层 `apps/desktop/src/main/templates.ts` + IPC

通道（`shared/ipc.ts` 只增常量；preload/`window.d.ts` 同步；契约用**对象形载荷**，与 T21-01 一致）：

| 通道 | 入参 | 出参 |
|---|---|---|
| `templates:list` | `{ kind? }` | `{ templates: TemplateMeta[] }`（不含 payload；`{id,kind,title,icon,updated_at}` 按 updated_at 倒序） |
| `templates:get` | `{ id }` | `{ template: TemplateMeta + payload }`（预览/编辑用） |
| `templates:saveFromPage` | `{ pageId, title, icon? }` | `{ id }` —— 读该页块树（`block.listByPage`）→ 若该页有 `collection`（数据库页）则同时取 schema/views → 落 `template`（kind 自动判：有 collection → `'database'`，否则 `'page'`） |
| `templates:rename` | `{ id, title, icon? }` | `{}` |
| `templates:delete` | `{ id }` | `{}`（软删，照既有风格） |
| `templates:createPage` | `{ templateId, parentId: string \| null }` | `{ pageId }` —— **深拷贝为新页**：新 page id + 新 block id（全集**不得与源重合**，逐 id 断言）+ 新 collection id（若 kind='database'，schema/views 复制、**records 不复制**） |

- 复用既有 `commitOps` + `withSyncHook`（T21-01 已有范式），错误按 `PagesApiError` 同形映射（新增 `E_TEMPLATE_NOT_FOUND`）。
- **零外联**：模板不触发任何网络。

### C. 测试 `apps/desktop/test/templates.test.ts`

1. `saveFromPage`：页面 → kind='page'，payload.blocks 与该页块数一致；数据库页 → kind='database' 且含 collection.schema/views、**payload 不含 record**。
2. `createPage` 副本语义：新页 id + 每个 block id 均不等于源（集合断言）；块结构（层级/顺序/文本）一致；**源页与模板均未被修改**（前后 diff 为空）。
3. 数据库模板 `createPage`：新 collection id、schema/views 等价、**新库里 0 条 record**。
4. **隔离断言**：模板创建后，`search`（FTS）对模板标题**零命中**；`pages.list`/最近列表**不含模板**。
5. 错误：`E_TEMPLATE_NOT_FOUND`、非法入参 `E_MALFORMED`、无 workspace `E_NO_WORKSPACE`。
6. SQL 层：`template.*` 语句的参数/返回（假 executor 或真库 roundtrip，照 `blocks.test.ts` 范式）。

### D. 版本钉

`SCHEMA_VERSION` 2→3 后，全仓扫 `toBe(2)` / `SCHEMA_VERSION` 断言同步（机械钉，非行为回归）；`statements.test.ts` 白名单总数机械同步（只改计数，不断言语义）。

## 1. 交付物

`packages/core/src/**`（OP_KINDS + 'template'；SCHEMA_VERSION 2→3）、`apps/desktop/src/db/{statements.ts,schema?迁移}`、`apps/desktop/src/main/{templates.ts(新),index.ts}`、`apps/desktop/src/shared/ipc.ts`、`preload/index.ts`、`types/window.d.ts`、`apps/desktop/test/templates.test.ts(新)`、`docs/tasks/TASK-T23-01-report.md`（PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：上述清单 + 因版本钉必须同步的既有测试断言（**只改版本常量/计数**）。
- **不碰**：renderer（UI 归 T23-02）、`packages/{sync,editor,ui,dbview,importer}` 契约、`main/{collab,sync,search,dbview,pages,blocks}.ts` 既有逻辑、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（版本钉除外，须在报告列出）。

## 3. 自跑（全仓/selftest/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机（T23-02 落地后）：搭 3 级结构页 → 另存模板 → 从模板新建 → 结构完整且源页不变 → 数据库页另存 → 从模板新建 → 属性 schema 齐、0 行数据 → 模板不出现在搜索/最近。