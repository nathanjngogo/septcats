# TASK-T59-01 · P2：主区域像素风黑色边框（老板 09-22 晚需求）

> 老板原话：「软件内部，整体的像素风改造还不错，但是若能加上像素风的黑色边框就更好了。例如侧边栏的边框、编辑区的边框等等。」
> 基线：0.4.0 正式版（tag v0.4.0，HEAD=release 落账提交）。这是 0.4.0 后第一个功能单 → R12 批次，产出进 0.4.1/0.5.0。

## 0. 侦察事实（勿重复调查）

- 唯一 token 源 = 仓库根 `DESIGN.md`；改后跑 `node packages/ui/tokens/build-tokens.mjs --write`，提交前 `--check` 必须一致；组件 CSS 只准 `var(--sc-*)`，hex 只准出现在 tokens.css（门禁 `packages/ui/tokens/no-magic.mjs`）。
- 像素语法现状（T53 已落地）：`--sc-bevel-out/-in`、`--sc-pixel-out/-flat` = 2px 硬边 inset/offset 组合（tokens.css:69-72，双主题各一份在 :root 与 [data-theme="dark"]）；模态语法参照 `close/CloseAskDialog.css`（`border: 2px solid var(--sc-color-hairline-strong)` + `--sc-shadow-modal, --sc-pixel-out`）。
- 主区域边界现状（全是 1px hairline，这就是老板觉得"不够像素"的点）：
  | 位置 | 文件:行 | 现状 |
  |---|---|---|
  | 顶栏下沿 | `packages/ui/src/AppShell.css:30` | `border-bottom: 1px hairline` |
  | 侧栏右缘 | `packages/ui/src/AppShell.css:53` | `border-right: 1px hairline` |
  | 编辑区 | `apps/desktop/src/renderer/src/App.css:222`（`.app-editor-col .pv-root`）| `border: 1px hairline` |
  | AI 面板左缘 | `ai/AiChatPanel.css:16` | `border-left: 1px hairline` |
  | 折叠后恢复钮左沿 | `App.css:50` | `border-top: 1px hairline` |
  - 浮层族现状：Dialog/Menu/Popover/CloseAskDialog = `1~2px hairline-strong`。
- **T52 融合红线（本单最大风险，探针有钉死断言）**：标签行与编辑区"连通"= 活动标签下缘与 `.pv-root` 顶缘**无分隔线**、同底色（`t57-01` G8-4、`layout-fusion-t52.test.tsx` 在验）。给 `.pv-root` 加 2px 黑边后，**活动标签必须与黑边融合**（标签压住边框、接缝消失），否则老板一眼看出破相。
- 对比度门禁 `packages/ui/test/contrast.test.ts` 解析 DESIGN.md+tokens.css 逐对计算；新 token 若进平面色表要同步登记。

## 1. 必须做到

1. **新 token `--sc-color-ink-edge`**（像素边框色）：
   - 浅色主题 = `#1A1A1A`（黑，老板点名要"黑色边框"；与 ink 同值但**独立成 token**——语义不同，未来可独立微调）。
   - 深色主题 = `#EDEDED`（近黑底 #141414 上黑框不可见；像素游戏 dark 关卡惯例用亮边描轮廓）。**DESIGN.md 必须写明这条口径与原因**，交付截图双主题给老板看，由老板终审是否接受"深色=亮边"。
   - 双主题各落 `tokens.css`（:root 与 [data-theme="dark"] 两块都要有），`tokens.ts` 同步，跑 `build-tokens.mjs --write`。
2. **边界升级 2px**（宽度统一 2px，与 bevel/模态语法同谱）：上表 5 处主区域边界 `1px hairline` → `2px solid var(--sc-color-ink-edge)`。相邻两条边相接处**只画一次**（网格容器上谁负责哪条边要显式定，禁止双拼出 4px 粗缝）。
3. **T52 标签连通适配**：`.pv-root` 顶部黑边在**活动标签处断开/被标签覆盖**（活动标签 = 编辑区同底色 + 左右 2px 黑边 + 顶部黑边与其连续、下缘无缝），非活动标签间以黑边分隔——像素 NES 窗口标题签的观感。实现自定，验收看截图与探针断言（接缝两元素 getBoundingClientRect 重叠/贴边 + 采样接缝像素非边框色）。
4. **浮层族统一**：Dialog / Menu / Popover / CloseAskDialog / LayoutPicker 模态边框 → `2px ink-edge`（原来 1~2px hairline-strong 的都用它替换）；下拉/tooltip 类小浮层若原无边框则加 2px。
5. **不动清单**：输入框/按钮等控件**不**加黑边（它们已有 bevel 立体语法，再叠黑边会糊）；callout/引用块左竖条、虚线空态、分隔 hr 等非"区域边界"不动；`packages/editor` 内部块级样式不动。
6. **i18n**：无新文案则不动。
7. **测试**：
   - 单测：AppShell/pv-root/AiChatPanel 边框 computed style 断言（jsdom 可读 inline 类断言 CSS 规则存在即可，用现有 css-discipline 工具口径）≥4；
   - 标签连通结构断言进现有 `layout-fusion-t52.test.tsx` 追加 ≥2；
   - 双主题 token 存在性 + 值正确 ≥2；`contrast.test.ts`/`no-magic`/`build-tokens --check` 必须保持绿。
   - desktop 用例 ≥(基线 767)+8。
8. **真机探针** `cdp-e2e-t57-01.mjs` 基础上写 `cdp-e2e-t59-01.mjs`：
   - 四主题×关键区截图：浅/深 ×（主界面 / 活动标签接缝 / 模态弹框 / AI 面板展开）≥8 张存 `screens-t59/`；
   - 像素采样断言：接缝线宽实测=2px；活动标签↔编辑区连接处采样像素 = 编辑区底色（非 ink-edge）；
   - **复跑 T57 G8 五断言 + T52 关键断言**（红线不破）；1184/894 两宽度不溢出复验；
   - 探针跑隔离夹具（`--user-data-dir` + 独立 ROOT），真档案 untouched 断言保留；
   - 交付前杀净 electron，计数=0 贴报告。
9. **报告** `docs/tasks/TASK-T59-01-report.md`：**开工第 2 步先建骨架**（章节全列数字留空），最后一步填真实数字。改动清单、每文件 diff 要点、命令与完整输出、截图索引、决策 D-x、遗留风险。

## 2. 红线

- `DESIGN.md` 允许改（本单就是设计 token 单）：像素边框语法新小节（ink-edge 语义、2px 宽度谱、深色亮边理由、T52 标签融合规则），改后 `build-tokens --write`+`--check` 一致；`docs/PROJECT_PLAN.md` §16 追加一行决议「R12 像素边框」。
- 除上述 2 份文档外：不碰 `packages/core|db|schema|sync|importer|platform`；`packages/ui` 只动 tokens.*/AppShell.css/浮层组件 css/测试；`apps/desktop` 只动本单列出的 CSS 与探针/测试文件；不加依赖；不碰 git；禁 TODO；真档案只读。
- 若发现任务书前提与代码事实不符：最小改动（只增不改）补齐并记 DEVIATION，勿静默绕过。

## 3. 验收锚（PM 独立复跑）

探针全 PASS + 双主题截图人审（老板终审权，深色亮边口径需老板点头）；老断言（T52/T57）零回归；desktop ≥775。
