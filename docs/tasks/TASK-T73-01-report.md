# T73-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T73-01.md`（基线 main `e26e98e`）

## §1 交付概览（DoD 自检）

- [ ] openExternal IPC（http/https 白名单 + E_PROTOCOL/E_EMPTY 结构化拒绝）
- [ ] preload + window.d.ts 类型面
- [ ] 书签卡 URL 条目点击跳转接线（收藏交互零回归）
- [ ] i18n 成对 + toast 反馈
- [ ] t73-* 测试落盘（协议白名单/审计 host-only/书签卡渲染）

## §2 用例计数

（CB 填：新增 N 例、总数）

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| （无则写「无」） | | | |

## §4 文件改动清单

（CB 填：路径 + 一行说明）

## §5 红线自检

- [ ] §16/R14：新样式全吃 `var(--sc-*)`，无裸 hex/px 框线
- [ ] 隐私：URL 原文不进审计正文（只记 host）；启动零外联不变
- [ ] 无省略号占位常量（存储键/通道名逐字节核对源码）

## §6 门禁原始输出

（CB 贴：typecheck / desktop vitest / ui vitest / no-magic 四段原始计数）
