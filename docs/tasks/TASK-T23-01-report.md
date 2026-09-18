# TASK-T23-01 · 交付报告：模板子系统（方案 B）· 数据面：`template` 表 + 服务层 + IPC

> 工程师：CodeBuddy ｜ 前置：`a3f506e`（T22-01 交付提交，已 `git log -1` 核实）｜ 日期：2026-09-19
> 按 §0 PM 裁决实现，未另择方案；DEVIATION 见 §4（4 处，均为机械连带/最小实现，不改语义）。
> SSIM-NOTE：本报告为唯一交付说明；§6 为 PM 复跑节留（PM 补）。

## §0 交付范围

- **存储**：migration #7 建 `template` 表（STRICT，`id/kind/title/icon/payload/alive/version/created_at/updated_at/deleted_at`）+ `idx_template_alive`；core `SCHEMA_VERSION` **2→3**（`MIN_SUPPORTED_SCHEMA_VERSION` 保持 1，v1/v2 段/快照照旧可读）；`OP_KINDS` + `'template'`；`targetTableSchema` + `'template'`；statements 白名单 +5：`template.upsert / patch / get / list / softDelete`（只增不改）。
- **服务层** `apps/desktop/src/main/templates.ts`（新）+ IPC 六通道（对象形载荷）：
  | 通道 | 出参 |
  |---|---|
  | `templates:list({kind?})` | `{templates: TemplateMeta[]}`（不含 payload，updated_at 倒序） |
  | `templates:get({id})` | `{template: TemplateMeta + payload}` |
  | `templates:saveFromPage({pageId,title,icon?})` | `{id}`（kind 自动判：有 collection → `'database'`） |
  | `templates:rename({id,title,icon?})` | `{}`（icon 缺省 = 保持不变） |
  | `templates:delete({id})` | `{}`（软删 alive=0 + deleted_at） |
  | `templates:createPage({templateId,parentId})` | `{pageId}`（深拷贝） |
- **接线**：`shared/ipc.ts` 加 TEMPLATES_CHANNELS 六常量；`preload/index.ts` 挂 `window.septcats.templates`；`types/window.d.ts` 加 `SeptcatsTemplatesApi`（类型从 main/templates 以 type-only 导入）；`main/index.ts` 建 `templates` 服务（装饰后 executor + activeWorkspaceId 注入）并 `registerTemplatesIpc`。
- **payload 契约**（PM §0.A 照抄）：`kind='page'` → `{title, icon, blocks}`；`kind='database'` → `{title, icon, collection:{name,schema,views}, blocks?}`；**不含 record 行**。
- **零外联**：模板不触发任何网络；renderer 零改动（UI 归 T23-02）。

## §1 关键实现口径

### 1.1 写路径（saveFromPage / rename / delete / createPage）

- **op 形态**：PM 裁决「模板走默认 LWW 整对象」→ 新建/改名用 **`kind='template'` 整对象** payload（`{kind,title,icon,payload,alive,updated_at}`，replay 侧按 upsert 语义整对象生效）；软删用既有 **`kind='delete'`**（payload `{}`）。二者均过 `commit.ts` 的 `ledgerStatement`（`encodeOp` 校验 + 稳定键序单行 JSON 入账）。
- **batch 组装**（单事务 = 真相层 + 物化不分叉）：
  - saveFromPage/rename：`[opLedger.insert, template.upsert]`；
  - delete：`[opLedger.insert, template.softDelete]`；
  - createPage：page.upsert + block.upsert×N +（database）collection.upsert 的 ledger×M + 物化×M，尾部照 commitOps 口径追加 `fts.clearPage + fts.syncBlock`（新页一次）；块数 ≥2 时头尾插 `fts.deferOn/deferOff`（T15-01 同款守卫，避免触发器 O(n²) 整页重算）。
- **rename 用 `template.upsert` 而非 `template.patch`**：op payload 是整对象，物化若走 patch 只改 title/icon 会令 ledger 与投影字段分叉（payload 列不更新）；故行与 payload 内的 title/icon 同步整体写。`template.patch` 语句保留在白名单（局部改名路径 + 测试锁参数/COALESCE 语义），本期服务层未调用（见 §4 DEVIATION-3）。
- **createPage 深拷贝**：两遍分配——先给每个源块发全新 id（ulid），再按新 id 重挂 `parent_id`；集合断言「新块 id 全集 ∩ 源块 id = ∅」由测试锁定（test/templates.test.ts 用例 3）。database 模板：新 collection id，schema/views 深拷贝（JSON 已是新对象），**records 不读不写**。
- **E_NO_WORKSPACE**：saveFromPage/createPage 先 `await activeWorkspaceId()`（index.ts 注入抛 PagesApiError E_NO_WORKSPACE；测试注入域错误直抛同码）。saveFromPage 物化语句本身无 workspace 列，但守卫语义与 blocks 写路径一致：无活动工作区不允许落模板。

### 1.2 读路径与隔离

- `template.list`：`alive=1 AND (@kind IS NULL OR kind=@kind) ORDER BY updated_at DESC, id`（@kind 复用同一命名参数两次）。
- **模板天然不进 FTS/树/最近**：模板不在 page/block 表，FTS 触发器与 page 查询碰不到它——测试用例 5 用 `search.ftsPage` + `search.likeFtsPage` 对模板标题双路断言零命中、`page.listAll`/`recent.list` 不含模板 id。

### 1.3 同步/重建面（随 core 枚举扩展的连带，全部只增不改）

- `core/replay.ts`：`materialize` 增 `case 'template'`（与 upsert 同义）——否则远端模板 op 在 replay 的穷尽 switch 里会 throw。
- `db/server.ts`（重建路径）：`TABLE_INSERT_ORDER.template=5`、`STATEMENT_FOR_TABLE.template='template.upsert'`、`entityToParams` 增 template 分支（从实体 data 读 kind/title/icon/payload/created_at 等）——快照/分段重建时模板实体照常重物化。
- `main/commit.ts`、`packages/editor/src/history.ts`：穷尽 switch 各补一个显式拒绝分支（见 §4 DEVIATION-2）。

## §2 版本钉改动清单（§0.D，逐处列出；只改常量/计数/字节钉，语义不变）

| # | 文件:行 | 改动 |
|---|---|---|
| 1 | `packages/core/src/op.ts` | `SCHEMA_VERSION` 2→3（源，非钉）+ 注释 v3 说明 |
| 2 | `packages/core/test/op.test.ts:75` | `expect(SCHEMA_VERSION).toBe(2)` → `toBe(3)` |
| 3 | `packages/core/test/index.test.ts:7` | `expect(core.SCHEMA_VERSION).toBe(2)` → `toBe(3)` |
| 4 | `packages/core/test/replay.test.ts:151` | 空投影快照字节钉 `'{"entities":[],"v":2}'` → `'{"entities":[],"v":3}'` |
| 5 | `packages/schema/test/schema.test.ts:49` | `expect(SCHEMA_VERSION).toBe(2)` → `toBe(3)` |
| 6 | `apps/desktop/test/server.test.ts:307` | exportSnapshot `parsed.v` toBe(2) → toBe(3) |
| 7 | `apps/desktop/test/migrations.test.ts:65` | 最后一条迁移名钉 `'v6-fts-defer'` → `'v7-template'`（`MIGRATIONS[5]` 的 v6 名钉不动） |
| 8 | `apps/desktop/test/statements.test.ts:249` | 白名单总数钉 `toBe(59)` → `toBe(64)`（+5 条 template.*） |
| 9 | `apps/desktop/test/statements.test.ts:167/250` | 预算钉 `toBeLessThan(60)` → `toBeLessThan(70)`（两处） |
| 10 | `packages/core/test/convergence.test.ts:22` | `Exclude<OpKind,'crdt_update'>` → `Exclude<OpKind,'crdt_update'\|'template'>`（fuzz kind 集仍锁既有五种，非版本钉、为 OP_KINDS 扩展的机械连带） |

## §3 自跑结果

| 命令 | 结果 |
|---|---|
| `pnpm -C apps/desktop test` | **35 文件 / 368 用例全绿**（含 templates.test.ts 12 用例） |
| `pnpm -r test` | 9+4+27+1+10+9+5+4 包全绿；根项目 84/85 绿 + **perf.test.ts 抖动**（见下） |
| `pnpm -r typecheck` | 全绿 |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 通过 |

**perf 抖动说明（非本单引入）**：`commitOps 200 块 batch P95 ≤16ms` 预算基线本身贴边（T15-01 收口值 12.9ms）。单跑实测 **12.6ms 通过**；`pnpm -r test` 全并行（85 文件抢 CPU）时抖到 18.6–23.3ms 超预算。本单未触碰 commitOps/FTS/物化写路径（新增仅 migration #7 建表 + 语句白名单追加），且 perf-history.jsonl 的运行记录显示同机负载下历史抖动存在。**PM 收口复跑时请单跑 perf 确认**。另：`docs/perf-history.jsonl` 由 perf 用例自动追加运行数据，本次测试运行产生了新行（含失败记录），未手工编辑、保留原样。

## §4 DEVIATION

1. **「复用既有 commitOps」改为 templates.ts 内组装 batch**。红线可改清单不含 `main/commit.ts`，而 commitOps 对 `target.table='template'` 无物化分支（`materializeStatement` 直接 throw E_UNSUPPORTED_TARGET）；为不碰 commit.ts，templates.ts 复用 `ledgerStatement`（入账不变）+ `template.*` 白名单语句直组 batch。单事务/攒段（withSyncHook 装饰 executor）/FTS 尾部同步/defer 开关口径与 commitOps 逐条对齐（createPage 测试锁定 batch 形态的副作用：块落库、FTS 命中新页）。
2. **红线清单外两文件的最小编译修复**：core `OP_KINDS` + `'template'` 使 `main/commit.ts`（materializePageStatement 的 `never` 穷尽分支）与 `packages/editor/src/history.ts`（OpUndoStack.invertOne 同）类型报错。各补一个显式拒绝分支（`throw`，文案照 crdt_update 口径）——不改任何行为（template op 不会以 page 为目标表、不进编辑器撤销栈），但物理上触碰了红线外文件，请 PM 追认。
3. **`targetTableSchema` + `'template'`**：PM §0 只写了「OP_KINDS + 'template'」，但 `opLedger.insert` 参数 schema 用 `targetTableSchema` 校验 `target_table`，不扩则 template op 无法入账；属裁决的隐含必要项，已一并实施。
4. **`template.patch` 服务层未调用**：rename 走 `template.upsert` 整对象写（见 §1.1，保证 ledger 与投影一致）；patch 语句存在且被 SQL roundtrip 测试锁定（COALESCE 局部语义），当前为白名单完备性保留。

## §5 测试覆盖（apps/desktop/test/templates.test.ts，12 用例）

1. saveFromPage 页面 → kind/page、payload.blocks 与页块数一致、id 保留、list 不含 payload；
2. saveFromPage 数据库页 → kind/database、schema/views 等价复制、**无 record 无多余 blocks 键**；
3. createPage 副本语义 → 新页 id、逐块 id 不与源重合、sort_key/type/content 逐一相等、源页与模板前后 diff 为空；
4. createPage 数据库模板 → 新 collection id、schema/views 等价、**新库 0 record**（源库 2 条不动）；
5. 隔离 → FTS 主检索 + LIKE 兜底对模板标题零命中、page.listAll/recent 不含模板；
6. 错误 → E_TEMPLATE_NOT_FOUND（含软删后）/ E_MALFORMED / E_NOT_FOUND / E_NO_WORKSPACE（saveFromPage + createPage）；
7. rename → 标题/图标更新且 payload 同步、icon 缺省保持、rename 推进 updated_at 回列表首位；
8. SQL roundtrip → template.upsert/get/patch（COALESCE 不触 icon）/list（kind 过滤 + 倒序 + 排除软删）/softDelete；
9–10. IPC 边界 → 六通道注册、service=null E_INVARIANT 降级、非法入参 E_MALFORMED；
11–12. toTemplatesError 映射（CommitError→E_MALFORMED、未知→E_INVARIANT）+ ledgerStatement 对非法 template op 的 encodeOp 拒绝。

## §6 PM 复跑（2026-09-19）

```
node apps/desktop/scripts/ensure-abi.mjs node
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 950 无红（desktop 356→368 = +12，逐包对账一致；perf 抖动在 PM 串行跑中未复现）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
重打包 + 真机探针（docs/mockups/probe-t23-templates.mjs，独立夹具根）→ ALL-PASS 10/10
```

**真机逐条（数据面，截图 `docs/mockups/screens-t23/`）**

| 环节 | 结果 | 证据 |
|---|---|---|
| 源页 + 2 块落库 | ✅ | `blocks=2`（经 `blocks:commit`） |
| 另存为模板 | ✅ | `kind=page`，meta **不含 payload**（列表轻量契约成立） |
| **隔离（严格）** | ✅ | 模板**未实例化**时，其标题在页面检索**零命中**（`hits=0`）——证模板从未入索引 |
| 从模板建页 | ✅ | 新页 id ≠ 源页 id（`01M2TQTK…` vs `01M2TQTH…`） |
| 副本 id 全新 | ✅ | 2 个副本块 id 与源块**全不重合** |
| 副本结构一致 | ✅ | 内容 JSON 逐块等价 |
| 源页未被改动 | ✅ | 另存 + 实例化前后源页 diff 为空 |
| 实例化后检索 | ✅ | 命中恰 1 条=新页（继承模板标题），模板本身仍不入检索 |
| 重启后仍在 | ✅ | reload 后 `templates.list` 仍含该模板（账本持久化） |
| pageerror | ✅ | 0 |

**PM 亲修脚本缺陷 3 处（非产品问题）**：①`page.evaluate` 参数对象误用浏览器作用域变量（`a.bid`/`i`）；②`blocks.list` **直接返回数组**（我误取 `.blocks`）；③隔离断言时机错误——**实例化后命中的是新页（标题继承）**，改为「实例化前验零命中」作严格证明 + 实例化后验命中数=1。三次均复跑，最终 ALL-PASS。

**DEVIATIONS 追认**：①`templates.ts` 直组 batch（`commit.ts` 不在本单红线内）✓，`withSyncHook` 攒段语义不变；②**红线外两文件**（`main/commit.ts`、`packages/editor/src/history.ts`）**只加了穷尽 switch 的显式拒绝分支 `case 'template'`（PM 逐行核对 diff：零行为变化）** ✓ 追认；③`targetTableSchema` 加 `'template'` 是 `OP_KINDS` 裁决的隐含必要项 ✓；④`rename` 走整对象 `template.upsert`（ledger 与投影一致），`template.patch` 白名单保留并测锁 ✓。
**数据库模板**由层测覆盖（payload 含 collection.schema/views、不含 record；实例化后新库 0 条 record）——UI 与真机链路待 T23-02 落地后一并复验（届时「转为数据库」→ 另存 → 实例化走真实 UI）。
