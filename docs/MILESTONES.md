# 里程碑台账 · Septcats

> PM 维护。每条 = 已真实验证（命令输出/真机取证），非口头。

| 里程碑 | 日期 | 状态 | 证据 |
|---|---|---|---|
| G0 PRD 定稿 | 2026-09-12 | ✅ | 老板答复 Q1–Q9（PROJECT_PLAN §14） |
| 网盘 API 事实核查 | 09-12 | ✅ | pan.baidu.com/developer 404、open.quark.cn=小程序平台、bypy README（实测） |
| G1 骨架可跑 | 09-13 | ✅ | 真机 `electron-vite dev` 窗口标题 "Septcats"；typecheck 6/6；全仓 269 tests；selftest 17 PASS；双平台 CI 已配 |
| ├ T2 DbServer | 09-13 | ✅ | 崩溃恢复链路真跑：删库→从分段重建→数据/FTS/integrity 一致 |
| └ ABI 双运行时守卫 | 09-13 | ✅ | ensure-abi.mjs；修复 15 个被静默跳过的 DB 用例→33/33 真跑 |
| G2 mockups 交付 | 09-13 | ✅ 待老板逐屏确认 | 10 屏 × 双主题 20 截图；CDP 审计 0 溢出/0 重叠；品牌标 3 版（几何程序化校验） |
| └ T4 packages/ui | 09-13 | ✅ | 25 组件 58 测试；token 管线 --check 防漂移；no-magic 0 违规 |
| └ T5 packages/editor | 09-13 | ✅ | 真机 CDP 取证：9 块型全渲染、16px/1.75/ink/canvas 逐字符 §16.5、pageerrors none；50 步 undo 链 fuzz 绿 |
| 编辑器选型 SPIKE | 09-13 | ✅ | npm registry 实测 → Tiptap v3（docs/decisions/SPIKE-G2-01） |
| └ T6 pages（M5） | 09-13 | ✅ | 真机 CDP 验收 ALL-PASS 7 项（tree/create/rename/tombstone/restore/E_CYCLE/E_PARENT_GONE、pageerror 0）；desktop 57 tests |
| └ T7 dbview 库侧（M6） | 09-13 | ✅ | 79 tests（1 万条筛选/排序性能夹具、CSV 转义、relation 计划、四态渲染）；v3 backlinks 迁移；no-magic ✓ |
| └ T7b dbview 接线（M6） | 09-13 | ✅ | **真机 CDP 验收 ALL-PASS 11 项**（db 桥注入/转为数据库按钮/IPC 建库→记录→改名→relation 双写→E_REFERRED 拒删→删除→exportCsv 含 BOM/pageerror 0）；desktop 73 tests；全仓 7 包 typecheck+test 绿；commitOps 同源扩展 collection/record 物化 |
| └ T11 导入器（M12） | 09-15 | ✅ | **真机 CDP ALL-PASS 12 项**（唯一 nonce fixture：plan 2 页+GFM 降级 warning→execute→页树→attachment:///asset:// 逐字节→CSP 放行解码→幂等重跑 0 重复→向导 stepper）；PM 亲修 E2 幂等击穿（重命名先于去重）；importer 59/editor 152；golden 真包 421 页 dedup 漏=0 |
| └ M8b 双实例真机 | 09-16 | ✅ | **ALL-PASS 5 项**：两独立数据根+root/sync junction 共享（网盘语义正解）；A 建页→B 追平「双子星页」、manifest+seg 文件对账；夹具三轮修正（settings 文件名 septcats.settings.json、ULID id 断言、setEnabled({on})），产品代码零改动 |
| └ T13 同步运行时（M8b） | 09-16 | ✅ | 引擎零改动（git 0 diff 实证）+ runtime 746 行 + bridge 装饰器旁路 + AES-GCM/DEK-DPAPI + SyncStatus 五态面板；**双 runtime 十场景全真跑**（A 建 5 页 B 追平/并发 LWW 收敛+conflict 各≥1/副本去重/断链 degraded/崩溃自愈/S5 快照播种追平/加密 E2E E_SYNC_KEY_MISMATCH 红条/假时钟轮询）；filterAgainstLedger 数学复核通过（等值 op 在 replay 本就是 no-op）；desktop 194 全绿 |
| └ T14 性能基线（G4） | 09-16 | ✅ | 四项 vitest 预算断言+perf-history.jsonl 台账+--perf-trace 打点+perf-pack.mjs；安装包 88.5MB 绿；**测出两枚真红**（commit 批 232ms、rebuild 45.7s）——红牌如实入账不凑绿，催生 T15 |
| └ T15 FTS O(n²) 修复 | 09-16 | ✅ | 232ms→14.1ms、45.7s→1.41s（perf 预算断言原值未改）；v6 fts_defer+WHEN 守卫（PM 双探针定案：TEMP 表触发器不可见→常规表方案）+rebuild/batch 头尾 defer+prepare 缓存；fts-defer 6 断言；213 全绿；半途中断会话由遗产续作接力完成 |
| └ T16 内存诊断+裁决（#32） | 09-16 | ✅ 结案 | 逐进程解剖：sum-WS 634.7MB vs **sum-Private 331.5MB**（差 303MB=Chromium 共享页重复计数）；PM 裁决预算绑 private 口径→**实为绿**；PRAGMA 只读账清（cache_size 16MB/better-sqlite3 编译默认）；旋钮与 DbServer 合并均不批；perf-pack 三口径+--baseline+清场固化，产品代码零改动 |
| └ 内存红牌 #32（历史） | 09-16 | ✅→转绿 | perf-pack 真机：startup 465ms 绿/安装包 88.5MB 绿/**WorkingSet 总和 612MB 红（预算 350）**；空载即超→结构性；T16=逐进程解剖+三口径（Electron 多进程 sum 高估真实 RAM，口径本身待裁）+utilityProcess 账，只诊断不投机优化 |
| └ T17-01 S10 换钥匙/恢复码（G5-1） | 09-17 | ✅ | 断点续作全链：D1 恢复码 base32（52 字符）/D2 信封 v2 key_id/D3 轮换+后台重加密原子替换/D4 三通道+六态 key_mismatch 红条/D5 设置页「同步密钥」三件套；PM 修四缺陷（rotateKey 链同步赋值竞态/快照幻影守卫/seed+merge 同源映射/夹具 .jsonl.enc 命名契约+v1 IV 防 0x01）；**DoD 全绿：typecheck 9/9、全仓 229 tests（224→229）、no-magic ✓、SELFTEST OK**；sync 五文件 48→53；报告 docs/tasks/TASK-T17-01-report.md（含 PM 复跑原文） |
| └ T18-01/02 M11 AI 核心+设置页（二期首站） | 09-17 | ✅ | T18-01 核心（50ecbca）：main/ai 六模块（OpenAI 兼容客户端 LM Studio/Ollama/自定义 共用 /v1 + 端点策略 + 60s 模型缓存 + ai:* 五通道 + settings.ai 段）；**隐私硬断言**：云端默认关、非本地无 consent fetch 零调用、密钥只进 CredentialStore、日志零密钥零正文；全仓 770 tests。T18-02 设置页「AI 助手」区块：provider 增删改/模型下拉四态/测试连接/密钥/默认 radio/云端开关 +7 用例；PM 亲修 4 处（含 1 处 flaky：全局 radio 计数撞 AI → within 收窄）；全仓 272/272（报告 TASK-T18-02-report.md） |
| └ T18-03 M11 AI 编辑器动作（3/3） | 09-17 | ✅ **真机 CDP 离线 8/8 + 真机 13/13 ALL-PASS** | 命令面板四命令（AI 续写/摘要/改写/翻译 + 拼音别名，sz/yin 基线复验）+ 选中优先/块文本回退 + AiActionPanel 四态 + 应用走 TipTap transaction 与既有保存路径；`shared/aiPrompts` prompt 单一来源；LM Studio qwen3.6-35b-a3b-mtp **实生成→应用→块文本变化**、pageerror 0、asar 新型号实证；PM 亲修验收脚本 2 处（waitFor 假红 / 真机层重挂载与回编辑器，#27/#31 同族）；全仓 **293/293**（desktop +21；计数对账修正 palette 14→19 = +5）；报告 `docs/tasks/TASK-T18-03-report.md`（§6 PM 复跑原文） |
| └ T18-04 M11 AI 属性列（4/4 收尾） | 09-17 | ✅ CDP 离线 15/16 + 真机 20/21（唯一红 = 既有缺陷 T18-04-1） | 新属性类型 `ai`（可选 `prompt`；值 = 纯字符串，复用同步/CSV/撤销）+ dbview 受控回调（单元格生成 / 列头批量 ≤20 带确认）+ app 装配（`ai.state()` 三态门控 → `ai.chat` → `db.recordUpdate`）；**真机 LM Studio 生成 → 单元格值 → 落库**全链实证；PM 裁决接受 DEVIATION-1（`main/dbview.ts` 5 点必要使能）+ 收类型债（d.ts 补 `patch.ai`、删 `as unknown as`）；**发现既有缺陷 T18-04-1（记录标题双击改名不生效，探针实证）→ 开 TASK-T18-05**；CDP 脚本 5 处流程/时序缺陷亲修；dbview 93（+14）、desktop 301（+8）、typecheck 9/9、no-magic ✓、SELFTEST OK；报告 `docs/tasks/TASK-T18-04-report.md` §6 |
| └ T18-05 缺陷修复：记录标题双击改名（T18-04-1） | 09-17 | ✅ **真机 CDP ALL-PASS 21/21** | 根因 = 焦点争夺：编辑框 `focusin` 冒泡 → 单元格 `onFocus` → 新 `focusedCell` 对象 → TableGrid 焦点 effect **无条件抢焦** → 输入框 `onBlur` 提交未变更 draft → 编辑态同帧闪退；修复 `!node.contains(document.activeElement)`（`TableGrid.tsx:293`），**顺带修好普通单元格编辑同病**；新增 2 条 DbView 级回归用例（修复前 2 failed 可复现 → 修复后 95/95）；PM 重打包 + asar 实证 + CDP 复验该断言 FAIL→PASS；脚本第 6 处时序缺陷亲修；typecheck 9/9、no-magic ✓、SELFTEST OK |
| └ T19-01 SPIKE：协作（CRDT）与 op-log 融合路径 | 09-17 | ✅ PM 复跑原型确定性通过 | 五问全答 + 一次性原型（双客户端 ×200 轮 ×2 场景，**一致率 100%**；PM 独立复跑 3 次 md5 全等）：模拟现状 LWW 在同块并发下**蒸发文本编辑 51.6% / 单元格写 46.6%**（200/200 轮全发生）；**推荐混合路径 (b)**：块内容/结构用 Yjs + 元数据/DB 值留 op-log，新增 `crdt_update` op 进既有段/加密/ledger（加密零改动、段不变量不变、200 轮全量 update 16.4KB ≪ 256KB 段限），量级 10–15 人日；明确不建议纯自研文本 CRDT / 整库 Yjs / move-reorder 上 CRDT；拆解 T19-02..05；风险首条=SCHEMA_VERSION=2 混跑期 v1 客户端整段 quarantine（须在发布节奏上留升级窗口）。报告 `docs/tasks/TASK-T19-01-SPIKE-report.md` |
| ├ T19-02 core：op schema v2 + 字段级 LWW + `crdt_update`（协作 1/4） | 09-17 | ✅ 已审验+提交 `475b6bb` | SCHEMA_VERSION 1→2（`MIN_SUPPORTED=1`，v1 段逐字节等价可读）；`OP_KINDS+='crdt_update'`（payload `{pageId,updateB64,svFromB64?}`，core 零解码）；`MERGE_POLICIES=['lww','lww-field','crdt']`；record 值 payload 只带**变更 key** + replay 按键合并（null 删键，未出现 key 保留）；`crdt_update` 不参与 LWW→`ReplayReport.crdtUpdates`（`opId` 去重）；**「修复前红→修复后绿」实证**（整对象 upsert 丢并发 key 写复现 = SPIKE 46.6% 蒸发的单测版，13 新用例 core 38→51）；DEVIATION-1/2 追认（editor/commit switch 补 case，类型收敛）；版本钉两处随动 PM 补 `0bccdce`；PM 复跑 core 51/51、typecheck 9/9、no-magic ✓、全仓 707/707 |
| ├ T19-03 editor：Yjs 绑定（协作 2/4） | 09-17 | ✅ 已审验（11 红全修） | `YjsEditor`：Y.Doc↔Tiptap 双向绑定（yjs@13.6.32 + y-prosemirror@1.3.7），上行防抖 100ms 合并 `crdt_update`、下行 `applyCrdtUpdate` 按 pageId 分区、防回环（`tr.local` 过滤）；**首轮中断 11 红 → T19-03B 补派修复**，头号根因 = Y.Doc `'update'` **四参**签名取错（第三参 Doc 当 Transaction → `tr.local` 恒 undefined → 本地增量全被误滤）；**撤销走 YUndoPlugin**（协作语义：只撤本地不撤他人，已注释钉住）；attach 补 PM→Y 种子分支（否则 ySyncPlugin 首渲染清空 PM 初始内容）；13 用例（editor 146→157）；红线零越界（core/sync/desktop/src/ui/schema 未动）；PM 复跑全仓 707/707、typecheck 9/9、no-magic ✓、SELFTEST OK |
| ├ T19-04 sync：crdt_update 分流 / 快照折叠与播种 / 收敛总测扩展（协作 3/4） | 09-17 | ✅ 已审验+提交 `df68d57` | `SyncReport.crdtUpdates` 透出（core.replay 收集，不进 LWW）；`mergeCrdtUpdates` opId 去重保序（确定性）；快照顶层 `crdtUpdates` 区段（按 pageId 分组、不丢不折叠、稳定键序）+ `seedFromSnapshot→{seedOps,crdtUpdates}`（v1 旧快照→空数组、畸形→校验错）；攒段自然切分钉不变量；**4 设备并发文本总测**（yjs devDep 真增量 ×3 轮乱序切分 → 文本逐字符一致 + 投影逐字节相等 + crdtUpdates 全集合）；15 新用例（sync 83→98）；DEVIATIONS 1–5 追认；PM 复跑 sync 98/98、typecheck 9/9、no-magic ✓ |
| └ T19-05 desktop：CollabHub 接线 + 真机双实例冒烟（协作 4/4 收官） | 09-18 | ✅ **真机 CDP ALL-PASS 10/10 + vision 目检** | `main/collab.ts` CollabHub（pageId→YjsEditor LRU 32、crdt_update 组 Op 入真相层不物化、下行路由、跨代播种=快照区段∪账本 op 去重）+ `runtime.ts` 下行分流（crdt op 绕水位过滤）+ `getSnapshotCrdtUpdates` 跨代聚合 + `collab:*` 四通道 + PageView attach/detach（UI 零变化）；12 新用例（desktop 301→313、全仓 837）；**真机双实例**（twin 夹具错峰启动）实证：上行发布→B 追平→无重复种子→双向→**并发四段文本两端逐字符收敛**→A 关页重开账本播种还原→零 pageerror；重打包 asar `collab:attach`×2 实证；DEVIATIONS 1-4 追认（含 crdt 绕水位=正确必要），DEVIATION-5（双空同开重复种子）登记已知限制（根治=账本非空则跳种子）；报告 `docs/tasks/TASK-T19-05-report.md` §7 |
| └ T19-05-1 缺陷修复：attach 种子门（双空同开去重） | 09-18 | ✅ 真机冒烟复跑 ALL-PASS 10/10 | 根因=两台新设备同开同页各自 PM→Y 种子（Yjs client ID 不同→文本×2）；方案=attach 回 `ledgerHasCrdt`（该页账本有 crdt_update op 即 true，payload 畸形也计数）+ renderer `seed:!ledgerHasCrdt` + editor `YjsAttachOptions.seed` 一处最小面（预授权）；§H×2 + editor 用例（desktop 315、editor 158、全仓 878 无红）；perf 16.7 红→静置 13.3 绿（环境敏感性）；重打包 asar `ledgerHasCrdt`×7 实证后 cdp 复跑；残留边界「attach 时刻真同时双空」登记已知限制（二期 SV 协商根治）；**CB 会话中途被回收但实现测试已完整落盘，PM 补报告收口 `b2c6396`** |
| └ T20-01 S4 视觉打磨 1/2：对比度+真门禁 / 1–2 字中文搜索兜底 / class 去重 | 09-18 | ✅ 服务层真机实测通过（UI 层受既有缺陷阻断） | `ink-faint` 深浅双修（#666C75/#8E94A0，13 对全 ≥4.5，**PM 独立解析 tokens.css 复算**）；**新增对比度真门禁** `packages/ui/test/contrast.test.ts`（DESIGN.md 自称的 CI lint 此前不存在，9 用例）；搜索 `<3` 字 LIKE 兜底打通两条链路（`server.ts:495` 分派 + `statements.ts` `search.likeFtsPage` 白名单 + `main/search.ts` 长度分派），≥3 字路径逐字节不变，**真机 IPC 实测 2 字「量子」命中**（DB 直查同证）；`joinClass` 修 `code.ts:50` wrap 真残留；896 全仓无红（878+18 ✓ 对账）、typecheck 9/9、no-magic ✓、SELFTEST OK、asar 实证；**PM 复核期间挖出 3 个既有缺陷 T20-01-1/2/3（rootPath 丢失最高优先级）**；报告 §5/§6 |
| └ T20-02 缺陷修复：rootPath 丢失(P0)/UI 检索不发请求(P1)/主题双源(P2) | 09-18 | ✅ **真机逐条 PASS（含 ALL-PASS 12/12）** | **PM 在 T20-01 复核期挖出并定位到行**：①`writeSettings` rootPath 缺省即清除（数据级）→ 改为缺省保留 `current.rootPath`（显式 `''` 才清除）；②`pagesActions.load()` 全仓无调用点 → `pagesStore.workspaceId` 恒 null → 面板静默早退（真机拦截 `search.query` 得 `calls: []`）→ App 挂载初始化；③主题双源 → 以 localStorage 为准 + 无 theme 时 settings 作种子；**PM 亲修**：`theme.tsx` `setGlobalThemeMode` 只派发事件、异步 settings 结算早于 Provider 挂载 → 播种静默失效，加 `pendingMode` 单槽缓冲（+2 用例，ui 73→75）；真机取证：`probe-t20-settings.mjs` rootPath ASSERT PASS / `cdp-e2e-t20-01.mjs` ALL-PASS 12/12（面板 2 字命中 + 深色实测 4.80 与 PM 算值一致）；全仓 906 无红（896+10 ✓ 对账）、typecheck 9/9、no-magic ✓、SELFTEST OK |
| └ T21-01 关键路径 1/2：编辑器真实持久化（blocks IPC + PageView 接线） | 09-18 | ✅ **真机持久化 ALL-PASS 5/5** | 根因：`blocks:commit/list` 通道 T5 定名但 main 侧从未实现 + PageView 是 memorySession（commit 仅 console.info）→ **编辑内容从不落库**；实现 `main/blocks.ts`（list 走既有 `block.listByPage`、commit 复用 `commitOps`+withSyncHook）+ preload/d.ts 契约 + PageView 四态与 selectedId 驱动；**CB 关键发现**：`commit.ts` 原只支持 block upsert，patch/reorder/delete 缺失（第二次编辑必崩）→ 只增补齐（DEVIATION-1/2 追认）；真机探针：建页→commit→list→**重启后内容仍在**→FTS 链命中→零 pageerror；全仓 916 无红、typecheck 9/9、no-magic ✓、SELFTEST OK |
|  T12 更新器（M10-B） | 09-15 | ✅ | 负向+正面四连真机 ALL-PASS（含 #29 修复的 0.1.3 实例：篡改 yml→E_FEED_SIGNATURE/缺 sig→拒/无门→fail-closed/干净 feed→not-available）；主链路 0.1.1→0.1.2 升级 ALL-PASS；公钥轮换（旧私钥遗失去不可恢复，新 keygen 同步 updater.ts+重打 0.1.3） |
| └ T10 设置+i18n+诊断（M9） | 09-13 | ✅ | **真机 CDP ALL-PASS 11 项**（路由四区块/开关 role=switch/live 主题切换/diag export→confirm 两段式/落盘无主目录路径/非法 theme main 拒/pageerror 0）+ 主题持久链专项 3 连 PASS + 双主题截图 PIL 差分证实；platform 34/desktop 117 tests；诊断脱敏正则与任务书逐字一致 |
| └ T9 sync 核心（M8a） | 09-13 | ✅ | **A+B+C 三阶段派发**（glm 网关连烧两次「Empty stream」后换 deepseek-v4-pro 成功）；83 tests：S1-S6/S8/S9 逐景内存复现 + **收敛性总测（4 设备×30 op×4 切分→投影逐字节相等）**通过；纯逻辑零 IO 铁律守住（grep 断言仅 fs.ts 触 node:fs）；复用 core.segment/replay 零重写 |
| └ T8 搜索+命令面板（M7） | 09-13 | ✅ | **真机 CDP 验收 ALL-PASS 13 项**（Ctrl+K/拼音sz→设置/键盘 active+唯一 aria-selected/Esc/`>`仅命令/FTS 标题命中/LIKE 库名/空串与特殊字符不崩/pageerror 0）+ 双主题 4 截图视觉审；1 万页 P95=11.9ms（红线 150ms）；v4 FTS 正文管道；desktop 104 tests |
| └ T11 导入器（M12） | 09-14 | ✅ **真包真机 CDP ALL-PASS 8 项**（脏库 E2 案发现场：全量去重 skipped=421/漏 0、重执行 done、436 页树 dangling=0、FTS 命中、无重复页、pageerror=0） | A-D+E/E2 五阶段：`_all.csv` 双胞胎归并（34→17）+ 附件 %编码两级查找（0→123）；importer 58、desktop 137、五条 DoD 全绿 |
| └ T12 打包（M10-A） | 09-14 | ✅ PM 复验通过 | electron-builder 26.15.3；`Septcats Setup 0.1.0.exe` 88.15MB（R7≤150 达标）；/S 静默装→启动 5s 树存活→卸载零残留；latest.yml sha512 与产物字节级一致；asar+locales 裁剪生效（仅 zh-CN.pak）；零新增依赖除 builder；mac 配置就位待 CI；CI package job 已加（无 remote 未跑） |

## PM 亲修的缺陷账（CodeBuddy 交付后审查发现，均已修+有回归测试）
| # | 缺陷 | 严重度 | 修复 |
|---|---|---|---|
| 1 | sortkey：相邻数字取 b 首字符→前缀死区 | 高（拖拽排序无解崩溃） | digitA=-1 哨兵 + 沿 b 递归 |
| 2 | replay：未记"覆盖冲突" | 中（冲突副本丢失） | 异设备覆盖写入 report |
| 3 | apps/desktop 用 zod 未声明依赖 | 高（CI 必挂） | 补声明 |
| 4 | Node/Electron 双 ABI → 15 测试静默 skip | 高（假绿） | ensure-abi 守卫脚本 |
| 5 | ui 测试 ../../test 断链 + ?raw stub 空串 | 高（24 测试全挂） | 路径修 + 磁盘读 helper |
| 6 | build-tokens `--sc-font-font-ui` 双前缀漂移 | 中 | key.replace(/^font-/) |
| 7 | **code node/mark 撞名**（PM RangeError） | 高（编辑器起不来） | 真相层不动，投影边界映射 codeBlock（单源双表） |
| 8 | diff 重平衡回退键越过锚点 | 中（兄弟序错乱） | 无解→整层等间隔重建 |
| 9 | history 冗余 delete 的逆 op 错误复活实体 | 高（撤销链被 fuzz 抓到） | 应用前已死→逆=null |
| 10 | PageView optimizeDeps 隔离警告 | 低 | ui>child 语法 |
| 11 | T6 tree 后代收集用 BFS ≠ 视觉序（DFS 前序） | 高（子树不连续） | 改实现出栈即记录+逆序压栈 |
| 12 | createPage version=1 → 首版 lamport=2（rename 差 1） | 中 | 新建实体 version=0 |
| 13 | externalize 排除表漏 @septcats/editor → main 加载崩、preload 不注入（vitest 全绿照不到） | 高 | 排除表补全 editor/dbview；真机验收制度确立 |
| 14 | dbview：虚拟滚动 spacer `String(n)` 无 px 单位 → CSS 失效 | 高（长表不滚动） | 模板字符串带 px（4 处） |
| 15 | dbview：relationWritePlan 对非 relation 属性把文本值清成 null | 高（单元格提交即丢数据） | 非 relation 早退原样写值 |
| 16 | dateValueSchema 区间校验放过 2月30日 | 中 | superRefine Date 往返核实 |
| 17 | encode/decodeValue 语义不配对（encode 不 stringify） | 中（存储往返破） | encode 统一 JSON.stringify 文本 |
| 18 | exportCsv 缺 UTF-8 BOM（zh-CN Excel 必乱码，仅真机测出） | 中 | BOM 前缀 + 单测回归 |
| 19 | T7b 遗产半成品缺 @septcats/dbview 依赖 + unused row | 低 | 补依赖/删死码（typecheck 0 错） |
| 20 | 派发命令前置 `rm` 失败经 && 链吞掉整个 codebuddy 启动（假在飞 703s） | 中（流程坑） | 派发命令保持单一职责，清理动作放独立调用 |
| 21 | 主题真相分裂：settings.json=dark 但重启后渲染 light（ThemeProvider 只播种 localStorage，main 真相没接线） | 高（设置白存）| main.tsx 挂载前 settings.get→setGlobalThemeMode 播种；专项审计 reload 后实测背景色 |
| 22 | externalize 排除表**两处**各写一份再次漂移（漏 importer）| 中 | 提 BUNDLED_WORKSPACE_PACKAGES 单一常量，两处引用；新包只改一处 |
| 23 | CSP img-src/connect-src 未放行 asset:/attachment: → 导入图片必破图 | 高（真机才测出）| index.html CSP 补两 scheme（仅本地协议，不扩大外联面）|
| 24 | 反复强杀 electron 把默认 userData 网络服务状态弄坏→dev 静默自退 | 中（流程坑）| 审计期用 --user-data-dir 独立目录；验收后清目录 |
| 25 | CodeBuddy 会话「自疑并发」停笔提问（第二次发生）；且旧会话被 kill 后 print 模式 stdout 不刷盘 | 中 | 派发词预置「你是唯一作者，直接动手」；报告以 git diff+PM 实测为准 |
| 26 | dist 前置 rm/中文路径坑：PowerShell 直跑含中文路径 Start-Process 静默失败 | 低 | 装包复制 C:\Temp 纯 ASCII 路径 |
| 27 | **验收工具假绿**：负向 e2e 用错版本前提（0.1.0 装的更新器代码里根本不存在 updater IPC，check() 无响应≠拒签生效）| 高（差点误判缺陷）| 教训：负向断言前先正面探针证通道存在；重设计为 0.1.1→0.1.2 链 |
| 28 | 审计脚本 exit 前未记账 CDP 失败 → 「FAIL CDP 未起」不进 results 统计 | 中（同 #27 家族）| 前置失败也必须 check() 记账 |
| 29 | **生产验签击穿**：electron-updater 6.8.9 真实实例无 currentFeedURL 属性（只有废弃 getFeedURL()），恒 undefined→http(s) 预验签块生产被整体跳过（单测假属性掩护）| 中高（yml 层验签失效；二进制层 sha512 仍在，篡改装包仍失败）| deps.feedUrl 显式接线 + 打包缺接线拒 check（fail-closed）+ parseFeedUrlFromYml 读 app-update.yml；守卫回归 2 条 |
| 31 | 负向验收假通过：装的实例是修复前旧构建（asar grep currentFeedURL=1 实锤）——「篡改后 available」差点误判成实现缺陷 | 高（验收工具链）| 负向前先 grep asar 关键字符串证实例版本；e2e 改 IPC 直驱 check() 读 errorCode，弃 UI 扫文案 |
| 30 | v4 块 FTS 触发器逐行整页重算=O(n²)：commit 批 P95 232ms（预算 16）、rebuild 45.7s（预算 5s），且 rebuild 末尾本有 FTS_RESYNC=触发器全白做 | 高（§9.2 两项硬指标击穿，G4 阻塞）| T15：v6 fts_defer 常规表+触发器 WHEN 守卫+rebuild/batch 头尾 defer+prepare 缓存；性能仪表盘（T14）就是为抓它而装 |
| 22 | electron.vite exclude 漏 workspace 包（#13 同源复发：这次漏 importer）| 高（main 加载崩）| CodeBuddy 主动抽 BUNDLED_WORKSPACE_PACKAGES 单源常量根治，PM 复核认可 |
| 23 | CodeBuddy C 会话遗留 2 个 electron-vite dev 进程未退，锁死 better_sqlite3.node → PM 复跑 install/test 挂；并把自身前半程产出误叙为「并行会话产物」 | 中（流程坑）| PM 清进程后复跑全绿；新纪律：验收前查残留进程 |
| 24 | 真包形态双缺陷：_all.csv 双胞胎（plain=当前视图列会丢属性，_all 才是全属性）+ 附件 src 为 %编码相对路径全判缺失 | 高（M12 金标准） | D 阶段：_all 优先归并+plain skipped-duplicate；两级查找原样→decode；真包冒烟锁定 17 库/123 资产 |
| 25 | 导入执行器层尾排序键饱和：nextSortKey 只尾追加，真包 execute 253/536 撞 SORTKEY_MAX_LENGTH=16 中断 | 高（真包必现） | PM 亲修：将满即整层重建（rebalanceLayer+sortSequence，与新页同 batch 原子），2 条回归（饱和/墓碑幂等）绿 |
| 26 | 计划器去重先于重命名 → 撞名条目二次导入漏网（真包 CDP 终验抓到：重导 plan 漏 41 条、真库 16 个同 path 双 hash） | 高（幂等承诺破口） | PM 亲修：finalizePlan 顺序重排（重命名先于去重，最终 path 为源集合纯函数）+ databaseItem 签名收窄 collection；plan.test 补「改名条目二次导入全命中」回归；顺带纠正我 82fe749 轮漏跑 typecheck 的疏漏 |
| 27 | 我的 CDP 审计脚本自身「假绿」：重导断言只查「页集合无新增」近似，未用全量 skippedDuplicate==plan1 记账集合核对 → E2 幂等击穿（漏 41 条）连续三轮都从这条缝里溜过去 | 中（验收工具缺陷） | 断言改为双态硬核对（新库全量 404/旧库 skipped≥420）+ 纯逻辑 golden-dedup 用与 SQL 逐字对齐的 (path,hash) 键回归 |

## CodeBuddy 质量观察（09-13 复盘）
- 系统性缺陷：写完不跑（T7 的 79 测试从未执行→7 个运行时失败里 3 个真 bug）、引用幻觉（从 types 导入 view.ts 的符号）、漏声明依赖、半途停（T7 §2 接线未做）、范围蔓延（顺手动 ui/vitest 配置——好在两处越界均为合理修复）。
- T7b 起强制「每写完一个测试文件立即跑」+ 给 Bash 权限后质量显著提升：交付自带报告、主动修根级双实例问题。保留此纪律。
- 额度：429 是按模型分桶的日窗口（与积分无关），flash 档耗尽可 `--model` 切换。

## T12-01 PM 裁决（09-14）
- **D1 安装目录 `@septcatsdesktop`**：per-user 语义实质满足，接受现状；目录名美化归 M10-B 顺手修（electron-builder.yml 的 nsis 段一行，不阻塞）。
- **D2/D3**：工程师纠正任务书正确（NSIS 卸载器 `/S`；Electron 无裸 en locale），不改。

## 待修清单（低优先级，不阻塞）
- [x] ~~FTS trigram 对 1–2 字中文零命中~~ → **服务层已修**（T20-01：`<3` 字走底表 LIKE 兜底，`\ % _` ESCAPE，≥3 字路径逐字节不变；真机 IPC 实测「量子」命中）。**⚠ UI 层仍不可用 = T20-01-2**
- [x] ~~面板/次级文字深色对比度未达 AA~~ → **已修**（T20-01：`ink-faint` 深浅双修 #666C75/#8E94A0，13 对全 ≥4.5，PM 独立复算；新增真门禁 `packages/ui/test/contrast.test.ts`——DESIGN.md 自称的「CI lint」此前不存在，现已落地）
- [x] ~~callout `sc-block` class 重复~~ → **已修**（T20-01：真残留是 `code.ts:50` wrap 路径而非 callout；`joinClass` 去重 + 2 用例）
- [x] ~~T20-01-1 数据级：`settings.patch` 丢弃 `rootPath`~~ → **已修**（T20-02 §0.A：`writeSettings` rootPath 缺省→保留 current；真机探针 ASSERT PASS：patch 后 + 二次启动后 rootPath 均在）——夹具 patch 前 `keys=[schema,rootPath,theme]` → patch 后 rootPath 消失。后果：改过任意设置后重启落到默认根，用户笔记「看似消失」且可能写入分叉。铁证在 `docs/mockups/probe-t20-settings.mjs`（可复跑）
- [x] ~~T20-01-2 UI 检索不发请求~~ → **已修**（T20-02 §0.B：App 挂载调 `pagesActions.load()`；真机 `cdp-e2e-t20-01.mjs` **ALL-PASS 12/12**——面板输入 2 字「量子」真实命中）——`pagesStore.workspaceId` 无初始化调用点（`palette.ts:89` 静默早退）；真机拦截 `search.query` 得 `calls: []`。UI 内搜索不可用（后端正常）
- [x] ~~T20-01-3 主题双源~~ → **已修**（T20-02 §0.C + PM 亲修 `theme.tsx` 挂载前事件兜底：真机开机 `data-theme=dark`）（夹具 dark → 真机 light；实时切换正常）
- [ ] mac 分支 credentials/keychain 需在 macOS CI runner 上真跑（本机 Windows + 发布清单 §0 的 worktree 构建法）
- [x] ~~T19-05-1 双空同开重复种子~~ → **已修**（attach 回 `ledgerHasCrdt` 种子门，editor `attach({seed})` 最小面；单测 §H×2 + editor 158 钉住；真机冒烟复跑 ALL-PASS 10/10。残留边界：attach 时刻双方账本**真同时**为空仍各自种子——网盘轮询天然错峰、概率极低，二期状态向量协商根治）
