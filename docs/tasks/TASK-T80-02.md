# TASK-T80-02 · 便携包导入（首启重放重建 + 换库三段式）

> 前置：`docs/PRD-R28-便携包.md` §2；T80-01（导出侧）已收口——包格式以 `manifest-portable.json` 实际产出为准，开工先读 T80-01 报告 §1 与 `portableZip.ts`。基线=main。工作目录=主树。
> 只 Write/Edit 落盘；禁碰 git。报告写 `docs/tasks/TASK-T80-02-report.md`。收尾打印 `CB-T80-02-EXIT=0`。

## 开工侦察（报告 §0 必答四问）

1. **重放入口复用**：`db/server.ts` `REBUILD_CLEAR_SQL` + 段重放路径（T80-01 §0-① 的对齐结论）——导入是不是真的能零新机制复用？列出复用函数与需要的最小包装。
2. **停机边界**：main 侧「换库」要动哪些持有者（db server、pagesService 缓存、sync runtime、watcher）？找出**已有的** close/reopen 通道（migrations 换库/attach 流程是天然先例），不许自造第二套。
3. **冲突预检语义**：目标库「非空」判据用什么（op_ledger 行数？page alive>0？）——给出与首启种子逻辑（`ledgerHasCrdt` 种子门）不冲突的判据。
4. **回滚通道**：`*.db.bak-*` 既有命名谁在消费（migrations？设置页？）——新备份名 `septcats.db.bak-portable-<ts>` 会不会被现有清理/迁移逻辑误动。

## 交付面

- **IPC `portable:import`**：`plan({zipPath})` → 结构化预检报告（条目清点/checksums 全验/目标库现状/将占用字节/包内 schema 版本）；`execute({zipPath, confirm:true})` → 换库三段式：
  ① 备份现库（checkpoint TRUNCATE → 拷三件套为 `bak-portable-<ts>`）
  ② 建新库重放（校验 schema 版本 ≤ 当前，**跨版本兼容口径写进报告**；失败进 ③）
  ③ 失败回滚（还原备份，原库逐字节还原，结构化错误码）
- **入口两条**：设置页「数据」区「导入便携包」（选包走 dir 显式契约，与导出同形）；命令行 `--import-portable <zip>`（首启迁移工作流，文档化到 PRD §2）。
- **安全闸**：checksums 任一不合 → 整体拒绝不建库；zip slip 条目名 → 拒；加密库包（T80-01 闸的导入面对应物：包内标记 encrypted=true）→ `E_PORTABLE_ENCRYPTED_UNSUPPORTED`；半截 zip → 结构化错误码，禁未捕获异常。
- **幂等**：同包重复导入=同结果（断言第二遍 counts 与第一遍逐值等）；成功 toast + 撤销入口（还原本备份走既有恢复码同族的「显式确认」对话框骨架）。
- **测试**：roundtrip（导出→导入 counts 等）夹具级；三段式失败注入（重放中途抛错 → 原库逐字节还原断言）；冲突预检非空库拒；checksums 篡改拒；zip slip 拒。
- **门禁**：typecheck 0 + desktop/editor/importer/ui 基线只增不减（以合入时报告记载基线为准）+ no-magic ✓，贴原始输出。

## 红线

启动零外联；op-log 零新增语义（重放=既有段格式）；不 import electron 于 packages 内；禁静默覆盖现库（无备份不落库）；UI token/禁词纪律同前；不动 T80-01 已收口的导出面（发现问题记 DEVIATION 不顺手改）。

**T82-01 后新增硬要求（09-25，H-04 P0 教训）**：`rebuildFromSegments` 已增 `mode: 'replace' | 'merge'` 且缺省 merge——导入侧**必须显式传 `'replace'`**（包=权威全量），并在执行前自检包内段清单 ⊇ 预期（manifest.segments 数与实收段数一致，不符即拒），禁依赖缺省值；失败注入测试须断言回滚后原库逐字节还原。