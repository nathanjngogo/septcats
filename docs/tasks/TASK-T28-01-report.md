# TASK-T28-01 交付报告 · 🔴 P0：修复「编辑内容触发同步错误」（op 设备 id 硬编码）

> 工程师：CodeBuddy ｜ 前置：`62d50cb`（T27-01）｜ 任务书：`docs/tasks/TASK-T28-01.md` ｜ QA 依据：`docs/QA-巡检报告.md` Q-1
> 红线遵守：只动 `apps/desktop/src/**`、`apps/desktop/test/**`；未碰 `packages/**`、CI/发布脚本、docs 既有内容；未加依赖；未碰 git。

## §0 摘要

按 §1 裁决落地「设备身份唯一真源在 main」：`blocks:commit` 写入前对每个 op 执行
`rebindOpActor`——把 `actor` 与 `lamport.d` 权威改写为本机真实 actor，其余字段原样保留；
渲染层删除 `PAGE_ACTOR = 'desktop0001'` 硬编码，EditSession/DropContext 契约占位改用
编辑器包既有 `EDITOR_ACTOR` 常量并注明「会被 main 覆盖」。

**关键勘误（实现必读）**：段校验比对的是 `op.lamport.d` 而非 `op.actor`
（`packages/core/src/segment.ts:123` 不变量 3「所有 op 的 lamport.d == header.dev」，
Q-1 报错原文里的「第 3 个 op 的设备」即 `lamport.d`）。故改写必须同时覆盖
`actor`（账本写入者字段）与 `lamport.d`（段校验比对字段），只改其一仍会红。
`op_id` 是 ULID、不内嵌 actor → 改写不动 `op_id`，去重/幂等行为天然不变。

## §1 逐处 actor 处理清单（§1.3 全仓 grep 核查）

`grep -rn "desktop0001|PAGE_ACTOR|actor:" apps/desktop/src` 逐处归位：

| # | 位置 | 处理 | 说明 |
|---|------|------|------|
| 1 | `main/blocks.ts`（新增 `rebindOpActor` + `BlocksServiceOptions.actor` + `commit` 内 map 改写） | **主修** | 写入（commitOps）前权威改写 `actor`/`lamport.d` 为本机真实 actor；只动这两个字段；已是真实 actor 的 op 原引用返回（幂等）。`blocks:commit` 是渲染层 op 进账本的唯一通道 |
| 2 | `main/index.ts` `createBlocksService({...})` | **主修接线** | 注入 `actor`（与 pages/dbview/importer/templates/collab/sync runtime 同一真源：`deriveActorId(meta.device_id)`） |
| 3 | `renderer/pages/PageView.tsx:45` `const PAGE_ACTOR = 'desktop0001'` | **删除** | 不再有 `desktop0001` 设备字面量 |
| 4 | `renderer/pages/PageView.tsx` EditSession 构造（原 ：159） | 归位 | `actor: PAGE_ACTOR_PLACEHOLDER`；常量 = `EDITOR_ACTOR`（借 `@septcats/editor/react` 既有导出，其注释即「apps 层接 IPC 时换成真实设备 ID」），PageView 内注明「一律会被 main 覆盖」 |
| 5 | `renderer/pages/PageView.tsx` `planBlockDrop` ctx（原 ：490） | 归位 | 同上占位；`plan.ops` 不外发（提交仍走 EditSession 差分），仅契约要求 |
| 6 | `main/index.ts:144` `FALLBACK_ACTOR = 'desktop0001'` | **保留** | PM 裁决：main 兜底合理 |
| 7 | `main/pages.ts` / `dbview.ts` / `importer.ts` / `templates.ts` / `collab.ts` / `sync/runtime.ts` 的 `actor` | 核查无需改 | 全部由 index.ts DI 注入同一真源，自造 op 的 actor 即真实 actor（渲染层 grep `lamport|op_id|kind: '...'` 零命中——渲染层除 #4/#5 外不构造 op） |
| 8 | `db/selftest.ts:46` `DEV = 'aaaa0001'` | 核查无需改 | main 侧自检夹具，内部自洽（actor/lamport.d 一致），不进用户写路径 |
| 9 | `test/blocks.test.ts` 4 处 `createBlocksService` | 补 `actor: ACTOR` | 新增必填选项的构造参数；断言语义零变更 |

渲染层修后不含任何设备 id 字面量（`desktop0001` 在 `apps/desktop/src` 仅存于 main 兜底）。

## §2 验证（任务书 §2 四项）

### ① 回归测试：修前红 → 修后绿（`test/actor-rebind.test.ts`）

- **修前红**（复现 Q-1 症状，与修前产品路径同构：错误 actor 的 op 原样进账本与攒段器）：
  `runCycle` 后 `state='error'`、errors 含 `E_SYNC_CYCLE_FAILED` 且 message 含
  `非法段…设备 desktop0001 与段头 dev=aaaa0001 不符`、`pendingOps` 稳定不降（=3）、复跑仍 error。
- **修后绿**（同一批 op 经 `createBlocksService({actor})`）：账本全部 op 的
  `actor`/`lamport.d` = 真实 actor；段发布成功且 `decodeSegment` 校验段头 `dev`=真实 actor；
  `runCycle` 后 `state='ok'`、`errors=[]`、`pendingOps=0`；op_id 重复提交不重复入账（去重不回归）。

**修法回退对照实验**（把 `rebindOpActor` 临时旁路为恒等 → 修后绿用例立刻转红，证明确为产品路径修复；实验后已完整还原并复跑全绿）：

```
FAIL  test/actor-rebind.test.ts > 同步轮回归（修前红 → 修后绿） > 修后绿：同一批错误 actor 的 op 经 blocks service → 段 dev=本机真实 actor，同步轮 ok、pendingOps 归 0
AssertionError: expected 'desktop0001' to be 'aaaa0001' // Object.is equality
 ❯ test/actor-rebind.test.ts:312:24
Test Files  1 failed (1)
     Tests  2 failed | 3 passed (5)
```

### ② 主修路径单测（同文件 describe「blocks:commit 写入前 actor 权威改写」）

- 改写生效：`op_json` 的 `actor`/`lamport.d` = 本机真实 actor；`op_id`/`lamport.c`/`at`/
  `target`/`kind`/`payload` **逐字段不变**；入参 op 不被原地改写。
- 幂等：已是真实 actor 的 op 重复提交，两次 `op_json` **字节等价**（op_id 去重前提不变）。

### ③ 真机自跑（`pnpm build` 产物 out/，version 0.3.0-rc.3，全新夹具）

夹具隔离：`--user-data-dir=<临时目录>\udata`（空）+ 预置 `septcats.settings.json`
`{"schema":1,"rootPath":"<临时目录>\data"}` → DB/sync/logs/凭据全落空数据根。
操作（CDP 驱动，等价真人操作）：侧栏「新建页面」→ 编辑器输入
「真机验证 T28-01：输入触发同步。」→ `sync.now()` 强制同步轮。

```
EDITOR_TEXT="真机验证 T28-01：输入触发同步。"
SYNC_STATUS={
  "state": "ok",
  "enabled": true,
  "lastSyncAt": 1789777135066,
  "devices": [
    { "actorId": "01m2vgf6p63e80mmtf6a6tvn26", "lastLamport": 3,
      "lastSeenAt": 1789777135062, "clientVer": "0.3.0-rc.3" }
  ],
  "pendingOps": 0,
  "pendingSegs": 0,
  "conflicts": 0,
  "errors": []
}
PILL_LABEL="已同步 · 刚刚"
```

**报错前后对照**：

| | 修前（Q-1，0.3.0-rc.3 真机） | 修后（本轮真机） |
|---|---|---|
| 状态栏 | 「同步错误」且不恢复 | 「已同步 · 刚刚」 |
| `sync.status()` | `state:'error'`、`errors` 含 E_SYNC_CYCLE_FAILED | `state:'ok'`、`errors:[]` |
| `pendingOps` | 稳定不降（实测 3） | `0` |
| 段内容 | op 设备 `desktop0001` ≠ 段头 dev | op `actor`/`lamport.d` = 段头 dev = `01m2vgf6p63e80mmtf6a6tvn26` |

段文件原文（夹具 `data/sync/seg-00000001-01m2vgf6p63e80mmtf6a6tvn26-000002.jsonl`）：

```
{"h":{"c_from":1,"c_to":2,"created_at":1789777132083,"dev":"01m2vgf6p63e80mmtf6a6tvn26","n":2,"schema_ver":3,"seg_id":"seg-00000001-01m2vgf6p63e80mmtf6a6tvn26-000002"}}
{"actor":"01m2vgf6p63e80mmtf6a6tvn26","at":1789777130228,"kind":"upsert","lamport":{"c":1,"d":"01m2vgf6p63e80mmtf6a6tvn26"},...
```

材料化核验（`blocks.list` 回读，正文一致）：

```
BLOCKS=[{"id":"01M2VGFEGSW0GH1FGAV6YC2Q6T",...,"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"真机验证 T28-01：输入触发同步。"}]}]},...,"version":1,"last_edited":1789777132369}]
```

账本核验（op_ledger 4 条 op 全部 `actor`/`lamport.d` = `01m2vgf6p63e80mmtf6a6tvn26`）。

**流程披露**：首跑误用真实数据根（`%APPDATA%` 环境变量对 Electron 的 appData 无效，
实测落在 `~/.septcats`）——在真实库新建了 1 页「未命名」（含上述验证文本）并同步成功、
无错误；随后改用上述双隔离夹具复跑。真实库中该页未做进一步改动，请 PM 知悉。

### ④ 全仓门禁四项

- `pnpm -r test`：全绿（apps/desktop **40 files / 427 tests**，含本轮新增 5 用例；422→427）。
- `pnpm -r typecheck`：全绿（apps/desktop 双 tsconfig Done）。
- `node packages/ui/tokens/no-magic.mjs`：`✓ 组件 CSS 无字面 hex、无非 1px 重复裸 px`。
- `node packages/ui/tokens/build-tokens.mjs --check`：`✓ token 产物与 DESIGN.md 一致`。

附注：`pnpm -r test` 的 perf 用例会自动向 `docs/perf-history.jsonl` 追加 4 行
（git_rev=62d50cb，全部 pass：cold_first_query 33ms / commit_batch_p95 12.2ms /
rebuild_10k 1540.5ms / cold_open_migrate_first_query 40.0ms）。因红线不碰 docs/**，
已还原该文件，数值在此留档。

## §3 DEVIATION

1. `test/blocks.test.ts`：4 处 `createBlocksService(...)` 补必填 `actor: ACTOR` 构造参数
   （§1.1 新选项所致）。既有断言语义零变更。
2. `main/blocks.ts` 文件头纪律注释「main 不改写 Op」改为「main 唯一改写的是设备身份」
   （与新实现一致的注释修正，无行为变化）；`PageView.tsx` 文件头注释同步补一句口径。
3. §1.2「显式常量」落法：占位值复用编辑器包既有导出 `EDITOR_ACTOR`（`'editor0001'`），
   未在渲染层新造设备 id 字面量。若 PM 要求渲染层连占位 import 也不留，需改
   packages/editor 的 EditSession/DropContext 契约（actor 可选化）——超出本轮红线，待裁决。
4. 回归测试的「修前红」用不改写路径复现（错误 actor op 直进攒段器），与修前产品行为
   逐语句同构（同一 hook、同一 builder、同一 runCycle），但未经旧代码二进制复跑；
   另以「主修旁路 → 绿转红」对照实验补强（§2.① 原文）。

## §4 新发现（超出本轮范围，建议 PM 立账）

真机复跑中发现**段文件名 (dev, c_from, n) 可能碰撞 → 段被静默吞掉**：
EditSession 按块 version+1 定 lamport.c，可产生「lamport.c 早于已发布水位」的迟到 op
（本轮夹具：先发布段 {c1 页, c2 crdt}（seg-…-000002），后提交 {c1 block, c3 crdt}——
c_from=1、n=2 与既有段同名）；`publishSegment` 的 ifAbsent 分支回 `'existed'` 按成功处理，
builder 清空、`pendingOps=0`、无错误，但该批 op 实际未落盘。
证据：夹具账本 4 op（maxLamport=3）而 sync/ 仅 1 个 n=2 段、`segment_watermark=3`。
本地账本无损，影响远端追平完整性。修法涉及 `packages/sync` 命名/发布语义（红线禁区），
本轮不动，待 PM 裁决后另立任务。

## §5 PM 复跑（PM 补）

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 1009 无红（desktop 422→427 = +5 actor-rebind）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
重打包（0.3.0-rc.4）+ 真机（docs/mockups/diag-sync-detail.mjs）→ **P0 闭环**
```

| 环节 | 修前（rc.3） | 修后（rc.4） |
|---|---|---|
| 输入后 `sync.status().state` | `error` | **`ok`** |
| `errors` | `E_SYNC_CYCLE_FAILED`（非法段原文） | **`[]`** |
| `pendingOps` | 3 且不降 | **0** |
| 状态栏 | 同步错误 | **已同步 · 刚刚** |
| 段头 d / op actor | `desktop0001` ≠ 段头 | 全部 = 真机 actor `01m2vh9h…` |

**PM 勘误追认**：CB 纠正了 PM 的初判——段校验不变量比对的是 **`op.lamport.d`**（`packages/core/segment.ts` 不变量 3）而非仅 `op.actor`，故改写须同时覆盖两字段；PM 原任务书只写 actor，属**PM 侧不准确**，已由工程师纠正并双字段修复 ✓ 追认。

**PM 构建流程坑（记录，非产品问题）**：PM 先跑 `ensure-abi.mjs node`（为 vitest）后直接 `dist` → 打包进 **node ABI** 的 better-sqlite3 → Electron 中 DbServer 子进程 `code=1` 退出、应用「同步状态加载中…」永远不 ok。切回 `ensure-abi.mjs electron` 重新打包后一切正常。**纪律：dist 之前必须 electron ABI**（已写入技能）。

**DEVIATIONS 追认**：①同时改写 `actor` 与 `lamport.d` ✓ 必要且最小；②main 侧 `rebindOpActor` 幂等（已是真值则原引用返回）✓；③渲染层改用既有 `EDITOR_ACTOR` 占位并注明「会被 main 覆盖」✓（不再有设备语义）；④`db/selftest.ts` 自检夹具自洽、未动 ✓。

**T28-01 报告 §4 的新发现 → 已由 PM 立单 T29-01（P0-2）**：段名 `(dev,c_from,n)` 可碰撞 → `publishSegment` ifAbsent 把「同名不同内容」当成功 → **静默丢 op**（夹具账本 4 op / 盘上 2 op、watermark=3）。
