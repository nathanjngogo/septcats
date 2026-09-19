# TASK-T41-01-1 交付报告 · DB 页 ⋯ 菜单「全宽 / 固定宽度」无效控件移除（隐藏方案）

- 基线：git HEAD `4d25613`（rc.22），工作树干净（除本单改动）。
- PM 裁决：走「隐藏」方案 —— 不提供无效控件最干净且可逆；**不**改 DbView 的宽度实现（另一产品口径，未定）。

## 0. 症状

DB 页（`pageTypeOf(node) === 'database'`，承载为 DbPage 多维数据视图）的侧栏行 ⋯ 菜单里出现「全宽 / 固定宽度」项。点击会翻转 `pageWidthActions`（store + localStorage 落盘都发生），但 DbPage 不消费 pageWidth 宽度口径，**无任何视觉效果** —— 提供了一个无效控件。

## 1. 修法

照同文件既有 `convertItem` 范式（非 null 才 spread 进 items），把全宽项改为条件构造：`type === 'database'` 时为 `null`，不进菜单。`type` 复用既有 `pageTypeOf(node)` 取值，未引入新状态。命令面板侧同口径：选中页为 DB 时不注入 `toggleFullWidth` dep，命令不出现（不留「执行了但没反应」路径）。

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/pages/SidebarTree.tsx` | ⋯ 菜单全宽项改条件构造：新增 `fullWidthItem`（`type === 'database'` → null），items 里 `...(fullWidthItem !== null ? [fullWidthItem] : [])`，与 `convertItem` 同款；`onSelect` 的 `fullWidth` 分支保留（该分支只在项存在时可达，死代码不新增） |
| `apps/desktop/src/renderer/src/App.tsx` | `useCommandWiring` 的 `configure()`：新增 `selectedNode`/`widthToggleable` 计算（`pageTypeOf(selectedNode) !== 'database'`）；`toggleFullWidth` dep 改为按 `widthToggleable` 条件 spread（exactOptionalPropertyTypes 下不能显式传 undefined，条件 spread 与既有 `delete scoped.toggleFullWidth` 口径兼容）；import 增加 `pageTypeOf` |
| `apps/desktop/test/page-width.test.tsx` | 新增 1 用例（见 §3）；文件头覆盖说明补一行 |

未触碰：`packages/**`、`src/main/**`、`src/shared/**`、DbView 宽度实现、`docs/mockups/**`、DESIGN.md/tokens/CI/发布脚本、git。

## 3. 测试

新增用例（`page-width.test.tsx` → `侧栏行菜单（全宽 / 固定宽度）` describe）：

> **DB 页的 ⋯ 菜单不含全宽项（删除项仍在）；wiki 页/普通页仍含该项**
> - DB 页（`pageType: 'database'` 夹具）：菜单无「固定宽度」也无「✓ 全宽」，且「删除」项仍在（证明菜单本身未被破坏，只是摘除了无效项）；
> - wiki 页：仍含全宽项（wiki 页走 WikiLanding/PageView 正常承载，宽度开关有效）；
> - 普通页：仍含全宽项（既有行为回归锚）。

既有用例全部保留未改：DB 页菜单项显示/切换/落盘/每页独立等既有断言均针对普通页夹具，不受影响。

## 4. 自跑数值（原始输出）

### 4.1 `pnpm -C apps/desktop test`

```
 Test Files  55 passed (55)
      Tests  595 passed (595)
   Start at  06:34:01
   Duration  28.43s (transform 3.33s, setup 0ms, collect 142.35s, tests 67.83s, environment 14.56s, prepare 7.99s)
```

（单文件复核：`npx vitest run test/page-width.test.tsx` → `✓ test/page-width.test.tsx (15 tests) 175ms`，`Tests 15 passed (15)`）

### 4.2 `pnpm -r typecheck`

```
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
```

### 4.3 `node packages/ui/tokens/no-magic.mjs`

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### 4.4 `node packages/ui/tokens/build-tokens.mjs --check`

```
✓ token 产物与 DESIGN.md 一致
```

## 5. DEVIATION（待 PM 追认）

| # | 内容 |
|---|---|
| D-1 | 命令面板门控做在 **App.tsx 装配侧**（按选中页类型条件 spread `toggleFullWidth` dep），而非改 `configurePaletteCommands` 签名或 `commands.ts`。理由：`hasSelection` 布尔同时门控 deletePage/saveAsTemplate，若收紧会误伤 DB 页的「删除页面」等合法命令；条件 spread 是最小改动且不破坏 palette 既有测试基线。 |
| D-2 | `SidebarTree.tsx` 的 `onSelect` 保留 `action === 'fullWidth'` 分支：该项对 DB 页已不存在，分支对 DB 页不可达；保留是为普通页/wiki 页路径服务，非死代码。 |
| D-3 | App.tsx 装配侧的 DB 门控**无直接单测**（既有测试组织不渲染 App 外壳，成本高）：侧栏两侧（DB 不含/普通页 wiki 含）已单测覆盖；命令面板侧结论以代码走查 + 既有 `configurePaletteCommands` 门控测试（无选中页摘除）间接背书。如 PM 要求，可后续补 App 级集成用例。 |

## 7. PM 真机验收（补 §6.3）

> PM：Hermes ｜ 产物：**rc.23** ｜ 探针：`docs/mockups/cdp-e2e-t41-01-1-pm.mjs` ｜ **7 PASS / 0 FAIL**，console 0 / pageerror 0

| 断言 | 实测 |
|---|---|
| **N1 普通页 ⋯ 菜单仍含全宽项（功能未被误删）** | `["固定宽度","转为 Wiki","删除"]` ✓ |
| **N2 普通页切全宽仍真生效** | `measure: null→full`，正文 **650px → 849px** ✓ |
| **D1 DB 页 ⋯ 菜单不含全宽项** | `["删除"]` ✓ |
| **D2 DB 页菜单仍含删除项（未误删其它项）** | ✓ |
| **P1 命令面板在 DB 页不含全宽命令** | 命令表无该项（已先**点击选中** DB 页，`已渲染为 DbPage=true` 佐证）✓ |
| **P2 命令面板在普通页含全宽命令** | 命令表含「全宽 / 固定宽度」 ✓ |
| D0 DB 页在侧栏可见 | ✓ |

**补 D-3 证据缺口**：工程师称命令面板侧「无直接单测、以代码走查背书」。
PM 用真机验证了 App.tsx 装配侧的条件 spread **确实生效**（不是纸面结论）。**D-1/D-2/D-3 全部受理。**

**PM 探针自身修正（如实记录）**：P1 首跑假红，因我只 `hover` 打开 ⋯ 菜单、**未真正点击选中** DB 页
（命令面板看的是"选中页"）。加「先点击选中」后转绿。**产品侧无遗留。**

## 8. 未做项（PM 裁决）

1. **DbView 宽度产品口径**（全宽对多维数据表格是否有意义）：PM 明示未定，本单不碰 ✓
2. **窄窗口下切全宽无视觉变化**：PM 裁决为**接受的固有限制**（`max-width` 语义：容器本已窄于
   粘性宽度时无可放开空间，非缺陷）。如后续要给提示/禁用，另立账。
3. ~~真机 CDP/截图复核~~ → **已完成**，见 §7。
4. git 提交：PM 已提交。
