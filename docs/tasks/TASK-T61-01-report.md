# TASK-T61-01 报告 · P2 结构批——侧栏文件夹 + 左右栏拖拽宽度（R13 ④⑧）

> 状态：**完成**（真机探针 **30 PASS / 0 FAIL**；老探针 T52 23/0、T59 45/0、T60 32/0 复跑零回归；desktop **844 = 基线 796 + 48**）
> 基线：T60 收口（55b092d，desktop 796）＋ 0.4.1-rc.1 号段；批次 **R13 第二单**
> 设计真源：`docs/PRD-R13-优化八条.md`（侦察表）+ `docs/tasks/TASK-T61-01.md`（施工图）
> 探针：`docs/mockups/cdp-e2e-t61-01.mjs` → `docs/mockups/screens-t61/`（**11 张 png** + `t61-01-results.json`）
> 逐条验收锚：新建子页 → 父行 FolderSimple ✓（像素签名 3/1/10 → 1/3/8）／移入 → 树形变化 ✓（`parentId` 落库）／拖左缘 DOM 实随 ✓（240→330）／拖右缘 AI 宽实随 ✓（320→350）／30% 钳制实测 ✓（1184→355）／松手落盘 + 重启还原 ✓（355→355）／T57 滑杆联动值域 ✓（max=355@1184）

## 1. 交付摘要

老板 09-22 晚 R13 ④⑧ 两件事落地为「结构批」（纯派生/UI/localStorage，**零协议变更**）：

1. **侧栏文件夹 = 派生语义，零协议改动**（④）：不造新实体、不动 op-log/`SCHEMA_VERSION`/迁移号。
   - 「新建子页面」= 既有 `createPage(该行 id)`（`parentId` 早已支持）+ store 既有「新页进重命名」；
   - 有活子页的普通页行图标 → **FolderSimple**（`parentId` 反查索引 `useMemo`，O(1) 行内判定，不全树扫）；
   - 「移入…」= 既有 `movePage` + Menu 二级选择（排除自身与后代防环）；
   - 折叠态点文件夹行 = 选中 + 展开子树（点 Caret 仍是纯折叠/展开，语义不变）。
2. **左右栏拖拽宽度**（⑧）：`layoutState` 纯函数扩展 + 两侧 `ResizeHandle`。
   - `maxPanelWidth(vw) = min(480, floor(vw × 0.30))`；侧栏上限由静态 320 改此动态值；新增 `ai.width`（默认 320，值域 [240, 视口 30%]）；
   - 旧 v1 持久化（T38/T39/T57 时代无 `ai.width`）→ **默认值兜底、不判脏、不升版本号**（真机实证：老用户布局不整份回退）；
   - 把手：`pointerdown → setPointerCapture → pointermove`（rAF 节流）→ `pointerup` 收尾，全程走既有 `patchLayout`（与 T57 滑杆**同一真源**，preset 自动转 custom）；双击回默认；←/→ 16px、Home 回默认；aria = `role=separator` + valuenow/min/max；
   - 折叠态（`position='collapsed'`）与 AI `position='bottom'/'hidden'` 均**不挂把手**（宽度对这两种布局无意义）；AI `bottom` 真机实证面板在位但把手不存在；
   - `commit()` 加**唯一夹紧闸**，预设整份套用 / 导入 / 恢复默认 / 窗口变窄（App resize 监听 → `reclampToViewport`）全部过闸 → 「≤ 总宽 30%」口径恒成立。

真机证据链：行图标像素签名（FileText `3/1/10` → FolderSimple `1/3/8`，与工作区头同族）、菜单条目序、二级移入列表（含「工作区根」、排除自身）、树形变化双向（DOM 缩进 + `pages.tree` 父指针）、左/右缘真鼠标拖拽（原生 CDP，`getBoundingClientRect` 实测 + 根变量 + localStorage 三处同值）、30% 钳制实测（355）、重启还原、滑杆值域联动、AI 置底把手消失/切回恢复、11 张双主题截图、1184/894 零滚动、真档案 untouched、electron 计数 0。

## 2. 改动清单

### 2.1 apps/desktop · layoutState（纯函数扩展）

| 文件:行 | 变更 |
|---|---|
| `layout/layoutState.ts:29-40` | `LayoutState.ai` 增 `width: number`（纯增字段） |
| `:46-73` | 常量重排：删 `SIDEBAR_WIDTH_MAX = 320`；新增 `PANEL_WIDTH_CAP = 480`、`PANEL_WIDTH_RATIO = 0.3`、`AI_WIDTH_MIN = 240`、`AI_WIDTH_DEFAULT = 320`、`PANEL_RESIZE_STEP = 16`、`FALLBACK_VIEWPORT_WIDTH = 1024` |
| `:75-107` | 新增 `currentViewportWidth()`、`maxPanelWidth(vw = 当前视口)`；`clampSidebarWidth/clampAiWidth` 改视口动态上限（**下限优先**：极窄视口区间不为空） |
| `:120-150` | 三预设 `ai` 增 `width: AI_WIDTH_DEFAULT`（位置/展开/侧栏宽定义值一字未动） |
| `:196-225` | `previewSidebarPercent(width, vw?)` / `layoutPreviewOf(layout, vw?)` 改用新值域（14%–30% 区间端点不变；退化区间取 30% 不除零） |
| `:280-310` | `validateLayout`：`ai.width` 缺失/非有限数 → **兜底 `AI_WIDTH_DEFAULT`**（不返回 null、不判脏）；合法值按当前视口夹紧 |
| `:432-448` | `applyLayoutToRoot` 增注入 `--sc-layout-ai-width`（并写明消费方 = AiChatPanel.css） |
| `:470-486` | 新增 `useViewportWidth()`（resize 订阅；首帧即确定值，无 0 宽窗口） |
| `:521-545` | 新增 **`normalizeLayout()` 唯一夹紧闸** + `commit()` 过闸（引用不变则零通知） |
| `:560-575` | 新增 `layoutActions.setAiWidth(width)`（与 `setSidebarWidth` 同真源） |
| `:600-610` | 新增 `layoutActions.reclampToViewport()`（窗口变窄时重新夹紧；无变化零副作用） |

### 2.2 apps/desktop · 拖拽把手（新组件）

| 文件:行 | 变更 |
|---|---|
| `layout/ResizeHandle.tsx`（**新增** 236 行） | 把手组件：`side='sidebar' \| 'ai'`；pointer capture + rAF 节流 + `pointerup` 收尾（pending 必 flush）；双击回默认（240 / 320）；←/→ 16px（两侧方向相反）、Home 回默认；`role=separator` + `aria-orientation` + valuenow/min/max + `tabIndex=0`；侧栏 collapsed / AI 非 right → 早退不渲染 |
| `layout/ResizeHandle.css`（**新增**） | `.sc-resize` 4px 命中区、骑缝居中（侧栏 `right:-2px`；AI `right: calc(var(--sc-layout-ai-width…) − 2px)`）、`cursor: col-resize`、悬停/聚焦/拖拽中 `::after` 绘 2px ink-edge；**无 transition**（免 reduced-motion 兜底块），零裸 px（区间值走 `--sc-space-xs/xxs`） |

### 2.3 apps/desktop · 接线（App / CSS / 布局编辑器）

| 文件:行 | 变更 |
|---|---|
| `App.tsx:23` | 引入 `ResizeHandle` |
| `App.tsx:196-208` | 新增 resize 监听 → `layoutActions.reclampToViewport()` |
| `App.tsx:443-452` | 侧栏把手与 `SidebarTree` 同宿主（折叠态随整列 display:none 一同不可见） |
| `App.tsx:466-482` | AI 面板左缘把手（`chatOpen && !aiHidden` 时挂；right 态由组件自身把关） |
| `App.css:70-82` | `.app-main-row` 增 `position: relative`（AI 把手定位宿主；把手不在流内，零布局影响） |
| `ai/AiChatPanel.css:9-21` | 面板宽 `320px` → `var(--sc-layout-ai-width, 320px)`（回退值 = T38-01 定宽原值，变量缺失时逐像素同改前） |
| `layout/LayoutEditorPage.tsx:26-46` | 引入 `AI_WIDTH_MIN/useViewportWidth/maxPanelWidth`；删 `SIDEBAR_WIDTH_MAX` |
| `:118-131` | 两侧滑杆上限改 `max(SIDEBAR_WIDTH_MIN/AI_WIDTH_MIN, maxPanelWidth(视口))`（随窗口实时变） |
| `:258-296, 331-350` | 侧栏宽度滑杆上限改动态；**新增 AI 宽度滑杆**（`data-testid="layout-ai-width"`，min 240 / step 10） |

### 2.4 apps/desktop · SidebarTree（文件夹派生 + 移入）

| 文件:行 | 变更 |
|---|---|
| `pages/SidebarTree.tsx:23` | 引入 `ancestorsOf`（反向用于「排除后代」） |
| `:214-220` | 新增 `movePickId` 二级选择态（与 `rowMenuId` 共用宿主） |
| `:230-247` | 新增 `folderIds` 派生集合（`parentId` 反查索引，O(n) 一次 / 行内 O(1)） |
| `:250-256` | `closeRowMenu` 一并复位二级态 |
| `:395-470` | `pageRowMenu`（**单一构造**）增「新建子页面」「移入…」两条目；`onSelect` 处理 `newSubpage`（→ `createPage(node.id)`）与 `moveTo`（→ 切二级列表，不关菜单） |
| `:472-520` | 新增 `moveTargetMenu(node)`：候选 = 全部活页（排除多维数据行）− 自身 − 后代（`ancestorsOf` 反向判定）+「工作区根」；当前父页/根目标为已在位则 `disabled`；选中 → 既有 `movePage`；成功后自动展开目标父页 |
| `:530-560` | 行图标：`type==='page' ? (folderIds.has(id) ? FolderSimple : FileText) : depth===0 ? rootIcon : FileText` |
| `:561-572` | 行点击：选中 + **折叠态同时展开子树**（`childCount>0 && !expanded.has(id)`） |
| `:610-625` | ⋯ 钮 / 右键入口复位二级态；`Menu` 以 `key` 换实例（一级 ↔ 二级，见 DEVIATION-7） |

### 2.5 i18n

| 文件:行 | 变更 |
|---|---|
| `i18n/zh-CN.ts:28-29` | `app.resizeSidebar`「调整侧栏宽度」/ `app.resizeAi`「调整 AI 面板宽度」 |
| `i18n/zh-CN.ts:99-109` | `sidebar.newSubpage`「新建子页面」/ `moveTo`「移入…」/ `moveToTitle`「移入页面」/ `moveToRoot`「工作区根」 |
| `i18n/zh-CN.ts:283-289` | `settings.layout.aiWidth` / `aiWidthDesc`（新增）；`sidebarWidthDesc`「200–320」→「200–30% 视口（上限 480）」（口径变更同步，避免文档与实现不符） |
| `i18n/en-US.ts` 对应四处 | 同构英文键（门禁①键集合等价 / ②en 无 CJK） |

### 2.6 测试与探针（数字见 §5）

| 文件 | 变更 |
|---|---|
| `apps/desktop/test/t61-01-layout-widths.test.ts` | **新增 23 用例**：`maxPanelWidth` ×4（含封顶/非法视口/缺省取当前视口）、两侧夹紧 ×4（下限恒定/上限随视口/取整/极窄下限优先）、旧 v1 兼容 ×5（缺 width / 非法 width / 合法夹紧 / `readLayout` 不整份回退 / 版本号恒 1）、预设与真源 ×4（预设值/变量注入/越界/步长）、恢复默认过闸 + `reclampToViewport` ×2、预览新值域 ×4 |
| `apps/desktop/test/t61-01-resize-handle.test.tsx` | **新增 12 用例**：拖左/右缘改宽+落盘 ×2、拖拽中实时随动 ×1、rAF 节流（同帧三次 move 只落一次写）×1、30% 钳制 ×2（侧栏/两视口 AI）、双击回默认 ×1、键盘 ←/→/Home ×2（两侧方向相反 + 键位同受钳制）、aria 口径 ×1、挂载条件 ×2（AI bottom/hidden、侧栏 collapsed） |
| `apps/desktop/test/t61-01-folder.test.tsx` | **新增 13 用例**：派生外观 ×3（有子页/叶子/软删后回落）、新建子页面 ×3（菜单条目序 / 假桥 `{parentId}` 调用 + 进重命名 / **端到端 pg-b 由 FileText 变 FolderSimple**）、移入二级 ×5（列表内容与防环 / 选中落库 + 树形变化 + 目标展开 / 工作区根 / 当前父页 disabled + Esc 关 / 右键入口）、折叠态点行展开 ×2（含 Caret 不选中不回归） |
| 老断言最小更新 6 处 | 见 §6 DEVIATION-1~5（`layout-state` / `layout-preview-t57` / `layout-editor-t57` / `layout-picker-t57` / `layout-ui` / `t60-01-interaction`） |
| `docs/mockups/cdp-e2e-t61-01.mjs` | **新增真机探针**（30 断言；G0 夹具 → G1 文件夹派生 → G2 移入二级 → G3 拖左缘 → G4 30% 钳制 → G5 拖右缘 + 右缘钳制 → G6 滑杆值域 + AI 置底不挂把手 → G7 重启还原 → G8/G9 浅/深截图 → G10 两宽度 → G11 隔离/退出） |
| `docs/mockups/screens-t61/` | **11 张 png** + `t61-01-results.json` |

### 2.7 复跑老探针产生的产物改动（非本单代码改动）

- `docs/mockups/screens-t52/*`、`screens-t59/*`、`screens-t60/*`（含各自 `results.json`）：为取证「老断言零回归」按设计重跑三支探针，它们各自重写自己的截图与结果 JSON（证据见 §5.3）。
- `docs/perf-history.jsonl`：desktop 全量测试（`perf.test.ts`）按设计追加一行基线。

## 3. 文件夹派生语义设计（零协议改动取证）

| 任务书要求 | 落点（代码事实） | 协议面 |
|---|---|---|
| 不造「文件夹」新实体 | 无新表/新列/新类型；`pageTypeOf` 仍只有 `page\|wiki\|database`（`state/pages.ts:108`） | **零** |
| 「新建子页面」 | `pagesActions.createPage(node.id)`（`state/pages.ts:495`，`parentId` 早已支持，main 侧 `pages.create` 未改） | **零**（复用既有 op） |
| 有活子页的普通页 = FolderSimple | `folderIds`（`nodes` 里 `alive===1 && parentId!==null` 的父集合）一次 `useMemo` 索引；行渲染 O(1) `has` | **零**（纯视图派生） |
| 「移入…」 | `pagesActions.movePage({id,newParentId})`（`state/pages.ts:537`，既有 IPC `pages.move`，main 侧无改动） | **零**（复用既有 op） |
| op-log / SCHEMA_VERSION / 迁移号 | `apps/desktop/src/db/*`、`main/pages.ts`、`packages/core`、`packages/schema` **零改动**（`git status` 可查） | **零** |

同步面结论：本单对 `sync`/`importer` 零接触，故 ④ 对同步**不产生新风险**（PRD 侦察表「同步零风险」口径成立）。

## 4. 竞态与风险点处置

### 4.1 rAF 节流 × pointer capture × 落盘时序

- **单一真源**：拖拽不另造「预览宽度」中间态——`pointermove`（rAF 节流）直接调 `layoutActions.setSidebarWidth/setAiWidth` → `patchLayout` → 注入根变量 + 写 localStorage + preset 转 `custom`，与 T57 滑杆**同一条写路径**（任务书 §2.2「走既有 patchLayout」）。
- **rAF 节流**：`pendingRef` 存最新值、`frameRef` 保证一帧只写一次；`pointerup/pointercancel` 必 `flush` pending（收尾幂等）。单测钉死「同一帧三次 pointermove → 只通知订阅者 1 次」。
- **无 rAF 环境退化**：`hasRaf()` 为假时同步落值（不吞拖拽），jsdom/无头环境同样可用。
- **pointer capture 容错**：`setPointerCapture/releasePointerCapture` 存在才调、异常忽略（jsdom 未实现；真机走 capture，指针移出窗口仍收 move/up）。
- **真实链路实证**：探针用原生 CDP `Input.dispatchMouseEvent` 合成真鼠标（非合成 DOM 事件），drag 后 DOM 实宽 / 根变量 / localStorage 三处同值（240→330、320→350）。

### 4.2 旧 v1 持久化兼容（无 ai.width → 默认兜底，不判脏）

- `validateLayout` 对 `ai.width`：`typeof number && isFinite` 才夹紧，否则**兜底 `AI_WIDTH_DEFAULT`**（关键：**不返回 null**；否则 T38/T57 时代老用户的整份布局会被判损坏、全部回退默认）。
- 单测双向钉死：缺键 / 字符串 / `NaN` / `null` / 对象 五种形态均「不判脏 + width=320」；`readLayout()` 读老 JSON 后自定义字段（sidebar 288 / measure 720 / theme dark）**逐项存活**。
- **不升版本号**：`LAYOUT_VERSION` 恒 1，`validateLayout` 仍只认 `v===1`（纯增字段）。
- 真机实证：探针从「全新夹具（无 localStorage）」起跑，首帧 `septcats.layout` 即含 `ai.width`，后续 reload 还原一致。

### 4.3 移入选择器防环（排除自身与后代）

- 后代判定借 `ancestorsOf(candidate.id, byId)` **反向**用：候选的祖先链里出现本行 id ⇒ 候选是它的后代 → 剔除（无需新增 `subtreeIds` 导出，红线内完成）。
- 另剔自身；多维数据行不作容器（与既有 `fullWidthItem/convertItem` 的 database 特例同源，见 DEVIATION-6）。
- 已在位目标（当前父页 / 根目标而 `parentId===null`）标 `disabled`，避免无意义 move。
- 真机实证：二级列表 `["工作区根","T61 容器页","未命名"]`（被移动页自身不在列表；`disabled=[true,false,false]` ← 它本来就在根）；选中后 `pages.tree` 里 `moved.parentId === container.id`，DOM 两行缩进 = `* 1`。

### 4.4 折叠态 × 把手隐藏 × AI position:bottom

- 侧栏折叠（`position='collapsed'`）：整列 `display:none`（T30 红线）+ 组件自身早退 → 把手不可达（单测：collapsed 时 `queryByTestId('resize-sidebar')===null`，切回 left 即恢复）。
- AI `bottom`：面板转纵向定高全宽，宽度无意义 → 把手不挂；`hidden` 同理。**真机实证**：在布局编辑器选「底部」→ 面板在位（`.app-main-row--ai-bottom` + `.ai-chat` 都在）而 `resize-ai` = null；切回「右侧」把手即时恢复。
- 折叠语义不变：`collapsed` 仍只由 `position` 决定，拖拽/滑杆都不改 `position`（单测 + 探针 G6/G7 均验）。

## 5. 命令与完整输出

### 5.1 单测 / 类型

```
$ cd apps/desktop && pnpm test          # pretest 切 node ABI（better-sqlite3 全量库测可跑）
 Test Files  74 passed (74)
      Tests  844 passed (844)           ← 基线 796，本单 +48（新文件 23+12+13）

$ cd packages/ui && npx vitest run
 Test Files  31 passed (31)
      Tests  148 passed (148)           ← 未改动文件，零回归

$ cd packages/editor && npx vitest run
 Test Files  11 passed (11)
      Tests  200 passed (200)           ← 未改动文件，零回归

$ cd packages/dbview && npx vitest run
 Test Files  5 passed (5)
      Tests  122 passed (122)           ← 未改动文件，零回归

$ pnpm -r --no-bail run typecheck       # tsc × 9 包
（9/9 Done，无输出）

$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

> 门禁连带修复：新把手的回退值 `320px` 与旧注释里的字面数字叠加曾触发 no-magic「裸 px 重复 2 次」→ 注释改为引用常量名（`AI_WIDTH_DEFAULT`），实现零字面量。

### 5.2 真机探针 `cdp-e2e-t61-01.mjs`

```
$ cd apps/desktop && pnpm build          # electron ABI + fresh out/**
✓ built in 1.74s

$ node docs/mockups/cdp-e2e-t61-01.mjs
PASS [G0|fixture] G0-1 夹具成立：真点「新建页面」×2 → 2 存活页                — pages=2
PASS [G0|fixture] G0-2 浅色主题就位（夹具 settings.theme=light）              — data-theme=light
PASS [G0|fixture] G0-3 两页改名落库（容器页 / 被移动页可辨识）                 — ["T61 容器页","T61 被移动页"]
PASS [G1|folder] G1-1 ⋯ 菜单含「新建子页面」与「移入…」（顺序钉死）            — ["重命名","新建子页面","移入…","固定宽度","转为 Wiki","删除"]
PASS [G1|folder] G1-2 新建子页面落库：子页 parentId = 容器页 id                — {containerId:…B8C, children:[…ACJ]}
PASS [G1|folder] G1-3 父行图标 FileText → FolderSimple（像素签名）            — before={x:3,y:1,w:10} after={x:1,y:3,w:8} folder={x:1,y:3,w:8}
PASS [G2|move-picker] G2-1 二级列表含「工作区根」+ 容器页、排除多维数据行      — ["工作区根","T61 容器页","未命名"]
PASS [G2|move-picker] G2-2 防环：候选不含自身（被移动页）                      — 同上
PASS [G2|move-picker] G2-3 移入落库：被移动页 parentId = 容器页 id（树形变化）  — moved.parentId=…B8C container.id=…B8C
PASS [G2|move-picker] G2-4 目标父页自动展开（子树可见）                        — 两行 paddingLeft = …* 1
PASS [G3|drag-sidebar] G3-0 左把手命中区 = 4px 且骑缝在侧栏右缘                — {x:240,y:368,w:4}
PASS [G3|drag-sidebar] G3-1 拖左缘：侧栏 DOM 实宽随 Δx 增宽                    — before=240 after=330 Δ=90
PASS [G3|drag-sidebar] G3-2 松手落盘：localStorage.sidebar.width = DOM 实宽    — persisted=330 dom=330 var=330px
PASS [G3|drag-sidebar] G3-3 根变量与持久化/DOM 三处一致                        — var=330px persisted=330
PASS [G4|clamp-30pct] G4-1 拖到极限：夹在 min(480, 视口 30%)（1184 → 355）     — dom=355 expected=355
PASS [G4|clamp-30pct] G4-2 钳制值同样落盘（不落未夹紧的原始像素）              — persisted=355
PASS [G5|drag-ai] G5-1 右把手只挂 AI 面板（右侧栏布局）                        — aiRect{left:864,w:320} handle=true
PASS [G5|drag-ai] G5-2 拖右缘：AI 面板 DOM 实宽随 Δx（向左拖 = 变宽）          — before=320 after=350 Δ=30
PASS [G5|drag-ai] G5-3 AI 宽落盘：ai.width = DOM 实宽                          — persisted=350 dom=350 var=350px
PASS [G5|drag-ai] G5-4 右缘同样受 30% 钳制（1184 → 355）                       — dom=355 expected=355
PASS [G6|slider-range] G6-1 两根宽度滑杆 max = floor(视口 × 0.30)（1184→355）  — {sideMax:"355", aiMax:"355", sideValue:"350", aiValue:"350"}
PASS [G6|slider-range] G6-2 AI position=bottom → 面板在位但右把手不挂          — {bottomRow:true, panel:true, handleAi:false}
PASS [G6|slider-range] G6-3 切回 position=right → 右把手恢复挂载                — {bottomRow:false, handleAi:true}
PASS [G7|restart-restore] G7-1 重启还原：侧栏宽 = 持久化值（DOM 实测）          — before=355 after=355 persisted=355
PASS [G7|restart-restore] G7-2 重启还原：AI 面板宽 = 持久化值                  — before=355 after=355
PASS [G9|dark] G9-0 深色主题就位                                              — data-theme=dark
PASS [G9|dark] G9-1 深色：左把手可拖（355→295）且两侧把手齐备                   — handles=true/true
PASS [G10|two-widths] G10-1 1184/894 零滚动 + 侧栏 top=0                       — 1184:{800/800,1184/1184,0} 894:{800/800,894/894,0}
PASS [teardown] G11-1 window.close() 优雅退出（未强杀）                        — {gracefulExited:true,forced:false}
PASS [teardown] G11-2 退出后 electron 进程计数 = 0                             — before=5 after=0

===== T61-01：30 PASS / 0 FAIL =====
realRoot untouched=true  electron 最终计数=0
results -> docs/mockups/screens-t61/t61-01-results.json
```

截图 **11 张** `screens-t61/`：
`t61-01-light-main.png`、`t61-01-light-folder.png`（容器页文件夹图标 + 子页）、`t61-01-light-movemenu.png`（二级移入列表）、`t61-01-light-handle-hover.png`（把手悬停 ink-edge）、`t61-01-light-sidebar-resized.png`、`t61-01-light-ai-resized.png`、`t61-01-light-slider-range.png`（布局编辑器两根滑杆）、`t61-01-light-main-1184.png`、`t61-01-light-main-894.png`、`t61-01-dark-main.png`、`t61-01-dark-resized.png`。

### 5.3 老探针复跑（零回归取证）

```
$ node docs/mockups/cdp-e2e-t52-01.mjs
===== T52-01：23 PASS / 0 FAIL =====        realRoot untouched=true

$ node docs/mockups/cdp-e2e-t59-01.mjs
===== T59-01：45 PASS / 0 FAIL =====        realRoot untouched=true  electron=0

$ node docs/mockups/cdp-e2e-t60-01.mjs
===== T60-01：32 PASS / 0 FAIL =====        realRoot untouched=true  electron=0
```

> 说明（如实登记）：T52 探针退出时其布局存储为 `sidebar.width=200 / ai.width=240` —— 这是**新口径生效的证据**：探针把窗口收到 800 宽（30% = 240）时，`reclampToViewport` 把默认 320 的 AI 宽夹到 240，而 T52 全部 23 条断言仍零红。

### 5.4 交付卫生

```
electron 进程计数：探针前 0；T61 探针退出 before=5 / after=0；三支老探针复跑后最终 = 0
真档案 C:\Users\Administrator\.septcats：mtime 前后一致（untouched=true），夹具全在 _scratch/t61-01/
git status：仅 apps/desktop/src/renderer/**（8 文件）、apps/desktop/test/**（5 文件改动 + 3 新）、
            docs/mockups/**（新探针 + screens-t61；三支老探针产物按设计重写）—— 
            零 core / db / schema / sync / importer / packages 改动；未加依赖；未碰 git（改动留在工作区由 PM 决定提交）
```

## 6. DEVIATIONS（任务书前提与代码事实不符 → 最小改动补齐并登记）

| # | 位置 | 任务书/PRD 前提 | 代码事实 | 处置 |
|---|---|---|---|---|
| D-1 | `layoutState.ts:51` + 5 个老测试文件 | §2.1「sidebar.width 上限改 min(480, viewport*0.30)」 | 既有断言把上限钉在静态 `SIDEBAR_WIDTH_MAX = 320`（`clampSidebarWidth(999)===320`、滑杆 `max==='320'`、预览 `320→30%`） | 常量改 `PANEL_WIDTH_CAP=480` + 动态 `maxPanelWidth`；老断言**按新口径改写**（`layout-state` 4 处 / `layout-editor-t57` 2 处 / `layout-ui` 1 处 / `layout-picker` 1 处 / `layout-preview` 3 处），断言语义（下限/取整/端点）不变 |
| D-2 | `layoutState.ts:50-51` | 未提常量导出面变化 | `SIDEBAR_WIDTH_MAX` 被 `PANEL_WIDTH_CAP` + `maxPanelWidth()` 取代，保留会造成「两种上限口径并存」的歧义 | **删除该导出**（老测试的 import 随之调整）；新增 `AI_WIDTH_MIN/AI_WIDTH_DEFAULT/PANEL_RESIZE_STEP/PANEL_WIDTH_CAP/FALLBACK_VIEWPORT_WIDTH` |
| D-3 | `layoutState.ts:196-225` | §2.3「layoutPreview* 百分比函数用新值域不破预览图」 | 预览百分比是**纯函数**，新值域依赖视口 → 无法在不加参数的情况下同时满足「纯」与「动态」 | `previewSidebarPercent/previewLayoutOf` 加**可选 viewport 形参**（缺省取当前视口）；绘图区间端点 14%–30% 不变；jsdom 1024 → `240 → 20%`（原 19.3%） |
| D-4 | `layoutState.ts:521-545, 600-610` + `App.tsx:196-208` | 只要求「拖拽/滑杆越界钳制」与「≤ 总宽 30%」 | 预设整份套用（`applyPreset/resetLayout`）走 `commit` 而非 `validateLayout`，全新安装也无 validate → 窄窗口下预设 320 会**超 30%**；窗口缩小时已生效的宽度同样会超 | 加 **`normalizeLayout` 唯一夹紧闸**（`commit` 内）+ `reclampToViewport()` + App resize 监听 → 「≤30%」恒成立；代价 = jsdom(1024) 下预设常量 320 落 store 后为 307（老 round-trip/恢复默认断言随之写明） |
| D-5 | `t60-01-interaction.test.tsx:155-166` | 「老断言不许红」+ T60 ②「普通页行一律 FileText」 | R13 ④ 要求「有活子页的页显示 FolderSimple」——两者在「有子页的普通页」上**直接冲突**；老用例的 `pg-a` 正好有活子页 | 按 R13 ④ 优先（后单覆盖前单）：该用例改为「叶子页 FileText / 有子页 FolderSimple」，并保留「database 行 FolderSimple / wiki 行 Note / Wiki 分区头 Note」零回归断言 |
| D-6 | `SidebarTree.tsx:472-520` | §1.3 字面「列 全部活页（**page 类**）」 | 代码事实：wiki 页是**子页容器**（T42 子页索引），且 Wiki 分区按 `type` 而非 `parentId` 成根 → 把 wiki 排除会让「移入」在 wiki 容器上失效；`database` 行是集合视图（既有 `fullWidthItem/convertItem` 已对它特例） | 候选集取**非 database 活页**（page + wiki）− 自身 − 后代 + 「工作区根」；真机断言同时钉「排除多维数据行」 |
| D-7 | `SidebarTree.tsx:610-625` | §1.3「Menu 二级选择」 | `ui/Menu` 的外点关 = document `click`（T60 落地）。若「移入…」只替换 `items`，被点的按钮会被卸载 → target 脱离 root → **同一事件的 document 监听立刻把菜单关掉**（换列表即自灭） | 用 `key={inMovePick ? 'move' : 'main'}` **换 Menu 实例**（同宿主）：老实例在本次事件派发中被卸载，其 document 监听按 DOM 规范（removed 标记）跳过 → 不误关；同时新实例的 focus-first effect 重跑，键盘可达性不丢。真机 + 单测双证 |
| D-8 | `LayoutEditorPage.tsx:331-350` | §2.3 只说「T57 滑杆值域改动态」，未点名新增控件 | `ai.width` 是新增布局字段；T57 契约是「编辑器页承载全部字段」（`layout-ui.test` 有「迁移不丢参数」门禁）→ 无 UI 入口即缺口 | **新增 AI 宽度滑杆**（`layout-ai-width`，min 240 / step 10 / max 动态），并把它纳入既有「迁移不丢参数」断言 |
| D-9 | `layout/ResizeHandle.css` | §2.2「把手吃 ink-edge 2px 悬停反馈（T59 语法）」 | T59 已在侧栏右缘 / AI 面板左缘**恒存** 2px ink-edge 接缝条（红线：相邻边只画一次）→ 把手悬停的 2px 与它**同宽同色同位、视觉重合** | 把手只补「4px 命中区 + `cursor: col-resize`」，悬停绘 2px ink-edge（截图实证重合、无 4px 粗缝）；**不加粗**以免破 T59「2px 接缝」红线（若 PM 要更强的悬停反馈，需先开口该红线） |
| D-10 | `docs/mockups/screens-t52|t59|t60/*`、`docs/perf-history.jsonl` | — | 复跑老探针 / 全量测试按设计重写各自产物 | 非本单代码改动，如实登记（T59/T60 报告同口径先例） |

## 7. 未决 / 留给 PM

1. **拖入增强（任务书 §1.4）本单砍掉**（授权口径：「做不到稳就砍，DEVIATION 登记」）。依据（代码事实）：全仓唯一 HTML5 dnd 基建是 `tabs/TabsBar.tsx:92-93`（标签条排序，**侧栏树无任何可复用的行级 drop 层**）——探针 `grep` 已证 `SidebarTree.tsx` 内 `draggable/onDragStart` 命中 0。同能力已由「新建子页面 + 移入…（Menu 二级）」覆盖（真机实证）；若老板坚持要拖入手感，建议单开一单（需一并裁决与「行点击/Caret/右键/重命名」四路命中区的冲突）。
2. **把手悬停强度**（D-9）：若要「悬停明显加粗/变色」，需先裁决 T59「接缝 2px」红线是否在此处开口。
3. **移入目标集范围**（D-6）：现含 wiki 页（子页容器）；若 PM 要严格按任务书字面只列 `page` 类，改一行 filter 即可。
4. **AI 宽度与 `position='bottom'`**：任务书只要求「把手不挂」；面板置底时的高度仍是 token 派生定高（`--sc-layout-row-h × 8`），未做上下拖高——若需要属新需求。
5. **真机拖拽边界**：pointer capture 在「拖到窗口外松手」的路径未被 CDP 合成覆盖（合成事件不出窗口）；真浏览器语义由平台保证，jsdom 无 PointerEvent（测试用同类型名 MouseEvent 派发，已注释写明）。
6. **0.4.1 feed**：本单零协议/SCHEMA/sync 变更，验收后与 T60 一并并入。

## 8. DoD 自检

- [x] 拖左缘 DOM 实随（240→330，Δ=90 实测）+ 松手落盘（`localStorage.sidebar.width=330`）+ 重启还原（355→355）
- [x] 拖右缘 AI 宽实随（320→350，Δ=30）+ `ai.width` 落盘（350）+ 重启还原
- [x] 上限 = min(480, floor(vw×0.30))：视口 1184→355 拖到极限实测钳制（左/右各一条）；单测另覆盖「视口 1000→300」≥2 条
- [x] 新建子页面 → 子页 `parentId` = 该行 id → 父行图标 FileText `3/1/10` → FolderSimple `1/3/8`（与工作区头同族）
- [x] 移入… → 二级列表（防环：不含自身与后代）→ `movePage` 落库 → 树形变化（`pages.tree` 父指针 + DOM 缩进 `* 1`）+ 目标父页自动展开
- [x] 旧 v1 持久化 `ai.width` 兜底默认、**不判脏**（5 种形态单测）、不升版本号（`LAYOUT_VERSION` 恒 1）
- [x] 把手单测：pointer 拖拽 + 落盘 ≥3（4）、双击回默认 ≥1（1）、键盘 ≥2（2）、钳制 ≥2（2）、rAF 节流（1）、挂载条件（2）；layoutState 纯函数 ≥6（23）
- [x] desktop **844 ≥ 796+14 = 810**（+48）
- [x] 探针 `cdp-e2e-t61-01.mjs` **30 PASS / 0 FAIL**
- [x] 老探针零回归：T52 **23/0**、T59 **45/0**、T60 **32/0**
- [x] 双主题截图 **11 张** `screens-t61/`（≥5）+ 1184/894 零滚动复验
- [x] 真档案 untouched / electron 进程计数 = 0
- [x] 红线：零 `core|db|schema|sync|importer` 改动、零协议/SCHEMA 变更、packages/ui 零改动、不加依赖、不碰 git、无 TODO
- [x] 报告骨架开工第 2 步先建、倒数第 2 步填真实数字（本文件）

---

## 9. PM 复跑节（09-22 19:15~19:30，PM 实跑）

```
pnpm -C packages/ui exec vitest run:     Tests 148 passed (148)
pnpm -C packages/editor exec vitest run: Tests 200 passed (200)
apps/desktop（pretest→vitest）:          Test Files 63+11skip · Tests 727+19skip（node-ABI 口径；electron 口径 844=796+48，与申报一致）
pnpm -r typecheck: 9/9 Done · selftest: OK · no-magic: ✓ · build: ✓ 2.19s
四探针连跑（PM 逐支真跑，日志 _scratch/t61-pm-probes.log）:
  T61-01 = 30 PASS / 0 FAIL（新建，含拖左缘 240→330 实随、右缘 320→350、30% 钳制 1184→355、松手落盘+重启还原 355→355、滑杆 max=355@1184 联动、FolderSimple 像素签名 3/1/10→1/3/8）
  T60-01 = 32 PASS / 0 FAIL · T59-01 = 45 PASS / 0 FAIL · T52-01 = 23 PASS / 0 FAIL（老探针全数零回归）
红线核对：git status 改动全在 PRD 点名文件+测试+探针（零 packages/* 越界、零协议/SCHEMA 变更、无新依赖、无 TODO）；真档案 untouched；electron 计数=0
```

**追认（D-1~D-10 全过，三条点名表扬）**：
- **D-4 `normalizeLayout` 唯一夹紧闸 + resize 再钳**：任务书没想到的洞（窄窗口/预设套用会绕破 30%），工程师主动补闸——正确方向，追认。
- **D-7 Menu 二级换实例**：只换 items 会让按钮卸载→同一 click 被 document 监听判为外点→菜单自灭；`key` 换实例规避 + 单测真机双证。此坑极隐蔽，识别得准。
- **D-5 冲突裁决**：T60「普通页一律 FileText」与 R13④「有子页=FolderSimple」冲突，按后单覆盖前单改写老用例并保留其余零回归断言——口径正确。
- D-1~3/D-6/D-8~10 均系任务书前提修正类，逐条核实代码事实相符。
- **D-9 遗留开口**：把手悬停 2px 与 T59 恒存接缝视觉重合、反馈偏弱——不破线维持现状，**列入老板验货观察项**（要更强反馈需先开口 T59「接缝 2px」红线）。

**结论：T61-01 验收通过。R13 八条全部收口。**
