# TASK-T8-01 · M7 搜索与命令面板

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T6+T7 已合入。必读：docs/mockups/04-command-palette.html、05-search-results.html；apps/desktop/src/db（FTS_SEARCH_SQL 与 rebuildFromSegments 已有）；packages/editor/src/rules/slashMenu.ts（拼音表可抽出复用）。
> 纪律：只 Write/Edit；不跑终端命令、不碰 git；禁占位符。

## 0. 一句话
Ctrl+K 命令面板（搜索+命令+跳转三合一）与独立搜索结果页。检索面 = FTS5(page_block_fts) + LIKE 兜底（code 块正文不进 FTS，见 §2.3）；命令面 = 编辑器动作 + 导航 + 设置开关。

## 1. 主进程 search.ts（apps/desktop/src/main/search.ts + IPC `search:query`）
```
input: { workspaceId, query, types?: ('page'|'block'|'collection'|'record')[], limit(≤200) }
steps: 1) trim+空串→[]；2) toFtsPhrase 转义（复用 server.ts 的引号规则，抽到 shared 或复制并注明同源）；
       3) FTS bm25 查询取 top N；4) 对 code/collection 命中不足时 LIKE 补查（props_json/content LIKE '%q%'，上限 50，标注 source）；
       5) snippet 高亮定位；6) 返回 {kind, id, pageId, title, path(面包屑), snippet, score}
output 排序：score asc → title 命中加权(×0.6) → updated_at desc。
```
性能红线：**1 万页 fixture 查询 P95 < 150ms**（vitest 计时，SQLite 真库内存表）。fixture 生成器放 test/helpers（页/块随机中文文本，mulberry32 确定性）。

## 2. 索引补全（db 层小步，migration v3）
2.1 block FTS 目前是「标题管道」——v3 扩触发器：**text 类块的 content JSON 抽纯文本**进 `page_block_fts.body`（json_extract 不可达深层 text，**改在写入路径维护**：`block.upsert` 白名单语句不动，新增 `fts.syncBlock` 语句由 commitOps 路径显式调用（batch 追加一步，事务内）；rebuildFromSegments 尾部调 FTS_RESYNC 全量重算 —— 两者都要，别只做一半）。
2.2 FTS_RESYNC_SQL 重写：聚合该页全部 text-ish 块（props_json->>'$.*' 不可靠，用 json_each/json_tree 抽 'text' 键）+ page.title。性能：2000 页全量重算 < 3s（selftest 计时）。
2.3 code 块正文：不进 FTS（纯文本单列过大），LIKE 兜底覆盖（§1 步骤 4），`search:query` 结果标注 `via:'fts'|'like'`。

## 3. renderer（packages/ui 无新增组件；App 层组装）
- `CommandPalette.tsx`（apps/desktop/src/renderer/src/palette/）：
  - 打开：Ctrl/Cmd+K（主进程全局 + renderer 内监听双路，后者优先）；esc/点击遮罩关。
  - 输入态：即时搜索（debounce 150ms → search:query）+ 命令过滤（命令表从 `commands.ts` 静态清单：新建页面/切换工作区/打开设置/切换主题×3/导出/回收站/同步面板/导入…，每项 {id,label,aliases(拼音),run()}）；`>` 前缀=仅命令，`@`=仅页面（跳 #4 结果页）。
  - 结果分组：命令 / 页面 / 数据库；选中行走键盘（↑↓ 循环、Enter 执行、hover 同步 activeIndex）。
  - **无障碍**：role=combobox+listbox、aria-activedescendant、aria-expanded；焦点进面板自动全选文本。
- 搜索结果页 `pages/SearchPage.tsx`：对齐 mockup 05（filter chips：范围/类型；分组结果+snippet 高亮+路径；点击开页；查询词同步 URL-ish state）。
- 顶栏搜索钮接同一状态（state/palette.ts zustand，含最近 10 条查询去重）。

## 4. 测试底线
- search.test.ts（node，真 SQLite fixture）：中文子串命中、多块同页 snippet 取最优、LIKE 兜底 code 命中、limit/空串/特殊字符（引号/通配符）不崩、P95 性能断言。
- palette 逻辑单测（纯函数 `rank(query, cmds+hits)`：拼音/别名/模糊打分，抽离 UI）：'sz'→设置、'yin'→打印？无此命令不命中、空 query 默认命令序稳定。
- react.test.tsx：键盘导航全序列、aria 属性齐、`>`/`@` 模式切换、点击遮罩关。

## 5. DoD
```
pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest   # v3 迁移 + FTS_RESYNC 计时断言加入 selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告 SSIM-NOTE 对齐 04/05。
