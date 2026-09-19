# CHECKPOINT（老板更新 Hermes 客户端前，2026-09-19 晚）

## 在飞
- **T38-01（AI 对话框）**：CodeBuddy 后台进程 PID 35820（`proc_951e32acf9c8`），派发词见会话记录。**客户端重启可能杀掉它**。
- 已落盘未提交（**不要当成完整交付提交**，重启后先核对完整性）：
  - 新增 `apps/desktop/src/renderer/src/ai/{AiChatPanel.tsx,AiChatPanel.css,chatBridge.ts,chatContext.ts,chatState.ts}`
  - 改动 `App.tsx`、`App.css`、`pages/PageView.tsx`、`palette/commands.ts`、`i18n/{zh-CN,en-US}.ts`
- WIP 快照：`_scratch/wip-t38-*.patch`（`git diff`）、`_scratch/wip-files.txt`（文件清单）。快照里**不含新增未跟踪文件的内容**，那 5 个 ai/* 文件在工作树里是完整的。

## 恢复步骤（客户端更新后）
1. `git log --oneline -1` 应为 `9712ffa`；`git status` 核对上列文件是否仍在。
2. 判断 T38-01 是否完成：看有没有 `docs/tasks/TASK-T38-01-report.md`；有则按老流程验收（全仓 DoD → 重打包 → 真机双主题 → 提交）；**没有则重派 T38-01**（先 `git checkout -- .` 清掉半成品或让工程师自己覆盖）。
3. 之后按队列续：T40-01 字段（P1 插队）→ T39-01 布局设计器 → T41-01 全宽开关 → T43-01 改称多维数据 → T42-01 转 Wiki → T44-01 双链。

## 当前基线
- 提交链尾：`9712ffa`；最近交付 rc.12（多页签，真机 8/8）。
- 全仓 1090 无红（desktop 471）；typecheck 9/9；双门禁 ✓。
- 队列单全部就绪：T38-01 / T39-01 / T40-01 / T42-01 / T44-01（T41-01、T43-01 待写）。
