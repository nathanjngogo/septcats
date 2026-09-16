# TASK-T18-04 · 报告：M11 AI 集成 4/4 收尾 —— AI 属性列（数据库列类型）

> 工程师：CodeBuddy ｜ PM：Hermes ｜ 日期：2026-09-17 ｜ 前置 HEAD `02745b6`（T18-03，开工 `git log -1` 已确认）
> 红线遵守：`packages/sync`、`packages/core`、`preload`、`window.d.ts`、`shared/ipc.ts`、`shared/ai.ts`、`shared/settings.ts`、`settings/AiSection.*`、`ai/AiActionPanel.*` **零 diff**（`git status --porcelain` 核验，见 §5）；**不碰 git**（全程未 add/commit）；不新增依赖；CSS 全部 `var(--sc-*)` token（no-magic ✓）；无占位符/TODO；未跑全仓 `pnpm -r test` 与 selftest（PM 收口）。
> ⚠ **`apps/desktop/src/main/dbview.ts` 有 1 处最小使能改动，见 DEVIATION-1**（任务书将其列红线，但不改则交付物不可达成，工程上无法两全）。

## 1. 交付表

| 文件 | 内容 |
|---|---|
| `packages/dbview/src/types.ts` | `FIELD_TYPES` 末尾增 `'ai'`；`NEW_PROPERTY_TYPES` 增 `'ai'`（新属性菜单 8→9 种）；`propertySchema` 增可选 `ai: z.object({ prompt: z.string() }).optional()`（旧数据/旧 op 零迁移）；`VALUE_SCHEMA_BY_TYPE.ai = textValue`（值 = 纯字符串，与 text 同构）；头注释更新 |
| `packages/dbview/src/values.ts` | `formatValue` 增 `case 'ai'` 与 text 同路（truncate 40 码点 + 空值「—」）；recordTitle 兜底序天然兼容 |
| `packages/dbview/src/react/PropBar.tsx` | `FIELD_TYPE_LABEL.ai = 'AI'`；`FILTER_KINDS_BY_TYPE.ai` = text 同款四算子；属性管理菜单对 **ai 列**追加「批量生成」（`onAiBatchGenerate?(pid)`，行集由 DbView 决定）与「编辑生成指令」（`onUpdateAiPrompt?(pid, prompt)`）两项（**仅提供回调时渲染**）；新增 prompt 小面板（textarea `aria-label='生成指令'`，Enter 保存 / Esc 取消，复用 rename 面板样式类） |
| `packages/dbview/src/react/CellEditor.tsx` | `ai` 分支：非编辑态 = 文本展示 + 「AI 生成」按钮（`Icon(Sparkle)` + `aria-label='AI 生成'` + `aria-busy`，busy 时 disabled + `Spinner`；`onAiGenerate` 未提供则按钮不渲染）；编辑态复用 `PlainEditor`（手工编辑与 text 一致，§0.5）；hover/focus 显按钮（CSS opacity） |
| `packages/dbview/src/react/TableGrid.tsx` | 透传 `aiBusyRecordIds`（按行禁用按钮 + spinner）与 `onAiGenerateCell(recordId, pid)` |
| `packages/dbview/src/react/DbView.tsx` | 受控接线（不 import electron / 不碰 window.septcats）：新 props `onAiGenerate?(pid, recordId): Promise<void>`、`onAiBatchGenerate?(pid, recordIds): Promise<{done,failed}>`、`onUpdateAiPrompt?(pid, prompt)`；DbView 内部维护 **busy id 集**（ref 防重入，设备本地瞬时态不落 Op）；批量入口 = 当前视图前 **≤20 行** id 切片后上抛 |
| `packages/dbview/src/react/DbView.css` | 新增 `.sc-dbc-aibtn`（hover/focus 显隐、busy 禁用态）与 `.sc-propbar__prompt`/-`_hint`；全 `var(--sc-*)` |
| `packages/ui/src/Icon.tsx` | 单族出口追加 re-export `Sparkle`（生成按钮图标；packages/ui 非红线，1 行） |
| `apps/desktop/src/main/dbview.ts` | **DEVIATION-1 最小使能**（3 处，详见 §3）：① `FIELD_TYPE_SET` 增 `'ai'`（否则 `propAdd('ai')` → E_MALFORMED，CDP「加 AI 列」死）；② `PROPERTY_DEFAULT_NAME` 增 `ai: 'AI'`（`Record<FieldType,string>` 完备性，**typecheck 硬必需**）；③ `propUpdate` patch 增 `ai?: { prompt: string }`（IPC zod schema + handler + service 类型 + 实现合并 `ai: patch.ai ?? property.ai`，仍不新增通道） |
| `apps/desktop/src/renderer/src/db/useDbPage.ts` | 新增 `updatePropertyPrompt(pid, prompt)` → `db.propUpdate({patch:{ai:{prompt}}})`（window.d.ts 红线零改动，d.ts 未声明 ai 键 → `as unknown as` 最小断言收敛，注释写明） |
| `apps/desktop/src/renderer/src/db/DbPage.tsx` | §0.3–§0.7 装配：`ai.state()` 三态门控（`!enabled`→needEnable；无 provider 或**云端未设密钥（hasKey 语义）**→needProvider；门控不过 = 行内引导、不开工、不调 chat）→ `ai.chat`（system = 列 `ai.prompt` ‖ 默认指令（§0.4 逐字）；user = 逐列「列名：值」换行拼接，跳过空值/AI 列自身/无候选标题的 relation）→ `db.recordUpdate` 写值（trim 后，op 落库可撤销）；批量 = 先门控后**确认弹窗**（`Dialog`，正文明示条数与「每条约 1 次请求」）→ 串行逐行、失败行 try/catch 跳过 → `pushToast` 结果计数；单行失败 → 行内 `role="status"` 引导（`db.ai.failed` 原文）；`onUpdateAiPrompt` → `updatePropertyPrompt` |
| `apps/desktop/src/renderer/src/db/DbPage.css` | `.dbpage__ai-notice`（行内引导条）+ `.dbpage__ai-dialog-body`；token-only |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | §2.3 全文照抄：顶层新增 `db` 段 → `db.ai` 子段（17 键逐字）；插值 `{n}/{done}/{failed}/{msg}` 走 `.replace()`（SyncStatus 先例） |
| `packages/dbview/test/types.test.ts`（追加） | 既有断言 2 处字面量随白名单扩展（见 DEVIATION-2）；新增 describe「AI 属性列」3 用例：schema 接受 `type:'ai'`+可选 `ai.prompt`（旧形状零迁移）、`'claude'` 仍拒 / `ai.prompt` 非串拒、ai 值 isValidValue/coerceValue |
| `packages/dbview/test/values.test.ts`（追加） | 新 describe 3 用例：encode/decode 往返与 text 同路（含引号/换行/emoji/长串）、formatValue text 路径（截断/空值）、recordTitle 不被 ai 列抢标题位 |
| `packages/dbview/test/csv.test.ts`（追加） | 新 describe 1 用例：ai 值按 text 序列化 + `formatValue→escapeCsvField→toCsv→parseCsv` 往返不炸 |
| `packages/dbview/test/react.test.tsx`（追加） | 新增 3 describe 7 用例：CellEditor（按钮/回调/busy 禁用 + 无回调不渲染 + 手工编辑）、PropBar（ai 列菜单两项 + prompt 面板往返 + text 列无 AI 入口）、DbView（透传参数序、批量 ≤20 行切片、无回调零渲染） |
| `apps/desktop/test/dbview-ai.test.tsx`（新建） | 假桥（`vi.stubGlobal septcats`：ai.state/ai.chat/db.recordUpdate/db.propUpdate spy）直挂 DbPage，8 用例：单行生成（chat 收 system=列指令 + user=「书名：…\n备注：…」逐字断言、recordUpdate 收 trim 后文本）、默认指令回落、**未启用不调 chat 且出 needEnable 引导**（硬断言）、**hasKey 语义**（云端未设密钥→视同未配置不调 chat）、chat 失败行内引导不写值、批量确认弹窗明示条数 + 串行 + **失败行跳过计数 toast「完成 1 条，失败 1 条」**（硬断言）、未启用批量连弹窗都不出、指令提交 → propUpdate 收 `ai:{prompt}` |
| `docs/mockups/cdp-e2e-ai.mjs`（追加） | 「AI 属性」节（离线/真机层共用同一流程）：恢复 provider 配置 → 「转为数据库」建库（DbPage 挂载）→ UI 建 2 记录 + 改标题 → 「新属性」菜单加 AI 列（真 UI 全链路 + hook 自动重载，免 reload）→ 列头菜单「编辑生成指令」配 prompt → 单行「AI 生成」→ 断言单元格值（离线 = MOCK_TEXT、真机非空）→ IPC 读回断言 `schema.ai.prompt` 持久化 + `record.values[aiPid]` 落库 |
| `docs/tasks/TASK-T18-04-report.md`（本文件） | 交付表/裁决消费/DEVIATIONS/自跑输出 |

测试增量：dbview **79 → 93（+14）**；desktop 新建 dbview-ai **+8**；合计 **+22**。

## 2. 裁决消费（§0 逐条）

1. `ai` 入 `FIELD_TYPES`+`NEW_PROPERTY_TYPES` ✓；`propertySchema.ai` 可选 ✓（旧数据零迁移，测试覆盖）。
2. 值 = 纯字符串 ✓（`VALUE_SCHEMA_BY_TYPE.ai = textValue`；formatValue/CSV/聚合/同步投影全走 text 路径，无特判；往返 + CSV 测试锁定）。
3. 手动触发两路径 ✓：单元格行内生成 + 列头「批量生成」（当前视图前 ≤20 行 + 确认弹窗明示条数；串行逐行、失败跳过计数）；无自动/定时生成 ✓。
4. 上下文固定格式 ✓：`system = property.ai.prompt ‖ 默认指令`（§2.3 `defaultPrompt` 逐字）；`user` = 逐列「列名：值」换行拼接，跳过空值/AI 列自身/relation 只给标题（DbPage 未注入 relationCandidates → 无候选标题时该列整列跳过，见 SSIM-NOTE-2）；provider = `activeProviderId ?? providers[0].id`；`!enabled`/无 provider → 行内引导不开工 ✓。
5. 写入 = `db.recordUpdate({pageId, recordId, patch:{[pid]: text}})` ✓；AI 列允许手工编辑（PlainEditor 复用）✓。
6. 批量确认文案明示条数与调用次数 ✓（`batchConfirmBody` + `{n}`）。
7. 列头/单元格渲染 ✓：AI 列 hover/聚焦显「✨(Sparkle)」生成按钮；生成中该单元格 spinner、按钮禁用（`aiBusyRecordIds` 按行）。

## 3. SSIM-NOTE / DEVIATIONS

- **DEVIATION-1（`apps/desktop/src/main/dbview.ts` 3 处最小使能，突破红线字面）**：任务书红线列 `main/**` 零改动，但三者叠加导致不可能：① `PROPERTY_DEFAULT_NAME: Readonly<Record<FieldType, string>>` 在 `FieldType` 增 `'ai'` 后**缺键必报 TS2741**——「typecheck 0 错」这条硬完成标准与红线二选一；② main 自维护的 `FIELD_TYPE_SET` 不含 `'ai'` 时 `propAdd('ai')` 抛 E_MALFORMED，交付物 §1 的 CDP 流程「加 AI 列」第一步即死；③ main 的 propUpdate zod schema/handler 只收 `name/type`，`ai.prompt` 会被静默剥除，「配 prompt」无法持久化。处理：仅动 `main/dbview.ts` 单文件三处（`FIELD_TYPE_SET` + `'ai'`；`PROPERTY_DEFAULT_NAME` + `ai:'AI'`；propUpdate patch 放行 `ai:{prompt}` 并合并进 `nextProperty`），**不新增通道**（仍是 `db:propAdd`/`db:propUpdate` 既有两通道），`shared/ipc.ts`、`preload`、`window.d.ts` 全部零 diff；渲染器侧以 `as unknown as` 收敛 d.ts 缺键（useDbPage 内注释说明）。请 PM 裁决追认或另行收敛（如后续任务把 d.ts/通道正式扩型）。
- **DEVIATION-2（既有断言字面量 3 处随白名单扩展更新，语义未变）**：`types.test.ts` 的 `FIELD_TYPES` 精确列表断言（10→11 项）与 `NEW_PROPERTY_TYPES` 长度（8→9）；`react.test.tsx`「新属性菜单」项数与文案清单（8→9 + `'AI'`）。均为「白名单恰好等于清单」型计数断言，扩白名单后必然碰撞（T18-03 DEVIATION-1 同族）；无一处删除或弱化，仅扩展字面量 + 加注释。
- **SSIM-NOTE-1（批量回调签名加 `recordIds` 参数）**：任务书 §1 写 `onAiBatchGenerate?(pid) => Promise<{done,failed}>`，但「当前视图」与「前 ≤20 行切片」只有 DbView 知道（activeVid/筛选是 DbView 内部态），app 侧无法复算。实现为 `onAiBatchGenerate?(pid, recordIds)`：DbView 负责行集（≤20），app 负责确认弹窗/串行/写值/计数，两侧职责与任务书意图一致。PropBar→DbView 一段仍是 `(pid)` 单参。
- **SSIM-NOTE-2（relation 列上下文）**：DbPage 未注入 relationCandidates（现装配面本就没有），无候选标题可解时 relation 列在 user 上下文中整列跳过（`relationTitle: () => null` → formatValue 回「—」→ 按空值跳过）；文本/数字/日期/选项列不受影响，测试断言逐字锁定。
- **SSIM-NOTE-3（`needPrompt` 键的消费位置）**：§0.4 裁决「`property.ai.prompt ‖ 默认指令`」使生成路径**不需要**拦截未配指令；`needPrompt` 按 §2.3 全文落 i18n，当前生成主流程未消费（留作后续引导位），prompt 面板内以 dbview 侧固定文案「留空则使用默认指令」承接同一语义。
- **SSIM-NOTE-4（CDP 建库路径）**：侧栏树为演示 chrome（无真实页面导航），「AI 属性」节用「转为数据库」按钮建库（即 UI 建库真路径）；列配置/记录全走 UI（自带 hook 重载），免 reload 断言窗口；持久化用 `search.query`（collection 命中）拿 pageId 后 IPC 直读。
- **SSIM-NOTE-5（生成按钮图标）**：`@septcats/ui` 单族图标出口无 Sparkle，按「✨/AI」裁决在 `packages/ui/src/Icon.tsx` 追加 1 行 `Sparkle` re-export（phosphor 同族；packages/ui 非红线）。

## 4. 验证（每条命令最后一次输出）

| 命令 | 结果摘要 |
|---|---|
| `pnpm -C packages/dbview test` | `Test Files 5 passed (5) / Tests 93 passed (93)`（基线 79 + 14） |
| `cd apps/desktop && npx vitest run test/dbview-ai.test.tsx test/dbview.test.ts` | `Test Files 2 passed (2) / Tests 17 passed (17)`（dbview-ai 新 8 + dbview 既有 9） |
| `cd apps/desktop && npx vitest run test/dbview-ai.test.tsx test/dbview.test.ts test/i18n.test.ts` | `Test Files 3 passed (3) / Tests 20 passed (20)` |
| `pnpm -r typecheck` | 9 包全 Done（db/editor/sync/schema/dbview/importer/ui… + `apps/desktop typecheck: Done`），0 错 |
| `node packages/ui/tokens/no-magic.mjs` | `✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px` |
| 测试计数对账 | dbview：react 19→26（+7）、types 12→15（+3）、values 14→17（+3）、csv 13→14（+1）、view 21 不变 = **+14**；desktop：dbview-ai 新建 **+8**；合计 **+22**（`git show HEAD:` 逐文件 `it(` 计数核对） |

## 5. 红线核验

```
git diff --stat -- packages/sync packages/core apps/desktop/src/preload \
  apps/desktop/src/types/window.d.ts apps/desktop/src/shared/ipc.ts \
  apps/desktop/src/shared/ai.ts apps/desktop/src/shared/settings.ts \
  apps/desktop/src/renderer/src/settings apps/desktop/src/renderer/src/ai
```
→ **空输出**（零改动）。`git status --porcelain` 全量：`M packages/dbview/{types,values}.ts、react/{PropBar,CellEditor,TableGrid,DbView}.tsx、react/DbView.css、test/{types,values,csv,react}`；`M packages/ui/src/Icon.tsx`（+Sparkle）；`M apps/desktop/src/main/dbview.ts`（**DEVIATION-1**）；`M apps/desktop/src/renderer/src/{db/DbPage.tsx,db/useDbPage.ts,db/DbPage.css,i18n/zh-CN.ts}`；`M docs/mockups/cdp-e2e-ai.mjs`；新增 `apps/desktop/test/dbview-ai.test.tsx`、本报告。未新增依赖；无占位符/TODO；未跑全仓 `pnpm -r test` 与 selftest（PM 收口）。

## 6. PM 复跑（PM 补）

（PM 手跑，2026-09-17；全部为 PM 实测，非工程师转述）

**静态 / 测试门禁**
- `packages/dbview` **93/93**（79→93 = +14）；`apps/desktop` 新建 dbview-ai **8/8**；全仓 `pnpm -r test`：sync 83 / editor 144 / dbview 93 / importer 59 / desktop **301**（+8）。
- 唯一红 = **既知 perf 环境敏感用例**（`commitOps batch P95 ≤16ms`）——隔离复跑 3× 得 **13.2 / 13.4 / 13.2 ms**（预算 16ms）全绿 → 瞬态机器态（全仓并行 + LM Studio 35B 模型常驻），非回归。
- `pnpm -r typecheck` 9/9 Done；`node packages/ui/tokens/no-magic.mjs` ✓；`pnpm -C apps/desktop selftest` SELFTEST OK。
- 计数对账：与报告一致（+14 / +8 = +22）；`git show HEAD:` 逐文件 `it(` 计数核对无误。

**PM 裁决 / 亲修**
1. **接受 DEVIATION-1**（`main/dbview.ts` 5 点最小使能）：新字段类型在 main 侧的完备性（`Readonly<Record<FieldType>>`）、类型白名单（`FIELD_TYPE_SET`）、propUpdate 的 zod 与 `ai` 合并，均为**必要件**且**无新增通道**；红线写法过宽是任务书问题，教训已记（新增字段类型须显式许可 `main/dbview.ts`）。
2. **收类型债**：删除 `useDbPage` 的 `as unknown as` 断言，改为在 `apps/desktop/src/types/window.d.ts` 的 `propUpdate.patch` 正式声明 `ai?: { prompt: string } | undefined`（纯类型声明，零行为变化）。
3. DEVIATION-2（3 处白名单计数断言语义不变、仅扩字面量 + 注释）接受，属 T18-03 同族。

**真机 / 离线 CDP（PM 跑；T18-03 节 + 新增「AI 属性」节）**
- 前置：`pnpm -C apps/desktop dist` 重打包 + **asar 型号实证**（`批量生成` / `编辑生成指令` / `db.ai.batchConfirmTitle` / `生成指令` 均在包内）。
- 离线层 **15/16**、真机层 **20/21**：AI 属性全链实证 —— 转为数据库 → UI 加 AI 列（`propAdd ai`）→ 配置生成指令（`propUpdate ai.prompt` 读回持久化 ✓）→ 单行「AI 生成」→ 单元格出现结果（离线 = mock 文案；真机 = **LM Studio qwen3.6-35b-a3b-mtp 真生成**）→ `record.values[aiPid]` 落库 ✓ → pageerror 0。
- **唯一恒红 = 既有缺陷 T18-04-1（记录标题「双击改名」不生效），非本轮引入**：PM 探针实证（文档级捕获见真实双击的原生 `dblclick` 到达 `SPAN.sc-dbcell__title`、mousedown detail [1,2]；MutationObserver 全程未见 `input[aria-label="编辑标题"]`；标题保持「未命名」）；全应用仅 `TableGrid.tsx:147` 一处 dblclick 处理器、无全局拦截，且该路径**无任何单测/CDP 覆盖**。已开 **TASK-T18-05**（修复 + 回归测试 + CDP 复验）；本检查在脚本中保留可见并标注。
- CDP 脚本自身的 **5 处缺陷由 PM 亲修**（全属「流程态/时序未等待」家族，与缺陷账 #27/#31 同族）：① 上一节停在设置页、未回页面视图；② `renameTitle` 同步取输入框（React 需一帧）；③ 建记录后未等行渲染（`no-cell`）；④ 合成 `MouseEvent('dblclick')` 不触发 React `onDoubleClick`（改真实 `page.mouse.dblclick` + `locator.fill`）；⑤ 断言缺诊断明细（现输出 `r1/r2/titles` 与面板错误原文）。

**验收结论**：T18-04（AI 属性列）交付成立，**M11 四项全部交付**；「生成 → 写值」全链真机实证，隐私与成本门控（未启用不调 chat、批量确认弹窗）由单测硬断言锁定。除 T18-04-1（既有缺陷，另开 TASK-T18-05）外无遗留红。
