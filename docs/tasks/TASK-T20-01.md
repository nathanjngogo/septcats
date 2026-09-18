# TASK-T20-01 · S4 视觉打磨批次 1/2：深浅对比度达标 + 2 字中文搜索兜底 + code/callout class 清理

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：0.2.0 已发布（`git log -1` = 任务书提交 `7ece6b8` 或其后）
> 来历：`docs/MILESTONES.md` 待修清单三条。**修订 v2**：采纳工程师首轮只读侦察的三条情报（§0.3），修点已据实校正。

## 0. PM 实测与裁决（先定死，勿另择方案）

### 0.1 对比度实测（PM 用 WCAG 相对亮度公式算的真实比值；工程师独立复算一致）
- 深色 `ink-faint` #6E737B：canvas 3.73 / surface 3.39 / **surface-raised 3.06** —— 全部低于 AA 4.5
- 浅色 `ink-faint` #8A8F98：canvas 3.14 / **surface 2.95** / surface-raised 3.25 —— 同样不达标
- 其余文字对（ink、ink-secondary、on-accent/accent、accent/canvas、danger、success）两主题均 ≥4.5 ✓
- **附加发现**：`DESIGN.md:128` 自称「对比度红线（CI lint 验证）」，但仓库里**不存在**这个 lint —— 本任务把这条红线**变成真门禁**。

### 0.2 裁决值（留余量，勿取临界 4.50）
| token | 浅色现值 → 新值 | 深色现值 → 新值 |
|---|---|---|
| `ink-faint` | #8A8F98 → **#666C75**（worst 4.81） | #6E737B → **#8E94A0**（worst 4.80） |

层次校验：浅色 secondary #5B6068 vs faint #666C75 比值 1.20；深色 secondary #A3A8AF vs faint #8E94A0 比值 1.27 —— 三档 ink 仍可辨。不得再动 `ink` / `ink-secondary`。

### 0.3 首轮只读侦察结论（工程师提供，PM 已采纳并锁定修点）
- **A 三处组件定位**：`.search-empty`（`renderer/src/pages/SearchPage.css:145`）、`.palette-foot` 键帽说明（`renderer/src/palette/CommandPalette.css:158`）、`.palette-esc`（`CommandPalette.css:56`）——提亮 `ink-faint` 后**三处全达标**，**不需**改 `ink-secondary`（逐处确认即可）。
- **B 修点**：`apps/desktop/src/db/server.ts:495` 的 `ftsSearch` 分派；`[...query].length < 3` 走 `LIKE` 扫 `page_block_fts` 底表（join `page` alive=1，`\` ESCAPE 转义 `%`/`_`/`\`，标题命中优先排序），≥3 字路径逐字节不动。
  **⚠ PM 追加裁决（本轮必须一并打通）**：命令面板（用户实际搜索入口）走白名单语句 `search.ftsPage`，**不经过 ftsSearch RPC** —— 只修 ftsSearch 治不到用户可见体验。**允许动 `apps/desktop/src/db/statements.ts` 的搜索白名单语句**（新增/调整 `<3` 字兜底语句 + `main/search.ts` 按长度选择）。验收口径 = **命令面板输入 2 字中文能出结果**。
- **C 真残留点校正**：`MILESTONES` 那条 callout class 重复**部分过时**（`efe3053` 已修 `quote.ts`）；**真实残留**在 `packages/editor/src/code.ts:50` 的 wrap 路径（拼出 `sc-block`×2）。

## 1. 项 A：对比度达标 + 门禁落地

1. **改真源**（唯一源 = 仓库根 `DESIGN.md`；`packages/ui/tokens/DESIGN.source.md` 不参与构建，不要动）：
   - front matter `colors.ink-faint` → `#666C75`
   - §「深色主题映射」表 `ink-faint` 行 dark 列 → `#8E94A0`（备注改「≥AA（4.5+）」）
   - §「对比度红线」行：写入两主题 `ink-faint` 真实新比值 + **门禁文件名** `packages/ui/test/contrast.test.ts`
2. **重生成 + 一致性**：`node packages/ui/tokens/build-tokens.mjs --write` → 提交前 `--check` 必须一致（tokens.css/ts 是产物，不手工编辑）。
3. **新门禁** `packages/ui/test/contrast.test.ts`（随 `pnpm -C packages/ui test` 跑）：
   - 解析 `DESIGN.md`（front matter 浅色值 + 深色映射表）与 `packages/ui/src/tokens.css`，按 WCAG 公式计算；
   - 断言（**两主题**）：`ink`/`ink-secondary`/`ink-faint` 对 `canvas`/`surface`/`surface-raised` 全 **≥4.5**；`on-accent` 对 `accent`、`accent`/`danger`/`success` 对 `canvas` **≥4.5**；
   - 失败信息打印「token 对 + 实测比值 + 阈值」；断言 `ink-faint ≠ ink-secondary`（防两档合并）。
4. **组件复核**：按 §0.3 三处定位逐处确认（深色主题截图 + 目检，无色偏/层级塌陷），报告逐处列「定位 + token + 新比值」。

## 2. 项 B：1–2 字中文搜索零命中（功能缺口，RED 优先）

1. **先写「修复前红」用例**（原文入报告）：1 字与 2 字中文查询在含该子串的页面上应命中（当前 0 条 → 红）。harness 仿 `fts-defer.test.ts`。
2. **修复**：按 §0.3 两条修点（`server.ts:495` 分派 + `statements.ts`/`search.ts` 的 palette 链路）实现 `<3` 字 `LIKE` 兜底。≥3 字路径逐字节不变（既有 trigram 语义/排序零回归）。
3. **测试**：1 字/2 字中文命中；2 字命中不返回无关页；`%`/`_`/`\` 字面查询不误当通配符；3 字以上与原行为一致（既有用例零改动即证）；空串/纯空白不报错；**palette 路径（`search.ftsPage`）2 字命中**用例。
4. 若影响 selftest 既有断言（FTS_RESYNC 等），报告说明并保持语义等价。

## 3. 项 C：code/callout class 重复拼接（按 §0.3 校正后的真残留）

1. `packages/editor/src/shared.ts` 加 `joinClass`（空值过滤 + Set 去重 + 稳定顺序）。
2. `code.ts:50` wrap 路径改用 `joinClass`（消除 `sc-block`×2）；`quote.ts` 统一到 `joinClass`（行为不变，保持一致）。
3. 补断言：`react.test.tsx` 里 demo doc 全元素 `class` 无重复 token + code `wrap:true` 用例（`model.ts:294` 透传）。

## 4. 红线

- 允许动：仓库根 `DESIGN.md`、`packages/ui/src/tokens.*`（仅经 build-tokens 生成）、`packages/ui/test/`、`apps/desktop/src/db/server.ts`、`apps/desktop/src/db/statements.ts`（**仅搜索白名单语句**）、`apps/desktop/src/main/search.ts`、`packages/editor/src/{shared,code,quote}.ts` 与对应 test。
- 不碰：`packages/{core,sync,schema}` 既有契约、`packages/editor/src/yjs.ts`、`apps/desktop/src/main/{collab,sync}/**`、任何 IPC 通道形状、CI/发布脚本。
- 不加新依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（只许追加/随动本任务期望值）。
- UI 红线不变：token-only（新门禁是加严，不是放宽）。

## 5. 交付物与 DoD

- 代码 + `packages/ui/test/contrast.test.ts` + `docs/tasks/TASK-T20-01-report.md`（含**修复前红→修复后绿原文**、三处组件逐处结论、两主题 `ink-faint` 新比值、palette 2 字链路证据、PM 复跑节留「（PM 补）」）。
- 自跑：`node packages/ui/tokens/build-tokens.mjs --check`、`pnpm -C packages/ui test`、`pnpm -C packages/editor test`、`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`。全仓与 selftest 由 PM 收口。