# TASK-T51-01 交付报告 · P1 行为修正两件（重命名 blur 提交 + 原生菜单本地化）

> 工程师：CBL ｜ 前置：rc.27（tip `5dfa58e`，已 `git log -1` 确认）｜ 老板 09-21 原话两条
> ① 「新建页面重命名，一定要回车才能确认，不合理」 ② 「菜单栏应与选择的语言统一」

---

## 0. 结论

两条行为缺陷均已修复并经**真机取证**（16 PASS / 0 FAIL）：

| 面 | 结果 |
| --- | --- |
| ① SidebarTree 行内重命名 | `onBlur` 由 `cancelRename` 改 `commit`；Enter 提交 / Esc 取消 / 空值·仅空白·未变化回退原标题；四例单测齐全 |
| ② 原生菜单本地化 | main 新建 `menu.ts`（`Menu.buildFromTemplate` 建完整 File/Edit/View/Help），label 全走 i18n `menu.*`；启动用当前 locale；设置页切语言经 IPC 即时 `setApplicationMenu` 重建 |
| ⚠ 快捷键双绑 | Ctrl+W 委托页签逻辑（**无 `role:'close'`**，不会关窗）；Ctrl+K / Edit 六 role 均 `registerAccelerator:false` 不抢注册；缩放 role 正常注册（键位不与页签 1..9 相交） |

**全仓 / 打包留 PM**（本单未跑 `pnpm -r test`、未做安装包）。

---

## 1. 改动清单

### 1.1 ① 重命名 blur 提交

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/renderer/src/pages/SidebarTree.tsx` | `RenameInput`：新增 `settledRef`（提交/取消只发生一次，Enter 提交后卸载引发的 blur 不再发第二次 op）；`settle(value, action)` 统一三键语义——`onBlur → commit`、`Enter → commit`、`Escape → cancel`；`trim` 为空 **或与原标题相同** → `cancelRename()`（回退原标题、不发空 op） |
| `apps/desktop/test/sidebar-tree.test.tsx` | 新增 `describe('SidebarTree 行内重命名失焦提交（TASK-T51-01）')` 四例：blur 提交 / Enter 提交 / Esc 取消 / 空值·仅空白·未变化回退（+4 用例） |

**「Enter 才确认」同类输入全仓核查**（`grep -rn "cancelRename\|onBlur\|'Enter'" src/renderer`）：

| 位置 | 现状 | 处置 |
| --- | --- | --- |
| `pages/SidebarTree.tsx` RenameInput | 修前 `onBlur → cancel`（唯一违规） | **本单修复** |
| `pages/WikiLanding.tsx:115` 标题 / `:145` 简介 | 已是 `onBlur → submit/save` | 无需改（先例） |
| `layout/LayoutSection.tsx:96` 数值行 | 已是 `onBlur → onCommit` | 无需改（先例） |
| `tabs/TabsBar.tsx` | **无行内重命名输入**（改名由侧栏/SettingsPage 完成） | 不存在 |
| `ai/AiChatPanel.tsx` `Enter → 发送` | 发送语义（Shift+Enter 换行），非「确认式」输入 | 不适用 |

### 1.2 ② 原生菜单本地化

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/main/menuTemplate.ts` **（新）** | 纯函数（仅 `import type` electron）：`buildMenuTemplate(locale, onAction)` 组 File/Edit/View/Help 四组；`menuText(locale, key)` 按 locale 取词；`toMenuLocale()` 未知 locale 回落 zh-CN。文案直接读 renderer 的 `i18n/{zh-CN,en-US}.ts`（纯数据对象，**同源**） |
| `apps/desktop/src/main/menu.ts` **（新）** | `applyApplicationMenu(locale, onAction)` = `Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(...)))` |
| `apps/desktop/src/main/index.ts` | `menuLocale` 状态 + `handleMenuAction()`（'about' 就地 `dialog.showMessageBox`；其余 `webContents.send(CHANNEL_MENU_ACTION,{action})` 广播全窗口）+ `installApplicationMenu(locale)`；`bootstrapApplication()` 建窗后 `installApplicationMenu(readSettings().locale)`；`CHANNEL_SETTINGS_PATCH` 落盘后即时重建 |
| `apps/desktop/src/shared/ipc.ts` | 新增 `CHANNEL_MENU_ACTION='menu:action'`、`MENU_ACTIONS`（'newPage'\|'import'\|'openTrash'\|'toggleSidebar'\|'toggleFullWidth'\|'commandPalette'\|'closeTab'\|'about'）、`MenuActionId`、`MENU_CHANNELS` |
| `apps/desktop/src/preload/index.ts` + `src/types/window.d.ts` | 新增 `window.septcats.menu.onAction(listener)`（订阅 + 退订） |
| `apps/desktop/src/renderer/src/pages/… i18n/zh-CN.ts` / `en-US.ts` | 新增 `menu.*` 段 22 键（四组标题 + File 5 + Edit 6 + View 6 + Help 1），两字典同构（受 `test/i18n.test.ts` 门禁①②约束） |
| `apps/desktop/src/renderer/src/tabs/shortcuts.ts` | 从 `handleTabsKeydown` 抽出 `closeActiveTab()`（关当前标签 + 相邻回落；键盘与菜单**同一入口**），行为等价 |
| `apps/desktop/src/renderer/src/App.tsx` | 页签 effect 内新增 `window.septcats.menu.onAction` 派发（与键盘共用同一 `editorVisible` 门控）：newPage / import / openTrash / toggleSidebar / toggleFullWidth / commandPalette / closeTab；抽出 `toggleSidebar` useCallback（顶栏按钮与菜单共用） |
| `apps/desktop/test/menu.test.ts` **（新）** | 8 例：结构与「label 全取自 i18n 字典」/ zh 全中文 vs en 全英文 / `toMenuLocale` 回落 / File 三项派发 / Close Tab 同键委托且无 role:close / Edit 六 role 且不抢注册 / Ctrl+K 不注册 + 缩放注册 / `menuText` 双语言 |
| `apps/desktop/test/tabs.test.tsx` | +1 例 `closeActiveTab`（菜单与 Ctrl+W 共用入口；只关标签、不删页） |
| `apps/desktop/test/layout-ui.test.tsx`、`page-delete-ui.test.tsx` | App 级假桥补 `menu: { onAction }`（桥契约新增字段） |

### 1.3 ⚠ 快捷键双绑核查表（逐字核对）

| 键 | 既有占用 | 菜单处置 | 结论 |
| --- | --- | --- | --- |
| `Ctrl+W` | `state/tabs.ts` `tabsShortcutAction` → 'close'（页签） | File→Close Tab：**accelerator `CmdOrCtrl+W` + `registerAccelerator:false`**，click → `menu:action(closeTab)` → renderer `closeActiveTab()`（同门控同函数） | 不抢系统键，Ctrl+W 路径与改前完全一致；**绝不 `role:'close'`**（role close 会关窗口） |
| `Ctrl+Tab`,`Ctrl+1..9` | 同上（next / 跳第 N） | 菜单**不出现**这些键 | 无双绑 |
| `Ctrl+K` | main `globalShortcut` + renderer palette 两路 | View→命令面板：只展示 `CmdOrCtrl+K`，`registerAccelerator:false` | 不引入第三路 |
| `Ctrl+J` | renderer（App keydown，AI 面板） | 菜单**未出现** | 无双绑 |
| `Ctrl+Z/Y`、`Ctrl+X/C/V`、`Ctrl+A` | 页内 ProseMirror（`packages/editor` 自装 `prosemirror-history` + keymap） | Edit 用标准 role 但统一 `registerAccelerator:false`（见 DEVIATION D-3） | 菜单不截断页内编辑键 |
| `Ctrl+±`、`Ctrl+0` | 未占用（页签键位是 1..9，不含 0/EQUALS/MINUS） | View 缩放用 role `zoomIn/zoomOut/resetZoom`，**正常注册** | 无双绑 |
| `Ctrl+N` | 未占用 | File→New Page 新增 accelerator `CmdOrCtrl+N` | 新绑定，无冲突 |

---

## 2. 数值化验收（原始值）

### 2.1 `pnpm -C apps/desktop test`

```
 Test Files  58 passed (58)
      Tests  651 passed (651)
   Duration  29.59s
```

基线 638 → **651（+13）**：重命名 blur 四例 +4、菜单模板 +8、`closeActiveTab` +1；要求 ≥642 ✓

### 2.2 `pnpm -r typecheck`

```
Scope: 9 of 10 workspace projects
packages/{core,platform,ui,dbview,editor,schema,sync,importer} typecheck: Done
apps/desktop typecheck: Done        ← tsc -p tsconfig.node.json && tsc -p tsconfig.web.json
（9/9 全绿；根包无 typecheck 脚本故 scope 为 9 of 10）
```

### 2.3 双门禁

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px      （exit 0）
✓ token 产物与 DESIGN.md 一致                           （exit 0）
```

### 2.4 真机取证 `docs/mockups/cdp-e2e-t51-01.mjs`

```
===== T51-01：16 PASS / 0 FAIL =====
realRoot untouched=true            （真源夹具自检：C:\Users\Administrator\.septcats mtime 前后一致）
退出：window.close() 优雅退出（forced=false）
```

| 断言 | 原始值摘要 |
| --- | --- |
| G0-1 夹具 | 真点「新建页面」×3 → `tabs=3 pages=3` |
| G1-1 blur 提交 | `inputStillOpen=false titles=["失焦改名成立","未命名","未命名"]`（修前被打回） |
| G1-2 Esc 取消 | 标题保持「失焦改名成立」、编辑框关闭 |
| G1-3 空值回退 | `fill('   ')` + 失焦 → 标题不变、编辑框关闭 |
| G2-1 zh 菜单 | `top=["文件","编辑","视图","帮助"]`；22 个 label 全含 CJK |
| G2-2 Close Tab | `{label:"关闭标签",role:null,accelerator:"CmdOrCtrl+W",registerAccelerator:false}`；全菜单 `role:'close'` 出现次数 = 0 |
| G2-3 Edit | `role=["undo","redo","cut","copy","paste","selectall"]`，六项 `registerAccelerator=false` |
| G2-4 命令面板 | `{label:"命令面板",accelerator:"CmdOrCtrl+K",registerAccelerator:false}`；缩放 role 3 项已注册 |
| G2-5 中文截图 | `screens-t51/t51-01-menu-zh.png`，窗口裁剪 `1224×889`，`50746` B |
| G3-1 File→New Page | `pages 3→4 tabs 3→4`（真菜单项，非侧栏按钮） |
| G4-1 / G4-2 Ctrl+W | `tabs 4→3` / `3→2`，`pages` 不变，`window.closed=false`、`.app-side` 仍在 → **关标签不关窗** |
| G5-1 切 English | `localStorage['septcats.localePref']="en-US"`、`.settings-legend` = `Appearance`（settings.patch 已到 main） |
| G5-2 en 菜单 | `top=["File","Edit","View","Help"]`；22 个 label 无 CJK、与 zh 同构 |
| G5-3 英文截图 | `screens-t51/t51-01-menu-en.png`，`42895` B |

**双语菜单截图（2 张，`docs/mockups/screens-t51/`）**

- `t51-01-menu-zh.png`：标题栏 Septcats ｜ 菜单栏 `文件 编辑 视图 帮助` ｜ 展开的 File 子菜单 = `新建页面 Ctrl+N` / `导入…` / `回收站` / —— / `关闭标签 Ctrl+W` / —— / `退出`
- `t51-01-menu-en.png`：同一个窗口切 English 后 ｜ `File Edit View Help` ｜ `New Page Ctrl+N` / `Import…` / `Trash` / —— / `Close Tab Ctrl+W` / —— / `Quit`

> 两张截图由 main 进程置顶窗口 + `Menu.popup` 弹出**真实原生子菜单** + main 内 `desktopCapturer` 抓屏产出；详见 D-7 与 §4。

---

## 3. 全仓 grep 同类「Enter 才确认」输入框

见 §1.1 表：唯一违规为 `SidebarTree` RenameInput，其余（WikiLanding 标题/简介、LayoutSection 数值行）本已是 blur 提交姿势；TabsBar 无行内重命名输入。**未做与需求无关的改动**。

---

## 4. DEVIATION（待 PM 追认）

| ID | 偏差 | 原因与影响 |
| --- | --- | --- |
| **D-1** | 菜单代码拆两个文件：`menuTemplate.ts`（纯函数）+ `menu.ts`（`Menu.buildFromTemplate`/`setApplicationMenu` 装配）。任务书写「main 新建 menu.ts 用 Menu.buildFromTemplate」 | 若把模板函数与 `import { Menu } from 'electron'` 放同一文件，Node 环境单测导入即崩（既有纪律：main 的业务模块不 import electron，见 `main/settings.ts` 头注）。拆后 `menu.ts` 仍是 buildFromTemplate 的唯一落点，模板逻辑可在 Node 直测（`test/menu.test.ts` 8 例） |
| **D-2** | 语言切换**复用既有 `settings:patch` IPC** 触发菜单重建，未新增 locale 专用通道 | `settings.locale` 是语言真源，renderer 切语言必经 `settings.patch`；新开通道会给渲染器多一个能与设置状态漂移的入口。任务书要求「经 IPC 通知 main 重建」已满足（同一 IPC 的落盘回执里重建） |
| **D-3** | Edit 的 undo/redo/cut/copy/paste/selectAll 按任务书用 `role`，但统一加 `registerAccelerator:false`（Windows/Linux 有效） | 任务书两条要求在此冲突：「用 role」vs「避免双绑」。编辑器是页内 ProseMirror（自装 `prosemirror-history` + keymap），若由系统菜单抢注 Ctrl+Z/Y/C/V/A，页内撤销/复制会被截断。现为「菜单项语义=标准 role、快捷键仍归页内编辑器」，属**刻意的取舍**，请 PM 追认 |
| **D-4** | Close Tab 同样 `registerAccelerator:false`（加速键只展示不注册） | 让 Ctrl+W 完全保留改前的「renderer keydown + editorVisible 门控」路径（行为零变化），菜单点击为等价入口。任务书只要求「同键同动作 + 委托 tabs 逻辑 + 不 role:close」，三条均满足 |
| **D-5** | Help 仅「关于 Septcats」一项；「关于」用 `dialog.showMessageBox` 而非 `role:'about'` | `role:'about'` 只在 macOS 生效，本产品真机为 Windows；dialog 文案 title 走 i18n，正文为 app 名 + 版本（无 CJK） |
| **D-6** | File→New Page 新增 accelerator `CmdOrCtrl+N` | 任务书未禁止新绑定；全仓核查 Ctrl+N 无既有占用。真机验证 `route=main-side menuItem.click()`（见 D-7 末段） |
| **D-7** | 真机截图的抓取方法：经 main 进程 `--inspect` 读 `Menu.getApplicationMenu()`、`BrowserWindow.setAlwaysOnTop/moveTop` 置顶、`Menu.popup` 弹真实子菜单、main 内 `desktopCapturer` 抓屏；`docs/mockups/cdp-e2e-t51-01.mjs`（一次性探针；只开公开调试端口 + 调公开 API，**未改产品代码**） | 原生菜单栏**不在 web contents 内**，`page.screenshot()` 拍不到（webContents.capturePage 同）；且本会话应用窗口被其它窗口遮挡——跨进程 `desktopCapturer` 抓不到，必须由 main 进程自己置顶 + 抓屏。附带把「菜单到底装成什么样」以权威 JSON（label/role/accelerator/registerAccelerator）落进 results.json |
| **D-7b** | G3 首选路线「弹出真实子菜单后用 OS 级 ↓/Enter 触发菜单项」在本会话未生效（`osKeys` 返回 0 但页数未变；原生弹出菜单未取得键盘输入焦点），终值走**预案**：main 侧直接调用该菜单项的 `click` 回调（与真实点击同一处理器）→ `pages 3→4` | 菜单项在两张截图里可见且 JSON 证明其 click 已接 `handleMenuAction('newPage')`；建议 PM 真机再用鼠标点一次 File→New Page 复核 |
| **D-8** | `docs/perf-history.jsonl` 出现改动 | perf 测试的追加写入副作用，非本单编辑；本单不碰 git，未回滚 |
| **D-9** | App.tsx 抽出 `toggleSidebar` useCallback；`layout-ui.test.tsx`/`page-delete-ui.test.tsx` 假桥补 `menu` 字段 | 桥契约新增 `menu.onAction` 后，App 级测试的旧假桥会抛错；补字段是契约同步，非功能改动 |

---

## 5. 未决 / 遗留（交 PM）

1. **真机鼠标点击 File→New Page** 建议 PM 复看（D-7b：本会话 OS 级菜单键盘焦点不可达）。
2. 「跟随系统」语言分支：`patch` 写入的是解析后的 `zh-CN`/`en-US`（platform schema 不收 `'system'`），故菜单语言跟随系统语言的时机 = 该次 patch；系统语言在运行中变化不会即时反映（既有 T43-01-1 口径，本单未扩大范围）。
3. 页面重命名 → 页签标题实时性、侧栏行 blur 提交后的「未变化不发 op」均已单测覆盖；**未覆盖**「重命名提交后撤销（Ctrl+Z）」——重命名走 `pages.renamePage` 的 op 通道，是否入撤销栈属既有行为，本单未触碰。
4. 全仓测试 / 打包 / 安装包冒烟：留 PM。

---

## 6. PM 复跑节

（留空——由 PM 复跑后填写）

```
pnpm -C apps/desktop test        →  ？
pnpm -r typecheck                →  ？
node packages/ui/tokens/no-magic.mjs            →  ？
node packages/ui/tokens/build-tokens.mjs --check →  ？
node docs/mockups/cdp-e2e-t51-01.mjs            →  ？
```


## §PM 复跑（2026-09-21，独立）—— **16 PASS / 0 FAIL**

全仓 `pnpm -r test` 无红（desktop **651**=638+13 / dbview 122 / importer 59 / …）；typecheck **0 error**；`no-magic` ✓；`build-tokens --check` ✓；`selftest OK`。
真机独立复跑 `cdp-e2e-t51-01.mjs`：**16 PASS / 0 FAIL**，`realRoot untouched=true`。原始值摘录：
- G1-1 失焦改名：点别处 blur → `titles=["失焦改名成立","未命名","未命名"]`（**修前被 cancel 吞**）；G1-2 Esc 取消、G1-3 空值回退同绿
- G2/G5 双语真实 `ApplicationMenu`：zh 全中文（截图 42,012 B）/ 切 English 后 23 个 label 全英、零 CJK、结构同构（截图 29,338 B）
- G3-1 File→New Page：`pages 3→4, tabs 3→4`（真菜单项 click 处理器）
- G4-1 Ctrl+W：`tabs 4→3`、`pages 4→4`、窗口仍活（**无 role:close 事故**）

**DEVIATION 追认**：D-1（模板拆纯函数文件）/ D-2（复用 settings:patch）/ **D-3（Edit 六 role 用 `registerAccelerator:false` 防截断 ProseMirror）——追认为正确取舍**，验收实测 Ctrl+W 语义无恙；D-7b（OS 级菜单焦点不可达，改调 click 回调）追认，**留老板真机鼠标复点一次**（冒烟清单第 9 步）。
代码审读：`settledRef` 一次性结算、无新造协议、红线区（packages/DESIGN.md）零改动 ✓。
