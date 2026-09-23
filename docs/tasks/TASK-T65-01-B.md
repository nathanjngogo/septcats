# TASK-T65-01-B · 主题画廊续建（CodeBuddy 单）

> 执行者：**CodeBuddy**。工作目录=worktree `E:\Hermes Agent工作空间\Septcats\.worktrees\t65-theme`
> （分支 `feat/t65-theme-gallery`，基线已 merge main：含 paletteState.ts + themes.css 半程资产 + T66 房子钮先例）。
> 不 merge、不 push、不动主树、不起 Electron 探针。开工先建报告骨架 `docs/tasks/TASK-T65-01-B-report.md`。
> 每写完一个测试文件立即跑该文件；ABI 保持 node。

## 已有底座（先读，全部复用、不重做）
- `packages/ui/src/themes.css`（149 行）：六派系（mono|oled|contrast|paper|slate|moss）× 明暗两态的 `--sc-*` 覆写块，
  选择器挂 `[data-palette='x']`，tokens.css 一行未动。**纪律注释在文件头，遵守之。**
- `apps/desktop/src/renderer/src/theme/paletteState.ts`：两层模型（明暗三态不动 × palette 六选一）、
  localStorage 持久化、oled×light 回退逻辑。**缺什么补什么，别推翻。**

## 待建（B 单范围）
1. **palette 应用器**：启动与切换时把 `data-palette` 写到 `documentElement`（对照 layoutState 里 data-theme 的写法，同款管线）；themes.css 需被 ui 包导出链引入（找 ui 包 CSS 汇总入口，若无则在 desktop 侧 import——对照 tokens.css 现在怎么被引）。
2. **主题画廊弹框**（老板 R17 选①「画廊」）：设置页「外观」节 + 顶栏新增调色板入口钮（学 workbench-open 房子钮的接线方式与 testid 惯例 `palette-open`）→ Dialog 内六派系 × 当前明暗态 = 6 张**迷你预览卡**（每卡用该派系 token 值画一个微缩三行界面：标题条/正文两行+一个按钮，纯 CSS token 驱动，不截图不 canvas）；点卡=即时切换+持久化+卡上出「当前」角标；含「跟随明暗三态」现有开关不动。
3. **命令面板**两条：`theme-palette`（打开画廊）+ 六个「切到 X 派系」可合并成一条循环？——不，**六条独立命令**（可发现性优先），aliases 拼音。
4. **i18n 双份**（zh 守禁词门禁；派系中文名=单色/纯黑/高对比/纸张/石墨/苔青，en 对应）。
5. **图标**：`FolderSimple` 等既有像素族取用；调色板入口钮若像素族无对应 glyph，**局部自绘 16 网格**（画法逐格拷贝 makeGlyph，放 theme/ 目录，testid 走 pixel-borders 白名单纪律）——**不许改 packages/ui 像素族文件**（避免与 T67 并行冲突；合并后 PM 统一收编）。

## 测试（新增 test/t65-palettes.test.ts / t65-gallery-ui.test.tsx）
- paletteState：持久化 roundtrip、oled×light 回退、非法值回 mono。
- 应用器：切派系后 `documentElement.dataset.palette` 真值；明暗切换 palette 不丢。
- 画廊 UI：六卡在（含「当前」角标唯一）；点卡切换生效；顶栏入口与命令面板都可达。
- CSS 纪律：新组件 CSS 只 `var(--sc-*)`（no-magic + pixel-borders 全绿——**注意 workbench 灰线教训，框轮廓一律 ink-edge**）。

## DoD
`pnpm -C apps/desktop exec vitest run test/` 全绿 + `pnpm typecheck` 0 + 双门禁绿；报告 DEVIATION 编号列出。
