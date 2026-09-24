# TASK-T73-01 · openExternal 通道 + 书签卡跳转闭环

> 基线 = main `e26e98e`（0.4.2-rc.1 同码）。源自 T71-01 D-1：`window.septcats` 无 openExternal 通道，书签卡只能收藏不能跳转（功能缺口挂账）。
> 工作目录 = 主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖。

## 范围（全部）

1. **main 通道**：`shell.openExternal` 包装 IPC（注册进 `src/main/ipc.ts` 既有 statements 体系，走 `withLimiter`；审计面若既有 audit 体系则记「打开外部链接」事件，**URL 原文不进审计正文**——隐私红线，只记 host，与既有敏感面口径一致）。
   - **安全护栏（必须）**：仅放行 `http:`/`https:` 协议（new URL 解析 + 协议白名单，其余一律拒绝并返回结构化错误 `E_PROTOCOL`）；拒绝空/畸形 URL。
2. **preload + 类型**：`window.septcats.shell.openExternal({url}) → {ok, error?}`；`src/types/window.d.ts` 同步。
3. **书签卡接线**：`workbench/cards.tsx` BookmarksCardBody——条目有 URL 时点击行跳外部（保留现有收藏/取消交互不回归）；无 URL 条目行为不变。失败给 toast（复用既有 toast 口径）。
4. **i18n**：新增文案 `zh-CN.ts`/`en-US.ts` 成对；中文面禁「数据库」词纪律不变。
5. **测试**（落 `apps/desktop/test/`，命名 t73-*）：
   - 协议白名单单测：https 放行（mock shell）、file://、javascript:、空串、畸形 = 全部拒绝；
   - 审计不含 URL 原文断言（记 host 即过）；
   - 书签卡渲染测：URL 条目点击调通道（vi.mock）、失败 toast。

## 红线

- §16 UI 红线不变；组件 CSS 只吃 `var(--sc-*)` token；全局黑框线纪律（R14）。
- 启动零外联不变（openExternal 只由用户点击触发）。
- 不碰 `C:/Users/Administrator/.septcats/`。
- 字符串常量禁「压缩省略号」占位写法（T71 D-4 教训）；键名/API 面逐字对照源码。

## 交付

- 报告 `docs/tasks/TASK-T73-01-report.md`（§2 用例计数、DEVIATION 登记、文件清单、红线自检、门禁原始输出五节骨架前置）。
- 门禁四件套原始输出：`pnpm typecheck` 0 错 / `pnpm -C apps/desktop exec vitest run` 全绿只增不减 / `pnpm -C packages/ui exec vitest run` 157 / `node packages/ui/tokens/no-magic.mjs` ✓。
- 收尾打印 `CB-T73-01-EXIT=0`。
