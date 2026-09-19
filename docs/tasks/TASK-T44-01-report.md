# TASK-T44-01 交付报告 · R8 双链（Obsidian 式 `[[ ]]` + 反向链接）

> 实现人：CodeBuddy ｜ 基线：git HEAD 3e5e6c7（rc.20，工作树干净，PM 实测 1200 全绿）
> 结论先行：**六条硬要求全部完成**，全仓自跑全绿（typecheck 9/9、token 双门禁 ✓、build ✓），无 TODO/占位符、零新增依赖、未碰 git。

## §0 侦察结论（承载核实，本单第一交付物）

1. **`packages/importer` 未解析 `[[页名]]`**：`grep -rn '\[\[' packages/importer/src` 零命中（唯一相关是 test-real 的 Markdown 图片正则 `!\[[^\]]*\]\(...\)`）。无可复用解析器 → 本单在 `packages/editor/src/rules/wikilink.ts` 定义唯一解析器（`[[页名]]` / `[[页名|别名]]`），editor/main 两侧共用（main 侧经 `extractWikilinksFromContent`）。
2. **`backlink|page_link|wikilink` 八文件命中全部不是「页面互链」**：
   - `backlinks_json`（schema.v2/statements/commit/dbview/view.ts）= **relation 反链索引**（record 关联的设备本地派生态，T7-01），不是页面互链；
   - `page_link`（schema/index.ts:33）= 块类型白名单里的值类型，editor 无 PM 投影节点（blocks.test.ts:115：经 `_unsupported/_raw` 原样恢复），也未接任何跳转。
   - **结论：无可复用的互链承载，须新增**；但**派生态范式完整复用**：`backlinks_json`（设备本地、不进 Op payload）+ FTS（提交路径按涉及页增量同步 + 触发器/重建兜底）两条既有范式是本设计的直接依据。
3. **改名现状**：page rename 走 `page` patch op（pages.ts:509-525 → `page.rename` 物化），**不改写任何块内容引用**。因此链接键必须用稳定 id（本实现：wikilink 节点 `attrs.target` = 页 id；title 只是展示文本，改名后回链面板的源页标题取 page 行当前值，即时可读）。
4. **inline 承载**：editor 是 @tiptap/core 显式装配（无 starter-kit），T36 教训成立（`docs/tasks/TASK-T36-01-report.md:41,80,110`：命令式 inline style 被协作回声重渲染抹掉，补偿必须走 PM 装饰）。本实现走**真实 inline atom 节点**（`sc-wikilink` class + token 样式，零手写 style），attrs 全量进块 content JSON payload，y-prosemirror 按 XmlElement+attrs 同步，模型层（model.ts）内联透传零改动。

**承载一句话**：回链索引是**设备本地派生表**（`page_link_index`，migration #9 纯新增）——账本只存块 content 里的 wikilink 节点（真相层），派生表按提交增量维护 + 启动全量重建，一致性判据「增量 == 全量重建」有测试断言；不新建任何 Op、不新建真相层结构。

## §1 交付对照（硬要求六条）

| # | 要求 | 结论 | 证据 |
|---|---|---|---|
| 1 | `[[` 触发补全（键盘↑↓+Enter、鼠标、Esc、按标题过滤） | ✅ | `rules/wikilink.ts` 触发状态机插件（IME 组合期零触发）+ 复用 `SlashMenu` 浮层（capture 键盘/视口夹紧）；候选=当前工作区页面树，`filterWikilinkCandidates` 纯函数过滤 |
| 2 | 渲染为链接样式（非纯文本）、同段多链接互不串扰 | ✅ | inline atom 节点 `WikilinkNode`；已解析 `sc-wikilink`（accent），未解析 `sc-wikilink--unresolved`（ink-faint+虚线）；测试断言同段 2 节点各自 class/textContent |
| 3 | 点击跳转；目标不存在行为明确 | ✅ | resolved → `openInTab`（同页不重复开，T37 统一入口）；未解析 → **新建该标题页并跳转 + 回填 target**（Obsidian 式，绝不静默）；点指向已删页 id 的链接同样走新建路径 |
| 4 | 回链面板（来源页标题+上下文片段+可跳转，实时更新） | ✅ | `BacklinksPanel.tsx`（标题行下独立区块）；`links:backlinks` 查询（JOIN 源页 alive）；点击 `requestBlockJump` 跳源块（同页立即跳/跨页 pendingJump+页签，复用 T38 桥）；编辑触发 revision 防抖重拉 |
| 5 | 改名不破链（稳定 id，非标题键） | ✅ | `attrs.target` = 页 id；测试「改名后索引行不变、面板回当前标题」 |
| 6 | 推导一致性断言（删目标/改名/转类型/移出后索引与新事实一致，含能复现不一致的测试） | ✅ | `links.test.ts`：随机插删 10 轮后 `增量快照 == 全量重建快照`（完全相等断言）；**可复现不一致证据线** = 手工插入脏行（模拟崩溃半写）→ 重建收敛；删除源页后重建结果与增量语义一致且回链查询按 alive 过滤；block patch（无 page_id）经块反查正确增删 |

任务书 §1 附加项：`]]` 语法直填与 `|` 别名收口（输入规则插件）、派生索引零新增 op（§1.6）、重建命令（`links:rebuild` 通道 + 启动自动重建，§1.6）、改名自动批量改写=第二批未做（§1.7 允许）、未链接提及=第二批未做（§1.5 允许）、全本地零外呼（§1.8，派生表与查询全走本地白名单语句）。

## §2 自跑原始数值

1. `pnpm -C apps/desktop test`：`Test Files 54 passed (54) / Tests 588 passed (588)`（含新增 `test/links.test.ts` 7 用例、`test/backlinks-panel.test.tsx` 3 用例）。
2. `pnpm -r test`（逐包汇总）：core 51 ✅ / platform 41 passed + 1 skipped ✅ / ui 79 ✅ / schema 3 ✅ / sync 109 ✅ / editor **197** ✅（新增 `test/wikilink.test.ts` 15 用例）/ dbview 98 ✅ / importer 59 ✅ / desktop 588 ✅。
3. `pnpm -r typecheck`：9/9 Done（editor、apps/desktop 双 tsconfig 均 Done）。
4. `node packages/ui/tokens/no-magic.mjs`：`✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px`。
5. `node packages/ui/tokens/build-tokens.mjs --check`：`✓ token 产物与 DESIGN.md 一致`。
6. `pnpm -C apps/desktop build`：`✓ built in 3.81s`（renderer 1,935.97 kB / css 106.32 kB，Rollup 注释告警为 zod 既有噪音，与本单无关）。

环境备注：本机 better-sqlite3 为 Electron ABI（NODE_MODULE_VERSION 136），普通 Node 下 DB 系套件按 helpers.ts 设计整组跳过；`links.test.ts`（真库路径）已用 `ELECTRON_RUN_AS_NODE=1 electron vitest run test/links.test.ts` 实跑 **7/7 全绿**（T11-01 既有口径）。

## §3 DEVIATION（逐条，待 PM 追认）

1. `test/migrations.test.ts:65` 最新迁移名钉 `v8-page-type` → **改为 `v9-page-link-index`**（版本顺延惯例，T42-01 同款操作）。
2. `test/wiki-page.test.ts:155,313` `migrated.to` 钉 8 → **改为 9**（migration #9 追加后迁移目标顺延；「v7 夹具旧库 → 迁移到最新版」语义不变）。
3. `test/statements.test.ts:167,249-250` SQL 白名单预算钉 66 / <70 → **改为 72 / <75**（新增 `link.*`/`links.*` 六条白名单语句；标题注释同步）。
4. `packages/editor/src/react/SlashMenu.tsx` **既有组件微调**：`items` 类型放宽为 `Pick<SlashItem,'id'|'label'|'hint'>` + 两处 `onSelect(item as SlashItem)` cast——双链补全复用浮层组件，候选是页面而非块型；既有 slash 用法传 SlashItem[] 天然可赋值，**行为零变化**。
5. `main/blocks.ts` `commit()` 在 commitOps 成功后追加**双链派生索引同步后置钩子**（收集涉及页 → 清页重插，失败只记录不回滚，启动重建兜底）。红线口径「main/** 只增派生表与查询通道」——本钩子即派生表的写路径；`commit.ts` 本体**零改动**（FTS 增量同步留在其内，双链不走它以避免改动既有 FTS 语义）。
6. `main/index.ts` bootstrapDatabase 增加启动时全量重建（裸 handle，与 search 同款：派生写不进攒段器）；`DatabaseServices` 增 `links` 服务（六套→七套）。
7. 回链面板只挂编辑器承载页（普通页）：wiki 落地页 / 数据库页走 `WikiLanding`/`DbPage` 分派，无该区块（复用 T42-01 `rendersEditor` 门控，协作层门控不受影响）。
8. 「移出工作区」在代码库无对应 op（Q4 单活动工作区分片）：一致性按「page upsert/move/reorder 不触碰块内容 → 索引无需重算」处理；workspace_id 冗余自源块行，查询按源页分片过滤。

## §4 未尽 / 风险

1. **第二批已登记未做**：改名自动批量改写块内 `[[旧标题]]` 文本（§1.7）、未链接提及（§1.5）。
2. 同步/协作远端路径的实时性边界：双链增量同步挂在 `blocks:commit`（本机编辑路径）；远端 op（sync 段合并 / collab 下行）若改块内容，其派生行在本机**下一次编辑同页或重启**时收敛（启动重建兜底，`增量==全量` 判据不受影响）——与 FTS 同款局限，但 FTS 有触发器兜底而双链暂无，后续可考虑触发器/uk 场景补齐。
3. 未解析链接点击 → 新建页后，节点 target 回填走本机 PM 事务（正常进 EditSession commit）；若新建+改名 IPC 失败已 catch 并 console.error（不吞但也不重试）。
4. 真机验收面（`[[` 补全截图、回链面板截图与条数、双主题×四态截图、CDP 探针）留 PM。

## §PM 真机复跑

> PM：Hermes ｜ 日期：2026-09-20 ｜ 产物：**rc.21**（`0.3.0-rc.21`）
> 口径：PM **自写独立探针** `docs/mockups/cdp-e2e-t44-01-pm.mjs`（3 个 boot、18 条断言）
> ＋ `docs/mockups/cdp-e2e-t44-01-olddb.mjs`（旧库兼容）。
> **结果：17 PASS / 2 FAIL；console 错...[truncated]
