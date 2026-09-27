# R29 · 全盘 Bug 排查（Bug Hunt）计划

> 老板 09-24 令：「目前版本有很多 bug，等 CB 完成之后，全盘检查一下代码，找出关键 Bug。」
> 性质：PM 主导只读侦察（静态扫描 + 真机扩检），**发现的关键缺陷逐条定性后插队派 CB 修**（缺陷 > 增强 > 打磨）。
> 时机：T80-01 收口后立即开跑；静态扫描部分不依赖 CB 收工，已在先行。

## 排查面（六路）

1. **挂账收割**：各 `TASK-*-report.md` §5 遗留与观察项 + MILESTONES 缺陷账 #1-32 + 欠账清单 → 归类「仍是真缺陷」vs「已随后续单修掉」。已知候选：①`firstTextOfBlock`/`extractPlainText` 抽不到 table/toggle 文字（T79-02 §5）；②代码块**无退出键绑定**（T79 探针实踩，泛编辑器习惯 Enter×2 不出块）；③`pages.purge` 后墓碑残留（T81 在治）。
2. **错误吞噬扫描**：grep 全仓 `catch` 后静默（空 catch/仅注释）且发生在**用户可触发路径**的点；`void` 丢弃 promise；`.catch(() => {})`。重点面：commit 失败、sync runtime、导出/导入 IO、锁页解锁链。
3. **竞态与时序**：异步 IPC 重入（快速连点导出/删除/移动）；编辑中切页/关窗 flush-ack 链；FTS defer 与并发批；WAL 多连接（DbServer utilityProcess 与 main 直连并存点）。
4. **边界输入**：空标题/超长标题/纯空白页名；表格 0 行/0 列/超大（100×100）；代码块 lang 特殊字符；图片 >20MB/伪装扩展名；zip slip 面（已有防护，验边界）；中文路径/空格路径/UNC 路径（历史坑：NSIS 静默不装同族）。
5. **真机扩检探针**（新增 `cdp-e2e-hunt-01.mjs`，双钉）：每路 2/3/4 的高危假设写成可失败断言——连点防抖、编辑态切页数据完整、异常输入回退、解锁后编辑链、回收站往返 restore 语义。
6. **发布件对照**：0.5.0 安装包（=用户手里的版本）与当前 main 的行为差异清单——老板报的「很多 bug」可能打在 0.5.0 而非 main，先问不出细节就用真包跑同一探针定位「已修/未修」归属。

## 产出纪律

- 每条发现：**症状 → 根因 → 复现步骤 → 影响面分级（P0 数据丢失/损坏，P1 功能不可用，P2 体验）**，写进本文件「发现台账」。
- P0/P1 立即立 T 单派 CB（串行排队）；P2 攒 R30 打磨轮。
- 探针取证一律夹具双钉；真实库只读走三件套拷贝（纪律同 09-24 事故记录）。

## 发现台账（滚动）

| # | 症状 | 根因 | 级别 | 处置 |
| -- | -- | -- | -- | -- |
| **H-04** | **老板真实库 442 页（含 424 个导入页）整批消失** | `sync/runtime.ts:1113 verifyLedgerIntegrity`：首轮拿**过期快照**算 `expectedTotal`（`ledger.length+applied+crdt`，而 `ledger` 在 line 749 早于本轮 commit 读取，用户同期编辑即产生 off-by-one 假偏差）→ 计数不符即 `collectSegments()`（**只收同步目录里的段**）→ `db.rebuildFromSegments()`（`REBUILD_CLEAR_SQL` **清空 op_ledger + 全部物化表 + FTS**，仅重放段）。同步刚开启时目录里段远少于本机账本 → 本地独有历史被整体抹除。**无任何覆盖度守卫** | **P0 数据丢失** | ✅ **代码修复已收口（1f73317，T82-01）**：op_id 覆盖度守卫 + 去竞态 + mode replace\|merge（缺省 merge）；红测复现 442→1 同构场景验绿。**数据救援已执行（路线 A）**：merged.db 替换真实根，sha256 `e6d9eff8dccc3749` 一致、457 活页/6029 块/8338 账，备份 `rescue-backup-20260925-173706`（119MB） |
| **H-05** | 导入过的文件夹**永远无法重导**：删页后重导入全部「已导入过」跳过 | `import_source` 是永久 `(path,hash)→page_id` 账（`importer.ts:521-533` 纯 Map 查表，**不校验目标页是否还存在**）+ 删除侧（purge/GC）从不清理该表。真实库 424/424 行指向不存在的页 | P1 功能 | ✅ **已收口（T82-02 / e80d19d）**：判重改「活页才算已导入」（回收站/彻底删除页不再挡重导），并**连带**把 `insert` 从 `OR IGNORE` 改成 `ON CONFLICT DO UPDATE page_id`（只改前者会造成无限副本——DSH 自行发现的连带缺陷）；死行物理清账**已随 T81-01 清偿**（`import_source` 随页级联删，D-6）。真机 16/0 |
| **H-01** | 删除 AI 供应商时密钥可能未真删（CredentialStore 留孤儿密钥） | `settings/AiSection.tsx:463` `await ...ai.clearKey(...).catch(() => {})` 吞掉失败：UI 已移除该项，密文仍在盘上。隐私优先设定下不可接受 | P2 隐私 | ✅ **已收口（T82-02 / e80d19d）**：失败保留条目 + danger 提示 + 卡片错误态（不写「已移除」）；成功路径行为不变 |
| **H-02** | `recent` 表残留指向已不存在页的行（1 行）+ 39 行指向回收站页 | 设备本地派生态无清理钩子；隔离段那页（`01M2VG9QD6Q0N8KK2CVQT2ZQNE`）的 upsert op 被封在 quarantine 从未物化，但 `recent.touch` 已落账 | P2 卫生 | ✅ **已收口（T81-01）**：死引用行随墓碑**级联清除**（`dbgc.deleteRecents`，先算清单后删）；指回收站页的行按 30 天保留期扣留，页面被清时一并走。真机 16/0 + 单测覆盖 |
| **H-03** | 39 处跨行空 catch（全有降级注释）、7 个「声明了 main 无引用」通道 → **均为假阳/设计行为** | 逐一核过上下文：隐私模式降级、配额、后续补真实错误；通道走表驱动命名空间 | — | 不立案（记录以证排查面已覆盖） |
| **H-08** | 便携包 plan/execute 覆盖度预检对「未 flush op」盲区——同一操作序列两次实测 uncovered=0 vs 2（run-A/B 时序不一致），窗口内放行=重放抹掉缓冲里的用户编辑（H-04 同类形态） | 探针 P4-6a；SyncRuntime 攒段缓冲落 ledger 前，coverage() 只读 op_ledger 看不见 | P1 数据 | ✅ **已收口（T80-04 / d256591）**：execute 前强制封段 + 覆盖度取「账本∪攒段缓冲∪本地盘上段」并集 + 新测试钉两种时序 |
| **H-09** | 「撤销导入」真机必失败且留半成品：进程存活时 io.remove(主库) 撞 Windows EBUSY；失败瞬间 -wal/-shm 已删 → 库非任何一致态（run-E P5-3 实证重启后包外页仍在） | 探针 P5-1；restorePairs 先清三件套再回写、无原子性；D-1 文件级还原未先关连接 | P1（产品承诺失效+破坏半径） | ✅ **已收口（T80-04 / d256591）**：close/reopen 句柄通道 + 调用前快照 + 失败整体回滚（还原前先停连接）；单测持连接再还原 |
| **H-06** | `page_link_index`/`mention` 不在 `REBUILD_CLEAR_SQL`：重建（两种模式）后双链索引可能与投影不一致 | 派生索引缺口（replace 时代就有）；`page_link_index` 有启动全量重建兜底、`mention` 无回填（schema.v2 注释口径） | P2 一致性 | 后续单收（重建事务尾部补 links 全量重建）；已记 T82-01 报告 §5.1 |
| **H-07** | 工作台「最近页」卡片与模板市场种子**摘不到表格/折叠块的正文文字**（显示空摘要） | T79-02 挂账核实现仍成立：`workbench/cards.tsx:firstTextOfBlock` 与 `workbench/market.ts:extractPlainText` 只认 PM doc（`text`/`content` 嵌套），table 的 `{rows,header}`、toggle 的 `{title,body}` 结构化 content 抽不出 | P2 体验 | ✅ **已收口（T82-02 / e80d19d）**：`blockContentTextLines` 单一实现（@septcats/editor），卡片/市场/正文抽取/wikilink 全部改消费它，逐字等价回归钉死旧口径 |
| **H-11** | macOS 上删除凭据失败可能被静默当成功 | `platform/credentials.ts:317-322` 只判 `code === 0`（`security delete-generic-password` 返回 false 时不分「不存在」与「真失败」）→ 非 Windows 路径下「钥匙串删除失败」会以 `{ok:true}` 通过 | P2 隐私（mac 面） | ✅ **已收口（R35）**：`delete` 按退出码 44 / stderr `could not be found` 区分「不存在」（幂等→`false`）与**真失败**（上抛 `E_CRED_DELETE_FAILED`）；**同源口子一并治**——`get()` 尾部原 `return null` 会把「读不到」当「没设过」（真失败现上抛 `E_CRED_READ_FAILED`）；新增 8 条注入式用例（`platform:'darwin'`+假 spawn，Windows 本机可跑）→ platform **49 passed / 1 skipped** |
| **H-12** | **快速连点删除 → 误报 `E_NOT_FOUND`**（并发重入） | `main/pages.ts` 的 `deletePage` 用 `requirePage(..., alive=true)` 守卫：首删成功后其余并发请求命中「已删除」态 → 抛 `E_NOT_FOUND`（**真机实测：同页 5 并发删除 3 条 reject**，UI 会对一次**已成功**的删除弹「页面不存在或已删除」）；而函数内部本已写好 `ops.length === 0 → { deleted: 0 }` 幂等分支，被守卫提前挡掉 | P3 健壮性（UX 误报，无数据损伤） | ✅ **已收口（R36）**：改宽容版 `requirePage(..., false)`（与 `restorePage` 同口径）——已进回收站 → `{ deleted: 0 }`；真不存在 id（越界 / 已被 T81-01 GC 物理清除）仍显式 `E_NOT_FOUND`；单测锁定 + 真机压测 **28 PASS / 0 FAIL** |
| **H-13** | **反向链接面板遇非数组载荷直崩 React 边界**（CI 抓到的未捕获 TypeError） | `BacklinksPanel.tsx` 直接 `setEntries(res.entries)`：契约虽是 `{ entries: [...] }`，但任何缺字段/旧形状载荷（如测试假桥写成 `{ items: [] }`）都会把 `undefined` 塞进 state，渲染时读 `entries.length` 抛 `TypeError: Cannot read properties of undefined (reading 'length')` → 整页进 React 错误边界（CI 报「Errors 1 error」，`t78-bulk-selection` 触发） | P3 健壮性（IPC 边界缺校验 + 测试假桥字段名错） | ✅ **已收口（R36 续）**：组件侧归一化 `Array.isArray(res?.entries) ? res.entries : []`（退化空态，绝不崩）；假桥改正为 `{ entries: [] }`；新增回归用例（缺字段载荷 → 空态不崩）锁定 |


## 路4 日志审查结论（09-25）
真实根 `~/.septcats/logs/{main,sync,db}.log` 聚合扫描：**09-20 之后零 ERROR/WARN**；历史 ERROR 仅两类——DbServer code=1（=ABI 态不对，非产品缺陷，探针前置纪律已覆盖）与 `Unsupported provider: undefined`（09-14/15 早期 dev feed 注入期，当前版本绝迹）。日志面不立案。

### H-04 证据链（三段互证，可复现）

1. **迁移备份链**（`~/.septcats/*.bak-*`，只读拷贝后统计）：

   | 备份 | 生成时机 | page | 其中活 | op_ledger | import_source |
   | :-- | :-- | --: | --: | --: | --: |
   | `bak-v5` | 应用 v6 迁移**之前** | **442** | **442** | **7384** | 442（映射存活 424） |
   | `bak-v6` | v7 迁移之前 | **1** | 1 | **2** | 442（映射存活 **0**） |
   | `bak-v9` | v10 迁移之前 | 15 | 10 | 246 | 442（存活 0） |
   | 当前 | v10 | 57 | 18 | 963 | 442（存活 0） |

2. **运行日志**（`~/.septcats/logs/sync.log`，09-18 23:46:50 连续三行）：
   `op_ledger 存在非法 op：…` ×2 → **`E_PROJECTION_REBUILT op_ledger 计数偏移（7387 ≠ 7386），以合并后段重建`**。
   7387≈7384+2：与备份链的 7384→2 完全吻合。

3. **代码面**：`runtime.ts:1113-1131`（触发+毁灭动作，零守卫）、`db/server.ts:118-123 & 570-610`（`REBUILD_CLEAR_SQL` 清 op_ledger/page/block/… 后只重放传入段）、`opLedger.count`=全表 COUNT（无过滤）。测试桩 `test/sync-runtime.test.ts:100-110` 亦用 `ops.clear()` **编码了「以段替换本机账本」语义** → 单测全绿而真机数据被抹。

### 救援可行性（**需老板授权，真实档案只读红线**）

- `septcats.db.bak-v5` **完整在场**（10,735,616 B，442 页全活 + 7384 ops，schema v5）→ 数据未灭失，可救。
- 建议路径（**全程在拷贝上作业，不碰真实库**）：拷贝 `bak-v5` 为独立数据根 → 关同步启动（探针隔离双钉口径）→ 迁移链 v5→v10 → 以 R27 页面导出 / T80 便携包导出 → 导入当前库（或整体替换，两种口径出对比清单后再选）。
- 恢复动作属**破坏性/外部变更**，待老板签字；签字前 PM 只在拷贝上演练并出可复现证据。

## 老板 09-25「点便携包导入没反应」定性（结案：非缺陷）

- 真机探针 `cdp-e2e-t80-05.mjs`（完整 UI 链含原生对话框）11/0：dev 构建点按钮
  1.2s 弹「选择便携包」、plan/execute/错误闸全通。
- 老板机实况：已安装 0.5.0（09-24 17:09 asar）与 dist/win-unpacked 均 **0 命中**
  「便携包」字样——该功能是 09-25 才合入，未进任何发布包。
- 结论：不是 bug，是版本差。0.6.0 打包后即消失。留一手：最小化托盘时
  showOpenDialog(parent=主窗) 可能随隐藏主窗不前台，0.6.0 打包后补一条探针场景。

## H-10（P1·✅ T80-06 收口 d256591 后修复）撤销导入漏还原段目录，包外页复活

- **09-25 18:40 收口**：DSH 标准模式交付（段目录 `<bak>-sync` 快照/还原并进 restorePairs 同数组、旧备份兼容闸、停机后取清单、快照不计覆盖度）；PM 原生门禁 desktop **1212(+18)**/sync 109/tsc 9/9；真机 `cdp-e2e-t80-02` **21/21 全绿**（P5-3 转绿）；T80-01 23/0、T79 16/0、T76 13/0。

- 取证：T80-04 收口后 `cdp-e2e-t80-02.mjs` 20/1，唯一红 P5-3。`_scratch/t80-02-e2e-mugqy7wu/data/`：
  revert 后 op_ledger 含包外页 2 op、段 `seg-...-e9248980.jsonl` 仍在盘，重启后包外页复活。
- 根因：importRevert 只 restorePairs 主库三件套，`data/sync/` 不在还原面。
  T80-04 前该断言被 EBUSY 挡住从未执行过——修好 H-09 才暴露本条（连环依赖属预期）。
- 同构风险：execute 成功态本地段=旧段+新封段混合，replace 语义只在投影层成立——
  T82-01 毁灭性重建守卫的同构土壤，必须段层+账本+投影三层同还原。
- 修复：TASK-T80-06（sync 目录级快照/还原 + coverage 补本地段 op + 探针 21/21 验收）。

## 路5 静态竞态扫描结论（09-25）

**并发压测（09-27 完成，PM 自写探针）**：`docs/mockups/cdp-e2e-r29-concurrency.mjs`（**28 断言**，打包/dev 靶可切，双钉 scratch）——P2 并发创建 30 页（id 全唯一、计数 +30）· P3 同页 20 并发提交（无丢写：存活块恰 20）· P4 同块 10 并发覆盖（LWW 无撕裂：list 唯一 + 文本 ∈ 写入集合）· P5 60 路读写交错（40 查询 + 20 提交同刻 → 0 reject，无 `database is locked`）· P6 `links.rebuild` 三连并发 + 20 并发读（无异常）· P7 同页 5 并发删除（幂等）· P8 5 并发删 + 5 并发恢复（无幽灵页）· P9 pageerror=0 · P10 离线只读 `PRAGMA integrity_check=ok` · P11 真实根 mtime 零触碰 · **P12 同页 6 并发移动**（0 reject + 落点 ∈ 目标集合 + 无孤儿/无双父）· **P13 10 并发重命名**（终态标题 ∈ 集合）· **P14 6 并发类型转换**（0 reject + 终态类型合法）· **P15 同目录 3 并发便携包导出**（原子写 tmp→rename；产物 3 个 zip 全部 `testzip` 通过、条目完整）· **P16 5 并发 pageExport.preview**（只读零写，结构合法）。
**压测产出**：抓到 **H-12**（连点删除误报）→ 治本后复跑 **28/28**；单测基线 pages 18（含新锁）/ 全量 desktop 1277。
**CI 侧连带收口**：①**H-13**（本面板非数组载荷崩溃，见台账）②`perf.test.ts` 的 `BUDGET_REBUILD` 原为**平铺 5000ms**，而 CI win-latest 实测 4.09/4.18/5.41 s（余量仅 ~18% → 落在共享 runner 噪声带内必然偶发翻红）→ 按既有「CI=量级哨兵、严格阈值留本地」口径改为 `IS_CI ? (win 15000 / mac 8000) : 5000`，实测依据写进代码注释；本地严格 5000ms 不变。

异步 read-modify-write 面：runtime.ts 的 cycleRunning/cycleQueued 互斥+finally 补跑、reencrypting 双保险（495/532 前置检查）——审读均单线程事件循环下正确；其余（ai/service、crypto、provider）状态字段无跨 await 复合更新危险形。文件并发写面：export/import 为用户发起动作（main 串行）、段写=runCycle 单写者队列（时序问题即 H-08，已立案）。不新增案。
