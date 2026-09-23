# TASK-T72-01 · 工作台模板市场（PRD-R20 条目③+④的壳）

> 基线 = main HEAD `4edf260`（T71 收口后）。依据：`docs/PRD-R20-库与模板市场.md` §T72-01。
> 分工：CB 写码（只 Write/Edit 落盘，**不碰 git**、不 merge/push、不跑全仓打包）；PM 复跑门禁+真机验收+提交。
> 工作目录：`.worktrees/t72-market`（分支 `feat/t72-template-market`）。

## 0. 目标
把现有「工作台」入口升级为**工作台模板市场**：一处能拿模板、能装卡片、能存自己模板的全屏视图。

## 1. 范围（五条，按依赖序实现）
### 范围1 · 入口改造（PRD ③）
- 顶栏房子钮改「工作台模板市场」：`data-testid` 新 `workbench-market-open`（**保留 `workbench-open` 作为「我的工作台」行内钮**，命令面板同步两条命令：开市场 / 开我的工作台）；glyph 重绘（房子→店铺/货架像素图，局部 glyph 文件，**禁改 pixelIcons 主文件**）；`Alt+H` 语义改为开市场，i18n zh/en 齐平。
### 范围2 · 市场页壳 + 两 Tab（PRD ③④）
- 全屏视图（学 `LayoutEditorPage` 壳：`role="region"` + 顶栏标题/关闭钮 `wb-market-close`；Esc 关）。
- 两 Tab：**模板** `wb-market-tab-templates` / **卡片** `wb-market-tab-cards`。
- 模板 Tab：三段分区「内置模板 / 我的模板 / (空态)」；模板卡 `wb-market-template-<id>` 带像素预览缩略 + 「应用于当前库」`wb-market-template-apply-<id>`（**先弹确认框 `wb-apply-confirm`，确认前把当前布局一键备份**到 `septcats.wbcard.layoutBackup`，并提供「还原备份」入口 `wb-restore-layout`）。
- 卡片 Tab：列出注册表全部卡（含未启用），行 `wb-market-card-<id>` + 状态位 `wb-market-card-status-<id>`（文本：`启用中`/`未启用`）+ 开关 `wb-market-card-toggle-<id>`。开关语义 = 直接调用既有 `workbenchActions.setCardHidden`（与自定义模式共用同一真相源），**不要另建状态**。
### 范围3 · 内置模板 ≥4（声明式 JSON，随包更新）
- 新增资源目录 `apps/desktop/resources/workbench-templates/`，放 4 个 JSON：`work-journal.json`（工作日志流）/`project-board.json`（项目作战板）/`reading-tracker.json`（阅读追踪）/`weekly-review.json`（周复盘）。
- JSON 形状（**唯一契约，不得自创字段**）：`{ "id": "work-journal", "title": "工作日志流", "desc": "...", "layout": { "v": 2, "order": ["quick", ...], "hidden": [] }, "seedPages": [ { "title": "日志", "body": "纯文本正文" } ] }`。
  - `order` 里的 id 必须是 `ALL_CARD_IDS` 的子集；缺省补尾；未知名丢弃（复用 `sanitizeCardsPersist` 口径）。
  - `seedPages[].body` = 纯文本，建页后用既有 `blocks.commit` 通道写入（**若形状不合则降级只建页并记 DEVIATION**）。
- `apps/desktop/electron-builder.yml` 的 `extraResources` 追加一段把该目录复制为 `<resourcesPath>/workbench-templates`（**照 build/ 图标那段写法**）。
- main 新增**只读**通道 `workbenchTemplates.list()`（打包态读 `<resourcesPath>/workbench-templates/*.json`，dev 态读 `apps/desktop/resources/workbench-templates/*.json`；坏 JSON 跳过不抛，返回 `{templates: [...]}`）。通道命名/类型照 `shared/ipc.ts` 既有风格；preload 暴露 `window.septcats.workbenchTemplates.list()`。
### 范围4 · 另存为模板（我的模板）
- 工作台「另存为模板」钮 `wb-save-template` → 弹框（标题输入 `wb-save-template-title` + 勾选要一起存为种子页的页 `wb-save-template-page-<pageId>` + 确认 `wb-save-template-confirm`）。
- 落库：**复用既有 templates slice**，扩 `TemplateKind` 加 `'workbench'`，新增 `templates.saveWorkbench({title, layout, seedPages})` → `{id}`，与 `templates.list({kind:'workbench'})` 一起作为「我的模板」数据源（存数据根 `templates/`，**零新表**）。
- 「我的模板」卡支持删除 `wb-market-template-delete-<id>`（走既有 `templates.remove` 软删口径）。
### 范围5 · 导入 / 导出
- 导出：`wb-market-template-export-<id>` → 下载单个 JSON 文件（文件名 = `<id>.json`，内容 = 范围3 的同一形状；内置模板也允许导出）。
- 导入：`wb-market-import` → 弹框（文件选择或粘贴 JSON 文本 `wb-market-import-text` + 确认 `wb-market-import-confirm`）→ 校验形状 → 存为「我的模板」；坏 JSON 给 toast 且不落库。

## 2. 红线
- 不碰 op-log / SCHEMA / 锁表 / 同步 / AI / 搜索；**不建新表**；不加新依赖；无 TODO。
- main/preload/shared 改动**仅限**：`TemplateKind` 加 `'workbench'`、`templates.saveWorkbench`、`workbenchTemplates.list`、`electron-builder.yml` extraResources 一段、4 个内置 JSON。**其余子系统零改动**。
- §16 UI 红线：框轮廓一律 `var(--sc-color-ink-edge)`（1px 内网格 / 2px 外框），禁灰线；组件 CSS 走 token `var(--sc-*)`（`no-magic` 门禁零违规）。
- 全局字体：思源黑体（既有约定，勿引新字体）；中文界面禁词「数据库」→ 统一「多维数据」。
- 隐私：零外联；模板 JSON 不得内嵌 URL 请求；`openExternal` 通道**仍不存在**（本单不新增）。

## 3. 门禁（CB 自跑，报告贴原始输出）
`pnpm typecheck`（0 错）· `pnpm -C apps/desktop exec vitest run`（全绿，只增不减）· `pnpm -C packages/ui exec vitest run`（全绿）· `node packages/ui/tokens/no-magic.mjs`（✓）。
新增单测要求：内置 JSON 形状校验 + 应用模板后布局落地 + 导入坏 JSON 拒绝 + 卡片开关与 `workbenchActions` 同源（≥12 例）。

## 4. DoD
- [ ] 五范围全交付 + 上述门禁原始输出
- [ ] 报告 `docs/tasks/TASK-T72-01-report.md`：§1 交付概览、§2 用例计数、§3 验收锚（留 PM 真机节）、§4 DEVIATION 登记、§5 文件改动清单、§6 红线自检
- [ ] 真机可验收的 testid 全按 §1 命名（**第一时间落 testid，别让 PM 猜**）
- [ ] 未碰 git；报告写明「未 merge / 未 push / 未动主树」

## 5. DEVIATION 纪律
任何与本文不符的取舍（含 seedPages 降级、通道命名微调、预览缩略实现方式）必须登记 D-n：现象 / 取舍 / 理由。禁静默偏离。