# TASK-T62-01 · P1：全局像素黑框线（老板 09-22：「整个程序的所有框的线条都做成像素风的黑线条」）

> 前置：R12/T59 已立 `ink-edge` token 与「主区域边界+浮层」口径；本单把口径扩到**全程序所有框**。串行队列头名，单飞。

## 0. 侦察事实（PM 已盘点，勿重复调查）

全仓产品 CSS border 声明 ~352 处、仅 17 处吃 ink-edge。**未覆盖清单（border 数）**：

- `packages/ui/src/`：Input 5 / Select 5 / Tag 4 / Checkbox 4 / Spinner 4 / SyncPill 3 / RadioGroup 3 / Button 3 / Menu 3 / Switch 2 / ProgressBar 2 / Kbd 2 / ErrorPanel 2 / EmptyState 2 / Tooltip 2 / Toast 2 / Dialog 2 / tokens 2 / Skeleton 1 / IconButton 1
- `apps/desktop/src/renderer/src/`：AiChatPanel 16 / ImportWizard 15 / LayoutEditorPage 14 / ManualView 12 / SettingsPage 11 / SyncStatus 10 / AiSection 8 / LayoutPreview 8 / CommandPalette 8 / App 8 / SearchPage 6 / PageView 6 / LayoutPicker 6 / TabsBar 6 / WikiLanding 3 / CloseAskDialog 3 / DbPage 2 / TrashList 1
- `packages/dbview/src/react/DbView.css`：40（表格网格线主战场）
- `packages/editor/src/react/editor.css`：21（块 UI/焦点线）
- **不动**：`packages/core/coverage/**`（生成物）、`docs/mockups/**`（演示页）、已吃 ink-edge 的 17 处（T59 成果不许改回）

## 1. 统一口径（设计决策，PM 已定死）

1. **外框轮廓**（面板/卡片/输入控件/浮层/弹窗/按钮的所有 `border`）：`2px solid var(--sc-ink-edge)`。
2. **内部网格线/分隔线**（表格单元格四边、列头分隔、列表 hairline、编辑器块内分隔）：`1px solid var(--sc-ink-edge)`——同一种黑，靠宽度分层。若某处 1px 黑网格在真机上噪得看不清内容，允许该处降为 `var(--sc-border-strong)`（若无此 token 则不加新 token、保持黑，DEVIATION 报文字说明位置），**不许自己发明颜色**。
3. **focus/active 态**：黑线加粗一档或位移 1px（复用 T53 按压下沉语法），禁彩色光晕（`box-shadow: ... accent` 类改灰/黑）。
4. **装饰性虚线/点线**（拖放落位提示、占位框）：保持线型，颜色改 `var(--sc-ink-edge)`。
5. 半透明/浅灰的旧 border（`var(--sc-border)` 系）在「框轮廓」语义处一律升为 ink-edge；纯滚动条/内阴影类非框线不动。
6. **禁改 token 定义值**（tokens.css 里 ink-edge 色值钉死，深浅两主题都由它出）；新文件里不许写 hex，全走 `var(--sc-*)`（no-magic 门禁）。
7. `--sc-border` 等既有 token **不删除不改名**（仍可能被内部线/滚动条引用），只是框轮廓不再首选它们。

## 2. 交付要求

1. 按 §0 清单逐文件替换；每改完一个包跑该包测试（`pnpm -C packages/ui test` 等）——**绝不交没跑过的改动**。
2. DESIGN.md「Pixel Borders」小节扩写：从「主区域+浮层」→「全局框线」口径（外框 2px/内网格 1px 宽度谱），与 §16.11/§16 红线同步；跑 `node packages/ui/tokens/build-tokens.mjs --check` 保持一致。
3. 单测（新增，建议 `packages/ui/test/pixel-borders.test.ts` 或 grep 型纪律测试）：断言产品 CSS（排除 coverage/mockups）中**不存在**「框轮廓语义仍用 `--sc-border`」的残留——实现法：白名单列表显式豁免纯内线处，其余 border 行必须含 `ink-edge`；每次运行打印命中数。
4. 真机探针 `docs/mockups/cdp-e2e-t62-01.mjs`（复用 t59 探针的像素采样法）：
   - 浅/深双主题各截：输入框（设置页）、按钮（询问框）、AI 面板、导入向导、命令面板、布局编辑器、DbView 表格页（造一张含 ≥3 列的库）、说明书视图；
   - `getComputedStyle` 断言 ≥12 处代表框 `borderTopWidth≥2px && borderTopColor==rgb(26,26,26)`（浅色）/ 深色主题等于 ink-edge 深色值；DbView 内网格线断言 1px 黑；
   - 截图存 `docs/mockups/screens-t62/`，results.json 落盘。
5. 报告 `docs/tasks/TASK-T62-01-report.md`：**开工前两步内先建骨架**（含空 DEVIATION 节与「PM 复跑节（PM 补）」占位），边做边填数值。

## 3. 红线

- `packages/sync`、`packages/core` 零改动；`packages/dbview`/`packages/editor` 允许**仅 CSS**改动（TS/逻辑零碰——这是本单对冻结纪律的 PM 预授权边界，越界即回退）。
- 不改任何组件 props/API/类名结构（纯 CSS 值替换 + 必要选择器补写）。
- 不碰 git；禁 TODO/占位；真档案 `~/.septcats` 只读（探针走 `_scratch` 夹具）。
- 交付前杀净 electron、`wmic` 查 node 孤儿贴计数=0；ABI：测试 `ensure-abi node`，Electron 前 `ensure-abi electron` + `pnpm -C apps/desktop build`。
- 全仓 `pnpm -r test` / typecheck / 双门禁 / selftest 由 PM 收口，你只跑受影响包。

## 4. DoD（PM 复跑判据）

- 受影响包测试无红；`pnpm -r typecheck` 0 错；no-magic + css-discipline 双门禁 ✓；`node packages/ui/tokens/build-tokens.mjs --check` 一致。
- 探针：12+ 处框线 computed 值双主题命中；截图 8 组×2 主题落地。
- 视觉抽判：PM 用 ASCII/像素采样交叉抽查 DbView 网格「黑线是否噪到影响阅读」，不达标处按 §1.2 例外条款回退一档并记 DEVIATION。
