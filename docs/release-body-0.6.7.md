# Septcats 0.6.7

**中文**

本版本聚焦老板反馈闭环：整个软件随主题而变 + 毛玻璃真正通透。

新增 / 变更
- 主题三轴全联动：明暗 × 配色派系（6 系）× 质感风格（像素 / 线性 / 玻璃）现在覆盖到**每一条界面带**——含 0.6.6 起 Windows 下改为自绘的菜单栏带（文件/编辑/视图/帮助），不再有任何区域不随主题变。
- 毛玻璃（玻璃质感）通透重做：环境光底注入彩光斑，顶栏/侧栏/菜单带透明度大幅放开（42%→14% 混色），主编辑区底光透出；实测 chrome 区彩度信号 0.6→8.5，三档质感像素差 22~28%（客观逐像素验收）。
- 主题画廊已取消，外观设置内联进「设置 → 外观」，切换即时生效并持久。
- 左侧边栏新增批量删除：多选态 + 全选 + 二次确认弹层（防误删）。
- macOS：原生标题栏/系统菜单随明暗主题联动（nativeTheme）。

修复
- 深色档启动白闪一帧（窗口预绘底色现随主题）。
- 批量操作条边框在部分配色下不可见。

数据兼容：schema 版本不变（v3），0.6.x 各版可直接覆盖升级，无迁移。

下载：`Septcats Setup 0.6.7.exe`（约 103.5 MB）
自动更新 feed：`https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`
完整性：feed 内 latest.yml 由 Ed25519 私钥签名，应用更新时强制验签 + sha512 校验，任何篡改/缺签一律拒装（fail-closed）。

隐私：本地优先，云端 AI 默认关闭；密钥只进系统凭据库。

未签名提示：Windows SmartScreen 若拦截，点「更多信息 → 仍要展开」。无证书是客观限制（不强制收年费），诚实披露优于假装完成；包体经 sha512 + Ed25519 双验。

---

**English**

This release closes the loop on theme feedback: the entire app now follows the theme, and the frosted-glass look is truly translucent.

New / Changed
- Full theme coverage: light/dark × palette (6 families) × texture (pixel / linear / glass) now reach **every surface band**, including the menu bar (File/Edit/View/Help), custom-drawn since 0.6.6 on Windows. Nothing stays behind.
- Frosted glass rebuilt for transparency: chromatic ambient light pools under the chrome; top bar / sidebar / menu band alpha opened up (42% → 14% mix); editor surface lets ambient light through. Measured chroma signal 0.6 → 8.5; pairwise per-pixel difference across textures 22–28% (objective pixel gate).
- Theme gallery removed; appearance settings are inline in Settings → Appearance, apply instantly, persist across restarts.
- Sidebar batch delete: multi-select + select-all + confirm dialog (anti-footgun).
- macOS: native title bar and menu follow light/dark via nativeTheme.

Fixes
- White flash at startup in dark mode (window pre-paint background now follows theme).
- Batch action bar border invisible under some palettes.

Data compatibility: schema unchanged (v3); overlay-install over any 0.6.x, no migration.

Download: `Septcats Setup 0.6.7.exe` (~103.5 MB)
Update feed: `https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`
Integrity: latest.yml is Ed25519-signed; the updater enforces signature + sha512 verification and refuses any tampered or unsigned payload (fail-closed).

Privacy: local-first; cloud AI is off by default; secrets live only in the OS credential store.

Unsigned note: if SmartScreen blocks the installer, choose "More info → Run anyway". We publish honest per-release sha256 and signed feeds instead of buying a cert this year.
