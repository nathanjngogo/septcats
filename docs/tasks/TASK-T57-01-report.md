# TASK-T57-01 交付报告 · 布局选择弹框 + 独立布局编辑器

> ⚠️ 本报告由 **PM 代写**（09-22）：CB 会话 150 轮耗尽未交报告（同 T54-01 先例）。
> 判定依据 = 工作树代码完整 + PM 独立全套验证（非 CB 自述），全部数字为 PM 实跑。

## 1. 改动清单（工作树实证，HEAD ce87a84 之上）

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `layout/LayoutPicker.tsx/.css` | 新增 | 像素模态快选弹框：3 张 preset 卡（CSS 抽象预览，零位图 `<img>` 断言实证）+ 当前项 aria-pressed 高亮 + 「自定义编辑…」；点卡即时应用不关框（可连试），Esc/遮罩关闭不改动 |
| `layout/LayoutEditorPage.tsx/.css` | 新增 | 独立编辑器页：左列预设卡+大预览，右列细项表单（侧栏位置/宽度滑杆 200–320、AI 面板位、正文宽度、密度、主题）；顶部恢复默认+完成；编辑器视图摘除 `--fused`（T52 契约：顶栏钮回来） |
| `layout/LayoutPreview.tsx/.css` | 新增 | CSS/div 微缩窗口示意（侧栏/正文/AI 位灰阶抽象），弹框卡与编辑器大图同源 |
| `layout/layoutState.ts` | 修改 | +6 纯函数：`defaultLayoutWithTheme` / `previewSidebarPercent` / `previewContentPercent` / `layoutPreviewOf` / `layoutPreviewForPreset` / `AiPreviewPlacement` 类型 |
| `App.tsx` | 修改 | 顶栏钮序 Sync→Plus→**Layout**→GearSix；`view:'layout'` 状态机（editor→layout→editor） |
| `LayoutSection.tsx` | 修改 | 设置页旧编辑区改为「在布局编辑器」单入口（不留双 UI） |
| `palette/commands.ts` | 修改 | 命令面板注册「布局编辑器」 |
| `i18n/zh-CN.ts`+`en-US.ts` | 修改 | 15 双语键 |
| `test/layout-picker-t57.test.tsx` 等 3 件 | 新增 | **28 测试**（picker 渲染/选卡应用/Esc 不改动/编辑器回写/view 状态机） |
| `test/layout-ui.test.tsx` | 修改 | 适配新钮序 |

## 2. PM 验证记录（09-22，全部实跑）

```
pretest(node ABI) → vitest run:  Test Files 56 passed | 11 skipped · Tests 637 passed | 19 skipped (0 fail)
  注：727 为 electron-ABI 口径基线；node-ABI 下 11 个 sqlite 相关件 skip=19 用例，637 即全绿
T57 三新件独立跑:  Tests 28 passed (28)
pnpm -r typecheck: Done（0 error，双 tsconfig）
apps/desktop selftest: SELFTEST OK（FTS 2000 页重算 18.0ms）
ensure-abi electron + build: ✓ built in 3.81s
真机探针 cdp-e2e-t57-01.mjs:  28 PASS / 0 FAIL（一次过，无返工）
  realRoot untouched=true · window.close() 优雅退出 · electron 残留计数=0（tasklist 实证）
红线自查: git diff --name-only | grep packages/ → 空（packages/** 零改动）· 无新依赖 · 无 TODO
```

探针关键实证（§1.7 验收锚）：
- **选 focus → 侧栏 getBoundingClientRect 240→0px**（display:none），measure 变量 650→900，预设整份套用；
- **真实鼠标拖滑杆 → 侧栏 DOM 实测 240→320**，精确回写 300 → 侧栏=300px=`--sc-layout-sidebar`，预览图内联变量随动 27.3%；
- localStorage `septcats.layout` 落盘 preset=custom/width=300；恢复默认四项回位；
- **T52 红线全复跑**：侧栏通高 top=0、顶栏左缘=侧栏右缘(240)、折叠钮在标签行最左(Δy=0.0)、标签连通(0px 分隔+pv-root 同色)、装订线 70px/gutter 12 无重叠；
- 1184/894 两宽度 × 两视图：纵横零滚动、侧栏 top 恒 0；
- 英文态弹框/编辑器全英（title/hint/card/customize/done/reset/slider）。

## 3. 决策与差异记录

- **D-1（PM 追认）**：弹框选卡后**不关框**（任务书未钉死）——可连续试卡，高亮转移，体验更顺，G3-3 钉为契约。
- **D-2（PM 追认）**：AI 预览位增加 `'none'` 枚举（`AiPreviewPlacement`）——focus 预设无 AI 面板需要该态，validate/clamp 同步覆盖。
- **D-3（PM 追认）**：布局编辑器视图期间 `.app-shell--fused` 摘除——编辑器是全宽页，fused 语义（顶栏钮隐藏）不适用，G4-3 钉断言。
- **D-4**：CB 150 轮耗尽未写报告=第 2 次（T54 后）；下单起 max-turns 提到 200 且任务书把「先写报告骨架再收尾」列为倒数第 2 步纪律。

## 4. 遗留风险

- 无本单范围内缺陷。探针截图 13 张在 `docs/mockups/screens-t57/`（三卡放大/中英弹框/编辑器/width300/两宽度）。
