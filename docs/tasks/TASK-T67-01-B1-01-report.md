# TASK-T67-01-B1-01 · 页面密码锁 · 后端核心 · 报告（CodeBuddy 单）

> 工作目录：`E:\Hermes Agent工作空间\Septcats\.worktrees\t67-lock`（分支 `feat/t67-page-lock`）。
> 执行者：CodeBuddy。施工依据：**TASK-T67-01-B1-01.md（v2）**；总任务书 TASK-T67-01.md 与
> TASK-T67-01-B1-scope.md 仅作口径参考，凡与 v2 冲突处以 **v2 为准**（差异见 §选择理由/DEVIATION）。
> 纪律：未 merge / 未 push / 未动主树 / 未启动 Electron；ABI 保持 node；退出前已杀进程。

## 0. 摘要

- 交付：v10 迁移 + 加密核心 `lock.ts` + IPC 通道组 + 单测。
- `packages/core` 的 `SCHEMA_VERSION = 3`（wire 轴）**未触碰**；内部迁移轴仅追加 #10，`LATEST_SCHEMA_VERSION` 由 `MIGRATIONS` 数组自动导出 = 10。
- 单测：`pnpm -C apps/desktop exec vitest run test/t67-lock.test.ts` 全绿（node ABI）。
- 类型：`pnpm -C apps/desktop exec tsc --noEmit` **0 错误**。
- 全量回归：`pnpm -C apps/desktop exec vitest run` 共 881 项，仅 **1 个预存套件失败** `test/updater.test.ts`（解析期 `SyntaxError`，源自 `scripts/feed-sign` 导入；本单未改动该链路，属基线既有失败，非本任务引入，已单列于 §7 供 PM 跟进）。其余 880 项全绿，含本单 4 个相关文件（t67-lock/migrations/wiki-page/pages）+ 随动 statements 预算钉。

## 1. 改动文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `apps/desktop/src/db/schema.v10.ts` | 新增 | v10 建表语句（page_lock + block_cipher） |
| `apps/desktop/src/db/migrations.ts` | 改动 | 尾部追加 `{id:10,name:'v10-page-lock',up:applySchemaV10}`；导入 applySchemaV10 |
| `apps/desktop/src/db/statements.ts` | 改动 | 新增 7 条 lock 白名单语句 |
| `apps/desktop/src/main/lock.ts` | 新增 | 加密核心服务（scrypt + AES-256-GCM 信封 + 限速 + 会话缓存） |
| `apps/desktop/src/main/lockIpc.ts` | 新增 | IPC 注册（DI，不 import electron，仿 search 风格） |
| `apps/desktop/src/shared/ipc.ts` | 改动 | 新增 `LOCK_CHANNELS` 通道常量 |
| `apps/desktop/src/main/index.ts` | 改动 | `DatabaseServices` 加 `lock`；两行 `registerLockIpc(...)` |
| `apps/desktop/src/main/pages.ts` | 改动 | `deletePage` 级联清锁（最小改动） |
| `apps/desktop/src/preload/index.ts` | 改动 | 暴露 `lock.*` 桥（既有范式） |
| `apps/desktop/src/types/window.d.ts` | 改动 | `SeptcatsApi.lock` 类型 |
| `apps/desktop/test/t67-lock.test.ts` | 新增 | 后端安全语义单测 |
| `apps/desktop/test/migrations.test.ts` | 随动 | 版本钉 `v9-page-link-index`→`v10-page-lock`（DEVIATION D2） |
| `apps/desktop/test/wiki-page.test.ts` | 随动 | `.toBe(9)`→`LATEST_SCHEMA_VERSION`（DEVIATION D2） |

## 2. 原始数值（实现参数钉值）

- KDF：`scrypt(pass, kdf_salt, { N: 32768 (2^15), r: 8, p: 1, keylen: 32 })`；MK/RK 同参同 `kdf_salt`。
- DK：随机 32B。信封：`SCENC1.` + base64( IV(12B) | authTag(16B) | ciphertext )，AES-256-GCM。
- 限速：错 5 次 → `locked_until = now + 60000ms`（持久于 `page_lock.failures/locked_until`，重启不重置）。
- 恢复码：随机 20B → base32（RFC4648 去填充）→ 5 组 ×4 字符 `XXXX-XXXX-...` 形态。
- verifier 探针常量：`SEPTCATS-LOCK-VERIFIER-v1`（UTF-8 字节，加密存 `verifier`；绝不明文存口令）。
- `wrapped_key = seal(MK, DK)`；`recovery_verifier = seal(RK, DK)`（DK 各包一份）。

## 3. 选择理由（v2 与 master/scope 冲突处）

- 文件名 `lock.ts`（v2）而非 `pageLock.ts`（master/scope）；IPC 通道名 `lock:getStatus/setPass/verify/recover/changePass/remove`（v2）而非 master 的 `lock:status/.../set-hint`（scope）。
- page_lock 列集以 v2 为唯一真相（`kdf_salt/verifier/recovery_verifier/wrapped_key/failures/locked_until/updated_at`），block_cipher 单列整页密文（粒度=页）。master §1.1 的 `hint/recovery_hash/created_at` 列集未采用。
- KDF 取 v2 显式 `N=2^15`（见 DEVIATION D1）。

## 4. DEVIATION（逐条编号）

- **D1（前提与代码事实不符）**：v2 §1 称 KDF「对齐仓内 sync/crypto 既有参数口径」，但 `apps/desktop/src/main/sync/crypto.ts` 实际**无 scrypt**（它用外部传入的 DEK，仅做 AES-256-GCM 信封）。故「对齐 sync/crypto」无可对齐项；改按 v2 显式钉值 `N=2^15` 实现，并导出常量供「跨版本可解」钉点测试。另注：master TASK-T67-01 §1.1 写 `N=2^17`，与 v2 冲突，以 v2 为准。
- **D2（写死钉随动）**：`apps/desktop/test/migrations.test.ts:65` 写死 `MIGRATIONS[last].name === 'v9-page-link-index'`、`apps/desktop/test/wiki-page.test.ts:155,340` 写死 `.toBe(9)`。追加 #10 后 `LATEST_SCHEMA_VERSION=10` 且末条名 `v10-page-lock`，上述写死项会红。已随动改为参数化（`LATEST_SCHEMA_VERSION` / `v10-page-lock`），此处记 DEVIATION（符合 v2 §1「发现写死项随动并记 DEVIATION」）。
- **D3（限制声明）**：`unlock`/`remove` 还原明文块走 `block.upsert`（与 commit 物化同语句），未走完整 op-replay 重写账本。锁页明文块在本地被硬删，同步侧若重放 op 理论可重建明文——此为已知限制，B2 接线应使写路径经 `commitOps` 以保账本合法；本单已在测试断言「字节级还原」但「账本合法」留 B2 收口。
- **D4（前提与代码事实不符·留 B2）**：v2 §4 要求导出遇锁页输出 `{locked:true}` 占位。grep `apps/desktop/src/main/**` 无 exporter 实现（导出链路不在 main 进程），无最小挂点。按 v2「找不到就记 DEVIATION 留给 B2 单」处理，本单不做导出钩子。
- **D5（限制声明·FTS）**：锁页正文 plaintext 块在 `setPass` 时被硬删（`block.deleteByPage`），FTS 触发器 `trg_block_fts_ad` 随之清 `page_block_fts`，故搜索天然不命中；本单补一枚「锁页不出现在搜索结果」回归测试。标题/树结构明文保留（master §1.2 已声明限制）。
- **D6（白名单预算随动）**：`apps/desktop/test/statements.test.ts` 对 `STATEMENTS` 白名单总数设有预算钉（`SQL_IDS.length`）：原 `toBe(72)` 且「仍 < 75」。本单为 lock 通道新增 **7 条**语句（`lock.get/upsert/delete`、`lock_cipher.get/upsert/delete`、`block.deleteByPage`），总数变为 **79**，原 `< 75` 预算被突破。按 v2 §1「白名单新增需随动并更新预算钉并记 DEVIATION」：将 v2/v5 两处预算钉更新为 `toBe(79)` 与 `toBeLessThan(85)`，描述同步计入 T67-01 七条。属必要功能增量，非膨胀泄漏。

## 5. 测试文件与用例数

- `apps/desktop/test/t67-lock.test.ts`（**14 例全绿**）：
  - 迁移：v9 夹具升级到 v10 / page_lock+block_cipher 表与列到位 / 幂等。
  - KDF 参数钉值（跨版本可解）。
  - 设锁 → 明文块消失 + block_cipher 密文在表；磁盘 grep 明文=0（DB 内存断言）。
  - 错口令 5 次 → `locked_until` 生效（时间注入 `mockNow`）。
  - 正确口令 → 块逐字节还原（content_json 相等）。
  - 恢复码一次成功换口令、二次被拒（E_LOCK_RECOVERY_USED）。
  - `remove` → 密文全灭 + 明文回归。
  - FTS 搜不到锁页内容。
  - `SCHEMA_VERSION` 钉点回归（`LATEST_SCHEMA_VERSION === 10`）。
  - IPC 级探针（`registerLockIpc` + 假 registrar）。
- 随动 / 回归（均随本单绿）：`migrations.test.ts`（31）、`wiki-page.test.ts`（8）、`pages.test.ts`（13）、`statements.test.ts`（24，含 D6 预算钉更新）。

## 6. PM 复跑（PM 补）

> （PM 补）此节留空，供 PM 用单测/IPC 级探针复跑验收；本单未启动 Electron、未跑 ensure-abi electron。

## 7. 基线既有失败（非本任务引入，供 PM 跟进）

- `apps/desktop/test/updater.test.ts` 整套解析失败：`SyntaxError: Invalid or unexpected token`，位置 `import { generateFeedKeyPair, signFeedBytes } from '../scripts/feed-sign'`（test 文件第 29 行）。本单 **未改动** `test/updater.test.ts` 与 `scripts/feed-sign.*`（见 §1 改动清单与 `git status`），属仓库基线既有问题（疑似该脚本文件语法/转译问题）。全量 `vitest run` 因此套件 0 测试可执行而计 1 失败；与本页面锁后端核心无关，建议另开单排查 `scripts/feed-sign` 语法。
