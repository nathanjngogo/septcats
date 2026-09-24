# TASK-T80-01 · 便携包导出（zip 写侧 + IPC 契约 + 设置页入口）

> 前置：`docs/PRD-R28-便携包.md`（§0 侦察 + §1 规格）。基线=main。工作目录=主树。
> 只 Write/Edit 落盘；禁碰 git、不跑全仓回归。报告写 `docs/tasks/TASK-T80-01-report.md`。收尾打印 `CB-T80-01-EXIT=0`。

## 开工侦察（报告 §0 必答四问）

1. `REBUILD_CLEAR_SQL` 与段重放（rebuild）实际入口函数与调用链——导入侧将来复用它，本单导出段清单要与它**吃的形态逐字节对齐**（manifest 字段、段文件名规约、快照段是否也入包）。
2. `sync/writer.ts` 段产出时机：未 flush 的本地写在哪个目录——导出前 checkpoint 后还需不需要「强制封段」（把 op_ledger 尾账封进段）？给出实证与选择。
3. `attachment/` 与 `attachments/` 目录谁是真相（R27 导出用的哪个）；清单排除规则在代码里的既有先例（`*.bak-*` 谁产生的）。
4. fflate `zipSync` 对 >2GB 单条目/总条目的实际限制（读 fflate 版本文档/源码注释即可，不写 benchmark）；STORED vs DEFLATE 对附件（PNG/已压缩）的取舍实证。

## 交付面

- **写侧工具**：`packages/sync/src/portableZip.ts`（或 fflate 适配放 desktop main，你侦察后定；纯逻辑可 node 直测）——输入条目流（名/字节/大小）→ zip 字节；条目名一律过 zip slip 同口径防护；逐条 sha256 写进包内 `manifest-portable.json`（checksums 表 + 排除清单 + 库名/版本/schema 号）。
- **IPC `portable:export`**：契约形状照 `shared/pageExport.ts`（preview 只回清单不落盘 / confirm + dir 显式落盘 / 取消=零落盘）；第一步 `PRAGMA wal_checkpoint(TRUNCATE)`；写盘原子（`.tmp` → rename，同名加序号）；预览含总字节数。
- **UI**：设置页「数据」区新增「导出便携包」行（预览→确认对话框，复用 R27 对话框骨架与 token 纪律；禁「数据库」词，i18n 双份）。
- **测试**：zip 写→`unzipSync` 读 roundtrip（含中文/空格条目名、STORED 选择断言）；zip slip 条目名拒绝；checksums 逐条对；preview 不落盘/取消零落盘；checkpoint 前置断言（mock executor 记录语句序）。
- **门禁**：typecheck 0 error + desktop/editor/importer/ui 全绿只增不减（基线 1140/270/99/168）+ no-magic ✓；报告贴原始输出。

## 红线

不 import electron（core/sync 包内纯逻辑）；op-log 零新增语义（导出只读不改账）；启动零外联；§16 token/R14 ink-edge；禁省略号占位；不动 serialize.ts/pageExport 已收口逻辑；加密库硬闸：`getStatus().enabled` → 结构化错误码 `E_PORTABLE_ENCRYPTED_UNSUPPORTED`（v1 不做密文出门）。