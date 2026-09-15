# TASK-T16-01 · §9.2 性能红牌 #32：内存 612MB 根因分析（分析为主，禁投机优化）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T14 仪表盘 + perf-pack.mjs 真机实测（2026-09-16，rev 8857f1f，打包 0.1.3 空载）：startup 465.5ms 绿 / **WorkingSet 中位 612MB（606/612/620 三轮稳定）红，预算 350MB** / 安装包 88.5MB 绿。
> 必读：docs/PERF-BASELINE.md（§9.2 原文口径=「内存常驻 ≤350 MB（3 页标签）」）；scripts/perf-pack.mjs（现采样逻辑）；apps/desktop/src/main/index.ts（窗口/DbServer utilityProcess）；src/db/client.ts（utilityProcess 生命周期）。
> PM 采样三事实（本轮实测踩坑，直接照用，别再试错）：
> 1. `Get-CimInstance Win32_Process` 的 **CommandLine 对 detached spawn 的进程读回 null**（权限/session 差异）——按命令行过滤进程会全漏，必须用 `Get-Process` 的 **Path** 属性区分实例来源。
> 2. 打包安装版与 `dist/win-unpacked` 并存时，unpacked 不带 `--user-data-dir` 会因 userData（同 Roaming 路径+SQLite 独占锁）冲突**起 8 秒后崩**；测 unpacked 必带独立 `--user-data-dir`。
> 3. 采样前必须 `taskkill /F /IM Septcats.exe /T` 清场（安装版与 unpacked 一起清），否则计数污染。
> 纪律：用 Write/Edit；不碰 git；禁占位符。**本任务的交付是诊断报告，不是优化**——测量结论是什么就写什么，不许为了让指标好看改采样口径（除非证明口径本身错，那也要 PM 裁决）。不许动产品代码做投机性"优化"。

## 0. 背景定性（PM 已判）
- 612MB 空载（无文档打开）就超预算，不可能是"文档太大"——是结构性占用。
- Electron 多进程 WorkingSet **总和**是 Electron 应用的业界常见口径（主+GPU+渲染+utility 各进程物理页有共享，sum 会高估真实 RAM）；计划书若按「任务管理器整组」口径，612 未必真红——必须拆开进程账。

## 1. 交付 A：逐进程解剖（扩展 perf-pack.mjs）
- 按进程名/命令行拆 Septcats.exe：Browser（主）/ GPU / Renderer / utilityProcess（DbServer）；
- 每进程报：WorkingSet64、PrivateWorkingSet（PowerShell 可取 `Get-Counter` 或工作集私有页，选可得口径并在报告注明）、PID、启动角色；
- 三时点：启动稳态（现口径）/ 静置 60s 后 / 手动 GC 信号后（若可得）；
- 输出表进 docs/PERF-BASELINE.md §2 真机表（替换现有单一"中位"行）。

## 2. 交付 B：口径裁决依据（报告里写死，PM 定夺）
- 「sum of WorkingSet」vs「sum of PrivateWorkingSet」vs「任务管理器整组占用」三种口径的语义差异与各自数值；
- 对照业界：VSCode/Notion 同机同法测得的总 WSet（脚本里做成 `--baseline <exe路径>` 可选参数，若给了别的 Electron 应用 exe 就同法测它；没给就跳过，不许联网下载）；
- 结论建议：350MB 预算应该落在哪种口径 + 是否需要 PM 修订计划书 §9.2（你只给依据，不自行改计划书）。

## 3. 交付 C：DbServer utilityProcess 账
- 明确 utilityProcess 的 WSet（SQLite page cache 默认 −2MB × 页大小、journal 模式）是否占大头；
- 若 utility 侧占比显著：列出**候选旋钮**（cache_size、mmap_size、journal_mode 现状实测值——从 PRAGMA table_info 式只读查询取）与各自预期影响，标注「候选，待 PM 批」；**不改任何 PRAGMA**。

## 4. 交付 D：复现脚本与文档更新
- perf-pack.mjs 扩展保持零依赖（node:fs + powershell 子进程）；红牌逻辑改为：总和与私有和各报一个数，两口径都进 perf-history.jsonl（metric 名 memory_workingset_sum / memory_private_sum）；
- docs/PERF-BASELINE.md §2 重写：三行（sum/私有/安装包）+ 逐进程表。

## 5. DoD
```
node apps/desktop/scripts/perf-pack.mjs   # 跑通，输出逐进程表
pnpm -C apps/desktop exec node scripts/perf-pack.mjs --scan-only   # 快速回归不启动 app
pnpm -r typecheck   # 若 mjs 不涉 typecheck 则说明即可
```
报告 docs/tasks/TASK-T16-01-report.md：逐进程实测表 + 三口径数值 + 候选旋钮清单 + 建议（给 PM 裁决的选项列表，不许自己拍板）。
