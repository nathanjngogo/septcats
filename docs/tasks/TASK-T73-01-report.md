# T73-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T73-01.md`（基线 main `e26e98e`）。本单基线 = 主树 main `f34cb9b`（立项单，同码）。
> 交付：openExternal 通道 + 书签卡跳转闭环（协议白名单护栏 + 审计 host-only 隐私红线）。

## §1 交付概览（DoD 自检）

- [x] openExternal IPC（http/https 白名单 + E_PROTOCOL/E_EMPTY 结构化拒绝；另增 E_MALFORMED/E_OPEN_FAILED，见 §3 D-2）
- [x] preload + window.d.ts 类型面
- [x] 书签卡 URL 条目点击跳转接线（收藏交互零回归，T71 用例全绿）
- [x] i18n 成对 + toast 反馈
- [x] t73-* 测试落盘（协议白名单/审计 host-only/书签卡渲染）

实现要点（与任务书逐条对照）：

1. **main 通道**：`shell:openExternal`（`shared/ipc.ts` 单一来源）。服务住新文件
   `src/main/shell.ts`（DI：不 import electron，纯 Node 可测）。护栏 = `new URL` 解析 +
   `http:`/`https:` 白名单；空串 → `E_EMPTY`，畸形串/越界协议 → `E_PROTOCOL`，
   参数形状非法 → `E_MALFORMED`，系统打开失败 → `E_OPEN_FAILED`。全部**结构化返回**
   （`{ok:true}` | `{ok:false,error:{code,message}}`），不抛异常。
   - 审计：`index.ts` 注入 `Logger.forModule('shell')`，只记 `{host, protocol}`，
     **URL 原文（path/query/fragment）绝不进审计正文**（隐私红线）。
   - 放行后交 `electron.shell.openExternal(href)`（href 经 WHATWG 归一化，如补尾斜杠）。
2. **preload + 类型**：`window.septcats.shell.openExternal({url}) → {ok, error?}`
   （`preload/index.ts` + `types/window.d.ts` 的 `SeptcatsShellApi`）。
3. **书签卡接线**：`cards.tsx` BookmarksCardBody 条目点击经全局桥调 `shell.openExternal`；
   `ok:false` 或通道抛错 → `pushToast(..., 'danger')`；桥未接（降级/旧夹具）静默不误报。
   收藏/取消交互原样保留，`wb-bookmarks-*` testid 未动。
4. **i18n**：`bookmarkRecorded` → `bookmarkOpenFailed`（zh-CN / en-US 成对，见 §3 D-4）。
5. **测试**：`test/t73-open-external.test.ts`（16 例）、`test/t73-bookmarks-open.test.tsx`（5 例）。

## §2 用例计数

- 新增：**21 例**（`t73-open-external.test.ts` 16 + `t73-bookmarks-open.test.tsx` 5）。
- desktop 全量：`Test Files 83 passed | 13 skipped (96)` / `Tests 896 passed | 25 skipped (921)`。
  - 基线（改前本机同命令）：`Test Files 81 passed | 13 skipped (94)` / `Tests 875 passed | 25 skipped (900)`。
  - 差值：**+2 文件 / +21 用例，skip 数不变**（只增不减 ✓）。
- ui：`Tests 157 passed (157)`（与本单基线一致，未动 ui 包）。

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D-1 | 任务书 §范围1 指 `src/main/ipc.ts`「既有 statements 体系，走 `withLimiter`」——仓库中**两者均不存在**（全仓 grep `withLimiter` = 0；`statements` 指 `src/db/statements.ts` 的 SQL 白名单，仅服务 DB 读写） | 按仓库既有「每域一 service 文件 + `register*Ipc(service, registrar)`」范式，落新文件 `src/main/shell.ts`，经 `index.ts` 的 `dbViewRegistrar()` 注册 | openExternal 不触库、不入账（无 SQL、无 op），本就不该走 statements/账本；强行套用会制造伪依赖 |
| D-2 | 拒绝码除点名 `E_PROTOCOL`/`E_EMPTY` 外，另设 `E_MALFORMED`、`E_OPEN_FAILED` | 四码全结构化返回、不抛异常 | 与既有 IPC 边界 `E_MALFORMED` 口径一致；系统打开失败需与协议拒绝区分以便诊断 |
| D-3 | 任务书「审计面若既有 audit 体系」——仓库无「事件审计表/事件流」（grep 命中的 `audit` 是 sync 段名巡检与 op_ledger 概念） | 复用既有文件日志器 `Logger.forModule('shell')` 作审计落点 | 这是仓库唯一的可写事件面；已按红线只记 `{host, protocol}` |
| D-4 | `bookmarkRecorded`（'已收藏（当前版本不跳转）'）随本单缺口关闭而**删除**（两字典同步） | 删除旧键、新增 `bookmarkOpenFailed` | 旧文案语义已失效；i18n 门禁要求 zh/en 键集合等价，故成对增删 |
| D-5 | 任务书 §范围3「无 URL 条目行为不变」——实际**不存在**可渲染的无 URL 条目（`sanitizeBookmarks` 只保留 url 为非空字符串者） | 不落额外 UI 分支 | 「行为不变」天然成立，无分支可动；已在此显式登记 |
| D-6 | 任务书 §测试括注「（vi.mock）」 | 测试用 `vi.stubGlobal('septcats', …)` 假桥 | 与仓库既有卡测范式（`t71-newcards.test.tsx`）一致；断言等价（点击 → 通道桩被调用） |

## §4 文件改动清单

| 路径 | 说明 |
|---|---|
| `apps/desktop/src/shared/ipc.ts` | 新增 `CHANNEL_SHELL_OPEN_EXTERNAL='shell:openExternal'`、`SHELL_CHANNELS`、`ShellChannel`、`ShellErrorCode`、`ShellOpenInput`/`ShellOpenError`/`ShellOpenResult`（通道与结果形状单一来源） |
| `apps/desktop/src/main/shell.ts`（新） | `resolveExternalUrl` 协议白名单纯函数 + `createShellService`（注入 openExternal + log 审计）+ `registerShellIpc`；不 import electron |
| `apps/desktop/src/main/index.ts` | import `shell`（electron）+ `createShellService`/`registerShellIpc`；`registerIpcHandlers` 内注册 `shell:openExternal`，注入 `shell.openExternal` 与 `Logger.forModule('shell')` 审计（记 host+protocol） |
| `apps/desktop/src/preload/index.ts` | 新增 `shell.openExternal` 桥（`invoke(SHELL_CHANNELS.openExternal, input)`）+ import `SHELL_CHANNELS` |
| `apps/desktop/src/types/window.d.ts` | 新增 `SeptcatsShellApi`；`SeptcatsApi` 增 `shell` 字段；import `ShellOpenInput`/`ShellOpenResult` |
| `apps/desktop/src/renderer/src/workbench/cards.tsx` | BookmarksCardBody：条目点击 `openBookmark()` → 桥调 `shell.openExternal`；失败/抛错 → danger toast；删 D-1 注释；收藏/取消与 testid 不动 |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `bookmarkRecorded` 删除，新增 `bookmarkOpenFailed: '打开链接失败'` |
| `apps/desktop/src/renderer/src/i18n/en-US.ts` | 同上（`bookmarkOpenFailed: 'Failed to open link'`） |
| `apps/desktop/test/t73-open-external.test.ts`（新） | 协议白名单 16 例（放行/各越界/空/畸形/非字符串/归一化/审计 host-only/注册面） |
| `apps/desktop/test/t73-bookmarks-open.test.tsx`（新） | 书签卡渲染 5 例（点击调通道/结构化拒绝 toast/抛错 toast/桥未接静默/收藏取消零回归） |

未动：`src/db/statements.ts`（SQL_IDS 仍 79）、任何 `package.json`/锁文件、schema/迁移、`.septcats/`。

## §5 红线自检

- [x] §16/R14：本单**未新增组件 CSS**（仅卡片点击逻辑 + i18n 文案），无裸 hex/px 框线；`no-magic` ✓。
- [x] 隐私：审计只记 `host`+`protocol`，URL 原文（path/query/fragment）不入审计正文——单测
      `审计只记 host + protocol…` 断言日志序列化不含 URL 原文片段（`secret`/`token`/`frag`/整串）。
- [x] 启动零外联不变：`openExternal` 只在用户点击书签时经通道触发；`registerIpcHandlers`
      仅注册 handler，启动/空闲无任何自起请求（未引入定时器/自动调用）。
- [x] 无省略号占位常量：通道名 `shell:openExternal`、错误码 `E_PROTOCOL`/`E_EMPTY`/
      `E_MALFORMED`/`E_OPEN_FAILED`、i18n 键 `workbench.bookmarkOpenFailed` 均与源码逐字一致；
      zh-CN 新文案不含「数据库」词。
- [x] 桥降级安全：`window.septcats.shell` 缺失时点击**静默**（不误报失败）——旧夹具/降级态零回归。
- [x] 不碰 `C:/Users/Administrator/.septcats/`；不建表、不加依赖；禁碰 git（未 commit/merge/push）。

## §6 门禁原始输出

### ① `pnpm typecheck`

```
Scope: 9 of 10 workspace projects
packages/core typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck$ tsc -p tsconfig.json --noEmit
packages/ui typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/dbview typecheck$ tsc -p tsconfig.json --noEmit
packages/editor typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck$ tsc -p tsconfig.json --noEmit
packages/sync typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck$ tsc -p tsconfig.json --noEmit
packages/importer typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
TYPECHECK_EXIT=0
```

### ② `pnpm -C apps/desktop exec vitest run`

```
 ✓ test/layout-state.test.ts (17 tests) 16ms
 ✓ test/t61-01-layout-widths.test.ts (23 tests) 15ms
 ✓ test/backlinks-panel.test.tsx (3 tests) 51ms
 ✓ test/t66-workbench-state.test.ts (12 tests) 9ms
 ✓ test/borders-t59.test.tsx (13 tests) 37ms
 ✓ test/t66-workbench-work.test.ts (8 tests) 7ms
 ✓ test/t71-cards.test.ts (13 tests) 8ms
 ✓ test/t65-palettes.test.ts (13 tests) 5ms
 ✓ test/pages-store.test.ts (9 tests) 6ms
 ✓ test/layout-preview-t57.test.ts (6 tests) 5ms

 Test Files  83 passed | 13 skipped (96)
      Tests  896 passed | 25 skipped (921)
   Start at  09:01:54
   Duration  14.40s (transform 3.99s, setup 44.51s, tests 38.05s, environment 36.89s, prepare 13.71s)

DESKTOP_EXIT=0
```

（基线同命令：`Tests 875 passed | 25 skipped (900)`；本单 +21。）

### ③ `pnpm -C packages/ui exec vitest run`

```
 ✓  ui  src/tokens.test.ts (3 tests) 6ms
 ✓  ui  test/t53-gray-colors.test.ts (10 tests) 7ms

 Test Files  32 passed (32)
      Tests  157 passed (157)
   Start at  09:02:16
   Duration  4.52s

UI_EXIT=0
```

### ④ `node packages/ui/tokens/no-magic.mjs`

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
NOMAGIC_EXIT=0
```
