# RUN — Septcats 值守接力棒（自动唤醒守卫用；勿删）

STATUS: ACTIVE
PURPOSE: 0.6.10 发布前清单（老板 2026-10-01 授权：自主做到底 + 自行包审）

## 心跳协议（PM 每轮必做，写入即承诺）
- 每完成一批（或每 ≤25 分钟）把 UTC 时间写入同目录 `HEARTBEAT` 文件（单行 ISO）。
- 收口前必刷：commit+push 完成后立刻更新本文件的「下一步」+ HEARTBEAT。
- 老板说停 → 把 STATUS 改成 STOPPED 并写明原因。

## 当前任务（IDEA-E：视图排序 —— 0.6.10 清单「创意环节」第①项，老板 10-01 授权自主做到底）
1. ✅ 引擎 `view.ts`：`reorderById` 纯函数 + view.test 8 例（值守 10-02 04:58，`9bd581a`；dbview tsc 0·全包 184/184 绿）。落点口径：右拖占目标后、左拖占目标前、from===to/未知 id 原样拷贝、返回新数组不改入参。视图序=`collection.views` 数组序，持久化走既有 `onSaveView→viewSave→collectionUpsertOp` 整对象通道（零新增 IPC）。
2. **下一步（渲染层接线）**：`packages/dbview/src/react/DbView.tsx` 视图条（`visibleViews`，~137 行起）加拖拽改序（draggable 页签 + onDrop → `reorderById` → 落库）。**动手前先 grep `onSaveView` 全部宿主实现**：若宿主只收单视图（`{...activeView, ...patch}`），单视图通道改不了 views 数组序 → 落点二选一：宿主加 views 重排回调，或 viewSave 全量提交路径本就带 views（侦察后再定，属 DEVIATION 就记录）。键盘等价红线：页签 Alt+←/→ 移动（拖拽必须配键盘等价，skill UI 门禁）；新 CJK 字面量走 i18n 双语。
3. 之后：react/dbview 测试 ≥6 例 → 真机探针（建 3 视图→拖序→IPC 读回 views 序一致→重启仍在）→ 首次启动导览（清单第②项，独立子步）→ 全量门禁 + ensure-abi electron + 重打包 + 包审 + 台账（CHANGELOG 0.6.10 + MILESTONES）→ commit+push → STATUS=COMPLETE 汇报待发版。

## 避让规则（主会话与值守通用——双向检查，防双写冲突）
- **任何会话动手改代码前，先看 `.hermes/CLAIM`**：存在且 mtime <40 分钟 → 别人在干，本会话只做只读汇报，不改代码。
- 主会话（PM）开工第一件事 = 写 `.hermes/CLAIM`（时间+将做的步骤），收口时删除；值守协议本就如此。
- 交接以 CLAIM 为唯一锁；RUN.md 的「下一步」在 CLAIM 持有期间只许持有者改。

## 回滚清单（一步一 commit；功能级大回滚 = git reset --hard <tag>；创意项各打 rollback/idea-*）
- `rollback/pre-T102` = 06e62f4（画廊+表单完成态：全门禁绿+真机 T99 20/20）——**T102 出任何问题回这里**。
- 每步完成：`git tag -f rollback/t102-step<N> HEAD` 并 push tags。

## 值守日志（追加式）
- 16:58 值守第一拍点火（认领 step-1）→ 无下文（疑似被拍死/会话被截）。
- 17:19 主会话收编 step-1（types.ts，tsc 已验）→ `27f91c6`。看门狗阈值修正：cron 单次 3 分钟硬中断 → CLAIM 超 10 分钟判死尸（RECLAIM 态），每批=文件级子步。

- 04:55 值守接管（心跳 42min 超阈、无 CLAIM、树净）：认领 IDEA-E step1=引擎 view.ts `reorderById` + 8 例；dbview tsc 0·184/184；commit 9bd581a。下一子步=渲染层接线（含 onSaveView 宿主侦察）。
## 红线（值守 Agent 必须遵守）
- 真实档案 `C:/Users/Administrator/.septcats/` **只读**；探针用 `_scratch` 副本 + mtime 双钉。
- 测试跑前 `node apps/desktop/scripts/ensure-abi.mjs node`；打包前 `... electron`。
- `pnpm -C apps/desktop test` 全绿才允许 commit；PATH 钉 `C:/Users/Administrator/AppData/Local/hermes/node`。
- **不 publish**（0.6.10 未经老板点头发布）；不改 git 历史；不碰 `titleBarOverlay`。
- 布局磁贴编号走 `data-num` + CSS `::before`（禁写 DOM 文本）。
- 改组件 CSS 必跑 `node packages/ui/tokens/no-magic.mjs`；框线用 `var(--sc-border-edge)`。
- 测试禁硬编码日期；探针状态断言前显式切回目标档并钉值。
- 值守触发条件：HEARTBEAT 距今 ≥15 分钟 且 `git status` 干净 → 才捡「下一步」；**脏 → 只 block 不猜**。

## 已完成（勿重做）
- R55 评审修复 / 方向 B 三档 / 结构层（R56 前）/ 记录详情（R56）/ 隐藏字段（R57）/ 全站对比度扫描 + 同步去重（R58/R59）/ 画廊 + 表单 + 主进程 schema 治本（R60，`06e62f4` 已推）。
- 02:05 T102 全部完成（step1-8 ✓），值守日志：R13 两条 FAIL 均为探针自身缺陷（漏传 pid/选靶错），修复不改功能。下一步=创意环节（视图排序 + 首次启动导览），STATUS 保持 ACTIVE。
- 02:25 IDEA-A 专注模式完成：7 单测 + 真机 8/8 + 打包在案（tag rollback/idea-a-focus）。教训入档：快捷键逻辑必须与测试同源（useFocusHotkeys），内联 App+复制逻辑=假绿。
- 02:50 IDEA-B 完成（洞察条 283 单测 + 真机 10/10）。老板追加令：「所有权限给你，自己审核，不用通过我」→ 审核段：全新重打包 → audit-package → 全新装验证 → i18n 双语键对齐扫描 → 全探针回归 → 汇总报告写本文件+CHANGELOG。

## 安装包审核报告（0.6.10 终包 = 102,736,008 B / sha256 edd59e34…；02:00-02:05 全自主执行）
1. 静态包审 audit-package-0.6.10.mjs **17/17 PASS**（锚点已同步终包）：三方版本一致/yml-size-sha512 逐字节/PE 元数据/零 sourcemap 零 TS 零测试残留/asar 关键产物齐/BMI unpacked/凭据扫描 0 命中/webPreferences 安全三件/外链守卫在包/发布资产只含当前版。
2. NSIS 解包逐字节：Setup → app-64.7z → 与 win-unpacked 比对——Septcats.exe/app.asar/better_sqlite3.node 三件 sha256 全同，**79/79 文件集零差异**（用户装到的=审过的）。
3. 已装审计：老板机装的是旧候选（asar 016dd3c2 ≠ 终包 2ecfbdc2）→ 经全权授权静默更新终包 → 复核已装 asar = 终包逐字节 ✓；已装版真机探针 10/10（独立 profile，真实档案零触碰）。
4. 真机回归全集：T99 24/24 · T100 8/8 · T85 36/36 · T93 7/7 · T94 9/9 · T97-98 9/9 · T92 11/11（顶栏契约更新到八钮新基线=专注钮入位）· IDEA-A 10/10（含 IDEA-B 洞察条断言）。
5. 对比度扫描：18 面 × 1265 文本元素，dark/light 双主题 **0 违例**。
6. 门禁：desktop 1472/1472（131 文件）· ui 192 · dbview 176 · editor 283 · tsc 0 · no-magic 0。
7. 修复留痕：本轮发现并修 4 处 AA 违例（ink-faint×chrome）+ 1 处谎报（同步状态两处指示矛盾）+ 主进程视图 schema 手抄漂移（治本派生）+ T92 契约随新钮更新。
结论：**0.6.10 候选包=已装包，全门禁+全探针+静态+解包四维全绿，可发布**（publish 仍按规矩等老板点头）。
回滚锚：rollback/pre-T102（T102 前）· rollback/t102-step2/3/4 · rollback/idea-a-focus · rollback/idea-b-stats。
- 03:45 重审闭环：新终包 102,742,454 / sha256 ac09923f…（锚点已同步）；静态 17/17、NSIS 解包逐字节 79/79 零差异、老板机重装 d5fa0f1c 一致、已装版真机四连 T99 24/24·A 10/10·C 5/5·D 7/7 全绿。0.6.10 候选=已装=审过。
- 03:40 说明书同步（Ctrl+F/F9 双语 + 正文 4 条；manual-markdown 契约 6→8）→ **?raw 进包 ⇒ 重打包重审**：终包 102,742,205/70f85252…；静态 17/17、NSIS 逐字节 79/79、老板机重装 c9f4d117 一致、已装版真机 T99 24/24 + IDEA-A 10/10。打包坑入档：pnpm dist 子进程找不到 pnpm → 分步 build+electron-builder。至此创意 A-D + 包审 + 说明书全部闭环。
