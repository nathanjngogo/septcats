创意 IDEA-A：专注模式（F9 一键无干扰写作态）

- 入口×3 同一状态源：顶栏「专注」钮 / F9 / 命令面板「切换专注模式」；再按 F9 或 Esc 退出
  （命令面板开着时不抢键；role=dialog 弹层在场时 Esc 让位弹层——一次按键只干一件事）
- 效果：收起一级导轨、二级侧栏、顶栏读数区与全部动作钮（CSS 排除法只留专注钮当出口）；
  窗控 min/max/close 不碰（C 轮红线）；编辑列不二次收窄（与 PageView --sc-layout-measure 不打架）
- 口径：旁路瞬时态（localStorage septcats.focus + html[data-focus]），不进 Op 账本、不同步；
  默认不记忆；右下角「专注中 · Esc 退出」角标纯视觉 aria-hidden
- 提纯 useFocusHotkeys（FocusMode.tsx）：App 与测试同一实现——此前逻辑内联 App+测试复制同款=假绿，已修
- 测试：idea-a-focus.test 7 例；真机 cdp-e2e-idea-a 8/8（含档案零触碰）
- 门禁：desktop 1472/1472（131 文件）· ui 192 · tsc 0 · no-magic 0；已重打包
- 台账：CHANGELOG 创意项 + MILESTONES R62
