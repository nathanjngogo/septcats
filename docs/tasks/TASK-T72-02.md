# TASK-T72-02 · T72 真机两产品缺陷修复收口（PM 底稿 → CB 定稿）

> 基线 = main `a9e290f`（T72 已合入）。真机探针 `cdp-e2e-t72-01.mjs` 首轮抓到 2 个产品缺陷，PM 已在工作区落下底稿修复（未提交），CB 负责**审查底稿 + 补回归钉 + 门禁定稿**。
> 工作目录 = 主树 `E:\Hermes Agent工作空间\Septcats`（底稿改动已在工作区，勿回退）。红线同 T72-01（不碰 git/不建表/不加依赖）。

## 缺陷 1（dev 态内置模板空列表）· 底稿：`apps/desktop/src/main/workbenchTemplates.ts`
- 根因：`candidateDirs()` dev 分支 `join(__dirname,'..','..')` = apps/desktop，少拼一层 `resources/`（真实资源在 `apps/desktop/resources/workbench-templates/`）。dev 态 `existsSync` 永假 → `workbenchTemplates.list()` 返回空 → 市场内置模板区全空。打包态路径正确（resourcesPath 直取）。
- PM 底稿：dev 候选改 `join(__dirname,'..','..','resources')` + 追加 `join(process.cwd(),'resources')` 兜底。
- CB 任务：核底稿正确性；在 `test/workbenchTemplates.test.ts` 补 1 例：以真实 `resources/workbench-templates` 相对布局建临时目录树，走 `createWorkbenchTemplatesService()` 无参路径（或注入与 dev 候选一致的结构）断言 4 内置模板可读（防未来再改目录拼接回退）。

## 缺陷 2（备份永远 null → 还原不可用）· 底稿：`apps/desktop/src/renderer/src/workbench/market.ts`
- 根因：`backupCurrentLayout()` 仅读 `readCardsPersist()`（localStorage）。全新用户从未动过卡（LS 无记录）时返回 null → `writeLayoutBackup(null)` 清除备份 → 「还原备份」在首次应用模板后不可用（施工单 §范围2「应用前一键备份当前布局」语义要求备份=应用前实际布局，store 里有真值，LS 只是持久化投影）。
- PM 底稿：LS 无记录时兜底 `workbenchStore.getState()` 的 `{v:VERSION, order:cardOrder, hidden:hiddenCards}`；已加 `WORKBENCH_CARDS_PERSIST_VERSION` import。
- CB 任务：核底稿（注意 Zustand getState 引用稳定、勿引入新订阅）；在 `test/t72-market-model.test.ts` 补 2 例：①LS 清空 + store 默认态 → `backupCurrentLayout()` 返回 v:2 合法 JSON（order=默认 11 序）；②该备份经 `restoreLayoutBackup()` 回放后 store 不崩且序一致。若底稿有不妥，按本单口径重写并记 DEVIATION。

## 门禁（CB 自跑贴原始输出）
typecheck 0 · desktop vitest 全绿只增不减 · ui 157 全绿 · no-magic ✓。
报告续写进 `docs/tasks/TASK-T72-01-report.md` 新增 §8「PM 真机缺陷修复（T72-02）」：现象/根因/修复/回归钉 + DEVIATION 续号。
完成后打印 CB-T72-02-EXIT=0；未 merge/未 push。