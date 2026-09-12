# TASK-G2-01 · UI 骨架与设计 Token 系统（设计工程）

> 发件人：Hermes（PM，兼设计把关）｜ 收件人：CodeBuddy
> 依据：`docs/PROJECT_PLAN.md` §16 UI 红线（先读 10 遍再动手）。SSOT tokens 文件：仓库根 `DESIGN.md`（PM 提供，见 §0）。
> 本任务 = 把设计系统落成**可运行的组件层**，并交付 **10 屏 HTML mockup** 供老板逐屏确认。

## 0. 你的输入
1. 仓库根 `DESIGN.md`（Google design.md 规范：YAML front matter 是**唯一 token 来源**；禁止在任何 CSS/TSX 里写死颜色/字号/圆角/阴影/时长，违者打回）。
2. 计划书 §16（Design Read：安静的、精确的、带一点猫须般灵巧的桌面书写工具；Linear 级克制 × 中文编辑部呼吸感；dials V4/M4/D3|6）。

## 1. packages/ui（新包 @septcats/ui）
```
tokens/    # 从 DESIGN.md YAML 生成 CSS 变量 + TS 常量的脚本与产物
  build-tokens.mjs   # 解析 DESIGN.md front matter → tokens.css（:root + [data-theme=dark]）+ tokens.ts；CI 校验产物与 DESIGN.md 同步（不一致 exit 1）
styles/    # 基础层：reset.css、typography.css（CJK 标点挤压、中英自动空格由排版规则提供 utility）、scrollbars.css
components/
  Button.tsx（primary/secondary/ghost/destructive × sm/md/lg × loading/disabled；:active 1px 位移；focus-visible 环用 token）
  IconButton.tsx  Input.tsx Select.tsx Checkbox.tsx Switch.tsx Tooltip.tsx Kbd.tsx
  Menu.tsx Popover.tsx Dialog.tsx Toast.tsx（含队列） Skeleton.tsx Spinner.tsx（仅图标级；禁全屏转圈）
  Tag.tsx Avatar.tsx Divider.tsx EmptyState.tsx ErrorPanel.tsx（四态组件是本包一等公民，§16.4）
  Icon.tsx —— 只 re-export @phosphor-icons/react，统一 strokeWidth=1.5 与 size 档位；全仓禁止直接 import phosphor
  theme.ts —— ThemeProvider：浅/深/跟随系统；切换时 <html data-theme> + view-transition 淡切（120ms，reduced-motion 降级直切）
index.ts   # 全部导出；每个组件一个 .test.tsx（vitest + @testing-library/react + jsdom）
```
- 质量红线（每个组件适用）：双主题下对比度 ≥WCAG AA（用 tokens 计算，测试快照含 tokens）；键盘可达（Tab 序、Esc、方向键按 WAI-ARIA APG）；`aria-*` 正确；动效只 transform/opacity。
- 依赖白名单：react、react-dom、@phosphor-icons/react、clsx。**不装 Tailwind**（手写 CSS modules 或 one-file-per-component 的 css，配 tokens.css）。

## 2. apps/desktop 接入
- 全局挂 ThemeProvider + tokens.css；App.tsx 替换为 §3 的**应用壳**（仅壳，不做业务屏）。
- 应用壳（Electron 无边框 `titleBarStyle: 'hiddenInset'` 自定义标题栏）：
  - 顶栏 40px：窗口控制(仅 Win；mac 用系统交通灯位)、当前页面面包屑（假数据）、右侧搜索触发钮 + 同步状态钮 + 设置钮（均 IconButton，aria-label）。
  - 左栏 240px：可折叠导航（假数据）+ 底部工作区切换占位。
  - 内容区：路由占位（M 系列后填）。
  - 全部尺寸来自 tokens（`--layout-*`）。

## 3. 10 屏 HTML mockup（老板逐屏确认物，最高优先）
`docs/mockups/01-editor.html` … `10-trash.html`：
01 编辑器（空态页 + 有内容页两态，含块手柄、斜杠菜单打开态、选区工具条）
02 侧栏页面树（展开/折叠、hover、拖拽插入线）
03 数据库表格视图（筛选条、多选行、单元格编辑态）
04 命令面板 Ctrl+K（搜索态 + 命令态 + 空结果态）
05 搜索结果页（分组 + 高亮）
06 设置（通用/外观/同步/AI/关于 5 分区，含主题切换即时预览）
07 同步状态面板（上次成功时间、待传队列、进度、暂停钮 —— 「异步可靠同步」叙事落地在此）
08 冲突清单页（LWW 冲突的可见化处置：保留双方/丢弃一方）
09 导入向导（选 zip → 预览报告 → 确认执行，M12）
10 回收站 + 空态（猫线描插画用占位框，真插画 PM 后补）
每屏要求：
- 单文件、零依赖、`<link>` 引同目录 `tokens.css`（从 §1 产物复制一份进 docs/mockups/），双主题切换钮（浅/深）+ 125% 缩放适配检查。
- **像素级自洽**：间距、层级、四态、focus 环全部体现 §16；假数据禁止 "Lorem ipsum / John Doe"，用真实感的中文笔记内容（例：《暗物质探测实验笔记》、阅读清单含《哥德尔、艾舍尔、巴赫》）。
- 桌面应用壳比例（1440×900 设计基线，1200 宽可用）。

## 4. Definition of Done
```bash
pnpm -r typecheck && pnpm -r test            # ui 包组件测试全绿
node packages/ui/tokens/build-tokens.mjs --check   # tokens 产物与 DESIGN.md 一致
pnpm -C apps/desktop dev                     # 壳可运行、主题切换可看
ls docs/mockups/*.html | wc -l               # == 10
# 每屏截图（浅+深）存 docs/mockups/screens/，报告列出
```
交付报告格式同 TASK-M0-M1-01 §7。开工前：读 DESIGN.md + §16 全文；用 3-5 行复述设计纪律；若某条规则彼此冲突，停止并在 DEVIATIONS 提出，不要自行取舍。
