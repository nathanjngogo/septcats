# TASK-T80-06 · 便携包撤销漏还原段目录（H-10，P1）

> 来源：T80-04 收口后 PM 真机复跑 `cdp-e2e-t80-02.mjs` **20 PASS / 1 FAIL**——
> 唯一红 P5-3：「包外页随 revert 消失（还原语义成立）」失败。此前该断言被 H-09
> EBUSY 挡着从未真正执行过，T80-04 修好 revert 后第一次暴露。
> 严重度：P1——撤销导入的**产品承诺落空**：用户点「撤销导入」以为回到导入前，
> 实际重启后导入前建的包外页复活、且 op_ledger 与段文件不一致。

## 1. 根因（PM 已取证，勿重复侦察）

撤销链 `importRevert`（apps/desktop/src/main/portableImport.ts）只还原
**主库三件套**（septcats.db / -wal / -shm，经 `withConnectionClosed` →
`restorePairs`），**不还原 `data/sync/` 段目录与 manifest**。

真机铁证（`_scratch/t80-02-e2e-mugqy7wu/data/`）：
- revert 后 op_ledger 5 条，其中 2 条是「包外页」op（`01M3BXMPN0KZXT72PZ1584E56*`）；
- 段文件 `seg-...-e9248980.jsonl` 仍含包外页 upsert/patch op；
- 重启后同步引擎把「账本 ∪ 本地段」再对齐 → 包外页复活，`hasPageId(outsideId)` 为真。

同理 **execute 成功后**本地 sync/ 目录仍是「旧库段 + 新封段」混合态，
replace 语义只在 DB 投影层成立，段层没跟上——这是 T82-01 覆盖度守卫
（isSnapshotCarrier/merge）能再次触发毁灭性重建的同构土壤。

## 2. 修复要求

① `execute` 阶段：备份三件套的同时，把 `data/sync/`（manifest + 全部 seg-*.jsonl，
不含 quarantine）**一并快照**（目录级备份 `bak-portable-<ts>-sync/`，或把清单写进
既有备份元数据——选型你定，报告 §2 说明理由）。revert 时把 sync/ 目录一并还原
（先清目标再逐文件回写，复用 restorePairs 的快照回滚思路；目录操作也要
「失败不留半成品」）。

② 覆盖度预检 `coverage()`：本机 op_id 集合 = 账本 ∪ 攒段缓冲（T80-04 已做）。
本单补：**包内段 ∪ 本地盘上段**也要可比对——至少把「本地段里存在但包里没有的
op_id」计入 uncovered（否则包外 op 只在缓冲、不在账本时仍漏判）。

③ `--import-portable` CLI 与设置页撤销入口共用同一服务面，改动不得分叉。

④ 探针 `docs/mockups/cdp-e2e-t80-02.mjs` P5-3 判据是对的，**不许改探针迁就实现**；
修好后 PM 复跑必须 21/21。

## 3. 红线（违者退回）

- 真实数据根 `C:\Users\Administrator\.septcats\` 零触碰；测试夹具一律 scratch。
- 启动零外联；packages/* 不 import electron；不动既有安全闸（四道闸、
  E_PORTABLE_* 既有码语义、confirm 显式 true、mode:'replace' 显式）。
- 不动 T80-04 刚收口的 `withConnectionClosed`/快照回滚语义，只做增量。
- 备份三件套 `-wal/-shm` 同拷语义保持；sync 快照必须含 manifest.json。

## 4. 验收

- 新测试：revert 后 sync/ 目录逐文件=备份态（含 manifest）；包外页重启不复活；
  execute 成功态重启后本地段与账本一致（无孤儿段）。
- `pnpm --filter @septcats/desktop test` 与 `pnpm typecheck` 原始输出贴 §3。
- 报告尾 `DSH-T80-06-EXIT=0`。
