# TASK-T18-04 · M11 AI 集成（4/4 收尾）：AI 属性列（数据库列类型）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T18-03 已交付（HEAD `02745b6`，开工 `git log -1` 确认）
> 依据：M11 职责第 3 项「AI 属性类型（数据库列）」；T18-01 服务面（`ai:*`）与 T18-03（prompts/面板）已就绪。
> 纪律：不碰 git；禁占位符/TODO；CSS 只吃 `var(--sc-*)`；不改既有测试断言语义（只许追加）；不要跑全仓 `pnpm -r test` 与 selftest（PM 收口）。
> 红线（零改动）：`packages/sync`、`packages/core`、`apps/desktop/src/main/**`、`preload`、`window.d.ts`、`shared/ipc.ts`、`shared/ai.ts`、`shared/settings.ts`、`shared/aiPrompts.ts`、`settings/AiSection.*`、`ai/AiActionPanel.*`（**不新增通道**：生成走既有 `ai.chat`，写入走既有 `db.recordUpdate`）。

## 0. PM 设计裁决（照此实现）

1. **新属性类型 `ai`**：加入 `FIELD_TYPES` 与 `NEW_PROPERTY_TYPES`（属性菜单可见）；`propertySchema` 增**可选**配置 `ai: z.object({ prompt: z.string() }).optional()`（可选 = 旧数据/旧 op 零迁移）。
2. **值语义 = 纯字符串**（与 `text` 同构：复用 `encodeValue/decodeValue`、CSV 导出、聚合、同步投影；生成元数据不写入值，避免污染 op/投影）。
3. **生成 = 手动触发，两条路径**：① 单元格行内「AI 生成」（单行）；② 列头菜单「批量生成」（**当前视图前 ≤20 行** + 确认弹窗显示条数；串行逐行、失败行跳过并汇总计数）。**无自动生成、无定时**（成本护栏）。
4. **上下文构造（固定格式）**：`messages = [{role:'system', content: property.ai.prompt || 默认指令}, {role:'user', content: 该记录逐列 '列名：值' 换行拼接（跳过空值、跳过 AI 列自身、跳过 relation 只给标题）}]`；provider = `ai.state()` 的 `activeProviderId ?? providers[0].id`；`!enabled`/无 provider → 行内提示引导（不开工、不写值）。
5. **写入 = `db.recordUpdate({pageId, recordId, patch:{[pid]: text}})`** → op 落库/可同步/可撤销；AI 列也允许**手工编辑**（与 text 一致）。
6. **批量确认文案**明示条数与「将调用 N 次模型」。
7. 列头渲染：AI 列显示文本 + hover 出现「✨/AI」生成按钮（`Icon` 走 `@septcats/ui`）；生成中该单元格 spinner，且该行按钮禁用。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/dbview/src/types.ts` | `FIELD_TYPES` / `NEW_PROPERTY_TYPES` 增 `'ai'`；`propertySchema` 增可选 `ai:{prompt}`；更新注释（`ai` = 手动触发的模型生成列） |
| `packages/dbview/src/react/PropBar.tsx` | 类型中文名 `ai: 'AI'`（或「AI 生成」）；列头菜单加「批量生成」入口（仅 ai 列） |
| `packages/dbview/src/react/CellEditor.tsx` | `ai` 单元格：文本展示 + 生成按钮（hover/聚焦可见）+ busy 态 |
| `packages/dbview/src/react/DbView.tsx` | 传参接线：`onAiGenerate?(pid, recordId) => Promise<void>`、`onAiBatchGenerate?(pid) => Promise<{done:number;failed:number}>`（受控回调，dbview 不 import electron/不直接调 window.septcats） |
| `apps/desktop/src/renderer/src/db/DbPage.tsx`（或 `useDbPage.ts` 同域） | 装配上述回调：`ai.state()` 门控 → `ai.chat`（system=prompt，user=逐列上下文）→ `db.recordUpdate`；批量串行 + 确认弹窗；空态/错误行内反馈 |
| `packages/dbview/test/*.test.ts`（追加） | 新类型：schema 接受 `'ai'`+`ai.prompt`；`'claude'` 仍拒；值往返（字符串）；`NEW_PROPERTY_TYPES` 含 `'ai'` |
| `apps/desktop/test/dbview-ai.test.tsx`（新建）或既有 dbview react 测试追加 | 假桥（`ai.state`/`ai.chat`/`db.recordUpdate` spy）：单行生成 → chat 收到 system=prompt、user 含其它列值 → recordUpdate 被调含生成文本；未启用 → 不调 chat 且出引导；批量 → 确认弹窗 + 串行 N 次 + 失败计数 |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `db.ai.*` 段（§2.3 全文） |
| `packages/dbview/src/react/DbView.css`（或相应 css） | 新类 token-only（生成按钮/busy/行内提示） |
| `docs/mockups/cdp-e2e-ai.mjs`（追加一节） | 离线层：建库→加 AI 列→配 prompt→单行生成（mock 服务）→断言单元格值变化 + pageerror 0；真机层（`SEPTCATS_AI_REAL=1`）跑同一流程（PM 执行） |
| `docs/tasks/TASK-T18-04-report.md`（新建） | 交付表/裁决消费/自跑输出/DEVIATIONS（PM 复跑节留「（PM 补）」） |

## 2. 分步规格

### 2.1 数据层（packages/dbview）
- `FIELD_TYPES` 末尾加 `'ai'`；`NEW_PROPERTY_TYPES` 末尾加 `'ai'`（菜单可见）。
- `propertySchema`：`ai: z.object({ prompt: z.string() }).optional()`。
- 值：无需改 `values.ts`（AI 值即字符串，`text` 路径已覆盖）；**但要补一条测试**证明 `encodeValue/decodeValue` 对 AI 列值与 text 同路（避免将来误加对象类型）。
- 聚合/CSV：无需特判（按 text 处理）；CSV 导出不因新类型报错——补一条测试。

### 2.2 UI（dbview react，受控）
- `PropBar`：`TYPE_LABELS.ai = 'AI'`；列头菜单新增「批量生成」项（仅 `type==='ai'`，点击走 `onAiBatchGenerate`）。
- `CellEditor`：`ai` 分支 = 只读文本 + 生成按钮（`Icon` + `aria-label='AI 生成'`）+ busy（`Button loading` 或 spinner token）。手工编辑复用 text 编辑器（双击进入）。
- `DbView`：把两个可选回调透传到 `CellEditor`/`PropBar`；未提供回调时按钮不渲染（库侧保持纯净）。
- 列配置（属性设置弹窗，若有）里 `ai` 类型的配置项：`prompt` 文本域（`aria-label='生成指令'`）；无弹窗就在列头菜单里加「编辑生成指令」小面板（CB 按现有属性编辑路径就近实现，报告说明选择）。

### 2.3 i18n 全文（`db` 段追加 `ai` 子段）
```ts
    ai: {
      typeLabel: 'AI',
      generate: 'AI 生成',
      generating: '生成中…',
      batch: '批量生成',
      batchConfirmTitle: '批量生成',
      batchConfirmBody: '将对当前视图前 {n} 条记录调用模型（每条约 1 次请求）。继续？',
      batchConfirm: '开始生成',
      batchResult: '完成 {done} 条，失败 {failed} 条',
      needEnable: 'AI 未启用（设置 → AI 助手）',
      needProvider: '未配置模型服务（设置 → AI 助手）',
      needPrompt: '请先为该列填写生成指令',
      promptLabel: '生成指令',
      promptPlaceholder: '例如：用一句话概括本行内容',
      defaultPrompt: '根据该记录各列的内容，用简洁的中文给出这一列的值；只输出结果本身。',
      failed: '生成失败：{msg}',
    },
```

## 3. 测试（自跑，逐文件落盘即跑）
- `packages/dbview/test/`：schema/类型白名单/值往返/CSV 不炸（追加，既有断言不动）。
- `apps/desktop/test/`：dbview AI 桥流程（§1 表内说明）；含**失败行跳过**与**未启用不调 chat**两条硬断言（隐私/成本不变量）。
- 命令：`pnpm -C packages/dbview test`、`cd apps/desktop && npx vitest run test/dbview-ai.test.tsx test/dbview.test.ts`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`。

## 4. DoD（PM 复跑）
```bash
pnpm -r typecheck && pnpm -r test && node packages/ui/tokens/no-magic.mjs && pnpm -C apps/desktop selftest
```
+ 红线核验（§头 列表 diff 为空）。
+ PM 真机/离线 CDP：`node docs/mockups/cdp-e2e-ai.mjs`（离线层含新节）与 `SEPTCATS_AI_REAL=1 …`（PM 跑，报告记原文）。
+ **注意 ABI**：跑打包/真机前若执行过 `pnpm dist`，跑测试前先 `node apps/desktop/scripts/ensure-abi.mjs node`（否则 DB 类测试会被静默 skip）。

## 5. 纪律与收尾
不碰 git；不新增依赖；不改既有测试断言语义；CSS token-only；每改一组自跑对应测试。收尾回复：改动文件清单 + 每条命令最后一次输出摘要（含计数对账）+ 报告落盘。