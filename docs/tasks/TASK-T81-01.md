# TASK-T81-01 · 墓碑物理清除（db 面 GC，兑现 purgePage 注释承诺）

> 前置：`docs/MILESTONES.md` 欠账登记（09-24）+ `docs/PRD-R28-便携包.md` §4。基线=main。工作目录=主树。
> 只 Write/Edit 落盘；禁碰 git。报告写 `docs/tasks/TASK-T81-01-report.md`（**开工两步内先建骨架**）。收尾打印 `DSH-T81-01-EXIT=0`。
> **沙箱已放开（09-25 晚）**：本次派发 overlay=`buddy-v41-nosbx.yml`，带管道 stdio 的子进程可用，
> **必须原生跑测试**：`export PATH="/c/Users/Administrator/AppData/Local/hermes/node:$PATH"`（node 须 v22）
> + `export TMPDIR=/TEMP/TMP="C:\Users\Administrator\AppData\Local\Temp"`（长路径；短路径 8.3 形态会触发
> libuv `fs-event.c` 断言崩）→ `pnpm -C apps/desktop test`、`pnpm -C packages/<改过的包> test`。
> **禁止再造进程内垫片/vitest 替身配置**（历史做法，本单起废止）；测试跑不起来=如实报 DEVIATION，交 PM 复跑。

## 背景（PM 已实锤，不必重复侦察）

`main/pages.ts` 注释承诺「彻底删除 = 从回收站即时移除（`deleted_at=0`），**物理清除归 GC 任务**」，但全仓无实现：`purgePage` 之后 page 墓碑行与其 block 行永久残留（页不可达、FTS 已清、UI 不可见，只是占字节）。老板真实库现有 34 个此类墓碑 = 天然验收夹具。
段文件清理**已有**（`packages/sync/src/gc.ts` `planCleanup` + `sync/runtime.ts:1196` 真删），本单**只做 db 面**，不碰段清理。

## 开工侦察（报告 §0 必答四问）

1. **引用面清单**：一张墓碑页还可能被谁指向？逐处 grep 实证——`page.parent_id`（子页挂父）、`favorite`、`page_lock`、`block_cipher`、`import_source`、`record`/`collection`（行内数据库关联页）、`recent` 表、op_ledger 历史行、双链 `links` 派生索引。**判据必须逐表给结论**：哪些随墓碑级联删、哪些保留（历史账不改写）。
2. **安全窗口**：墓碑能否被「撤销/恢复」路径再次复活？grep `restorePage` / undo 通道对 `deleted_at=0` 行的处理；未同步设备会不会还需要这段历史（op_ledger 是否已含 delete op——若含，则删物化行不删账，重放仍能复现）。
3. **批量与事务**：单事务 DELETE 上限（避免长事务阻塞编辑）；现有分批/重平衡先例（`rebalanceLayer`/`sortSequence` 同 batch 原子那条纪律）。
4. **既有 dry-run 先例**：`sync` 设置里 gc 的 dry-run→真删两段语义在哪个函数，本单复用同一开关与文案位。

## 交付面

- **纯逻辑**：`packages/core/src`（或 `sync`，侦察后定）`planDbGc(tombstones, now, opts) → {deletable[], held[]}`——按「墓碑满 retentionDays 且无任何可复活引用」放行；产出清单不真删（与 `planCleanup` 同纪律：**删除永远先算清单**）。
- **执行**：main 侧 `runDbGc()`——逐条 `DELETE FROM page/block/…`（同事务、分批上限），**只删清单内 id**；op_ledger 不动（账本是真相）；返回 `{deletedPages, deletedBlocks, bytesFreed?}`。
- **触发**：设置 →「同步」区 gc 开关下新增「清理已删除内容」dry-run 预览（条数/预计释放）+ 确认执行；应用启动时按开关有界后台跑（禁启动阻塞，沿用 FTS defer 那套不打断首屏的纪律）。
- **测试**：planDbGc 纯函数全覆盖（未满期/有子页/有收藏/有锁/历史 op 在场各一例）；执行路径断言 op_ledger 逐字节不变、被删页不可恢复（restorePage 返回明确错误码）、FTS 无残留；**夹具即老板真实库形态**（34 墓碑 + 14 存活）的脱敏复刻，断言清理后存活页逐 id 完好。
- **门禁**：typecheck 0 + 四包基线只增不减 + no-magic ✓，贴原始输出。

## 红线

**绝不写真实库**（`C:/Users/Administrator/.septcats`）——测试全走夹具/临时目录；op_ledger 零改写；不建表不加依赖；启动零外联；UI token/禁词纪律；不动 T79/T80 已收口逻辑。