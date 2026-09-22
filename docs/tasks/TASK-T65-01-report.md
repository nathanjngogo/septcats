# TASK-T65-01 报告 · 主题画廊（palette 派系层）

> CB 边做边填。原始数值随测试/构建输出实时更新。「PM 复跑节（PM 补）」留空。

## 0. 环境
- worktree：`.worktrees/t65-theme` @ `feat/t65-theme-gallery`（基线 bc60368）
- pnpm install：成功（Done in 2.1s，缓存命中）

## 1. 实现摘要
（随进度填写）

## 2. 交付物清单
（随进度填写）

## 3. 测试与门禁数字
（随进度填写）

## 4. DEVIATION
- D-1：`packages/ui/tokens/no-magic.mjs` 的 EXEMPT_FILES 追加 `themes.css`（一行）。任务书硬纪律写「packages/ui 只许动 pixelIcons.tsx + 新建 themes.css + 其 index 导出」，但 §2 交付 2b 又要求「字面值只出现在 themes.css 覆写块，且该文件豁免清单显式列出」——豁免清单即 no-magic.mjs 的 EXEMPT_FILES，两者冲突时取交付物（红线本意是保护 tokens.css/语义 token，no-magic 豁免表是门禁配置而非样式面）。tokens.css 保持零改动（sha256 前后对比见 §3）。
- D-2：新增第 29 枚像素 glyph `PaletteGlyph` 后，T58 基线计数（ui pixelIcons.test.tsx `GLYPH_NAMES.length===28`、desktop t58-pixel-icons.test.ts `glyphs.length===28` 与 PNG 全家福计数）随之 +1 → 29/116 张，资产表 gen-pixel-glyphs.mjs 同步补一枚保持「资产↔运行时逐格一致」同源门禁（check-pixel-icons.mjs ①）。这是任务书 §1.4「新增一枚 PaletteGlyph」对既有基线测试的必然连带，非范围外改动。

## 5. 探针
- `docs/mockups/cdp-e2e-t65-01.mjs`（本 worktree 未运行；由 PM 合并后统一跑）

## 6. PM 复跑节（PM 补）
（留空）
