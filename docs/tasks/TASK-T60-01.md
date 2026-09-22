# TASK-T60-01 · P2：交互一致性批（老板 09-22 晚 R13①②③⑤⑥⑦）

> 前置真源：`docs/PRD-R13-优化八条.md`（侦察表就是你的施工图，勿重复调查）。
> 基线：0.4.0 + T59 像素边框（HEAD=0.4.1-rc.1 号段）。产出进 0.4.1。

## 0. 本单六件事（逐条钉死）

### 1️⃣ 块柄簇：视觉序对调 + ⋮⋮ 真能拖（PRD 裁决议价①）
- `packages/editor/src/react/BlockControls.tsx`：DOM 序【⋮⋮ 键】在前、【+ 键】在后（现在反着）。**行为不换**：⋮⋮=菜单、+=下方插块。
- 拖拽落到 ⋮⋮ 本体：`packages/editor` 内给 handle 键加 `draggable` 透传口（新 optional prop `dragHandleProps`，宿主注入；**不传=现状零变化**），宿主 `PageView.tsx` 的 pv-handle 壳 draggable **移除**、改注入到 ⋮⋮ 键（cursor:grab 也随迁到 ⋮⋮ 键），+ 键不可拖。
- 约束：T33 装订线几何（簇宽 58/70px padding）不许变；T53 立体语法（pv-handle bevel）随 grab 语义保留在壳上可以，但拖起必须从 ⋮⋮ 发起。既有用例里锁「新增块/块操作」aria-label 与 disabled 语义的**不许红**。

### 2️⃣ 新建页面行图标=文件（PRD②）
- `SidebarTree.tsx:364` rootIcon 路径：普通页（pageTypeOf==='page' 且非数据库）行图标一律 `FileText`；wiki/database 行现状保持；Wiki 分区头 Note(:500) 不动。
- 即：顶栏「新建页面」出来的行、树根级新页，显示的都是文件图标。

### 3️⃣ 所有下拉/弹出菜单：点空白即关（PRD③）
- `packages/ui/src/Menu.tsx`：`useEffect` 挂 `document.addEventListener('pointerdown', …)`，点击不在 `rootRef.current` 内 → `onDismiss()`（与 Escape 同出口；卸载清理）。注意与「点击行 ⋮⋮ 本身切换开合」的竞态：同一 pointerdown 里 toggle 钮命中不算 outside（用 contains 判定包含钮宿主或捕获阶段防抖，选一个并写注释）。
- `packages/editor/src/react/BlockControls.tsx` 的菜单是**自实现**（非 ui/Menu）：同样加 outside-close（同一语义）。
- 全仓盘点报告：LayoutPicker（遮罩已有✓）、CommandPalette（overlay✓）、CloseAskDialog（模态✓）、Select/Popover（✓）逐一写明"关闭途径=何处"，不许静默跳过。

### 4️⃣ 页面操作菜单 + 右键（PRD⑤⑥，一次做透）
- ⋯ 菜单（SidebarTree.tsx:399 的 Menu items）新增 `{ id:'rename', label:t('sidebar.rename') }`（放 delete 之前、非 danger）→ onSelect 调**既有** beginRename 路径（双击行用的那套，勿新造 state）。
- NavRow 加 `onContextMenu`：preventDefault + `setRowMenuId(node.id)`（与 ⋯ 同一 Menu 实例渲染，位置=光标处：Menu 宿主容器加 `style={{left,top}}` clamp 视口内；Esc/点空白/选条目关）。右键到 ⋮⋮/折叠钮等子控件上不弹（命中判定）。
- i18n：zh `重命名` / en `Rename`；右键不新增键则不加键。

### 5️⃣ 全部通知 3 秒自动关闭（PRD⑦）
- 先定位 toast 队列真源（`pushToast`/`dismissToast` 在 `state/pages.ts`+`store.ts` 一带，PRD 侦察=自动关闭计时不存在）。
- 实现：toast 入队时 `setTimeout(3000)` 自弹（每条独立计时；danger 不例外——老板口径"所有通知"）；hover 不暂停；定时器在 dismiss/卸载时 clear（无泄漏，测试里用 fake timers 断言 2999ms 仍在/3001ms 消失）。
- 收口口径：全仓 toast 只有这一个出口（若发现多源，合并到单源并在报告登记）。

## 1. 测试（数字全真跑）
- ui/Menu outside-close 单测 ≥3（fake pointerdown：外点关/内点不关/卸载摘监听）；BlockControls 菜单 outside-close ≥1；rename 菜单项渲染+触发 beginRename ≥2；右键 onContextMenu 开合 ≥2；toast 3s fake-timers ≥2；块柄 DOM 序断言 ≥1（⋮⋮ first + draggable 在 ⋮⋮）；图标断言（新页行 FileText）≥1。
- 老账：`layout-fusion-t52`、`borders-t59`、T42-01 wiki 分区、T44 双链相关断言零回归；desktop ≥783+12。

## 2. 真机探针 `cdp-e2e-t60-01.mjs`
- 块编辑页：hover 块→断言簇内 ⋮⋮ 在左 + 键在右；**拖 ⋮⋮ 真发起 drag**（dragstart 事件捕获 + 落位后块序变化实证，用 DataTransfer 模拟或 CDP 拖拽，原始值进报告）；点 ⋮⋮ 菜单仍开、点正文空白→菜单关（before/after aria-expanded）。
- 侧栏：右键一行→菜单弹在光标处（截图）→点「重命名」→行内输入框出现→改名→行标题变化（DB 侧标题同步断言）；⋯ 菜单含重命名条目；新页行图标=FileText（DOM/aria 断言）；toast：触发一条（如转换 wiki）→3.2s 后消失（轮询时间戳）。
- 双主题截图 ≥4 张 `screens-t60/`；1184/894 零滚动复验；真档案 untouched；electron 计数 0。

## 3. 红线
- 不碰 `packages/core|db|schema|sync|importer|platform`；op-log 协议/SCHEMA_VERSION 零变更（本单纯 UI/交互）；`packages/editor` 只动 BlockControls/icons 相关与本单测试；`packages/ui` 只动 Menu.*；apps/desktop 只动 PRD 点名文件+探针/测试/ i18n；不加依赖；不碰 git；禁 TODO；真档案只读。
- 报告骨架**开工第 2 步先建**（`docs/tasks/TASK-T60-01-report.md`，数字留（PM 补）占位），倒数第 2 步填真实数字；每写完一个测试文件立即跑；交付杀净 electron 贴计数=0。
- 任务书前提与代码事实不符：最小改动补齐+记 DEVIATION，勿静默绕过。
