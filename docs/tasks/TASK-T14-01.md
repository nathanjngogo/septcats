# TASK-T14-01 · G4 性能基线仪表盘（§9.2 硬指标实测）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T13 已合入。必读：docs/PROJECT_PLAN.md §9.2（六项硬指标）；apps/desktop/scripts/（ensure-abi 范式）；apps/desktop/src/db（DbServer/executor 真库面）；packages/core（segment/replay——1 万页夹具用）；test/helpers.ts（makeSearchFixtureDb mulberry32 范式——复用其生成器）。
> 纪律：用 Write/Edit 落盘；测试必须真跑；不碰 git；禁占位符。

## 0. 一句话
把 §9.2 六项指标变成**可重复执行的测量**：能在 CI/vitest 里测的全进测试（带预算断言），必须真机测的出脚本+PM 执行。产出 `docs/PERF-BASELINE.md`（每轮跑完由脚本自动追加数据表）。

## 1. 可 vitest 化的四项（apps/desktop/test/perf.test.ts，name=perf，慢组显式 30s 超时）
统一夹具：1 万页×平均 8 块（复用 makeSearchFixtureDb 生成器参数化，确定性种子）。
- **搜索 1 万页 ≤150ms**：search.test.ts 已有 P95——本测试改为**冷启动账本**：新进程打开真库→第一次查询也 ≤150ms（现在只测热态）。
- **输入延迟等价物 ≤16ms（1 万字页）**：不走真 ProseMirror（vitest 无渲染），测**提交路径**：单页 1 万字拆 200 块的 commitOps batch 落库 P95 ≤16ms（这是输入→落库的真实预算段）。
- **投影重建**：1 万页账本 rebuildFromSegments 全量 <5s（预算 PM 定，测出基线）。
- **DB 打开+迁移**：1 万页库冷打开+migrate+首查 <800ms（首屏预算的 DB 段）。
每项：①console.log 实测值；②预算断言；③把 {date, git_rev, metric, value_ms, budget_ms, pass} 追加写 `docs/perf-history.jsonl`（脚本内 fs 写，测试文件路径相对 apps/desktop）。

## 2. 必须真机测的两项 → `apps/desktop/scripts/perf-pack.mjs`（PM 执行）
- 冷启动 ≤1.5s：`electron . --perf-trace`（main 侧：app.whenReady→首窗 did-finish-load 打点，差值写 userData/perf-startup.json 并 console.log `[perf] startup_ms=`）——**给 index.ts 加这段打点代码（仅 --perf-trace 开关下启用，平时零开销）**。
- 内存 ≤350MB：脚本 spawn 打包版 Septcats，轮询 3 次 `process.getProcessMemoryInfo` 等价的 powershell WorkingSet 采样（脚本内调 powershell），取中位。
- 安装包 ≤90MB：现 dist 目录扫描（>90 红牌列出）。
- 全部结果追加 docs/perf-history.jsonl + 终端表格。

## 3. 交付
- test/perf.test.ts（4 项预算全断言，跑通）
- main 启动打点（--perf-trace 门，默认关）
- scripts/perf-pack.mjs（真机两项+安装包扫描）
- docs/PERF-BASELINE.md 首版（本轮 4 项 vitest 实测数据 + 待真机两项的占位说明）
- DoD：pnpm -r typecheck && pnpm -C apps/desktop test（perf 组绿）&& no-magic && build；报告 TASK-T14-01-report.md
