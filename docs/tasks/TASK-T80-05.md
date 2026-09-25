# TASK-T80-05 · 老板症状「点便携包导入没反应」——结案：版本差，非缺陷

> **结案（09-25 17:20）**：真机探针 `cdp-e2e-t80-05.mjs` 驱动完整 UI 链 **11/0 全绿**
> （点按钮 1.2s 弹出对话框、plan/execute/篡改拒/取消残留全通）。老板机器实况：
> 已安装 0.5.0 与 09-24 的 win-unpacked 两个 asar 内「便携包」0 命中——功能是
> 09-25 才合入，没进任何发布包。无需修复单；0.6.0 打包后自然消失。
> 遗留观察项（0.6.0 后补探针）：主窗最小化到托盘时 showOpenDialog(parent=主窗)
> 是否随隐藏主窗不前台。

> 来源：老板 09-25 报「点击便携包导入没有反应」+ PM 真机取证（cdp-e2e-t80-05.mjs 11 断言）
> 前置：**T80-04（H-09/H-08）在飞**——本单同改 `apps/desktop/src/main/portableImport.ts`，**必须等 T80-04 收口提交后再派发**（工作树互踩禁令）。
> 只 Write/Edit 落盘，不碰 git；每写完一个测试文件立即跑。收尾打印 DSH-T80-05-EXIT=0。

## 实证症状（PM 真机，探针 docs/mockups/cdp-e2e-t80-05.mjs）
1. **成功路径零可见反馈**：设置页「数据」区选包 → 预检 → 确认导入 → `execute` 真机成功（探针 P4-2/P4-3/P4-5 PASS：树含导入页、无错误 toast），**但界面没有任何 toast/inline 反馈**——用户以为没反应（老板即在此场景）。
2. **对话框取消后残留陈旧「导入预检失败」inline**（探针 P4-4 FAIL）：重开对话框取消 → `runImportPlan` 开头只 `setImportError(null)`，未清 `importPlan`/`importBusy`；上一轮失败的 plan 仍在 state → 结果分支 `else if (importPlan === null)` 不成立、`else if (importBusy)` 成立 → 什么都不渲染，**旧的 E_PORTABLE_* 错误块挂在页上**，用户看到的是「点了确定然后卡在失败文案」。

## 修复要求（最小）
- `runImportPlan` 入口**同时清** `setImportPlan(null)` 与 `setImportBusy(false)`（与 setImportError 三件套同清），保证「取消 = 回到初始态」；
- 成功路径的反馈与 T80-01 导出侧同形：`settings-saved` inline 块显示「已导入便携包」+ 备份路径 + 撤销入口（CB T80-02 报告 §4 D-7 声称已做——真机取证证明**成功场景实际未渲染**，查明为何没显示：`done.imported` 分支条件、`importResult` 在 execute 返回后是否被覆盖、或 inline 块被后续 setImportPlan 分支抢先；修到真机可见才算完）。
- **禁止**改 T80-04/H-09/H-08 面；发现与 T80-04 改动冲突记 DEVIATION 停手报告。

## DoD（PM 复跑口径）
1. 探针 `cdp-e2e-t80-05.mjs`（11 断言：触发 4 + 两段式 3 + 反馈 2 + 存活 2）**11/0 全绿**——尤其 P4-5（导入成功后 inline 反馈含备份路径或撤销字样）与 P4-4（取消后不残留失败 inline）。
2. `pnpm --filter @septcats/desktop test` 全绿（含新增：UI 状态机测试覆盖「取消=三态全清」与「成功=反馈可见」）；`pnpm typecheck` 9/9 Done。
3. 报告填 `docs/tasks/TASK-T80-05-report.md`（骨架随本卡建）。

## 红线
启动零外联；UI token/禁词纪律（「数据库」→「多维数据」）；不动已收口安全闸/错误码语义。
