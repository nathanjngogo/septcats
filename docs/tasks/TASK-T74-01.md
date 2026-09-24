# TASK-T74-01 · 像素 glyph 收编进 @septcats/ui（D3 还债）

> 基线 = main `235f0c8`。源自 T72-01 D3：顶栏店铺图标用了局部 `PixelShopGlyph`（renderer 侧手写），与 `PixelHomeGlyph` 同属「该进设计系统却留在应用层」的挂账——`packages/ui` 是 token/组件单一来源（DESIGN.md 纪律），图标亦应归位。
> 工作目录 = 主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖。
> **排程：等 T73 合入后再跑本单（串行 CB 纪律，勿并行）。**

## 范围

1. **盘点**：grep renderer 全部局部像素 glyph（`T66_LOCAL_GLYPHS` 豁免名单为起点：PixelHomeGlyph、PixelShopGlyph 及其它同类），列清单。
2. **迁移**：统一收进 `packages/ui`（如 `@septcats/ui/icons` 出口；SVG 语法/尺寸保持现状逐像素一致——**真机外观零变化是硬约束**），renderer 侧改 import，删除局部定义。
3. **t58 豁免名单收口**：glyph 进 @septcats/ui 后，`cdp-e2e-t58-01.mjs` 的 `T66_LOCAL_GLYPHS` 豁免应变空（或明确保留原因），纪律测试口径同步。
4. **测试**：packages/ui 侧图标快照/导出面单测（对齐 ui 包既有测风）；desktop 侧顶栏渲染测零回归。

## 红线

- 外观零变化：迁移前后 `probe-frame-check`（G4 描边抽检）+ 真机顶栏区截图 diff 不得出现像素差异（glyph 路径数据原样搬运，禁顺手「优化」）。
- §16/R14 不变；思源字体链不碰。

## 交付

- 报告 `docs/tasks/TASK-T74-01-report.md`（§1 概览 §2 用例计数 §3 DEVIATION §4 文件清单 §5 门禁原始输出）。
- 门禁四件套原始输出（typecheck / desktop vitest 只增不减 / ui vitest 157+N / no-magic ✓）+ t58 探针复跑输出。
- 收尾打印 `CB-T74-01-EXIT=0`。
