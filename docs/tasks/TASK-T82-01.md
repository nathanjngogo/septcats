# TASK-T82-01 · 修 P0：verifyLedgerIntegrity 毁灭性重建（数据丢失）

> 派单：PM（Hermes）09-24 夜深 ｜ 级别 **P0 数据丢失** ｜ 阻塞 0.6.0 与 T80-02
> 发现：docs/Bug-hunt-R29.md H-04（三段证据链：迁移备份 442→1、sync.log E_PROJECTION_REBUILT、代码面）
> 施工面：只 Write/Edit 落盘，不碰 git、不跑全仓（PM 复跑门禁）。

## 背景（一句话）

首轮同步的「账本计数一致性校验」一旦发现计数偏差（**启发式，天生可误判**），就调 `rebuildFromSegments`：**清空 op_ledger + 全部物化表 + FTS，仅重放同步目录里现存的段**。若本机账本含有段未覆盖的历史（同步刚开启时必然如此），这些历史被**永久抹除**。老板真实库因此从 442 页掉到 1 页（7384 ops → 2 ops）。

## 要求（四项，全部必须）

1. **覆盖度守卫（核心）**：重建前必须证明「段集 ⊇ 本机账本」——本机 `op_ledger` 的每个 `op_id` 都能在待重放段集中找到。**不满足则拒绝重建**：只留痕（新错误码 `E_LEDGER_UNCOVERED_OPS`，消息含 `未覆盖 op 数`）并置状态提示，**绝不动数据**。
2. **检查去竞态**：`expectedTotal` 现取「本轮开始前的快照 + 本轮新增」（`ledger` 在 line 749 早于本轮 commit 读取）→ 用户同期编辑/CRDT 落账即产生假偏差。改为**检查时刻实时读数**，或直接把判据换成「本机 op_id 集合 vs 段 op_id 集合」的一致性（推荐后者：语义直白、无竞态）。
3. **`rebuildFromSegments` 增模式**：加显式参数 `mode: 'replace' | 'merge'`。
   - `replace`：现语义（清空后重放）——**只允许**在覆盖度守卫通过时使用（T80-02 便携包导入用它：包内段=全量）；
   - `merge`：保留本机账本中段未覆盖的 op（并集），仅重建投影。**自愈路径默认 merge**。
   默认值给 `merge`（安全侧），显式传 `replace` 才走清空语义。
4. **测试**：
   - 新增**红测**：构造「本机账本 10 op、段只含 1 op」→ 调用自愈校验 → 断言**未**发生重建、账本 op 数不变、留痕 `E_LEDGER_UNCOVERED_OPS`（复现 442→1 场景）；
   - 绿测：段完整覆盖时 `replace` 正常重建；
   - `merge` 测：段缺 op 时并集保留、投影一致；
   - 同步修正测试桩 `test/sync-runtime.test.ts:100-110`（现 `ops.clear()` 编码了危险语义）。

## 红线

- 不改 `packages/sync` 收敛核心与 `filterAgainstLedger`；
- 不改 `REBUILD_CLEAR_SQL` 的清表清单（T80-01 便携包导入侧共用，改清单会波及在途单）；
- 任何路径不得让「段集不完整」变成「数据减少」；
- 报告骨架 `docs/tasks/TASK-T82-01-report.md` 前置，§0 先答四问：①现判据的误判面有哪些 ②`replace` 的所有调用点清单（runtime/vendor/测试）③`merge` 语义下 FTS/派生索引怎么重建 ④覆盖度校验的成本（963 op 规模实测毫秒数）。

## 附带项（原 T80-03 保留面，一并做）

**同类面排查**：全仓扫「preload 不传参 `ipcRenderer.invoke(CH)` ↔ main 侧要求对象入参」组合（已知先例：portable preview 已 PM 一行修）。产出表 `channel | preload 形态 | main 守卫要求 | 判定（修/不需修+理由）` 写进报告 §6。参照 `grep -rn "IPC 参数必须是对象" apps/desktop/src/main`（13 处守卫）。