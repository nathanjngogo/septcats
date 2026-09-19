# TASK-T31-01 报告 · 🔴 P0-3 升级库同步重发循环（seg_id 永不回写）

> 工程师：CodeBuddy（**本轮跑满 150 轮上限退出，报告未写**）｜ PM 复跑与报告：Hermes
> 前置：`fe747ca`（任务书）｜ 交付提交：见 MILESTONES 行 ｜ 版本：`0.3.0-rc.6`

## §0 现象与取证（PM 在老板真实库只读）

- 老板真机（rc.5）状态栏常驻「同步错误」
- `op_ledger`：30 条 op，**28 条 `seg_id IS NULL`**（从未标记已发布）
- `sync/`：同一区间 `(dev, c_from=1, n=2)` 被反复发布为多个不同摘要段（rc.5 摘要命名**避免了覆盖丢数据**，但循环未止）
- ops 内容**干净**：30 条 `lamport_d` 全 = 真机 id → **不是 T28-01 毒 op 问题**
- 根因：**段写入与 `seg_id` 回写/水位推进非原子** → 水位不推进 → 每轮重取同一区间 → 无限重发、op 永不离开队列
- 复现夹具：`_scratch/repro-boss-lib`（老板库**只读副本**：db + wal + 13 段）

## §1 修复（工程师实现，PM 核对）

| 面 | 内容 |
|---|---|
| `packages/sync/src/writer.ts` | +64 行：发布路径调整，配合原子标记与命名对账 |
| `apps/desktop/src/main/sync/runtime.ts` | +231 行：**取批以「`seg_id IS NULL` 的 op」为准**（不再以水位推断）；段落后统一回写标记；冲突/异常留痕；每轮记日志（取批区间/段名/标记条数/水位） |
| `apps/desktop/src/db/statements.ts` | **只增不改**两条语句：`opLedger.listUnpublished`（`WHERE seg_id IS NULL ORDER BY seq`）、`opLedger.markSeg`（`UPDATE ... WHERE op_id=@op_id AND seg_id IS NULL`，幂等）✓ PM 追认 |
| 测试 | `packages/sync/test/writer.test.ts` +32 行；`apps/desktop/test/{sync-runtime,collab,actor-rebind,statements}.test.ts` 适配 |

**不变量达成**：①发布原子（段 + 标记同批/同事务；`markSeg` 仅对未标记行生效 → 幂等）②取批以未标记 op 为准、已发布区间跳过 ③留痕不再静默 ④每轮日志。

## §2 PM 独立验收（**老板库副本**，rc.6 真机）

夹具：`_scratch/repro-boss-lib` → 工作副本 `_scratch/rc6-libwork`（源夹具只读，未写）；启动 `Septcats.exe --user-data-dir=<隔离>`。

| 轮次 | `seg_id IS NULL` | `max(lamport_c)` | 段文件数 | 日志 sync/ERROR |
|---|---|---|---|---|
| 基线 | **28 / 30** | 10 | 13 | — |
| 第 1 轮 | **0 / 30** ✅ | 10 | 23 | 无 |
| 第 2 轮 | 0 / 30 ✅ | 10 | **23（不变）** | 无 |
| 第 3 轮 | 0 / 30 ✅ | 10 | **23（不变）** | 无 |

- ★ **28 条积压 op 全部标记已发布** → 队列清空、状态错误消失
- ★ **连续三轮段数稳定** → **重发循环停止**（循环期每轮都会新增同区间段）
- ★ 水位推进到 `maxc=10` ✓；日志无同步错误 ✓

## §3 全仓门禁（PM）

```
pnpm -r test      → 1029 无红（sync 108→109；desktop 435）
pnpm -r typecheck → 9/9
no-magic ✓ / build-tokens --check ✓
```
- **dbview「1 万条夹具」一条 FAIL → 隔离单跑 95/95 全绿**，判定为并发时序假红（非回归，已按既往口径记录）

## §4 遗留与说明

1. **CB 跑满 150 轮上限**（报告未写、§1 实现细节以其代码注释与 diff 为准）→ PM 接手完成验收与本文档；下轮同类 P0 单建议 `--max-turns 200+` 或拆成「复现」「修复」「验收」三段。
2. 副本 `sync/` 中历史重复区间段（循环期产物 + 旧命名 + quarantine）**未清理**——不影响正确性（已全部标记、不再重发），是否做一次性整理留待 PM 决定（考虑加「段整理/GC」小单）。
3. **升级库夹具已固化为回归资产**（`_scratch/repro-boss-lib`）：本项目今后必须同时跑「全新夹具」与「升级库夹具」两类真机验收——本次 P0-3 正是仅跑全新夹具而漏网。