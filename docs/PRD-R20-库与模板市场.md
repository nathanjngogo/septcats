# PRD-R20 · 库（Workspace）层级 + 工作台模板市场（老板 09-23 四条 + Obsidian 生态研究）

> 老板原话：①个人工作区上加一层「库」，可新增库，库的下级=新建页面/收藏/最近/Wiki/页面；②库可定义为工作台，也可建知识库（用户自定义结构）；③现有工作台按钮改为「工作台模板市场」；④市场不光提供模板，还要提供卡片供自行搭建。
> 补充指示：「看看 Obsidian 的插件，研究一下这个工作台」→ 本 PRD §1 为研究结论，直接决定设计口径。

## 1. Obsidian 生态研究结论（2026-09-23，八个代表插件）

| 插件 | 关键机制 | 对 Septcats 的取舍 |
|---|---|---|
| **Hearth** | 25+ 卡片类型；自由网格拖拽+缩放；多仪表盘一键切换；自动探测已装插件并生成对应卡 | 多仪表盘=我们的多库工作台雏形；「卡片类型注册表」模式照抄 |
| **Homepage Dashboard** | 零配置扫描现有库；**不建私有数据库**，任务勾选写回原 Markdown 文件 | ★铁律：卡片是视图不是数据孤岛，写回页面/块（我们 CRDT 天然支持） |
| **Xove / O-Dashboard** | 一切存 Markdown+frontmatter；灵感看板/项目管道/倒计时；长按拖布局 | 布局即数据（type+props+位置 JSON）；模块可增删隐藏重置 |
| **Dashboards (kevinmcaleer)** | 12 列网格；6 widget 类型；布局以 YAML 块存在笔记里=可移植可分享 | **模板=一份卡片布局 JSON**，可导入导出→市场的「模板」就是这个 |
| **Cockpit** | 编辑模式（拖排序/显隐/持久化）；局部静默刷新不打断编辑 | 工作台加「自定义模式」开关，与 T66 卡序/隐藏态打通 |
| **Modular Theme Dashboard** | 25 模块绝对定位画布；8 主题；+号加模块 | 我们用网格不用绝对定位（像素风对齐更干净） |
| **Mengshi 猛士驾驶舱** | Tab 分区（日历/项目/待办/甘特）各自可独立开关 | 卡片粒度开关=市场安装的逆操作（卸载卡片） |
| **社区插件市场整体范式** | Browse → Install → Enable 三段；模板包=starter vault（结构+示例内容） | ★市场的两层语义：**模板包**（整套结构/布局）与**单卡片**（原子组件）——正对老板④ |

**提炼三条设计原则**：
1. **数据主权在页面**：卡片实例只存「类型+配置+位置」，内容读写全部走既有 pages/blocks/op-log 轴，不建新数据表（锁/同步/迁移零波及）。
2. **模板=声明式 JSON**：模板包 = `{卡片布局 + 结构页种子（新建知识库的 MOC/收件箱骨架）}`，内置模板存 main 资源，用户可「另存当前为模板」。
3. **市场=目录页，安装=实例化**：不引入任何外码执行（本地优先/无后端）；「安装」只是写配置 + 复制模板内容，「启用/停用」=卡的 hidden/order（T66 已有机制，扩类型即可）。

## 2. 现状关键事实（侦察到行号，CB 勿重复调查）

- **多库后端已存在但 UI 未暴露**：`workspace` 表 + `pages.ts:108 listWorkspaces() / :109 createWorkspace({name})` + preload `workspaces:{}`（App.tsx:85 已有 `switchWorkspace` 命令面板循环切换，`app.noWorkspaceToSwitch` 提示词在）。`WorkspaceSummary={id,name}`。op-log 轴天然带 `workspace_id`（core/op.ts:129）→ **每库数据已隔离，R20 是补 UI 不是改协议**。
- 侧栏头 `SidebarTree.tsx:727 .app-side-head`（FolderSimple+workspaceName，不可点）。
- 工作台：`workbench/`（T66）5 内置卡 `WORKBENCH_CARD_IDS=['quick','todo','database','recent','favorites']`，`state.ts` 已有 order/hidden 持久化（`septcats.workbench.cards` v1）；顶栏房子钮 `App.tsx:557 workbench-open` 切 home/pages 覆盖编辑区。
- 模板：`state/templates.ts`（页面内容模板，createFromTemplate）与卡片体系**目前无交集**。
- 库=「个人工作区」文案散布 i18n（`sidebar.workspace` 等）。

## 3. 拆解（三单串行；全部进 0.4.2）

### T70-01 库层级 UI（条目①+②的类型半件）
> 侦察定论：`workspaces.list/create/rename/switch/onChanged` IPC **全链路已存在**（preload:90-101），
> `switchWorkspace` renderer 侧已在用（App.tsx:85）；**唯缺 delete（无通道，开口项，见 §5）**。
> 本单=纯前端，main/preload/shared/ipc 通道面零改动。
1. 侧栏头（SidebarTree.tsx:727 .app-side-head）改**库切换器**：点击弹 Menu（T60 outside-close 免费继承）——全部库列表（当前 ✓ 位）、「新建库…」、「重命名当前库…」（行内改名或弹框均可，复用 rename 通道）。
2. 新建库弹框：名字 + **类型三选卡**（工作台库 / 知识库库 / 空白自定义）——类型只决定「建库时种什么内容」，之后无差（用户可自定义结构=老板②）。
3. 类型种子（全走既有 `workspaces.create` + `pages.create` 通道，不新建 IPC）：空白=现行默认首页；知识库库=在新库下种 5 结构页（收件箱 / MOC 目录 / 资料 / 日志 / 归档，标题即语义，正文可空——种子正文若需 commit 块则用 blocks.commit 既有通道，若形状不合则降级只建页，记 DEVIATION）；工作台库=建库后自动触发一次 home 工作台（workbenchView='home'）。
4. 文案体系：用户可见「工作区」→「库」（zh/en i18n 全盘点；代码/数据层词 workspace 不改）。
5. 红线：不碰 op-log/SCHEMA/锁表/main 任何服务；工作台卡与市场文件不建表（配置全走 localStorage/settings JSON，同 T66 口径）。

### T71-01 卡片注册表 + 自定义模式（条目④的搭建引擎）
1. 卡定义注册表化：`WorkbenchCardDef={id,label,desc,render}`，内置 5 卡迁入 + **新增原子卡 ≥6 种**（快捷方式/倒计时/近7日热力/引用摘抄/书签链接/库统计）——全部遵守 §1 原则 1（数据写回页面或 settings，无新表）。
2. 工作台「自定义模式」开关（Cockpit 式）：编辑态出拖拽排序（T60 ⋮⋮ 语法）、卡右上角 ⊟ 移除、底部「+ 添加卡片」→ 卡目录弹框（= 市场卡片 Tab 的前端形态）。
3. 布局持久化扩 v2：`{v:2, order, hidden, sizes?}`，v1 兜底迁移（validate 模式同 layoutState）。

### T72-01 工作台模板市场（条目③+④的壳）
1. 顶栏钮改「工作台模板市场」（像素 glyph 重绘：房子→店铺/货架；label/i18n/快捷键 Alt+H 语义改=开市场，原工作台入口并入「我的工作台」行内钮+命令面板）。
2. 市场页=全屏视图（学 LayoutEditorPage 壳）：两 Tab **模板 / 卡片**；模板卡带预览缩略（像素插画）+「应用于当前库」（替换卡布局+种内容页，先弹确认+一键备份当前布局）；卡片列表带 安装/启用中/停用。
3. 内置模板 ≥4：工作日志流 / 项目作战板 / 阅读追踪 / 周复盘（=声明式 JSON：卡布局+种子页，存 main 资源目录，随包更新）。
4. 「另存为模板」：当前工作台布局+所选页 → 用户模板库（存数据根 `templates/workbench/`，走既有 templates slice 扩 type 字段）；市场显示「我的模板」分区。
5. 导入/导出：模板=单 JSON 文件（Dashboards 的 YAML-in-note 思路的中文化：可贴可存）。

## 4. 验收锚（PM 真机口径）
- T70：建 3 种类型库→切换→树形/收藏/最近按库隔离实测；删库确认流；老数据升级后原「个人工作区」=1 号库无损。
- T71：自定义模式拖卡排序+添加+移除+重启还原；新卡逐一功能断言（热力卡真聚合 7 天数据等）。
- T72：市场开合/两 Tab/应用模板前后布局可一键还原/另存为模板→出现在我的模板/导出 JSON 再导入还原；老探针 T61/T60/T65/T66/T67-B2/T59 零回归。
