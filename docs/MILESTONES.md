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
| └ T10 设置+i18n+诊断（M9） | 09-13 | ✅ | **真机 CDP ALL-PASS 11 项**（路由四区块/开关 role=switch/live 主题切换/diag export→confirm 两段式/落盘无主目录路径/非法 theme main 拒/pageerror 0）+ 主题持久链专项 3 连 PASS + 双主题截图 PIL 差分证实；platform 34/desktop 117 tests；诊断脱敏正则与任务书逐字一致 |
| └ T9 sync 核心（M8a） | 09-13 | ✅ | **A+B+C 三阶段派发**（glm 网关连烧两次「Empty stream」后换 deepseek-v4-pro 成功）；83 tests：S1-S6/S8/S9 逐景内存复现 + **收敛性总测（4 设备×30 op×4 切分→投影逐字节相等）**通过；纯逻辑零 IO 铁律守住（grep 断言仅 fs.ts 触 node:fs）；复用 core.segment/replay 零重写 |
| └ T8 搜索+命令面板（M7） | 09-13 | ✅ | **真机 CDP 验收 ALL-PASS 13 项**（Ctrl+K/拼音sz→设置/键盘 active+唯一 aria-selected/Esc/`>`仅命令/FTS 标题命中/LIKE 库名/空串与特殊字符不崩/pageerror 0）+ 双主题 4 截图视觉审；1 万页 P95=11.9ms（红线 150ms）；v4 FTS 正文管道；desktop 104 tests |
| └ T11 导入器（M12） | 09-14 | 🟡 A+B+C+D ✅；真包（Nathan的工作空间 592 文件）零崩溃冒烟通过：396 页/17 库/123 资产；剩真机 CDP 全链路 | D+修 修 _all.csv 双胞胎归并（34→17）+ 附件 %编码两级查找（0→123）；importer 58、desktop 137、五条 DoD 全绿 |

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
| 22 | electron.vite exclude 漏 workspace 包（#13 同源复发：这次漏 importer）| 高（main 加载崩）| CodeBuddy 主动抽 BUNDLED_WORKSPACE_PACKAGES 单源常量根治，PM 复核认可 |
| 23 | CodeBuddy C 会话遗留 2 个 electron-vite dev 进程未退，锁死 better_sqlite3.node → PM 复跑 install/test 挂；并把自身前半程产出误叙为「并行会话产物」 | 中（流程坑）| PM 清进程后复跑全绿；新纪律：验收前查残留进程 |
| 24 | 真包形态双缺陷：_all.csv 双胞胎（plain=当前视图列会丢属性，_all 才是全属性）+ 附件 src 为 %编码相对路径全判缺失 | 高（M12 金标准） | D 阶段：_all 优先归并+plain skipped-duplicate；两级查找原样→decode；真包冒烟锁定 17 库/123 资产 |
| 25 | 导入执行器层尾排序键饱和：nextSortKey 只尾追加，真包 execute 253/536 撞 SORTKEY_MAX_LENGTH=16 中断 | 高（真包必现） | PM 亲修：将满即整层重建（rebalanceLayer+sortSequence，与新页同 batch 原子），2 条回归（饱和/墓碑幂等）绿 |
| 26 | 计划器去重先于重命名 → 撞名条目二次导入漏网（真包 CDP 终验抓到：重导 plan 漏 41 条、真库 16 个同 path 双 hash） | 高（幂等承诺破口） | PM 亲修：finalizePlan 顺序重排（重命名先于去重，最终 path 为源集合纯函数）+ databaseItem 签名收窄 collection；plan.test 补「改名条目二次导入全命中」回归；顺带纠正我 82fe749 轮漏跑 typecheck 的疏漏 |

## CodeBuddy 质量观察（09-13 复盘）
- 系统性缺陷：写完不跑（T7 的 79 测试从未执行→7 个运行时失败里 3 个真 bug）、引用幻觉（从 types 导入 view.ts 的符号）、漏声明依赖、半途停（T7 §2 接线未做）、范围蔓延（顺手动 ui/vitest 配置——好在两处越界均为合理修复）。
- T7b 起强制「每写完一个测试文件立即跑」+ 给 Bash 权限后质量显著提升：交付自带报告、主动修根级双实例问题。保留此纪律。
- 额度：429 是按模型分桶的日窗口（与积分无关），flash 档耗尽可 `--model` 切换。

## 待修清单（低优先级，不阻塞）
- [ ] **FTS trigram 对 2 字中文查询零命中**（真机视觉审计抓出：「审计」不中、3 字以上正常）——设计使然非缺陷，但中文双字词高频；二期与 unicode61+分词器一并解，或短期给 <3 字查询加 LIKE 兜底
- [ ] 面板/次级文字（空态、键帽说明、Esc）深色主题对比度未达 WCAG AA 舒适阈（vision 审计），G4 UI 打磨统一提亮一级灰阶
- [ ] editor 渲染 callout 时 `sc-block` class 重复拼接（cosmetic）
- [ ] mac 分支 credentials/keychain 需在 macOS CI runner 上真跑（本机 Windows）
