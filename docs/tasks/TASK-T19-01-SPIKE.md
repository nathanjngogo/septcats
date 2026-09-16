# TASK-T19-01 · SPIKE：多人协作（CRDT）与现有 op-log 架构的融合路径

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T18-05 已交付（HEAD `8436d79`，开工 `git log -1` 确认）
> 类型：**SPIKE（只出报告 + 一次性原型，不改生产代码）**。二期方向「协作」的选型取证；产出供老板做 G7 评审决策。
> 纪律：不碰 git；不新增仓库依赖；禁占位符/TODO。

## 0. 背景（PM 给定，无需重查）

- Septcats 现状：**op-log + 投影**架构——所有变更以 op 提交（`packages/core` 的 segment/replay），`packages/sync` 负责分片加密/ledger/多设备收敛（一期已验收：4 设备×30 op×4 切分投影逐字节相等）。
- 一期已预留：op 格式含 `merge_policy` 字段，CRDT 被显式推迟（计划书 §7 D3：一期不上 CRDT，二期升级）。
- 页面块内容现由 TipTap 承载；数据库值走 `record:update`。

## 1. 必须回答的决策问题（报告逐条作答）

1. **语义边界**：现有 op 能否表达并发协作？逐类列出「天然可交换 / 需要 merge policy / 无法表达」的 op 类型（文本块编辑、块增删移动、属性写、数据库单元格写、标题改名…），并指出最小必要的 merge policy 集合。
2. **三条候选路径的改动面 / 风险 / 量级**：
   - (a) 纯 op 层自研 merge_policy（含文本字符级合并）
   - (b) **混合**：块内容用 Yjs（`Y.Text`/`Y.XmlFragment`）承载 + op-log 承载结构/元数据；op 与 Yjs update 的边界与落盘形态
   - (c) 整库 Yjs（弃 op-log）
   每路径给出：涉及文件/模块、加密与 segment 的耦合、对既有 770+ 测试的影响、离线队列与冲突可视化（key_mismatch 那套 UI 是否复用）、实施量级（人日粗估）。
3. **最小可行性验证（必须做）**：在 `_scratch/spike-crdt/` 写一次性 Node 原型（不 import 仓库生产代码），**双客户端并发编辑收敛**：
   - 至少两种场景：① 同一块内交错字符编辑；② 结构性并发（一端删块、另一端改同块）+ 数据库单元格并发写。
   - 跑 N 轮随机并发（≥200），每轮断言两端最终状态一致；输出**收敛结果表**（轮数/一致率/发现的不一致案例）。
   - 若选 (b)/(c) 需展示 Yjs update 的二进制体积量级与「进 segment 加密」的可行性（可用 `Y.encodeStateAsUpdate` 结果大小统计）。
4. **耦合与冲突**：Yjs update 或 CRDT 元数据如何进入现有 segment/加密/ledger？是否需要新的 op 类型？与「多设备分钟级网盘同步」是否有冲突（如 update 体积、合并窗口）？
5. **结论与拆解**：推荐路径 + 3–5 个后续任务拆解（每个一句话范围）+ 风险清单（含明确「不建议做」的理由，如有）。

## 2. 交付物与红线

| 交付 | 说明 |
|---|---|
| `docs/tasks/TASK-T19-01-SPIKE-report.md` | 上述 5 问逐条作答 + 证据（命令输出、原型脚本路径、收敛数据表、体积统计） |
| `_scratch/spike-crdt/`（不进 git） | 一次性原型脚本 + 运行说明；可在该目录内临时 `npm i`（**不进仓、不动 package.json**） |

红线（零改动）：`packages/**`、`apps/**`、`docs/mockups/**`、根 `package.json`/`pnpm-workspace.yaml` 一律不动；只在 `docs/tasks/` 写报告、在 `_scratch/spike-crdt/` 写原型。

## 3. 验证与收尾

- 原型脚本可**重复运行**并输出同样的收敛对比（报告贴最后一次输出）。
- `git status --porcelain` 须只显示报告文件（原型在 `_scratch/`，已被 gitignore）。
- 最终回复：报告结论摘要（推荐路径 + 3 条最关键证据）+ 原型运行输出摘要 + 改动文件清单。

## 4. PM 侧（不必你做）

PM 审报告、独立复跑原型脚本、把结论整理成 G7 评审材料（含 0.2.0 发布建议）。