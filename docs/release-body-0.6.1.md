# Septcats 0.6.1

## 中文
**这一版给界面换上了新皮肤，也让图片和附件跟着笔记一起走。**

**新功能**
- **主题市场新增两套质感**：除了原来的**像素**风，主题画廊多出「**质感风格**」一行——**Linear 极简**（1px 细边框、连续圆角、柔和投影）与**毛玻璃**（细边 + 大圆角 + 浮层磨砂背景）。质感与明暗（浅色/深色）、配色是三个互不干扰的维度，可以任意组合；命令面板里也新增了「切到 Linear / 毛玻璃 / 像素质感」三条命令。选择会记住，重启后保持。
- **附件同步（图片和文件会跟过去）**：图片、附件现在和笔记正文一起在设备间流动，采用与正文相同的**端到端加密**（流式分块信封，每帧带序号防重放）。上传走内容寻址（按 sha256 命名，同图不重传）、流式 64KB、并发上限 3 条并带指数退避；下载先复核 sha256，验不过的进隔离区而不是当成正常文件；**密钥不匹配不会熔断**——输入正确的恢复码后照常追平。一期**只增不删**：同步目录里的附件不会被自动清掉（回收策略在后续版本提供）。
- **同步文件夹向导**：设置 → 数据与隐私 → 同步路径「更改…」——选一个网盘客户端的同步目录 → 看清风险提示（不会搬运旧数据；新文件夹从首台设备起步）→ 一键重启生效。同步目录不再写死在数据根里。
- **托盘同步状态行**：托盘菜单顶部实时显示 未开启 / 已同步 / 待传 N / 同步中 / 出错 / 文件夹不可访问，节奏跟界面一致。
- **附件孤儿回收（对账式）**：设置页「清理未引用附件」——**先预览再执行**（放行/扣留条数与原因、30 天保留期），取消＝零写入；引用枚举宁多勿漏，看不准的一律扣留。
- **说明书更新**：新增「把同步接到网盘（分步）」「端到端加密与恢复码（含密钥丢失警告）」「数据与存储维护」三章，中英双语严格同构。
- **macOS 版本就绪**：`pnpm dist:mac` 一键产出 DMG（未签名）；更新元数据按平台分化（macOS 读 `latest-mac.yml`），Windows 与 macOS 的更新通道互不干扰。

**修复与加固**
- **发版护栏**：打包检查改为按渠道校验更新元数据（预发布版写 `rc.yml`、正式版写 `latest.yml`，macOS 加 `-mac` 后缀），并核对元数据声明的版本与体积与当前产物一致——杜绝「上一版元数据残留被签名上传，导致自动更新指向旧版本」这类静默错发。
- **持续集成**：Windows 与 macOS 两条流水线（类型检查、单元测试、守卫测试、打包）全部打通并转为绿灯；macOS 安装包由 CI 自动产出。

**升级安全**：零格式变化、无数据库迁移，0.6.0（及更老）数据直接升级；操作日志零新增类型。设置文件新增一个可选键 `sync.folder`（缺省＝原默认目录，老设置自动补默认值）。附件在同步根下新增 `files/` 目录，只会被 0.6.1 及以上版本读写；0.6.0 版本与 0.6.1 混用时不会删除该目录，只是看不到对方同步过来的附件——**要同步附件，请让参与的设备都升到 0.6.1**。

**下载**
- `Septcats Setup 0.6.1.exe`（Windows 10/11 x64，未签名）
- 自动更新地址（应用内已内置）：`https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml`

**未签名提示**：本安装包未做代码签名，Windows SmartScreen 会拦一次——点「更多信息」→「仍要运行」即可。更新包在安装前会由应用内置公钥（Ed25519）验签，源被篡改一律拒装。

**第三方许可**：随包分发思源黑体（Source Han Sans / Noto Sans CJK）等开源字体，许可文本随安装包一并提供（设置 → 关于）。

---

## English
**New skins for the interface — and your images and attachments now travel with your notes.**

**New**
- **Two new looks in the theme gallery**: alongside the original **pixel** style, the gallery gains a "**Look**" row — **Linear minimal** (1px hairlines, continuous radii, soft shadows) and **Frosted glass** (thin edges, large radii, blurred translucent panels). Look, light/dark, and palette are three independent axes you can combine freely; the command palette also offers three "switch look" commands. Your choice is remembered across restarts.
- **Attachment sync (images and files follow your notes)**: images and attachments now flow between devices with the same **end-to-end encryption** as your notes (streaming chunked envelope, per-frame sequence numbers against replay). Uploads are content-addressed (named by sha256, so the same image is never sent twice), streamed in 64KB chunks, capped at 3 concurrent transfers with exponential backoff; downloads are re-verified by sha256 and anything that fails goes to a quarantine area instead of being trusted; a **wrong key is never a dead end** — enter the correct recovery code and it catches up. This first round is **add-only**: attachments in the sync folder are never auto-deleted (reclaim arrives in a later release).
- **Sync folder wizard**: Settings → Data & Privacy → sync path "Change…" — pick a folder inside your cloud drive's sync directory → read the risk notes (your existing data is not moved; a new folder starts from the first device) → restart to apply. The sync folder is no longer hard-wired inside your data root.
- **Tray sync status line**: the tray menu now shows, live: not enabled / synced / N pending / syncing / error / folder unreachable.
- **Attachment orphan cleanup (reconciled)**: "Clean up unreferenced attachments" in Settings — **preview first, then run** (with keep/drop counts, reasons, and a 30-day grace period); cancelling writes nothing. Reference enumeration errs on the side of keeping: anything ambiguous is held back.
- **Manual updates**: three new bilingual chapters — connecting sync to a cloud drive, end-to-end encryption & recovery codes (including the lost-key warning), and data & storage housekeeping.
- **macOS build ready**: `pnpm dist:mac` produces a DMG (unsigned), with platform-specific update metadata (`latest-mac.yml` on macOS) so Windows and macOS update channels stay separate.

**Fixes & hardening**
- **Release guard**: the packaging check now validates update metadata per channel (prerelease builds write `rc.yml`, stable builds write `latest.yml`, with a `-mac` suffix on macOS) and cross-checks the declared version and size against the build on disk — closing off the silent failure mode where stale metadata from a previous version gets signed and uploaded, pointing auto-update at an old release.
- **CI**: the Windows and macOS pipelines (typecheck, unit tests, guard tests, packaging) are fully wired up and green; the macOS installer is produced by CI.

**Safe upgrade**: no format change, no database migration — 0.6.0 (and older) data upgrades directly, and the operation log gains no new types. The settings file gains one optional key, `sync.folder` (defaulting to the previous location, so older settings pick up the default automatically). Attachments add a `files/` directory under the sync root that only 0.6.1+ reads or writes; a 0.6.0 device sharing the same folder will not delete it, but will not see attachments synced from other devices either — **to sync attachments, update every participating device to 0.6.1**.

**Downloads**
- `Septcats Setup 0.6.1.exe` (Windows 10/11 x64, unsigned)
- Feed used by auto-update (built into the app): `https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml`

**Unsigned warning**: this installer is not code-signed, so Windows SmartScreen will prompt once — choose "More info" → "Run anyway". Update packages are verified against the app's built-in Ed25519 public key before install, and a tampered source is refused outright.

**Third-party licenses**: Source Han Sans / Noto Sans CJK and other open-source fonts ship with the installer, along with their license texts (Settings → About).