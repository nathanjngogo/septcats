# TASK-T20-01 · S4 视觉打磨批次 1/2：深色/浅色对比度达标 + 2 字中文搜索兜底 + callout class 清理

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：0.2.0 已发布（HEAD 见 `git log -1`，main = 0.3.0 候选）
> 来历：`docs/MILESTONES.md` 待修清单三条（G4 vision 审计 + FTS 2 字零命中 + callout cosmetic）

## 0. PM 实测与裁决（先定死，勿另择方案）

**实测（PM 用 WCAG 相对亮度公式算的真实比值）**：
- 深色 `ink-faint` #6E737B：canvas 3.73 / surface 3.39 / **surface-raised 3.06** —— 全部低于 AA 4.5
- 浅色 `ink-faint` #8A8F98：canvas 3.14 / **surface 2.95** / surface-raised 3.25 —— 同样不达标
- 其余文字对（ink、ink-secondary、on-accent/accent、accent/canvas、danger、success）两主题均 ≥4.5 ✓
- **附加发现**：`DESIGN.md:128` 自称「对比度红线（CI lint 验证）」，但仓库里**不存在**这个 lint（`grep -rln contrast packages/ui` 只命中文档）——本任务要把这条红线**变成真门禁**。

**裁决值（留余量，勿取临界 4.50）**：
| token | 浅色现值 → 新值 | 深色现值 → 新值 |
|---|---|---|
| `ink-faint` | #8A8F98 → **#666C75**（worst 4.81） | #6E737B → **#8E94A0**（worst 4.80） |

层次校验：浅色 secondary #5B6068 vs faint #666C75 比值 1.20；深色 secondary #A3A8AF vs faint #8E94A0 比值 1.27 —— 三档 ink 仍可辨（ink 最重、faint 最轻），不得再动 `ink` / `ink-secondary`。

## 1. 项 A：对比度达标 + 门禁落地

1. **改真源**（唯一源 = 仓库根 `DESIGN.md`；`packages/ui/tokens/DESIGN.source.md` 不参与构建，不要动它）：
   - front matter 的 `colors.ink-faint` → `#666C75`
   - §「深色主题映射」表 `ink-faint` 行 dark 列 → `#8E94A0`（备注由「仅装饰性文字」改为「≥AA（4.5+）」）
   - §「对比度红线」行：把 `ink-faint` 两主题的真实新比值写进去（用你算出的数），并注明**门禁文件名**（见 2）
2. **重生成 + 一致性**：`node packages/ui/tokens/build-tokens.mjs --write` → 提交前 `--check` 必须一致（tokens.css/tokens.ts 是产物，不手工编辑）。
3. **新门禁** `packages/ui/test/contrast.test.ts`（vitest，随 `pnpm -C packages/ui test` 跑）：
   - 解析 `DESIGN.md`（front matter 浅色值 + 深色映射表）与 `packages/ui/src/tokens.css`，用 WCAG 相对亮度公式计算；
   - 断言（**两主题都跑**）：`ink` / `ink-secondary` / `ink-faint` 对 `canvas` / `surface` / `surface-raised` 全部 **≥4.5**；`on-accent` 对 `accent`、`accent`/`danger`/`success` 对 `canvas` **≥4.5**；
   - 失败信息必须打印「token 对 + 实测比值 + 阈值」（诊断友好）；
   - 同时断言 `ink-faint` 与 `ink-secondary` 不同值（防有人把两档并成一个）。
4. **组件复核（暗色实拍）**：vision 审计点名的三处（**空态引导文字、键帽说明、Esc 提示**）——找到它们用的 token（很可能是 `ink-faint`），确认提亮后达标；若某处属「必读信息」且仍不达标，把它改用 `ink-secondary`（改动点须在报告里逐处列出）。跑真机 CDP 或截图脚本，深色主题下截这四处 + 用 vision 目检（对比度改善可见、无色偏/层级塌陷）。

## 2. 项 B：2 字中文搜索零命中（功能缺口，RED 优先）

**现象**：FTS5 `trigram` 分词（`apps/desktop/src/db/schema.sql.ts:146` `page_block_fts`）对 **1–2 字**查询恒零命中——「审计」查不到，「审计日志」能查到。中文双字词是高频查询，这是真实可用性缺口。

1. **先写「修复前红」用例**（原文入报告）：1 字与 2 字中文查询在含该子串的页面上应命中（当前返回 0 条 → 红）。
2. **修复**（在 `apps/desktop/src/db/server.ts` 的检索路径，与 `apps/desktop/src/main/search.ts` 的 `toFtsPhrase` 同源处）：查询**有效字符数 < 3** 时改走 `LIKE '%q%'` 兜底（对 `page_block_fts` 底表或 page/block 文本列，按现有排序口径：命中 + 现有排序键；`LIKE` 通配符 `%`/`_` 必须转义）；≥3 字路径**逐字节不变**（既有 trigram 语义/排序不得回归）。
3. **测试**：1 字、2 字（中文）命中；2 字命中不返回无关页；`%`/`_` 字面查询不误当通配符；3 字以上与原行为一致（既有用例零改动即证）；空串/纯空白不报错。
4. 若判定影响 selftest 的既有断言（FTS_RESYNC 等），报告里说明并保持语义等价。

## 3. 项 C：callout `sc-block` class 重复拼接（cosmetic）

编辑器渲染 callout 时 class 出现重复拼接（`docs/MILESTONES.md` 待修清单条目）。修法：由「字符串拼接」改为条件集合（去重），行为零变化；补一条断言渲染出的 `class` 无重复 token 的用例。

## 4. 红线

- 允许动：仓库根 `DESIGN.md`、`packages/ui/src/tokens.*`（仅经 build-tokens 生成）、`packages/ui/test/`（新增对比度门禁）、`apps/desktop/src/db/server.ts`、`apps/desktop/src/main/search.ts`、编辑器里 callout 渲染点、各对应 test。
- 不碰：`packages/{core,sync,editor(yjs),schema}` 的既有契约、`apps/desktop/src/main/{collab,sync}/**`、任何 IPC 通道形状、CI/发布脚本。
- 不加新依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（只许追加/随动本任务改动的期望值）。
- UI 红线不变：token-only（新门禁是加严，不是放宽）。

## 5. 交付物与 DoD

- 代码 + `packages/ui/test/contrast.test.ts`（新）+ 各测试 + `docs/tasks/TASK-T20-01-report.md`（含**修复前红→修复后绿原文**、三处组件复核逐处结论、`ink-faint` 新值两主题实测比值、PM 复跑节留「（PM 补）」）。
- 自跑：`node packages/ui/tokens/build-tokens.mjs --check`、`pnpm -C packages/ui test`、`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`。全仓与 selftest 由 PM 收口。