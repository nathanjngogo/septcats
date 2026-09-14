# TASK-T12-01 交付报告 · M10 打包产物阶段（T12）

> 工程师：CodeBuddy ｜ 2026-09-14 ｜ 任务书：docs/tasks/TASK-T12-01.md
> 红线遵守：零 git 操作（未 remote / 未 push / 未 commit）；未触碰 `apps/desktop/src/**`；dist/ 产物未入库（.gitignore 已加固）。

## 1. 交付物清单

| 文件 | 内容 | 状态 |
|---|---|---|
| `apps/desktop/electron-builder.yml` | appId `cc.septcats.desktop`、productName Septcats、NSIS per-user（oneClick/perMachine:false/allowElevation:false）、mac DMG 段（identity:null）、asar/electronLanguages/removePackageScripts、publish 占位 | ✅ 已验证（dist 真跑） |
| `apps/desktop/package.json` | version 0.0.0→**0.1.0**、+author（builder NSIS 必需）、+`make-icon`/`dist`/`dist:check` 脚本、+`electron-builder ^26` devDep（**唯一新增依赖**） | ✅ |
| `apps/desktop/build/icon.ico` | 程序化生成：16/32/48/256 四尺寸 PNG 表项 ICO（10,326 B），结构校验通过 | ✅ |
| `apps/desktop/build/icon.png` | 256×256 白底线条猫（builder png→ico 自动转换的降级冗余，任务书 §0.6 授权） | ✅ |
| `apps/desktop/scripts/make-icon.mjs` | 图标生成脚本，**零新增依赖**：复用现有 electron 二进制离屏渲染 SVG → nativeImage 缩放 → stdlib 组装 ICO；darwin 分支（iconset→iconutil→icns）代码就位、本机未执行 | ✅ |
| `apps/desktop/scripts/check-dist.mjs` | （超出任务书交付表的新增 helper）`dist:check` 的载体：产物存在性 + R7 体积预算检查。理由：package.json scripts 在 Windows 走 cmd，塞不下健壮的检查单行 | ✅ |
| `.github/workflows/ci.yml` | 追加 `package` job：win（`dist` NSIS）+ mac（DMG, identity:null）双 OS matrix + 体积护栏 + artifact 上传。仓库无 remote，**push 后自动生效，本机不验**（已做 YAML 解析校验） | ✅（本机仅静态校验） |
| `.gitignore` | 追加 `*.exe`、`*.blockmap`、`latest.yml`（`dist/` 原已覆盖 builder 输出目录） | ✅ |

## 2. 本机验证原文（任务书 §2 全部真跑）

### 2.1 electron-builder 版本

```
$ pnpm -C apps/desktop exec electron-builder --version
26.15.3
```

### 2.2 dist 构建

```
$ pnpm -C apps/desktop dist
  • electron-builder  version=26.15.3 os=10.0.26100
  • loaded configuration  file=E:\Hermes Agent工作空间\Septcats\apps\desktop\electron-builder.yml
  • executing @electron/rebuild  electronVersion=37.10.3 arch=x64
  • finished        moduleName=better-sqlite3 arch=x64
  • packaging       platform=win32 arch=x64 electron=37.10.3 appOutDir=dist\win-unpacked
  • updating asar integrity executable resource  executablePath=dist\win-unpacked\Septcats.exe
  • building        target=nsis file=dist\Septcats Setup 0.1.0.exe archs=x64 oneClick=true perMachine=false
  • building block map  blockMapFile=dist\Septcats Setup 0.1.0.exe.blockmap
（exit code 0）
```

说明：日志中的 `signing with signtool.exe` 为 electron-builder 26 编辑 exe 资源（asar integrity）的步骤名；**未配置任何证书，产物未签名**，与 Q2 一期未签名决议一致。

### 2.3 产物清单与体积（R7 预算：安装器 ≤ 150 MB）

```
$ pnpm -C apps/desktop dist:check
  Septcats Setup 0.1.0.exe  88.15 MB
  latest.yml  0.00 MB
  Septcats Setup 0.1.0.exe.blockmap  0.09 MB
dist:check ok

$ ls -la apps/desktop/dist
-rwxr-xr-x  92433381  Septcats Setup 0.1.0.exe
-rw-r--r--      97788  Septcats Setup 0.1.0.exe.blockmap
-rw-r--r--       7570  builder-debug.yml
-rw-r--r--        344  latest.yml
drwxr-xr-x  win-unpacked/
```

安装器 **88.15 MB ≤ 150 MB**，R7 过线（亦达 PROJECT_PLAN §1.2 的 ≤90 MB 目标）。`latest.yml` 内容：version 0.1.0、sha512、size 92433381、releaseDate 2026-09-14T12:35:46Z。

### 2.4 静默安装/启动/卸载冒烟（逐条原文）

**① 静默安装 `/S`**（免管理员，装到 %LOCALAPPDATA%）：

```
$installer = "...\dist\Septcats Setup 0.1.0.exe"
$p = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
installer exit code: 0
```

安装位置（见 DEVIATIONS-1）：

```
%LOCALAPPDATA%\Programs\@septcatsdesktop\
  Septcats.exe (204,521,984 B)、Uninstall Septcats.exe、resources\、locales\、各运行时 dll/pak
注册表（HKCU Uninstall）：DisplayName=Septcats 0.1.0，UninstallString="...\Uninstall Septcats.exe" /currentuser
```

**体积护栏落地抽查**——`locales\` 仅剩 `zh-CN.pak`（electronLanguages 裁决生效，其余 Chromium locales 全剔除）。

**② 启动 + 5s 进程存活**：

```
$p = Start-Process Septcats.exe -PassThru; Start-Sleep 5
main pid=27404 alive=True
进程树（仅本次启动的实例）：27404（主）+ 30108/30876/7660/18536（4 个子进程）
```

**③ 杀进程**（⚠️ 只杀本次启动的 PID 树）：

```
taskkill /PID 27404 /T /F
成功: 已终止 PID 30108/30876/7660/18536（属于 27404 子进程）的进程。
成功: 已终止 PID 27404 的进程。
remaining Septcats processes: 0
```

**④ 静默卸载**（见 DEVIATIONS-2，NSIS 静默卸载开关为 `/S`）：

```
$p = Start-Process "...\@septcatsdesktop\Uninstall Septcats.exe" -ArgumentList "/S" -PassThru
uninstaller launched pid=7856
（等待 6s 后）
dir exists: False            ← %LOCALAPPDATA%\Programs\@septcatsdesktop 已删除
expected-path exists: False  ← %LOCALAPPDATA%\Programs\Septcats 不存在
registry leftover: 0         ← HKCU 卸载项已清理
uninstaller still running: 0
```

### 2.5 存量不破（DoD 第 2 条）

```
$ pnpm -r typecheck     # 全部包 Done，exit 0
$ pnpm -r test          # desktop 15 files / 139 tests 全过（含 1 万页搜索 P95=12.6ms 红线），exit 0
$ pnpm -C apps/desktop selftest   # 全 PASS，SELFTEST OK
```

## 3. SSIM-NOTE

本任务为纯打包层（builder 配置/脚本/CI/图标产物），不涉及任何 `docs/mockups/*.html` 界面对齐项；未触碰 UI 代码与 DESIGN.md tokens。唯一视觉产物为图标 `build/icon.ico/png`，由 `resources/icon.svg`（Q8 决议：线条猫·白底）程序化渲染生成，1:1 保留原 SVG 视觉。

## 4. DEVIATIONS（有意偏离 + 理由）

1. **per-user 安装目录为 `%LOCALAPPDATA%\Programs\@septcatsdesktop`，非任务书 §2 的 `Programs\Septcats`。**
   根因（源码定位）：electron-builder 26 对 oneClick+perMachine:false 组合，安装目录名取 `appInfo.sanitizedName`（package.json name `@septcats/desktop` → `@septcatsdesktop`），productName 仅在 assisted 安装器或 per-machine 时使用（app-builder-lib `out/targets/targetUtil.js:41`：`getWindowsInstallationDirName`）。per-user、免管理员、%LOCALAPPDATA%\Programs 之下等任务书实质要求全部满足；冒烟已按实际目录验证且卸载干净。若 PM 坚持 `Programs\Septcats` 字面路径，需改 package.json name 或换 assistedInstaller（有损 oneClick 静默），属架构裁决，留未决项。
2. **静默卸载开关用 `/S` 而非任务书的 `/S /Uninstall`。** NSIS 卸载器无 `/Uninstall` 开关；electron-builder 生成的 `Uninstall Septcats.exe` 静默卸载标准开关即 `/S`。已验证卸载后目录与注册表零残留。
3. **`electronLanguages: [zh-CN, en]` 实际只落 `zh-CN.pak`。** Electron 发行包无裸 `en` locale（英文为 en-US/en-GB），builder 未为其产出文件。剔 locales 的体积护栏意图已达成（其余全部剔除）；如需英文回退，后续把配置改为 `[zh-CN, en-US]` 即可，未擅改任务书给定值。
4. **新增 `scripts/check-dist.mjs`（超出任务书交付表）。** `dist:check` 需要跨平台健壮的体积检查逻辑，package.json 内联单行在 Windows cmd 下不可维护，故落为脚本文件。
5. **ico 采用 PNG 表项（16/32/48/256 全 PNG）而非传统 BMP 表项。** Windows Vista+ 与 NSIS 均支持 PNG 表项；实现可零依赖完成且已结构校验（表项尺寸、PNG 签名、IHDR 宽高逐项核对）。

## 5. 未决项（待老板/PM 拍板，不阻塞本任务关闭）

1. **更新 feed 真实地址**：当前 publish 占位 `file:///septcats-feed/stable`（任务书 §0.7 授权占位）。
2. **发布通道 / git remote**：仓库无 remote，`ci.yml` 的 package job 与上传产物在创建远端后自动生效；未自行创建远端（红线）。
3. **mac DMG**：配置段与 make-icon darwin 分支就绪，需 macOS（CI）真跑；icns 本机未生成。
4. **T12-B 更新器**（electron-updater + feed 自签 + 差量 blockmap）：任务书 §0 归下一会话。
5. **builder 建议**：electron-builder 日志建议移除冗余 `@electron/rebuild` devDep 或改用 `electron-builder install-app-deps`——现有 ensure-abi.mjs 机制依赖它，**未动**，留 PM 裁决。

## 6. DoD 复跑指引

```
pnpm -C apps/desktop dist                 # ~2-3 分钟，重出 dist/
pnpm -C apps/desktop exec electron-builder --version
pnpm -C apps/desktop dist:check           # 体积护栏
pnpm -r typecheck && pnpm -r test && pnpm -C apps/desktop selftest
node scripts/make-icon.mjs                # （apps/desktop 下）重产图标，幂等
```

冒烟复跑按 §2.4 的四步（注意 §2.4① 首次验证 `Programs\Septcats` 为 False 是目录名 DEVIATIONS-1 所致，实际目录为 `Programs\@septcatsdesktop`）。
