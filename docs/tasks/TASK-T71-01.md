# TASK-T71-01 · P2：卡片注册表 + 工作台自定义模式（老板 R20 条目④引擎）

> 前置：`docs/PRD-R20-库与模板市场.md` §3-T71 + §1 三原则（数据主权在页面/settings、卡实例=类型+配置+位置、无新表）。基线=main HEAD（T70 库层级收口后）。
> 侦察定论：`workbench/state.ts` 已有 v1 卡序/隐藏持久化（`septcats.workbench.cards`={v:1,order,hidden}，野 JSON 回退守卫齐）；`WORKBENCH_CARD_IDS=['quick','todo','database','recent','favorites']`；`WorkbenchCard.tsx` 是卡壳组件。**本单=把硬编码 5 卡升级成注册表驱动 + 加 6 新卡 + 自定义模式交互**。

## 1. 卡定义注册表（workbench/cards.ts 新文件）
- `WorkbenchCardDef = { id, labelKey, descKey, defaultSize?: 'sm'|'md'|'lg', render: (api: CardApi) => ReactNode }`。
- `CardApi` 给卡注入最小能力面：`{ openPage(id), t(key), settings: {read(key, def), write(key, val)} }`——settings 读写=localStorage JSON 守卫封装（`septcats.wbcard.<key>`，野 JSON 回退 def，仿 work.ts readTodos 范式）。**禁 fetch/禁 IPC 新增**。
- 内置 5 卡（quick/todo/database/recent/favorites）迁入注册表（行为零变化，T66 探针零回归）；`WORKBENCH_CARD_IDS` 由注册表派生。
- 布局持久化升 **v2**：`{ v:2, order: string[], hidden: string[] }`（id 集=注册表全集；v1 读到→order 保序+新卡追加默认位置；未知 id 丢弃；守卫单测钉 v1→v2 迁移）。

## 2. 新原子卡 ×6（每种：卡壳复用 WorkbenchCard + data-testid="wb-card-<id>"）
| id | 中文名 | 数据源（全部现成/本地） | 最小行为 |
|---|---|---|---|
| `shortcut` | 快捷方式 | settings `shortcut.links`: `[{pageId}]` | 列已选页面（复用 tree 缓存），点击 openPage；「+」弹页面选择 Menu（含搜索框）；可移除 |
| `countdown` | 倒计时 | settings `countdown.items`: `[{label,date}]` | 显示距目标日天数（date 非法=行内标红）；增删编辑行内表单 |
| `heatmap` | 近 7 日活跃 | settings `activity.days`: `{"YYYY-MM-DD": n}`（渲染层在 `blocks.onChange` 提交防抖处 +1，写点唯一） | 7 格柱/点热力（0=最浅 token 色，按 max 归一 4 档；全走 --sc-* token，no-magic 钉） |
| `quote` | 引用摘抄 | 现读 | 随机抽一页最近块文本（走既有 `blocks.list` IPC 读缓存的 pages.recent 头 3 页各取首个 text 块），点击=openPage 定位；空态「暂无可摘抄」 |
| `bookmarks` | 链接收藏 | settings `bookmarks.list`: `[{url,title}]` | 添加（URL 校验 /^https?:\/\//）列表+删除；点击=shell 打开外部（用既有 window.septcats 里若有 openExternal 通道；**没有就不做点击跳转，只做收藏记录**，记 DEVIATION） |
| `libstats` | 库统计 | 现读 tree | 当前库页面数/子页深度/多维数据数/收藏数 四格（纯聚合零 IPC） |
- 文案 i18n zh/en 全量；卡内输入统一 Enter 提交 Esc 取消。

## 3. 自定义模式（Cockpit 式）
- 工作台头部加「自定义」toggle 钮（像素 glyph，data-testid="wb-customize"）。非编辑态一切如旧。
- 编辑态：① 每卡壳左上出 ⋮⋮ 手柄（T60 同款 HTML5 drag 语法）拖拽重排（drop 高亮=ink-edge 2px 虚线语义）；② 卡右上角出 ⊟ 移除钮 → 进 hidden；③ 网格尾部出虚线「+ 添加卡片」占位卡（data-testid="wb-add-card"）→ 弹卡目录 Menu（=未启用卡全集，含说明文案；「从模板库浏览更多…」占位项 disabled，T72 接线）；④ 隐藏的卡在目录里标「已移除·点击恢复」。
- 布局每次变更即时写 v2 localStorage；「完成」钮退出编辑态。**重启还原实测锚**。

## 红线
- main/preload/shared/ipc/SCHEMA/op-log **零改动**；不建新表；不加依赖；不碰 git。
- WorkbenchPage 既有 5 卡 DOM/testid 不变（T66/T48 探针锚）；wb-head 只增钮不改序。
- 每写完一个测试文件立即 `npx vitest run --reporter=basic <文件>` 跑绿。
- 交付前 electron 计数=0 贴证据；探针/单测隔离夹具；真实数据根 untouched。
- 收尾倒数第 2 步填报告数字（骨架先建：docs/tasks/TASK-T71-01-report.md）。

## 验收锚（PM 真机 cdp-e2e-t71-01.mjs）
- K1 五旧卡迁入后行为零变（T66 探针 21/0 原样绿）。K2 六新卡逐一：存在+最小功能断言（倒计时天数算术/热力写读一处/摘抄非空/统计数对得上 tree）。K3 自定义模式：拖卡换序→刷新保持；移除卡→消失+目录可见恢复项；添加卡=注册表全集含新 6 卡。K4 v1→v2 迁移：预埋 v1 串→升级后旧序保持+新卡追加。K5 空态全套。K6 真根 untouched+计数 0。
- 老探针零回归（PM 连跑）：T66/T61/T60/T59/T67-B2/T70。desktop ≥833+新用例只增不减。
