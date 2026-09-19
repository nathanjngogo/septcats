# TASK-T36-01 交付报告 · 手柄与首行垂直对齐 + 换块型不得让文字上下跳（含 T35-01）

> 工程师：CodeBuddy（唯一作者）｜日期：2026-09-19
> 前置确认：起点 `e9fbb24 feat(design): 侧栏/顶栏对齐 Notion（T34-01，rc.10）` ✓
> 任务书：docs/tasks/TASK-T36-01.md（§0 为 PM 在 rc.9 的量测原文，§2 为数值化验收）

## 0. 结论

完成。§2 数值化验收全过（真机 electron . 跑 freshly-built out/，T34-01 同口径，独立夹具根 `--user-data-dir` + rootPath，未触碰默认根）：

| §2 验收项 | 结果 |
|---|---|
| ①手柄-首行对齐 `|deltaCenterY| ≤ 1`（段落/H1/无序列表/引用） | PASS —— 四块型全部 **0**（探针 `probe-align-t36.mjs` align 段） |
| ②换块型 dScroll=0 + 首行行框中心位移 ≤1px + 光标不跳 | PASS —— P→H1→H2→H3→列表→引用→代码→P 七步全部 **dScroll=0 / dCenterY=0 / caretKept=true** |
| 长页（34 块）滚动到中段换型 | PASS —— 中段块 p→H1、H1→列表 dScroll=0 / dCenterY=0 / caretKept=true |
| ③T35-01 斜杠 Enter 无残留 | PASS —— 菜单关、块数不变（2）、H1 文本 =「残留测试」原样 |
| ④双主题 × hover 截图（H1 与列表） | PASS —— 见 §3 截图清单 |
| ⑤gutter ≥ 8（T33）/ 手柄 hover 显形 / 块菜单 / 斜杠 11 种块型 | PASS —— gutter=12；块菜单 18 项（2 块操作 + 11 转为 + 5 颜色，见 DEVIATION-5）；斜杠 role=option = 11 |
| `pnpm -C packages/editor test` | ✓ 10 文件 182 用例全绿（+10：anchor 几何） |
| `pnpm -C apps/desktop test` | ✓ 43 文件 450 用例全绿（+1：T35-01 回归） |
| `pnpm -r typecheck` | ✓ 19 包全 Done |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 0 命中 |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 一致（本轮未动 DESIGN.md/tokens） |

## 1. 修法

### 1.1 手柄簇与首行行框垂直居中（§1.1）

- 新增 `packages/editor/src/react/anchor.ts`（纯几何层，可单测）：
  - `firstLineRectOf(view, node, pos)`：非叶子块取 `coordsAtPos(pos+1)` 的光标盒 = **首行行框**（多行块/标题/代码块只取首行，不做「块高/2」近似）；叶子块（divider/image）返回 null 由调用方退化整块盒；
  - `handleTopForFirstLine(firstLine, clusterHeight, containerTop)`：簇 top = 首行中心 − 簇高/2（簇高取 `.pv-handle` 实测 offsetHeight）。
- `PageView.tsx` 手柄定位 effect 重写：量测 → 夹 `.pv-body` 顶（保留 T32-01 ①）→ `setHandleTop`；并挂 `editor.on('update')` 重测——换型/输入移动首行行框时（含菜单钉住期间）手柄即时重对齐。
- PM 实测原文（rc.9）`deltaCenterY=-3` 的根因即「簇 top=块顶」：簇中心 = 块顶+14，而首行中心 = 块顶+padding+行框/2 ≈ 块顶+17.5，单行段落即差 3px。现按首行行框锚定后四块型实测偏差 0。

### 1.2 换块型视觉锚定（§1.2）

- `applyBlockType`（手柄菜单与斜杠菜单共用路径）换型前量首行行框中心 `centerBefore`，`dispatch` 后（PM 同步完成 DOM 更新）量 `centerAfter`，用纯函数 `firstLineAnchorCompensation` 算补偿：
  - **下移方向用 padding-top**（不参与 margin 坍缩，精确）；
  - padding 被 0 截断后的上移残差用 **margin-top** 补，按 CSS 坍缩代数（正取 max、负相加，CSS2 §8.3.1）精确命中目标间距——对任意前邻块 margin-bottom 成立；
  - 首块同样成立：首块 margin-top 与 `.ProseMirror`（无 padding/border）坍缩传播、视觉有效（PM 实测 dTop=-4 即 mt 16↔12 差），坍缩代数与「mb=0 前邻」同构。
- **补偿的承载是 Node 装饰（`react/blockAnchor.ts`），不是 inline style**——这是本轮唯一的实现转折，真机实证：直接写 `el.style` 会在同 tick～数百 ms 内被编辑器的持续重渲染波（EditSession/collab 的 Y→PM 回声等把块元素整体重建）抹掉（`docs/mockups/probe-t36-diag.mjs` 取证：写入成功 `styleNow cssText=padding-top: 20px` → 80ms 后 styleAttr=null）。装饰是 PM 自有渲染输入，**每次重渲染自动重放**，实测穿越多轮回声后稳定（diag ext80/ext1580 两点 style 不掉）。插件状态按 blockId 索引、按顶层块 presence 剪枝；meta-only 事务，不触发反投影/落库。
- scrollTop=0 与光标不跳是结构性的：补偿只动「本块以上空隙 + 本块内 padding」，`tr` 无 `scrollIntoView`，setNodeMarkup 选区映射保持光标在原块——真机 7 步 × 长页 2 步实测 dScroll 全 0、caretKept 全 true。
- **为什么不动块型 CSS 间距**：列表块是扁平单 li 块（块间 0 间距是列表观感的一部分），统一锚点 CSS 会破坏列表节奏；且 UA margin 坍缩使 CSS 补偿无法对任意前邻块成立。JS 量测补偿每次转换前重测现状，不累积误差。

### 1.3 T35-01 斜杠菜单 Enter 双处理（§1.3）

- 根因：SlashMenu 的键盘监听挂 window **bubble** 相（链路末位）。焦点在编辑器时，Enter 先经 PM `view.dom` 处理（tiptap keymap → splitBlock，光标移进新空块），菜单的 preventDefault 已太迟 → 「分块 + 应用」双发：多出空块、且 `/query` 清理取的是新块光标导致原块残留文本。
- 修复：`SlashMenu.tsx` 键盘监听改 **capture** 相（`window.addEventListener('keydown', handler, true)`）。capture 阶段 preventDefault 后，PM 的事件入口 `eventBelongsToView` 检查 `defaultPrevented` 直接跳过（prosemirror-view dist 实证），键盘只属于菜单；↑↓/Esc 的光标双移动也一并消除。
- 风险评估：仅菜单打开期间生效，改动面一个监听器；desktop 既有斜杠用例（window 派发）不受影响，全绿。

## 2. 变更清单

- `packages/editor/src/react/anchor.ts`（新增）：`handleTopForFirstLine` / `firstLineRectOf` / `firstLineAnchorCompensation` 纯几何层。
- `packages/editor/src/react/blockAnchor.ts`（新增）：块锚定补偿的 Node 装饰插件 + `setBlockAnchorStyle`。
- `packages/editor/src/react/Editor.tsx`：装配时注册 blockAnchorPlugin。
- `packages/editor/src/react/SlashMenu.tsx`：键盘监听 capture 相（T35-01）。
- `packages/editor/src/react/index.ts`：出口补 anchor/blockAnchor。
- `apps/desktop/src/renderer/src/pages/PageView.tsx`：手柄首行锚定 + update 重测；applyBlockType 前后量测 + 装饰补偿 + 手柄补对齐。**未动 PageView.css**（T34-01 面零接触）；未动块模型语义（补偿在装饰层，BlockDoc 往返恒等不受影响）。
- 测试：`packages/editor/test/anchor.test.ts`（新增 10 用例）、`apps/desktop/test/pageview-blocks-ui.test.tsx`（+1 用例）。
- 探针：`docs/mockups/probe-align-t36.mjs`（可复跑全量验收）、`docs/mockups/probe-t36-diag.mjs`（inline style 被抹的取证）。截图 `docs/mockups/screens-t36/`。

## 3. 真机数值与截图

探针 `node docs/mockups/probe-align-t36.mjs`（electron . @ freshly-built out/，夹具根 `_scratch/t36-*`）：

- ① 对齐（|deltaCenterY|≤1）：段落 0 ｜ H1 0（H1 行框 66.9–103.9 中心 85.4，簇 71.4–99.4 中心 85.4）｜ 无序列表 0 ｜ 引用 0；深色 H1 亦 0。
- ② 换型（dScroll/dCenterY/caretKept）：BLOCKQUOTE→H1、H1→H2、H2→H3、H3→列表、列表→引用、引用→代码、代码→P 全部 `0 / 0 / true`。
- ③ 斜杠 Enter：`menuOpenAfter=false, blockCount=2, target=[P 对齐测试文本, H1 残留测试]`——无分块、无残留。
- ④ 长页 34 块、滚动中段：p→H1 `0/0/true`、H1→列表 `0/0/true`。
- ⑤ 回归：gutter=12；块菜单 menuitem=18；斜杠 option=11；手柄 hover 显形（各截图可见）。
- 截图：`screens-t36/convert-light.png`、`slash-enter.png`、`longpage-mid-h1.png`、`light-h1-hover.png`、`dark-h1-hover.png`、`dark-list-hover.png`。

## 4. DEVIATION 逐条（待 PM 追认）

1. **anchor.test.ts 的块型几何表为常量钉值**（lineH = 字阶×行高、pt/mt/mb = editor.css + Chromium UA 实际值，UA margin 不在 CSS 内无法解析）。若后续改块型 CSS/字阶，该表需同步——测试注释已标明口径。
2. **补偿存续期 = 页面会话**：装饰是内存态，换页/重开页后补偿清零、块回落 CSS 原位（首行中心相对当时的相邻布局可能有既有幅度差异）；下一次换型会重新量测补偿。「每次换型不跳」的验收口径不受影响；「绝对锚定跨会话保持」不在 §1.2 要求内。
3. **量测锚 = coordsAtPos(块内容起点) 的光标盒**，与 PM 探针的 `blk.firstChild` 文本盒/行框盒同心（半-leading 对称），实测两口径 deltaCenterY 一致（探针 ① 用后者量得 0）。
4. **叶子块（divider/image）不参与 §1.2 锚定**（无内容行框，换型走整体替换路径，退化为旧行为）；§1.2 要求的七种文本块型全覆盖。
5. **块菜单项数 = 18**（删除/复制 2 + 转为 11 + 颜色 5），任务书 §2.3 口径「12 项」为 T32-01 时代计数；canonical 探针 `probe-blocks-visibility.mjs` 对菜单项无硬 12 断言（label 列表 slice(0,12) 展示），本轮无功能回归。若 PM 认定 12 为硬指标，需立单明确哪 12 项。
6. **补偿写入路径弃 inline style 改 Node 装饰**（§1.2 所述真机实证）；装饰 style 会覆盖元素 style 属性整体（renderHTML 本就不产出 style，无冲突）；`getComputedStyle` 量测含装饰生效值，连续换型按现状重算、不累积。
7. **probe-align-t36.mjs 未复用 PM 探针文件本体**：`probe-align-typing.mjs` 保留原样（PM 复跑口径不变），新探针覆盖 §2 全部断言并落截图；两探针可互为对照。
8. **diy 探针里 ⑤ 段深色列表 hover 用 nth(2) 块**：若该块在长页场景下不在视口，截图可能取到邻块；不影响数值断言（深色对齐量测在首块 H1 上）。

## 5. 复跑指引（PM 补）

（PM 补）

## 6. 遗留与移交

- 真机验收（老板实测）、全仓 `pnpm -r test`、selftest、重打包：留 PM。
- PM 复跑探针：`node docs/mockups/probe-align-t36.mjs`（需先 `pnpm -C apps/desktop build`，或重打包后把 EXE 换成 win-unpacked 路径复跑 `probe-align-typing.mjs` 对照）。
- DEVIATION-5（块菜单项数口径）待 PM 追认。

## §PM 复跑（2026-09-19，rc.11）

```
全仓 1069 无红（editor 182 / desktop 450）；typecheck 9/9；no-magic ✓；build-tokens --check ✓
重打包 0.3.0-rc.11（首次打包遇瞬时锁冲突失败，重跑成功）
```

| 项 | 工程师自跑（electron out/） | PM 复核（rc.11 打包产物） |
|---|---|---|
| ①手柄-首行 deltaCenterY | 全 **0**（rc.9 为 −3） | **0** ✅（段落） |
| ②换型 dScroll / 首行中心位移 | 全 **0** / 全 **0**（P→H1→H2→H3→列表→引用→代码→P） | **0 / 0** ✅ |
| ③长页 34 块中段换型 | 0 / 0 / 光标保持 ✓ | — |
| ④T35-01 `/` 菜单残留 | 已修（块数不变、无残留） | 待下轮探针固化 |
| ⑤gutter（T33 保持） | 12 | **12**（4/4 overlap=false）✅ |
| ⑥斜杠菜单 / 块菜单 | 11 项 / 18 项 | 11 项 ✅ |

**DEVIATION-6 追认（关键）**：补偿以 **Node 装饰**承载（inline style 会被协作回声重渲染抹掉——工程师用诊断探针取证）✓ 方案正确且更稳；其余 7 条抽查无异议。
