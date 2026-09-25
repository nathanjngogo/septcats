# Septcats 0.6.0

## 中文
**这一版让数据能安全地出门了 —— 也能干净地收尾。**

**新功能**
- **页面导出 Markdown**：侧栏页行菜单「导出为 Markdown…」→ 先看预览（不落盘）→ 选目录 → 确认；可导单页或整棵子树（按层级落目录）；图片附件随包进 `files/`，页面内链自动改写为相对路径。
- **便携包导出**：设置页「导出便携包」把整库打包成一个 zip —— 主库 + 全部同步段 + 附件 + 可核对清单（逐条 sha256）；重名自动加序号，绝不覆盖；加密库会明确拒绝（跨机不可解密文）；超过 4GB 明确拒绝而非产出坏包。
- **便携包导入**：设置页「导入便携包」，或命令行 `--import-portable <包|目录>`。预检（结构 / 校验和 / 段清单覆盖度，全程零落盘）→ 确认换库（自动先备份现库，失败逐字节还原）；当前库存在包未覆盖的内容时**整体拒绝而不是合并**；导错了可以「撤销导入」，连同步段一起还原。
- **已删除内容清理**：设置页新增「同步」区块。**先预览再执行**：预览告诉你这次能清多少、保留多少以及为什么保留（回收站页按 30 天保留期、有锁或密文的异常页面保守扣留）；取消＝一个字都不写。彻底删除的页面立即清理，释放空间的同时**绝不触碰存活的页面与操作日志**。

**修复的严重缺陷**
- **同步完整性校验可能误判、清空本地历史**（P0）：首轮校验会拿一份过期快照算总数，刚开同步或正在编辑时出现假偏差，随后触发「按同步段重建」——只存在于本机的历史会被整体抹掉。现在改为按操作 id 覆盖度守卫，且重建缺省为**合并**而非替换。
- **导入过的文件夹删页后永远无法重导**：判重改为「活着的页面才算已导入」（回收站页与彻底删除页不再挡住重导），反复「导入 → 删除 → 再导入」不再产生多余副本。
- **「撤销导入」原来会失败并留下半成品**：进程存活时撤销会撞 Windows 文件锁。现在还原前先释放数据库句柄、失败整体回滚，绝不留下「库还原了、同步段没还原」的中间态。
- **导入预检漏看还没落盘的编辑**：现在覆盖度按「账本 ∪ 内存段缓冲 ∪ 本地盘上段」取并集，并在导入前强制封段 —— 刚写下还没落盘的内容同样会被判「包未覆盖」而拒绝，杜绝静默抹掉你的编辑。
- **表格 / 折叠列表的内容在导出与卡片摘要里读成空**：结构化内容（表格行、折叠正文）在部分入口被读成空段落，导致导出丢单元格文字；现统一到同一套读取实现。
- **删除 AI 密钥失败时界面仍显示「已移除」**：失败时保留条目并明确报错。

**升级安全**：零格式变化、无数据库迁移，0.5.0（及更老）数据直接升级；操作日志（op-log v3）零新增类型。新的「清理已删除内容」默认**关闭**，升级后启动不会动你的库，只有你点按钮才执行。

---

## English
**This release lets your data leave the app safely — and lets deletions finish cleanly.**

**New**
- **Export a page as Markdown**: from a page's row menu, "Export as Markdown…" → preview (nothing written) → pick a folder → confirm. Export a single page or a whole subtree (nested folders); image attachments travel in `files/` and internal links are rewritten to relative paths.
- **Portable bundle export**: "Export portable bundle" in Settings packs the whole library into one zip — main database + all sync segments + attachments + a verifiable manifest (per-file sha256). Existing names get a suffix instead of being overwritten; encrypted libraries are refused (ciphertext can't be decrypted elsewhere); anything over 4GB is refused outright rather than producing a broken bundle.
- **Portable bundle import**: "Import portable bundle" in Settings, or `--import-portable <file|dir>` on the command line. Preflight (structure / checksums / segment coverage, nothing written) → confirm the swap (your current library is backed up first, restored byte-for-byte on failure). If the current library holds content the bundle doesn't cover, the import is **refused as a whole rather than merged**; a bad import can be undone, sync segments included.
- **Clean up deleted content**: a new "Sync" section in Settings. **Preview first, then run**: the preview tells you how many pages will go, how many are kept, and why (recycle-bin pages are held for 30 days; pages with locks or ciphertext are held conservatively). Cancel writes nothing. Fully deleted pages are cleared immediately — reusing space while never touching live pages or the operation log.

**Serious bugs fixed**
- **Sync integrity checks could misfire and wipe local history** (P0): the first check computed an expected count from a stale snapshot, so opening sync (or editing while it ran) produced a false mismatch — and the "rebuild from sync segments" path that followed erased history that only existed on this machine. Now guarded by operation-id coverage, and rebuilds default to **merge**, not replace.
- **Pages from an imported folder could never be re-imported** once deleted: deduplication now counts only *live* pages (recycle-bin and fully deleted pages no longer block a re-import), and repeated import → delete → re-import no longer creates duplicate copies.
- **"Undo import" used to fail and leave half a state**: with the app running, the restore hit a Windows file lock. It now releases the database handles first and rolls back as a whole, so you never end up with "database restored, sync segments not".
- **Import preflight ignored edits that hadn't been flushed yet**: coverage is now the union of the ledger, the in-memory segment buffer and the on-disk segments, and a flush is forced before importing — content you just typed is counted, so the import is refused instead of silently discarding it.
- **Tables and toggle lists read as empty** in exports and card summaries: structured content (table rows, toggle bodies) degraded to empty paragraphs in some paths; all readers now share one implementation.
- **Failed AI key deletion still showed "removed"**: failures now keep the entry and report the error.

**Safe upgrade**: no format change, no database migration — 0.5.0 (and older) data upgrades directly, and the operation log (op-log v3) gains no new types. The new cleanup entry is **off by default**: upgrading never touches your library until you press the button.