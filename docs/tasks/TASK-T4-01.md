# TASK-T4-01 · packages/ui 组件层 + DESIGN.md token 构建管线（§16 红线落地）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T3 已合入。**必读：根目录 DESIGN.md（全文）+ docs/PROJECT_PLAN.md §16 + docs/mockups/mockups.css（视觉基准，组件必须与 mockup 同貌）。**
> 纪律：只 Write/Edit；不跑终端命令、不碰 git。UI 包是你的主场，质量红线高于速度。

## 0. 目标
新建 `packages/ui`：① DESIGN.md → tokens.css/tokens.ts 生成器 + `--check` 一致性门禁；② 全量基础组件（§16 四态与双主题是组件定义的一部分）；③ apps/desktop 接入 ThemeProvider 并把 renderer 换成应用壳。**壳的视觉必须与 01/02 mockup 一致（评审基准即此两屏）。**

## 1. Token 管线（先做这个，它卡所有组件）
```
packages/ui/
  tokens/DESIGN.source.md      # 构建时读仓库根 ../DESIGN.md（相对路径参数化），勿复制副本
  tokens/build-tokens.mjs      # YAML front matter → src/tokens.css（:root 浅色 + [data-theme=dark] 用 DESIGN.md「深色主题映射」表）+ src/tokens.ts（TS 常量）
                               # CLI: node tokens/build-tokens.mjs [--write|--check]；check 模式 diff 不一致 exit 1 并打印差异
  src/tokens.css src/tokens.ts # 产物（提交入库，CI check 防漂移）
```
深色值映射表在 DESIGN.md prose 内——解析它（markdown 表，列: token|light|dark|备注）驱动 [data-theme=dark] 生成。**未知 token 出现在表里但 front matter 没有 → check 报错**（防两套真相）。

## 2. 组件清单（src/ 每组件一目录或一文件+同名 .test.tsx + .css）
基元：`Icon`（re-export @phosphor-icons/react，size 档 16/20/24，strokeWidth 1.5 固定；全仓禁止直接 import phosphor）、`Button`（primary/secondary/ghost/destructive × sm/md × loading/disabled；:active translateY(1px)）、`IconButton`、`Input`（label 上/helper 中/error 下固定结构；focus 环 token）、`Checkbox`、`Switch`、`Select`（原生 listbox 语义可用 div+aria 实现）、`Kbd`、`Tag`、`Divider`、`Tooltip`（hover 400ms 出，Esc 关）、`Menu`（方向键+Enter+Esc，aria-menu）、`Popover`、`Dialog`（焦点圈闭）、`Toast`（队列 ≤3）、`Skeleton`、`Spinner`（仅图标级）、`EmptyState`（插画位+一句+主按钮）、`ErrorPanel`（说明+重试）、`ProgressBar`。
主题：`theme.tsx`（ThemeProvider + useTheme；localStorage 记忆 + 跟随系统 matchMedia；切换 120ms 交叉淡化，reduced-motion 降级直切）。
布局壳：`AppShell.tsx`（Topbar 40px + Sidebar 240px 可折叠 48 + main 插槽）+ `Breadcrumb` + `SyncPill`（三态 idle/busy/alert+角标，title 含「上次同步」）。
每组件 CSS 只用 `var(--sc-*)` token 变量，**字面值 hex/px 除 1px 与 0 外零出现**（lint 脚本 `tokens/no-magic.mjs` 你写：正则扫 src/**/*.css 找 #hex 与 ≥2 次重复的裸 px，exit 1）。

## 3. 测试（vitest + @testing-library/react + jsdom，devDeps 已在白名单见 §6）
每组件最低集：渲染快照（含 `[data-theme=dark]` 类名断言）、键盘可达（Tab/Esc/方向键至少一条）、aria 角色、Button/Input 的状态矩阵（disabled/loading/error）、EmptyState/ErrorPanel/Skeleton 的 props 透传。**§16.4 四态在组件层就测，不是页面层。**

## 4. apps/desktop 接入
- deps + `@septcats/ui: workspace:*`。
- renderer：`main.tsx` 包 ThemeProvider；`App.tsx` 重写为 AppShell（顶栏面包屑假数据 + 搜索/同步/设置 IconButton + 侧栏 3 层假树 + 内容区「工程骨架就绪」占位）；import `@septcats/ui/tokens.css`（exports map 配好）。
- electron.vite.config.ts 若需 optimizeDeps/alias 你定，写进报告。
- renderer 的 `index.html` 加 `<meta name="color-scheme" content="light dark">`。

## 5. 视觉自检（无浏览器环境下你所能做的极限，写进报告）
每个组件测试里断言计算样式 token 变量被引用（jsdom 拿 var() 原样字符串即可）；另附一段 `SSIM-NOTE`：说明哪些组件外观与 mockups 哪一节对齐。PM 真机截图复审。

## 6. 依赖白名单（root/apps 均不得超）
新增：`@phosphor-icons/react`、`clsx`；apps/desktop devDeps：`@testing-library/react`、`@testing-library/user-event`、`jsdom`。解析 YAML 用你写的极简 parser 或 core 已有能力（不引 js-yaml！DESIGN.md front matter 是规整子集，200 行内手写 parser 可覆盖）。

## 7. DoD（PM 复跑）
```
pnpm install && pnpm -r typecheck && pnpm -r test
node packages/ui/tokens/build-tokens.mjs --check
node packages/ui/tokens/no-magic.mjs            # 0 命中
pnpm -C apps/desktop build
grep -rn "#[0-9a-fA-F]\{3,6\}" packages/ui/src --include=*.css | grep -v tokens.css | head   # 只允许 tokens.css
```
报告格式同前 + 「SSIM-NOTE」段。
