# TASK-T55-02 · P1：像素布偶猫图标接线（PM 原型资产 → 正式装包）

> 前置：PM 已完成设计资产（本单只做接线，不再设计）。取代 T55-01 的 CB 两连败会话。

## 0. PM 已交付资产（勿重做、勿改设计）

- `scripts/gen-icon-3dpix.mjs`：28×28 正面浮雕语法生成器（连通性质检断言=1；三变体 A/B/C + **T=16px 原生托盘子型**）。
- `scripts/pixel-png.mjs`：SVG→任意分辨率**原生直画**渲染核心（零插值；硬边断言已过：全档半透明=0、全纯灰）。
- `scripts/generate-pixel-icons.mjs`：一键出全套 PNG → `assets/brand/dist/png/`（A/B/C：16/32/48/256；T：16/24/32）。
- `assets/brand/septcats-3dpix-{A,B,C,T}.svg` + `png/` 全套渲染。
- 判读定论：C=侧位默认版（8/10 一眼布偶猫）；T=16px 合格（语义+硬边双证）。

## 1. 必须做到（全部接线）

1. **装包资源生成**（PM 注：D-2 追认后撤回本小节脚本要求——根 `scripts/build-pixel-ico.mjs` 已直出 build 四份，桌面侧不新增脚本；以下为当时预设内容存档）：
   - `apps/desktop/build/icon.png` ← `png/C-256.png`
   - `apps/desktop/build/icon-tray.png` ← `png/T-16.png`、`icon-tray@2x.png` ← `T-32.png`
   - **Windows `.ico` 纯 stdlib 组装**（Vista+ 支持 PNG 表项；参考 make-icon.mjs 里 buildIco 的思路但输入是现成 PNG 文件）→ `apps/desktop/build/icon.ico`，含 16/24/32/48/256 五层，**16/24/32 层用 T 原生图、48/256 用 C**。断言：解析回读层数与逐层尺寸一致。
   - `make-icon.mjs` 保留为 darwin/icns 兜底但在文件头注释「Windows 图标链路已迁 pixel-icons.mjs」。
2. **Tray 换图**：`apps/desktop/src/main/tray.ts` 查找序列首位加 `icon-tray.png`（打包 resourcesPath 与 dev 路径都要覆盖；沿用现有 resolveTrayIconPath 结构）。
3. **窗口 icon 显式化**：`main/index.ts` BrowserWindow 构造加 `icon: <resourcesPath>/build/icon.png`（dev 回退 appPath 路径，模式同 tray.ts 的查找序列）；顺带把该文件 `backgroundColor: '#FBFBFA'` 改 `#F5F5F5`（T53 灰阶谱内，漏网项）。
4. **electron-builder.yml**：`extraFiles`（或既有 files 规则内）确保 `build/icon-tray*.png` 进包（icon.ico/icon.png 已在默认位）。**打包体积口径**：新图 <20KB，无感。
5. **文档改写**：`DESIGN.md` 品牌节 + `docs/PROJECT_PLAN.md` §17（旧「单线描猫+铃铛 accent」决议 → 「3D 像素浮雕布偶猫 · 白底圆角 · 黑白灰；托盘用 16px 原生简化子型」）+ `项目交接文档.md` 品牌行 + 新 `assets/brand/README.md`（生成命令、质检断言、A/B/C/T 关系、老板三选一决策区：默认 C 已接线，A/B 保留待选，换法一行命令写明）。
6. **真机取证**：CDP 探针 `cdp-e2e-t55-02.mjs`——启动夹具后断言：① tray.ts 解析出的图标路径存在且以 icon-tray.png 命中；② 窗口 title 正常；③ `--inspect+desktopCapturer` 窗口级截图 ×2（任务栏区 + 托盘区，浅色即可）存 `screens-t55/`；④ 单测断言 ico 五层回读（新纯函数放 `apps/desktop/src/main/pixelIco.ts` 之类可测位置，desktop 用例 ≥693+4）。

## 2. 红线

- `packages/**` 零改动；设计资产（gen-icon-3dpix/pixel-png/三 SVG）零改动；不加 npm 依赖；不碰 git；禁 TODO；真档案只读；交付前杀净 electron 并贴计数=0。
- ABI：node 测试前 ensure-abi node；Electron 探针前切 electron + `pnpm -C apps/desktop build`。
- 数值：desktop 全绿、typecheck 9/9、双门禁、selftest OK。

## 3. 交付

代码+单测+探针+2 截图+`docs/tasks/TASK-T55-02-report.md`（原始值+DEVIATION；PM 复跑节留空）。全仓/打包留 PM。
