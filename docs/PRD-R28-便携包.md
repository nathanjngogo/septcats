# PRD-R28 · 数据出门二期（便携包导出/导入 · U5 兑现）

> 立项：PM（Hermes）09-24 · 基线 main `de2d967`（R27 已收口）· 授权：待老板拍板
> 范围：T80 便携包导出 + T80b 便携包导入；顺带收口 T81 墓碑 GC（侦察实证升级出账，见 §4）。
> 前置事实：R27 已交付「页面级 Markdown 导出」=可读出门；本 PRD 补「整机迁移」=数据完整出门，兑现 PROJECT_PLAN §8.5/U5。

## 0. 侦察结论（现状=代码事实，09-24）

1. **§8.5 承诺原文**：设置页「导出便携包」→ `<同步文件夹>/export/<ts>.zip`（含 manifest、全部段、附件清单），新机「导入便携包」→ 重放重建 SQLite。**承诺含 op-log 段**（可恢复全历史，非快照）。
2. **数据根真实布局**（只读核 `~/.septcats/`）：`septcats.db(-wal/-shm)` + `attachments/`（内容寻址）+ `sync/`（manifest + 设备段 + 快照）+ `logs/` `tmp/` `crashDumps/` `*.db.bak-*`（迁移备份，**不入包**）。
3. **zip 读已有、写为零**：导入器用 `fflate.unzipSync`（zip slip 防护已有 `entryNameSafe` 先例）；全仓**无 zip 写实现**。→ T80 写侧候选=fflate `zipSync`（已随 importer 依赖在场，零新增依赖）或纯存储式（STORED）zip 自实现（附件已内嵌压缩，二次压缩收益低——STORED 反而更快更稳，PM 倾向）。
4. **段重放重建能力已在**：`db/server.ts` `REBUILD_CLEAR_SQL`（分段才是真相：清空 page/block/collection/record/FTS/op_ledger 后按段重放）——导入便携包 ≈ 对干净库跑一次「全段重放」，sync 引擎语义直接复用，不造第二套重建逻辑。
5. **安全面现状**：DEK 走 DPAPI（credentialStore，机器绑定）——**加密库的便携包导出必须显性不做或另设计**（跨机不可解密文；v1 硬闸：检测到加密启用 → 拒导并给文案，错误码 `E_PORTABLE_ENCRYPTED_UNSUPPORTED`）。
6. **墓碑行无物理清除路径**（本次侦察实锤，升级入 §4 T81）。

## 1. T80 · 便携包导出（设置页入口）

- 产物：`<数据根>/export/septcats-portable-<ts>.zip`（文件名含库名 slug）；条目=**manifest + 全部段 + attachments/**；排除 `logs/` `tmp/` `crashDumps/` `*.bak-*`（清单写进 README 条目，用户可读）。
- 交互沿用 R27 纪律：预览（包内清单+字节数）→ 确认 → 落盘；取消=零落盘；全只读；进度可见（附件多时不假死）。
- IPC：`portable:export`（preview/confirm 两段，契约照 `shared/pageExport.ts` 形状，dir 显式传入）。
- 前置：导出第一步 `PRAGMA wal_checkpoint(TRUNCATE)`（同款先例 `db/migrations.ts:391`——备份/迁移前强制 checkpoint），否则段与库状态可能不一致（wal 里的未落账写丢包/或包内 db 落后）；zip 打包对象=checkpoint 后的主库 + sync 段 + attachments。
- 完整性：包内写 manifest.checksums（逐条 sha256），导入侧先验再重放；zip 名/路径过 `entryNameSafe` 同口径防护。
- 红线：写盘原子（临时名→rename）；启动零外联；禁静默覆盖同名包（加序号）；大库（>2GB 附件）v1 显性不做分卷。

## 2. T80b · 便携包导入（首启向导 + 设置页双入口）

- 首启（空库）**且**命令行 `--import-portable <zip>`（迁移工作流，文档化；GUI 选包按钮二期再议——T79 教训：原生对话框不可 CDP 驱动，探针取证面优先）。
  - T80-02 落地口径：`--import-portable <zip|dir>`——`.zip` 结尾按包路径解析；其余按**目录契约**
    在该目录内取最新 `septcats-portable-*.zip`（名字含时间戳，字典序即时间序）。导入在**开窗之前**
    跑完（首屏即导入后的库）；失败只留日志，不阻断启动。
- 流程：验签（checksums）→ 冲突预检（目标库非空 → 结构化错误码拒导，**不 merge**）→ 停服务 → 换库三段式（备份现库 `septcats.db.bak-portable-<ts>` → 建新库重放 → 失败回滚）。
- 幂等/防呆：重复导入同包=同结果；半截 zip=整体拒绝不建库；导入成功 toast + 可撤销入口（回滚到 bak 文件，复用既有备份语义）。
- 加密闸同 §1.5。

## 3. 验收（DoD）

- 单测：fflate 写→读 roundtrip；entryNameSafe 拒绝绝对/上跳；checksums 逐条验；REBUILD_CLEAR 路径重放后 counts==导出前 counts（夹具库断言，禁心算）。
- 真机 CDP（PM 探针，双钉夹具）：建 3 页+表格+代码+附件 → 导出（预览→确认）→ zip 逐条目清点 → 清空夹具 → `--import-portable` 导入 → IPC 读回页/块/附件逐字节等 → 半截包拒导错误码断言。
- 门禁：四件套只增不减（基线 desktop 1140 / editor 270 / importer 99 / ui 168 / tsc 9/9 / no-magic ✓）。

## 4. T81（随 R28 一并拍板）· 墓碑 GC 收口

`purgePage` 注释承诺「物理清除归 GC 任务」而无实现（`main/pages.ts`；MILESTONES 已登记）。侦察补正：段文件 GC 已有（`sync/gc.ts` + runtime `planCleanup`，真删/清账归后续）；**缺的是 db 面墓碑物理清除**。最小实现：purge 记账（tombstone 满 N 天且无未同步引用）后走 op-log 语义物理 DELETE（page+block+FTS 同事务）；设置页「同步」区开关复用 `sync.gc` 干跑→真删两段。老板真实库 34 墓碑 = 首个验收夹具。

## 5. 排期建议

T80（约 CB 一轮）→ T80b（约一轮）→ T81（小单）→ 攒版 **0.6.0** 发布（R27+R28 一起出，功能号）。发布节奏待老板一句话。