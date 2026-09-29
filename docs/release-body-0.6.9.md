# Septcats 0.6.9

**中文**

本版本闭环老板三轮主题打回：整个软件随主题而变到最后一寸 + 毛玻璃真通透（透出桌面背景）。

新增 / 变更
- 自绘标题带（Windows）：撤掉 OS 原生标题文字区，品牌带改由界面层自绘——明暗 × 配色派系 × 质感三轴全联动；窗口按钮保留系统原生绘制（悬停红 X / 键盘可达 / 贴边吸附 / 圆角不动），其颜色随实测主题色即时刷新。顶带从此不再有「不跟主题」的死角。
- 毛玻璃真通透：玻璃质感档现在**透出桌面壁纸**——应用读取系统壁纸铺进窗口底层（只驻内存、不落日志、不出网），侧栏/顶栏/菜单带的磨砂磨的就是壁纸像素 + 主题彩光斑；正文区保留薄纱护可读性。回到窗口时自动重拉壁纸（换壁纸后切回来即刷新）。
- 像素级验收：玻璃档侧栏彩度 16 → 71（同窗切档对照，客观判据非主观观感）；质感三档像素差门 22/22 维持。

修复
- H-06 数据一致性（0.6.8）：档案段重建时双链反查索引与 @ 提及表同步重建，杜绝重建后链接面板与投影不一致（含回归用例锁定）。
- 壁纸衬底在 pixel/linear 质感与读不到壁纸的场景一律保持实心（门控可逆，无行为变化）。

数据兼容：schema 版本不变（v3），0.6.x 各版可直接覆盖升级，无迁移。

下载：`Septcats Setup 0.6.9.exe`（约 103.5 MB）

---

**English**

This release closes three rounds of theme-fidelity feedback: every surface of the app now follows the theme, and the glass look is genuinely translucent (it shows your desktop wallpaper through).

New / Changed
- Custom-drawn title band (Windows): the OS-native title text area is replaced by a theme-token-driven band — dark/light × color palette × material style all apply. Window controls stay native (hover-red close, keyboard access, snap layouts, rounded corners), and their tint now tracks the live theme colors.
- True glass translucency: the glass material now shows the **desktop wallpaper** through the window — the app reads the system wallpaper and lays it under the translucent side/top/menu bars (memory-only; never logged, never written, never sent). The main text keeps a light veil for readability. Re-focusing the window re-reads the wallpaper, so switching wallpapers updates the effect.
- Pixel-level acceptance: glass sidebar chroma 16 → 71 (same-window A/B against the opaque baseline); the 22-point material contrast suite still passes.

Fixed
- H-06 (0.6.8): backlink index and mention table are rebuilt together with the main projection during segment replays, with regression coverage.
- Wallpaper underlay is fully gated: pixel/linear materials and missing-wallpaper cases stay completely opaque (reversible, zero behavior change).

Data compatibility: schema v3 unchanged — direct over-the-top upgrade from any 0.6.x.

Download: `Septcats Setup 0.6.9.exe` (~103.5 MB)
