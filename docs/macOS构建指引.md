# Septcats macOS 构建指引（老板 Mac 端产出用）

> 09-26 老板令：「macOS 的代码可以开始了，我可以将成果导入到我的 MAC 进行产出。
> 后续如有修改，可以同时修改。」本文件 = Mac 端一次性操作手册；代码面与 Windows
> 同仓同分支（main），双平台共用全部源码，平台差异已按文件收口。

## 0. 前置（一次性）
- macOS 12+；装 [Node 22 LTS](https://nodejs.org)（或 `brew install node@22`）与
  `corepack enable`（启用 pnpm）。
- 把仓库导入 Mac：git 克隆，或直接把 `Septcats` 目录整体拷过去（含 `.git`）。

## 1. 构建 DMG
```bash
cd Septcats
pnpm install          # 首次较慢（better-sqlite3 需本机重编译，勿拷 node_modules）
pnpm -C apps/desktop dist:mac
```
产物在 `apps/desktop/dist/`：
- `Septcats-<版本>-mac.dmg`（安装用，点形式命名=资产名纪律）
- `Septcats-<版本>-mac.zip`（electron-updater 用）
- `latest-mac.yml`（feed 元数据，win 的 `latest.yml` 互不干扰）

一期 Q2 决议 **未签名**（`identity: null`）：首次打开需 右键→打开，或
`xattr -dr com.apple.quarantine /Applications/Septcats.app`。买 Developer ID 后
改 `electron-builder.yml` mac 段即可切签名+公证。

## 2. 数据位置（与 Windows 不同源，互不覆盖）
- 数据根：`~/Library/Application Support/Septcats/.septcats/`（便携根可在设置里改）
- 同步文件夹默认 `<数据根>/sync`，可经 设置→数据与隐私→同步路径「更改…」
  指向 iCloud Drive / 坚果云 / 百度网盘 Mac 版等客户端目录 → 与 Windows 端同步
  （两端指同一网盘同一子目录 = 双设备同步，附件 files/ 面待 T84 落地）。

## 3. 后续同步修改的维护方式
- 单仓单分支：所有功能改动都在 `main`，平台差异只允许存在于
  `src/main/platform.ts`、`electron-builder.yml` 的 win/mac 段、菜单/快捷键的
  `darwin` 分支——review 时盯这三处即可。
- Mac 端验证：`pnpm -C apps/desktop dev` 起开发实例；回归跑
  `pnpm test`（全部门禁跨平台通用，Windows 特有项自带 skip）。
- 发 mac 版更新 = 把 `latest-mac.yml + zip` 传到 releases 仓 feed 目录（与 win 四件套
  并列，publish.sh 的 yml 归一化/验签纪律同规执行；electron-updater 契约已按平台
  分化 `feedYmlName`，win 客户端永远不会误读 mac 元数据，反之亦然）。

## 4. 已知边界（如实）
- 托盘/灵动岛类 Windows 桌面集成在 mac = 系统 Tray 基础形态（菜单+状态行通用）。
- DMG 从未在本机（Windows）产出过——首跑若 builder 报 icns/iconutil 问题，
  `make-icon.mjs` 的 darwin 分支需在 mac 上执行一次（脚本已守卫，产物入 build/）。
- 自动更新的 mac 端到端（Squirrel/zip 链）未经真机验证：需老板 Mac 首装后跑一次
  「feed 投放新版→提示更新→重启」闭环，PM 远程按日志排障。
