# Septcats 0.6.11 —— 多维表格视图排序 + 首次启动导览

0.6.10 之后的增量收口。两项都是「第一次打开就该顺手感」的补齐，全部本地完成、零外部请求。已通过全部门禁与真机验收（自动化 1511 例全绿 + 真机探针 26 项断言全绿），安装包逐字节审过。

## 新增
- **多维表格·视图排序**：视图下拉里每行新增「前移到 / 后移到」按钮，可把任意视图挪到指定位置；排序结果落库，重载与重启后保持不变。首行的「前移到」自动禁用（已在最前），末行同理。点排序按钮时菜单不会闪闭、也不会误切换当前视图。
- **首次启动导览**：第一次打开应用会出现五步引导（欢迎 → 一级导航 → 命令面板 → 同步 → AI 对话），每步都有「第 n / 5 步」进度与说明；末步点「开始使用」即完成。之后启动不再打扰；设置页「关于」里可随时「重新观看导览」（重看不影响"已完成"状态）。`Esc` 或点背景 = 跳过，与完成同口径（不再自动弹）。

## 数据兼容
- 操作段格式版本与 0.6.10 / 0.6.9 **相同（v3）**，直接从旧版升级，无需中间版本，同步链路不受影响。
- 数据仍全部留在你自己机器上。

## 下载
- `Septcats Setup 0.6.11.exe`（102,749,699 字节 / sha512 见 latest.yml）
- 自动更新 feed：`https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`

## 关于签名（诚实说明）
本安装包未购买商业代码签名证书，因此 Windows SmartScreen 可能提示「未知发布者」。这是客观限制而非缺陷：更新包用 **Ed25519 自签**，应用内以硬编码公钥验签后才安装，篡改或缺签一律拒绝。若需手动安装并被拦截：点击「更多信息」→「仍要展开」。

---

# Septcats 0.6.11 — Multi-table view ordering + first-run tour

Incremental polish on top of 0.6.10. Everything is local, zero external requests. Verified end to end: 1,511 automated tests, 26 on-device probe assertions, installer verified byte-for-byte.

## New
- **Multi-table view ordering**: the view dropdown now has "move before / move after" on each row to reorder views arbitrarily; the order persists across reloads and restarts. The first row's "move before" is disabled (it's already first), same for the last row's "move after". Reordering never flashes the menu shut or accidentally switches the active view.
- **First-run tour**: on the very first launch, a five-step walkthrough appears (welcome → primary navigation → command palette → sync → AI chat) with "step n / 5" progress; the last step's "Get started" closes it. Later launches stay quiet, and Settings → About has "Replay the tour" any time (replaying doesn't clear the done stamp). `Esc` or clicking the backdrop = skip, same as finishing.

## Compatibility
- Op segment format is **v3, identical to 0.6.10 / 0.6.9** — upgrade directly, no intermediate step, sync unaffected.

## Download
- `Septcats Setup 0.6.11.exe` (102,749,699 bytes / sha512 in latest.yml)
- Update feed: `https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`

## On signing
No commercial certificate, so SmartScreen may warn "unknown publisher". Updates are **Ed25519 self-signed** and verified against an embedded public key before install; tampered or unsigned payloads are refused. If blocked: "More info" → "Run anyway".
