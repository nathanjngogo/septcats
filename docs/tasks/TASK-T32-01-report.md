# TASK-T32-01 报告 · 🔴 P1：块编辑器「看得见」——块手柄未渲染 + 斜杠菜单在视口外

> 工程师：CodeBuddy ｜ 前置：`a053da8`（任务书提交）｜ 版本：`0.3.0-rc.6`
> 自跑面：editor 168 用例 / desktop 440 用例 / `pnpm -r typecheck` / no-magic / build-tokens --check **全绿**；
> 真机验收（§2 数值化 + 双主题截图）按任务书 §5 留 PM。

## §0 现象与取证（引用任务书 §0，PM 在 rc.6 真机）

老板：「**我没发现编辑区有块编辑器**」。PM 取证（`docs/mockups/probe-blocks-visibility.mjs`）：

| 对象 | 修复前实测 |
|---|---|
| `/` 斜杠菜单 | 存在且 11 个 `role="option"` 齐全，但 **`inViewport: false`**（宽 320 / 高 380 / `display:block`，落在视口之外） |
| 块手柄 `BlockControls` | **hover 块时 DOM 中不存在**：`.sc-blockcontrol__handle` = null、`[class*="sc-blockcontrol"]` = null、按钮列表为空 |
| 代码现状 | `PageView.tsx:722` 有 `<BlockControls … visible />`；`BlockControls.tsx` 与 `editor.css` 均已实现 |

## §1 根因与修复

### 1.A 块手柄「为何没渲染」（任务书要求先查明）

`PageView` 里手柄整棵挂在 `{activeBlockId !== null ? … : null}` 下，而 `activeBlockId` **只在 ProseMirror
`selectionUpdate`/`update` 事件里赋值**（`PageView.tsx` 旧 L263-315）——即**必须先点击聚焦编辑器**。
PM 探针「纯 hover 不点击」时 `activeBlockId === null` → 手柄根本不进 DOM（CSS 的 `--visible` 显形逻辑根本没机会参与）。

修复（`apps/desktop/src/renderer/src/pages/PageView.tsx`）：

| 项 | 内容 |
|---|---|
| hover 归属 | 新增 `onMouseOver`（`.pv-body`）：`closest('[data-id]')` → `hoverBlockId`；悬停 `.pv-handle`（手柄/菜单本体）不切换归属；跨块间隙只前进不清零（不闪烁） |
| 菜单钉住 | `BlockControls` 新增 `onOpenChange` → 菜单打开期间 `pinnedBlockId` 钉住归属块（移向菜单手柄不漂移/消失），关闭交还 hover |
| 键盘兜底 | `handleBlockId = pinned ?? hover ?? activeBlockId`：纯键盘用户（光标所在块）也能 Tab 到手柄；Esc 关菜单为既有能力 |
| 定位 | 手柄 top = 归属块 DOM `getBoundingClientRect().top − .pv-body.top`，`Math.max(top, 0)` 夹紧（视口内、不随滚动错位——手柄绝对定位于随文档滚动的 `.pv-body`） |
| `＋` 新增块 | `BlockControls` 新增 `onInsert` + `PlusIcon`；PageView 在归属块后插空段落（`ulid()`）并 `setTextSelection` 进新块 |
| 动作归属 | `applyBlockType(blockId, …)` 签名显式传块 id；`handleBlockAction` 落在**手柄归属块**（hover 的块）而非光标块——Notion 手感 |
| 菜单视口内 | `BlockControls` 打开后 `useLayoutEffect` 实测菜单 rect，底边放不下且上方有正空间 → `--above` 翻转到手柄上方（editor.css 新类，纯 token） |
| 拖拽 | `onDragStart` 改用 `handleBlockId`（旧代码读 `activeBlockId`，hover 未选中时拖不动）；排序仍走既有 `react/dnd.ts` 的 `planBlockDrop` |

### 1.B 斜杠菜单「为何在视口外」

`PageView` 渲染 `<SlashMenu>` 时**从未传 `position`** → `editor.css` 的 `.sc-slashmenu` 是 `position:absolute`
且无 top/left → 落在「文档流缺省位置」= 全部块内容之后（长页必然在首屏视口之外），与取证「宽 320/高 380/display:block 但 inViewport:false」吻合。

修复：

| 项 | 内容 |
|---|---|
| 贴光标 | `syncSelection` 里用 `coordsAtPos(from)` 实时换算光标坐标到 `.pv-body`（`slashPos`），随键入 query 菜单跟着光标走 |
| 视口夹紧 | 新增 `react/viewport.ts` 纯函数 `clampOffsetInViewport` / `overflowsBottom`；`SlashMenu` 渲染后实测自身 rect：底/右越界先压回（留 8px 余量），压回导致顶/左越界再保底 |
| 块型真的切换 | 既有 `applyBlockType` 路径 + 修复：应用前删除「/query」触发文本（块内光标前最后一个 `/` 到光标），否则标题会残留斜杠垃圾字符 |
| 外点关闭 | `SlashMenu` 菜单外 `mousedown` 关闭（对齐 BlockControls 手感）；↑↓/Enter/Esc 为既有能力 |
| IME | `/` 唤起走 keydown：组合态（key='Process'）不触发、**组合态结束后**输入 `/` 正常唤起（符合任务书「组合态后仍能唤起」口径）；真机 IME 由 PM 复跑确认 |

### 1.C 顺带修复的真缺陷（测试揪出）：拖拽落库为空

`onDrop` 旧实现把 `applySortKeyAssignments(currentDoc, …)` 的结果喂 `EditSession`，但该结果**数组顺序仍是拖前序**
（只改 sort_key）；而 `diff.ts` 以**数组顺序**识别 reorder、`sort_key` 字段又被 patch 排除 → 差分为空 →
**blocks:commit 根本不会被调用**（任务书 §2.④「落库」前提不成立）。修复：把拖后的视觉顺序写回 blocks 数组
（死块保序追加在尾部），sort_key 仍由 `planBlockDrop` 权威生成——`dnd.ts`/core 未动。

## §2 验收对照（任务书 §2）

| # | 验收项 | 本轮覆盖（可断言） | 真机数值 |
|---|---|---|---|
| ① | hover 段落 → `.sc-blockcontrol__handle` 存在且 rect 在视口内 | desktop `pageview-blocks-ui.test.tsx`：hover 即出现、归属随 hover 切换、非禁用；jsdom 无法取真机 rect | **（PM 补）**截图 + 数值 |
| ② | 点手柄菜单 → 菜单在视口内、≥3 可读项 | editor `react.test.tsx`：菜单打开/翻转 `--above`；菜单实有 16 项（删除/复制 + 转为 9 块型 + 颜色 5）；真机 rect | **（PM 补）** |
| ③ | 输入 `/` → `[data-testid="septcats-slashmenu"]` 在视口内；↑↓+Enter 块型切换 | editor：夹紧纯函数 + style 断言（dy=-220 → top 380px 等）；desktop：`/` → ↓ → Enter → `h1[data-id="blk-1"]` 出现、菜单关闭 | **（PM 补）** |
| ④ | 手柄拖拽第 2 块到第 1 块之前 + 落库 | desktop：DOM 顺序变 + `blocks:commit` 收到含 `reorder` 的 Op 批（§1.C 修复后） | **（PM 补）** |
| ⑤ | 双主题 × hover/active/focus 截图；no-magic / build-tokens | no-magic ✓（CSS 全 `var(--sc-*)`）、build-tokens --check ✓ | 截图 **（PM 补）** |

## §3 自跑门禁（本轮实跑数值）

```
pnpm -C packages/editor test  → 9 files / 168 passed（+8：viewport 3 + BlockControls 3 + SlashMenu 3 中归属本轮的用例）
pnpm -C apps/desktop test     → 42 files / 440 passed（+4：pageview-blocks-ui.test.tsx）
pnpm -r typecheck             → 9/9 通过
node packages/ui/tokens/no-magic.mjs          → ✓ 无字面 hex / 无重复裸 px
node packages/ui/tokens/build-tokens.mjs --check → ✓ token 产物与 DESIGN.md 一致
```

改动面：`packages/editor/src/react/{icons.tsx, BlockControls.tsx, SlashMenu.tsx, viewport.ts(新), editor.css}`、
`apps/desktop/src/renderer/src/pages/PageView.tsx`、`packages/editor/test/react.test.tsx`、
`apps/desktop/test/pageview-blocks-ui.test.tsx(新)`。未触碰 `packages/{core,sync,dbview,importer,ui}`、`main/**`、CI/发布脚本；未加依赖。

## §4 DEVIATION（逐条，待 PM 追认）

1. **onDrop 落库修复**（§1.C）：超出「纯接线」范畴的缺陷修复——不改它任务书 §2.④ 的「落库」不可能成立；`dnd.ts`/core 契约未动，只把视觉顺序写回 `PageView` 的 docRef。
2. **`applyBlockType` 签名变更**（PageView 内部函数）：`(blockType, level?)` → `(blockId, blockType, level?)`；`handleBlockAction` 改读 `handleBlockId`（hover 块）。既有外部契约（@septcats/editor 出口）无变化。
3. **斜杠应用后删除「/query」文本**：任务书 §1.2 只要求块型切换；不删则标题残留 `/标题 1` 垃圾字符，Notion 手感必需，故顺带实现（取块内最后一个 `/` 到光标删除）。
4. **SlashMenu 外点 mousedown 关闭**：任务书只列 Esc；对齐 BlockControls 外点关闭手感新增。
5. **手柄键盘兜底**：无 hover 时若存在光标块（`activeBlockId`），手柄挂在光标块常显（Tab 可达）。副作用：鼠标离开编辑区后手柄不消失（挂在光标块）——与「hover 即出现」不冲突，PM 若要求「离开即隐」需另权衡键盘可达性。
6. **菜单翻转条件**：翻转需上方有正空间（`rootRect.top − menuHeight − 8 ≥ 0`）；极端小视口两侧都放不下时维持下方（`max-height:420px` 内滚动），不做双向夹紧。
7. **viewport.ts 未进公共出口**：`react/index.ts` 未 re-export（浮层内部实现细节）；测试直引 `../src/react/viewport`。
8. **desktop 测试 stderr 噪音**：＋/斜杠用例的 300ms debounce commit 在 cleanup（unstub 假桥）后才触发 → console.error「commit 失败（不吞）」日志；用例本身全绿，既有 EditSession 行为非缺陷。
9. **`--sc-space-gutter` 负偏移沿用**：`.pv-handle` 的 `left: calc(var(--sc-space-gutter) * -1)` 未动；若 gutter 为 0 的布局档位手柄会压正文首字符，真机截图请顺带核一眼。
10. **IME 验证口径**：jsdom 无法模拟组合态；实现层 `/` 走 keydown（组合态 key='Process' 天然不触发），「组合态后可唤起」待 PM 真机确认。

## §5 PM 复跑节

（PM 补：rc.6+ 重打包（先 `node apps/desktop/scripts/ensure-abi.mjs electron`）→ §2 数值化真机验收
（probe 脚本复跑 ①②③ + ④ 手柄拖拽 + ⑤ 双主题 × hover/active/focus 截图）+ 升级库夹具回归 + 全仓门禁。）

## §PM 真机复核（2026-09-19，rc.7）

```
全仓 1042 无红（editor 168 / desktop 440）、typecheck 9/9、no-magic ✓ / build-tokens ✓
重打包 0.3.0-rc.7 + 真机探针 docs/mockups/probe-blocks-visibility.mjs（独立夹具根）
```

| 项 | 修前（rc.6） | 修后（rc.7） |
|---|---|---|
| 斜杠菜单在视口内 | ❌ `inViewport:false` | ✅ **`inViewport:true`**（11 种块型齐全） |
| 块手柄 hover 出现 | ❌ DOM 无元素 | ❌ **仍无**：`DOM-DIAG.blockCount=0`、`bcAny=0` |

**结论：本单「斜杠菜单」部分闭环；「块手柄」部分未闭环 → 已开补派 T32-01B。**
根因（PM 取证+定位）：`PageView.tsx:73 blockIdentityOf()` 读 `closest('[data-id]')`，而 `types/shared.ts` 的 `blockIdAttribute.renderHTML` **仅当节点 `id` attr 非空才输出 `data-id`**；真机 `[data-id]` 数量 **0** → 块身份从未进 DOM → hover 归属链（本单新逻辑）全部失效。属**上游装载路径缺 id attr**，不在本单改动面内。
**PM 探针勘误**：首轮取证我误用选择器 `[data-block-id]`（真实为 `data-id`），已修正探针并复跑确认——**排除了探针误报**才下的结论。

---

# 补派 TASK-T32-01B：块身份 `data-id` 未落到 DOM → 块手柄结构性无法渲染

## §B0. 结论

已修。根因不在 PM 根因链点名的两处「待查」位置——`editorExtensions()` 九个块节点**都**挂了
`blockIdAttribute`（paragraph.ts:11 等），DB 装载路径 `blocksToPMDoc` 的 `blockIdAttrs`（model.ts:228）
**也**写了 `attrs.id`。真正的缺口是**第三条路径：键入产生的新块**——`pmDocToBlocks` 在模型层给新块
生成 ulid，但**没有任何代码把 id 写回 PM 节点 attrs**；而 `blockIdAttribute.renderHTML` 只在 `id`
非空时才输出 `data-id`（shared.ts:38）。探针建的是新页、两段文字全部键入产生 → 整页 0 个 `data-id`
→ `DOM-DIAG.blockCount = 0` → hover 归属链断在第一环。

附带发现并修复第二个身份分叉源：输入规则 `# ` `- ` 等用 `setNodeMarkup` 全量替换 attrs
（inputRules.ts 原 :121 `attrsFor(action)`），把段落已有的 `id` 冲回 null。

## §B1. 根因链（修正版，三条路径逐一核实）

| 路径 | attrs.id 是否落 PM 节点 | data-id 是否进 DOM |
|---|---|---|
| ① DB 装载（blocks:list → blocksToPMDoc → content） | ✅ model.ts `blockIdAttrs` | ✅（直至协作层接管前） |
| ② 显式创建（＋按钮/duplicate/applyBlockType） | ✅ 调用点都带 `id: ulid()` 或 spread 原 attrs | ✅ |
| ③ **键入产生的新块**（含探针场景：建页后打的每一段） | ❌ `pmDocToBlocks` 只在模型层生成 ulid，**不回写 PM** | ❌ **永远没有** |

补一源：输入规则转换（`# `→heading 等）`setNodeMarkup` 丢原 `id` → 模型层把同一块当新块（身份分叉）。

## §B2. 修复（改动面）

1. **`packages/editor/src/react/Editor.tsx`**（核心）：新增 `writeBackBlockIds(editor, doc)`——
   每轮编辑反投影后，按 `isPmBlockNodeName`（与 `pmDocToBlocks` 同一过滤口径）取顶层块节点、
   与存活块按序配对，节点缺 `id` 时 `setNodeMarkup` 补上；补写事务带 meta
   `septcats:block-id-writeback`，`onUpdate` 见 meta 跳过反投影（防 onChange/回写成环）。
   节点数与存活块数不符（对应关系被外力破坏）时保守放弃，不猜。
2. **`packages/editor/src/rules/inputRules.ts`**：`setNodeMarkup` attrs 显式携带原 `id`
   （`{ id: parent.attrs['id'], ...attrsFor(action) }`）。
3. **`packages/editor/src/model.ts`**：`isPmBlockNodeName` 由模块私有改为导出（回写过滤复用，
   保证与反投影同一口径；无行为变化）。

`PageView.tsx` 本轮**零改动**——T32-01 的 hover 归属链/视口夹紧/拖拽逻辑在 `data-id` 进 DOM 后
自然生效（PM §1.4 判断「上游修好它们全部恢复」成立）。

## §B3. 新增测试（含任务书要求的装载路径断言）

| 用例 | 文件 | 断言 |
|---|---|---|
| 装载路径块身份（任务书交付物） | editor `react.test.tsx` | demoBlockDoc（9 块型全）渲染后 `.ProseMirror` 顶层每个块节点带非空 `data-id` 且唯一 |
| 编辑路径回写 | editor `react.test.tsx` | 空页键入 → DOM `p[data-id]` 出现，且与 onChange 回调 `blocks[0].id` 一致；一轮编辑恰一次 onChange（防环钉） |
| 输入规则不冲 id | editor `rules.test.ts` | 带 `id` 的段落 `# ` 转 heading 后 `attrs.id` 原值保留 |
| 协作层 id 往返 | editor `yjs.test.ts` | `attrs.id` 经 PM→Y 种子 + 回放 Y→PM 投影不丢，DOM `[data-id]` 可查询（协作接管内容不失块身份） |

## §B4. 自跑门禁（本轮实跑）

```
pnpm -C packages/editor test  → 9 files / 172 passed（+4，见 §B3）
pnpm -C apps/desktop test     → 42 files / 440 passed（零新增、零改动，全绿）
pnpm -r typecheck             → 9/9 通过
node packages/ui/tokens/no-magic.mjs          → ✓
node packages/ui/tokens/build-tokens.mjs --check → ✓
```

## §B5. 验收对照（任务书 §2；真机数值留 PM）

| # | 验收项 | 本轮覆盖 | 真机 |
|---|---|---|---|
| ① | `DOM-DIAG.blockCount > 0` | react.test：装载路径全块型带 `data-id`；编辑路径键入即带 | **（PM 补）** |
| ② | hover → 手柄存在且视口内 | 修复后 `blockIdentityOf` 的 `closest('[data-id]')` 有命中（T32-01 已有 desktop UI 用例覆盖归属链）；jsdom 无真机 rect | **（PM 补）** |
| ③ | 点手柄 → 菜单视口内含可读项 | 同上（T32-01 §2② 覆盖链路） | **（PM 补）** |
| ④ | `/` 斜杠菜单回归 + ↑↓+Enter 换型 | T32-01 用例未动，全绿；applyBlockType spread 原 attrs 保 id | **（PM 补）** |
| ⑤ | 手柄拖拽换序 + 落库 | blockPosById 依赖 PM attrs.id，回写后可命中（T32-01 §2④ 用例未动，全绿） | **（PM 补）** |
| ⑥ | 双主题 × 三态截图 + 门禁 | no-magic / build-tokens ✓（本报告 §B4） | **（PM 补）** |

## §B6. 修复前后证据

**修前（PM 真机 rc.7 探针原文，TASK-T32-01B.md §0 引）**：
`DOM-DIAG.blockCount = 0`、`bcAny = 0`（`[class*="blockcontrol"]` 一个都没有）——键入两段后整页
无一带块身份。截图见 PM 取证（`docs/mockups/screens-blocks/`，rc.7 轮）。

**修后**：真机探针复跑与重打包按分工**留 PM**（见 §B7）。代码侧证据 = §B3 四个新用例 +
§B4 全部门禁绿；其中「装载路径」「协作往返」两个用例把 `data-id` 的出现从「恰好在场」升级为
「逐块断言、逐路径断言」。

## §B7. PM 复跑节

（PM 补：重打包 rc.8（先 `node apps/desktop/scripts/ensure-abi.mjs electron`）→ 复跑
`docs/mockups/probe-blocks-visibility.mjs`，核 §B5 ①–⑤ 数值 + ⑥ 双主题三态截图。注意探针
HOVER#2 段的 `[data-id]` 选择器即本单修复产物，预期 `blockCount ≥ 2`。）

## §B8. DEVIATION（待 PM 追认）

1. **Editor onUpdate 签名消费 `transaction`**：Tiptap v2 原生字段，非契约变更；meta 守卫是防环
   必需（回写事务 docChanged=true，不拦则 onChange/回写互触发成环）。
2. **`writeBackBlockIds` 进 `@septcats/editor/react` 公共出口**（`export * from './Editor'` 自动带出）：
   导出仅为可测性与后续复用；apps 未直接引用。
3. **输入规则 `setNodeMarkup` 携带原 `id`**：超出任务书点名的两处「待查」，但它是同一根因的第二
   证据源（不修则 `# ` 一打块身份又丢，§B5① 的 blockCount 会在用户输入规则后回退为 0）。
4. **`isPmBlockNodeName` 私有转导出**：model.ts 零行为变化，纯可见性调整。
5. **回写失败静默放弃**（节点/块数不符）：协作并发窗口下的极端态；不猜对应关系，宁可手柄暂隐
   也不误配身份——若 PM 要求强一致可另立账。
6. **防环口径**：回写事务完全跳过反投影（而非重算后比对）。回写只补 id、不改内容，模型层在
   回写前的反投影已拿到终态 id（回写的就是它算出来的 ulid），重算是纯冗余。
