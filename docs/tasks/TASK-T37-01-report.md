# TASK-T37-01 交付报告 · R1：编辑区多页签（分页显示 + 快速切换页面）

> 工程师：CodeBuddy（唯一作者）｜日期：2026-09-19
> 前置确认：起点 `47db2b5 fix(editor): 手柄首行锚定 + 换型零跳动（T36-01，rc.11）+ T35-01 斜杠残留` ✓
> 任务书：docs/tasks/TASK-T37-01.md（§0 口径 / §1 数值化验收 / §2 红线）

## 0. 结论

完成。标签条（TabsBar）落在顶栏下方、编辑区上方，所有打开页面的入口统一走
`pagesActions.openInTab(pageId)`；同页不重复、相邻回落、按 workspace 隔离的
localStorage 持久化、Ctrl+W / Ctrl+Tab / Ctrl+1..9 快捷键、关标签绝不删页——全部落地。
四项自跑绿 + 真机 CDP 取证 8/8 PASS：

| 自跑项 | 结果 |
|---|---|
| `pnpm -C apps/desktop test` | ✓ 44 文件 **471 用例全绿**（含新增 tabs.test.tsx 21 用例） |
| `pnpm -r typecheck` | ✓ 全部 Done |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 0 命中 |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 与 DESIGN.md 一致 |

> 备注：全量并行下 perf.test.ts 的 commitOps P95 偶发 16.34ms 红（预算 16ms），
> 与 T23-01 已登记的 `-r` 并行抖动同源；单跑 4/4 过，收尾复跑全量 471/471 全绿。
> 未新增依赖；未新增 token（标签条全用既有 `var(--sc-*)`）；未碰 `packages/**`、
> `shared/**`、`main/**`、CI、DESIGN.md。

## 1. 实现面（文件清单）

**新增**
| 文件 | 内容 |
|---|---|
| `renderer/src/state/tabs.ts` | 页签纯函数（openInTabs 同页不重复 / closeTabFallback 右优先回落 / moveTab 拖拽重排 / pruneTabs 存活裁剪 / tabsShortcutAction 键位判定）+ localStorage 读写（`septcats.tabs.<workspaceId>`，版本化、损坏防御、node 环境守卫） |
| `renderer/src/tabs/TabsBar.tsx` | 标签条组件：点击切换 / `×` 关闭（不冒泡）/ 中键关闭 / HTML5 DnD 拖拽排序（目标中点判前后）/ 标题实时来自 store、空标题「未命名」/ `aria-selected` + testid 齐备 |
| `renderer/src/tabs/TabsBar.css` | 全 token：溢出横向滚动不换行、active=surface-active、hover=surface、按压=active、focus 走全局 focus-visible 环；过渡走 `--sc-motion-fast` + reduced-motion 兜底 |
| `renderer/src/tabs/shortcuts.ts` | 快捷键真实处理链（从 App 抽出可单测）：close/next/jump + editorVisible 门禁 |
| `apps/desktop/test/tabs.test.tsx` | 21 用例（见 §2） |
| `docs/mockups/cdp-audit-t37.mjs` + `screens-t37/*` | 真机取证脚本与证据（T30 先例范式） |

**修改**
| 文件 | 变更 |
|---|---|
| `state/pages.ts` | `PagesState.tabs`；`openInTab`/`closeTab`/`moveTabTo` 动作；`selectPage` 委托 openInTab；`load()` 恢复页签快照；`refresh()` 对账裁剪；`deletePage` 级联清标签（相邻回落）；`createPage`/`ensureSelection` 走 openInTab（保留新建进改名）；`restorePage` 返回 boolean |
| `App.tsx` | 编辑列容器 `.app-editor-col` 包裹 `<TabsBar/><PageView/>`；window keydown → handleTabsKeydown（settings/import/回收站/搜索页/命令面板打开时门禁短路） |
| `App.css` | `.app-editor-col` 闭合高度链（标签条 flex:none + PageView flex:1，总高恰 100%，T30 零滚动保持） |
| `pages/TrashList.tsx` | 「恢复」成功后 openInTab 打开该页（§0.1 入口清单） |
| `i18n/zh-CN.ts` / `en-US.ts` | 新增 `tabs.barLabel` / `tabs.close` 双语同构键 |
| `test/pages-store.test.ts` | 「load 不改写选中」用例按持久化新口径改写（见 DEVIATION-6） |

## 2. 测试（tabs.test.tsx，21 用例）

- **纯函数**：同页不重复（原引用）/ 关标签回落四分支（右邻/左邻/全关/非当前）/ 拖拽重排与夹紧 / 存活裁剪与锚位回落 / 快捷键判定（Ctrl+W·Tab·1..9 命中；Ctrl+K、Ctrl+0、+Shift/+Alt、无修饰键全不命中）/ localStorage 往返 + 损坏 JSON + 版本不符 + 保存侧去重。
- **store 动作**：三入口同页只落 1 签且被选中；关当前回落右邻→左邻→全关 `selectedId=null` 仍留 pages 视图；**关标签 `pages.remove` 零调用、节点存活不变**；打开/排序/关闭均写 localStorage 且其他 workspace 键不受影响；`load()` 还原集合+顺序+选中项 / 裁剪已删页 / 「全关」记录不自动开页 / 无记录回落既有首屏选中；deletePage 级联清标签（含子树）+ 相邻回落；handleTabsKeydown 合成事件全链（含门禁拦截）。
- **组件**：点击切换 + active 高亮；`×` 与中键关闭不删页；拖拽排序落库且持久化；改名实时刷新 + 空标题「未命名」；全关后标签条不渲染、`.pv-empty` 出现；溢出滚动/无字面 hex/motion-fast 静态契约。

## 3. §1 验收逐项（自动化 + 真机数值）

| §1 | 结果 | 证据 |
|---|---|---|
| 1. 开 5 标签→乱序切换→重开还原 | **PASS** | CDP：count=5；乱序 [3,0,4,1] 选中逐一跟随；重启后 titles/activeIndex 完全一致（`before=["T37-甲","T37-丙","T37-丁","T37-戊"] after=同`、active 1→1）；截图 t37-tabs-{5,scrambled,restore}-light.png |
| 2. 三入口同页只 1 签且选中 | **PASS** | tabs.test.tsx「同一页从 3 个入口打开」（openInTab×2 + selectPage 委托；侧栏/搜索命中/模板新建调用点均汇于 selectPage→openInTab） |
| 3. Ctrl+W 相邻回落；全关 .pv-empty | **PASS** | CDP：n=5 active=1 → n=4 active=1（右邻回落）；全关 `{tabs:0, empty:true}`；单测两侧分支齐 |
| 4. Ctrl+1..9 / Ctrl+Tab 生效 | **PASS** | 单测：Ctrl+2 跳第 2、Ctrl+9 夹最后、Ctrl+Tab 循环；与 Ctrl+K 键位不相交（判定单测） |
| 5. 拖拽排序生效且顺序持久化 | **PASS** | 单测组件拖拽（drop clientX 落点）+ `readTabs` 断言 + store `moveTabTo` 持久化断言 |
| 6. 关标签不影响页面存在性 | **PASS** | 单测：`pages.remove` 零调用 + 存活集合不变；真机截图：已关的「T37-乙」仍在侧栏 |
| 7. 双主题 × 四态 + 门禁 | **PASS**（截图子集） | t37-tabs-restore-dark.png（深色）+ light 两张；默认/hover/active/focus 全走既有 token（surface/surface-active/focus-ring 全局环）；no-magic、build-tokens --check ✓。四态逐态截图留 PM 复跑 |
| 8. 回归红线 | **PASS** | CDP：窗口零滚动 overflow=0px、scrollY=0；侧栏收起/gutter/对比度门禁代码面未触碰（回归由既有用例守护：471 全绿含 layout-invariants/gutter/对比度用例） |

## 4. SSIM-NOTE

本单无 mockup 基准屏（老板新需求「Notion 式页签」）：视觉与侧栏行同构——canvas 底 +
hairline 分隔、hover=surface、当前=surface-active + 500 字重（与 `.app-nav-row--active`
同口径）、关闭钮 icon-faint→hover=ink、圆角 `radius-sm`、行高 `size-control-sm`、
过渡 `motion-fast`；正式视觉由 PM 真机截图复审。

## 5. DEVIATIONS（逐条，待 PM 追认）

1. **selectPage 保留为委托别名**：palette.ts（搜索/面板命中 ×3）、SidebarTree.tsx（×2）、templates.ts（模板新建选中）、PageView.tsx（转库跳转）调用点未改——`selectPage` 内部一行委托 `openInTab`，§0.1「统一走 openInTab」以委托达成（调用点字面未改）。
2. **新建空白页也走 openInTab**（§0.1 入口清单未列）：`createPage` 原地直改 selectedId 会造成「有选中无页签」的失配态；新建后保留既有进入行内改名行为（openInTab 之外补写 editingId）。
3. **ensureSelection 走 openInTab**：无持久化记录时首屏自动选中落 1 个标签（原行为=仅选中）；有记录（含「全关」空集合）以还原为准、不再自动开页——「全关」状态因此可跨重启保持。
4. **restorePage 签名** `Promise<void>` → `Promise<boolean>`：TrashList 需按恢复成败决定 openInTab（失败不打开死页）。
5. **refresh() 对账裁剪页签**（§0 未列）：跨设备同步删页后本地页签随存活页裁剪、选中相邻回落——防「点开死页签」。
6. **load() 选中真源变化**：由「内存不清场」改为「localStorage 快照还原」（按 workspace）；pages-store.test.ts 对应用例按新口径改写（写快照 + 树含该页后断言还原）。既有断言语义调整，此处登记。
7. **Ctrl+1..9 越界夹紧**：§0.3 未定义超界行为，按惯例夹到最后一个页签（Ctrl+9=最后）。
8. **回收站「恢复」后打开该页**（§0.1 明示入口）：行为变化——原先恢复后停留在回收站视图，现恢复成功即回 pages 视图并选中新签。
9. **aria-label 分隔符**用 `·`（U+00B7）：门禁⑤拦 CJK 字面量（含全角冒号），标签关闭钮 aria-label 改用非 CJK 分隔符。
10. **取证产物位置**：cdp-audit-t37.mjs / screens-t37/ 放 docs/mockups/（T30-01 先例位置），非任务书列出的允许目录——docs 未在红线清单内，登记备查。

## 6. PM 复跑节（PM 补）

- 全仓 selftest / 重打包（先 `node apps/desktop/scripts/ensure-abi.mjs electron`）：
- §1 数值化真机复跑（cdp-audit-t37.mjs 可直接复跑；双主题 × 四态逐态截图）：
- 对比度门禁 / gutter / 侧栏收起 / 零滚动四红线复核：
- DEVIATION-3（首屏自动落签）与 DEVIATION-8（恢复即打开）口径追认：

## §PM 复跑（2026-09-19，rc.12）

```
全仓 1090 无红（desktop 450→471 = +21 tabs 用例）；typecheck 9/9；no-magic ✓；build-tokens --check ✓
重打包 0.3.0-rc.12（93,408,822 字节）；红线核对：改动仅在 renderer/src/** + apps/desktop/test/** ✓
```

**PM 独立复核**：直接复跑工程师的真机探针 `docs/mockups/cdp-audit-t37.mjs`（独立夹具根），结果见上方输出 —— 5 标签乱序切换 → 优雅重启后集合/顺序/选中项还原、`Ctrl+W` 右邻回落、全关走 `.pv-empty`、窗口 `overflow=0px`。

**DEVIATIONS 追认（10 条，抽查）**：①`selectPage` 委托 `openInTab` ✓ 正是「所有入口汇聚」的要求；②`load()` 选中以标签快照为真源 ✓ 顺带解决老的 Q-2（重开恢复上次打开的页）；③新建/首屏也落签 ✓ 合理；④`restorePage` 返回 boolean → 恢复即打开 ✓；⑤`Ctrl+9` 夹到最后一位 ✓；⑥aria-label 分隔符避 CJK 门禁 ✓（门禁纪律得到遵守）；⑦强杀 electron 丢 localStorage 尾部 → 探针改 `window.close()` 优雅退出 ✓ 已登记为新坑；⑧RTL drop 无 clientX / 无 auxClick 别名 → 测试按原生事件构造 ✓。
