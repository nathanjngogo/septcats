# TASK-T22-01 · 交付报告：UI 打磨批次 2（面包屑真路径 + 回收站列表 + 空态/微交互）

> 工程师：CodeBuddy ｜ 前置：`6f000cf`（任务书提交）｜ 日期：2026-09-19
> 按 §0 PM 裁决实现，未另择方案；无新增依赖、未触碰 main/**、packages/**、shared/**、CI/发布脚本。
> SSIM-NOTE：本报告为唯一交付说明；§5 为 PM 复跑节留（PM 补）。

## §0 现状核实（对任务书前提的确认）

1. **demo 面包屑残留属实**：App.tsx:102-108 pages 视图写死
   `[{label:'研究'},{label:'暗物质探测实验笔记'}]`，与 store 真实态无关联。
2. **store 侧已齐备，本单零 store 语义改动**：`view: 'pages' | 'trash'`（AppView）、
   `trashNodes()`（alive=0 且 deletedAt>0，purge 过的行不露出）、
   `restorePage(id)`/`purgePage(id)`（乐观更新 + 级联子树 + 对账）、`showPages()`
   全部为 T6-01/T21-02 既有动作；`ancestorsOf`/`breadcrumbOf` 已有（但无空标题回退、
   无 trash scope 分派），故按红线「只增不改」追加纯函数（§2-2）。
3. **确认组件核查**：`grep -rn "ConfirmDialog|Modal|Dialog" renderer/src` → **无命中**；
   但 `@septcats/ui` 已出口 `Dialog`（focus trap / Esc / 遮罩关闭 / aria-modal 全齐），
   按「有既有确认组件必须复用」的精神**复用 UI 包 Dialog + Button(variant='destructive')**，
   未做最小自实现（§2-1）。

## §1 修法

### 1.1 state/pages.ts（只增不改：+3 个导出，纯函数）

- `BREADCRUMB_UNTITLED = '未命名'`：面包屑/回收站行共用的空标题回退文案（与 main 侧
  createPage 默认标题一致）。
- `breadcrumbItemsOf(id, byId)`：既有 `breadcrumbOf` 的 item 化包装——祖先链（根 →
  当前页）逐段 `{label}`，空标题回退「未命名」；id 为空/查不到 → `[]`。
- `pagesBreadcrumbItems(state)`：pages 视图顶栏分派——`view==='trash'` →
  `[{label:'回收站'}]`；有 `selectedId` → `breadcrumbItemsOf`；无选中 → 活动工作区名
  （查不到回落「当前工作区」，与 SearchPage 同口径）。settings/importWizard 不经过
  这里（App 侧保持既有 `t()` 文案）。

### 1.2 App.tsx（面包屑真路径 + trash 路由）

- 面包屑：`usePages((state) => state)` 整份订阅（引用稳定，store.ts 选择器约束），
  非 settings/import 视图一律 `<Breadcrumb items={pagesBreadcrumbItems(pagesState)} />`，
  删除写死 demo 数组；settings/import 两分支原样不动。
- 内容区路由补一档：`view === 'trash'` 时渲染 `<TrashList />`（优先级：settings >
  import > trash > searchOpen > PageView）。

### 1.3 renderer/src/pages/TrashList.tsx + TrashList.css（新，§0.B）

- **放主区**（与 SearchPage 同 760px 版心布局）：侧栏 220px 级宽度放不下「标题 +
  恢复 + 彻底删除」两按钮行，主区是既有布局下最自然处；侧栏底栏保留入口/角标/激活态。
- **行树**：`trashRows(nodes)` 纯函数（导出供测试）——`trashNodes` 结果里父不在
  回收站的为根（sortKey 升序、id 决胜，与 SidebarTree/main 派生序同式），沿 `childIds`
  下钻仍在回收站的子页，`depth` 做 token 化缩进（与 SidebarTree indentStyle 同式）。
- **动作**：「恢复」（ArrowClockwise）→ `restorePage(id)`；「彻底删除」（Trash）→
  打开 `Dialog` 二次确认 → 确认才 `purgePage(id)`，取消/Esc/遮罩关闭不触发。
  弹层文案带页标题与「及其子页面…不可撤销」提示。
- **空态**：`.trash-empty` 与 `.search-empty` 同 token 组合（§1.5）。
- **返回**：「返回页面」ghost 按钮 → 既有 `showPages()`；侧栏底栏往返不受影响。

### 1.4 微交互（§0.C.2）

- `.app-nav-row` / `.app-side-foot`（App.css）、`.search-res`（SearchPage.css，补
  `:active` accent-soft 反馈）、`.trash-row`（TrashList.css）统一
  `transition: background-color/color var(--sc-motion-fast) ease-out`（120ms token，
  ≤150ms；无关键帧、无动画库）。
- 每个引入过渡的 CSS 文件各自加
  `@media (prefers-reduced-motion: reduce) { … { transition: none } }` 兜底
  （tokens.css 虽有全局兜底，按任务书要求在本层显式加）。

### 1.5 空态统一（§0.C.1）

基准 = `.search-empty`（`font: var(--sc-text-ui-sm)` + `color: var(--sc-color-ink-faint)`
+ `margin-top: var(--sc-space-xxl)` + 居中）。`.trash-empty` 完全同 token 组合；
侧栏 `.app-nav-empty`（收藏/最近空态）字号由 ui-xs **升为 ui-sm** 对齐（色本就同源
ink-faint），布局属性（省略号/行缩进）保留——侧栏空态行是行内元素，居中/xxl 上边距
不适用，故「统一」落点是色/字号同一 token、间距各随版式（§2-3）。

## §2 DEVIATIONS / 口径说明

1. **DEVIATION-1（确认组件来源）**：任务书 grep 范围 `renderer/src` 内确无确认组件；
   本单复用的是 **packages/ui 已出口的 `Dialog`**（非 renderer 本地件）。未按
   「确实没有则最小实现」另写弹层——UI 包 Dialog 是现成契约件（focus trap/双主题/
   overlay token 全齐），自写反而是重复实现。未触碰 packages/** 任何文件。
2. **state/pages.ts 只增不改（红线内裁量）**：追加 `BREADCRUMB_UNTITLED`/
   `breadcrumbItemsOf`/`pagesBreadcrumbItems` 三个导出，插在既有 `breadcrumbOf` 之后、
   桥接区之前；既有函数与 actions 一字未动。放这里而非 App.tsx 是为测试可轻量 import
   （App.tsx 模块链会拖入 PageView/编辑器全量依赖）。
3. **空态统一口径**：任务书要求「同一 token 组合：色/间距/字号」。侧栏空态与主区空态
   版式不同（行内省略 vs 居中块），强套同一边距会破侧栏布局；落点为**色/字号同 token、
   间距同 token 体系但各随版式**（主区两处完全一致）。若 PM 要求侧栏空态也居中，改
   `.app-nav-empty` 一条规则即可。
4. **图标口径**：恢复用 `ArrowClockwise`——`ArrowCounterClockwise` 不在 @septcats/ui
   出口清单，补出口须改 Icon.tsx（packages/**，本单红线禁入）；出口内最贴近「恢复」
   语义即 ArrowClockwise。
5. **trash 优先级裁量**：内容区 trash 档放在 searchOpen 之前（进回收站时不再被
   Ctrl+K 面板残留的 searchOpen 顶回搜索页）；面包屑同理 trash 优先于选中页祖先链。
6. **回收站行空标题**：任务书只定面包屑回退「未命名」；行内空标题会显示空白，按同一
   `BREADCRUMB_UNTITLED` 兜底（小裁量，随用例钉住）。

## §3 交付物清单

- `apps/desktop/src/renderer/src/App.tsx`（面包屑真路径 + trash 内容区路由）
- `apps/desktop/src/renderer/src/state/pages.ts`（+3 导出，只增不改）
- `apps/desktop/src/renderer/src/pages/TrashList.tsx`（新：回收站列表 + Dialog 二次确认）
- `apps/desktop/src/renderer/src/pages/TrashList.css`（新：版心/行/空态，全 token）
- `apps/desktop/src/renderer/src/App.css`（行/底栏过渡 + reduced-motion + 空态字号对齐）
- `apps/desktop/src/renderer/src/pages/SearchPage.css`（结果行过渡 + :active + reduced-motion）
- `apps/desktop/test/trash-ui.test.tsx`（新：10 用例）

## §4 测试（自跑，全绿）

**trash-ui.test.tsx（10 用例，jsdom + 假桥）**：
- 面包屑纯函数（4）：三层父链顺序（根→中→叶）；空标题回退（祖先段与自身段）；trash
  scope 只显「回收站」（与 selectedId 无关）；无 selectedId → 工作区名 / 查不到活动
  工作区 → 「当前工作区」。
- trashRows 纯函数（1）：根前子后、深度递增；存活页与已 purge（deletedAt=0）行不露出。
- TrashList 组件（5）：空态文案与 `.trash-empty`；父/子行渲染 + 行标题空回退「未命名」；
  「恢复」→ `pages.restore` 收到 `{id}` 且乐观置活后对账；「彻底删除」→ 先只开弹层
  （purge 不触发）→ 取消不 purge → 确认才 `pages.purge({id})`；「返回页面」→ view 回 pages。

**修复前红**（行为缺口）：面包屑写死 demo 数组（任何 store 态都不影响顶栏）；
`view==='trash'` 无内容区消费者；restore/purge 无 UI 回调路径——新增用例在旧代码上必红。

**修复后绿**（自跑原文）：

```
 Test Files  34 passed (34)
      Tests  356 passed (356)
```

```
pnpm -r typecheck                     → 全部 Done，0 错
node packages/ui/tokens/no-magic.mjs  → ✓ 无字面 hex、无非 1px 重复裸 px
node packages/ui/tokens/build-tokens.mjs --check → ✓ token 产物与 DESIGN.md 一致
```

既有测试文件零改动（断言语义不变）；双主题成立性由「无字面 hex、全 var(--sc-*)」
门禁 + tokens.css 双主题变量保证，真机截图归 PM 复跑。

## §5 PM 复跑（2026-09-19）

（PM 补）
