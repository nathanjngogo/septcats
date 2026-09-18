# TASK-T20-01 报告 —— S4 视觉打磨 1/2：对比度达标+真门禁 · 1–2 字中文搜索兜底 · code/callout class 清理

- 日期：2026-09-18
- 作者：CodeBuddy（Septcats 唯一工程师），按任务书 v2（ed19763）执行
- 前置核对：`git log -1` = `ed19763 docs(t20-01): 任务书 v2——采纳首轮只读侦察…` ✓

## 0. 总览与自跑结果

| 门禁 | 结果 |
|---|---|
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 产物与 DESIGN.md 一致 |
| `pnpm -C packages/ui test` | ✓ 27 文件 / 70 用例（含新 contrast.test.ts 9 例） |
| `pnpm -C packages/editor test` | ✓ 9 文件 / 160 用例（含新增 2 例） |
| `pnpm -C apps/desktop test` | ✓ 30 文件 / 322 用例（含新增 7 例，全库 55 例 search/fts 相关） |
| `pnpm -r typecheck` | ✓ 9/9（修掉一处自引的多余 import 后通过） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 无字面 hex、无重复裸 px |

全仓聚合跑与 selftest 留给 PM（§5）。

## 1. 项 A：对比度达标 + 门禁落地

### 1.1 真源改动（仓库根 DESIGN.md，唯一源）

- front matter `colors.ink-faint`：`#8A8F98` → **`#666C75`**（§0.2 裁决值）。
- 「深色主题映射」表 `ink-faint` 行：dark 列 `#6E737B` → **`#8E94A0`**，备注改「≥AA（4.5+）」。
  附注：该行 **light 列同步改为 #666C75**——原表 light 列与 front matter 同值展示，只改 dark 列会留下新旧值并存的假两套真相；本改动不改变构建输入（脚本只读 dark 列）。
- 「对比度红线」行重写（原行自称 CI lint 验证但 lint 不存在）：

> 对比度红线（门禁：packages/ui/test/contrast.test.ts，WCAG AA 全部 ≥4.5）：浅色 ink-faint 最差对 4.81（/surface，原 #8A8F98 时 2.95 不达标）· 深色 ink-faint 最差对 4.80（/surface-raised，原 #6E737B 时 3.06 不达标）；其余文字对（ink、ink-secondary、on-accent/accent、accent/canvas、danger、success）两主题均 ≥4.75。

### 1.2 ink-faint 两主题新比值（工程师独立复算，与 PM §0.1/§0.2 实测一致）

WCAG 相对亮度公式复算：

| 主题 | /canvas | /surface | /surface-raised | 最差对 |
|---|---|---|---|---|
| 浅色 #666C75 | 5.11 | **4.81** | 5.29 | 4.81 ✓（PM 裁决 worst 4.81） |
| 深色 #8E94A0 | 5.84 | 5.31 | **4.80** | 4.80 ✓（PM 裁决 worst 4.80） |

层次校验复算：浅色 secondary/faint = 1.20、深色 = 1.27，与 PM §0.2 一致，三档仍可辨。`ink` / `ink-secondary` 未动。

### 1.3 门禁文件 packages/ui/test/contrast.test.ts（新增，9 用例）

- 解析 `DESIGN.md`（front matter 浅色 + 深色映射表）与 `packages/ui/src/tokens.css`（`:root` / `[data-theme="dark"]` 两块的 `--sc-color-*`）；
- 先断言 **tokens.css 与 DESIGN.md 逐 token 一致**（防手改产物 / 漏跑 build-tokens）；
- 按 WCAG 公式断言（**两主题**）：`ink`/`ink-secondary`/`ink-faint` × `canvas`/`surface`/`surface-raised` 全 ≥4.5；`on-accent`/`accent`、`accent`/`danger`/`success` 对 `canvas` 全 ≥4.5；失败信息打印「主题 + token 对 + 两值 + 实测比值 + 阈值」；
- 断言 `ink-faint ≠ ink-secondary`（两主题，防两档灰合并）；
- 锚定用例：faint 必须 = `#666C75` / `#8E94A0`（防回归旧值）；
- 报告口径用例把两主题 × 三平面比值打进测试输出（运行输出即 §1.2 表）。
- 随动（DEVIATION-1，待 PM 追认）：`packages/ui/vitest.config.ts` include 追加 `'test/**/*.test.ts'`——原 include 只收 `src/**`，不改则任务书指定位置 `test/contrast.test.ts` 不进 `pnpm -C packages/ui test`。一行机械改动，无语义影响。

### 1.4 三处组件逐处复核（§0.3 定位；深浅两主题按算核验，无色偏/层级塌陷）

| 组件 | 定位 | token | 背景 | 浅色比值 | 深色比值 | 结论 |
|---|---|---|---|---|---|---|
| `.search-empty` | `renderer/src/pages/SearchPage.css:145` | ink-faint | 页面画布（canvas， Worst 取 surface 4.81） | 5.11（surface 4.81） | 5.84（surface 5.31） | ✓ 达标 |
| `.palette-esc` | `renderer/src/palette/CommandPalette.css:56` | ink-faint | 弹层底 `surface-raised`（`.palette` 背景实测 surface-raised） | 5.29 | 4.80 | ✓ 达标 |
| `.palette-foot` 键帽说明 | `renderer/src/palette/CommandPalette.css:158` | ink-faint | `surface-raised` 同上 | 5.29 | 4.80 | ✓ 达标 |

三处均无需改 `ink-secondary`（§0.3 预判成立）；深色 4.80 系全组最差对，仍有余量（非临界 4.50）。

## 2. 项 B：1–2 字中文搜索兜底（RED 优先）

### 2.1 修复前红（原文，`pnpm test search` 实录）

```
 × 1–2 字中文搜索兜底（TASK-T20-01） > palette 链路（search:query → search.ftsPage 白名单）：2 字中文应命中 25ms
     → expected [] to include 'pg-short-2'
 × 1–2 字中文搜索兜底（TASK-T20-01） > palette 链路：1 字中文应命中 24ms
     → expected [] to include 'pg-short-1'
 × 1–2 字中文搜索兜底（TASK-T20-01） > % / _ / \ 字面查询不误当通配符（LIKE ESCAPE 收口） 23ms
     → expected [ 'pg-fix-000000' ] to include 'pg-esc'
 × 1–2 字中文搜索兜底（TASK-T20-01） > ftsSearch RPC：<3 字走底表 LIKE 兜底，返回行形状与 FTS 一致 18ms
     → expected [] to include 'pg-short-2'
 Test Files  1 failed (1)   Tests  4 failed | 9 passed (13)
```

（1 字/2 字/RPC 三路均为 0 条命中 = 缺口本体；`%`/`_`/`\` 用例红的根因同源——页面级检索无 <3 字通路，仅 code 块 LIKE 兜底在动。）

### 2.2 修复实现（两条修点 + 长度分派，≥3 字路径逐字节未动）

| 修点 | 改动 |
|---|---|
| `apps/desktop/src/db/server.ts` | 新增内部门禁 SQL `FTS_LIKE_SEARCH_SQL` + `toLikePattern`；`ftsSearch` 分派处 `[...query].length < 3` 走底表 LIKE（`page_block_fts` 底表 join `page alive=1`，`\ % _` ESCAPE 转义，标题命中 `ORDER BY` 优先、同级 `updated_at DESC` 稳定序），返回行形状与 FTS 一致（page_id/title/score/snippet）；≥3 字分支的 `FTS_SEARCH_SQL` 与 `toFtsPhrase` 调用逐字节不变 |
| `apps/desktop/src/db/statements.ts`（仅搜索白名单） | 新增 `search.likeFtsPage`：与 server 侧同语义（join alive=1、ESCAPE、title_rank 标题优先、正基准分 1.0 与 `SEARCH_LIKE_BASE_SCORE` 同口径、snippet 带 ±24 字窗口） |
| `apps/desktop/src/main/search.ts` | `ftsPageHits` 头部按 `[...query].length < 3` 分派到新增 `likeFtsPageHits`（走 `search.likeFtsPage`，hit 装配与主路径同构，`via:'like'`）；≥3 字的 `search.ftsPage` 调用与后续装配逐字节不变 |

红线核对：IPC 形状零改动（`ftsSearch` 请求/响应形状不变、`search:query` 契约不变）；未触碰 core/sync/schema、editor/yjs.ts、main/collab、main/sync。

### 2.3 修复后绿（原文）

```
 ✓ test/search.test.ts (13 tests) 16405ms
 Test Files  4 passed (4)   Tests  55 passed (55)   （search + statements + server + fts-defer 四文件合跑）
```

新增 7 用例：2 字中文命中（palette 链路）· 1 字中文命中 · 2 字命中不返回无关页（含「干扰」负样本）· `%`/`_`/`\` 字面不误当通配符 · ≥3 字回归（via=fts、score<1）· 空串/纯空白 0 条 · `ftsSearch` RPC <3 字行形状。既有 ≥3 字用例（含 1 万页 P95=12–13.6ms）零改动全绿，即证长词路径无回归。

### 2.4 palette 2 字链路证据（验收口径：命令面板输入 2 字中文能出结果）

链路逐环：命令面板输入 → renderer `search:query` IPC（形状未动）→ `main/search.ts: createSearchService().query()` → `ftsPageHits` 长度分派（<3）→ 白名单语句 `search.likeFtsPage`（`statements.ts`）→ `page_block_fts` 底表 LIKE → 命中装配（kind=page，snippet 带 `[命中]` 同款窗口文本）。测试证据：`search.test.ts` 「palette 链路（search:query → search.ftsPage 白名单）：2 字中文应命中」——`service.query({query:'量子'})` 命中 `pg-short-2`、kind=page、snippet 含「量子」；红→绿原文见 §2.1/§2.3。renderer 侧未读 `via` 字段（grep 零命中），via 改 `'like'` 无 UI 影响。

### 2.5 selftest 既有断言影响

selftest 的 FTS_RESYNC/ftsSearch 断言全部使用 ≥3 字探针（如「重建前保留块」「核反冲」类），走未改动的 FTS 分支，语义等价、无需改动；本轮未跑 selftest（PM 收口）。

## 3. 项 C：code/callout class 重复清理

- `packages/editor/src/types/shared.ts` 新增 `joinClass(...parts)`：空值过滤 + token 级 `Set` 去重 + 首次出现序稳定输出。
- `code.ts` wrap 路径（真残留，原拼出 `sc-block`×2）：改 `joinClass(blockClass('code'), `${blockClass('code')}--wrap`)` → 输出 `sc-block sc-block--code sc-block--code--wrap`，无重复。
- `quote.ts` 统一改 `joinClass`（callout 加 `--callout` 修饰，行为不变）。
- `react.test.tsx` 新增 2 用例：① demo doc（含 callout 与 code）全元素 `[class]` 逐元素断言无重复 token；② code `props.wrap:true`（`model.ts:294` 透传路径）断言 `pre` 带 `sc-block--code--wrap` 且 class 无重复。160 用例全绿。

## 4. 改动清单与 DEVIATIONS

| 文件 | 改动 |
|---|---|
| `DESIGN.md` | faint 新值 ×2 处 + 红线行重写（§1.1） |
| `packages/ui/src/tokens.css` / `tokens.ts` | 仅经 `build-tokens --write` 重生成（4 行值变化） |
| `packages/ui/test/contrast.test.ts` | 新增门禁（9 用例） |
| `packages/ui/vitest.config.ts` | include 追加 `test/**/*.test.ts`（DEVIATION-1） |
| `apps/desktop/src/db/statements.ts` | 仅新增 `search.likeFtsPage` 白名单语句 |
| `apps/desktop/src/db/server.ts` | 仅 `ftsSearch` 分派 + 两条内部 SQL/工具常量 |
| `apps/desktop/src/main/search.ts` | 长度分派 + `likeFtsPageHits` |
| `apps/desktop/test/search.test.ts` | 新增 7 用例（无既有断言改动） |
| `apps/desktop/test/statements.test.ts` | 随动：白名单计数钉 56→57（允许项内的机械随动，DEVIATION-2 待追认） |
| `packages/editor/src/types/{shared,code,quote}.ts` | joinClass + 两处调用点 |
| `packages/editor/test/react.test.tsx` | 新增 2 用例 |

- DEVIATION-1：`packages/ui/vitest.config.ts` include 一行（§1.3，不改则新门禁不随 `pnpm -C packages/ui test` 跑）。
- DEVIATION-2：`statements.test.ts` 白名单总数断言 56→57（新增语句的必然结果，仅期望值随动、语义不变）。
- 备注：`「深色主题映射」表 ink-faint 行 light 列同步 #666C75`（§1.1 附注，避免表内新旧值并存）。
- 备注：`docs/perf-history.jsonl` 追加 4 行——自跑 `pnpm -C apps/desktop test` 时 perf 用例自动落盘的当次基线（非手工编辑），PM 收口时自行取舍保留或还原。

## 5. PM 复跑（2026-09-18）

```
node packages/ui/tokens/build-tokens.mjs --check   → ✓ 产物与 DESIGN.md 一致
node packages/ui/tokens/no-magic.mjs               → ✓
PM 独立复算对比度（直接解析 tokens.css 产物，不采信报告）:
  浅色 13 对最低 4.75 · 深色 13 对最低 4.80 · faint≠secondary ✓ 全达标
pnpm -C packages/ui test / editor / desktop         → 70 / 160 / 322 全绿
pnpm -r typecheck                                   → 9/9 Done
pnpm -r test                                        → 全仓 896 无红（878+18：ui+9 / editor+2 / desktop+7 ✓ 计数对账一致）
pnpm -C apps/desktop selftest                       → SELFTEST OK
重打包 + asar 实证                                   → grep likeFtsPage ×4（新代码进包）
```
**真机验收（`docs/mockups/cdp-e2e-t20-01.mjs` + 三个探针，独立夹具根）**：
- ✅ **IPC/服务层实测通过**：真机内 `search.query({query:'量子'})` → 命中「量子实验记录」（2 字）+ 「量子实验」（4 字）→ **T20-01 的 <3 字兜底与 ≥3 字主路径在真实 app 里均生效**（DB 直查 SQL 亦复现为同一结果）
- ⚠️ **UI 层无法验收**：命令面板输入 2 字无命中，探针抓到 `search.query` **调用次数 0** —— 根因是既有缺陷（见 §6），非本任务引入；`.palette-esc`/`.palette-foot` 实测对比度 5.29（浅色，与算值一致）
- DEVIATION-1/2 追认：`vitest.config.ts` include 追加（新门禁必须随包跑）；`statements.test.ts` 白名单计数 56→57（机械随动）
- 亲修 1 处格式：`search.ts` 新增三行掉了 2 空格缩进（作用域由花括号决定、typecheck 通过，纯风格）

## 6. PM 期间新发现（既有缺陷，均已登记待修清单，非本任务回归）

| 编号 | 缺陷 | 铁证 | 影响 |
|---|---|---|---|
| T20-01-1 | **`settings.patch` 丢弃 `rootPath`** | 夹具 patch 前 `keys=[schema,rootPath,theme]` → patch 后 **rootPath 消失**（补出 locale/privacy/editor/data/sync/ai） | **数据根丢失**：改过任意设置后重启即落到默认根，用户笔记「看似消失」且可能写入分叉 —— 最高优先级 |
| T20-01-2 | 命令面板/搜索页**检索不发请求**（`pagesStore.workspaceId` 无初始化调用点，`palette.ts:89` 静默早退） | 真机拦截 `search.query` → `calls: []`，列表恒「没有匹配的命令或内容」 | UI 内搜索不可用（后端正常）→ 老板侧「2 字搜索」结论只能在修完此单后由 UI 复验 |
| T20-01-3 | 开机不应用 settings 的 `theme` | 夹具 `theme:dark` → 开机 `data-theme=light` | 主题偏好重启丢失（T10 的实时切换正常） |
