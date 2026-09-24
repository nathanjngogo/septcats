# TASK-T77-01 · 代码块语言栏 + 图片宽度拖拽（R26 第一单）

> PRD=`docs/PRD-R26-编辑器体验包.md` §1（必读）。基线 main `060bb03`。
> 工作目录=主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖（**editor 包 deps 只有 @septcats/core+@tiptap/*+yjs 系+zod，peerDep 仅 react——浮层控件复用包内 BlockControls 菜单同款原生实现范式，不新增 @septcats/ui 依赖**）。
> 开工侦察三问写报告 §0：① 代码块 NodeView/渲染归属（editor blocks.ts？PageView 簇？）与 lang/wrap attr 现有写路径（markdown 粘贴链）；② image 块渲染位与 width attr 现语义（像素 or 百分比，取现有默认值样本）；③ 代码块语言切换后高亮是否存在（若编辑器当前**无语法高亮引擎**，lang attr 的 UI 价值=为导出/未来高亮保留真相层——此时 B 项标签仍做，口径记 §0，禁自行引入 highlight.js）。

## 范围

### A 代码块语言栏 + 换行开关
1. 聚焦（caret 进入）代码块时，块右上角浮出工具条：**语言下拉**（自动 + 12 语言白名单：javascript/typescript/python/bash/json/html/css/sql/markdown/yaml/rust/go——常量数组放包内）+ **换行切换钮**（wrap）。
2. 选择/切换 → 写块 attr（lang/wrap）→ 走既有 patch op 通道（与 T60 转换同类路径）；blur 后工具条收起、左上角淡显 lang 标签（默认/空=不显）。
3. 浮层样式全吃 `var(--sc-*)` token（背景 surface/描边 ink-edge 2px 像素口径/文字 ink）；钮=复用 `.wb-pixbtn` 同款观感（editor 包内实现，勿 import 应用层 CSS 类名跨层引用——按包内既有 class 前缀风格 sc-*）。

### C 图片宽度拖拽
4. 图片块右缘拖拽柄（hover 显形，pointer/mouse 事件同 T60 把手口径）：拖动写 `width` attr；档位吸附（按 §0-② 侦察到的 attr 现语义设计：百分比 25/50/75/100 或 8px 步进，二选一记 §0）；键盘等价不做（同 T76 D-6 口径）。
5. 拖拽中浮显当前宽度百分比标签（token 化，松手即收）。

### 测试与 i18n
6. 单测（packages/editor/test/ 就近 + apps/desktop/test/ t77-*）：lang/wrap/width attr 写入往返（patch→投影）；语言常量表；拖拽档位吸附纯函数；聚焦显形/blur 收起态机（jsdom 事件模拟）。
7. i18n：控件可访问名 zh/en 成对（走 T76 `blockLabels` 注入通道同款）；斜杠菜单字面量维持既有口径（T76 D-11 先例）。

## testid 契约
`codebar-lang-<id>`（下拉钮）、`codebar-lang-opt-<lang>`（选项）、`codebar-wrap-<id>`、`code-lang-tag-<id>`、`image-resize-handle-<id>`、`image-width-badge`。

## 红线
§16/R14/no-magic；op 类型零新增（只 patch 既有 attr）；不建表不加 npm 依赖；禁省略号占位；启动零外联；中文禁「数据库」词纪律零回归；**T78 的跨块选择不碰**（本单零涉及，那是下一单）。

## 交付
报告 `docs/tasks/TASK-T77-01-report.md`（骨架已建：§0 侦察 → §1 DoD → §2 计数 → §3 DEVIATION → §4 文件 → §5 红线 → §6 门禁）。门禁四件套原始输出（基线 desktop 1094 / ui 168 / tsc 0 / no-magic，只增不减）。收尾打印 `CB-T77-01-EXIT=0`。
