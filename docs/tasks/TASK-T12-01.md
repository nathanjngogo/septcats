# TASK-T12-01 · M10 打包·签名·自动更新（T12 打包产物阶段）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：M0–M9 + M12 全部关闭（HEAD `5a0429c`）
> 必读：docs/PROJECT_PLAN.md §M10（全文）、§3 决策表「自动更新」行、Q2/Q8 决议、R5/R7；
> apps/desktop/package.json；.github/workflows/ci.yml；apps/desktop/resources/icon.svg（品牌标）。
> 纪律：用 Write/Edit 落盘；**每写完一个文件立即跑对应命令验证**；不碰 git；禁占位符。

## 0. 范围裁决（PM 已定）

**本任务 = 打包产物与安装体验（本地可全验）。** 更新器（electron-updater + feed 自签 + 差量）
归 T12-B 下一会话；发布通道（GitHub Releases）**老板尚未拍板——仓库当前没有 git remote，
不许自行创建远端或推送**；feed/dist 输出用本地目录占位。

1. **版本定 0.1.0**（`apps/desktop/package.json` version 0.0.0→0.1.0；这是 v0.1 G4 交付物）。
2. **electron-builder 唯一新增外部依赖**（devDependency），配置写 `apps/desktop/electron-builder.yml`。
3. Win 目标：**NSIS per-user**（`perMachine: false`，免管理员，支持 `/S` 静默）+ **portable 可选不出**；
   产物 `Septcats Setup 0.1.0.exe`。
4. mac 目标：配置段写好（DMG，`identity: null` = Q2 一期未签名决议），**Windows 上构建 mac 目标
   不要求跑通**（DMG/pkg 需 macOS；配置就绪等 CI）。本机验证只验 Win。
5. 体积护栏（R7）：`asar: true`、`electronLanguages: [zh-CN, en]`（剔 locales）、`removePackageScripts: true`
   （剔 devDeps 由 builder 默认，双保险写明）。
6. 图标：`resources/icon.svg` → 程序化生成 `icon.ico`（256/48/32/16）与 `icon.icns` 占位说明（icns
   生成需 macOS，任务书授权：生成脚本写双分支，mac 分支代码就位、本机跑不到）。ico 生成允许
   用零依赖方案（sharp 已是 editor 依赖？——**先查仓库现有依赖，有图像库就用，没有就不新增**，
   降级方案：icon 用 `icon.svg` 同目录放 256×256 PNG + builder 自动转换 png2ico，允许）。
7. `artifactName` 固定形态（含版本+arch），`directories.output` = `apps/desktop/dist/`，
   `publish: [{ provider: generic, url: 'file:///septcats-feed/stable' }]` 占位（feed 真地址待老板）。
8. 现有 `pnpm -C apps/desktop build`（electron-vite 三进程产物）是 builder 前置，
   `package.json` 加脚本：`dist` = `pnpm build && electron-builder --win --config electron-builder.yml`。

## 1. 交付物清单

| 文件 | 内容 |
|---|---|
| `apps/desktop/electron-builder.yml` | appId `cc.septcats.desktop`、productName Septcats、win nsis 段、mac 段、asar/locales/publish 裁决项 |
| `apps/desktop/package.json` | +electron-builder devDep、version 0.1.0、`dist` 脚本、`dist:check` 脚本（见 §2） |
| `apps/desktop/build/icon.ico` | 生成产物入库（或 png 方案，见 §0.6） |
| `apps/desktop/scripts/make-icon.mjs` | 图标生成脚本（stdlib 优先；依赖图像库则写清理由） |
| `.github/workflows/ci.yml` | 追加 `package` job：双 OS matrix，跑 `pnpm -C apps/desktop dist` 出产物 + artifact 上传（仓库有远端后自动生效，本机不验） |
| `docs/tasks/TASK-T12-01-report.md` | 交付表、本机 dist 真实输出（文件清单+大小）、静默安装冒烟原文、DEVIATIONS |

## 2. 本机验证（全部要真跑，贴原文）

```
pnpm -C apps/desktop dist              # 产出 NSIS exe + latest.yml（builder 生成，即使不发 feed）
pnpm -C apps/desktop exec electron-builder --version
```

- 产物存在性与**体积记录**（R7 预算：安装器 ≤ 150 MB，超了写 DEVIATIONS）；
- 静默安装冒烟：`"<产物>" /S`（NSIS per-user 装到 %LOCALAPPDATA%）→ 启动 `Septcats.exe`
  （用 `Start-Process` + 等 5s 窗口进程存活）→ 杀进程 → 卸载 `/S /Uninstall` →
  卸载后 %LOCALAPPDATA%\Programs\Septcats 不存在。每一步贴命令与结果。
  ⚠️ 这台机器同时跑着 QQ/gateway 等长驻进程：只允许杀你启动的 Septcats.exe 进程树。
- 存量不破：`pnpm -r typecheck && pnpm -r test && pnpm -C apps/desktop selftest` 全绿。

## 3. 红线

- 不许 git 操作（不 remote、不 push、不 commit）；不许碰 `apps/desktop/src/**` 功能代码
  （纯打包层任务；若发现 src 必须动才能打包，写进报告「未决项」停下来，报告里说明）。
- 不许下载 Electron 二进制到非常规位置（builder 缓存默认路径即可）；npmmirror 全局配置已就绪。
- 不许把 dist/、*.exe、install-stamp 之类产物提交 git（.gitignore 追加）。

## 4. DoD

```
pnpm -C apps/desktop dist
# §2 全部验证命令原文 + 静默安装/卸载冒烟
pnpm -r typecheck && pnpm -r test && pnpm -C apps/desktop selftest
```
