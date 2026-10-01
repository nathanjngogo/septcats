# RUN — Septcats 值守接力棒（自动唤醒守卫用；勿删）

STATUS: ACTIVE
PURPOSE: 0.6.10 发布前清单（老板 2026-10-01 授权：自主做到底 + 自行包审）

## 心跳协议（PM 每轮必做，写入即承诺）
- 每完成一批（或每 ≤25 分钟）把 UTC 时间写入同目录 `HEARTBEAT` 文件（单行 ISO）。
- 收口前必刷：commit+push 完成后立刻更新本文件的「下一步」+ HEARTBEAT。
- 老板说停 → 把 STATUS 改成 STOPPED 并写明原因。

## 当前任务（T102：仪表盘 + 自动化 视图，飞书对标，老板 10-01 第⑤项）
侦察已完成（勿重做）：主进程 `apps/desktop/src/main/dbview.ts` 读写 views 走 `decodeViews/parseViews`（引擎 collectionEntitySchema 是视图读写通道）；`svc.createRecord≈739 行` / `svc.updateRecord≈775 行` 是自动化的触发点；`commitOps` 支持多 op 同事务；record upsert 的 `base=record.version`（追加 op 用 version+1 串行）；`schema_json` 顶层键会被 `parseCollectionSchema` 剥掉 → 自动化规则**改挂在视图上**（`DbView.widgets?` / `DbView.rules?`，经 `saveView→normalizeView` 往返，零新增 IPC）。

下一步按序执行（每步完成都跑对应测试）：
1. ✅ 引擎 `types.ts`：VIEW_TYPES+=dashboard|automation + widgets/rules schema（已收编提交，见回滚清单）。
2. 引擎 `view.ts`：`normalizeView` 清洗 widgets/rules（去重 id、剔未知类型/pid）；新纯函数 `resolveWidgets(schema, view)`（剔指向不存在/隐藏字段的项）、`evalRules(schema, rules, {kind,pid,values})` → 返回要写入的 {pid:value} 合并表（select 校验选项 id 存在）。
3. 引擎 `react/DbView.tsx`：dashboard/automation 两型不进 TableGrid（白名单逻辑已在），新增 render 插槽 props。
4. 主进程 `dbview.ts`：`createRecord/updateRecord` 执行规则（updateRecord 读旧值→合并 patch→逐条存活规则 eval→一个 batch 多 op；同轮再扫一遍 rules 直到不动点，防链式漏触发；规则改动（views_json 含 rules 的视图）→ 对应视图 version bump op）。
5. 应用层 `BitablePage.tsx`：+仪表盘/+自动化 按钮（新视图带默认 widgets/rules）；`DashboardBoard`（指标卡=groupBySelect/aggregate 复用引擎、加法小计、纯 CSS 色带）与 `AutomationBoard`（规则列表 + 开关 + 删除 + 新建）；CSS/i18n 双语；跑 no-magic。
6. 测试：引擎新纯函数 ≥10 例；`dbview.test`（主进程）规则触发/链式/版本 bump ≥4 例；`t99b/t99c` 面板 ≥8 例；T101 对比度加 2 面（dashboard/automation）。
7. 真机：`cdp-e2e-t99-01.mjs` 加 R13（建仪表盘→指标卡数与 IPC 读回一致；建规则「状态→读完时把分数设为 10」→ 看板拖动改状态 → IPC 读回分数=10 且视图 version+1）。
8. 门禁全量（ensure-abi node → dbview/ui/desktop test + tsc + no-magic）→ ensure-abi electron → dist 重打包 → T99/T85/T100 全绿 → 台账（CHANGELOG 0.6.10 + MILESTONES R61）→ commit+push（代理 7897 兜底脚本，gh token 一次性 URL，凭据不落日志）→ 更新本文件 STATUS/下一步 → 心跳。

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
