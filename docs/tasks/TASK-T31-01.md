# TASK-T31-01 · 🔴 P0-3：真实升级库上同步**重发循环**、ops 永远不标记已发布

> PM：Hermes ｜ 优先级 **P0（阻断 0.3.0；老板真机实测）** ｜ 前置：T29-01 收口（`4c9e272`，rc.5）
> **复现夹具（现成，直接用）：`E:\Hermes Agent工作空间\_scratch\repro-boss-lib\`** —— 老板真实库的**只读副本**（`septcats.db` + `septcats.db-wal` + `sync/` 13 个段）

## 0. 现象（老板真机，rc.5 已安装）

- 状态栏常驻「**同步错误**」（红点），且老板反馈「软件还有很多问题」时该错仍在
- 我（PM）只读取证：
  - `op_ledger`: **30 条 op，其中 28 条 `seg_id IS NULL`**（从未标记已发布）；只有 2 条（9/16 那次）有 seg_id
  - op 内容是**干净的**：30 条 `lamport_d` 全部 = 本机真机 id `01m2ftdzbjcdn2q0sqzqzp8k7s`，`op_json.actor` 同样正确 → **不是 T28-01 的毒 op 问题**
  - `sync/` 里同一区间被**反复发布**（rc.5 摘要命名救了数据、不再互相覆盖，但循环未止）：
    ```
    seg-00000001-...-000002.jsonl            (9/16, 旧命名)
    seg-00000001-...-000002-153c8b46.jsonl ┐
    seg-00000001-...-000002-706629f9.jsonl │ 9/19 12:56
    seg-00000001-...-000002-c3d17206.jsonl │ 同一 (dev,c_from=1,n=2)
    seg-00000001-...-000002-e6f0daa3.jsonl ┘ 四个不同摘要
    ```
  - `sync/quarantine/` 存在（12:12）；`lamport_c` 范围 1..10，**未发布的 28 条覆盖 c=1..10 全部区间**

**推论**：发布路径写出了段文件，但**没有把 `seg_id` 回写到该批 op**（或回写所在事务失败/回滚）→ 水位不推进 → 下一轮又取同一区间 → 再写一个（摘要不同的）段 → **无限重发**；op 永远不离开队列，`sync.status()` 报错。

**为什么之前没抓到**：T28-01/T29-01 的验收都在**全新夹具**上做（空库起步，没有历史 + 没有既有旧命名段 + 没有 quarantine 残留）。老板的**升级库**才暴露这条路径。

## 1. 任务：先复现、再修（不许猜）

### 1.0 复现（必须先给出证据）
用现成夹具启动应用（隔离）：`--user-data-dir=<scratch>\repro-ud`，settings 的 `rootPath` 指向 `_scratch\repro-boss-lib`，`sync` 指向其 `sync/` 子目录副本（不要写原始夹具，先 `cp -r` 一份再指过去）。观察并记录：
- `sync.status()` 的 `state/errors/pendingOps/watermark` 逐轮变化（至少 3 轮，间隔 5s）
- 每轮后 `sync/` 段文件数量与名字（是否又新增同区间段）
- 每轮后 `op_ledger` 的 `seg_id IS NULL` 计数（是否始终 28）
- `sync/quarantine/` 是否新增
- 日志（`rootPath/logs/*.log`）里的错误原文
**把这些原文贴进报告**（这是本单最重要的产出）。

### 1.1 修（不变量）
1. **发布必须原子**：段写入 + 该批 op 的 `seg_id` 回写 + 水位推进，**同一事务**；任一失败则整批回滚，**不允许「段已落盘但 op 未标记」**（这正是当前循环的根因）。
2. **不得重发已发布区间**：取批逻辑以「`seg_id IS NULL` 的 op」为准（而非以水位推断）；若某区间已有段且其 op 已标记发布，**跳过**。
3. **旧命名/残留兼容**：`sync/quarantine/` 与旧命名段（无摘要）不得导致重复发布或死循环；无法解析的段要**明确留痕**（`sync.status().errors` 或计数），不得静默。
4. **可观测**：每轮同步的「取批区间 / 段名 / 标记条数 / 水位」写入日志（便于以后此类问题一眼定位）。

### 1.2 验收（必须全过，且**用老板的库副本**）
- 用夹具跑：**首轮同步后 28 条全部 `seg_id` 非空**、水位推进到 `max(c)=10`、`sync/` 不再新增同区间段（连续 3 轮段数稳定）、`sync.status().state='ok'`、`errors=[]`
- **回归**：全新夹具 + T29-01 的双实例脚本（`docs/mockups/cdp-e2e-t29-twin.mjs`）仍 ALL-PASS（`ledger ⊆ disk` missing=0）
- **真机（PM 会复核）**：把夹具换成老板库副本，应用启动后状态栏「已同步」且不再回到错误态；关掉重开仍 ok（幂等，不重复发布）

## 2. 红线

- 允许动：`packages/sync/**`、`apps/desktop/src/main/sync/**`、相关 `test/**`（`packages/sync/test`、`apps/desktop/test`）。
- **不碰**：`renderer/**`、`packages/{core,editor,ui,dbview,importer}`、CI/发布脚本、`main/**` 其它业务逻辑。
- **绝不写原始夹具**：`_scratch/repro-boss-lib` 只读使用（要写就 `cp -r` 一份再指过去）；**任何情况下不得触碰 `C:\Users\Administrator\.septcats\`**（老板真实库）。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（如需调整 §DEVIATION 逐条）。

## 3. 交付物

代码 + 测试（新增「升级库重发循环」回归，用夹具同构数据构造）+ `docs/tasks/TASK-T31-01-report.md`（PM 复跑节留「（PM 补）」；含 §1.0 的复现原文、根因结论、修复前后 `seg_id/水位/段数` 对照、DEVIATION 逐条）。