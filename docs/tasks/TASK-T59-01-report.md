# TASK-T59-01 报告 · P2 主区域像素风黑色边框

> 状态：**完成**（探针 45/0 全绿；T52/T57 老探针复跑零回归；desktop 783 ≥ 775）
> 基线：0.4.0（tag v0.4.0）；批次 **R12 第一单**
> 设计真源：仓库根 `DESIGN.md`（新增 `## Pixel Borders（T59-01）` 小节 + 新 token `ink-edge`）
> 探针：`docs/mockups/cdp-e2e-t59-01.mjs` → `docs/mockups/screens-t59/`（11 张 png + results.json）

## 1. 交付摘要

老板 09-22 晚点名「软件内部若能加上像素风的黑色边框就更好了（侧边栏、编辑区等）」落地为**区域边界语法**：

1. **新 token `--sc-color-ink-edge`**：浅色 `#1A1A1A`（黑边）/ 深色 `#EDEDED`（亮边）。深色取亮边的原因写进 DESIGN.md（近黑底 `#141414`/`#0A0A0A` 上黑描边对比度 ≈1.05 = 不可见；边界的语义是「结构分界」，靠与相邻面的明度差成立，不靠"黑"这个色相）。**深色=亮边属老板终审项**。
2. **五处主区域边界 2px**：顶栏下沿 / 侧栏右缘 / 编辑区顶边 / AI 面板左缘 / AI 面板置底顶边 —— 全部 `2px` ink-edge，**接缝归属显式定死、相邻边只画一次**（像素实测无 4px 双拼）。
3. **T52 骑缝融合（本单最大风险，已过）**：正文顶边 2px 黑线在**活动标签处断开** —— 活动标签 = 编辑区底色 + ∏ 形（顶/左/右）2px 轮廓 + 下缘下沉 2px 压住该描边、下缘无缝（NES 窗口标题签观感）。像素采样：活动标签中心处 = 编辑区底色（非黑）✓，其右侧空白处 = ink-edge ✓。
4. **浮层族统一 `2px ink-edge`**：ui 组件层 6 个浮层（Dialog / Menu / Popover / Tooltip / Select 下拉 / Toast）+ 模态 2 个（CloseAskDialog / LayoutPicker）。
5. **控件不加黑边**：按钮 / 输入框 / 开关 / 数据卡等单位控件保持 1px hairline + bevel 立体（不动清单）。

真机证据链：线宽像素实测 **= 2**（浅/深两主题 × 侧栏/顶栏/正文三条接缝 + AI 面板左缘 + 模态左缘）、接缝采样、rect 重叠、双主题 11 张截图、1184/894 零滚动、真档案 mtime 前后一致。

## 2. 改动清单

### 2.1 文档

| 文件 | 变更 |
|---|---|
| `DESIGN.md` | ① front matter `colors` 新增 `ink-edge: "#1A1A1A"`；② 「深色主题映射」表新增 `ink-edge #1A1A1A → #EDEDED` 行（含深色亮边理由）；③ `## Colors` 新增 ink-edge 语义条；④ 新增 **`## Pixel Borders（T59-01）`** 小节：ink-edge 语义 / 2px 宽度谱 / 深色亮边口径与原因 / **接缝归属表**（五条边 → 画线者 → 线型）/ 接缝条不得占盒的规则 / **T52 标签融合规则** / 浮层族统一 / 不动清单 |
| `docs/PROJECT_PLAN.md` | §16 追加**第 11 条决议**「R12 像素边框」（2026-09-22 老板晚点名）→ 落点单 T59-01 |

### 2.2 token（生成物，勿手改）

| 文件 | 变更 |
|---|---|
| `packages/ui/tokens/`（无改动） | 构建脚本未动 |
| `packages/ui/src/tokens.css` | 新增 `--sc-color-ink-edge: #1A1A1A;`（`:root` L28）与 `--sc-color-ink-edge: #EDEDED;`（`[data-theme="dark"]` L126）—— 由 `build-tokens.mjs --write` 生成 |
| `packages/ui/src/tokens.ts` | `colors["ink-edge"] = "#1A1A1A"` / `colorsDark["ink-edge"] = "#EDEDED"`；`COLOR_NAMES` 末尾追加 `'ink-edge'`（23 → 24 枚） |

### 2.3 CSS（主区域边界）

| 文件:行 | 变更 |
|---|---|
| `packages/ui/src/AppShell.css:30` | `.sc-shell__topbar` `border-bottom: 1px hairline` → **`2px solid var(--sc-color-ink-edge)`** |
| `packages/ui/src/AppShell.css:53` | `.sc-shell__sidebar` `border-right: 1px hairline` → **右缘 2px 定位接缝条**（`position: relative` + `::after { right:0; top:0; bottom:0; width:2px; background: ink-edge; pointer-events:none }`）—— 见 DEVIATION-3 |
| `apps/desktop/src/renderer/src/App.css`（`.app-editor-col .pv-root`） | 新增 **`border-top: 2px solid var(--sc-color-ink-edge)`**（原无描边 → 只增不改；左/右/下不补 —— 只画一次） |
| `apps/desktop/src/renderer/src/App.css`（`.app-main-row--ai-bottom .ai-chat`） | `border-top: 1px hairline` → **`2px solid ink-edge`**（`border-left: 0` 不变） |
| `apps/desktop/src/renderer/src/ai/AiChatPanel.css:16` | `.ai-chat` `border-left: 1px hairline` → **`2px solid ink-edge`** |
| `apps/desktop/src/renderer/src/tabs/TabsBar.css`（`.app-tabrow` / `.tabsbar` / `.tabsbar-tab` / `.tabsbar-tab--active`） | **T52 骑缝几何**（见 2.5） |
| `apps/desktop/src/renderer/src/App.css`（`.app-tabrow-toggle`） | 新增 `align-self: center`（行宿主改 `flex-start` 后兜住直挂折叠钮的居中，几何不变） |

### 2.4 CSS（浮层族统一）

| 文件 | 变更 |
|---|---|
| `packages/ui/src/Dialog.css` | `.sc-dialog` `1px hairline` → **`2px ink-edge`** |
| `packages/ui/src/Menu.css` | `.sc-menu` 同上 |
| `packages/ui/src/Popover.css` | `.sc-popover__panel` 同上 |
| `packages/ui/src/Tooltip.css` | `.sc-tooltip__bubble` 同上（§1.4「tooltip 类小浮层」） |
| `packages/ui/src/Select.css` | `.sc-select__listbox` 同上（§1.4「下拉类小浮层」） |
| `packages/ui/src/Toast.css` | `.sc-toast__item` 同上（浮层族统一；见 DEVIATION-4） |
| `apps/desktop/src/renderer/src/close/CloseAskDialog.css` | `.close-ask` `2px hairline-strong` → **`2px ink-edge`**（宽度谱不变，换色源） |
| `apps/desktop/src/renderer/src/layout/LayoutPicker.css` | `.layout-picker` 同上 |

### 2.5 CSS（T52 骑缝融合，本单最大风险）

| 文件 | 变更要点 |
|---|---|
| `tabs/TabsBar.css` | `.app-tabrow` `align-items: center → flex-start`（给标签条预留 2px 骑缝探出带） |
| | `.tabsbar`：`height: calc(100% + var(--sc-space-xxs))` + `padding-bottom: var(--sc-space-xxs)`（盒下沿探出本行 2px，**该 2px 划进裁剪安全带**故活动标签下沉不被 overflow 剪掉；内容盒仍 36px → 标签基线/插槽中心/横滚几何一字不动）；`background: canvas → transparent`（否则本层涂掉下方，正文顶边无法显形） |
| | `.tabsbar-tab`：新增 `border-left: 2px solid ink-edge`（**只吃左描边** → 相邻两枚恰好 2px，不叠成 4px） |
| | `.tabsbar-tab--active`：新增 `margin-bottom: calc(var(--sc-space-xxs) * -1)`（下沉 2px 压住正文顶边）+ `border-top/right: 2px solid ink-edge`（∏ 形轮廓，下缘无边）+ `position: relative; z-index: 1`（否则 `.pv-root` 的顶边会盖住标签底色）+ `height: calc(control-sm + 2px)`（同顶、只多探 2px） |

### 2.6 测试与探针

| 文件 | 变更 |
|---|---|
| `packages/ui/test/borders-t59.test.ts` | **新增**（11 用例）：ink-edge 双主题锚定 / tokens.css 落位 / 与 ink 同值但独立 token / AppShell 两处边界 / 浮层族 6 个 / 控件零 ink-edge / css-discipline 口径 / 宽度谱 |
| `apps/desktop/test/borders-t59.test.tsx` | **新增**（13 用例）：apps 侧三处边界 / 只画一次（行宿主与标签条零下描边、编辑列不补左右）/ 骑缝几何（探出带、下沉、∏ 轮廓、提层、非活动只吃左描边）/ TabsBar 结构 / 模态 2px / 控件不动清单 |
| `apps/desktop/test/layout-fusion-t52.test.tsx` | **追加**「④ T59-01 追加」3 用例：正文顶边归属唯一 / 活动标签下沉压缝 + 下缘无边 / 非活动标签只吃左描边 |
| `docs/mockups/cdp-e2e-t59-01.mjs` | **新增**真机探针（45 断言，见 §4.3） |
| `docs/mockups/screens-t59/` | 11 张截图 + `t59-01-results.json` |

### 2.7 复跑老探针产生的产物改动（非本单代码改动）

- `docs/mockups/screens-t52/*`、`docs/mockups/screens-t57/*`（含各自 results.json）：为取证「老断言零回归」**重新执行** `cdp-e2e-t52-01.mjs` / `cdp-e2e-t57-01.mjs`，两探针按设计重写自己的截图与结果 JSON（证据见 §4.4）。
- `docs/perf-history.jsonl`：desktop 全量测试（`perf.test.ts`）按设计追加一行基线。

## 3. 每文件 diff 要点

- **DESIGN.md**：唯一 token 源先行改动（token 段落 + 深色表 + 新语法小节）。新小节把「谁画哪条边」写成表 —— 这是本单防止 4px 双拼的契约来源；同时写明接缝条**不得占盒模型**的理由（侧栏这类通高容器用 border 会压窄内层）。
- **tokens.css / tokens.ts**：纯生成物，未手改（`--check` 保证一致）。`cols` 顺序把 `ink-edge` 排在颜色组末尾，浅深两值均为 6 位 hex。
- **AppShell.css**：顶栏保留 border（其内容为居中工具钮，2px 仅使内容盒 −2px，无既有契约依赖）；侧栏改定位条（见 DEVIATION-3）。两处均带 T59-01 注释说明归属。
- **App.css**：`.app-editor-col .pv-root` 只加 `border-top`（不加 `border` 简写 —— 会四边齐画并与侧栏/AI 面板接缝叠成 4px）；`.app-main-row--ai-bottom .ai-chat` 换色源；`.app-tabrow-toggle` 补 `align-self: center`。
- **AiChatPanel.css**：仅换 `border-left` 的宽度与色源（面板总宽仍 320px；`border-left: 0` 的置底分支不变）。
- **TabsBar.css**：见 2.5 —— 每处改动都标注了「为什么不能用更朴素的写法」（overflow 裁剪切带、提层必要性、只吃左描边）。
- **浮层族 8 文件**：一律单行 `border` 替换，无几何/圆角改动（`box-sizing: border-box` 下总尺寸不变，浮层尺寸本就由 width/padding 决定）。
- **测试**：新用例只读磁盘 CSS 规则文本（vitest `css:false` 口径），不渲染外部样式表；两条既有 T52 融合断言（活动标签 `background: content`、`.tabsbar` 无 border-bottom）**逐字未动**，只在同文件追加新用例。

## 4. 命令与完整输出

### 4.1 token 落地三绿

```
$ cd packages/ui && node tokens/build-tokens.mjs --write
✓ 已写入 src/tokens.css 与 src/tokens.ts（源：../../DESIGN.md）

$ node tokens/build-tokens.mjs --check
✓ token 产物与 DESIGN.md 一致

$ node tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

`contrast.test.ts` 随 ui 全量跑绿（见 4.2）；新增 token 只进色板、不动门禁配对表，最差对仍为浅色 `ink-faint/surface` 4.55。

### 4.2 单测 / 类型

```
$ cd packages/ui && npx vitest run
 Test Files  31 passed (31)
      Tests  144 passed (144)          ← 基线 133，本单 +11

$ cd apps/desktop && npx vitest run
 Test Files  70 passed (70)
      Tests  783 passed (783)          ← 基线 767，本单 +16（borders-t59 13 + layout-fusion-t52 追加 3）
                                        ← 验收线 ≥775 ✓（余量 8）

$ pnpm typecheck
 packages/{core,platform,ui,editor,dbview,schema,sync,importer} + apps/desktop = 9/9 Done
```

### 4.3 真机探针 `cdp-e2e-t59-01.mjs`（本单验收锚）

```
$ node docs/mockups/cdp-e2e-t59-01.mjs
INFO  [boot] 夹具  — UD=E:\Hermes Agent工作空间\_scratch\t59-01\ud ROOT=...\_scratch\t59-01\data
INFO  [boot] electron 进程（开跑前）  — 0
PASS  [G0|fixture] G0-1 夹具成立：真点「新建页面」×2 + 键入正文两段 → 2 标签 / 2 存活页  — tabs=2 pages=2
PASS  [G0|fixture] G0-2 浅色主题就位（夹具 settings.theme=light）  — data-theme=light
PASS  [G1] G1-1[light] 顶栏下沿 = 2px 实线 + ink-edge 色（#1A1A1A）  — topbar.bottom=2px solid rgb(26, 26, 26)
PASS  [G1] G1-2[light] 侧栏右缘 = 2px ink-edge 接缝条（定位条口径：不占盒模型 —— .app-side 仍 240）
      — seam={"width":"2px","height":"735px","bg":"rgb(26, 26, 26)","right":"0px","pointerEvents":"none"}
PASS  [G1] G1-3[light] 编辑区顶边（.pv-root）= 2px ink-edge，且编辑列不自画左右描边（只画一次）
      — pv.root top=2px solid rgb(26, 26, 26) left=0px none … right=0px none …
PASS  [G1] G1-4[light] 标签条行宿主/标签条零下描边（接缝归 .pv-root 独占，禁 4px 双拼）
INFO  [G2] light 像素线宽（原始）
      {"sidebar":{"size":{"w":16,"h":40},"exact":2,"near":2,"exactIdx":[6,7]},
       "topbar":{"size":{"w":40,"h":16},"exact":2,"near":2,"exactIdx":[6,7]},
       "seam":{"size":{"w":40,"h":16},"exact":2,"near":2,"exactIdx":[8,9]}}
PASS  [G2] G2-1[light] 像素实测：侧栏右缘纵向整列纯 ink 像素 = 2（非 4）
PASS  [G2] G2-2[light] 像素实测：顶栏下沿横向整行纯 ink 像素 = 2
PASS  [G2] G2-3[light] 像素实测：编辑区顶边横向整行纯 ink 像素 = 2（活动标签之外的空白处）
INFO  [G3] light 骑缝几何（原始）
      activeRect={x:347,y:48,w:73,h:30,bottom:78} pvRect={x:240,y:76,w:944,…} overlapPx=2
      activeBorder=2px/2px/0px/2px  activeBg=rgb(255,255,255)  pvBg=rgb(255,255,255)
INFO  [G3] light 接缝像素采样（原始）  activePx=[255,255,255]  blankPx=[26,26,26]   ink=rgb(26,26,26)
PASS  [G3] G3-1[light] 接缝采样：活动标签中心处像素 = 编辑区底色（非 ink-edge）→ 接缝在此断开
PASS  [G3] G3-2[light] 接缝采样：活动标签右侧空白处像素 = ink-edge → 接缝在其余处可见
PASS  [G3] G3-3[light] 骑缝几何：活动标签盒与 .pv-root 顶边重叠/贴边（rect 实测 ≥2px）  — 2px
PASS  [G3] G3-4[light] 活动标签 ∏ 轮廓：顶/左/右 2px、下缘 0px、底色 = 编辑区底色
PASS  [G3] G3-5[light] T57 G8-4 复跑：标签连通（无整行分隔线 + 活动标签无下描边 + 底同色 + 下缘命中 pv-root）
      — below="pv-root"
PASS  [G4] G4-1 T52 红线：侧栏通高（top=0 / 宽 240 / 原生菜单 chrome 高 65）
PASS  [G4] G4-2 T52 红线：顶栏左缘 = 侧栏右缘  — topbarLeft=240 sidebarW=240
PASS  [G4] G4-3 T52 红线：折叠钮在标签行最左  — centerX=260 barLeft=248 Δy=1.0 w=24 inViewport=true
PASS  [G4] G4-4 T33/T52 红线：装订线 70px + gutter=12 无重叠
PASS  [G5] G5-1 §3：1184/894 两宽度零滚动（纵向 + 横向）且侧栏 top 恒 0
      — 1184:{h 800/800,w 1184/1184,top=0} 894:{h 800/800,w 894/894,top=0}
PASS  [G6] G6-1 §1.4 模态外轮廓 = 2px solid ink-edge  — borderTop=2px solid rgb(26, 26, 26)
PASS  [G6] G6-2 §1.4 模态左缘像素实测整列纯 ink = 2
PASS  [G6] G6-3 §1.8 AI 面板可展开（截图四态之一）
PASS  [G6] G6-4 §1.2 AI 面板左缘 = 2px solid ink-edge  — width=320
PASS  [G6] G6-5 §1.2 AI 面板左缘像素实测整列纯 ink = 2
INFO  [G7] dark ink-edge（原始）  {"hex":"#EDEDED","rgb":[237,237,237]}
PASS  [G7] G1-1..G1-4[dark]（同上四处，色值 rgb(237, 237, 237)）
PASS  [G7] G7-2 §1.1 深色口径：ink-edge = #EDEDED（亮边）
PASS  [G7] G2-1..G2-3[dark] 三条接缝像素线宽 = 2
INFO  [G7] dark 接缝像素采样  activePx=[10,10,10]（= content #0A0A0A）  blankPx=[237,237,237]（= ink-edge）
PASS  [G7] G3-1..G3-5[dark] 骑缝五断言（含 T57 G8-4 复跑 below="pv-root"）
PASS  [G7] G7-3 T52 红线（深色）：折叠钮位置/尺寸/视口内不变
PASS  [G7] G7-4 深色 1184 零滚动
PASS  [G7] G7-5/G7-6 深色模态 2px（computed + 像素）
PASS  [G7] G7-7 窗口级补充截图（含标题栏 + 原生菜单栏）  — bytes=61205
INFO  [teardown] electron 进程计数（退出前后）  {"before":5,"after":0}
PASS  [G9-1] 退出干净：window.close() 优雅退出（未强杀）  {"gracefulExited":true,"forced":false}
PASS  [G9-2] 交付纪律：退出后 electron 进程计数 = 0

===== T59-01：45 PASS / 0 FAIL =====
realRoot untouched=true  electron 最终计数=0
results -> docs/mockups/screens-t59/t59-01-results.json
```

隔离自检原文：

```json
"isolation": {
  "realRoot": "C:\\Users\\Administrator\\.septcats",
  "realRootMtimeBefore": "1789991614995.1055",
  "realRootMtimeAfter":  "1789991614995.1055",
  "untouched": true
}
```

### 4.4 老探针复跑（红线零回归的独立证据）

```
$ node docs/mockups/cdp-e2e-t52-01.mjs
===== T52-01：23 PASS / 0 FAIL =====     realRoot untouched=true

$ node docs/mockups/cdp-e2e-t57-01.mjs
===== T57-01：28 PASS / 0 FAIL =====     realRoot untouched=true
```

（两条命令均按老探针设计重写各自的 `screens-t5x/` 截图与 results.json；两探针的 G8/G3 关键断言 —— 侧栏通高、顶栏左缘=侧栏右缘、折叠钮位置、标签连通 `belowActive=pv-root`、装订线 70/12、四宽度零滚动 —— 全部 PASS。）

### 4.5 electron 进程计数

```
开跑前         0
探针运行中     5（electron 主进程 + 渲染/GPU/utility 子进程）
window.close() 后 0
最终          0
```

交付时复核：`Get-Process electron | Measure-Object → Count = 0`。

## 5. 截图索引（`docs/mockups/screens-t59/`，共 11 张）

| # | 文件 | 内容 |
|---|---|---|
| 1 | `t59-01-light-main.png` | 浅色 · 主界面（侧栏右缘 2px 黑线 + 顶栏下沿 2px 黑线 + 标签条↔正文接缝） |
| 2 | `t59-01-light-seam-zoom6x.png` | **浅色 · 活动标签骑缝 6× 放大**：白底活动标签 ∏ 形黑轮廓、黑线在其处断开、非活动标签停在线上 |
| 3 | `t59-01-light-modal.png` | 浅色 · 布局快选模态（2px ink-edge 外轮廓 + 像素投影） |
| 4 | `t59-01-light-ai.png` | 浅色 · AI 面板展开（面板左缘 2px 黑线；编辑列侧无重复线） |
| 5 | `t59-01-dark-main.png` | 深色 · 主界面（**亮边**口径：`#EDEDED` 描边在近黑底上显形） |
| 6 | `t59-01-dark-seam-zoom6x.png` | 深色 · 活动标签骑缝 6× 放大 |
| 7 | `t59-01-dark-modal.png` | 深色 · 模态 2px 亮边 |
| 8 | `t59-01-dark-ai.png` | 深色 · AI 面板展开 |
| 9 | `t59-01-light-main-1184.png` | 1184 宽零滚动复验（纵向 + 横向） |
| 10 | `t59-01-light-main-894.png` | 894 宽零滚动复验 |
| 11 | `t59-01-window-dark.png` | 窗口级（含标题栏 + 原生菜单栏）补拍 |

> 4 关键区 × 双主题 = 8 张（验收要求 ≥8），另 3 张为两宽度与窗口级补充。放大截图走 CDP `Page.captureScreenshot` 的 `clip.scale=6`（矢量重采样，不改布局量测），像素量测走 `Emulation.setDeviceMetricsOverride(deviceScaleFactor:1)` 后解码 PNG 逐行/列扫描。

## 6. 决策记录（D-x）

- **D-1 接缝归属采用「跨缝更长的一侧独占」**：顶栏→主区归顶栏、侧栏→主区归侧栏、标签条→正文归 `.pv-root`、编辑列→AI 面板归 `.ai-chat`。编辑列自身**不补**左/右/下描边（窗口边缘不需要线）。理由：任何"两侧各画一半"都会在 240/1184 这类整数接缝上叠出 4px 粗缝 —— 老板恰恰是嫌 1px "不够像素"，4px 双拼会立刻破相。真机像素实测三条接缝均 = 2px。
- **D-2 活动标签 `z-index: 1` + 负下外边距下沉**：`.pv-root` 是 `position: relative; z-index: auto`（DOM 中更靠后），不提层的话新加的顶边描边会盖住标签底色；`overflow-y: hidden` 会剪掉下沉量，故把探出的 2px 用 `padding-bottom` 划进裁剪安全带（内容盒仍 36px → 标签基线/插槽中心/横滚几何零位移，t52 老探针的 `barCenterY`/折叠钮 Δy 断言保持 PASS）。
- **D-3 非活动标签只吃左描边**：相邻两枚若各有左右描边会叠成 4px；只画左描边后"标签之间"恒为 2px，且活动标签的 ∏ 右描边同时充当它与后者之间的分隔线。
- **D-4 深色 = 亮边**：写进 DESIGN.md 并双主题出图，**属老板终审项**（浅色严格满足"黑色边框"，深色以亮边保证可见）。
- **D-5 接缝条不占盒模型（侧栏）**：见 DEVIATION-3。

## 7. DEVIATIONS

1. **DEVIATION-1 · `tabs/TabsBar.css` 不在 §1.2 的五处边界清单内，但为 §1.3 必需**。任务书 §1.2 列出的 apps 侧 CSS 只有 `App.css` 与 `AiChatPanel.css`（+ 浮层族）；而 §1.3「T52 标签连通适配」的唯一落点就是标签条 CSS。按「最小改动（只增不改）」在该文件追加骑缝几何，未改任何既有断言语义（两条既有 T52 融合断言逐字未动）。同因追加 `App.css` 的 `.app-tabrow-toggle { align-self: center }`（行宿主容器的 1 行兜底）。
2. **DEVIATION-2 · `App.css:hover` 与 `.pv-root` 的边界按「只增不改」处理**：
   - 任务书表列「编辑区 `apps/.../App.css:222`（`.app-editor-col .pv-root`）`border: 1px hairline`」——**代码事实是 `.app-editor-col .pv-root` 无任何描边**（App.css:222 实为 `.app-nav-input` 的 1px hairline；`.pv-root` 本身的规则在 `pages/PageView.css:6`，亦无描边）。按最小改动**只加 `border-top: 2px`**，未动 PageView.css。
   - 任务书表列第 5 处「折叠后恢复钮左沿 `App.css:50` | `border-top`」——代码事实 `App.css:50` 是 `.app-main-row--ai-bottom .ai-chat` 的 `border-top`（AI 面板置底时的横向接缝），并非"恢复钮"。按语义最近落点处理（该处升级为 2px ink-edge）；「折叠后恢复钮」当前实现为侧栏 `display:none` + 标签行折叠钮，无独立左沿描边要素。
3. **DEVIATION-3 · 侧栏右缘用定位接缝条（`::after`）而非 `border-right`**。既有红线 T57 探针 G8-1 断言 `.app-side` 宽 ≈ 240（±1px）——该容差是 1px 描边时代的设定；`border-right: 2px` 会占盒把内层压到 238，直接判红。改用同位置的定位描边条：位置等价（`right:0` 与 border 占 border-box 内侧 2px 完全重合，真机像素实测 `exactIdx=[6,7]` 与顶栏/正文接缝同坐标关系）、**零盒影响**（`.app-side` 回 240，内层几何与改前逐像素一致），且绘制层级在行 hover 底 / 滚动条之上（border 会被它们盖掉 2px）。DESIGN.md 已把「接缝条不得占盒模型」写成规则。
4. **DEVIATION-4 · 浮层族纳入 `Select.css` 下拉与 `Toast.css`**（§1.4 标题为「浮层族统一」，正文另有「下拉/tooltip 类小浮层」条款）→ 二者均属 `packages/ui` 浮层组件 CSS（红线许可面内）。**未纳入**：命令面板 `palette/CommandPalette.css`、同步状态面板 `sync/SyncStatus.css` 两处浮层（不在 §1.4 枚举内，且 apps/desktop 红线为显式清单）→ 登记在 §8 遗留风险，建议下一单并入统一。
5. **DEVIATION-5 · 编辑区只加顶边**：§1.2 若按「编辑区四边 2px」实现，会与侧栏右缘 / AI 面板左缘接缝叠成 4px，违反同条「相邻边只画一次」。故编辑区描边仅顶边（标签条↔正文接缝），左右归邻面、下缘为窗口边缘（无需线）。
6. **DEVIATION-6 · 老断言接缝采样点的固有脆弱性（探针侧最小处置）**：T57 探针 G8-4 / T52 探针 G3-4 的采样点是 `tabsbar.bottom + 1`，落入 `.pv-root` 顶部**可滚动的 padding 区** —— 仅当正文 `scrollTop = 0` 时才命中 `.pv-root`（正文一滚动即命中 `.pv-body` 等子元素）。本单骑缝改造后 `tabsbar.bottom` 由 76 → 78，采样点随之深 2px，该脆弱性被放大（探针首轮 light 段实测 `pvScrollTop=171` → `belowActive=pv-body`）。处置：**不改老断言**，只在本单探针复跑前把正文 `scrollTop` 显式复位为 0 并把 `before/after` 记入原始数据；两条老探针独立复跑亦全绿（§4.4）。老断言本身的写法风险登记在 §8。

## 8. 遗留风险

1. **深色=亮边需老板终审**：口径与理由已进 DESIGN.md（结构分界的语义靠明度差成立），双主题 8 张截图在手；若老板坚持"深色也要黑边"，则深色下边界不可见（对比度 ≈1.05），需回到本节重议（改法只有两条：换亮边，或把深色底提亮）。
2. **浮层族尚未 100% 统一**：命令面板与同步状态面板两处浮层仍为 1px hairline（不在 §1.4 枚举内 + apps/desktop 红线为显式清单）→ 建议下一单统一，或由 PM 直接追认纳入本单。
3. **老探针接缝采样点的滚动脆弱性**（DEVIATION-6）：`tabsbar.bottom + 1` 落在可滚动区；建议后续把两处断言改成"采样 `.pv-root` 描边带内"的稳定点位。
4. **`.pv-root` 顶边由活动标签覆盖的写法依赖 2px 整数几何**：若后续有人把 `--sc-space-xxs` 改值、或给标签条加 `overflow`/`transform`，骑缝会破 —— 已用 `borders-t59`（13 例）+ `layout-fusion-t52` 追加（3 例）两条层测钉住契约，真机侧由探针 G3 五断言兜底。
5. **`docs/mockups/screens-t52/*`、`screens-t57/*`、`docs/perf-history.jsonl` 被复跑重写**（§2.7）：这是"老断言零回归"取证的副作用，内容为最新一次真实运行输出；若 PM 需要保留历史快照，请在提交前说明。
6. **未覆盖的边界组合**：AI 面板置底 + 侧栏折叠同时成立时的三线交汇，本单只做了 computed style 断言（`.app-main-row--ai-bottom .ai-chat` = 2px），未做真机像素采样（探针未构造该组合）。

---

## 10. PM 复跑节（09-22 16:44~17:00，PM 实跑）

```
build-tokens --check:   ✓ 一致
no-magic:               ✓
contrast.test.ts:       9 passed
pnpm -C packages/ui test:      Tests 144 passed (144)   ✓ 与申报一致
pnpm -C apps/desktop test:     Tests 783 passed (783)   ✓（electron 口径；node-ABI 666+19 skip 同前例口径）
pnpm -r typecheck:      9/9 Done
apps/desktop selftest:  SELFTEST OK
ensure-abi electron + build → ✓ built 1.70s
真机探针 cdp-e2e-t59-01.mjs:  45 PASS / 0 FAIL（一次过）
  · 双主题 × 三条接缝像素实测线宽 = 2（无 4px 双拼）
  · 骑缝：活动标签中心采样 = 编辑区底色（非 ink-edge），其右侧 = ink-edge（浅 rgb(26,26,26)/深 rgb(237,237,237)）
  · T52/T57 老断言全复跑零回归；1184/894 双宽度双主题零滚动；真档案 untouched；electron 计数 before=5 after=0
```

**PM 追认与处置**：
- **DEVIATION-1~6 全部追认**。特别地：D-5（编辑区只加顶边）是对的——三边会把邻面接缝叠成 4px；D-6 的"复位 scrollTop 再采样"处置不动老断言，正确。
- **遗留#2（命令面板/同步面板 1px 浮层）→ PM 当轮直接追认纳入本单**：两处外轮廓已改 `2px ink-edge`（CommandPalette.css:23 / SyncStatus.css:127），内部 hairline（输入区分隔、虚线空态）按任务书 §1.5 精神保留；no-magic/单测/探针 45/0 复跑全绿（改后重验）。
- 遗留#1（深色=亮边）**已按老板终审流程推送双主题截图**，口径进 DESIGN.md。
- 遗留#3/#4/#6 登记台账，#4 的双层测钉契约（13+3 例）认可为足够。
- screens-t52/t57 重写（#5）接受：内容即最新真实运行输出，随本单一并入库。

**结论：T59-01 验收通过**（含 PM 追认的两处浮层）。
