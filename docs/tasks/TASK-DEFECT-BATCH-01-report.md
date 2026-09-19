# TASK-DEFECT-BATCH-01 · 三缺陷批次清理——交付报告

> 执行：CodeBuddy ｜ 基线：HEAD d27fa65（rc.19，工作树干净）｜ 日期：2026-09-20
>
> **结论速览**：缺陷 1（T42-01-1）✅ 已修；缺陷 2（T43-01-1）✅ 已修；缺陷 3（T40-01-1）✅ **已修（§7，PM 裁决后执行）**。全量自跑 578/578 全绿 + packages/dbview 98/98 全绿。

---

## 0. 改动文件清单

| 文件 | 改动 | 所属缺陷 |
|------|------|---------|
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | 新增 `rendersEditor` 判定（与渲染分派同构）；协作接入门控补该判定；新增分派到 wiki/database 时清残留编辑器实例的 effect | 缺陷 1 |
| `apps/desktop/src/renderer/src/i18n/index.ts` | 新增 `readLocalePrefRaw()`（区分「无标记」与「显式 'system'」）；`setLocalePref` 显式选择改为**写所选 locale 标记**（原为删标记）；`initLocale` 仅显式 'system' 才走系统语言，无标记时优先 `storedLocale` | 缺陷 2 |
| `apps/desktop/src/renderer/src/main.tsx` | 仅文件头注释口径同步（locale 种子语义） | 缺陷 2 |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | 仅 handleLanguage 注释口径同步 | 缺陷 2 |
| `apps/desktop/test/wiki-ui.test.tsx` | 新增 describe「协作层接入承载门控（T42-01-1）」2 用例 | 缺陷 1 |
| `apps/desktop/test/i18n.test.ts` | 新增 describe「initLocale 启动组合（T43-01-1）」6 用例（PM 四组合 + setLocalePref 写标记 + settings 未就绪兜底） | 缺陷 2 |

`packages/**` 在缺陷 1、2 执行时零改动（缺陷 3 当时停手，见 §3）；缺陷 3 已按 PM 裁决于 §7 补改 3 个文件（严格限定清单内）。

---

## §1 缺陷 1：T42-01-1（P2）wiki 页误接协作层

### 症状

Wiki 落地页 →「新建子页」→ 返回落地页，稳定复现 2 条 console 错误（pageId = wiki 页自身）：
`[YjsEditor] Y→PM 初始投影失败 … topNodeType` + `[PageView] 协作层接入失败 … y-sync$`。

### 根因（与 PM 定位一致，补充时序细节）

`PageView.tsx` 协作接入 useEffect 的门控只有 `editor !== null && activePageId !== null`。返回 wiki 页那一帧：

1. `Editor` 子组件卸载，其清理函数调 `onReady(null)` → `setEditor(null)` **调度**重渲染；
2. 但**本次 commit** 的 effect body 仍以旧 state（残留编辑器实例）运行，`activePageId` 已是 wiki 页 id → `attachCollab(wikiPageId, 残留编辑器)` 被发起；
3. 残留实例此前已 attach 过一次（子页），新 `YjsEditor` 再 attach 同一 PM 实例 → y-sync$ keyed 插件重复注册（RangeError）；wiki 页 Y.Doc 投影 → topNodeType 空（TypeError）。

### 修法

`PageView.tsx`：

1. 新增 `rendersEditor` 布尔（与渲染分派**严格同构**：非 database、非 wiki、非 dbPageId 兜底、activePage 非空）；
2. 协作接入 effect 门控补 `!rendersEditor` 直接 return（依赖数组同步加 `rendersEditor`）；
3. 新增 effect：`!rendersEditor && editor !== null` → `setEditor(null)`，分派到 WikiLanding/DbPage 时显式清掉残留实例（PM 给的「更优」方向，同时消除选中同步/AI 桥消费残留实例的隐患）。

### 自跑数值（复现原缺陷的回归测试）

`apps/desktop/test/wiki-ui.test.tsx` 新增 2 用例。**红检**（临时还原缺陷行为）实跑证据：

```
× 协作层接入承载门控（T42-01-1）> 普通页 → wiki 页：…不得用残留编辑器给 wiki 页接协作层
  → expected "spy" to not be called with arguments: [ { pageId: 'pg-wiki' } ]
```

即：缺陷行为下 `collab.attach` 确实收到 `{pageId:'pg-wiki'}`（复现）；修复后：

```
✓ test/wiki-ui.test.tsx (9 tests) 234ms   （含新增 2 用例）
```

- 第二用例：database 页同构断言 `collab.attach` 零调用。
- reload 后 console 错误数 = 0 的真机复核：**（PM 补）**。

### 新 DEVIATION

无。database 页从「静默误 attach 协作」变为「不 attach」——协作层本就只服务 blocks 页（DbPage 走记录通道，不消费 Y.Doc），此为缺陷修复的自然边界，不认为构成 DEVIATION，如 PM 判需立账请指正。

---

## §2 缺陷 2：T43-01-1（P2）显式选 English 重启后回中文

### 症状

中文系统上显式选 English → 重启 → 界面回中文（PM 组合 B）。

### 根因（与 PM 定位一致）

`i18n/index.ts`：`setLocalePref('en-US')` 显式选择时**删掉** localePref 标记；`initLocale` 把「无标记」等同于「显式跟随系统」，直接 `setLocale(systemLocale())` 并提前 return，从不读 `settings.locale` → 显式选择重启即丢。

### 修法

`i18n/index.ts`：

1. 新增内部 `readLocalePrefRaw()`：返回 `'system' | Locale | null`，**null = 无标记**；
2. `setLocalePref`：显式选择 zh-CN/en-US 改为**把标记写成所选 locale**（原来是 removeItem）；'system' 照旧写 `'system'`；
3. `initLocale`：仅 `readLocalePrefRaw() === 'system'` 才走系统语言；无标记与显式 locale 标记都优先 `storedLocale`（settings.locale）；`storedLocale` 为空（settings 未就绪 catch 分支）才回系统语言。

四组合行为逐一对表：

| 组合 | 标记 | settings.locale | 修后路径 | 结果 |
|------|------|-----------------|----------|------|
| A | 无 | zh-CN | 无标记 → storedLocale | zh-CN（不变） |
| B | 无 | en-US | 无标记 → storedLocale | **en-US（转绿）** |
| C | en-US | en-US | 标记非 system → storedLocale | en-US（不变） |
| D | system | en-US | 标记 = system → systemLocale() | zh-CN（不变） |

连带口径：`getLocalePref()` 对外契约不变（无标记仍返回 'system'）；`SettingsPage.tsx:356` 的 `getLocalePref() === 'system' ? 'system' : settings.locale` 显值逻辑经核对不受影响。**localStorage 旧数据兼容**：既有用户若曾显式选 en-US（旧代码删标记、settings.locale=en-US），修后无标记路径读 settings.locale → 恰好恢复其显式选择；曾选「跟随系统」的用户标记='system' 保留 → 行为不变。

### 自跑数值（复现原缺陷的回归测试）

`apps/desktop/test/i18n.test.ts` 新增 6 用例（组合 B/A 钉 `navigator.language='zh-CN'` 复现真机中文系统）。**红检**实跑证据：

```
× initLocale 启动组合（T43-01-1）> 组合 B：无标记（zh 系统）+ settings.locale=en-US → en-US
  → expected 'zh-CN' to be 'en-US' // Object.is equality
```

修复后该文件 18/18 全绿（含组合 A/C/D 保持用例）。PM 探针 `docs/mockups/cdp-e2e-i18n-locale-pm.mjs` 组合 B 复跑：**（PM 补）**（任务书要求探针不改，属考卷）。

### 新 DEVIATION

无显式偏差；两处**注释口径**（main.tsx 文件头、SettingsPage handleLanguage）随行为同步更新，仅注释非逻辑。

---

## §3 缺陷 3：T40-01-1（P2）勾选列的值界面写不进去 —— ⛔ 红线停手，待 PM 裁决

### 停手原因

根因文件经核实为 `packages/dbview/src/react/TableGrid.tsx` 与 `packages/dbview/src/react/CellEditor.tsx`，落在任务书红线「**不碰 `packages/**`**（若确需，先停下来在报告里写清楚，等 PM 裁决）」覆盖面内。本节按红线要求写清拟议修法，**未改任何 packages 代码、未跑 packages 测试**，等 PM 裁决后执行（裁决通过可当场按 §3.3 施修 + 补测，预计一轮内完成）。

### 3.1 症状 / 根因（与 PM 定位一致，行号按当前 HEAD 核实）

- `CellEditor.tsx:655-670`：内层根元素 `.sc-dbc` 为 `role="presentation"`、**无 tabIndex**；`onCellKeyDown`（619-635 行，checkbox 的 Enter/Space → `onCommit(value === true ? null : true)`）挂在它上面，永不获焦；
- `TableGrid.tsx:526-527`：`cellRefs` 注册在外层 `role="gridcell"`（`tabIndex={focused ? 0 : -1}`），焦点只会落在外层；
- `TableGrid.tsx:331-358`：`onGridKeyDown` 只处理四个方向键，**无 Enter/Space 分支**；
- `CellEditor.tsx:661-668`：onClick 对 checkbox **提前 return**（662 行 `disabled || type === 'checkbox' || type === 'file'`），不进编辑态也不切换。

⇒ 点击与键盘两条路径都断了，勾选值无法经界面写入。

### 3.2 拟议修法（推荐：键处理上收 TableGrid + 点击改直切，非 checkbox 类型零改动）

1. **`CellEditor.tsx:661-668` onClick**：checkbox 分支从「早退」改为「直接切换并 return」——`onCommit(value === true ? null : true)`；`file` 保持早退；其余类型保持 `onBeginEdit()` 原路径不变。
2. **`TableGrid.tsx:331-358` onGridKeyDown**：在既有 `editingCell !== null || focusedCell === null` 早退之后追加两个 case：`'Enter'` / `' '（Space）`——若 `focusedCell` 指向 checkbox 类型属性（非标题列），`preventDefault()` 后取该行当前值，经既有 `onChangeCell(row.id, pid, value === true ? null : true)` 提交；非 checkbox 格子的 Enter/Space **不加任何行为**（保持现状，Enter 进编辑态仍由 CellEditor 在编辑态内的自有链路收敛，不受影响）。

选这条而非「内层加 tabIndex + 焦点交过去」的原因：改动面最小（两处各一个分支）、不动焦点模型（T18-05 刚修过焦点抢夺闪退，动焦点链风险高）、与「值写入」验收（勾选设 true 存盘重开读回）直接对应——`onChangeCell` 通道即既有存盘通道。

### 3.3 裁决通过后的执行清单（预置，待批）

- 改动：上述 `packages/dbview/src/react/CellEditor.tsx`、`TableGrid.tsx` 两处；
- 补测：`packages/dbview/test/react.test.tsx` 新增 ≥2 用例——①点击 checkbox 格 → `onChangeCell(rowId, pid, true)`（空值→true）；②聚焦 checkbox 格按 Enter/Space → toggle（true→null、null→true），并断言 text 格按 Enter 仍走 `onBeginEdit`（非 checkbox 行为不变的红检）；
- 红检：临时还原后两用例应红（点击无反应 / Enter 无反应）；
- 真机验收（勾选设 true 存盘重开读回、reload console=0）：**（PM 补）**。

---

## §4 全量自跑（原始输出摘录，均实跑）

### §4.1 `pnpm -C apps/desktop test`

```
 Test Files  52 passed (52)
      Tests  578 passed (578)
   Start at  04:50:17
   Duration  27.82s (transform 3.04s, setup 0ms, collect 136.86s, tests 66.04s, environment 13.02s, prepare 7.25s)
```

（含新增 8 用例：wiki-ui +2、i18n +6；perf 硬指标用例全绿：rebuild 1509.0ms/预算 5000ms、冷打开 46.5ms/预算 800ms、commit P95 323ms）

### §4.2 `pnpm -r typecheck`

```
packages/dbview typecheck: Done
packages/editor typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done        （exit 0）
```

### §4.3 `node packages/ui/tokens/no-magic.mjs`

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### §4.4 `node packages/ui/tokens/build-tokens.mjs --check`

```
✓ token 产物与 DESIGN.md 一致
```

### §4.5 `pnpm -C apps/desktop build`

```
✓ 4893 modules transformed.
../../out/renderer/index.html                     1.04 kB
../../out/renderer/assets/index-CIAxeuoa.css    104.45 kB
../../out/renderer/assets/index-BF1HdCjI.js   1,921.31 kB
✓ built in 4.18s
```

（zod 注释 Rollup warning 为既有第三方噪音，非本次引入）

---

## §5 红线遵守核对

- `packages/**`：缺陷 1、2 执行时零改动；缺陷 3 按 PM 裁决（§7）改动且仅改动裁决清单内 3 文件；
- 无新增依赖；无占位符 / TODO；
- DESIGN.md / tokens / CI / 发布脚本：零改动；PM 既有探针（cdp-e2e-i18n-locale-pm.mjs 等）：零改动；
- git：零操作（无 commit/stash/checkout），改动全在工作树，交 PM。

## §6 剩余风险

1. ~~缺陷 3 未修（红线停手）~~ → 已按 §7 修复（PM 裁决通过后执行）；
2. 缺陷 1 的「reload 后 console 错误数 = 0」需 PM 真机复核（单测覆盖的是 attach 不再收到 wiki 页 id 这一因果断言）；
3. 缺陷 2 的 PM 探针组合 B 转绿需 PM 复跑（探针不改，属考卷）；
4. `rendersEditor` 与渲染分派为手工同构（两处表达式并列），后续若改分派需同步——已用注释锚定，未做抽象收敛（避免为一次性修复引入间接层）。

---

## §7 T40-01-1 修复执行（裁决后）

> PM 裁决通过 §3.2 拟议修法 + packages/dbview 例外（严格限定三文件）。本节为执行记录。执行日期：2026-09-20。

### 7.1 改动文件（严格限定在裁决清单内）

| 文件 | 改动 |
|------|------|
| `packages/dbview/src/react/CellEditor.tsx` | **仅** onClick 分支（原 661-668 行）：`disabled || type === 'checkbox' || type === 'file'` 合并早退拆开——`disabled` 仍早退；checkbox 改为 `onCommit(value === true ? null : true)` 直切并 return；`file` 保持早退；其余类型 `onBeginEdit()` 原路径不动 |
| `packages/dbview/src/react/TableGrid.tsx` | **仅** `onGridKeyDown`：既有 `editingCell !== null \|\| focusedCell === null` 早退与四方向键 case 之后，追加 `'Enter'` / `' '`（Space）case——focusedCell 指向 checkbox 类型属性（且非标题列）时 `preventDefault()` 后经**既有** `onChangeCell(row.id, pid, row.values[pid] === true ? null : true)` 提交；非 checkbox 格子（含标题列）不加任何行为。依赖数组同步补 `onChangeCell/properties/rows/schema.title_pid` |
| `packages/dbview/test/react.test.tsx` | 新增 describe「勾选列值写入（T40-01-1）」3 用例（见 7.3） |

**未动**：焦点模型（cellRefs / moveFocus / tabIndex）零改动；非 checkbox 类型「点击进编辑态」与「Enter 进编辑态」原路径零改动；`file` 早退保持；提交通道只用既有 `onChangeCell`（CellEditor 的 onCommit 在 TableGrid 内本就接线到 `onChangeCell?.(row.id, property.id, value)`），未新开通道。其余 `packages/**`、`apps/desktop/src/**` 零改动；缺陷 1、2 的既有未提交改动未被触碰。

### 7.2 修法要点（与 §3.2 一致，一处措辞落点说明）

- 点击路径：checkbox 格点击落在内层 `.sc-dbc`（展示层 span 冒泡），onClick 直切 → `onCommit` → TableGrid 既有接线 → `onChangeCell`；
- 键盘路径：焦点只在外层 gridcell（内层无 tabIndex，永不获焦），keydown 事件目标在外层、不经过内层 `.sc-dbc` 的 onKeyDown——故 CellEditor 内既有的 checkbox Enter/Space 分支（619-635 行）天然收不到事件，**保留不动**（CellEditor 单测直打内层元素仍覆盖它），在 TableGrid 网格层（事件冒泡终点）补 Enter/Space 的 checkbox 分支；
- 值口径与 CellEditor 原分支同语义：`value === true ? null : true`（空值/false/undefined → true；true → null）。

### 7.3 补测（`packages/dbview/test/react.test.tsx`）

新增 3 用例（≥2 达标，③为 PM 硬要求 3 之红检护栏）：

1. **①点击**：渲染含 checkbox 列（空值）的 TableGrid → `fireEvent.click` 内层 `.sc-dbc[data-type="checkbox"]` → 断言 `onChangeCell('rec-1', 'p_check', true)` 且 `onBeginEdit` 零调用（不进编辑态）；
2. **②键盘 toggle**：`focusedCell={rowIndex:0, prop:'p_check'}`、值 true → 对 grid body `fireEvent.keyDown(Enter)` → 断言 `onChangeCell('rec-1','p_check', null)`；rerender 值为空后再按 Space → 断言 `onChangeCell('rec-1','p_check', true)`；
3. **③非 checkbox 行为不变**：`focusedCell` 指向 text 列 → 对内层 `.sc-dbc[data-type="text"]` `fireEvent.keyDown(Enter)` → 断言 `onBeginEdit` 调用 1 次且 `onChangeCell` 零调用（text 格 Enter 进编辑态原路径保持）。

夹具：CHECK_SCHEMA（title text + checkbox + note text）；`focusedCell` 非空会触发焦点 effect 的 `scrollIntoView`（jsdom 未实现），按 T18-05 组先例在 describe 内局部桩掉、afterAll 还原。

### 7.4 红检（临时还原修复代码 → 红 → 恢复 → 绿）

将 CellEditor onClick 还原为合并早退、TableGrid onGridKeyDown 还原为无 Enter/Space case 后实跑 `pnpm -C packages/dbview test`，原始输出：

```
   × 勾选列值写入（T40-01-1） > 点击 checkbox 格：空值 → onChangeCell(rowId, pid, true)（既有存盘通道），不进编辑态 8ms
     → expected "spy" to be called 1 times, but got 0 times
   × 勾选列值写入（T40-01-1） > 聚焦 checkbox 格按 Enter / Space → toggle（true→null、null→true） 3ms
     → expected "spy" to be called 1 times, but got 0 times
   ✓ 勾选列值写入（T40-01-1） > 非 checkbox 行为不变：聚焦 text 格按 Enter 仍走 onBeginEdit，不经 onChangeCell 2ms

 Test Files  1 failed | 4 passed (5)
      Tests  2 failed | 96 passed (98)
```

即：缺陷行为下①②精确变红（点击无反应 / Enter 无反应，`onChangeCell` 零调用——复现根因），③保持绿（非 checkbox 路径在缺陷行为下本就正常，护栏用例有效）。恢复修复代码后复跑：

```
 ✓  dbview-react  test/react.test.tsx (31 tests) 352ms

 Test Files  5 passed (5)
      Tests  98 passed (98)
   Start at  05:02:27
   Duration  5.34s
```

### 7.5 全量自跑（原始输出，均实跑）

**`pnpm -C packages/dbview test`**（红→绿两次跑的绿侧即上；独立终跑同值）：

```
 Test Files  5 passed (5)
      Tests  98 passed (98)    （react.test.tsx 31 tests，含新增 3 用例）
   Duration  5.34s
```

**`pnpm -C apps/desktop test`**（缺陷 1、2 改动未被触碰，578 不变）：

```
 Test Files  52 passed (52)
      Tests  578 passed (578)
   Start at  05:02:53
   Duration  27.93s (transform 3.16s, setup 0ms, collect 136.26s, tests 66.28s, environment 12.96s, prepare 7.29s)
```

perf 硬指标全绿：commit P95 325ms、rebuild 1714ms（预算 5000ms）。

**`pnpm -r typecheck`**：

```
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/dbview typecheck: Done
packages/editor typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done        （exit 0）
```

**token 门禁**：

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
✓ token 产物与 DESIGN.md 一致
```

**`pnpm -C apps/desktop build`**：

```
✓ 4893 modules transformed.
../../out/renderer/index.html                     1.04 kB
../../out/renderer/assets/index-CIAxeuoa.css    104.45 kB
../../out/renderer/assets/index-DzDuiE2L.js   1,922.05 kB
✓ built in 3.77s
```

（zod 注释 Rollup warning 为既有第三方噪音，非本次引入）

### 7.6 新 DEVIATION

1. **D-15（措辞落点）**：§3.2 写的是「CellEditor.tsx:661-668 onClick … `onCommit(...)` 直切」，实做完全一致；但 §3.2 对键盘路径的措辞是「`TableGrid.tsx:331-358` onGridKeyDown … 取该行当前值」——实做取值源为 `row.values[property.id]`（RecordEntity 原始值）而非经 values 层格式化值，与 CellEditor 原分支的 `value`（同为 `row.values[pid]` 透传）同源同语义，判定无实质偏差，登记备查。
2. **D-16**：CellEditor 内层既有的 checkbox Enter/Space onKeyDown 分支（619-635 行）**保留未删**——真机上若未来焦点模型变化使内层获焦，该分支仍是兜底；当前架构下它是死代码路径（仅被 CellEditor 级单测覆盖）。删与留待 PM 追认（留 = 零风险；删 = 减 8 行但动既有用例）。

### 7.8 PM 真机验收（补 §7.7 第 1 项）

> PM：Hermes ｜ 口径：**同一个考卷**（`docs/mockups/cdp-e2e-t40-01.mjs`），修复前后对比。

| 断言 | 修复前 | 修复后 |
|---|---|---|
| **[B3] 勾选列 Enter 直接切换** | **FAIL** `{"on":0,"focus":{"activeRole":"gridcell","activeInsideCellEditor":false,"cellEditorHasTabIndex":false}}` | **PASS** `{"on":1}` |
| 真机汇总 | 56 PASS / 1 FAIL | **57 PASS / 0 FAIL** |
| 重开读回（C 段 11 类型） | 全绿 | 全绿（`checkbox: true` 读回一致）|

**结论：T40-01-1 修复生效，红断言自然转绿，非 checkbox 行为零回归。**

**关于 §7.7 第 1 项「重开读回」**：C 段本身即「填值 → 重启应用 → 读回」，
修复后 `checkbox:true` 在重开后读回一致（见探针 `重开后关联值一致` 与 11 类型 C 段全绿），
故该项**已真机复核**。

**程序性发现（PM 自认，非产品问题）**：本次复跑首轮 41 PASS / 16 FAIL，
根因是 **T43-01 把入口文案改成「转为多维数据」后，本探针仍按旧文案定位**，
入口断言失败导致 B 段 16 条**级联假红**。已修 13 个历史探针的旧文案残留；
并把「改名类任务后必扫历史探针旧文案」写入 skill `septcats-cdp-e2e`。

### 7.9 DEVIATION 追认（PM 裁决）

- **D-15**（措辞落点）：**追认**。取值源同为 `row.values[pid]`，同源同语义，无实质偏差。
- **D-16**（CellEditor 内层 checkbox 键盘分支保留为兜底）：**追认，保留**。理由：
  该分支当前虽非活路径，但 T18-05 刚动过焦点模型、未来仍可能变化；
  保留为兜底 = 零风险，删除 = 动既有用例且无功能收益。**登记为已裁定技术债，不再追改**；
  已在代码注释中标明其为非活兜底路径。
