# TASK-T52-01 交付报告 · P1 布局融合三件（标签条并入编辑区 + 侧栏通高至菜单栏 + 折叠钮搬家）

> 工程师：CBL ｜ 前置：rc.27（tip `61c233c`，已 `git log -1` 确认）｜ 老板 09-21 原话
> 「4. 分页应与编辑区融合。5. 左侧边栏的高度应该贯穿直到触碰菜单栏，左侧边栏隐藏键应在编辑区分页上方靠左。」
> 改造前基线（`packages/ui`）：`AppShell.css` blob `1623e08`、`AppShell.tsx` blob `253d03b`。

---

## 0. 结论

三件全部落地并经**真机取证**（23 PASS / 0 FAIL；`realRoot untouched=true`；`window.close()` 优雅退出）：

| 面 | 结果（真机原始值） |
| --- | --- |
| ① 侧栏通高 | `.app-side` / `.sc-shell__sidebar` **top = 0**（= 内容区第 0 行 = 原生菜单下沿；窗口 chrome 高 65 ≥ 0 佐证菜单在 y<0）；侧栏高 735 = `innerHeight` 735（**不再被顶栏压掉 40px**）；顶栏左缘 240 = 侧栏右缘（**不再通栏横切**）；工作区名「个人工作区」就位侧栏头部首行 |
| ② 折叠钮搬家 | 钮中心 `x=260` ∈ `[tabsBar.left 248, 248+64]`、钮 24×24（§1.2 一个 24px 图标位）、`Δy(行中心) = 0.0px`；顶栏同名钮在编辑器视图 `display:none`（唯一入口）；**收起态钮仍在视口内**（`{x:8,y:46,w:24,h:24}`，可再点展开 240） |
| ③ 标签条融合 | `.tabsbar` 与活动标签 `border-bottom-width = 0px`（**无整行硬分隔线**）；活动标签底色 `rgb(255,255,255)` **= `.pv-root` 底色**（深色 `rgb(25,25,25)` 同构）；非活动标签沉 `surface rgb(241,240,239)`；活动标签下缘正下方 `elementFromPoint` 命中 `pv-root`（活动列「冒泡」进正文） |
| 红线 | 四宽度（1280/900/760/640）窗口**零滚动**（纵 + 横）且侧栏 top 恒 0；收起 = `.sc-shell__sidebar` 宽 **0**、`display:none`、主区占满 1184/1184；T33/T36 装订线 **70px**、gutter **12**、overlap **false** |

**全仓 `pnpm -r test` 与打包/安装包冒烟留 PM**（本单跑了 `apps/desktop` + `packages/ui` 两级测试、`pnpm -r typecheck`、双门禁、真机探针）。

---

## 1. 改动清单

### 1.1 ① 侧栏通高（`.sc-shell__body` 单一网格：侧栏跨两行 / 顶栏只占右列）

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/AppShell.tsx` | DOM 改为 `.sc-shell > .sc-shell__body > [`.sc-shell__sidebar`(aside) · `.sc-shell__topbar`(header) · `.sc-shell__main`(main)]`；**props API 逐字段零改动**（`breadcrumb/actions/sidebar/sidebarCollapsed/onToggleSidebar/children/className` 全保留，`onToggleSidebar` 语义不变——顶栏钮仍由本组件渲染，desktop 侧按视图用现有 `className` 接管显隐） |
| `packages/ui/src/AppShell.css` | `.sc-shell__body` = 唯一网格：列 `[var(--sc-layout-sidebar) \| 1fr]`、行 `[var(--sc-layout-topbar) \| 1fr]`；`.sc-shell__sidebar { grid-column:1; grid-row:1 / 3 }`（**跨两行 = 通高到内容区第 0 行**）；`.sc-shell__topbar { grid-column:2; grid-row:1 }`（**只覆盖右侧**）；`.sc-shell__main { grid-column:2; grid-row:2 }`；折叠态新增 `.sc-shell--collapsed .sc-shell__topbar { grid-column: 1 }`（与既有 main 同款，见 §4 D-9） |
| `apps/desktop/src/renderer/src/App.css` | `.app-side-head` 高 36px → `var(--sc-layout-topbar)`（侧栏头与右侧顶栏同一行高，两列 chrome 面横向分界对齐） |
| `apps/desktop/src/renderer/src/pages/SidebarTree.tsx` | 侧栏头部显示**真实**工作区名（`state.workspaces` 按 `workspaceId` 解析，未就绪回落 `t('sidebar.workspace')`）+ `data-testid="side-workspace"` |
| `apps/desktop/src/renderer/src/App.tsx` | 面包屑：`view === 'pages' && selectedId === null`（原本只显示工作区名）→ 顶栏左端**不再重复渲染工作区名**（名字常驻侧栏头部）；trash/settings/import/页面路径照旧 |

### 1.2 ② 折叠钮搬家（顶栏最左 → 标签条行最左）

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/renderer/src/App.tsx` | 新增 `sidebarToggle` 节点（`IconButton` + `SidebarSimple`，`aria-expanded` 随态翻转 + `data-testid="side-toggle"` + `class="app-tabrow-toggle"`，点击走**同一个** `toggleSidebar`）；编辑器视图给 AppShell 传 `className="app-shell--fused"`；标签条改为 `<TabsBar showTabs={tabsVisible} leading={sidebarToggle} />`（**总是渲染**） |
| `apps/desktop/src/renderer/src/App.css` | `.app-tabrow-toggle { width/height: var(--sc-space-xl) }`（24px 图标位）；`.app-shell--fused .sc-shell__topbar > .sc-iconbtn:first-child { display:none }`（编辑器视图隐藏顶栏同名钮，只留一处入口） |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` / `en-US.ts` | 新增 `app.collapseSidebar` / `app.expandSidebar`（收起/展开侧栏；两字典同构，受 `test/i18n.test.ts` 门禁①②约束） |

### 1.3 ③ 标签条与编辑区融合

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/renderer/src/tabs/TabsBar.tsx` | 新增可选 props `leading?: ReactNode`（行最左插槽）/ `showTabs?: boolean`（布局标签条显隐）；行宿主 `.app-tabrow` 承载「行」语义，`.tabsbar` 仍是可横滚标签列表并保 `role="tablist"` + `data-testid="tabsbar"`；无标签且无插槽 → 返回 `null`（T37/T39 口径不变） |
| `apps/desktop/src/renderer/src/tabs/TabsBar.css` | 行宿主 `.app-tabrow`（`flex:none` + canvas 底 + 定高 `control-sm + space-sm`）与 `.tabsbar`（`flex:1` + 既有 `overflow-x:auto` / `white-space:nowrap`）分层；**删掉 `.tabsbar` 的 `border-bottom`**（无横贯整行的硬分隔线）；活动标签 `background: var(--sc-color-content)`（= `.pv-root` 同 token → 连通无缝）；非活动标签 `background: var(--sc-color-surface)`，hover/按压 `surface-active`；插槽 `.tabsbar-leading { position: sticky; left: 0; align-self: center }`（横滚时钮不移位）；× 的 hover 底 `surface-raised` → `surface-active`（白色活动标签上原 hover 不可见） |

### 1.4 层测

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/test/layout-fusion-t52.test.tsx` **（新）** | 12 例：① AppShell.css 结构契约（侧栏跨行 / 顶栏右列 / 主区第 2 行 / 折叠态三件套含 topbar 回列 / 侧栏头同高）；② TabsBar 插槽契约（插槽是 `.tabsbar` 首子元素；隐藏标签条时行与钮仍在；无标签无插槽不渲染）；③ 融合契约（`.tabsbar` 无 border-bottom、活动标签 = content、非活动 = surface、`.pv-root` 同 token、行宿主 flex:none+canvas）；④ App 接线（`app-shell--fused` + 钮落在标签行内且全页唯一 + 切设置页类摘除；工作区名在侧栏头部、无选中页时顶栏左端为空）。**既有 4 个测试文件零改动**（AppShell/tabs/layout-ui/layout-invariants 全绿） |

---

## 2. 数值化验收（原始值）

### 2.1 `pnpm -C apps/desktop test`

```
 Test Files  59 passed (59)
      Tests  663 passed (663)
```

基线 651 → **663（+12）**（新增 `layout-fusion-t52.test.tsx` 12 例）；要求 ≥651 ✓。
（`packages/ui` 同跑：`28 files / 79 tests passed`——AppShell 结构改造后既有 4 例零改动全绿。）

### 2.2 `pnpm -r typecheck`

```
9/9 包 typecheck: Done（packages/{core,platform,ui,dbview,editor,schema,sync,importer} + apps/desktop）
```

### 2.3 双门禁

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px      （exit 0）
✓ token 产物与 DESIGN.md 一致                           （exit 0）
```

### 2.4 真机取证 `docs/mockups/cdp-e2e-t52-01.mjs`

```
===== T52-01：23 PASS / 0 FAIL =====
realRoot untouched=true            （夹具自检：C:\Users\Administrator\.septcats mtime 前后一致）
退出：window.close() 优雅退出（forced=false）
```

| 断言 | 原始值摘要 |
| --- | --- |
| G0-1 夹具 | 真点「新建页面」×3 → `tabs=3 pages=3` |
| G1-1 §2① 侧栏顶到菜单下沿 | `sideTop=0 asideTop=0 nativeChromeH=65`（outerH 800 − innerH 735） |
| G1-2 通高 | `sideHeight=735 innerHeight=735` |
| G1-3 顶栏不通栏 | `topbarLeft=240 sidebarW=240 topbarRight=1184 winW=1184` |
| G1-4 顶栏钮隐藏 | `shellBtnDisplay=none` |
| G2-1 §2② x 区间 + 24px 位 | `btnCenterX=260 barLeft=248 barRight=1176 btnW=24` |
| G2-2 §2② y 对齐 | `btnCenterY=58 barCenterY=58 Δ=0.0`（参考：与活动标签中心 Δ=4.0 —— 见 D-7） |
| G3-1 §2③ 无分隔线 | `barBorderBottom=0px activeBorderBottom=0px` |
| G3-2 §2③ 贴色值 | `activeBg=rgb(255,255,255) = pvBg`（`barBg=rgb(249,248,247)`） |
| G3-3 非活动沉 surface | `inactiveBg=rgb(241,240,239)` |
| G3-4 冒泡进正文 | 活动标签下缘 `+1px` 命中 `"pv-root"`（`barBottom=76 = pvTop`） |
| G4-1 §2④ 四宽度零滚动 | `1280:{h 800/800,w 1280/1280} 900:{…} 760:{…} 640:{…}` 全等 |
| G4-2 侧栏 top 恒 0 | `1280/900/760/640 → top=0`（侧栏宽 240 不变） |
| G5-1 §2⑤ 收起 0px | `width=0 display=none appSideVisible=false mainW=1184 winW=1184` |
| G5-1b 顶栏同步占满 | `topbarLeft=0 topbarRight=1184`（防隐式列，见 D-9） |
| G5-2 收起态钮可达 | `btnRect={x:8,y:46,w:24,h:24} inViewport=true` |
| G5-3 再点展开 | `width=240 display=block` |
| G6-1 T33 装订线 | `bodyPaddingLeft=70px` |
| G6-2 T33/T36 gutter | `gutter=12 overlap=false cluster=58×28` |
| G7-1 「无标签」态 | `{tabsbar:false,row:true,toggle:true}`（隐藏标签条后行与钮仍在） |
| G7-2 窗口级截屏 | `44162 B`，rect `1220×885`（含标题栏 + 原生菜单栏） |
| G7-3 深色同构 | `activeBg=rgb(25,25,25) = pvBg`、`barBorder=0px` |
| G8-1 退出 | `{gracefulExited:true, forced:false}` |

> 说明：§2 五条断言全在；另有 G1-2/G1-3/G1-4/G3-3/G3-4/G5-1b/G6 为红线与自证补充（见 §4 D-9）。

---

## 3. 截图（`docs/mockups/screens-t52/`，9 张）

| 文件 | 内容 |
| --- | --- |
| `t52-01-light-tabs.png` / `t52-01-dark-tabs.png` | 浅/深 × **有标签**：侧栏顶到内容区顶、顶栏只在右侧、`[≡]` 在标签行最左、活动（第 3 个）标签白底与正文连通 |
| `t52-01-light-notabs.png` / `t52-01-dark-notabs.png` | 浅/深 × **无标签**（布局「标签条」关闭）：`.tabsbar` 不渲染、行与 `[≡]` 仍在、正文与行之间无色带断裂 |
| `t52-01-light-collapsed.png` / `t52-01-dark-collapsed.png` | 浅/深 × **侧栏收起**：侧栏 0px、主区占满、`[≡]` 仍在编辑区左上（可达） |
| `t52-01-window-light-full.png` | 窗口级补充：**标题栏 `Septcats` + 原生菜单栏「文件 编辑 视图 帮助」**，其下即侧栏首行「个人工作区」→ 直观证明「侧栏顶到菜单栏下沿」 |
| `t52-01-light-tabrow-zoom.png` / `t52-01-dark-tabrow-zoom.png` | 标签行 3× 放大（dsf=3）：`[≡] │ 灰标签 · 灰标签 · 白标签(连通正文)`、行内无横线、非活动沉 surface（深色下同 token 关系反转：非活动更亮、活动 = 正文色） |

---

## 4. DEVIATION（待 PM 追认）

| ID | 偏差 | 原因与影响 |
| --- | --- | --- |
| **D-1** | 「工作区名移进侧栏头部」落到实处：侧栏头显示**真实**工作区名并抬高到 40px 与顶栏行对齐；顶栏左端只在「无选中页且非回收站」时不再渲染面包屑（页面路径/回收站/设置/导入标题照旧保留） | §1.1 要求「顶栏只剩右侧功能区」。面包屑同时承载页面祖先链（T22-01）与回收站/设置/导入视图标题，整体删除会丢功能；故只摘掉「只剩工作区名」这条重复项（纯函数 `pagesBreadcrumbItems` 与其测试零改动，`trash-ui.test.tsx` 5 例不受影响） |
| **D-2** | 折叠钮只在**编辑器视图**搬到标签行；设置/导入/回收站/搜索视图仍显示顶栏自带钮 | 那些视图没有标签条行。若也搬走，收起态在非编辑器视图只剩原生菜单一条入口（T30-01「收起后仍可达」红线）；两处入口是**互斥显隐**（`.app-shell--fused` 只在编辑器视图挂），同屏永不同时出现 |
| **D-3** | 顶栏钮的隐藏用 desktop 侧 CSS（`.app-shell--fused` + AppShell 既有 `className` prop），而非删组件或给 AppShell 加 prop | 任务书 §3：**AppShell props API 零改动**。这样 `packages/ui/src/AppShell.test.tsx` 4 例（含「折叠按钮 label/aria-expanded 翻转」）逐字不动即绿，ui 包零测试改动 |
| **D-4** | `TabsBar` 新增可选 props `leading` / `showTabs`（desktop 侧组件，非 AppShell 红线区）；无标签时仅当给了 `leading` 才渲染行宿主（否则仍返回 `null`） | 任务书要求钮在「标签条行最左」且收起态可达，而既有口径是「全关/隐藏标签条 → `.tabsbar` 不渲染」（`tabs.test.tsx` / `layout-ui.test.tsx` 4 处断言）。解法=行宿主 `.app-tabrow` 与列表 `.tabsbar` 分层：列表口径逐字不变，钮常驻行内。既有 `<TabsBar />` 无 props 调用路径 DOM 只多一层透传 div |
| **D-5** | 「无整行硬分隔线」= 删除 `.tabsbar` 的 `border-bottom`（边界改为 canvas→content 色差）；同时按 §1.3 把**非活动标签**底色由「透明（canvas）」改为 `surface` 灰底，并把 `×` 的 hover 底由 `surface-raised` 改 `surface-active` | §1.3 明示「非活动标签沉 surface 灰底」；改底后会与 `.tabsbar-tab:active` 撞档，故 hover/按压统一到 `surface-active`（调色板里比 surface 更深的一档；4 态仍可辨）。`×` 的 hover 原本是白底，在白色活动标签上不可见，改灰底保证四态可见 |
| **D-6** | 折叠钮用 `--sc-space-xl`（24px）图标位；其 hover/按压底沿用 `IconButton` 既有 `--sc-color-surface` | §1.2 明写「一个 24px 图标位」，故不沿用 IconButton 默认 28px；不新增任何按钮观感 token（像素风属 T53） |
| **D-7** | 钮中心 y 对齐「标签条**行**中心」（实测 Δ=0.0px），与「活动标签**元素**中心」差 4.0px | 标签为 `align-items: flex-end`（底对齐）才能让活动标签白底一路贴到行底、与正文连通（§1.3 的连通性依赖它）。若为凑元素中心而让标签垂直居中，活动标签底部会与正文之间出现 canvas 缝。§2② 口径为「标签行中心」，实测 0.0 ✓；两个差值均在 results.json 留档 |
| **D-8** | 侧栏头显示真实工作区名（`state.workspaces` 解析，未就绪回落 i18n）；`.app-side-head` 高 36px → `var(--sc-layout-topbar)` | 原实现是写死的 i18n 文案（改名后与真实工作区名不符）；§1.1 要求「工作区名（现顶栏左侧『个人工作区』）移进侧栏头部」，取真值才名副其实。测试夹具里工作区名同为「个人工作区」，既有 `sidebar-tree.test.tsx` 文案断言不受影响 |
| **D-9** | 真机探针在任务书 5 条外**自增 2 条红线断言**（G5-1b 顶栏同步占满、G2-1 钮宽=24px），并新增 G1-2/G1-3/G1-4/G3-3/G3-4/G6 自证项 | **首轮探针实测揪出真缺陷**：折叠态只有 `.sc-shell__main` 回第 1 列，而 `.sc-shell__topbar` 仍 `grid-column: 2` → CSS Grid 生成**隐式列**，主区被挤成 894/1184（顶栏跑到右侧）。修法=补 `.sc-shell--collapsed .sc-shell__topbar { grid-column: 1 }`，并把两条真实数值钉进层测（`layout-fusion-t52` 的折叠态用例）与探针（G5-1b） |
| **D-10** | 截图 9 张 > 任务书 6 张：+1 窗口级（含原生菜单栏）+2 标签行 3× 放大 | 原生菜单栏**不在 web contents 内**，`page.screenshot()` 拍不到 —— 「侧栏顶到菜单下沿」这条老板原话只有窗口级像素能直证（做法同 T51-01 D-7：main 进程 `--inspect` 置顶 + `desktopCapturer`，不改产品代码）。3× 放大图供 PM 目检「融合」这一老板主观项 |
| **D-11** | `docs/perf-history.jsonl` 出现改动 | perf 测试的追加写入副作用，非本单编辑；本单不碰 git，未回滚（同 T51-01 D-8） |

---

## 5. 未决 / 遗留（交 PM）

1. **T36 复验范围**：本单按任务书复验了 T33/T36 共用的装订线几何（`.pv-body` 70px + gutter 12 + overlap=false），未复跑 T36 的「手柄首行对齐 deltaCenterY=0 / 换型不跳」（本单未触碰该路径，`packages/editor` 零改动）。
2. **ARIA 纯度取舍**：`role="tablist"` 的 `.tabsbar` 内首个子元素是折叠钮插槽（`span > button`，非 `role="tab"`）。仓内无 axe / a11y 门禁，未做自动化校验；键盘可达性（Tab 聚焦 + Enter 触发）由按钮本体保证。
3. **非编辑器视图的收起入口**：设置/导入/回收站/搜索视图收起侧栏后，UI 入口只有顶栏钮（维持原状）+ 原生菜单「视图→折叠侧栏」；编辑器视图为标签行钮 + 原生菜单。
4. **「无标签」截图口径**：取「布局→标签条」关闭（正文仍在，便于目检行/正文边界）；「全关所有标签」态另由层测覆盖（行与钮仍在，`.pv-empty` 空态口径不变）。
5. **T44 反链面板 / T42 Wiki 分区滚动归属**：侧栏通高后内部仍是「头（40px 定高）+ `.app-side-scroll`（flex:1 + overflow-y:auto）+ 底行」三件，滚动只发生在 `.app-side-scroll`；四宽度窗口零滚动实测 ✓，未改分区结构。
6. 全仓 `pnpm -r test` / 打包 / 安装包冒烟：留 PM（本单已跑 `apps/desktop` + `packages/ui` + typecheck + 双门禁 + 真机）。

---

## 6. PM 复跑节

（留空——由 PM 复跑后填写）

```
pnpm -C apps/desktop test                        →  ？
pnpm -C packages/ui test                         →  ？
pnpm -r typecheck                                →  ？
node packages/ui/tokens/no-magic.mjs             →  ？
node packages/ui/tokens/build-tokens.mjs --check →  ？
pnpm -C apps/desktop build && node docs/mockups/cdp-e2e-t52-01.mjs →  ？
```


## §PM 复跑（2026-09-21，独立）—— **23 PASS / 0 FAIL**

全仓 `pnpm -r test` 无红（desktop **663** / dbview 122 / importer 59 / …）；typecheck 0 error；双门禁 ✓；`SELFTEST OK`。
真机独立复跑关键原始值（与 CB 报告逐位吻合）：
- §2① **侧栏通高**：`sideTop=0`、`sideHeight=735=innerHeight`、`topbarLeft=240=侧栏右缘`（顶栏不再通栏）、原生 chrome 高 65 佐证菜单在 y<0
- §2② **折叠钮搬家**：`btnCenterX=260∈[248,312]`、`btnW=24`、`btnCenterY=58 barCenterY=58 Δ=0.0`（D-7 口径追认：与活动标签元素中心差 4px 系底对齐连通的必要代价，接受）
- §2③ **融合**：`barBorderBottom=0px activeBorderBottom=0px`、活动标签 `rgb(255,255,255)`=`pvBg`、非活动 `rgb(241,240,239)`(surface)、下缘 `elementFromPoint` 命中 **pv-root**（冒泡成立）
- 红线：四宽度零滚动、收起 `width=0 display:none` 主区占满、装订线 70/gutter 12/overlap false 全复验
- `realRoot untouched=true`、优雅退出

**DEVIATION 追认（D-1~D-11 全部）**：D-1（面包屑只摘「只剩工作区名」重复项，页面路径/回收站标题保留）与 D-2（钮只在编辑器视图搬，非编辑器视图顶栏钮互斥显隐）为正确的功能保全取舍；D-3 AppShell props 零改动经 git diff 复核属实；**D-9 首轮探针揪出折叠态隐式列真缺陷（主区挤成 894）并修复+钉测——本轮折叠态断言在 PM 复跑中同绿**。D-11 perf-history 副作用与 T51 同口径，不计。
老板主观项「融合感」：9 张截图含 2 张标签行 3× 放大供目检，留 rc.28 复测时老板亲验。
