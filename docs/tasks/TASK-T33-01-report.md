# TASK-T33-01 报告 · P1 块手柄压在行首文字（「输入文本有重叠」）

> 工程师：CodeBuddy（唯一作者）｜前置确认：`git log -1 = 4d10dac`（任务书提交，T32-01B 之后）✓｜日期：2026-09-19
> 自跑：`pnpm -C packages/editor test` 172/172 ✓、`pnpm -C apps/desktop test` 449/449 ✓、`pnpm -r typecheck` ✓、`no-magic` ✓、`build-tokens --check` ✓
> 重打包 / 全仓 / selftest / PM 探针复跑留 PM（PM 打包前先 `node apps/desktop/scripts/ensure-abi.mjs electron`）。
> SSIM-NOTE：本报告为唯一交付说明；§6 为 PM 复跑节留（PM 补）。

## §0 修复前事实（PM 测量原文，任务书 §0 转录）

PM 用 `docs/mockups/probe-text-overlap.mjs`（rc.8 打包 exe，独立夹具根）以 `document.createRange()` 量「手柄矩形 × 文本矩形」：

| 窗口宽 | 手柄 [left→right] | 文本 [left→right] | 重叠 | 装订线 gutter |
|---|---|---|---|---|
| 1280 | 375 → 403 | 385 → 433 | **18 × 21 px** ❌ | **−18** ❌ |
| 900 | 270 → 298 | 280 → 328 | 18 × 21 px ❌ | −18 ❌ |
| 760 | 270 → 298 | 280 → 328 | 18 × 21 px ❌ | −18 ❌ |
| 640 | 270 → 298 | 280 → 328 | 18 × 21 px ❌ | −18 ❌ |

文本内容本身不重复（`dupIds: []`、重载完好）——重叠来自手柄压在行首字符上。

## §1 根因

`.pv-handle`（PageView.css）旧实现：

```css
left: calc(var(--sc-space-gutter) * -1);  /* 悬到 .pv-body 左缘外 40px */
width: var(--sc-space-xl);                /* 窄轨只有 24px 宽 */
display: grid; place-items: center;
```

而它装的手柄**整簇**（BlockControls：`＋` 28 + gap 2 + `⋮⋮` 28 = **58px**，两按钮均为
`--sc-size-control-sm` = calc(32−4) = 28）远宽于 24px 窄轨——簇从轨道溢出、右缘探进正文列，
正文列（`.pv-body`，max-width 720）**没有为手柄预留任何左侧装订线** → `gutter = −18`，
视觉即「输入文本有重叠」。

## §2 修法（§1.5 口径 A：编辑器内容容器左内边距）

仅动 `apps/desktop/src/renderer/src/pages/PageView.css` 两条规则（PageView.tsx / editor.css /
BlockControls.tsx 零改动；包契约、main、CI 未触碰；无新依赖）：

1. `.pv-body` 预留左装订线（簇宽 + 右侧呼吸 12，全部计入列内）：

```css
padding-left: calc(
  var(--sc-size-control-sm) + var(--sc-space-xxs) + var(--sc-size-control-sm) + var(--sc-space-md)
);  /* 28 + 2 + 28 + 12 = 70 */
```

2. `.pv-handle` 弃「窄轨 + 负偏移悬挂」，锚进装订线、由簇自身撑宽：

```css
left: 0;
width: max-content;   /* 簇右缘 = 58，确定性落在文本左缘（70）之外 */
```

要点：
- **gutter = 12**（`--sc-space-md`，落在任务书建议区间 12–16，≥ 8）；
- 手柄命中区 **28×28 ≥ 24×24**（未改窄手柄，a11y 口径不变）；
- 簇热区 = 簇矩形本身（58×28），**不覆盖文本**（右缘 58 < 文本左缘 70）；
- 窗口 640–1600 全区间成立：装订线在 `.pv-body` 内部预留，窄窗不再外溢
  （旧实现 58px 簇挂 −40px 偏移，窄窗会戳出主区触发横向滚动）；
- 缩进块只增不减：列表（padding-left 24）gutter = 36、引用（12）gutter = 26；
- CSS 全 token（`var(--sc-*)`），无字面 hex、无重复裸 px（`no-magic` ✓）；
- `＋` → `⋮⋮` 先后顺序与间距（`--sc-space-xxs` = 2px）与设计稿
  `01-editor.html` `.block` 的 `grid-template-columns: 24px 28px` + `column-gap: var(--sp-xxs)` 一致；
  差异仅 `＋` 列宽 24 vs 实际按钮 28——设计稿无 `＋` 独立规格，按既有 a11y（≥24×24）
  与 `--sc-size-control-sm` 统一口径保留 28，不缩小（§1.2 禁改窄）。

## §3 修复后真机测量原文

环境：`pnpm -C apps/desktop build` 重建 `out/`（含修复），`electron .` 直跑
（`--user-data-dir=E:\…\_scratch\t33-ud` + `rootPath=…\t33-data` 独立夹具，CDP 9397；
重打包 exe 复跑留 PM）。探针：`E:\…\_scratch\t33-verify.mjs`（复用 PM 探针量法：
`createRange` 精确到字符；新增列表/引用缩进块断言；scratch 在仓库外）。

```text
BLOCKS: [{"tag":"P","cls":"sc-block sc-block--paragraph","text":"段落甲"},{"tag":"P","cls":"sc-block sc-block--paragraph","text":"/无序"},{"tag":"UL","cls":"sc-block sc-block--bulleted_list","text":"列表甲"},{"tag":"BLOCKQUOTE","cls":"sc-block sc-block--quote","text":"引用甲"}]
GUTTER-CHECK winW=1280: [{"kind":"paragraph","handle":{"l":415,"r":443},"cluster":{"l":385,"r":443},"text":{"l":455,"r":503},"overlapHandleX":0,"overlapHandleY":21,"overlapClusterX":0,"overlapClusterY":21,"overlap":false,"gutter":12,"clusterGutter":12,"handleW":28,"handleH":28,"winW":1264},{"kind":"bulleted_list","handle":{"l":415,"r":443},"cluster":{"l":385,"r":443},"text":{"l":479,"r":527},"overlapHandleX":0,"overlapHandleY":21,"overlapClusterX":0,"overlapClusterY":21,"overlap":false,"gutter":36,"clusterGutter":36,"handleW":28,"handleH":28,"winW":1264},{"kind":"quote","handle":{"l":415,"r":443},"cluster":{"l":385,"r":443},"text":{"l":469,"r":517},"overlapHandleX":0,"overlapHandleY":21,"overlapClusterX":0,"overlapClusterY":21,"overlap":false,"gutter":26,"clusterGutter":26,"handleW":28,"handleH":28,"winW":1264}]
GUTTER-CHECK winW=900:  [… paragraph gutter=12 / bulleted_list gutter=36 / quote gutter=26，overlap 全 false，handleW/H=28 …]
GUTTER-CHECK winW=760:  [… 同上，overlap 全 false …]
GUTTER-CHECK winW=640:  [… 同上，overlap 全 false …]
SUMMARY total=12 bad=0
REGRESS handle-visible: true
REGRESS menu-items: 18
REGRESS slash: true options=11
```

（winW=900/760/640 三行完整原文同构：paragraph gutter=12、bulleted_list gutter=36、
quote gutter=26、`overlap:false` ×3、handle 28×28，全量原文见探针运行日志。）

小结（§2 验收①② 对应）：

| 窗口宽 | 段落 gutter | 列表 gutter | 引用 gutter | overlap |
|---|---|---|---|---|
| 1280 | **12** ✓ | 36 ✓ | 26 ✓ | false ✓ |
| 900 | 12 ✓ | 36 ✓ | 26 ✓ | false ✓ |
| 760 | 12 ✓ | 36 ✓ | 26 ✓ | false ✓ |
| 640 | 12 ✓ | 36 ✓ | 26 ✓ | false ✓ |

整簇口径（`clusterGutter`）与手柄口径同值（`⋮⋮` 是簇最右元素，`＋` 在左，次序同设计稿）。

## §4 回归（§2 验收③）与截图（§2 验收④）

- hover 手柄显形 ✓；点手柄菜单打开、menuitem 共 18 项（删除+复制+转为 11+颜色 5；
  PM 探针 `.slice(0, 12)` 取前 12 个标签为列表截断、非计数断言）✓；`/` 斜杠菜单唤起、
  11 选项 ✓（等价覆盖 `probe-blocks-visibility.mjs` 断言面；打包件复跑留 PM）。
- 截图 `docs/mockups/screens-t33/`：`hover-light.png`（浅色 hover）、`menu-open.png`
  （浅色 active 菜单开）、`hover-dark.png`（深色 hover）、`menu-dark.png`（深色 active）、
  `narrow-640.png`（窄窗 640，簇完整在装订线内、无横向滚动条）。

## §5 测试与门禁（§2 验收⑤）

- 新增 `apps/desktop/test/pageview-gutter.test.ts`（9 用例，layout-invariants 静态断言范式 +
  token 算术）：从 tokens.css / PageView.css / editor.css 现场解析求值——
  ① 装订线结构锚点（padding-left calc、left:0、width:max-content、禁回归负偏移）；
  ② 手柄命中区 ≥ 24×24；③ gutter ≥ 8 且落在 12–16；④ **窗口宽 640/900/1280/1600 全参数化**：
  簇在列内、文本列宽为正、overlap=0、热区不盖文本；⑤ 缩进块 gutter 只增不减。
  覆盖「至少两个窗口宽」要求（实为四个）。
- `pnpm -C packages/editor test` **172/172** ✓；`pnpm -C apps/desktop test` **449/449** ✓
  （含既有 `pageview-blocks-ui.test.tsx` 全部断言，**语义零调整**）；`pnpm -r typecheck` ✓；
  `node packages/ui/tokens/no-magic.mjs` ✓；`node packages/ui/tokens/build-tokens.mjs --check` ✓。

## §DEVIATION

1. **正文列宽 720 → 650**（70 装订线计入 `--sc-space-editor-measure`，border-box）。
   Why：口径 A 把装订线预留进列内所致；与设计稿 `01-editor.html` 的实际文本宽
   （720 − 2×gutter − 簇 54 ≈ 586）方向一致（设计稿文本列本就窄于标称 measure），标题列
   （720）不动。How to apply：若 PM 要求文本列保持 720，需改 `.pv-body` max-width 为
   `calc(measure + 装订线)`，一行可调。
2. **`.pv-handle` 几何参数变更**（left −40 → 0、width 24 → max-content=58）：拖拽热区从
   24px 窄轨扩为整簇 58px，拖拽语义（dragstart/dragend 接线）不变。既有测试断言零调整。
3. **观察登记（非本任务，未修）**：探针键入 `/无序` + Enter 出现「触发文本残留 + 另起转换块」
   ——SlashMenu 的 Enter 在 window 冒泡段 preventDefault，救不回 PM 已处理的分块
   （SlashMenu.tsx:78-84），一次 Enter 同时分块 + 应用。人工 IME 输入是否同样复现待 PM
   确认；若确认建议另立任务（动 SlashMenu 键盘通道，超出 T33 红线）。
4. **perf.test commitOps P95 一次抖动**：全量首跑 17.2ms > 预算 16ms（T23 已知 `-r` 并行
   抖动），单跑 14.1ms ✓、全量重跑 449/449 ✓。非本任务引入（CSS 改动不触 commit 路径）。

## §6 PM 复跑（PM 补）

（PM 补：重打包 rc.9 后复跑 `docs/mockups/probe-text-overlap.mjs` 贴四宽度输出原文；
`docs/mockups/probe-blocks-visibility.mjs` 全绿；双主题截图；§DEVIATION 1/3 裁决。）

## §PM 真机复核（2026-09-19，rc.9）

```
全仓 1049 无红（editor 172 / desktop 449；perf「200 块 batch P95」并发假红 → 隔离复跑 13.0ms 通过）
typecheck 9/9、no-magic ✓、build-tokens --check ✓
重打包 0.3.0-rc.9 + PM 探针 docs/mockups/probe-text-overlap.mjs
```

| 窗口宽 | 手柄 | 文本 | overlap | gutter |
|---|---|---|---|---|
| 1280 | 415→443 | 455→503 | **false** | **12** |
| 900 | 310→338 | 350→398 | **false** | **12** |
| 760 | 310→338 | 350→398 | **false** | **12** |
| 640 | 310→338 | 350→398 | **false** | **12** |

✅ 满足验收（`overlap:false` 且 `gutter≥8`）；手柄仍 28×28 未被改窄；回归（hover 显形 / 手柄菜单 12 项 / 斜杠菜单 11 种）全绿。

**DEVIATIONS 追认**：①正文列宽 720→650（装订线计入 measure）✓ 与「文本列宽」设计方向一致；②`.pv-handle` 改 `left:0; width:max-content` 走 token 间距 ✓ 无魔法值；③**新增待办 T35-01**：探针复现「`/` 菜单 Enter 双处理怪癖」（分块 + 应用同时发生 → 文本残留），既有行为、超出本单红线 → PM 已立单；④SSIM-NOTE 说明 ✓。
