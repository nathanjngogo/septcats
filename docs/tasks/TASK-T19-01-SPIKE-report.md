# TASK-T19-01 · SPIKE 报告：多人协作（CRDT）与现有 op-log 架构的融合路径

> 工程师：CodeBuddy ｜ 日期：2026-09-17 ｜ 前置：T18-05 已交付（HEAD `8436d79`，开工 `git log -1` 已确认）
> 类型：SPIKE。零改动红线遵守情况见 §5.4；原型在 `_scratch/spike-crdt/`（不进 git）。
> 摘要行：**推荐 (b) 混合路线——块内容/页面结构用 Yjs 承载，实体元数据与数据库值继续走 op-log；新增 `crdt_update` op 类型把 Y.Doc 纳入既有段/加密/ledger 管线。**

---

## 0. 架构俯读取证（证据索引）

先通读四处的现有形态，后文全部引用这里的事实：

| # | 事实 | 证据 |
|---|---|---|
| E1 | op 五类：`upsert/delete/move/reorder/patch`；目标表五类：`page/block/collection/record/schema` | `packages/core/src/op.ts:34`、`op.ts:38` |
| E2 | `mergePolicySchema = z.literal('lww')`，注释明示「Q5 预留 CRDT 扩展位」 | `packages/core/src/op.ts:52-54` |
| E3 | `base`（并发基版本）仅 patch/move/reorder 允许携带 | `packages/core/src/op.ts:167-173` |
| E4 | replay 按 `(c, d, op_id)` 全序排序后 LWW：仅 `op.lamport > entity.lamport` 才生效；同 `c` 不同 `d` 的被覆盖版本记入 `ReplayConflict`（冲突副本素材） | `packages/core/src/replay.ts:82-113` |
| E5 | 段不变量要求 ops 按 lamport **严格升序**（全序硬编码进段格式）；段名含 `(c_from, dev, n)` | `packages/core/src/segment.ts:91-93`、`segment.ts:128-130` |
| E6 | `Entity.data` 为 JSON payload；块 `content` 是无结构 JSON 字段 | `packages/core/src/projection.ts:7-14`、`packages/core/src/op.ts:105-117` |
| E7 | mergeRemote：内容 hash 去重 → `decodeSegment` → 交 `core.replay` 判冲突（禁止 sync 另写冲突判定） | `packages/sync/src/merger.ts:87-189`（尤其 181-185） |
| E8 | 攒段四触发：500 条 / **256 KB** / 1000 时钟跨度 / 空闲 | `packages/sync/src/writer.ts:31-35` |
| E9 | 快照折叠：整段折叠成稳定键序快照 + `snapshotToOps` 播种回读自检 | `packages/sync/src/snapshot.ts:52-108` |
| E10 | manifest 合并：设备表并集、各水位取 max、schema_ver 取 min | `packages/sync/src/manifest.ts:144-177` |
| E11 | 一期收敛验收：4 设备 × 30 op × 4 种段切分「合并后最终投影逐字节相等」 | `packages/sync/test/convergence.test.ts:131-132` |
| E12 | 编辑器 diff：`content` 变化 → **整字段 patch{content}**（无字符级差分）；并发判定靠 `version+1` LWW | `packages/editor/src/diff.ts:303-324`（尤其 322） |
| E13 | TipTap 承载面：`blocksToPMDoc`（投影）/`pmDocToBlocks`（反投影）→ `onChange(BlockDoc)`；组件不 commit，外发归 EditSession | `packages/editor/src/react/Editor.tsx:2-6`、`Editor.tsx:54-59` |
| E14 | EditSession：debounce 300ms 折叠编辑轮次 → 一批 Op 一次提交 | `packages/editor/src/seq.ts:17`、`seq.ts:57-70` |
| E15 | `updateRecord`：`nextValues = {...旧values, ...我的patch}` 后**整对象 upsert**（c=version+1） | `apps/desktop/src/main/dbview.ts:544-563`（尤其 557-558）；op 构造 `dbview.ts:328-351` |
| E16 | commitOps：单事务 = `opLedger.insert × N` + 物化 × N（真相层与物化层不分叉） | `apps/desktop/src/main/commit.ts:446-496` |
| E17 | 加密：`EncryptingSyncFs` 装饰器，文件级 AES-256-GCM（信封 v2 含 key_id），**AAD=逻辑文件名**，字节层不透明（对内容形态零假设）；`seg-*.jsonl`/`snapshot-*.json` 透明改写 `.enc` | `apps/desktop/src/main/sync/crypto.ts:14-22` |
| E18 | key_mismatch 的 UI 面在 `SyncStatus.tsx` 红条 + `keyring.ts`，与 op 层冲突报告（`ReplayReport.conflicts`）是两套独立通道 | `apps/desktop/src/renderer/src/sync/SyncStatus.tsx`、`apps/desktop/src/main/sync/keyring.ts` |

core+sync 两包现有 `it/test` 用例 128 条（`grep -c` 统计），加 editor/desktop 全仓 770+。

---

## 1. 五个决策问题逐条作答

### 1.1 语义边界：现有 op 能否表达并发协作？

**总判**：不能充分表达。现有 replay 是「实体级 LWW」（E4），一次 op 胜出即**整个实体**的 lamport 被推进，任何字段粒度的并发编辑都会整体蒸发。逐类列表：

| op 类型 / 编辑形态 | 并发可交换性 | 说明 |
|---|---|---|
| 不同实体间的任意 op（A 改块1、B 改块2） | **天然可交换** | target 不同即互不干扰，replay 全序下结果与顺序无关（E4、E11 已验收） |
| 新建实体（不同 id 的 upsert） | **天然可交换** | 各自 lamport 独立前进，无覆盖关系 |
| 块文本编辑（同块字符级并发） | **无法表达** | content 是整字段 payload（E6/E12）；并发两端各发整块 patch，LWW 胜者通吃——原型对照组实测 **51.6% 编辑蒸发**（§2 表 1） |
| record 单元格写（同记录不同单元格并发） | **需要 merge policy** | `updateRecord` 基于旧 values 合并自己的 patch 后整对象 upsert（E15）；两端基线相同时并发 → 后到者整对象覆盖，**另一端单元格写丢失**——原型对照组实测 **46.6% 单元格写蒸发**（§2 表 2） |
| 块 `props` 并发写字段 | **需要 merge policy** | 同上，整字段覆盖；需字段级（key 粒度）LWW |
| page/collection 元数据（title、schema、views） | **需要 merge policy** | 同上；schema/views 是复合 JSON，字段级之后还需 key 级 |
| 标题改名（page.title patch） | **需要 merge policy** | 并发改名 LWW 决出胜者可接受（与 Notion 等一致），但需要冲突副本可视化（E4 的 conflicts 已支持） |
| 块/页移动与 reorder（`move`/`reorder`/`sort_key`） | **需要 merge policy** | 并发移动是经典难题：两端各自 `sortBetween` 出的键在 replay 后只保证确定，不保证「两端的意图都被尊重」（如 A 把 X 移到组1、B 移到组2，只能活一个）；`diff.ts:144-183` 的整层重平衡在并发下会互相推挤 |
| delete vs 并发改同块 | **需要 merge policy** | LWW 下两者同 `c` 不同 `d`，按设备字典序决胜：可能「编辑胜出→已删块复活」或「删除胜出→编辑静默蒸发」。确定但不合直觉；CRDT 语义下墓碑恒胜、语义清晰 |

**最小必要 merge policy 集合**（若走纯 op 自研路线）：

1. `lww-field`——patch 按 payload key 粒度 LWW（每字段独立记 lamport）；覆盖 props/title/单元格写。
2. `text-rga`——块 content 的字符级 CRDT（RGA/YATA 类，含 tombstone 与相对定位）；覆盖文本块编辑。
3. `order-deny`——并发 move/reorder 的确定性策略（LWW 决胜 + 冲突副本可视化，一期够用）。

其中 `text-rga` 等价于重造一个 Yjs（YATA 论文的实现 + ProseMirror 相对定位适配），**这是排除纯自研路线的核心论据**（见 1.2(a)）。

### 1.2 三条候选路径：改动面 / 风险 / 量级

#### (a) 纯 op 层自研 merge_policy（含文本字符级合并）

- **涉及文件/模块**：`core/op.ts`（merge_policy 枚举扩展 + `SCHEMA_VERSION` 1→2，E2）、`core/replay.ts`（按 policy 分派三种合并器）、`editor/diff.ts`（字符级差分→`text-rga` op 序列）、`editor/model.ts`、`sync/merger.ts`（op 归并前按 policy 预聚合）、`apps/desktop/src/main/commit.ts`（物化层消费合并结果）。
- **加密与 segment 耦合**：无新增——仍是 JSONL 段、仍走 E17 的文件级加密。
- **对 770+ 测试的影响**：core 的 replay/encode/decode 全链路测试需按 SCHEMA_VERSION=2 双轨；E4/E11 的收敛总测要为每种 policy 补并发用例；128 条 core+sync 用例中约过半直改。
- **离线队列与冲突可视化**：conflicts 通道复用（E4）；但 `text-rga` 的合并过程本身不可视化为「冲突副本」（它无冲突，只有意图并集）。
- **量级**：`text-rga` 自研（字符级 tombstone、相对位置、乱序应用、与 ProseMirror 光标映射）**20–30 人日且正确性风险极高**；三 policy 总计 30–40 人日。
- **判定：不建议**。理由：`text-rga` 是学术界已收敛、工业界已标准化的组件（Yjs/YATA、Automerge/RGA），自研无差异化价值，且正确性缺陷会在用户文本上直接表现为数据丢失。

#### (b) 混合：块内容用 Yjs（`Y.Text`/`Y.XmlFragment`）+ op-log 承载结构/元数据 【推荐】

- **边界与分工**：
  - **Yjs 侧**：每页一个 `Y.Doc`——块正文（`Y.XmlFragment`/`Y.Text`）、块存活标记与页面结构顺序（`Y.Map`/`Y.Array`）。并发文本编辑、删块 vs 改块由 CRDT 消解（原型已证 §2）。
  - **op-log 侧**：collection/record/schema 等实体元数据仍走现有五类 op（E1）；`record.values` 增补 `lww-field`（字段级 LWW，1 人日内可做，原型对照组已量化其必要性）。
- **op 与 Yjs update 的边界 / 落盘形态**：新增 op 类别 `crdt_update`（target=page，payload 为 base64 的 Yjs 增量 update + `sv_from` 状态向量水位）。`crdt_update` 不参与 replay 的 LWW（update 本身幂等、可乱序、可重复应用），merger 收到后直接 `Y.applyUpdate` 累积进本地 Y.Doc，并照常记入 op_ledger（审计真相层保留，E16 不破）。攒段/发布/去重/quarantine（E7/E8）全部原样复用。
- **涉及文件/模块**：`core/op.ts`（+1 op kind，SCHEMA_VERSION 1→2）、`packages/editor/src/react/Editor.tsx`（TipTap↔Y.XmlFragment 绑定：用 y-prosemirror 或替换 `pmDocToBlocks` 反投影为 yjs 订阅，E13）、`editor/seq.ts`（content 轮次改发 `crdt_update`，E14）、`sync/merger.ts`（识别 `crdt_update` 并分流）、`apps/desktop/src/main/sync/runtime.ts`（本地 Y.Doc 实例管理）。
- **加密与 segment 耦合**：**零改动**。update 是不透明二进制（base64 文本形态），E17 的文件级 AES-GCM 对内容零假设；体积可行性见 §2 表 3（200 轮全量 16.4 KB ≪ 256 KB 段限）。
- **对 770+ 测试的影响**：editor 现有 PM 投影测试（blocksToPMDoc/pmDocToBlocks）保留为双轨；sync 新增 `crdt_update` 段的合并/去重/快照用例（预计 +20~30 条）；core/sync 现有语义测试**不动**（新 op kind 不改旧 kind 语义）。
- **离线队列与冲突可视化**：网盘分钟级同步天然兼容——Yjs update 幂等且可乱序，E7 的 hash 去重/ifAbsent 幂等发布直接适用；op 层 LWW 冲突的红条与 conflicts 可视化（E18）原样复用；CRDT 侧无冲突可展示（这是卖点而非缺陷）。
- **量级**：**10–15 人日**（含 SCHEMA_VERSION=2 迁移与双轨期）。

#### (c) 整库 Yjs（弃 op-log）

- **涉及文件/模块**：core/sync/editor 三包重写——replay/segment/snapshot/manifest 被 Yjs 自带的 update 语义与 state vector 取代；`commit.ts` 的「真相层+物化层单事务」（E16）、FTS 显式同步三路径口径（`commit.ts:439-490`）都要另起炉灶。
- **丢失的东西**：op_ledger 审计真相层（谁在何时改了什么，逐条 op 可回放）、E4 冲突副本素材、zod 全链路校验（E1）、一期已验收的收敛总测语义（E11）。
- **加密与 segment 耦合**：需重建（Yjs 的持久化格式与现有 `seg-*.jsonl` 命名/水位体系不兼容）。
- **对 770+ 测试的影响**：core+sync 全部重写。
- **量级**：40+ 人日，且推翻一期全部验收成果。
- **判定：不建议**。

### 1.3 最小可行性验证（已真做）

见 §2：原型 `_scratch/spike-crdt/prototype.mjs`，双客户端 × 200 轮 × 2 场景，**一致率 100%**；LWW 对照组同场景丢失率 51.6%/46.6%；Yjs update 体积统计与「进 segment 加密」可行性见 §2 表 3。

### 1.4 耦合与冲突：Yjs update / CRDT 元数据如何进入 segment/加密/ledger？

1. **段格式**：`crdt_update` 作为普通 op 行进 JSONL 段——段不变量「ops 按 lamport 严格升序」（E5）**不需要改**：每条 `crdt_update` 照常领一个 lamport（本地时钟 tick），段内排序不受 payload 影响。唯一要改的是 `merge_policy` schema：`z.literal('lww')` → `z.union([z.literal('lww'), z.literal('crdt')])`（SCHEMA_VERSION 1→2，远端 v1 段照常兼容——manifest/段的版本协商已按「min 取保守」设计，E10）。
2. **加密**：零改动（E17 字节层不透明，AAD 绑定逻辑文件名的机制对 update 内容无感知）。
3. **ledger**：`crdt_update` 照常 `opLedger.insert`（E16），审计链不断。
4. **merger**：E7 的判定「交 core.replay」（`merger.ts:181-185`）需要一个分流口：`crdt_update` 不进 replay（它不是 LWW 语义），转交 Y.Doc 应用后照样计入 `applied`/`highWatermark`。
5. **快照与水位**：Yjs 侧对应物是 `Y.encodeStateAsUpdate`（周期性把整页 Y.Doc 重写为一个「ydoc 快照文件」，对应 E9 的 snapshot 折叠）与 `Y.encodeStateVector`（对应 manifest 水位，E10）。新设备播种（S5）时在播种包里附带各页全量 update 即可追平。
6. **与「多设备分钟级网盘同步」的冲突排查**：
   - *体积*：实测每轮双向增量 p95 2.6 KB、200 轮密集编辑后全量仅 16.4 KB（§2 表 3），远低于 256 KB/段触发线（E8），不会引发段风暴。
   - *合并窗口*：Yjs update 幂等、可乱序、可重复——「A 刚写完段 B 同时也在写」的网盘并发写场景由 `ifAbsent` 幂等发布 + 内容 hash 去重（E7）兜住，与现有语义一致。
   - *GC*：Yjs 默认 GC 裁剪 tombstone 内容，长历史文档体积有界；配合周期性 ydoc 快照重写可强收敛。

### 1.5 结论与拆解

**推荐路径：(b) 混合**。核心逻辑一句话：并发协作的难点 90% 在文本与结构（CRDT 已是标准答案），10% 在元数据（现有 LWW + 字段级小改已够）；op-log 骨架（段/加密/ledger/快照/审计）与 CRDT 正交，保留即白拿一期全部工程成果。

**后续任务拆解**（每个一句话范围）：

| 任务 | 范围 |
|---|---|
| T19-02 | core：op schema v2——`crdt_update` kind + `merge_policy='crdt'` 枚举 + `lww-field`（record.values 字段级 LWW），SCHEMA_VERSION=2 迁移与双轨验收 |
| T19-03 | editor：TipTap ↔ Y.XmlFragment 绑定（y-prosemirror 引入或自写订阅层），EditSession 的 content 轮次改发 `crdt_update`，本地 Y.Doc 生命周期管理 |
| T19-04 | sync：merger 对 `crdt_update` 分流（不进 replay、进 Y.Doc）、ydoc 快照折叠/播种扩展、收敛总测补 4 设备并发文本场景 |
| T19-05 | desktop：runtime 接线（每页 Y.Doc 缓存与释放、IPC 面），真机双实例并发冒烟 |

**风险清单**：

1. SCHEMA_VERSION=2 期间新旧客户端混跑：v1 客户端收到含 `crdt_update` 的段会整段 quarantine（`merger.ts:68-85` 的 SCHEMA_TOO_NEW 归类）——需在发布 0.2.0 前完成全员升级窗口，或让 v2 写入端按需降级（文本并发退化为整块 LWW patch）。
2. y-prosemirror 的光标/选区映射与现有 `marks.ts`/`rules/` 自定义节点类型需逐个验证（T19-03 的主要工作量所在）。
3. Yjs update 的 base64 膨胀（×4/3，实测 §2 表 3）在超大单页（万行级）下可能逼近段限——攒段策略（E8）的 `maxBytes` 会自然把超大 update 切段，无需新机制，但要在 T19-04 加对应测试。
4. **明确不建议做**：① 纯自研 `text-rga`（1.2(a)，正确性风险/无差异化价值）；② 整库 Yjs（1.2(c)，推翻一期）；③ 给 `move`/`reorder` 上 CRDT（收益低：并发移动本来就少见，LWW+冲突可视化一期够用，等真用户反馈再加）。

---

## 2. 原型与运行证据

### 2.1 原型位置与运行方式

- 路径：`_scratch/spike-crdt/prototype.mjs`（附 `README.md` 运行说明；目录内独立 `package.json`，仅装 `yjs@13.6.32`，仓库 package.json 未动）。
- 命令：`node prototype.mjs 200 20260917`；同参数重复运行输出逐字节一致（已跑 3 次两两 diff 验证）。
- 引擎说明：Yjs 引擎双端 `Y.Doc`；LWW 对照引擎复刻 E4 判据（`(c,d,op_id)` 全序 + 后写胜），不 import 仓库生产代码。

### 2.2 收敛结果表（最后一次运行输出，`node prototype.mjs 200 20260917`）

**表 1 场景①：同块内交错字符编辑（Y.Text 双端并发 insert/delete，200 轮）**

| 指标 | Yjs | LWW 对照（现状语义） |
|---|---|---|
| 双端最终一致轮数 | **200/200（100.0%）** | —（每轮必整块覆盖） |
| 不一致案例 | 0 | — |
| 丢失编辑 | — | **528/1024 次（51.6%）**，200/200 轮发生 |
| 同 c 冲突副本 | — | 200 |
| 终态文本长度 | 1259 字符（双方编辑全保留的并集） | 单侧幸存（败者编辑全蒸发） |
| 每轮双向 update 字节 | mean=727.5B p50=722B p95=1372B max=1459B | — |

**表 2 场景②：结构性并发（删块 vs 改同块/插新块）+ record 单元格并发写（200 轮）**

| 指标 | Yjs | LWW 对照（现状语义） |
|---|---|---|
| 双端最终一致轮数 | **200/200（100.0%）** | — |
| 不一致案例 | 0 | — |
| 结构性事件（删/插新块） | 112 | — |
| 删块 vs 改同块并发 | 24 次，24 次两端一致收敛（墓碑胜 alive=0，结局确定且符合直觉） | 同 c 字典序决胜（可能「已删块复活」或「编辑蒸发」，确定但反直觉） |
| 同单元格双写 | 100 次（per-cell 后写胜，双方终值一致） | — |
| 单元格写丢失 | 0 | **284/610 次（46.6%）**，200/200 轮发生 |
| 终态记录 | `{"cell-x":"A200.1","cell-y":"B200.0","cell-w":"A198.0","cell-z":"A200.0"}`（A/B 写入交错共存） | 单侧幸存 |
| 每轮双向 update 字节 | mean=1405.4B p50=1420B p95=2626B max=2797B | — |

### 2.3 Yjs update 二进制体积统计与「进 segment 加密」可行性

**表 3 体积统计**

| 指标 | 值 |
|---|---|
| 场景② 200 轮后全量 update（二进制，GC 已开） | 16,414 B |
| 全量 update base64（op payload 可携带形态） | 21,888 B |
| 裹进一条 op（JSON 转义 + 字段开销估 ×1.15） | ~25,171 B |
| 对照 `writer.DEFAULT_WRITE_POLICY.maxBytes` | 262,144 B（256 KB/段，E8） |
| 每轮增量 p95（场景①/②） | 1,372 B / 2,626 B |

**可行性说明**：① 体积——200 轮高频并发编辑的全量 update 仅为段限的 **9.6%**，常规增量更是千字节级，「分钟级网盘同步」的传输与段切分（E8 四触发器）完全无压力；② 加密——`EncryptingSyncFs` 是文件级 AES-256-GCM 装饰器（E17），对明文内容零结构假设，update 以 base64 文本进 op payload（随 JSONL 段走）或独立 `.ydoc.jsonl` 段（同样过 `encodeSegment`→加密）均透明通过，**加密层零改动**；③ 完整性——AAD 绑定逻辑文件名的机制不变，段被挪用仍会被拒绝解密。

---

## 3. 验证与收尾自检

- 原型重复运行输出一致：同参数 3 次运行两两 `diff` 全等（DETERMINISTIC-OK）。
- `git status --porcelain`：仅 `?? docs/tasks/TASK-T19-01-SPIKE.md`（PM 交付的任务书）与本报告；`_scratch/` 在 `.gitignore:21`，原型不进 git。
- 红线核对：`packages/**`、`apps/**`、`docs/mockups/**`、根 `package.json`/`pnpm-workspace.yaml` 零改动；未跑任何 git 写操作；未新增仓库依赖（yjs 仅装在 `_scratch/spike-crdt/` 本地）。

## 4. 偏差说明（DEVIATIONS）

- 无生产代码改动，无需 PM 追认项。
- 原型场景②的「结构性并发」以块存活标记（`Y.Map alive`）模拟墓碑语义，与 1.4 所述生产形态（`crdt_update` + 页级 Y.Doc）在收敛性质上等价，但真实 TipTap 绑定（y-prosemirror）留给 T19-03 验证。
