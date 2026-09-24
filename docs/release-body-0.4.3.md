## 中文

Septcats 0.4.3 —— 正式稳定版（含 0.4.2 全部功能 + 发布合规收口）。

**合规（本版新增）**
- 随包字体 Noto Sans SC 的 SIL OFL 1.1 许可文本随安装包分发（`resources/licenses/`），设置 → 关于 有「第三方许可」入口
- 安装器启用最大压缩；包元数据补 `license` 声明（源码暂不公开 = Proprietary）

**工作台与效率（0.4.2 引入）**
- **个人工作台（home）**：卡片流仪表盘，11 张卡（快捷 / 待办 / 多维数据 / 最近 / 收藏 / 书签 / 倒数日 / 热力图 / 格言 / 快捷键 / 库统计）；自定义模式拖拽排序、移除、添加，重启原样还原
- **模板市场**：4 套内置模板一键套用（应用前自动备份、可一键还原布局）；「另存为模板」导出当前工作台；模板 JSON 导入 / 导出
- **库层级 UI**：库头行菜单新建 / 重命名三类库（普通 / 知识库 / 工作台）；切换库即还原各自标签页；工作台库切过去就是 home
- **页面密码锁**：单页加锁，锁内块内容与搜索索引受保护
- **主题画廊**：8 套像素壁纸主题 + OLED / 护眼档
- **外部链接**：书签条目点击跳系统浏览器；仅放行 http/https（file://、javascript: 等一律拒绝），审计日志只记域名不记完整链接（隐私优先）

**变更**：全局像素黑框线统一；编辑区标题表情符号换像素图标；Alt+H 现为打开模板市场（「我的工作台」入口在市场页内）；像素图标收编进设计系统 @septcats/ui
**修复**：开发模式下内置模板读不到；全新用户首次套用模板时没有备份可还原

**数据兼容**：SQLite 迁移自动执行；工作台布局 v1 → v2 自动迁移。0.4.0 及以上直接升级；0.1.x / 0.2.x 建议先升 0.3.0。

下载 Download：**Septcats.Setup.0.4.3.exe**（Windows x64，未做商业签名，首次运行见 SmartScreen「更多信息 → 仍要展开」）。
自动更新 feed：`releases/download/latest/latest.yml`(.sig)，Ed25519 验签后才安装。

## English

Septcats 0.4.3 — stable release (all of 0.4.2 plus release-compliance hardening).

**Compliance (new in this version)**
- SIL OFL 1.1 license text for the bundled Noto Sans SC font now ships inside the installer (`resources/licenses/`), with a "Third-party licenses" line under Settings → About
- Maximum installer compression; `license` metadata declared (source not public yet = Proprietary)

**Workspace & productivity (introduced in 0.4.2)**
- **Home dashboard** with 11 card types (quick actions, todos, databases, recent, favorites, bookmarks, countdown, heatmap, quote, shortcuts, library stats); customize mode supports drag-reorder / remove / add, persisted across restarts
- **Template market**: 4 built-in layouts apply with one click (layout auto-backed-up before apply, one-click restore); "Save as template" exports your current dashboard; import/export templates as JSON
- **Library hierarchy**: header-row menu to create/rename three library types (normal / knowledge / workspace); switching libraries restores each one's tabs; workspace libraries open straight into home
- **Per-page password lock** protecting block content and search index while locked
- **Theme gallery**: 8 pixel-wallpaper themes + OLED / eye-care modes
- **External links**: bookmark rows open in your system browser; only http/https allowed (file://, javascript: rejected); audit logs record hostnames only — never full URLs (privacy first)

**Changed**: global pixel-border unification; page-title emoji replaced with pixel icons; Alt+H now opens the template market ("My workspace" lives inside it); pixel glyphs consolidated into the @septcats/ui design system
**Fixed**: built-in templates unreadable in dev builds; no layout backup offered for first-time template apply on fresh installs

**Data compatible**: SQLite migrations run automatically; workspace layout migrates v1 → v2 on first open. Direct upgrade from 0.4.0+; from 0.1.x/0.2.x upgrade to 0.3.0 first.

Download: **Septcats.Setup.0.4.3.exe** (Windows x64, unsigned — on first run choose "More info → Run anyway" in SmartScreen).
Auto-update feed: `releases/download/latest/latest.yml`(.sig), installed only after Ed25519 signature verification.
