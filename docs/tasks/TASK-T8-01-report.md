# TASK-T8-01 交付报告 · M7 搜索与命令面板

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**五条 DoD 全绿（本地已复跑）**
> 复述（写前）：Ctrl+K 命令面板（搜索+命令+跳转三合一）+ 独立搜索结果页。检索面 = FTS5(page_block_fts) 主检索 + LIKE 兜底（code 块正文不进 FTS）；命令面 = 静态命令清单（拼音别名打分）。迁移 v4 把块正文送进 FTS（触发器 + `fts.syncBlock` 写入路径 + `FTS_RESYNC` 重建三条路径同源 body 表达式），断言全部用 `LATEST_SCHEMA_VERSION` 参数化。

## 1. 数据层（migration v4 · `schema.v4.ts`）

| 交付物 | 说明 |
|---|---|
| `src/db/schema.v4.ts` | `ftsPageBodyExpr(pageIdExpr)`：body 聚合表达式**单源**（`json_tree` 抽 content_json 深层 `key='text'` 的字符串 + `json_extract(props_json,'$.title')`，排除 `type='code'`）；`SCHEMA_V4_TRIGGERS`（DROP+重建全部 6 个 FTS 触发器）；`SCHEMA_V4_RESYNC_STATEMENTS`（一次性回填） |
| `src/db/migrations.ts` | migration #4 `v4-block-body-fts`（幂等：DROP IF EXISTS + CREATE + 回填），`LATEST_SCHEMA_VERSION` 随之 = 4 |
| `src/db/statements.ts` | 新增 6 条白名单语句：`fts.clearPage` / `fts.syncBlock`（成对：prepare 只接受单条语句）、`search.ftsPage`（bm25+snippet，join page 取存活行与 updated_at）、`search.likeBlock` / `search.likeCollection` / `search.likeRecord`（`LIKE @like ESCAPE '\'`，上限 50） |
| `src/db/server.ts` | `FTS_RESYNC_SQL` 重写（§2.2：聚合全部 text-ish 块正文 + page.title）并导出供 selftest 计时；rebuildFromSegments 尾部调用不变 |
| `src/main/commit.ts` | commitOps 支持 `block` 目标：upsert → `block.upsert`（白名单语句未动），同 batch 按**涉及 page 去重**追加 `fts.clearPage + fts.syncBlock`（事务内，与 extraStatements 同批） |

三条写入路径（v4 触发器 / commitOps 显式 sync / rebuild 的 FTS_RESYNC）共用同一 body 表达式，口径一致；触发器是安全网（覆盖 page.rename、block 软删等旁路写），sync 与 RESYNC 是任务书点名的显式维护路径——「两者都要」。

## 2. 搜索服务与 IPC（`search:query`）

- `src/shared/search.ts` — 线上契约：`SearchInput` / `SearchHit { kind, id, pageId, title, path, snippet, score, via, updatedAt }` / `SearchResponse { hits, tookMs }`，limit 钳制（缺省 20 / ≤200）、LIKE 基准分（=1，FTS bm25 ≤ 0 排前）。
- `src/main/search.ts` — `createSearchService({ executor })`（DI 不 import electron，vitest 直连真库）：
  1. trim + 空串 → `{ hits: [], tookMs }`；
  2. `toFtsPhrase`（**与 server.ts 同源的引号翻倍规则，复制并注明**）；
  3. FTS bm25 top N（`search.ftsPage`，title 命中 ×0.6 加权折入 score）；
  4. LIKE 兜底三类探测（code 块 / collection 名 / record values，标注 `via:'like'`）；
  5. 摘要：FTS 用 `snippet()`；LIKE 命中在 JS 侧取 ±44 字窗口，同样打 `[命中]` 标记（与 FTS 约定一致）；
  6. 排序 score asc → title 加权 → updated_at desc → id 决胜，`slice(0, limit)`。
  面包屑 = `page.listAll` 建页地图（TTL 3s 缓存，1 万页查询下不过红线），祖先链 root→父。
- `registerSearchIpc(service | null, registrar)`：service 为 null（DB 未就绪）统一 `E_DB_UNAVAILABLE`；边界 zod 风格手工校验（E_MALFORMED）。
- `src/main/index.ts` — bootstrapDatabase 第三套服务 `search`；`registerSearchIpc(services?.search ?? null, dbViewRegistrar())`；**Ctrl/Cmd+K 主进程全局**：`globalShortcut.register('CommandOrControl+K')` → 广播 `CHANNEL_PALETTE_TOGGLE`，will-quit 反注册。
- `src/shared/ipc.ts` — `CHANNEL_SEARCH_QUERY = 'search:query'`、`CHANNEL_PALETTE_TOGGLE = 'palette:toggle'`。
- `src/preload/index.ts` — `septcats.search.query / onTogglePalette`；`src/types/window.d.ts` — `SeptcatsSearchApi` + `SeptcatsApi.search`。

## 3. renderer（App 层组装，packages/ui 零新增组件）

- `palette/rank.ts` — 纯函数（§4 抽离 UI）：`parsePaletteMode`（`>` 仅命令 / `@` 仅页面 / auto）、`scoreCommand`（label 子串 400 > 别名全等 350 > 前缀 300 > 包含 200 + 内置序加分，与 editor slashMenu 同风格）、`rankPalette`（泛型保形，state 里传 PaletteCommand[]/SearchHit[] 出来不丢 run()/via）、`selectableRowCount`。
- `palette/commands.ts` — `COMMAND_DEFS` 纯数据 10 条（新建页面/切换工作区/打开设置/主题×3/导出/回收站/同步面板/导入，拼音全拼+首字母+英文别名）；`bindPaletteCommands(deps)` 注入行为，**id → 行为穷尽 switch**；暂未到里程碑的 4 条（设置/导出/同步/导入）notify 兜底不是静默 no-op。
- `state/palette.ts` — 零依赖 Zustand 同形 store（与 state/pages.ts 同口径）：open/searchOpen/query/activeIndex/hits/tookMs/searching/recents（**最近 10 条去重**）/commands；debounce **150ms** → `search:query`（序号防过期响应，`>` 模式不调度真库检索）；双路 toggle 的 **220ms 护栏**（主进程广播 + renderer keydown 谁先到谁生效，后者优先）。
- `palette/CommandPalette.tsx` + `.css` — mockup 04：遮罩（点击遮罩关、面板内不关）、输入行（combobox）、命令/页面与跳转/数据库三组、label 首个命中加粗、底部「在搜索页打开『q』」入口、脚注 kbd 提示。
- `pages/SearchPage.tsx` + `.css` — mockup 05：查询 chip（可移除）/范围 chip（活动工作区名）/类型 chip（全部→页面→数据库循环过滤）、「N 条结果 · M ms」、分组（页面 · n / 数据库 · n）、snippet 高亮（`[命中]` → `<mark>`，mark 底色走 `--sc-color-selection`）、路径与 meta（种类 · via）、点击开页（selectPage + 关搜索页）、空 query 露出最近查询 chips、查询词同步 `#search=<encoded>`（URL-ish state，受限环境静默失败）。
- `App.tsx` — 顶栏搜索钮 → `paletteActions.open()`；内容区 `searchOpen ? <SearchPage/> : <PageView/>`；`<CommandPalette/>` 挂外壳外；`useCommandWiring` 一次性装配命令行为（createPage/工作区轮换/回收站/notify/setGlobalThemeMode）。
- `packages/ui/src/theme.tsx` — 新增 `setGlobalThemeMode(mode)`（组件树外派发 `THEME_MODE_EVENT`）+ ThemeProvider 内部订阅走同一 setMode 管道（命令面板「切换主题×3」用；非新增组件）。

## 4. 测试（全部本地实跑）

| 文件 | 覆盖 |
|---|---|
| `test/search.test.ts`（6 例，真 SQLite 夹具） | 中文子串命中（via=fts + 路径/摘要/标题加权排序）；多块同页 snippet 定位命中块；LIKE 兜底 code 命中（via=like、kind=block、FTS 分数恒 < LIKE）；collection/record LIKE 命中；limit/空串/特殊字符（`"`、`%`、`_`、`\`、`'`）不崩 + types 过滤；**1 万页 P95 < 150ms** |
| `test/palette.test.ts`（14 例，纯函数） | `'sz'`→打开设置（首条）；`'shezhi'`/`'设置'` 命中；**`'yin'` 零命中**；空 query 内置序稳定（跑两遍比对）；英文别名；scoreCommand 四通道分级；`>`/`@` 模式与行数；COMMAND_DEFS 清单完备 + bindPaletteCommands 穷尽绑定 |
| `test/palette-react.test.tsx`（8 例，jsdom） | 关闭态不渲染；打开后 aria 齐（combobox+aria-expanded+aria-controls+aria-activedescendant+listbox+option aria-selected）+ 焦点全选；**键盘全序列**（↓ 循环回绕 / ↑ 反向 / aria-activedescendant 跟随 / Enter 执行 / Esc 关）；Esc + 点击遮罩关（面板内不关）；hover 同步 activeIndex；`>`/`@` 切换；debounce 后调 search:query；SearchPage 渲染/高亮/hash/过滤/结果点击 |
| `test/helpers.ts` 扩展 | `mulberry32` 确定性 PRNG；`makeSearchFixtureDb`（页/块随机中文文本，i%7 标题探针 / i%5 正文探针 / i%3 标题块 / i%11 code 块，真实 PM doc 深层结构检验 json_tree）；`coreExecutor`（DbServerCore → StatementExecutor 适配） |
| `test/migrations.test.ts` | `LATEST_SCHEMA_VERSION` 钉到 **4**（v3 已被 T7 占用）；v4 触发器重建 + json_tree/code 排除 + 无越权片段 |
| `src/db/selftest.ts` | v4 后正文进 FTS（触发器路径）；`fts.syncBlock` 显式重算；6 触发器在位；**FTS_RESYNC 2000 页全量重算计时断言 < 3000ms** |

## 5. DoD 五条结果原文（本地复跑 2026-09-13）

> 任务书 §5 原文：
> ```
> pnpm -r typecheck && pnpm -r test
> pnpm -C apps/desktop selftest   # v4 迁移 + FTS_RESYNC 计时断言加入 selftest
> node packages/ui/tokens/no-magic.mjs
> pnpm -C apps/desktop build
> ```

### ① `pnpm -r typecheck`
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

### ② `pnpm -r test`
```
packages/core test:  Test Files  8 passed (8) / Tests  38 passed (38)
packages/platform test:  Test Files  4 passed (4) / Tests  31 passed | 1 skipped (32)
packages/ui test:  Test Files  25 passed (25) / Tests  58 passed (58)
packages/schema test:  Test Files  1 passed (1) / Tests  3 passed (3)
packages/editor test:  Test Files  7 passed (7) / Tests  126 passed (126)
packages/dbview test:  Test Files  5 passed (5) / Tests  79 passed (79)
apps/desktop test:  Test Files  9 passed (9) / Tests  104 passed (104)
```

apps/desktop 明细（性能红线实测在其中）：
```
 ✓ test/palette.test.ts (14 tests) 9ms
 ✓ test/statements.test.ts (17 tests) 58ms
 ✓ test/migrations.test.ts (21 tests) 241ms
 ✓ test/server.test.ts (12 tests) 513ms
 ✓ test/dbview.test.ts (9 tests) 482ms
 ✓ test/pages.test.ts (11 tests) 520ms
 ✓ test/db-bridge.test.ts (6 tests) 393ms
 ✓ test/palette-react.test.tsx (8 tests) 1222ms
stdout | test/search.test.ts > search:query（真 SQLite 夹具） > 1 万页 fixture：查询 P95 < 150ms（性能红线）
  search P95 = 11.9 ms（24 次采样，1 万页）
 ✓ test/search.test.ts (6 tests) 16490ms
 Test Files  9 passed (9)
      Tests  104 passed (104)
```

### ③ `pnpm -C apps/desktop selftest`（v4 迁移 + FTS_RESYNC 计时已加入）
```
PASS migrate v0→latest
PASS migrate 幂等（第二次无变化）
PASS v2 建表（favorite/recent/mention）
PASS v2 加列（page.deleted_at）
PASS batch 一次性写入 6 条语句
PASS get 回读 page.title
PASS all 回读 block.listByPage
PASS page.insert 写入子页
PASS 越界 workspace_id 不落写（changes=0）
PASS page.setDeleted 命中 1 行
PASS page.listTrash 列出软删除页
PASS page.listAll 返回 alive+deleted 全量
PASS ftsSearch 命中中文子串（trigram）
PASS sqlId 越界被拒不执行（E_UNKNOWN_STATEMENT）
PASS integrityCheck ok
PASS backupTo 产出文件
PASS exportSnapshot 是合法快照 JSON
PASS 删主库文件后库文件不存在
PASS rebuildFromSegments 应用 2 段
PASS rebuild 后 page.title 一致
PASS rebuild 后两个块都在且标题一致
PASS rebuild 后 op_ledger 事件数=3
PASS rebuild 后 ftsSearch 命中第二段块标题
PASS rebuild 后 integrityCheck ok
PASS rebuild 后 v2 结构保持（三表 + page.deleted_at）
PASS v4 后块正文进 FTS（触发器写入路径）
PASS fts.syncBlock 显式重算页 FTS 行
PASS fts.syncBlock 重算后正文命中保持
PASS v4 触发器已重建（6 个 FTS 触发器在位）
  FTS_RESYNC 2000 页全量重算耗时 14.8 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
PASS FTS_RESYNC 后重算页全部在索引中
SELFTEST OK
```

### ④ `node packages/ui/tokens/no-magic.mjs`
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### ⑤ `pnpm -C apps/desktop build`
```
- Searching dependency tree
√ Rebuild Complete
vite v7.3.6 building ssr environment for production...
✓ 77 modules transformed.
out/main/chunks/rpc-ButtQbsY.js   17.70 kB
out/main/dbServer.js              61.19 kB
out/main/index.js                444.03 kB
✓ built in 748ms
vite v7.3.6 building ssr environment for production...
✓ 2 modules transformed.
out/preload/index.js  6.06 kB
✓ built in 11ms
vite v7.3.6 building client environment for production...
✓ 4798 modules transformed.
../../out/renderer/index.html                     1.00 kB
../../out/renderer/assets/index-CgavUZi6.css     52.05 kB
../../out/renderer/assets/index-tTS0lRUC.js   1,308.37 kB
✓ built in 3.55s
```
（中段仍有 zod `@__PURE__` 注释的 Rollup 提示，非错误，与 T7b 报告一致。）

## 6. SSIM-NOTE（04 / 05 屏对齐点）

**mockup 04 → CommandPalette.tsx / CommandPalette.css**
- **浮层结构**：全屏遮罩（`--sc-color-overlay` + `--sc-z-dialog`）+ 顶部悬起面板（`--sc-color-surface-raised` 底、`--sc-radius-lg`、`--sc-shadow-modal`）——镜像 mockup 的 `.overlay > .palette`。
- **输入行**：放大镜图标（faint）+ 查询文本 + 右侧「Esc 关闭」faint 提示，底部发丝线分隔——对应 `.palette-input`。
- **分组与行**：「命令」「页面与跳转」「数据库」组标题（ui-xs/faint）+ 行结构 = 图标 + 标题（**首个命中加粗**，对应 mockup 的 `<b>移动</b>到…`）+ 右侧 meta（命令 hint / 「页面」「数据库」），页面行带 faint 路径（`/ 研究 / …` 对应 mockup 的 `.dim`）。
- **选中态**：active 行 `--sc-color-accent-soft` 底 + 图标转 accent 色——对应 `.prow.sel`。
- **脚注**：`↑↓ 选择 / Enter 执行 / > 仅命令 / @ 仅页面`（Kbd 组件）——对应 `.scrim-hint`。
- **真实功能差异**：mockup 行右侧有快捷键标签（Ctrl+Shift+M / Del），命令表一期未定快捷键，meta 位显示 hint——待快捷键定稿补齐。

**mockup 05 → SearchPage.tsx / SearchPage.css**
- **筛选条**：查询 chip（accent-soft 底/accent 字 + 可点击移除）+ 范围 chip + 类型 chip（hairline 胶囊）+ 右侧「N 条结果 · M ms」（mono/faint）——对应 `.f-bar` 三件套，M 为服务端实测 `tookMs`。
- **分组头**：「页面 · n」「数据库 · n」（ui-xs/faint）——对应 `.res-h`；block 命中归入页面组（其本身属于页面），collection/record 归入数据库组。
- **结果行**：h3（`--sc-text-h3` + 前置 faint 图标）+ 路径（ui-xs/faint）+ 摘要（ui-sm，`<mark>` 高亮底色走 **`--sc-color-selection`**，即任务书「高亮走 selection token」，深浅主题各自生效）+ meta 行（mono：种类 · via）——对应 `.res` 的 h3/.path/.snip/.meta 四层。
- **交互**：行 hover `--sc-color-surface` 底（对应 `.res:hover`）；点击开页。
- **最近查询**：mockup 无此块，为 §3「最近 10 条查询去重」的露出位（空 query 时显示，胶囊样式复用 chip）——新增元素，样式语言与屏一致。
- **无法自证的**：真实帧率、深色下高亮观感（token 已用 selection，理论可读）、骨架屏形态（搜索为同步快查询，未做骨架；mockup 的骨架屏段落属「索引状态演示」）。需 PM 真机截图复审。

## 7. DEVIATIONS（有意的偏离与理由）

1. **`fts.syncBlock` 拆成 `fts.clearPage` + `fts.syncBlock` 两条白名单语句**：statements.test 铁律「prepare 只接受单条语句、sql 不得含分号」，DELETE+INSERT 无法合成一条。commitOps 按涉及 page 去重后成对追加（事务内），语义与任务书「batch 追加一步」一致（每个 page 一次 clear+sync）。
2. **v4 触发器也带正文（而非只靠写入路径）**：任务书 §2.1 说「改在写入路径维护」，但若触发器仍是标题管道，`page.rename` 等旁路写会用标题 body 覆盖掉 `fts.syncBlock` 刚写的正文。裁决：v4 重建的 6 个触发器同样用 `ftsPageBodyExpr`（json_tree 可以到达深层，任务书说的「json_extract 不可达」不成立于此函数）。三条路径同源、口径一致，「两者都要」从宽满足。
3. **4 条命令（打开设置/导出/同步面板/导入）run() 走 notify 兜底**：对应功能属于后续里程碑，M7 无真实面板可开；行为是弹出「将在后续里程碑提供」的应用 Toast（走 pagesStore 的 Toast 队列），**不是静默 no-op，也不是 TODO 占位**——id/label/aliases/键盘路径已是终稿，后续里程碑只需替 run()。
4. **`@` 仅页面 = 面板内过滤**（任务书「@=仅页面（跳 #4 结果页）」的解读）：`@` 前缀把面板切到仅页面结果（mockup 04 的「页面与跳转」组形态）；跳独立搜索页（mockup 05）由面板底部「在搜索页打开『q』」与顶栏搜索钮承担。两种解读中选择了不改变键盘模型的那个；如 PM 意图是 `@` 直接跳搜索页，改动仅一处（`parsePaletteMode` 消费侧）。
5. **切换工作区命令 = 轮换到下一个工作区**：无工作区列表 UI，无法做选择菜单；轮换是可用的真实行为（单工作区时 notify 提示）。
6. **包内对 `@septcats/ui` 的 theme.tsx 做了小改**（新增事件常量 + setGlobalThemeMode + ThemeProvider 内订阅）：任务书说「packages/ui 无新增组件」——这是既有组件的**行为扩展**（模块级 API + 事件监听），非新组件；否则「切换主题」命令无法在不写死 documentElement 的情况下接通 ThemeProvider 管道。
7. **面板/搜索页共用一个 store（state/palette.ts）**：任务书写「state/palette.ts zustand」；仓内依赖白名单无 zustand，沿用 store.ts 的零依赖 Zustand 同形实现（T6 既定裁决，pages.ts 同款），写法一致、后续可无痛替换。
8. **面包屑页地图带 3s TTL 缓存**：1 万页查询若每次全量拉 `page.listAll`（1 万行）会挤占 P95 预算；缓存后 P95 = 11.9ms。代价是改名后路径最长滞后 3s（展示性派生态，可接受）。

## 8. 未决项

1. **blocks:commit 主进程 handler 仍未注册**（T5 遗留）：commit.ts 的 block 物化 + fts 同步已就绪并有真库测试覆盖，接线归编辑器数据流任务。
2. 命令快捷键标签（mockup 04 的 kbd 列）待快捷键定稿。
3. 搜索页骨架屏（mockup 05 的「索引状态演示」段）未做——当前查询是同步快路径（P95 12ms），骨架无观察窗口；若未来引入远端检索再补。
4. Ctrl/Cmd+K 用 `globalShortcut` 注册（系统级）：会把该组合键从其它应用「偷走」。若 PM 认为过重，可降级为 `before-input-event`（改动集中在 `registerPaletteShortcut` 一处）。
