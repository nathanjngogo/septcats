# TASK-T70-01 · P2：库层级 UI（老板 R20 条目①②——纯前端零协议单）

> 前置真源：`docs/PRD-R20-库与模板市场.md`（§2 现状侦察 = 你的施工图）。基线=main HEAD（0.4.1-rc.6，T68 像素望远镜后）。
> 侦察已钉死：`pagesActions.createWorkspace / renameWorkspace / switchWorkspace / load` **全链路已存在**（state/pages.ts:784/794/805，含 toast 文案），workspaces IPC 五通道齐全（preload:90-101），每库 tabs 已隔离（writeTabs 按 workspaceId）；**唯缺 delete——本单不做删除库，越界即红线事故**。

## 0. 本单三件事

### 1️⃣ 侧栏头 = 库切换器（SidebarTree.tsx:727 `.app-side-head`）
- 现在是纯展示 div（FolderSimple + workspaceName）。改为可点行（hover 出 ▾ 像素 caret，role=button，data-testid="side-ws-head"）：点击弹 `@septcats/ui` Menu（**outside-close/键盘导航免费继承，别自造浮层**），锚点贴头下方。
- Menu items：每个库一行（当前库 ✓ 前缀，同款 fullWidth 打勾语法）+ 分隔语义项「新建库…」「重命名当前库…」（≥2 库时才在切换列表内显示其余库；单库时列表只有当前库，动作项照出）。
- 选库 → `pagesActions.switchWorkspace(id)`；「重命名当前库…」→ 头行原地进输入态（复用行内重命名交互语法，Enter 提交 → `renameWorkspace(id, name)`，空名/同名=放弃，Esc=放弃；口令类 blur 例外不适用这里——blur 即放弃可接受，记 DEVIATION 即可）。

### 2️⃣ 新建库弹框（名字 + 类型三选卡）
- 像素 Dialog（LockDialog 先例：`Dialog` + 像素边 + no-magic）：一行名字输入（autofocus）+ **类型三选卡横排**：工作台库 / 知识库库 / 空白库（每卡=局部像素小插画 + 名 + 一句话说明；选中态描边加粗，同主题画廊卡语法）。
- 确认 → `createWorkspace(name)`（内部已 load+toast），成功后按类型做种（见 3️⃣），最后 `switchWorkspace(新库)`（若 create 后未自动切则显式切，以 load 后 activeId 为准）。
- 名字空=确认禁用；重名=允许但 toast info 提示（数据层无唯一约束，别自造拦截）。

### 3️⃣ 类型种子（只走既有通道，main 零改动）
- **工作台库**：切库后 `workbenchActions.setView('home')`（state 已有视图切换；找不到就 DEVIATION 记录用现有最接近 action）。
- **知识库库**：新库下 `pagesActions.createPage(null)` ×5 建结构页，标题= 收件箱 / MOC 目录 / 资料 / 日志 / 归档（走 i18n key，en=Inbox/MOC/Resources/Journal/Archive）。**createPage 会开标签+进行内重命名=副作用雷区**：逐页建完后要清多余标签（closeTab 既有 action）并把 editingId 退出（Esc 语义），最后只留「MOC 目录」一页打开。正文不种（降级口径，PRD 已预授权记 DEVIATION）。
- **空白库**：无种子。
- 三类型建库后：收藏/最近/树形天然按库隔离（load 已处理），别碰 fetchAll。

### 4️⃣ 文案：用户可见「工作区」→「库」
- zh-CN i18n 全盘点 `工作区/workspace` 字面（sidebar.workspace、app.noWorkspaceToSwitch、pages.toastWorkspace*、设置页等），只改**值**不改 key；en 侧「Workspace」保留或视语境改「Vault」（侧栏/弹框用 Vault 更短）。命令面板「切换工作区」命令文案同步。

## 红线
- main/preload/shared/ipc **零改动**（delete 通道不存在→UI 也不提供删除入口）。
- 不碰 op-log/SCHEMA/migrations/锁面；不建新表；不加依赖；不碰 git。
- 每写完一个测试文件立即 `npx vitest run --reporter=basic <文件>` 跑绿再写下一个。
- 交付前：electron 进程计数=0 贴证据；探针/单测用隔离夹具，真实数据根 untouched。
- 收尾顺序：倒数第 2 步填报告数字（骨架先建：docs/tasks/TASK-T70-01-report.md）。

## 验收锚（PM 真机复跑口径）
- W1 头行可点弹 Menu（当前库 ✓ + 新建/重命名项）；W2 建 3 类型库各一 → 切换列表增长、切库后树/收藏/最近隔离、tabs 各自还原；W3 知识库库=5 结构页落新库且无多余标签/无卡死重命名态；W4 工作台库=切过去即见 home 工作台；W5 重命名当前库=原地输入→落库→头行即变；W6 文案盘点后 zh 界面不再出现「工作区」（截图证）；W7 老库数据无损（升级后 1 号库=原「个人工作区」，原页面全在）；W8 真根 untouched + 退出计数 0。
- 老探针零回归：T61/T60/T65/T67-B2/T59（PM 连跑）。desktop ≥951+新用例。
