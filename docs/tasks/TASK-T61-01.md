# TASK-T61-01 · P2：结构批——侧栏文件夹 + 左右栏拖拽宽度（老板 09-22 晚 R13④⑧）

> 前置真源：`docs/PRD-R13-优化八条.md`（侦察表）；基线=T60 收口后（⋯ 菜单/右键已有"重命名"，别重复实现）。
> 本单零协议变更红线：op-log / SCHEMA_VERSION / 迁移号一律不动——文件夹是**派生语义**（有子页的页=文件夹长相）。

## 1️⃣ 侧栏文件夹（PRD④）

1. **新建文件夹**：⋯ 菜单与右键菜单（T60 已建）各加条目「新建子页面」→ `pagesActions.createPage(该行 id)`（既有 API，parentId 已支持）+ store 已自动进重命名（新页语义=文件夹：它是拿来装东西的容器）。i18n：zh「新建子页面」/ en「New subpage」。**不造"文件夹"新实体**。
2. **派生文件夹外观**：`SidebarTree` 行图标规则改：`pageTypeOf==='page' && 该页有活子页` → `FolderSimple`；无子页 → `FileText`（T60 的②保持）；wiki/database 现状不动。判定用既有 `nodes` 树（parentId 反查索引，O(1) useMemo，别每次全树扫）。
3. **移入**：⋯/右键再加「移入…」→ 二级选择（复用 Menu：列 全部活页（page 类、排除自身与自身后代——防环，`ancestorsOf` 反向可用）+ 「工作区根」项）→ 调既有 `movePage({id,newParentId})`（:494）。移动后子树折叠态跟随目标。
4. **拖入（增强，若 T52 拖拽基建可用就做）**：页面行 drop 到另一页面行上 = movePage 进其子级（HTML5 dnd，行加 `data-page-drop` 高亮 ink-edge 2px 描边反馈）；**做不到稳就砍**，DEVIATION 登记。
5. 展开/折叠：有子页行左侧 Caret 已有（:176）——确认文件夹长相与 Caret 语义自洽（点 Caret 折叠子树、点行打开页）。若现状点行不展开，加：折叠态文件夹被点选时**同时展开其子树**（一次性视图态即可，写测试）。

## 2️⃣ 左右侧栏拖拽宽度（PRD⑧）

1. **layoutState 纯函数扩展**（全可单测）：`sidebar.width` 现 200–320 → 上限改 `min(480, viewport*0.30)`；新增 `ai.width`（默认 320，值域 [240, min(480, viewport*0.30)]）；`clampLayout/validate` 同步（旧持久化 v1 无 ai.width → 默认值兜底，**不许判脏**）；新增纯函数 `maxPanelWidth(viewportW)=min(480, floor(viewportW*0.3))`。30% 口径=总窗口宽。
2. **拖拽把手**：左=侧栏右缘 `ResizeHandle`（`.app-side` 与主区交界，4px 命中/2px ink-edge 悬停显形，吃 T59 语法）；右=AI 面板左缘同款。`pointerdown→setPointerCapture→pointermove` 写 width（throttle 到 rAF），`pointerup` 落盘（走既有 patchLayout，preset 自动转 custom——与 T57 滑杆同一真源）；双击把手=该侧回默认宽。键盘可访问：←/→ 步进 16px、Home=默认（aria 语义照 T57 滑杆口径）。
3. **联动**：T57 编辑器/布局滑杆的宽度控件值域改为动态（跟随视口 30% 上限）；`layoutPreview*` 百分比函数用新值域不破预览图；侧栏 collapsed(=0) 语义不变（把手在折叠态隐藏）。AI 面板 width 对 `position:'bottom'` 无意义→把手只挂 right 态。
4. **持久化**：septcats.layout v1 兼容（validate 兜底），不升版本号（纯增字段）。重启还原断言进探针。
5. **测试**：maxPanelWidth/clamp/validate 兜底 ≥6；把手 pointer 模拟改宽+落盘 ≥3；双击回默认 ≥1；键盘步进 ≥2；上限=30% 越界钳制（视口 1000→上限 300）≥2；desktop ≥基线+14。
6. **真机探针 `cdp-e2e-t61-01.mjs`**：拖左缘→侧栏 getBoundingClientRect 实随（原始值进报告）+ 松手后 localStorage `septcats.layout` 断言；拖到极限→钳制在 30% 实测；拖右缘→AI 面板宽实随；重启探针会话→宽度还原；新建子页面→父行图标变 FolderSimple（截图）→ 移入选择器移动一页→树形变化断言（真档案 untouched）；1184/894 复验+双主题把手截图 ≥5 张 `screens-t61/`；electron 计数 0。

## 红线
不碰 core/db/schema/sync/importer；ui 包只动 Icon 出口内需件（够用，FolderSimple 已有）；apps/desktop 动 SidebarTree/layoutState/layout 组件/探针测试 i18n；不加依赖；不碰 git；禁 TODO；真档案只读；报告骨架开工第 2 步先建、数字倒数第 2 步填；每测试文件立写立跑；与代码事实不符→最小补齐+DEVIATION。
