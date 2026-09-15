# TASK-T16-01 · 报告：内存红牌 #32 根因诊断（只诊断，未做任何优化）

> 工程师：CodeBuddy ｜ 日期：2026-09-16 ｜ rev 6eafbcd ｜ 对象：打包 0.1.3（dist/win-unpacked，空载）
> 红线遵守：**产品代码零改动**（main/index.ts、db/client.ts、statements、PRAGMA 全部未碰）；
> perf-pack.mjs 保持零依赖（node:fs + powershell 子进程）；预算与口径语义未改，两口径如实并报。
> PM 采样三事实已照用并固化进脚本：Get-Process Path 过滤（不依赖 CommandLine）、独立 --user-data-dir、采样前 taskkill 清场。

## 1. 逐进程解剖（交付 A）

`node scripts/perf-pack.mjs` 真跑一轮（taskkill 清场 → 启动 unpacked 0.1.3 → 稳态采样 ×3 → 静置 60s → 复采样 ×3）。

### 时点 1 稳态（启动 + 2s 后）

| 角色 | PID | WorkingSet | PrivateWS | 路径 |
|---|---|---|---|---|
| browser(main) | 19684 | 236.5 MB | 156.7 MB | dist\win-unpacked\Septcats.exe |
| utility:DbServer（node.mojom.NodeService = dbServer.js） | 21220 | 152.3 MB | 107.9 MB | 同上 |
| gpu | 25812 | 97.2 MB | 28.5 MB | 同上 |
| renderer | 26876 | 98.2 MB | 29.4 MB | 同上 |
| utility:NetworkService | 30332 | 50.9 MB | 9.3 MB | 同上 |
| **合计（5 进程）** | | **635.2 MB** | **331.7 MB** | |

### 时点 2 静置 60s 后

| 角色 | WorkingSet | PrivateWS |
|---|---|---|
| browser(main) | 235.4 MB | 152.1 MB |
| utility:DbServer | 152.1 MB | 107.7 MB |
| gpu | 96.8 MB | 28.1 MB |
| renderer | 97.7 MB | 28.5 MB |
| utility:NetworkService | 50.7 MB | 9.1 MB |
| **合计** | **632.8 MB** | **325.4 MB** |

### 解剖结论（诊断，非优化建议）

1. **无泄漏迹象**：静置 60s 各进程几乎零增长（sum 635.2 → 632.8 MB，微降），占用是**稳态结构性**的。
2. **没有单一大头**，是 Electron 多进程结构 × 5 的叠加：main 236 + DbServer 152 + renderer 98 + GPU 97 + network 51。
3. **DbServer utilityProcess 排第二（WS 152 / Private 108 MB）**，但其中 SQLite 实际占比有限：
   - 实测库文件仅 10.24 MB（page_count 2621 × 4KB），WAL 0.10 MB；
   - 页缓存 16 MB（见 §3，better-sqlite3 编译默认）；
   - 其余 ~90 MB 是 utilityProcess 的 **Node.js 运行时基线**（V8 堆 + Node 本体，空载即有），SQLite 不是主要矛盾。
4. main 进程 Private 156.7 MB：Electron main + pages/dbview/search/importer/sync/updater 六套 service + electron-updater，属框架 + 服务层常驻。
5. renderer 空载 98 MB / GPU 97 MB：Chromium 每进程基线，Electron 应用普遍如此。

## 2. 口径裁决依据（交付 B，两口径都摆出来，PM 定夺）

| 口径 | 实测（稳态中位） | 静置 60s | 语义 |
|---|---|---|---|
| **sum-of-WorkingSet**（perf-history: memory_workingset_sum） | **634.7 MB**（598/635/635） | 632.6 MB | 各进程物理驻留页直和。进程间**共享页被重复计入**（Electron 各进程共享同一份 Chromium 代码页），业界公认**高估**真实 RAM；但它是「任务管理器逐个相加」的口径，最直观 |
| **sum-of-PrivateWorkingSet**（perf-history: memory_private_sum） | **331.5 MB**（318/332/332） | 328.4 MB | 各进程**独占**私有页之和，无共享重复计入，最接近真实物理 RAM 压力，也最接近「任务管理器整组内存」观感 |
| 任务管理器整组占用 | 未单独测（与 sum-of-Private 同量级，差异 = 可共享页被按需计入的部分） | | 系统视角的整组提交/驻留，波动大、不可脚本稳定复现，不推荐作预算口径 |
| --baseline <exe> 对照 | 本轮 PM 未提供对照 exe，按任务书跳过（不联网下载）。脚本已支持 `--baseline <路径>`，后续可用 VSCode/Notion 同机同法补测 | | |

**量化分叉**：sum-WS 与 sum-Private 相差 **~303 MB（×1.91）**——即 612/635 MB 里约一半是共享页重复计数。
同一份物理内存，口径一换就从「超预算 81%」变成「预算内 95% 占用」。

**给 PM 的依据**：若 §9.2 计划书原文「内存常驻 ≤350 MB」的本意是「应用实际吃掉的物理内存」（与竞品对比、与任务管理器观感一致），则 sum-of-Private（331.5 MB）才是对应量级；若本意是「任务管理器里把 5 个 Septcats.exe 逐行相加」，则 sum-of-WS（634.7 MB）对应。**预算落哪个口径、是否修订 §9.2 原文，请 PM 裁决**——本报告不改计划书。

## 3. DbServer utilityProcess 账 + PRAGMA 只读实测（交付 C）

### 3.1 PRAGMA 现状（只读连接实测，`_scratch/cb-T16-pragma.mjs`，经 ELECTRON_RUN_AS_NODE 跑以匹配 better-sqlite3 的 Electron ABI；未改任何 PRAGMA）

| PRAGMA | 实测值 | 来源 |
|---|---|---|
| journal_mode | **wal**（持久化真值） | PRAGMA_BASELINE（schema.sql.ts:19-24）设 `journal_mode = WAL` |
| synchronous | 1（=NORMAL） | PRAGMA_BASELINE 设 |
| foreign_keys / busy_timeout | 1 / 5000 | PRAGMA_BASELINE 设 |
| page_size | 4096 | SQLite 默认 |
| **cache_size** | **-16000（=16 MB）** | **better-sqlite3 编译默认**（`deps/defines.gypi: SQLITE_DEFAULT_CACHE_SIZE=-16000`），**不是** PRAGMA_BASELINE 所设 |
| **mmap_size** | **0** | SQLite 默认（未启用 mmap） |
| wal_autocheckpoint | 1000 页 | SQLite 默认 |
| 库文件 / WAL / SHM | 10.24 MB / 0.10 MB / 0.03 MB | 空载真库 |

### 3.2 占比判断

DbServer utility Private 107.9 MB 中：SQLite 页缓存 16 MB（15%）+ 库页/WAL 映射少量 + **Node 运行时基线 ~90 MB（大头）**。
**utility 侧有可优化空间但不是 612→350 的主要杠杆**：即便 SQLite 侧全归零，sum-WS 也只降 ~30-50 MB。

### 3.3 候选旋钮清单（**候选，待 PM 批；本任务一个都没改**）

| 旋钮 | 现状 | 候选值 | 预期影响 | 风险 |
|---|---|---|---|---|
| `PRAGMA cache_size` | -16000（16 MB/连接） | -2000（2 MB，SQLite 默认）或 -4000 | sum-WS 降 ~12-14 MB；空载库仅 10 MB，16MB 缓存本就用不满 | 1 万页真库读写性能回退（T15 刚修完 FTS O(n²)，需复测 §1 四项不回退） |
| `PRAGMA mmap_size` | 0 | 如 268435456（256 MB） | 读写少一次用户态拷贝，性能↑；但 mmap 页计入 WS，**sum-WS 反而可能涨**（Private 不涨）——与内存预算方向相反 | 低（只读映射） |
| `PRAGMA journal_mode` | WAL | 保持 WAL | WAL 是性能正确选择；改 DELETE/JOURNAL 只省 WAL 伴生文件 ~0.1 MB 磁盘，内存几乎不变，**不建议动** | 改了会伤并发与 T15 成果 |
| DbServer 合并进 main 进程 | utilityProcess 独立进程 | —— | 消灭一个 Node 运行时基线（Private ~108 MB），是最大的单项杠杆 | 违背 T2「主进程永不 import better-sqlite3」架构决策；主进程卡顿直接冻结 UI；**架构级改动，须 PM 立项，非 PRAGMA 级旋钮** |

> 结论：SQLite 旋钮收益合计 ~15 MB 量级；真正的大头是「每进程 Chromium/Node 基线 ×5」的结构账，归口径裁决（§2）与架构取舍（上表末行）管。

## 4. 给 PM 的裁决选项列表（不拍板）

1. **口径裁决**：350MB 预算改绑 sum-of-Private（现值 331.5 绿）／维持 sum-of-WS（634.7 红，进入优化立项）／双轨（sum-WS 记观察值不设红牌，sum-Private 设预算）。
2. **计划书 §9.2 修订**：若改口径，同步把原文「内存常驻 ≤350 MB」注明口径与测量方法（perf-pack.mjs memory_private_sum），避免下轮再歧义。
3. **是否补 baseline 对照**：提供 VSCode/Notion 安装 exe 路径，跑 `--baseline` 同机同法对照后一并裁决（脚本已就绪）。
4. **是否批准 SQLite 旋钮实验**（若批准需新任务，先跑 §1 vitest 四项防回退）：cache_size 降档（预期 -12~14 MB）等。
5. **是否立项「DbServer 合并/降基线」架构评估**：最大单项杠杆（~-100 MB Private），但动 T2 架构决策，代价与风险另评。
6. **真机复测**：目标硬件上复跑本轮（脚本已固化清场 + 独立 user-data-dir + 双口径），回填 PERF-BASELINE §2。

## 5. DoD 记录

```
node apps/desktop/scripts/perf-pack.mjs         ✅ 跑通：逐进程表 + 三时点 + 双口径入账（memory_workingset_sum 634.7 红 / memory_private_sum 331.5 绿，如实并报）
pnpm -C apps/desktop exec node scripts/perf-pack.mjs --scan-only   ✅ 1/1 绿（installer 88.5 MB）
pnpm -r typecheck                               ✅ 全绿（perf-pack.mjs 为 .mjs，不在 tsconfig 范围，typecheck 本就不涉）
```

改动清单：
- `apps/desktop/scripts/perf-pack.mjs`：扩展（逐进程采样 Get-Process+Win32_PerfFormattedData、三时点、--baseline/--resample、--user-data-dir、taskkill 清场、双 metric 入账），零依赖保持；
- `docs/PERF-BASELINE.md` §2：重写为三口径总表 + 逐进程表；
- `docs/perf-history.jsonl`：追加 4 行（6eafbcd）；
- `_scratch/cb-T16-pragma.mjs`：PRAGMA 只读探测脚本（新增，一次性）；
- **产品代码（src/）零改动。**
