# TASK-T83-02 报告 · 附件孤儿回收对账（PM 接手重做版）

> 执行人：**PM**（老板 09-26 终令：取消 CB/DSH 派发，PM 全盘自写自验）。
> 前情：CB 被 kill 的派发留下孤儿进程半成品（见 发布记录-0.6.0.md 事故记录）。
> 处置：**仅留用**其 `planAssetGc` 纯逻辑 + `shared/assetGc` 类型契约（经 sync 10 用例
> 独立验证后采信）；main 执行面 / 白名单语句 / IPC / 设置页 UI / desktop 测试 /
> 真机探针**全部重写**。其 38 行报告从未跑过测试，不作数（已弃）。

## 1. 侦察四问（file:line 实证）

1. **引用面**：附件以 `attachment://<hash>` / `asset://<hash><ext>` 出现在
   - 块 `content_json`/`props_json`（assets.ts:17-18 双 scheme；图片 src 等）
   - 页 `cover`/`icon`（schema page 表）
   - `collection.schema_json` / `record.values_json`（表格字段值，带扩展名变体）
   - `op_ledger.op_json`（**历史段重放会重建已物化删除的块** → 账本引用必须算在用；
     真机 P4 实测：锁页删明文块后 ledger 引用仍保住文件=设计正确性现场自证）
   提取算法=正则 `(?:asset|attachment):\/\/([0-9a-f]{64})(?![0-9a-f])` 全局扫（排除更长
   hex 前缀误配；大写不收=写入面恒小写）。
2. **可见性口径**：`block` 表**不分 alive 全扫**（回收站/彻底删中间态页都算在用）；
   只有引用它的行整体不存在（页被 dbgc 物理清除且账本无历史）才算孤儿——与任务书建议
   口径一致（宁多勿漏）。
3. **共享与大小写**：盘上文件名 `<hash>` 或 `<hash>.<ext>`；判引用按**哈希归一**
   （`hashOfName`，与 assets.ts findHashFile 同口径）——变体名不误删（真机 P3-3 实证）。
4. **两段式先例**：复用 T81-01「预览→确认」与设置页位点（同 fieldset 并列一行）；
   `sync.gc` 开关不涵盖本项（那是库面周期 GC 后台静默；附件删除**刻意不做静默**，
   启动后台不跑，仅显式按钮）。

## 2. 交付面

| 文件 | 内容 |
|---|---|
| `packages/sync/src/gc.ts` | `planAssetGc` 纯逻辑（留用 CB 版，sync 10 用例钉死后采信）|
| `apps/desktop/src/shared/assetGc.ts` | 契约类型（留用同上）|
| `apps/desktop/src/db/statements.ts` | `assetgc.*` 六条只读白名单（89→95，预算 <100）|
| `apps/desktop/src/main/assetGc.ts` | 服务：引用枚举六路 SELECT + 失明计数 + 两拍 rename→remove + 清单落日志 |
| `src/shared/ipc.ts` / `preload` / `window.d.ts` / `main/index.ts` | `assetgc:preview/run` 通道全链 |
| `SettingsPage.tsx` + zh/en i18n | 「清理未引用附件」行：预览面板（放行数/blind 警示/30 天保护期说明/取消/确认禁用态）|
| `apps/desktop/test/assetGc.test.ts` | 执行路径 3 用例（preview 零写/真删+字节完好/幂等/blind 全扣/remove 失败不吞）+ 提取口径 1 组 |
| `docs/mockups/cdp-e2e-t83-02.mjs` | 真机探针 21 断言 |

安全设计（比任务书要求多钉的）：
- **失明即全扣**：`block_cipher` 有行 → `referencesComplete=false` → 未命中引用一律
  扣留（含 unknown/recent 判定前的 blind 分支）；UI 出警示、确认钮禁用。
- **30 天 mtime 保护期** + 非内容寻址名不回收（unknown 扣留）。
- **两拍删除**：rename 失败=原位零损失；remove 失败=改回原名计 failed。
- 取消/不点 run=零删除；run 前清单前 50 项写日志。

## 3. 验证（全绿）

- 门禁：**desktop 1244/1244**（+3 新用例；含 statements 白名单回归）· sync **133**（+10）
  · editor 275 · importer 99 · ui 168 · **tsc 双工程 PASS** · pnpm build OK。
- 顺手修一个**真缺陷**：statements 测试的 `includes('ATTACH')` 危险词扫描误伤
  `attachment://` 字面量 → 改词边界正则（任何合法附件语句都会触雷，早修早好）。
- **真机探针 21/21 PASS**（`--user-data-dir`+rootPath 双钉 scratch 库；真实根 mtime 不变）：
  预览放行 2 孤儿 · 取消零删 · 确认真删且被引用 3 文件逐字节完好（含 .png 变体）·
  锁页失明→全扣+钮禁用+IPC 直调 run 也零删 · 解锁→引用面复原→放行→删 ·
  op_ledger 历史引用保住文件（P4 现场实证）。
- 结果存档 `docs/mockups/screens-t83-02/t83-02-results.json`。

## 4. 偏差与遗留

- D1：引用面新增 **op_ledger 一路**（任务书未列）——不做会误删「块被 GC 但段可重放」
  的附件，死链风险；已按「宁多勿漏」纳入。
- D2：`sync.gc` 后台**不含**附件对账（与库面 GC 的差别是刻意的，见侦察 4）。
- 遗留：无。0.6.1 攒版项就位。
