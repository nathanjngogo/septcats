# Septcats 0.6.10 —— 多维表格全视图 + 夜航仪表外观 + 四项新体验

这一版把「多维表格」补齐到可用深度，并把外观方向 B「夜航仪表」落到位。所有功能、界面与更新链路都经过门禁与真机验收（自动化测试 1484 例全绿 + 真机探针 65 项断言全绿），安装包逐字节审过。

## 新增
- **多维表格·仪表盘**：磁贴五型（计数表 / 占比色带 / 聚合大数字 / 文本板 / 分隔线），新建即预置磁贴，开箱有数；磁贴增删、排序、换引用字段全部落库。
- **多维表格·自动化**：三段式规则「当 记录创建/更新·字段 → 且 条件 → 把 字段=值」，支持启用/禁用/排序。规则在**每次写入时于本地主进程执行**，同一次更新内链式收敛（上限 5 轮防规则环），**一个操作落终值、不额外产生历史版本**。
- **多维表格·画廊视图**：记录铺成卡片网格，可选封面字段；卡片点开 = 记录详情。
- **多维表格·表单视图**：一次录一条，字段与必填可配；**必填没填不会被存进去**。
- **记录详情弹层**：看板/画廊卡片点标题即开，逐字段可改（与行内编辑同一条数据通道）。
- **隐藏字段**：工具条「字段显示」菜单逐字段开关，主字段（标题列）不可隐藏，隐藏状态持久。
- **专注模式（F9）**：一键收起侧栏与顶栏按钮，只留正文；再按 F9 或 Esc 退出。
- **页内查找（Ctrl+F）**：当前页内定位，回车在命中段落间跳转。
- **页内大纲**：页面有 2 个以上标题时出现「目录」，一键跳到某一节。
- **写作洞察条**：正文末尾显示「N 字 · 约读 M 分钟」，随打字实时更新。
- **一级侧边栏 + 日历 + 待办** 等既有能力继续完善（跨月显示可读性、破坏性操作二次确认等）。

## 变更
- 外观质感只保留三档：**极简 / 夜航仪表 / 毛玻璃**，默认「夜航仪表」（旧「像素」档作为兼容基线保留）。
- 顶栏同步信息去重：状态灯只保留一处，另一处改为事实型「最近同步时刻」，不再出现两种相反说法。

## 修复
- 修 4 处浅色主题下文字对比度不达 WCAG AA（顶栏同步标签、侧栏日历/待办的计数与空态）。
- 修「视图配置被静默丢弃」的底层缺陷（勾了必填却不生效的那类怪事，根因已治本并加回归护栏）。

## 数据兼容
- 操作段格式版本与 0.6.9 **相同（v3）**，老数据直接升级，无需中间版本，同步链路不受影响。
- 数据仍全部留在你自己机器上；以上新增能力**零外部请求**。

## 下载
- `Septcats Setup 0.6.10.exe`（102,742,205 字节）
- 自动更新 feed：`https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`

## 关于签名（诚实说明）
本安装包未购买商业代码签名证书，因此 Windows SmartScreen 可能提示「未知发布者」。这是客观限制而非缺陷：更新包用 **Ed25519 自签**，应用内以硬编码公钥验签后才安装，篡改或缺签一律拒绝。若需手动安装并被拦截：点击「更多信息」→「仍要展开」。

## 第三方许可
随包字体为 Source Han Sans / Noto Sans CJK（SIL Open Font License 1.1），许可文本已随应用分发（设置 → 关于 可查阅）。

---

# Septcats 0.6.10 — Full multi-table views, "Night Instrument" look, four new writing features

This release takes the multi-dimensional table to production depth and ships design direction B ("Night Instrument"). Everything is gated: 1,484 automated tests green, 65 on-device probe assertions green, installer verified byte-for-byte.

## New
- **Dashboard view**: five tile kinds (count table / share ramp / aggregated number / text pad / divider); new dashboards come pre-populated; tile add/remove/reorder/reference changes all persist.
- **Automation view**: three-part rules "when a record is created/updated on a field → and the condition holds → set field = value", with enable/disable and ordering. Rules run **locally in the main process on every write**, folding chained rules within the same update (max 5 rounds as a circuit breaker), landing the final value in **one operation with no extra history versions**.
- **Gallery view**: records as a card grid with an optional cover field; tapping a card title opens the record.
- **Form view**: one record per entry, configurable fields and required flags; **a missing required field is never saved**.
- **Record detail dialog** from kanban and gallery cards (same data path as inline editing).
- **Hidden fields**: per-field toggle in the toolbar; the primary field can never be hidden; state persists.
- **Focus mode (F9)**: hides rails and topbar buttons, keeps only the text; press F9 or Esc to exit.
- **Find in page (Ctrl+F)**: locate within the current page, Enter cycles matches.
- **Outline**: appears once a page has 2+ headings; jump to any section.
- **Writing insight bar**: word count and estimated reading time at the end of the page, live as you type.

## Changed
- Look system keeps three modes only: **Minimal / Night Instrument / Glass**, default Night Instrument (the legacy pixel mode stays as a compatibility baseline).
- Topbar sync indication de-duplicated: one status light plus a factual "last synced at", so two opposite statements can no longer appear.

## Fixed
- Four WCAG AA contrast failures in light theme (topbar sync label, calendar/todo sidebar counts and empty states).
- A root-cause defect where view configuration was silently dropped (the "I ticked required but nothing happened" class), now derived from the engine schema with a regression guard.

## Data compatibility
- Op segment format version is **the same as 0.6.9 (v3)** — direct upgrade, no intermediate version, sync unaffected.
- Your data stays on your machine; every feature above makes **zero external requests**.

## Download
- `Septcats Setup 0.6.10.exe` (102,742,205 bytes)
- Update feed: `https://github.com/nathanjngogo/septcats-releases/releases/download/latest/latest.yml(.sig)`

## On signing (honest note)
No commercial code-signing certificate was purchased, so SmartScreen may warn "unknown publisher". That is a real limitation, not a defect: updates are **Ed25519 self-signed** and verified against an embedded public key before install; tampered or unsigned payloads are refused outright. If blocked during manual install: click "More info" → "Run anyway".

## Third-party licenses
Bundled font is Source Han Sans / Noto Sans CJK (SIL Open Font License 1.1); the license text ships inside the app (Settings → About).
