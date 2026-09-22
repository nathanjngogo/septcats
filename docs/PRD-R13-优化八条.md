# PRD-R13 · 老板 09-22 晚两批「优化」8 条（收口版）

> 老板原话（两批，09-22 晚）：
> 批一：①编辑区 + 号和手的功能相反了 ②新建页面后图标换文件图标 ③所有下拉框点空白应关闭 ④侧栏可新建文件夹归类 ⑤页面操作增加重命名 ⑥右键文件名弹页面操作菜单
> 批二：⑦所有通知维持 3 秒自动关闭 ⑧左右侧栏用户可调宽度、≤总宽 30%
> PM 侦察定稿：本文件。默认值+我按这个做，不逐条等批。

## 侦察事实（证据在案）

| # | 现状 | 落点 |
|---|---|---|
| ① | 块簇 DOM 序=【+】【⋮⋮】（editor 包 BlockControls.tsx:176-202）；+=在下方插块、⋮⋮=操作菜单、整簇可拖（宿主 PageView.tsx:1150 壳 draggable+cursor:grab，T33 装订线几何钉死） | **裁决=视觉序对调为【⋮⋮】【+】**（Notion 惯例：抓手在左、加号贴右；行为零改动）。若老板要的是"点击行为互换"，一句话即改两行 handler。**⋮⋮ 拖不动问题**：壳 draggable 在 button 命中下不生效（HTML5 drag 在交互元素上不发起）——把 draggable 显式落到 ⋮⋮ 键本体，+ 键 draggable=false |
| ② | 顶栏新建=createPage(null)；行图标：树根=rootIcon(:364，Note)、子行=FileText(:364)、收藏/最近=FileText(:318) | 新建出的页面行图标统一 **FileText（文件图标）**；rootIcon 改 FileText；Wiki 分区头保持 Note 不动 |
| ③ | Menu.tsx **无** outside-click（grep=0）→ ⋮⋮ 块菜单/侧栏⋯/模板子菜单点空白不关；Popover/Select 已有；LayoutPicker/CommandPalette 有遮罩；CloseAskDialog 模态有遮罩 | 给 `packages/ui/Menu.tsx` 加 `pointerdown` outside-close（一处治全仓 Menu 实例，含 editor 块菜单=它自己的菜单组件另查）；editor 的 BlockControls 菜单自查同修；全族补审计清单进报告 |
| ④ | 无文件夹原语；pageTypeOf='page'|'wiki'|'database'（pages.ts:108）；树支持父子+movePage(:494)+Caret 折叠已有 | **文件夹=派生语义零协议改动**：行⋯/右键加「新建子页面（文件夹）」条目→createPage(该行 id)+进重命名；**有子页的页显示 FolderSimple 图标**（派生）；收纳手段=拖入或 movePage（已有）+⋯「移入…」二级选择器（本条含）。不动 SCHEMA/op-log（同步零风险） |
| ⑤ | 重命名只活在行内（双击标题→RenameInput，单一入口 renamePage/cancelRename :59-78），⋯ 菜单只有 全宽/转换/删除 | ⋯ 菜单 + 右键菜单加「重命名」条目→复用 beginRename 既有态（不新造） |
| ⑥ | 行无 onContextMenu（grep 0） | NavRow 加 `onContextMenu`→打开与 ⋯ 同一 Menu（复用 rowMenuId，不双份实现）；菜单位置=光标处（clamp 进视口） |
| ⑦ | ToastViewport（App.tsx:483）经 dismissToast 手动关；**自动关闭计时未在 ui/store 侦察到**——CB 先定位 pushToast 真源再统一 | **所有 toast（success/danger/任意）= 3000ms 自动关闭**；hover 不暂停（老板口径"维持 3 秒"）；多条各自独立计时；探针 getComputedStyle/定时实测 3±0.5s |
| ⑧ | 左：layoutState.sidebar.width 200–320 滑杆已有（T57）；右：AI 面板**无宽度字段**（ai={position,expanded}），CSS 定宽 | 两侧加**拖拽分隔条**（pointerdown→拖，实时 DOM 宽随动）；上限=**min(30% 视口, 现有 480px 类约束)**，下限保留 200/240；layoutState 加 `ai.width`+clamp 纯函数（可单测）+持久化（既有 septcats.layout v1，validate 容旧）；拖拽把手吃 ink-edge 2px 悬停反馈（T59 语法）；**折叠语义不变**（collapsed=0 仍走 position） |

## 拆单（同仓串行，T60 先行——都碰 SidebarTree）
- **T60-01**（①②③⑤⑥⑦，交互一致性批）：BlockControls 序+draggable 落点、行图标、Menu outside-close、重命名条目、右键菜单、toast 3s。
- **T61-01**（④⑧，结构批）：文件夹派生+移入选择器、双侧拖拽宽度+ai.width。
- 台账：R13；数据面零 schema 变更（两单都是 UI/派生/localStorage），0.4.1 feed 暂不动，验收后并入。

## 待老板一句话（不阻塞，默认已按上表做）
- ①：默认=**视觉序对调+⋮⋮ 可拖**；若你要的是两键点击行为互换，回一句话。
- ⑧：右侧=AI 面板宽度（当前唯一"右侧栏"）；上限 30% 指总窗口宽——按此实现。
