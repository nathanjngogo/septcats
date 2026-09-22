# TASK-T60-01 报告 · P2 交互一致性批（R13 ①②③⑤⑥⑦）

> 状态：**完成**（真机探针 32 PASS / 0 FAIL；T59 45/0、T52 23/0 老探针复跑零回归；desktop 796 = 基线 783 + 13）
> 基线：0.4.0 + T59 像素边框（HEAD=0.4.1-rc.1 号段）；批次 **R13 第一单（T60 先行，T61-01 承接 ④⑧）**
> 设计真源：`docs/PRD-R13-优化八条.md`（侦察表）+ `docs/tasks/TASK-T60-01.md`（六件事逐条钉死）
> 探针：`docs/mockups/cdp-e2e-t60-01.mjs` → `docs/mockups/screens-t60/`（8 张 png + `t60-01-results.json`）
> 逐条验收锚：簇序 ✓ ／ ⋮⋮ 真拖位移 ✓ ／ 外点关 ✓ ／ rename 落库 ✓ ／ toast 3.2s 消失（三次探针实测 2967 / 3051 / 2967 ms）✓

## 1. 交付摘要

老板 09-22 晚 R13 ①②③⑤⑥⑦ 六件事落地为「交互一致性批」（纯 UI/交互/派生会话态，**零协议/SCHEMA 变更**）：

1. **块柄簇视觉序对调**：簇内 DOM 序由【+】【⋮⋮】→ **【⋮⋮】【+】**（Notion 惯例：抓手在左、加号贴右）；**两键行为一字未换**（⋮⋮=块操作菜单、＋=在下方插块）。
2. **⋮⋮ 真能拖**（老板「功能相反」的真相之一）：`draggable` 从 `.pv-handle` 壳迁到 ⋮⋮ 键本体，`cursor: grab` 随迁；真机拖拽实证 = dragstart 由 `BUTTON.sc-blockcontrol__handle` 触发（原生 CDP 拖拽，未走合成兜底），落位后块序翻转且 `blocks:list` 同步。
3. **新建页面行图标 = FileText**：普通页行（含树根）一律文件图标；wiki/database 行与 Wiki 分区头保持现状。
4. **点空白即关**：`packages/ui/Menu.tsx` 一处治全仓 Menu（侧栏行菜单 / 模板行菜单 / 视图·筛选·属性·计算菜单…）；editor 的 BlockControls 自实现菜单同语义对齐；全族浮层盘点见 §3。
5. **页面操作菜单 + 右键**：⋯ 菜单新增「重命名」（复用既有 `beginRename` 行内编辑态，不新造 state）；右键行弹**同一份**菜单（同一 items/onSelect 构造），落点 = 光标处并 clamp 进视口。
6. **全部通知 3000ms 自动关闭**：收口在唯一出口 `pushToast`；每条独立计时、hover 不暂停、danger 不例外；手动关/队列淘汰都清定时器。真机三次探针实测存活 **2967 / 3051 / 2967 ms**（口径 3000ms，均在 [2600, 4000] 容差内）。

真机证据链：簇内序 + 几何序 + draggable 归属 + 光标（浅/深两主题）、原生拖拽 dragstart 归属 + DOM/DB 双向换位 + 正文零污染、块菜单 before/after、右键菜单与光标 |Δ| = 0px、改名落库（行标题 + `pages.tree` 双向）、toast 生命周期实测、8 张双主题截图、1184/894 零滚动、真档案 untouched、electron 计数 0。

## 2. 改动清单

### 2.1 packages/editor（只动 BlockControls/icons 相关 + 本单测试）

| 文件:行 | 变更 |
|---|---|
| `packages/editor/src/react/BlockControls.tsx:44-56` | 新增 optional prop **`dragHandleProps`**（拖拽透传口；缺省 undefined = 零变化，其它宿主/测试不受影响） |
| `:87` | 函数签名接 `dragHandleProps` |
| `:108-133` | outside-close 由 `mousedown` **对齐为 `pointerdown`**（与 ui/Menu 同事件族；`root.contains` 判定「簇内不算 outside」→ 无同事件 toggle 竞态），注释写明口径 |
| `:176-207` | 渲染序对调：⋮⋮ 键在前（`{...dragHandleProps}` 透传）、＋ 键在后（**从不接收**透传口 → 永远不可拖） |
| `packages/editor/src/react/editor.css:167-172` | 新增 `.sc-blockcontrol__handle[draggable='true'] { cursor: grab }`（只对真拖实例给抓光标；写在 `:disabled` 之前保证禁用态仍 `default`） |

### 2.2 packages/ui（只动 Menu.*）

| 文件:行 | 变更 |
|---|---|
| `packages/ui/src/Menu.tsx:28-35, 45-77, 80-86` | 新增 `rootRef` + `onDismissRef`；文档级 **`click` outside-close**（目标不在菜单根内 → `onDismiss`，与 Escape 同出口；卸载摘监听）；注释写明「为什么是 click 而不是 pointerdown」（见 DEVIATION-2） |

### 2.3 apps/desktop（PRD 点名文件 + i18n/测试）

| 文件:行 | 变更 |
|---|---|
| `pages/PageView.tsx:849-868` | `onDragStart` 改签 `HTMLButtonElement`；payload 改**私有 MIME**（见 DEVIATION-4）；新增 `onDragEnd`（清 dragIdRef + 落点提示线） |
| `pages/PageView.tsx:1149-1164` | `.pv-handle` 壳**移除** `draggable`/`onDragStart`/`onDragEnd`（T53 立体语法保留在壳上）；改 `dragHandleProps={{ draggable: true, onDragStart, onDragEnd }}` 注入 ⋮⋮ 键 |
| `pages/PageView.css:63-79` | `.pv-handle` 去掉 `cursor: grab`（随拖拽语义迁到 ⋮⋮ 键），注释说明几何/T53 立体未动 |
| `pages/SidebarTree.tsx:223-257` | 新增 `closeRowMenu`、`rowMenuId`+`rowMenuAt` 双态、`ctxNode`、右键菜单 clamp `useLayoutEffect`（实测盒尺寸后压回，留 8px 余量；jsdom 退化为纯 clamp 不死循环） |
| `pages/SidebarTree.tsx:333-397` | 行菜单抽出**单一构造** `pageRowMenu(node)`（items + onSelect 一份，⋯ 与右键共用）；新增 `{id:'rename'}` 条目（删除之前、非 danger）→ 复用 `pagesActions.beginRename` |
| `pages/SidebarTree.tsx:445-508` | 行图标：`type==='page' ? FileText : depth===0 ? rootIcon : FileText`（普通页一律文件图标）；`onContextMenu`（preventDefault + 开同一菜单于光标处；命中 `input/.app-nav-more-wrap/.app-nav-tw` 放行不抢）；⋯ 钮 `setRowMenuAt(null)` 后 toggle |
| `pages/SidebarTree.tsx:613-637` | 右键菜单渲染点：宿主 `position: fixed` + 光标坐标 + `var(--sc-z-dropdown)`；菜单只借 `.sc-menu` 自身（不叠 `.app-nav-menu` 的 absolute/right/top，避免二次偏移） |
| `state/pages.ts:197-243` | `TOAST_AUTO_DISMISS_MS = 3000`、`toastTimers` map、`clearToastTimer`、`removeToast`（出队单一入口）；`pushToast` 入队即 `setTimeout(3000)` 自弹 + 队列淘汰时清被挤者定时器 |
| `state/pages.ts:469-471` | `dismissToast` 收敛到 `removeToast`（清定时器 + 出队） |
| `i18n/zh-CN.ts:98-100` / `en-US.ts:97-99` | 新增 `sidebar.rename`（`重命名` / `Rename`）；两字典键集合同构（i18n 门禁） |

### 2.4 测试与探针（数字见 §5）

| 文件 | 变更 |
|---|---|
| `packages/ui/src/Menu.test.tsx` | **+4 用例**（外点关 / 内点不关 / 卸载摘监听 / **toggle 触发器二次点击 = 开→关** 竞态） |
| `packages/editor/test/react.test.tsx` | **+3 用例**（簇内 DOM 序 + 行为不换 / `dragHandleProps` 缺省零变化与只落 ⋮⋮ / 点空白关菜单） |
| `apps/desktop/test/t60-01-interaction.test.tsx` | **新增 12 用例**：行图标 ×2、重命名条目 ×3（渲染+顺序+danger / beginRename 态 / 提交走 `pages.rename`）、右键 ×4（同一菜单+光标落点 / Esc+外点关 / 子控件不弹 / 右键选重命名）、toast ×3（2999↔3001 / 多条独立计时 / 手动关+淘汰清定时器） |
| `apps/desktop/test/pageview-blocks-ui.test.tsx` | **+1 用例**（宿主层：`draggable` 在 ⋮⋮、＋ 不可拖、壳不可拖）；老拖拽用例的**发起元素**从 `.pv-handle` 改为 ⋮⋮ 键（见 DEVIATION-1） |
| `docs/mockups/cdp-e2e-t60-01.mjs` | **新增真机探针**（32 断言；G0 夹具 → G1 簇序（浅）→ G2 真拖拽 → G3 块菜单开合 → G4 侧栏（图标/⋯/右键/改名）→ G5 toast 3s → G6 浅色截图 → G7 深色复跑 + 截图 → G8 两宽度零滚动 → G9 隔离/退出） |
| `docs/mockups/screens-t60/` | 8 张 png + `t60-01-results.json` |

### 2.5 复跑老探针产生的产物改动（非本单代码改动）

- `docs/mockups/screens-t52/*`、`docs/mockups/screens-t59/*`（含各自 `results.json`）：为取证「老断言零回归」**重新执行** `cdp-e2e-t52-01.mjs` / `cdp-e2e-t59-01.mjs`，两探针按设计重写自己的截图与结果 JSON（证据见 §5.3）。
- `docs/perf-history.jsonl`：desktop 全量测试（`perf.test.ts`）按设计追加一行基线。

## 3. 浮层族关闭途径盘点（任务书 §0-3 要求逐条写明，不许静默跳过）

| 浮层 | 关闭途径 | 结论 |
|---|---|---|
| `ui/Menu`（全仓实例：侧栏行菜单 / 模板行菜单 / dbview 视图·排序·类型·筛选·属性·计算菜单） | Esc（`onKeyDown`）＋ 选条目（`onSelect`）＋ **点空白（document `click` outside-close，本单新增）** | **本单修复**：原「无 outside-close」（PRD 侦察 grep=0）已确认为真 |
| editor `BlockControls` 块菜单（自实现，非 ui/Menu） | Esc ＋ 选条目 ＋ 点空白（`root.contains` 判定；本单由 `mousedown` 对齐为 `pointerdown`） | 代码事实**早已具备**（见 DEVIATION-3），本单仅统一事件族 + 注释 |
| `ui/Select` 下拉 | `document mousedown` outside-close（`Select.tsx:59`）＋ Esc | 已具备 ✓ |
| `ui/Popover` | `document mousedown` + `keydown`（`Popover.tsx:40-41`） | 已具备 ✓ |
| `ui/Dialog` | Esc ＋ 遮罩 `onMouseDown`（`Dialog.tsx:68,86`） | 已具备 ✓ |
| `LayoutPicker`（模态） | Esc ＋ 遮罩 `onMouseDown`（`LayoutPicker.tsx:117-119`） | 已具备 ✓ |
| `CloseAskDialog`（模态） | Esc ＋ 遮罩 `onMouseDown`（`CloseAskDialog.tsx:114-116`） | 已具备 ✓ |
| `CommandPalette` | Esc ＋ 遮罩 `mousedown`（`CommandPalette.tsx:193` + 遮罩节点） | 已具备 ✓ |
| `SyncStatus` 气泡（T57） | `document mousedown` outside-close + keydown（`SyncStatus.tsx:142-143`） | 已具备 ✓ |
| editor `SlashMenu` | `document mousedown` outside-close + window `keydown`（capture）（`SlashMenu.tsx:104-105`） | 已具备 ✓ |
| dbview `CellEditor`（单元格编辑浮层） | `document mousedown` outside-close（`CellEditor.tsx:247,386`） | 已具备 ✓ |
| `ui/Tooltip` | hover 驱动（移出即隐） | 无需点空白关闭 ✓ |
| `ToastViewport` | 关闭钮 ＋ **3000ms 自弹（本单新增）** | 本单修复 ✓ |

结论：本单后，全仓「点空白不关」的浮层 = **0**（唯一无遮罩、无 outside-close 的两处 = ui/Menu 与 Editor 块菜单，均已收口）。

## 4. 竞态与风险点处置

### 4.1 outside-close × toggle 钮同一」事件竞态（点名风险 ①）

- **ui/Menu 方案**：document 级 **`click`（冒泡）**。触发器（⋮ / ▾）与菜单**不同 DOM 根**且几乎都是 toggle；`pointerdown` 早于触发器自身 onClick，会「先关后开」（用户按不关）。`click` 冒泡发生在 React 根容器（触发器 onClick）**之后**：toggle 已算完，此时若在菜单外再补一次 `onDismiss` → 两次结果同向（幂等）→ 无竞态。菜单项被点时宿主多已卸载本组件（`rootRef=null`）→ 空操作，不双发。竞态由 `Menu.test` 的 toggle 触发器用例钉死（开→关）。
- **editor BlockControls 方案**：`pointerdown` + `root.contains`。因为该组件的**开关钮住在簇根内**（`rootRef = .sc-blockcontrol`），命中钮本体天然不是 outside → 同一事件不会「先关后开」，无需降级到 click。
- 两处注释都写明「选了哪一种、为什么」。

### 4.2 拖拽改到 ⋮⋮ 后老断言存活核查（点名风险 ②）

先 grep（动手前）得到的老断言清单：

| 老断言（文件:行） | 结论 |
|---|---|
| `apps/desktop/test/pageview-gutter.test.ts:127-138`（`.pv-handle` left:0 / width:max-content / 无 `--sc-space-gutter`；手柄 ≥24；gutter 12–16） | **零改动、零红**（未动 .pv-body padding / 簇宽 / 手柄尺寸） |
| `packages/editor/test/react.test.tsx:172,179,243,245,252`（「块操作」「新增块」aria-label 与 disabled） | **零红**（新增透传口不改 aria/disabled 语义） |
| `apps/desktop/test/pageview-blocks-ui.test.tsx:179`（拖拽发起元素 = `.pv-handle`） | **必须改**：发起元素迁到 ⋮⋮ 键（DEVIATION-1），断言语义不变 |
| `apps/desktop/test/layout-fusion-t52.test.tsx`、`borders-t59.test.tsx`（T52/T59 全量） | **零红**（全量 796 绿 + 两探针复跑 45/0、23/0） |

真机几何实证：`clusterRect = {left:379.5, right:437.5, w:58, h:28}`（浅/深一致）→ **T33 簇宽 58 一字未变**；两键 `w=28 h=28` 命中区 ≥24 ✓；⋮⋮ 左缘 379.5 < ＋ 左缘 409.5 ✓。

### 4.3 toast 定时器可测性（点名风险 ③）

- 断言用 `vi.useFakeTimers()`：**2999ms 仍在 / 3001ms 消失**（success 与 danger 各一条，含 `TOAST_AUTO_DISMISS_MS === 3000` 口径常量断言）。
- 多条独立计时：t=0 与 t=1000 各入一条 → t=3000 时首条消失、次条仍在 → t=3001 全部消失。
- 无泄漏：手动 `dismissToast` 后推进 4000ms 不复发；队列上限（3）淘汰的老条目定时器被清（推进 3001ms 后不残留）。
- 真机实测（探针 G5，三次复跑）：`appearedAt→goneAt` = **2967 / 3051 / 2967 ms**，无任何手动关闭（hover 不暂停口径）。

### 4.4 额外发现（真机首轮探针逼出来的真缺陷，已修）

拖到正文上时，**ProseMirror 的原生 drop 监听先于 React 合成 drop 处理**，会把 `dataTransfer` 里的 `text/plain`（原本是块 id）当纯文本插进落点 —— 首轮探针截图里第二段正文被插进了 26 位块 id。修法见 DEVIATION-4（payload 改私有 MIME），并新增真机断言 `G2-4 拖拽零污染`（正则拦 26 位 ULID 形态文本）钉死。

## 5. 命令与完整输出

### 5.1 单测 / 类型

```
$ cd apps/desktop && pnpm test          # pretest 切 node ABI（better-sqlite3 全量库测可跑）
 Test Files  71 passed (71)
      Tests  796 passed (796)           ← 基线 783，本单 +13（新文件 12 + 宿主 1）

$ cd packages/ui && npx vitest run
 Test Files  31 passed (31)
      Tests  148 passed (148)           ← 基线 144，本单 +4（Menu outside-close）

$ cd packages/editor && npx vitest run
 Test Files  11 passed (11)
      Tests  200 passed (200)           ← 基线 197，本单 +3（簇序/透传口/点空白关）

$ cd packages/dbview && npx vitest run
 Test Files  5 passed (5)
      Tests  122 passed (122)           ← 未改动文件，Menu 行为变化零回归

$ cd apps/desktop && pnpm typecheck     # tsc -p tsconfig.node.json && tsc -p tsconfig.web.json
（无输出 = 通过）
$ cd packages/editor && pnpm typecheck  （无输出 = 通过）
$ cd packages/ui && npx tsc -p tsconfig.json --noEmit  （无输出 = 通过）
```

### 5.2 真机探针 `cdp-e2e-t60-01.mjs`

```
$ cd apps/desktop && pnpm build          # electron ABI + fresh out/**
✓ built in 1.87s

$ node docs/mockups/cdp-e2e-t60-01.mjs
PASS [G0|fixture] G0-1 夹具成立：2 标签 / 2 存活页                     — tabs=2 pages=2
PASS [G1|cluster-light] G1-1 簇内 DOM 序 = ⋮⋮ 在前 / ＋ 在后            — order=["handle","add"]
PASS [G1|cluster-light] G1-2 几何序：⋮⋮ 左缘 < ＋ 左缘 且同高            — handle{left:379.5,w:28} add{left:409.5,w:28} cluster w=58
PASS [G1|cluster-light] G1-3 draggable 只落 ⋮⋮ 键（壳与 ＋ 均不可拖）    — handle=true add=null shell=null
PASS [G1|cluster-light] G1-4 ⋮⋮ 光标 = grab；＋ 非 grab                 — handle=grab add=pointer
PASS [G1|cluster-light] G1-5 aria-label（块操作/新增块）齐备、非禁用     — labels=["块操作","新增块"] disabled=[false,false]
PASS [G2|real-drag] G2-1 拖拽真发起：dragstart 由 ⋮⋮ 键本体触发         — mode=native-cdp  [{type:"dragstart",tag:"BUTTON",cls:"sc-blockcontrol__handle",hasDt:true}]
PASS [G2|real-drag] G2-2 落位后块序变化（真换位）                       — before=[A,B] → after=[B,A]
PASS [G2|real-drag] G2-3 拖拽结果落库：blocks:list 序 = DOM 序           — ["…02R","…DZY"]（与 DOM 逐位一致）
PASS [G2|real-drag] G2-4 拖拽零污染：私有 MIME 生效，正文无 id 文本      — ["T60 交互一致性第二段","T60 交互一致性第一段"]
PASS [G3|block-menu] G3-1 点 ⋮⋮ → 块菜单开                              — before=false open={expanded:true,count:1}
PASS [G3|block-menu] G3-2 点正文空白 → 块菜单关                          — {expanded:false,count:0}
PASS [G4|sidebar] G4-1 新建页行图标 = FileText（首格 x3/w10）           — {first:{x:"3",y:"1",w:"10"},n:29}
PASS [G4|sidebar] G4-2 Wiki 分区头仍 Note                                — {first:{x:"4",y:"1",w:"1"},n:24}
PASS [G4|sidebar] G4-3 ⋯ 菜单含「重命名」（删除之前）                    — ["重命名","固定宽度","转为 Wiki","删除"]
PASS [G4|sidebar] G4-4 右键行 → 同一份菜单                              — 同上（4 条一致）
PASS [G4|sidebar] G4-5 菜单位置 = 光标处（|Δ| ≤ 12px）且宿主 fixed       — menu{left:56,top:224} cursor{56,224} host=fixed
PASS [G4|sidebar] G4-6 点「重命名」→ 行内输入框出现（既有 beginRename）  — input=true
PASS [G4|sidebar] G4-7 改名落库：行标题 + DB 标题同步                    — row="T60 改名落库" db=["T60 改名落库","未命名"]
PASS [G5|toast-3s] G5-1 通知出现于视口                                  — text="已转为 Wiki"
PASS [G5|toast-3s] G5-2 通知 3000ms 自动关闭（实测存活）                 — lifeMs=2967（三次探针：2967/3051/2967）
PASS [G7|dark] G1-1…G1-5（深色复跑：序/draggable/光标/几何/aria 同浅色）
PASS [G7|dark] G7-1 深色右键菜单同样弹在光标处                          — menu{left:56,top:240} cursor{56,240}
PASS [G8|two-widths] G8-1 1184/894 零滚动 + 侧栏 top=0                  — 1184:{800/800,1184/1184,0} 894:{800/800,894/894,0}
PASS [teardown] G9-1 window.close() 优雅退出（未强杀）                   — {gracefulExited:true,forced:false}
PASS [teardown] G9-2 退出后 electron 进程计数 = 0                        — before=5 after=0

===== T60-01：32 PASS / 0 FAIL =====
realRoot untouched=true  electron 最终计数=0
results -> docs/mockups/screens-t60/t60-01-results.json
```

截图 8 张（浅/深 × 主界面·块簇·块菜单·右键菜单 + 1184/894 两宽度）：
`t60-01-light-main.png`、`t60-01-light-cluster.png`（⋮⋮ 左 ＋ 右）、`t60-01-light-blockmenu.png`、
`t60-01-light-ctxmenu.png`（菜单骑在光标处）、`t60-01-light-main-1184.png`、`t60-01-light-main-894.png`、
`t60-01-dark-main.png`、`t60-01-dark-ctxmenu.png`。

### 5.3 老探针复跑（零回归取证）

```
$ node docs/mockups/cdp-e2e-t59-01.mjs
===== T59-01：45 PASS / 0 FAIL =====        realRoot untouched=true  electron=0

$ node docs/mockups/cdp-e2e-t52-01.mjs
===== T52-01：23 PASS / 0 FAIL =====        realRoot untouched=true
```

### 5.4 交付卫生

```
electron 进程计数：探针前后 before=5 / after=0（两次探针 + 老探针复跑后最终 = 0）
真档案 C:\Users\Administrator\.septcats：mtime 前后一致（untouched=true），夹具全在 _scratch/t60-01/
红线自检：core / db / schema / sync / importer / platform 零改动；op-log 协议与 SCHEMA_VERSION 零变更；
         未加依赖；未碰 git（改动全部留在工作区，由 PM 决定提交）
```

## 6. DEVIATIONS（任务书前提与代码事实不符 → 最小改动补齐并登记）

| # | 位置 | 任务书/PRD 前提 | 代码事实 | 处置 |
|---|---|---|---|---|
| D-1 | `apps/desktop/test/pageview-blocks-ui.test.tsx:179` | 「既有断言不许红」，但拖拽点要换 | 老用例把 dragstart 派发在 `.pv-handle` 壳上；壳不再 draggable 后该元素上无处理器 | **改发起元素**为 ⋮⋮ 键（断言语义不变：从手柄发起拖拽 → DOM 序变 + reorder 落库）；其余老断言零改动 |
| D-2 | `packages/ui/src/Menu.tsx:45-77` | 任务书 §0-3 字面指定 `pointerdown` outside-close | Menu 的触发器与菜单**不同 DOM 根**且多为 toggle；`pointerdown` 会「先关后开」；而本单红线不许改 dbview/TemplatesSection 等宿主去传触发器 ref | 用 **`click`（冒泡）** 一处治全仓（触发器先算完、outside 再补一次 → 同向幂等）；竞态由 `Menu.test` 的 toggle 用例钉死；注释写明理由 |
| D-3 | `packages/editor/src/react/BlockControls.tsx:101-115` | 「BlockControls 菜单是自实现（非 ui/Menu）：**同样加** outside-close」 | **早已存在**：原用 `document mousedown` + `root.contains`（因开关钮住在簇根内，天然无竞态） | 最小改动 = 对齐事件族（`mousedown`→`pointerdown`）+ 写注释；**不新增**第二套机制 |
| D-4 | `apps/desktop/src/renderer/src/pages/PageView.tsx:849-868` | 任务书只要求「draggable 落到 ⋮⋮」（payload 未提） | 首轮真机拖拽实测：正文被插入 26 位块 id —— PM 原生 drop 先于 React 合成 drop，把 `text/plain` 当文本插入 | payload 改私有 MIME `application/x-septcats-block-id`（PM 无内容可解析 → 正文零污染）；落点判定仍走 `dragIdRef`，不依赖 payload；新增断言 `G2-4` 钉死 |
| D-5 | `pages/SidebarTree.tsx:613-637` | 任务书 §0-4「Menu 宿主容器加 `style={{left,top}}`」 | 任务书限定「apps/desktop 只动 PRD 点名文件」，`App.css` 未点名 | 用**内联** `position: fixed` + `var(--sc-z-dropdown)`（新增 0 条 CSS）；菜单不叠 `.app-nav-menu` 的 absolute/right/top 以免二次偏移。若 PM 想收成 CSS 类，T61-01 一并做 |
| D-6 | `pages/SidebarTree.tsx:333-397` | §0-4「⋯ 与右键同一 Menu 实例渲染」 | 两个入口锚定方式不同（贴钮 vs 光标），同一实例无法两处挂 | 抽 `pageRowMenu(node)` **单一构造**（items + onSelect 一份），两处复用同一 `rowMenuId` → 语义上仍是「同一份菜单」，无双份实现 |
| D-7 | `pages/SidebarTree.tsx:445-452` | PRD 侦察表：「树根 = rootIcon(:364，**Note**)」 | 代码事实：普通分区根行 rootIcon 传的是 **FolderSimple**（`SidebarTree.tsx:514`）；Note 只用于 Wiki 分区行（:511） | 按事实实现「`type==='page'` → FileText；wiki/database 行与 Wiki 分区头保持现状」；探针 G4-1/G4-2 双向取证 |
| D-8 | `docs/mockups/screens-t52|t59/*`、`docs/perf-history.jsonl` | — | 复跑老探针/全量测试按设计重写各自产物 | 非本单代码改动，如实登记（T59-01 报告 §2.7 同口径先例） |
| D-9 | `state/pages.ts:197-243` | §0-5「定时器在 dismiss/**卸载**时 clear」 | toast 队列住 store，不存在「组件卸载」生命周期 | 替代口径：手动关（`dismissToast`）+ 队列淘汰 + 到点自清三路都清定时器；测试覆盖（推进 4s 无残留）；无泄漏 |

## 7. 未决 / 留给 PM

1. **D-2 的方案选择**：若 PM 希望 ui/Menu 严格用 `pointerdown`，代价是必须允许我在 dbview（PropBar/Aggregations）与 TemplatesSection 的触发器上传 `triggerRef`——超出本单红线，建议 T61-01 或专项补。
2. **右键菜单宿主的 CSS 化**（D-5）：现为内联 `position: fixed`；若要归入 token 化 CSS，需点名 `App.css`。
3. **① 的「老板终审」项**（PRD 待老板一句话）：本单按默认做了「视觉序对调 + ⋮⋮ 可拖」；若老板要的是**两键点击行为互换**，仍是改两行 handler（⋮⋮↔＋ 的 onClick 互换），本单未做。
4. **T61-01 承接**：④ 文件夹派生 + 移入选择器、⑧ 双侧拖拽宽度 + `ai.width`（本单未碰）。
5. **同步面**：本单零协议/SCHEMA 变更，`0.4.1` feed 待 T61-01 后一并并入。

## 8. DoD 自检

- [x] desktop **796 ≥ 783+12**（+13：新文件 12 + 宿主 1）
- [x] T52/T59 老断言零回归（单测 `layout-fusion-t52` / `borders-t59` 全绿；探针复跑 **23/0** 与 **45/0**）
- [x] 探针 `cdp-e2e-t60-01.mjs` **32 PASS / 0 FAIL**（簇序 / ⋮⋮ 真拖位移 / 外点关 / rename 落库 / toast 2967ms）
- [x] 双主题截图 **8 张** `screens-t60/`（≥4）
- [x] 1184/894 零滚动复验（纵向 + 横向 + 侧栏 top=0）
- [x] 真档案 untouched / electron 进程计数 = 0
- [x] 红线：零 `core|db|schema|sync|importer|platform` 改动、零协议/SCHEMA 变更、不加依赖、不碰 git、无 TODO
- [x] 报告骨架开工第 2 步先建、收尾前填真实数字（本文件）

---

## 9. PM 复跑节（09-22 18:09~18:25，PM 实跑）

```
pnpm -C packages/ui exec vitest run:    Tests 148 passed (148)
pnpm -C packages/editor exec vitest run: Tests 200 passed (200)
apps/desktop（pretest→vitest）:          Test Files 60+11skip · Tests 679+19skip=698（node-ABI 口径；electron 口径 796=基线783+13，与申报一致）
pnpm -r typecheck:                       9/9 Done
apps/desktop selftest:                   SELFTEST OK
no-magic:                                ✓
ensure-abi electron + build:             ✓ built 1.83s
真机探针 cdp-e2e-t60-01.mjs:             32 PASS / 0 FAIL（一次过）
  · 簇序=[handle,add] 双主题；draggable 只在 ⋮⋮（壳/＋均 null）；⋮⋮ cursor=grab
  · 原生 CDP 拖拽实证 dragstart 由 BUTTON.sc-blockcontrol__handle 触发、落位块序翻转 + blocks:list 同步
  · 右键菜单弹光标处（host fixed + clamp，items=[重命名,固定宽度,转为 Wiki,删除]）
  · 重命名→行内框→落库 row=DB 标题同步（"T60 改名落库"）
  · toast 存活实测 lifeMs=3067 ∈[2600,4000]，无手动关闭
老探针独立复跑：T59 = 45 PASS/0 FAIL · T52 = 23 PASS/0 FAIL（results.json 程序读取）
红线核对：git status 无 core/db/schema/sync/importer 改动；真档案 untouched；electron 计数 before=5 after=0
```

**追认**：DEVIATION-1~4（老拖拽用例发起元素随迁 / click-非-pointerdown 选型 / editor 菜单 mousedown→pointerdown / 私有 MIME）全部合理，尤其 click 选型避开了 toggle 竞态且注释写明理由。浮层盘点表 9 行逐行核对属实（PM 复 grep 验证 Select:59/Popover:40-41 行号真在）。

**结论：T60-01 验收通过。**（老板口径①"功能相反"的真相=壳 draggable 拖不动+视觉序反，两者都已修；若老板验货后仍想要两键行为互换，一句话即改。）
