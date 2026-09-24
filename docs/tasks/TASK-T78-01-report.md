# T78-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T78-01.md` · PRD：`docs/PRD-R26-编辑器体验包.md` §2
> 基线：main `750b4f4`（T77 合入）；**开工时工作树 HEAD = `9283f7a`**（T78 前面两笔均为 PM 侧
> 文档/探针提交：`8df7e0c` docs 基线钉 + `9283f7a` 真机探针草稿，与本单无交集文件）。
> 红线执行：只 Write/Edit 落盘，未执行任何 git 命令。

## §0 开工侦察结论

### ① BlockControls 菜单开态与 onAction 宿主链（多选态最薄插法）

**现状链**：`PageView`（宿主）→ `.pv-handle`（定位壳）→ `BlockControls`（⋮⋮ + 菜单）。
组件**只发意图**（`onAction(BlockAction)`，`BlockControls.tsx:159 run()`），落库与 Op 生成全在
宿主：`handleBlockAction`（`PageView.tsx:797`）→ 既有 PM transaction → `Editor` onUpdate →
`pmDocToBlocks` → `EditSession.onDocChange` → debounce → `diff.ts` 差分 → `blocks:commit`。

**最薄插法（本单采用）**：
1. `BlockAction` 并集扩 4 个 `bulk-*` kind（`bulk-delete/bulk-duplicate/bulk-convert/bulk-color`），
   **意图里不带 ids**——选区块是宿主的真相，动作落在宿主当前区间的分工与既有「动作落在 hover
   块上」完全同构（组件零状态，唯一新增 props 是 `selectionCount`（决定菜单变体）与
   `handleInSelection`（决定普通点击是否保留选区））；
2. 菜单开态（`open`）与 `onOpenChange`（宿主 `pinnedBlockId` 钉住）**一字未改**——单块行为零回归；
3. 分流入点在 `handleBlockAction` 顶部（批量意图先于「手柄归属块」判定），
   批量实现独立成 `handleBulkAction`，不改动任何既有单块分支。

**关键发现（决定了交互分工，见 §3 D-1/D-2）**：`onOpenChange(true)` 会把 `pinnedBlockId`
钉在 `handleBlockId` 上（T32-01 §1.1 防漂移），而 `handleBlockId = pinned ?? hover ?? active`。
**菜单一旦打开，手柄结构上无法再移到另一块** ⇒ 若「Shift+click 顺带开菜单」，
任务书自己要求的「二次 Shift+click 另一块=重算区间」将**不可达**。故本单定为：
Shift+click = **纯扩选手势**（不开菜单）；普通点击 = 开菜单（本块在选区内 → 保留选区 + 批量变体）。

### ② dnd.ts DropPlan 的单块假设点 + 组拖最小改法

`dnd.ts` 原 `planBlockDrop(doc, ctx, draggedId: string, beforeId)` 是**单块假设**，共 4 处：
1. `live.find(b => b.id === draggedId)` 单块查找（`dnd.ts:62`）；
2. `remaining = live.filter(b => b.id !== draggedId)` 单块剔除（`:66`）；
3. `sortBetween(prev, next)` **只产 1 个键**（`:80`）；
4. 重平衡分支 `[..., dragged, ...]` 单块插入（`:91`）。

**本单最小改法**：新增 `planBlockGroupDrop(doc, ctx, draggedIds: readonly string[], beforeId)`，
把上述 4 点泛化为「集合 + 在 (前邻,后邻) 之间**连续分配 N 个键**」（`spreadSortKeys` 二分递归，
只用既有 `core.sortBetween`，零新增键生成口径）；`planBlockDrop` 原样保留为 `[id]` 的**委托**，
逐位等价（有对照用例 `planBlockDrop ≡ planBlockGroupDrop([id])` 钉死）。
`DropPlan` 结构（kind/ops/assignments）零改动 ⇒ PageView 的 `applySortKeyAssignments` 乐观更新路径零改。

### ③ 撤销链事务边界（批量 = N 单块 op 同提交的 undo 口径）

- **一次 `commitOps` = 一个 batch = 单事务**（`apps/desktop/src/main/commit.ts` 文件头：
  「一次 `commitOps` = **一个 batch**（DbServer 的 batch 是单事务）」）；
- `EditSession` 在同一 debounce 窗口内 **coalesce**（`seq.ts:57 onDocChange` 只留最后一版文档），
  窗口结束后与上次提交的文档做**一次**差分 → **一次** `commit(ops)`；
- 故「批量 = N 个单块 op 同事务提交」在既有链路上天然成立：删/复制/颜色用**单 tr 多步**，
  转用 N 次单块 `applyBlockType`（同一事件内同步连发 → 同一次 debounce 折叠）；
- **未新增任何撤销语义**（任务书 §3 显性不做）：undo 粒度=一次提交即一步，与既有一致。
- 硬证据：`sync` 包 **109 例**+`importer` 包 **59 例** **零修改全绿**（§6），op-log v3 无形状变动。

## §1 交付概览（DoD 自检）

- [x] 选择模型：`selection.ts` 纯函数（`intervalIds` 文档序区间 / `extendBulkSelection` 锚块不变
      重算 / `groupDropOrder` 组保相对序落位）+ PageView 接线；Esc / 点正文（簇外 pointerdown）/
      焦点移出手柄簇（`.pv-handle` mouseleave）三路清选；单块行为零回归
- [x] 批量动作：删/复制/转（13 型复用 convert）/色 = N 个单块 op **一次 commit**；菜单变体
      （`selectionCount >= 2` → 批量项 + 「已选 N 块」计数区）
- [x] 组拖拽：多选态从任一被选块 ⋮⋮ 发起 = 整组移动（`onDragStart` 收整组 → `onDrop` 删/插整段
      → `groupDropOrder` + `planBlockGroupDrop` 一次分配 N 键）；单块拖拽零回归
- [x] T76 新块（table/toggle）在批量删 / 批量转两路各有测（desktop 2 例）
- [x] i18n 成对（`editor.blockMenu.bulkCount/bulkDelete/bulkDuplicate`，zh/en）+ testid 挂齐
      （契约 5 名 + 2 名补充，见 §3 D-5/D-6）

## §2 用例计数

| 工程 | 基线 | 本单后 | 增量 |
|---|---|---|---|
| apps/desktop | 1100 | **1111** | +11（`test/t78-bulk-selection.test.tsx`） |
| packages/editor | 221 | **254** | +33（`test/t78-selection.test.ts` 20 + `test/t78-block-bulk-menu.test.tsx` 13） |
| packages/ui | 168 | 168 | 0 |
| packages/core | 51 | 51 | 0 |
| packages/dbview | 122 | 122 | 0 |
| packages/sync | 109 | 109 | 0（op-log 零新增硬证据） |
| packages/importer | 59 | 59 | 0（同上） |

文件数：desktop 101 → 102（+1）；editor 12 → 14（+2）。

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D-1 | 任务书 §范围1「**普通点击手柄=回单块态**（现行为零回归）」与 PRD §2「手柄菜单加『选中 N 块』态提示」在 T32 的菜单钉住语义下互斥。 | 普通点击**本块在选区内**→ 保留选区 + 开批量菜单；**不在选区内**→ 清选回单块态（现行为逐位不变）。 | 若「任何普通点击都回单块态」，批量菜单**永无入口**（PRD 的「选中 N 块」提示无从出现）。单块菜单路径（`bulk=null`）与历史逐位一致 → 「现行为零回归」成立。待 PM 追认。 |
| D-2 | 「Shift+click 手柄」是否顺带开菜单（探针 M2-a/M2-c 的隐含假设）。 | Shift+click = **只扩选，不开关菜单**。 | 菜单打开 → `pinnedBlockId` 钉住归属块 → 手柄无法移到另一块 ⇒ 任务书自身要求的「二次 Shift+click 另一块=重算区间」**结构不可达**。二选一必舍其一，取「扩选语义优先」（区间是 PRD 的核心需求）。待 PM 追认。 |
| D-3 | 「批量 = N 个单块 op **一次提交（同事务）**」的实现形态。 | 删/复制/颜色 = **单 PM 事务多步**；批量转为 = N 次单块 `applyBlockType`（同事件连发 → EditSession debounce 折叠为**一次** `blocks:commit`）。 | 换型的首行视觉锚定补偿（T36-01 §1.2）是**逐块量测**（换型前后各量一次），无法在一笔 tr 内完成；复用单块通道也避免造第二条换型路径。落库仍是「一个 batch = 单事务」，op 类型零新增。 |
| D-4 | `block-menu-bulk-convert-<type>` 的 `<type>` 取值：标题有 3 个菜单项（H1/H2/H3）共享 `blockType='heading'`。 | 后缀取**块型名**（契约字面），故 H1/H2/H3 三项 testid 相同（`...-convert-heading`），以 `data-level=1/2/3` 区分。 | 任务书 §范围5 契约名为 `<type>`；PM 探针 M4-a 亦按 `...-convert-heading` 取值。测试用 `getAllByTestId(...)[n]` 定位。 |
| D-5 | 契约 5 个 testid 之外，新增 `block-handle-<id>`（⋮⋮ 键）。 | 增挂。 | PM 探针 `docs/mockups/cdp-e2e-t78-01.mjs` 以 `[data-testid^="block-handle-"]` 定位手柄（`hoverBlock`/`shiftClickHandle`），无此锚点探针无法驱动。**注**：探针内的 `hoverBlock` 用「手柄 closest 行内含目标文本」找块，而本实现是**单簇式**手柄（仅 hover 块有手柄），该 helper 需 PM 改为「先 hover 行、再点簇」口径。 |
| D-6 | 批量颜色 5 档 testid 未在契约中列名。 | 补 `block-menu-bulk-color-<token>`（default/accent/danger/success/faint）。 | 与批量转为同构；契约只列了 5 名，颜色项若无名则不可断言。 |
| D-7 | 「批量 = N 个单块 op」在**整页删空**时多出 1 条 upsert。 | 接受（3 delete + 1 upsert）。 | PM 顶层 doc 是 `block+`，删空时**框架自身**（`prosemirror-model` 的 `close()` fill）补一个无 id 空段落保持文档合法 → 反投影给 ulid → 落一条 upsert。**不抛 ReplaceError、页面不成「零块」态**（已实测钉死：`tr.doc` 删后 childCount=1 且 `attrs.id=null`）。无需自造空块（曾实现的守卫已移除，避免重复补块）。PM 探针 M3-a 断言「0 块」需按此校准为「1 空段落」。 |
| D-8 | 探针草稿 M2-b / M2-c 与本实现口径不符。 | 不迁就探针改产品语义（见 D-1/D-2）。 | M2-b：`hoverBlock('行5')` 在菜单钉住期间找不到行5 的手柄（见 D-5 注）；M2-c：只派发 `mousedown/mouseup`（无 `click`），React `onClick` 不触发 → 菜单不会开。两者皆探针驱动方式问题，非产品缺陷；testid 已备齐供 PM 校准。 |

## §4 文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/editor/src/selection.ts` | **新增**（纯函数面）：`BulkSelection` / `intervalIds`（文档序区间，含两端）/ `extendBulkSelection`（锚块不变、禁集合并）/ `groupDropOrder`（组保相对序落位序，noop 用 null 表达） |
| `packages/editor/src/react/dnd.ts` | 新增 `spreadSortKeys`（二分递归，在前后邻间连分 N 键）与 `planBlockGroupDrop`（组落位计划；空位不足 → 整层重平衡）；`planBlockDrop` 改为 `[id]` 委托（单块逐位等价） |
| `packages/editor/src/react/Editor.tsx` | 新增 `blockIdsInOrder(editor)`（顶层块 id 的文档序，多选区间真源） |
| `packages/editor/src/react/BlockControls.tsx` | `BlockAction` 扩 4 个 `bulk-*` kind；新增 `BlockMenuLabels`/`formatBulkCount`/`DEFAULT_BLOCK_MENU_LABELS` 与 props `selectionCount`/`handleInSelection`/`onExtendSelection`/`onCollapseSelection`/`labels`；多选态菜单（计数区 + 批量删/复制/转为 13 型/颜色）；⋮⋮ 加 `block-handle-<id>` |
| `packages/editor/src/react/editor.css` | 新增 `.sc-blockcontrol__bulk`（计数区；分离线走 T62-01 内网格 1px `ink-edge`） |
| `packages/editor/src/index.ts` | 导出 `./selection` |
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | 选区块状态（`bulk`/`bulkIds`/`selectBars`）+ Shift 扩选/清选三路 + 批量动作（`handleBulkAction`）+ 组拖（`dragIdsRef`/`onDrop` 整段搬移）+ 选中条渲染 + 菜单文案注入 |
| `apps/desktop/src/renderer/src/pages/PageView.css` | 新增 `.pv-selectbar`（块左缘选中条，`--sc-color-accent` 淡显，`pointer-events:none`） |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` / `en-US.ts` | `editor.blockMenu` 3 键（成对） |
| `packages/editor/test/t78-selection.test.ts` | **新增** 20 例：区间/扩选状态机/组落位序/组落位计划（含重平衡、单块委托等价、tombstone 不参与） |
| `packages/editor/test/t78-block-bulk-menu.test.tsx` | **新增** 13 例：`formatBulkCount`/单块零回归/普通点击两态/批量 testid 齐备/批量意图 4 型/Shift 只扩选 + 再点开批量菜单/文案注入/手柄 testid |
| `apps/desktop/test/t78-bulk-selection.test.tsx` | **新增** 11 例：区间选中条与文档序/二次 Shift 重算（非并集）/Esc 与回单块态/批量删（2 delete 一次 commit）/整页删空文档恒合法/批量复制保相对序/批量转（T76 两型）/批量删（T76）/批量颜色/组拖整段移动/i18n en |

**未触碰**：`packages/sync/**`、`packages/importer/**`、`packages/core/**`、`packages/dbview/**`、
`apps/desktop/src/main/**`（op-log v3 与 commit 通道零改动）。

## §5 红线自检

- [x] **op-log v3 零新增类型/零改格式**：本单只发既有 `delete/patch/reorder/upsert`；硬证据 =
      `sync` 109 例、`importer` 59 例**零修改全绿**（§6）；`main/blocks.ts` / `commit.ts` 零改动
- [x] 选择条/菜单变体全 token：`.pv-selectbar` 仅 `var(--sc-space-xxs)/var(--sc-radius-full)/
      var(--sc-color-accent)` + `opacity:0.4`（无 hex、无裸 px 重复）；`.sc-blockcontrol__bulk` 仅
      token + 1px `ink-edge`（no-magic ✓，且 T62-01 全局框线门禁 ✓）
- [x] 禁「数据库」词零回归（新增 zh 文案无该词，`i18n.test.ts` 门禁⑥通过）；无省略号占位
      （新文案 `已选 {n} 块` / `批量删除` / `批量复制` 均完整）
- [x] 非连续 ctrl+click 多选 / 跨页多选 / 批量 undo 新语义**零涉及**（显性不做清单）；未建表、
      未加依赖（`packages/editor/package.json` 与 `apps/desktop/package.json` 未动）
- [x] 启动零外联（无网络、无新增 IPC 通道）
- 备注：T77 既有面（code/image NodeView、blockLabels 注入）未触碰；`planBlockDrop` 保留导出（委托），
  既有调用方语义不变。

## §6 门禁原始输出

### ① typecheck（`pnpm -r --no-bail run typecheck`）

```
Scope: 9 of 10 workspace projects
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
```

tsc 错误数 = **0**（基线 0）。

### ② desktop vitest（`pnpm --filter @septcats/desktop test`）

```
 Test Files  102 passed (102)
      Tests  1111 passed (1111)
   Duration  28.81s
```

delta：1100 → **1111**（+11，只增不减）。

### ③ ui vitest（`pnpm --filter @septcats/ui test`）

```
 Test Files  33 passed (33)
      Tests  168 passed (168)
   Duration  4.53s
```

delta：168 → 168（0，未动）。**注**：本单新增 CSS 曾被 T62-01 全局框线门禁判红一次
（`.sc-blockcontrol__bulk` 原写 `border-bottom: 1px solid var(--sc-color-surface-active)`），
已改为 1px `--sc-color-ink-edge`（内网格口径）后复绿——门禁扫描面覆盖 `packages/editor/src`。

### ④ no-magic（`node packages/ui/tokens/no-magic.mjs`）

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

违规数 = **0**（基线 0，只增不减）。

### 附 A：editor 包（邻近门禁，含本单 33 例）

```
 Test Files  14 passed (14)
      Tests  254 passed (254)
   Duration  3.68s
```

delta：221 → **254**（+33）。

### 附 B：op-log 零改动硬证据（sync / importer 零修改）

```
（sync）    Test Files  11 passed (11)      Tests  109 passed (109)
（importer）Test Files   4 passed (4)       Tests   59 passed (59)
（dbview）  Test Files   5 passed (5)       Tests  122 passed (122)
（core）    Test Files   9 passed (9)       Tests   51 passed (51)
```

### 附 C：工作树说明（未执行 git 操作）

开工即存在若干 `docs/mockups/**` 截图/结果 JSON 的工作树改动（非本单产出）；
`docs/perf-history.jsonl` 由 `perf.test.ts` 的既定行为追加（测试副产物）。本单代码改动仅 Above §4 清单。

## §7 PM 真机核验（待 PM）

- 探针：`docs/mockups/cdp-e2e-t78-01.mjs`（草稿）——本单已备齐其所需 testid：
  `block-handle-<id>` / `block-select-bar-<id>` / `block-menu-bulk-count` /
  `block-menu-bulk-delete` / `block-menu-bulk-duplicate` / `block-menu-bulk-convert-<type>`；
  需 PM 按 §3 D-5/D-8 校准探针的「hover 取手柄」与「开菜单需 click」两处驱动方式，
  M3-a 的期望值按 D-7 改为「1 个空段落」。
- undo 粒度无 UI 入口（renderer 无撤销按钮），已在单测口径钉死（§0-③）。

## §8 PM 真机核验 + 门禁复跑（09-24）

**PM 复跑门禁（不轻信自报）**：typecheck **0** / desktop **1111 (102 files)** / editor **254** / ui **168** / no-magic ✓——与自报全等；**sync/importer 包 git diff 零修改**（op-log v3 零新增的硬证据）；省略号扫描新代码零命中；i18n 禁词零命中。

**真机探针 `docs/mockups/cdp-e2e-t78-01.mjs`：13 PASS / 0 FAIL**
- M1 建场 5 块入库（IPC truth 层）
- M2-a/b **区间模型核心**：锚=点 行1 → Shift+click 行3 柄=3 根选中条；再 Shift+click 行5 **重算=5**（非并集残留，PRD 核心语义真机实证）
- M2-c/d：原地普通点击→菜单批量变体（bulk-delete/duplicate 在、convert 13 项、计数「已选 5 块」）
- M3：批量删→truth 层 行1..5 全灭（仅剩框架补的 1 空段=D-7 口径）
- M4：批量转标题→2 heading（heading 行1/行2，行3-5 段落）
- M5：**优雅退出重启后 2 heading+3 段落全持久**（批量 op 落库链闭环）
- M6：Esc 清选+存活+真实数据根 untouched
- 探针三轮校准（CB 的 D-5/D-7/D-8 预判全部应验）：① content 是 PM doc JSON→提取 "text" 拼接；② 单簇式手柄→IPC 块 id+`block-handle-<id>` 定位；③ 选区在鼠标离开手柄簇即清（PRD 明文三路清选之一）→菜单入口改「原地点击」不移动鼠标；④ 锚点=PM 光标 React 态有竞态→shift-click 有界重试。产品语义零改动、探针侧全适配。

**DEVIATION 裁决（8 条全追认）**：D-1/D-2（Shift=纯扩选、普通点击管开合）是发现 T32 菜单钉住与任务书字面互斥后的正确取舍——**追认为交互定案**；D-3 debounce 折叠=一个 batch 单事务成立；D-7 框架 close() fill 补空段=正确（不造第二条路径）；D-4/D-5/D-6/D-8 均过硬。
