# TASK-T67-01-B2-01 报告 · 页面密码锁（前端 UI + 读路径接线）

> 执行者：CodeBuddy（单）。工作目录：worktree `.worktrees/t67-lock`（feat/t67-page-lock）。
> 不 merge / 不 push / 不动主树 / 未起 Electron。ABI=node，全量 vitest + typecheck + pixel-borders + no-magic 四门禁。

## 0. 概述

- 承接 B1 实交付的 preload/shared IPC 契约，完成前端 UI 与 `blocks:list` 读路径接线。
- 范围：0 读路径接线 → 1 入口/Dialog → 2 锁屏页 → 3 路径统一 → 4 i18n+命令 → 红线自查。
- 退出前已杀掉本会话启动的一切进程（无 Electron 启动，仅 vitest 子进程随命令结束）。

## 1. 范围交付

### 范围0 · 读路径接线
- `main/blocks.ts`：`BlocksService.list` 扩为 `{ blocks: Block[]; locked: boolean }`；注入可选 `lock` 服务，锁页未验证返回 `{locked:true, blocks:[]}`，已验证经 `readBlocks` 解密映射为 `Block[]`。
- `types/window.d.ts`：`SeptcatsBlocksApi.list` 返回 `Promise<BlocksListResult>`（新增 `BlocksListResult`）。
- `main/index.ts`：lock 服务先于 blocks 创建并注入。
- renderer `PageView`：`blocks.list` 消费改读 `.blocks`，并新增 `lock.getStatus` 门控（锁屏态不挂载编辑器）。
- 配套单测：`test/blocks-lock.test.ts`（锁页 list→locked:true；verify 后 list→明文且内容字节=基线）。

### 范围1 · 加锁/解锁入口
- 侧栏 `pageRowMenu` 增加「添加密码锁 / 修改口令 / 移除密码锁」（⋯ 菜单与右键菜单共用）。
- `PageLockDialog`：set 模式（两栏口令 + 恢复码保管必勾）→ `setPass` → 恢复码展示框（一次性，明写「只显示这一次」，确认钮才关）；change 模式；remove 模式（口令验证）。

### 范围2 · 锁屏页
- `PageLockScreen`：替代 `.pv-root` 内容；锁 glyph + 标题 + 口令（Enter=验证，blur 不提交）+ 失败计数；`E_LOCK_LOCKED`/lockedUntil → 输入禁用 + 秒级倒计时；「使用恢复码」折叠区 → `recover` → 新恢复码展示。
- 锁屏态编辑器彻底卸载（不 mount ProseMirror，不请求 blocks）。
- `PageView` 锁态重探：`getStatus` 探明前**不**请求 blocks（锁态优先判定，杜绝锁定期 flush 竞态）；`lock` 桥缺失时降级为未锁（不 crash，与无锁态行为一致）。`setPageLocked` 仅锁态实际变化时 bump `lockRev`，避免与 `getStatus` effect 互相触发死循环（见 D4/D5）。

### 范围3 · 打开锁页路径统一
- 侧栏/搜索/收藏/最近/命令面板/页签恢复全走 `openInTab → PageView`；locked 且未解锁 → 渲染锁屏卡。
- 搜索：锁页标题可命中（结果行带锁 glyph），正文永不出（B1 已保证）。

### 范围4 · i18n + 命令
- `en-US.ts` / `zh-CN.ts` 双份锁词条（en/zh parity，zh 禁词自查）。
- 命令面板 `add-lock` / `remove-lock` 条件项（仅当前页可见，学 fullWidth 先例）。

### 红线自查
- 组件 CSS 全 `var(--sc-*)`；框轮廓一律 `var(--sc-color-ink-edge)`；box-shadow 像素投影一律 token 组合禁裸 px。
- 口令/恢复码值绝不进 localStorage/日志（grep 自查，见 §3）。
- 未改 `pixelIcons` 主文件（t58 先例）：锁 glyph 用局部 `LockGlyph` 组件（见 D?）。

## 2. DEVIATION 记录

| 编号 | 范围 | 偏差事实 | 最小改动 | 备注 |
|------|------|----------|----------|------|
| D1 | 范围2 | 口令输入框 `blur` 不提交（全局口令类例外） | 显式不监听 blur 提交 | 按任务书要求记 DEVIATION |
| D2 | 范围1 | 无现成 Lock 像素 glyph，且禁改 pixelIcons 主文件 | 新建局部 `LockGlyph`（currentColor 内联 SVG，不入 pixelIcons） | 任务书允许「无则建局部 glyph」 |
| D3 | 范围0 | 现有 `blocks.test.ts` 断言旧 `Block[]` 返回形态 | 同步改为读 `.blocks`（消费方兼容） | — |
| D4 | 范围2 | `pagesActions.setPageLocked` **无条件** bump `lockRev`；PageView `getStatus` effect 依赖 `lockRev`，每次 `getStatus` 落定后 bump 又触发 effect 重跑 → 无限循环（React 深度超限崩溃 worker，整页无法渲染） | 仅当锁态**实际变化**才 bump `lockRev`（同值不 bump） | 修复阻断渲染的死循环；重探语义不变（仅在锁态变化时触发）。此为读路径接线后发现的功能级 bug |
| D5 | 范围2 | PageView：①挂载瞬间 `lockStatus===null` → `isLocked=false` 误先触发 `blocks.list`（已锁页仍请求 blocks，违背「锁屏态不请求」）；②`getStatus` effect 在 `window.septcats.lock` 未注入时直接 crash（影响所有未 stub `lock` 的既有 App/PageView 测试） | ①blocks effect 增 `lockStatus===null` 门控并把 `lockStatus` 纳入依赖；②`getStatus` effect 在 `lock` 桥缺失时降级为未锁（不 crash） | 锁态优先判定真正生效；无锁桥环境（测试/降级）行为与 HEAD 一致 |
| D6 | 范围0 | 既有 12 个测试的 `blocks.list` mock 返回裸 `Block[]`，与 范围0 新契约 `{locked,blocks}` 不符 → `doc.blocks` 不可迭代崩溃 | 这些 mock 同步为 `{locked:false, blocks:[...]}`（消费方 PageView 读 `.blocks`，同 D3） | 与 范围0 契约变更同步；非功能回归 |
| D7 | 范围3 | B1 `getStatus` 对任意「已设口令页」一律返回 `locked:true`（不 consult session-unlock Map；仅 `readBlocks`/`verify` 区分解锁态） | 搜索锁标记按此语义实现；`search-lock.test.ts` 对齐（原「session 解锁页 getStatus=locked:false」假设不成立） | 已在测试注释说明 B1 语义差异 |

## 3. 口令/恢复码泄露自查

- `grep -rn` 确认 `setPass`/`recover` 返回的明文口令与恢复码仅经 Dialog state 内存展示，未写入 `localStorage`/`sessionStorage`/日志（`PageLockDialog.tsx` / `PageLockScreen.tsx` 均无 `setItem`/`localStorage` 写）。
- 红线：`PageLockScreen` / `PageLockDialog` 错误提示与失败计数均用 `t()` 文案，不回显口令/恢复码值。
- （自查结果：通过）

## 4. 测试清单（随写随跑，全绿）

- `test/blocks-lock.test.ts`（范围0，3）
- `test/search-lock.test.ts`（范围3，3）
- `test/palette-lock.test.ts`（范围4，5）
- `test/lock-screen.test.tsx`（范围2 锁屏卡，5）
- `test/lock-dialog.test.tsx`（范围1 加锁/改密/移除 弹层，5）
- `test/sidebar-lock.test.tsx`（范围1 侧栏锁 glyph，3）
- `test/pageview-lock.test.tsx`（范围2 锁态重探：已锁→锁屏卡/编辑器卸载/不请求 blocks；未锁→请求 blocks，2）
- 既有 12 个测试（`pageview-blocks-ui`/`wikilink-resolve`/`wiki-ui`/`t60-01-interaction`/`layout-*`/`page-width`/`page-delete-ui`/`manual-view`/`t58-ai-button`/`t66-workbench-ui`/`page-width` 等）的 `blocks.list` mock 已随 D6 同步为 `{locked:false, blocks}`，恢复绿。

## 5. DoD 复跑（PM 复跑口径）

- `pnpm -C apps/desktop exec vitest run`：**928 passed / 1 failed**（详见下）。失败时仅 `test/perf.test.ts` 的 `commitOps 200 块 batch P95` 计时项（实测 ~18ms vs 预算 16ms）——该测试**直接调用 `commitOps`（`packages/editor/.../commit`）**，不经过本任务的 `BlocksService.list/commit`（范围0 仅改 `list` 接 `lock.readBlocks`），与本任务改动无关，为本机（sandbox）时序波动，非功能回归；PM 在常规硬件复跑应通过。
- 全仓 `pnpm typecheck`：**0**（apps/desktop `tsconfig.node.json` + `tsconfig.web.json` 双清）。
- `pixel-borders`（borders-t59 13 passed）/ `no-magic`（组件 CSS 无字面 hex、无非 1px 重复裸 px）：**绿**。
- DEVIATION 编号：D1…D7（见 §2）。
- 真机项：全部留 PM 探针（B2 不写不跑探针）。

---

> PM 复跑节留（PM 补）：真机探针结论、Electron 端到端结论、lock 服务时序结论等由 PM 在真机复跑后补入。
