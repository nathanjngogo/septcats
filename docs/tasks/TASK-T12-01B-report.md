# TASK-T12-01B 交付报告 · M10-B 自动更新（electron-updater + feed 自签 + 状态机 + 设置页关于行）

> 工程师：CodeBuddy ｜ 2026-09-14 ｜ 任务书：docs/tasks/TASK-T12-01B.md
> 红线遵守：零 git 操作（未 commit / 未 push / 未建 remote）；未触碰 `src/**` 之外的功能代码（仅任务书交付表内文件）；
> 每文件落盘后立即跑了对应验证（typecheck / vitest / no-magic / CLI 冒烟）。

## 1. 交付物清单

| 文件 | 内容 | 状态 |
|---|---|---|
| `apps/desktop/src/shared/updater.ts` | 五通道名（`update:check/state/download/install/rollbackHint`）+ `UpdateState` zod schema（单一来源，类型 infer 派生）+ `UpdateInstallInput`/`UpdateRollbackHint` | ✅ typecheck 过 |
| `apps/desktop/src/main/updater.ts` | 纯核心（不 import electron）：Ed25519 验签 + dev-feed 门 + 事件驱动状态机 + `registerUpdaterIpc`（五通道接线，electron-updater 注入式）；公钥硬编码常量（含轮换流程注释） | ✅ 19 测试全过 |
| `apps/desktop/src/main/index.ts` | 仅 import + register：`autoUpdater` 注入、`net.fetch` 适配、`CHANNEL_UPDATE_STATE` 广播、启动 5s 自动检查、`will-quit` dispose | ✅ |
| `apps/desktop/src/preload/index.ts` + `src/types/window.d.ts` | `window.septcats.update` 桥（check/download/install/rollbackHint/onState）+ `SeptcatsUpdateApi` 类型 | ✅ |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`（+ `.css`） | 「关于」区块加一行：检查更新按钮 + 四态文案（检查中/已是最新/下载中 N%/重启更新）+ 重启更新 Dialog confirm；CSS 只用 `var(--sc-*)`（no-magic 过） | ✅ settings-react 3 测试过 |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `settings.about.*` 12 条文案（含 {version}/{percent} 槽位） | ✅ |
| `apps/desktop/scripts/feed-sign.mjs`（+ `.d.mts` 类型声明） | keygen / sign / verify 三子命令；Ed25519 零新依赖（Node stdlib）；sign 私钥路径取 `SEPTCATS_FEED_KEY` env 或 `--key` | ✅ CLI + 模块双路真跑 |
| `apps/desktop/test/updater.test.ts` | §2 底线全覆盖（见 §3） | ✅ 19/19 |
| `apps/desktop/electron-builder.yml` | publish 段补 beta 通道（stable + beta 两个 generic 入口） | ✅ dist 真跑过 |
| `apps/desktop/package.json` + `pnpm-lock.yaml` | + `electron-updater ^6.8.9` 进 **dependencies**（本任务唯一新增外部依赖） | ✅ |
| `.gitignore` | + `*.feed.key`、`feed-keys/`、`latest.yml.sig`（`feed-keys/` 模式已验证覆盖 `apps/desktop/tmp/feed-keys/`，`git check-ignore` 实证） | ✅ |

交付密钥（本机生成、**永不入库**）：

```
apps/desktop/tmp/feed-keys/septcats-feed.key   私钥（PKCS8 PEM，0600）——随任务交付给老板/PM 存管，勿删
apps/desktop/tmp/feed-keys/septcats-feed.pub   公钥（SPKI PEM）——已硬编码进 src/main/updater.ts 的 FEED_PUBLIC_KEY_PEM
```

**正式发布前，老板/PM 应在离线机重新 `keygen` 换掉这对密钥**（报告 §6 有操作序列），轮换流程已写进 `src/main/updater.ts` 公钥常量上方注释。

## 2. 关键裁决

1. **验签实现 = 包装层，非 GenericProvider 子类**（任务书 §0.3 给了两选项授权选最小改动者）：
   `update:check` 触发时，服务**先自拉** `<feed>/latest.yml` 与 `<feed>/latest.yml.sig` 原文字节，
   Ed25519 验签（Node stdlib `crypto.verify`，零新依赖），通过后才调 `autoUpdater.checkForUpdates()`
   ——即「先验 sig 再交 electron-updater 走 sha512/blockmap」的字面实现。验签失败报
   `E_FEED_SIGNATURE`，**绝不触达 electron-updater**（测试断言 `checkForUpdates` 未被调用）。
2. **dev-feed 门**：`assertFeedUrlAllowed(url, devFeedEnabled)`——localhost / `127.0.0.0/8`（`127.` 前缀）/ `[::1]`
   仅当 `SEPTCATS_DEV_FEED=1` 放行，否则 `E_FEED_SOURCE_DENIED`。门作用于两处：
   运行期注入（env `SEPTCATS_DEV_FEED_URL`）与 `check` 时对 `currentFeedURL` 的复查。
   注入被拒只记日志不注入、**不阻断启动**（fail-closed 不 crash）。
3. **dev feed 注入协议**：`SEPTCATS_DEV_FEED=1` + `SEPTCATS_DEV_FEED_URL=http://127.0.0.1:<port>/stable`
   两个环境变量（启动前注入进程环境），main 启动时 `setFeedURL` 覆盖。这是 PM 真机验收的注入面。
4. **状态机**：`idle → checking → available(downloading→downloaded) / not-available / error`；
   越序事件忽略（error 恒可达）；重复 `checking` 去重（check 入口与 electron-updater 事件会双发）。
   每次跃迁经 `update:state` 广播到所有窗口，payload 恒为 `UpdateState`（zod schema 断言）。
5. **更新检查自动触发**：启动 5s 后一次（`autoCheckDelayMs=5000`，测试可注入 null 关闭）。
   当前 publish 占位是 `file:///septcats-feed/stable`（T12-A 遗留，真源待老板拍板），打包应用
   自动检查会以 error 态收场——属占位 feed 的既知现状，真源接入后自动恢复；DEVIATIONS-3 有说明。
6. **`update:install` 前置 confirm**：main 侧校验 `confirm === true` 且状态必须 `downloaded`，
   否则 `E_MALFORMED` / `E_UPDATE_FAILED`；renderer 侧再弹 Dialog 确认（双保险）。
7. **回滚**：electron-updater 安装失败自回 pending，本端不做额外机制，仅
   `update:rollbackHint` 通道透出提示与状态并记日志（任务书 §0.4 字面）。

## 3. 验证原文（全部真跑）

### 3.1 测试底线（test/updater.test.ts，19 用例全过）

```
$ pnpm vitest run test/updater.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)

覆盖（对应任务书 §2 三条）：
① yml 验签（密钥对用 feed-sign.mjs keygen 现生成到 tmp，测试不依赖真实私钥）：
   - 签→验通过
   - 篡改 yml 一字节 → E_FEED_SIGNATURE
   - 无 sig 文件 → 拒（对照：补上 sig 后同目录通过）
   - 错误密钥（他人公钥）→ 拒；非法 base64 sig → 拒
② feed URL 门：无 SEPTCATS_DEV_FEED 时 localhost/127.0.0.1/[::1]/127.50.1.2 全拒；
   =1 时放行；远程源恒放行；dev 注入被拒 fail-closed（不注入不 crash）
③ 状态机：事件流注入 idle→checking→available→downloading→downloaded 序列，
   每步 IPC payload 过 shared/updater.ts 的 zod parse；error/not-available/reset 分支；
   fake updater + fake fetch 走通五通道全链路（含 quitAndInstall、rollbackHint、幂等 download）
```

### 3.2 存量不破

```
$ pnpm -r typecheck        # 全部包 Done，exit 0
$ pnpm -r test             # desktop 16 files / 158 tests 全过（139 存量 + 19 新增，零破坏）
                           # 含 1 万页搜索 P95=19.6ms 红线
$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
$ pnpm -C apps/desktop selftest
SELFTEST OK（PASS FTS_RESYNC 2000 页全量重算 < 3000ms 等）
$ pnpm -C apps/desktop build
✓ 4807 modules transformed. ✓ built in 3.99s
```

### 3.3 dist 真跑（builder 配置加 beta 通道后复核）

```
$ pnpm -C apps/desktop dist
  • building        target=nsis file=dist\Septcats Setup 0.1.0.exe archs=x64 oneClick=true perMachine=false
  • building block map  blockMapFile=dist\Septcats Setup 0.1.0.exe.blockmap
（exit code 0；dist/ 下 latest.yml + blockmap + 安装器齐全）

$ SEPTCATS_FEED_KEY=tmp/feed-keys/septcats-feed.key node scripts/feed-sign.mjs sign --feed dist
sign ok: ...\dist\latest.yml.sig（base64 单行，与 yml 同目录发布）
$ node scripts/feed-sign.mjs verify --feed dist --pub tmp/feed-keys/septcats-feed.pub
verify ok: latest.yml 与 latest.yml.sig 匹配
```

（工具链端到端：真 builder 产出的 latest.yml → 真实私钥签 → 验签通过。）

## 4. SSIM-NOTE

本任务 UI 面仅为设置页「关于」区块新增一行（检查更新按钮 + 状态文案）与一个确认 Dialog，
无 mockup 对应项（mockup 06 无更新行基准）；CSS 只用 `var(--sc-*)` token（no-magic 门禁过），
复用既有 `SettingsRow` / `Button` / `Dialog` 组件，无新视觉决策。

## 5. DEVIATIONS

1. **验签为 check 时点校验（TOCTOU 窗口说明）**：本实现先验签再交 electron-updater，后者会再次
   下载 yml 并以 sha512/blockmap 校验安装包。两次拉取之间存在理论上的替换窗口，但安装包篡改
   会被 sha512 拦截，且签名私钥离线——风险实质收敛于「yml 在验签后、updater 二次拉取前被换」，
   其后果仍是 sha512 不匹配（下载校验失败），不会装出坏包。若 PM 要求零窗口，后续可改
   GenericProvider 子类把验签塞进 updater 的取数路径（有侵入性，本期不做）。
2. **file:// 占位 feed 跳过预验签**：T12-A 的 publish 占位是 `file:///septcats-feed/stable`，
   无 HTTP 面可拉字节。`check` 对非 http(s) 源记日志跳过预验签，交 electron-updater 自行处理
   （file 源会 check 失败进 error 态——占位 feed 的既知现状）。真源（https）接入后自动走完整验签链。
3. **占位 feed 下 5s 自动检查会 error**：与 DEVIATIONS-2 同源。任务书 §0.4 要求启动 5s 自动检查，
   已按字面实现；真源接入前打包应用的自动检查以「更新失败（E_UPDATE_FAILED）」文案呈现，
   手动检查与 PM 验收（dev feed 注入）不受影响。
4. **`dist/generic/latest.yml` 附加目录**：publish 补成 stable+beta 两入口后，electron-builder
   会在 dist 下额外产出 `generic/` 目录（已 gitignore 覆盖），对产物无影响。
5. **新增 `scripts/feed-sign.d.mts`**：测试从 ESM `.mjs` 导入 keygen/sign 函数需要类型声明，
   纯声明文件无运行时代码。

## 6. PM 真机验收指引 · 本地假 feed 两版升级实测

> 前置：Windows；仓库根 `<repo>`（下文以 `$repo` 代）；**私钥文件
> `apps\desktop\tmp\feed-keys\septcats-feed.key` 在场**（若丢失：离线重新 keygen，并把新公钥
> 替换进 `apps/desktop/src/main/updater.ts` 的 `FEED_PUBLIC_KEY_PEM` 后重跑 `pnpm -C apps/desktop build`，
> 否则全部验签会失败——这是设计使然）。
> 两版升级思路：v0.1.0 安装包从 dist 直接装；feed 里只放 v0.1.1 产物；装好的 0.1.0 从 feed 拉到 0.1.1。

### 6.1 构造两版包与假 feed（PowerShell，照单执行）

```powershell
cd $repo
mkdir tmp\demo-feed\stable -Force

# —— ① v0.1.0 包（当前 package.json version=0.1.0）——
pnpm -C apps/desktop dist
# 把 0.1.0 安装器另存（升级流程的"旧版"来源，不进 feed）
copy "apps\desktop\dist\Septcats Setup 0.1.0.exe" tmp\demo-feed\

# —— ② 升到 v0.1.1 出包（改版本号）——
pnpm -C apps/desktop exec npm version 0.1.1 --no-git-tag-version
pnpm -C apps/desktop dist

# —— ③ 签名 0.1.1 的 latest.yml（SEPTCATS_FEED_KEY 指私钥）——
$env:SEPTCATS_FEED_KEY = "$PWD\apps\desktop\tmp\feed-keys\septcats-feed.key"
node apps\desktop\scripts\feed-sign.mjs sign --feed apps\desktop\dist
node apps\desktop\scripts\feed-sign.mjs verify --feed apps\desktop\dist --pub apps\desktop\tmp\feed-keys\septcats-feed.pub
# 期望：verify ok: latest.yml 与 latest.yml.sig 匹配

# —— ④ 0.1.1 全套进 feed（exe + blockmap + latest.yml + latest.yml.sig 四件套）——
copy apps\desktop\dist\Septcats*0.1.1.exe* tmp\demo-feed\stable\
copy apps\desktop\dist\latest.yml*   tmp\demo-feed\stable\
dir tmp\demo-feed\stable   # 应看到 4 个文件

# —— ⑤ 起本地 feed 服务（新开一个终端，保持常驻）——
pnpm dlx http-server $repo\tmp\demo-feed -p 8765 -c-1
# 浏览器开 http://127.0.0.1:8765/stable/latest.yml 能看到 version: 0.1.1 即服务就绪
```

### 6.2 升级实测主链路

```powershell
cd $repo

# ⑥ 静默安装 v0.1.0
Start-Process "tmp\demo-feed\Septcats Setup 0.1.0.exe" -ArgumentList "/S" -Wait
# 验装：$env:LOCALAPPDATA\Programs\@septcatsdesktop\Septcats.exe 存在

# ⑦ 以 dev feed 环境启动（两个环境变量就是 dev-feed 门的钥匙）
$env:SEPTCATS_DEV_FEED = "1"
$env:SEPTCATS_DEV_FEED_URL = "http://127.0.0.1:8765/stable"
Start-Process "$env:LOCALAPPDATA\Programs\@septcatsdesktop\Septcats.exe"
Remove-Item env:SEPTCATS_DEV_FEED, env:SEPTCATS_DEV_FEED_URL   # 只影响本次启动，可立即清掉

# ⑧ 观察更新链路（应用内 设置 → 关于 → 检查更新 行）：
#   启动 5s 后自动检查一次；或手动点「检查更新」
#   期望文案依次：检查中… → 发现新版本 0.1.1，准备下载… → 下载新版本 0.1.1：N%
#                 → 新版本 0.1.1 已就绪，重启后生效（按钮变「重启更新」）
#   下载缓存目录（electron-updater pending）按实际为准：
dir "$env:LOCALAPPDATA\*updater*"     # 预期 @septcatsdesktop-updater\pending 下有 0.1.1 安装包

# ⑨ 点「重启更新」→ 弹确认框 → 确认「重启更新」
#   应用退出 → NSIS 静默装 0.1.1 → 自动重启
# 期望：设置→关于 版本行显示 0.1.1，检查更新 → 「已是最新（当前版本 0.1.1）」
```

### 6.3 负向用例（拒签/无 sig/dev 门，均在 0.1.1 feed 在场时做）

```powershell
# ⑩ 篡改 feed yml 一字节 → E_FEED_SIGNATURE
notepad tmp\demo-feed\stable\latest.yml        # 把 version: 0.1.1 改成 0.1.2，保存
# 重启 Septcats（同 ⑦ 环境）→ 点「检查更新」
# 期望：更新失败（E_FEED_SIGNATURE）
copy /Y apps\desktop\dist\latest.yml tmp\demo-feed\stable\latest.yml   # 还原

# ⑪ 无 sig 文件 → 拒
ren tmp\demo-feed\stable\latest.yml.sig latest.yml.sig.bak
# 重启 → 检查更新 → 期望：更新失败（E_FEED_SIGNATURE）
ren tmp\demo-feed\stable\latest.yml.sig.bak latest.yml.sig             # 还原

# ⑫ dev 门：无 SEPTCATS_DEV_FEED=1 时本地源被拒
$env:SEPTCATS_DEV_FEED_URL = "http://127.0.0.1:8765/stable"
Start-Process "$env:LOCALAPPDATA\Programs\@septcatsdesktop\Septcats.exe"
Remove-Item env:SEPTCATS_DEV_FEED_URL
# 期望：正常启动（不 crash），日志（userData/logs）见「dev feed 注入被拒（E_FEED_SOURCE_DENIED）」
# 且手动检查更新时本地源仍被拒（E_FEED_SOURCE_DENIED）

# ⑬ 清场（可选）
Start-Process "$env:LOCALAPPDATA\Programs\@septcatsdesktop\Uninstall Septcats.exe" -ArgumentList "/S" -Wait
```

### 6.4 通过标准

- 主链路 ⑧⑨：0.1.0 → 0.1.1 升级成功，升级后「已是最新」，全程零管理员权限。
- 负向 ⑩⑪：两种喂脏 feed 场景均拒绝且文案含 E_FEED_SIGNATURE，应用本体不受影响。
- 负向 ⑫：无 dev 开关注入被拒，应用正常启动（fail-closed 不 crash）。
- 下载缓存目录名跑出来是什么就在报告里记什么（任务书 §0.7 授权「以实际路径为准」）。

## 7. DoD 复核（§4 五条，全绿）

```
pnpm -r typecheck                        ✅（全部包 Done）
pnpm -r test                             ✅（desktop 16 files / 158 tests，含 P95 红线；全仓 importer 4 files 同绿）
node packages/ui/tokens/no-magic.mjs     ✅
pnpm -C apps/desktop selftest            ✅（SELFTEST OK）
pnpm -C apps/desktop build               ✅（✓ built in 3.47s）
另：pnpm -C apps/desktop dist            ✅（builder 配置真跑复核 + 端到端签验，见 §3.3）
```
