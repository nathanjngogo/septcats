# TASK-T50-01 · P2：全局字体切换为思源黑体（Source Han Sans / Noto Sans CJK）

> PM：Hermes ｜ 工程师：CBL ｜ 前置：T49-01（排队后做）｜ 来源：老板 09-21 全局规则「以后所有开发的软件字体全部使用思源黑体」

## 0. 现状与已备好物料（PM 实证）

- `DESIGN.md` typography 各档 fontFamily 均为 `"Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"`（Geist 本机不存在 → 实际渲染落到系统字体，**违反映本地优先与新规则**）。
- **PM 已下载并校验捆绑字体**（你不用重复下载）：`apps/desktop/src/renderer/assets/fonts/NotoSansSC-wght.ttf` —— Source Han Sans = Google Fonts 官方可变体（SIL OFL 1.1，可嵌入分发），17,772,300 B，magic `00010000`，23 表含 `fvar`+`glyf`（可变字体，一份覆盖 wght 全轴，含 450/620/650 非整档），sha256 前缀 `a3041811a78c361b`。
- 构建链安全：vite 默认不内联 >4KB 资源 → 字体进 `out/renderer/assets/` 文件 → electron-builder `files: out/**` 入 asar；CSP `font-src 'self' data:` **已允许本地文件，无需放宽**。
- mono 等宽字体**不在本单范围**（老板只指定了思源黑体；等宽保持现状）。

## 1. 必须做到

1. `DESIGN.md`：所有**非 mono** 的 fontFamily 改为
   `"Source Han Sans SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`
   （捆绑字族名以实际文件 name 表为准——用脚本读 ttf 的 name(1)/(16) 确认真实族名后决定排在最前的名字，并贴出读取结果）。
2. 新建 `@font-face` 全局样式（renderer 入口 CSS 或 `main.css` 同级）：
   `src: url('./assets/fonts/NotoSansSC-wght.ttf') format('truetype-variations')`（兜底 `format('truetype')`），
   `font-weight: 100 900`（可变轴），`font-display: swap`，unicode-range 不裁剪（全量中文）。
   **路径引用走 vite 资源解析（相对 url()），不新增依赖。**
3. 跑 `node packages/ui/tokens/build-tokens.mjs --write` 同步 tokens；`--check` 必须过；`no-magic` 必须过（CSS 只动 font 相关声明，不新增色值/尺寸）。
4. 对比度门禁 17 对复跑全绿（字体变更不影响色值，但必须复跑证明）。
5. 真机截图取证（CDP，独立夹具）：浅色 + 深色各一张整页，含正文/标题/代码块；用 `document.fonts.check('16px "真实族名"')` 与 `getComputedStyle` 断言**实际生效字体是捆绑的思源黑体**（贴出 check 原文与 computed fontFamily）。
6. 验证产物：`pnpm -C apps/desktop test` 全绿 + `pnpm -r typecheck` 9/9；如渲染层快照/文案断言因 font-family 字符串变化失败，**按 token 新值修正断言**（不许反向改 token 迁就测试）。

## 2. 验收（数值化）

- ttf 文件字节数与 sha256 与 §0 一致（防误替换）；
- `@font-face` 生效后 CDP `document.fonts` 列表含该族（贴原文）；
- 截图 2 张（浅/深）+ computed fontFamily 原文；
- 全仓测试数不降、双门禁 ✓。

## 3. 红线

- 只动：`DESIGN.md` typography 段、tokens 生成物、renderer 入口 CSS、受影响测试断言、探针/报告；**不碰** mono 字族、不碰色值、不碰 packages/**、不加依赖、不碰 git；
- 字体文件**只准用 §0 那个路径的已校验文件**，不许从其它源重新下载；
- 真机独立夹具，绝不写 `C:/Users/Administrator/.septcats`；交付前杀自起进程；
- ABI：测试前 `ensure-abi node`，Electron 前切 `electron`。

## 4. 交付

代码 + `docs/tasks/TASK-T50-01-report.md`（原始数值/原文逐条 + DEVIATION；PM 复跑节留空）。全仓/打包/发布留 PM。
