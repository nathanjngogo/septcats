# TASK-T58-01 · P1：AI 按钮图标重设计 + 全仓图标像素化（§16.6 修订：像素自制族）

> 老板 2026-09-21/22 原话：「AI的打开按钮图标重新设计。且同时所有图标确保都是像素风。」前置：T56/T57 后（三者共用 Icon.tsx/i18n，严格串行）。

## 0. 侦察事实（勿重复调查）

- 现状图标体系：`packages/ui/src/Icon.tsx` 全仓唯一出口（§16.6 纪律=phosphor 单族，24 个组件 re-export）；业务代码零直接 import phosphor（合规）。AI 钮现用 `Sparkle`（App.tsx:11）。
- 像素语法可复用资产：PM 的 `scripts/pixel-png.mjs`（SVG→原生直画）证明「网格+离散色阶」路线成立；T53 灰阶 token 谱内取色。
- 老板全局视觉基调（T53 已落地）=像素风立体黑白灰 → 图标族与它同源才算「确保像素」。

## 1. 必须做到（核心=换引擎，不是换图标）

1. **新建像素图标模块**：`packages/ui/src/pixelIcons.tsx`（或并入 Icon.tsx，工程师定）：内置一组 **16×16/24×24 网格手写像素 glyph**（`<shape-rendering="crispEdges">` 的 rect 矩阵渲染，纯 React，无图片文件、无新依赖），色值全走 `currentColor` + `opacity` 分档（亮面/中/暗三档=1/.6/.35 之类）保持主题自适配 + 对比度不破。
2. **覆盖清单（24 个现状 glyph 全迁 + 新钮）**：每个 phosphor 图标（List/Note/Plus/Search/GearSix/SidebarSimple/Sparkle/Star/Copy/Trash/Pencil/Clock/ArrowClockwise/Check/Info/Warning/Caret×3/DotsThree/FileText/FolderSimple/Close/WarningOctagon… 以 Icon.tsx 实际 re-export 清单为准，一个不漏）配同名像素 glyph；**API 完全不变**（`<Icon icon={Plus} …>` 调用点零改动）。AI 钮 = **新设计的像素机器人头**（方眼+天线，独立 glyph 不沿用 Sparkle 语义），并加开/关两态（按下=眼灭/天线暗一档）。
3. **视觉质检（本单独有门禁，自动化）**：
   - 脚本 `scripts/check-pixel-icons.mjs`：把每个 glyph 网格直画 16/24 两档 PNG（复用 pixel-png.mjs 思路），**断言半透明像素=0、全灰度/单色（currentColor 通道合法）、16px 档墨迹占比在 18–46% 带内**（防过疏/糊成一团）；输出 `assets/icons/png/` 全家福 + 拼版总览 1 张。
   - **可读性判读**：工程师在报告「三判读区」列每图标 16px 语义自评分+一句话（PM 会抽查复核，虚报=退回）。
4. **菜单/托盘不动**（原生菜单与 ico 已像素化或不受影响）；T55-02 的品牌资产不动。
5. **i18n/tooltip** 新键双语；DESIGN.md §16.6 改写：「唯一出口 Icon.tsx；族=仓内像素 glyph 自绘（phosphor 依赖保留仅作 fallback/文档引用）」+ 迁移对照表；PROJECT_PLAN §16.6 同步。
6. **测试**：glyph 完整性单测（re-export 清单 ⊆ pixel glyph 表，缺一即红）；Icon 渲染快照含像素矩阵断言 ≥6；AI 钮两态测试 ≥2；对比度：像素图标在深浅主题底上按「非文字 ≥3:1」档实测（沿用 T53 色板）；desktop 用例 ≥(T57 后基线)+10。
7. **真机探针** `cdp-e2e-t58-01.mjs`：主界面截图对照（工具条图标已变像素族的像素级证据：截 16× 最近邻放大图存档）；AI 钮点击两态 DOM 断言；全家福 + 编辑器/设置页/暗主题截图 ≥4 张 `screens-t58/`。

## 2. 红线

- 只动 `packages/ui/src/Icon.tsx`/新 pixelIcons 文件与 DESIGN/PLAN 文档（**本单例外允许动 packages/ui**——图标出口在此；core/sync 仍零改动）；不加 npm 依赖；不碰 git；禁 TODO；真档案只读；杀净 electron。
- **任何调用点不得改语义**（icon={X} 的名字不换，只换实现）；旧 phosphor 若留 re-export 兼容层必须注释标记弃用。
- 数值：desktop 全绿、typecheck 9/9、双门禁、selftest OK。

## 3. 交付

代码+glyph 表+质检脚本+全家福/拼版+探针+≥4 截图+`docs/tasks/TASK-T58-01-report.md`（含三判读区+原始值+DEVIATION；PM 复跑节留空）。全仓/打包留 PM。
