# PRD —— 日历与待办（T97-01 / T98-01）

> 老板 09-30 令（原文）：「增加3个子Agent，执行在知识库功能下方增加日历功能，增加待办功能。」
> 本文是 **A/B/C 三方并行开发的接口冻结面**：先改本文件，再动代码。

## 1. 目标与位置

- 左侧一级导航轨新增两项：**日历**、**待办**，位置**紧随「知识库」之后**（顺序：
  笔记 / 知识库 / **日历** / **待办** / 工作台 / 模板 / 回收站）。
- 两项各是一个**一级页面**：主区渲染页面本体，二级栏渲染各功能自己的小面板。
- 数据**本地优先、可离线**：存应用自己的 SQLite（与笔记同库、同迁移机制），不发任何外部请求。

## 2. 已完成（PM 接线，勿重复实现）

| 内容 | 位置 |
| --- | --- |
| 一级项与 RailKey | `src/renderer/src/nav/NavRail.tsx`（`calendar` / `todo` 已加） |
| 二级栏分流状态 | `src/renderer/src/nav/navState.ts`（`RailPanel` 已含 `calendar` / `todo`，localStorage `septcats.nav.panel`） |
| 主区/二级栏渲染分流 | `src/renderer/src/App.tsx`（`railActive === 'calendar' \| 'todo'`） |
| i18n 双语键（**只消费，不得新增/修改**） | `src/renderer/src/i18n/zh-CN.ts`、`en-US.ts` 的 `nav.*` / `calendar.*` / `todo.*` |
| 类型契约 | `src/shared/calendar.ts`、`src/shared/todo.ts` |
| IPC 通道名 | `src/shared/ipc.ts`：`CALENDAR_CHANNELS`、`TODO_CHANNELS` |
| 页面骨架（**由 B/C 重写**） | `src/renderer/src/calendar/*`、`src/renderer/src/todo/*` |

## 3. 冻结契约（三方可依赖，不得单方面改）

### 3.1 通道与载荷（类型见 `src/shared/calendar.ts` / `todo.ts`）

| 通道 | 输入 | 输出 |
| --- | --- | --- |
| `calendar:list` | `{from:number, to:number}`（epoch ms，含头不含尾） | `{events: CalendarEvent[]}`（按 startAt 升序） |
| `calendar:create` | `{title, startAt, endAt?, allDay?, note?}` | `{event: CalendarEvent}` |
| `calendar:update` | `{id, patch: Partial<…>}` | `{event: CalendarEvent}` |
| `calendar:remove` | `{id}` | `{ok:true}` |
| `todo:list` | `{includeDone?:boolean}` | `{items: TodoItem[]}`（未完成在前，再按 dueAt 升序、createdAt 升序） |
| `todo:create` | `{title, dueAt?, priority?, note?}` | `{item: TodoItem}` |
| `todo:update` | `{id, patch: Partial<…>}` | `{item: TodoItem}` |
| `todo:setDone` | `{id, done:boolean}` | `{item: TodoItem}` |
| `todo:remove` | `{id}` | `{ok:true}` |

- 时间一律 **epoch 毫秒（number）**；`todo.dueAt` 允许 `null`。
- 失败一律抛错，错误信息里带 `CalendarErrorCode` / `TodoErrorCode` 之一（renderer 按 code 给提示）。
- `id` 由主进程生成（uuid），`createdAt` / `updatedAt` 由主进程写，renderer 不得自造。
- renderer 侧访问面：`window.septcats.calendar.*` / `window.septcats.todo.*`（preload 暴露）。

### 3.2 渲染层文件与结构契约（探针按此取元素）

| 文件 | 根 testid | 其他固定 testid |
| --- | --- | --- |
| `calendar/CalendarPage.tsx`（默认导出 `CalendarPage`） | `calendar-page` | `calendar-month-label`、`calendar-grid`、`calendar-day-<YYYY-MM-DD>`、`calendar-empty`、`calendar-prev`、`calendar-next`、`calendar-today` |
| `calendar/CalendarSidePanel.tsx`（默认导出 `CalendarSidePanel`） | `calendar-side` | `calendar-side-item-<id>`、`calendar-side-empty` |
| `todo/TodoPage.tsx`（默认导出 `TodoPage`） | `todo-page` | `todo-list`、`todo-item-<id>`（带 `data-done="0\|1"`）、`todo-empty`、`todo-input`、`todo-add`、`todo-clear-done`、`todo-toggle-done` |
| `todo/TodoSidePanel.tsx`（默认导出 `TodoSidePanel`） | `todo-side` | `todo-side-item-<id>`、`todo-side-empty` |

## 4. 数据层要求

- 新增迁移 `src/db/schema.v11.ts`（`SCHEMA_V11_STATEMENTS`），在 `src/db/migrations.ts` 里按既有序列接在 v10 之后：
  - **禁止修改 v1–v10**（已发布）；
  - `CREATE TABLE IF NOT EXISTS`，`STRICT` 范式同 v10；
  - 表：`calendar_event(id TEXT PK, title TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
    与 `todo_item(id TEXT PK, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, due_at INTEGER NULL,
    priority TEXT NOT NULL DEFAULT 'mid', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`；
  - 索引：`calendar_event(start_at)`、`todo_item(done, due_at)`。
- 主进程服务：`src/main/calendar.ts` / `src/main/todo.ts`，范式照 `src/main/templates.ts`
  （`createXService(options)` + `registerXIpc(service, registrar)` + `toXError`），
  并在 `src/main/index.ts` 里像 `registerShellIpc` 那样接线（DB 不可用时服务为 null → 抛 `E_DB_UNAVAILABLE`）。
- `src/preload/index.ts` 暴露 `calendar` / `todo` 两组方法并补类型（`SeptcatsApi`）。
- 校验在主进程边界做（不信任 renderer）：`title.trim()` 为空 → `E_TITLE_REQUIRED`；
  `endAt < startAt` → `E_END_BEFORE_START`；字段类型不对 → `E_MALFORMED`；`id` 不存在 → `E_NOT_FOUND`。

## 5. 渲染层要求

- **只用 token**（`--sc-space-*` / `--sc-color-*` / `--sc-text-*` / `--sc-radius-*` / `--sc-border-edge`）；
  禁裸 hex、禁重复裸 px（`node packages/ui/tokens/no-magic.mjs` 必须过）；字体随 token（思源黑体）。
- 所有可见文案走 `t('…')`，**只用已存在的键**（第 2 节列的字典；`t()` 不做插值，数字自己拼）。
- 键盘可达：新建/勾选/删除都能纯键盘完成；焦点可见（`--sc-color-focus-ring`）。
- 界面语言照 DESIGN.md 侧栏/列表行口径：行高、圆角、描边、hover 态与既有列表一致。
- 主进程不可用（jsdom 或 DB 未就绪）时页面**不得崩**：渲染空态即可。

## 6. 验收

| 角色 | 交付 | 证据 |
| --- | --- | --- |
| A（主进程/数据层） | 迁移 v11 + 两个服务 + IPC 注册 + preload + API 类型 | `pnpm -C apps/desktop test -- test/t97-calendar-service.test.ts test/t98-todo-service.test.ts` 全绿输出；`pnpm -C apps/desktop typecheck` 0 error |
| B（日历 UI） | 重写 `calendar/*` 四个文件 + 单测 | `pnpm -C apps/desktop test -- test/t97-calendar-ui.test.tsx` 全绿输出 |
| C（待办 UI） | 重写 `todo/*` 四个文件 + 单测 | `pnpm -C apps/desktop test -- test/t98-todo-ui.test.tsx` 全绿输出 |
| PM（收口） | 真机探针 T97-01 / T98-01（rail 位置、页面渲染、CRUD 落库、重启后仍在、档案零触碰）、全量门禁、打包、包审 |

## 7. 禁止事项（违反即返工）

1. 不得修改：`App.tsx`、`NavRail.tsx`、`navState.ts`、`i18n/*`、`src/shared/{calendar,todo,ipc}.ts`（契约面）。
2. 不得跑 `pnpm -C apps/desktop dist`、不得跑任何 `docs/mockups/cdp-e2e-*.mjs` 探针（重活由 PM 串行做）。
3. 不新增任何依赖（stdlib / 已有依赖优先）；不引入外部网络请求。
4. **绝不写** `C:\Users\Administrator\.septcats`（真实档案只读红线）；测试一律用临时目录。
5. 不重构与本功能无关的代码；不"顺手"改格式。