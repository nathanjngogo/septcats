# TASK-T66-01 · P1：个人工作台首页（老板 09-22 选方案A+加「库」）

> 老板原话：「个人工作台选 A，但要加一个库，这样做的好处是能实现现有模式和个人工作台的切换。」
> 解读（PM 定稿）：A=内建 home 首页仪表盘（卡片流）；「加一个库」=工作台常驻**数据库卡**（全部库页列表+行数+打开+新建）；「现有模式↔工作台切换」=home 是一等可导航面，顶栏/命令面板一键进，Esc/回主页可逆切换，不动现有页面编辑形态。

## 0. 现状底座（PM 侦察，勿重复调查）

- 路由模型：无 router；`tabs`（state/tabs.ts）+ selectPage 开页签。内建面先例：**说明书页 MANUAL_DEF**（palette/commands.ts:162）与布局编辑器 `openLayoutEditor`（App.tsx:50,88 状态驱动全屏覆盖/路由位）。**home 走同款：App 级 `view: 'pages'|'home'` 状态 + 命令/按钮切换，不造 router。**
- 命令注册范式：`palette/commands.ts` `COMMAND_DEFS` / `*_DEF` 常量（含 LAYOUT_PRESET_DEF 等）。
- 数据现成：收藏 `favoriteIds` / 最近 `recentIds`（state/pages.ts:49-50 及 store actions）；页面树 `nodes`（pageTypeOf 分型）；**库页=page_type='database' 存活页**（main/pages.ts:207 dbPageIds 判定；renderer 有 byId）；dbview 集合行数以 IPC `db.` 通道可查（列 count 若无现成 IPC 就取 `db.list`/collection meta 类通道，找不到就在 home 卡里**退化为不显示行数**并在报告注明，不自开新 main IPC 面——那是 T64 不碰但你也别扩的 IPC 层，除非现成通道真的缺，缺了就加在 main/dbview.ts 对应 handler 处，属可接受小扩）。
- 模板：state/templates.ts 有内建模板机制（todo 待办卡用**内建模板页**方案：首次进入工作台自动创建/发现 `pageType='page'` 标题=「待办」的内建模板页（用 templates 的种子清单挂 `septcats.builtin=todo` 标记），点击卡片打开该页编辑——**不造新表格引擎，不新写任务模型**。若模板机制接入成本高，退路：todo 卡直接内嵌一个最小本地列表（存 localStorage `septcats.workbenchTodos`，行=勾选框+文本+删除，像素风），二选一取改动小者，报告说明选择理由（DEVIATION 允许）。
- 顶栏：App.tsx 按钮区（GearSix/LayoutPicker 入口像素钮先例）；i18n `i18n/{zh-CN,en-US}.ts`。
- 像素/灰阶纪律同全站：token var(--sc-*)、黑框线、思源黑体、无字面 hex/px、语义色不动。

## 1. 口径（PM 定稿）

1. **home 视图**：App 级状态 `workbenchOpen: boolean`（命名可用 `view==='home'`）；打开=全窗口覆盖式仪表盘（编辑区被替换，侧栏/顶栏/标签条**保持可见可点**——点任意页面行/页签即回 pages 视图并正常开页）。⚠ 例外：若「覆盖编辑区」实现与现有覆盖层范式冲突明显，可退为**内建只读页签**（与说明书 ManualPage 同款，tabs 里一枚固定「工作台」页签，关闭=回 pages）——两者取改动小、语义稳者，DEVIATION 说明。持久化 `septcats.workbenchOpen`，启动时若在=先落 pages 视图并 toast 提示可关（防呆：home 不是死路）。
2. **入口三件套**：顶栏像素「房子」钮（glyph 不够就在 pixelIcons 新增一枚 16×16 房子，风格对齐 28 枚族）；命令面板 `go home` / `工作台 workbench`；快捷键 `Alt+H`（走现有 keybind 注册处，若无统一注册面就挂 window keydown handler 于 App，注明）。
3. **卡片流（自上而下）**：
   - **欢迎条**：问候语+今日日期（i18n，本地化格式，零外呼）。
   - **快捷行**：新建页 / 新建库（=现有建库入口动作；若建库只在页内块入口，则「新建库」=新建页并自动插一个 database 块，走编辑器现成命令；实现取最稳，报告说明）/ 每日笔记（模板或新建页标题=`YYYY-MM-DD`，与现有模板机制对齐）。
   - **待办卡**（见 §0 退路二选一）。
   - **数据库卡（=老板点名要加「一个库」）**：列出全部存活库页（图标+标题+行数或记录数+父路径），行点击=回 pages 并打开该库页；空态文案+「新建库」按钮；列表上限 12 行+「查看全部」→ 打开侧栏（若侧栏有库筛选则选中，否则进 pages 视图即可）。
   - **最近卡**：recentIds 前 8（标题+相对时间）。
   - **收藏卡**：favoriteIds 全量网格（封面缩略可省，标题行即可）。
4. **卡片配置**：每卡右上角 ⋯：显示/隐藏、上移/下移；配置存 localStorage `septcats.workbench.cards`（id 序+hidden 集）；「恢复默认」项。
5. **每卡像素风**：黑框线卡壳（借 T62 token），hover 抬升 `--sc-pixel-out` 语法一致。

## 2. 交付物
1. 代码：WorkbenchPage.tsx + .css（新目录 `apps/desktop/src/renderer/src/workbench/`）、App 视图态与入口钮、commands 注册、i18n 双份、（若选内建模板页路线）templates 种子小扩。
2. 单测：卡序/显隐配置读写兜底（野 JSON→默认）；库列表过滤存活 database 页且 wiki/回收站不混入；最近/收藏空态渲染；视图切换 reducer 行为；（若加 DB IPC）main 侧 count 查询单测。钉既有口径受影响的用例按新语义改写并列 DEVIATION。
3. 真机探针 `docs/mockups/cdp-e2e-t66-01.mjs`（断言前先一次性脚本拿真值；窗口 resize 若需走 main inspector setBounds+回读；Electron 前 ensure-abi electron）：进工作台（钮/命令两路）→ 卡片渲染计数 → 建一个库+页 → 数据库卡出现该库与行数 → 点行回 pages 且页签打开 → 隐藏/排序卡 → 优雅退出重启还原（pages 视图+卡配置）→ 截图 ≥8 张存 `screens-t66/`。⚠ 本 worktree 内**不启动 Electron**（并行环境），探针写好由 PM 合并后跑。
4. 报告 `docs/tasks/TASK-T66-01-report.md` 分节+原始数值+DEVIATION+「PM 复跑节（PM 补）」留空。

## 3. 红线
- **并行纪律**：另一子 Agent 正在同仓 `theme-gallery` 分支做 T65；**你只许动**：新目录 workbench/**、App.tsx（视图态/入口钮/卡配置接线处最小 diff）、commands.ts（只追加注册不重排）、i18n 双文件（只追加键）、（可选）templates 种子、新测试/探针/报告文件。pixelIcons 若两单都要加 glyph：**T66 的房子 glyph 不要改 pixelIcons.tsx 本体**——先在 workbench 目录内自造一个局部 PixelHomeGlyph 组件（拷既有 glyph 画法），合并后由 PM 统一收编进族（DEVIATION 注明）。
- SidebarTree/pages.ts 状态/selectPage/tabs 语义零改动（T64 施工中）；layoutState 类型零改动；packages/** 零改动。
- home 不得成为死角：任何时刻 Esc/点页面/点页签可回 pages；侧栏折叠态照常可用。

## 4. DoD
`pnpm -r test` 无红、typecheck 0、`pnpm -C apps/desktop build` 过（先 ensure-abi node）；报告填全；**本 worktree 分支上 commit（前缀 `feat(t66):`），不合 main，不 push**。
