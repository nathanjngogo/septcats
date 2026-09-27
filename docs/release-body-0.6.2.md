# Septcats 0.6.2

补丁版：两处**「静默错误」治本**（一处 macOS 隐私面、一处连点交互面）+ 新增 R29 并发压测真机探针。无 schema 变更（DB v10，与 0.6.0/0.6.1 同），可直接覆盖升级。

## 修复 Fixed

- **macOS 上删除/读取凭据的真失败不再被静默吞掉**（H-11）
  此前 `security` 分支只判退出码 `0`：钥匙串锁定、拒绝授权等**真失败**被当成「条目不存在」——删除失败会以成功通过、读取失败会当成「未配置」，而密钥其实仍留在钥匙串里。现按退出码 `44` / stderr `could not be found` 精确区分：不存在 = 幂等语义（删除返回 `false`、读取返回 `null`）；真失败 = 明确上抛 `E_CRED_DELETE_FAILED` / `E_CRED_READ_FAILED`（与 Windows 分支同一契约），设置页会如实显示失败并保留条目。
- **快速连点删除不再误报「页面不存在或已删除」**（H-12）
  第一次删除成功后，后续连点/并发请求会命中「已删除」态并抛 `E_NOT_FOUND`，界面对一次**已成功**的删除弹出错误提示。现改为幂等语义：已进回收站再删 → `deleted: 0`（静默成功）；真正不存在的 id（越界 / 已被 GC 物理清除）仍显式报错。

## 测试 Tests

- 新增 **R29 并发压测真机探针**（28 断言，打包产物/dev 靶可切）：并发创建 30 页、同页 20 并发提交（无丢写）、同块 10 并发覆盖（LWW 无撕裂）、60 路 FTS+写交错（无 `database is locked`）、索引重建与读并发、连点删除幂等、并发删+恢复无幽灵页、同页并发移动（无孤儿/无双父）、并发重命名、并发类型转换、**同目录并发便携包导出（原子写，产物逐包校验通过）**、并发页面导出预览、`pageerror=0`、离线只读 `PRAGMA integrity_check=ok`、真实数据根零触碰。
- 平台凭据层新增 8 条注入式用例覆盖 macOS 退出码语义（44 / 文本兜底 / 拒绝授权 / 口令错误 / argv 审计），Windows 本机即可跑。

---

# Septcats 0.6.2 (English)

Patch release: two **silent-failure** root-cause fixes (one macOS privacy-surface, one rapid-click interaction) plus a new R29 concurrency stress probe on real hardware. No schema change (DB v10, same as 0.6.0/0.6.1) — safe to upgrade in place.

## Fixed

- **macOS credential delete/read failures are no longer swallowed** (H-11): the `security` branch only checked exit code `0`, so real failures (keychain locked, authorization denied) looked like "item not found" — a failed delete reported success and a failed read looked like "not configured", while the secret stayed in the keychain. Exit code `44` / stderr `could not be found` now means "not found" (idempotent: delete → `false`, read → `null`); any other non-zero exit raises `E_CRED_DELETE_FAILED` / `E_CRED_READ_FAILED` (same contract as the Windows branch), so Settings shows the real failure and keeps the entry.
- **Rapid double-click delete no longer reports a bogus "page not found"** (H-12): after the first delete succeeded, follow-up rapid/concurrent requests hit the already-deleted state and threw `E_NOT_FOUND`, showing an error for a delete that had actually succeeded. Now idempotent: deleting an already-trashed page returns `deleted: 0`; a genuinely unknown id (out of range / physically purged by GC) still errors explicitly.

## Tests

- New **R29 concurrency stress probe** (28 assertions; switchable between packaged artifact and dev target): 30 concurrent page creates, 20 concurrent commits on one page (no lost writes), 10 concurrent overwrites of one block (LWW, no torn content), 60 interleaved FTS reads + writes (no `database is locked`), index rebuild with concurrent reads, idempotent rapid delete, concurrent delete+restore with no ghost pages, concurrent move (no orphans / double parents), concurrent rename, concurrent type conversion, **concurrent portable export into one directory (atomic write; every artifact verified)**, concurrent page-export preview, `pageerror = 0`, offline read-only `PRAGMA integrity_check = ok`, and zero touches to the real data root.
- 8 new injected cases cover the macOS exit-code semantics of the credential layer (44 / stderr fallback / authorization denied / wrong passphrase / argv audit), runnable on Windows.