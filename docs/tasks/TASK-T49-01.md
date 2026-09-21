# TASK-T49-01 · P3：多维数据表格键盘行为收口（Enter 进编辑）

> PM：Hermes ｜ 工程师：CBL ｜ 前置：0.3.0 已发布（main tip = 7e62941 之后的文档链）
> 来源：T47-01 严复测登记的尾巴——「数字格 Enter 不进入编辑态（既有行为）」。老板 09-21 拍板：小尾巴都改正。

## 0. 现状（复核原始值，来自 docs/tasks/TASK-T47-01-report.md 键盘矩阵）

8 格真值表里：勾选格 Enter/Space 均切换落库；**数字格 Enter/Space 均 `5→5`、`null→null`（不切换，符合预期）——但也没有进入编辑态**。与 Notion 口径差异：Notion 数字/文本格 Enter = 进入编辑。

## 1. 必须做到

1. **文本/数字/日期等可编辑格**：未编辑态下按 **Enter → 进入编辑态**（光标在格内），再按 Enter 提交并回落到选中下一行（或现有提交语义，不回归即可）；**Space 不进入编辑**（避免与滚动/多选抢键，维持现状）。
2. **勾选格**：维持 T47 行为——Enter/Space 双向切换且落库、不误入编辑态（回归红线，不许改坏）。
3. **键盘导航不受扰**：方向键移动选中格、Esc 退出编辑，行为与现状一致。
4. 每条行为有**单测**（packages/dbview 现有测试风格，事件矩阵参数化）+ **真机矩阵更新**：复用/扩展 `docs/mockups/cdp-e2e-t47-01.mjs` 的 8 格矩阵思路，新增「数字格 Enter → dataEditing=true」与「勾选格回归 4 格仍全绿」两组断言。

## 2. 验收（数值化）

- `pnpm -C packages/dbview test` 全绿，新增用例数贴出；
- `pnpm -r typecheck` 9/9；`node packages/ui/tokens/no-magic.mjs` 与 `build-tokens.mjs --check` ✓（若没动 CSS 也应复跑证明无回归）；
- 真机矩阵报告：数字格 Enter 进编辑（贴 `dataEditing` 按前/按后）+ 勾选格 4 格回归值 + DB 读回；
- 深色截图补上一张（T47 尾巴：当时深色截图未成功）。

## 3. 红线

- 只动 `packages/dbview/src/react/**`（键盘分支，最小面）+ 其测试 + 探针/报告；**不碰** i18n 文案（如需新键值，复用现有）、不碰 DESIGN.md/tokens、不碰其它包；
- 不碰 git、不重打包；不改勾选格与导航键语义（回归红线）；
- 真机夹具独立，绝不写 `C:/Users/Administrator/.septcats`；交付前杀掉自起的 dev/electron 进程；
- ABI：跑测试前 `node apps/desktop/scripts/ensure-abi.mjs node`；跑 Electron 前切回 electron。

## 4. 交付

代码 + 单测 + 真机矩阵探针与结果 JSON + 深色截图 + `docs/tasks/TASK-T49-01-report.md`（原始数值逐条 + DEVIATION 逐条；「PM 复跑」节留空）。全仓/打包/入账留 PM。
