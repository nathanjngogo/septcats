# TASK-T70-01 报告 · P2：库层级 UI（R20 条目①②）

> 单类型：纯前端零协议单（main/preload/shared/ipc 零改动）。
> 基线 = main HEAD（0.4.1-rc.6，T68 像素望远镜后）。
> 关联真源：`docs/PRD-R20-库与模板市场.md` §2 现状侦察；任务书 `docs/tasks/TASK-T70-01.md`。

## 1. 概述

把「个人工作区」升级为「库」层级：侧栏头 = 库切换器；新建库弹框（名字 + 类型三选卡）；
按类型做种（工作台库→home 工作台 / 知识库库→5 结构页 / 空白库→无）；用户可见文案
「工作区」→「库」（仅改 i18n 值，代码/数据层 `workspace` 字样不动）。

后端全链路（workspaces.list/create/rename/switch/onChanged 五通道、pagesActions 三件套、
每库 tabs 隔离）已存在，本单只接 UI。

## 2. 范围与交付

| 项 | 交付物 | 状态 |
|---|---|---|
| ① 侧栏头切换器 | `SidebarTree.tsx` 头行 = 库切换 Menu（role=button / data-testid=side-ws-head，✓ 当前库 + 新建/重命名项，outside-close 继承） | 已交付 |
| ② 新建库弹框 | `NewWorkspaceDialog.tsx`（名字 + 类型三选卡；空名禁用；确认→createWorkspaceWithType） | 已交付 |
| ③ 类型种子 | `pages.ts` `createWorkspaceWithType`（建库后切库+按类型做种）+ `seedKnowledgeBase`（5 结构页+清标签留 MOC） | 已交付 |
| ④ 文案 工作区→库 | zh-CN/en-US i18n 值改造（13 处）+ 新增 knowledgeBase/workspace 菜单/弹框键（两词典键集合等价） | 已交付 |

- 触达文件：`pages/SidebarTree.tsx`、`pages/NewWorkspaceDialog.tsx`（新）、`page/NewWorkspaceDialog.css`（新）、
  `state/pages.ts`、`i18n/zh-CN.ts`、`i18n/en-US.ts`、`App.css`；测试 `test/workspace-lib-t70.test.tsx`（新）。
- 未触达：main / preload / shared / ipc / SCHEMA / migrations / 锁面 / 任何新表 / 新依赖。
- 删除库：后端无通道，本单不做、UI 不提供入口（红线守死）。

## 3. 红线自查

- [x] main/preload/shared/ipc 零改动（delete 通道不存在 → UI 不提供删除入口）
- [x] 不碰 op-log / SCHEMA / migrations / 锁面
- [x] 不建新表 / 不加依赖 / 不碰 git
- [x] 无 TODO（grep `TODO` 于新增代码 = 0）
- [x] 探针/单测隔离夹具（stub 桥 `globalThis.septcats`），真实数据根 untouched
- [x] `git status --short` 仅含 renderer/src + test + docs（确认无 main/preload/shared/ipc 改动）
- [x] 交付时 electron 进程计数 = 0（tasklist 无 electron 进程）

## 4. 测试清单（只增不减）

| 测试文件 | 用例数 | 结论 |
|---|---|---|
| `test/workspace-lib-t70.test.tsx`（T70-01 本单新增） | 9 | 全过 |
| `test/i18n.test.ts`（键集合等价 + 门禁③/⑤ CJK 扫描） | 18 | 全过（随 i18n 改造回归） |
| `test/trash-ui.test.tsx`（面包屑回落文案随 i18n 改造更新断言） | 1 处断言更新 | 全过 |
| `test/t61-01-folder.test.tsx`（「工作区根」→「库根」断言更新 ×2） | 2 处断言更新 | 全过 |
| `test/layout-fusion-t52.test.tsx`（testid side-workspace→side-ws-head 更新） | 1 处更新 | 全过 |
| `test/workspace-seed.test.ts`（defaultName 互锁，未改值故无需动） | 5 | 全过 |

- 本单 vitest **新增 9 用例**；vitest 全量复跑：**824 通过 / 25 跳过 / 0 失败（849 总）**。
- 每写完即 `npx vitest run --reporter=basic test/workspace-lib-t70.test.tsx` 跑绿（9/9）。
- 类型检查：`tsc -p tsconfig.web.json` 与 `tsc -p tsconfig.node.json` 均 clean。
- 注：任务书「desktop 基线 952」含 cdp-e2e 探针口径，不在 vitest 单测计数内；本单单测仅增不减。

## 5. DoD 复跑

- W1 头行可点弹 Menu（当前库 ✓ + 新建/重命名项）：单测覆盖（workspace-lib-t70 ① 组 4 例）—— 待 PM 真机 cdp-e2e-t70-01 W1 复跑
- W2 建 3 类型库 → 切换列表增长、树/收藏/最近隔离、tabs 各自还原：单测覆盖 createWorkspaceWithType 三类型（③ 组）+ switchWorkspace（① 组）—— 待 PM 真机
- W3 知识库库 = 5 结构页落新库且无多余标签/无卡死重命名态：单测覆盖（③ 组第 2 例，断言 tabs=1 且仅 MOC、editingId=null）—— 待 PM 真机
- W4 工作台库 = 切过去即见 home 工作台：单测覆盖（③ 组第 1 例，断言 workbenchStore.view==='home'）—— 待 PM 真机
- W5 重命名当前库 = 原地输入→落库→头行即变：单测覆盖（① 组第 4 例 + ④ 组）—— 待 PM 真机
- W6 zh 界面零「工作区」（截图证）：i18n 值全盘点改造（13 处）+ 门禁③/⑤ CJK 扫描 0 命中 + 老探针 0 回归 —— 待 PM 真机截图
- W7 老库数据无损（1 号库=原「个人工作区」）：数据层未动，仅改 UI 文案；defaultName 未改，种子互锁测试 5 例全过 —— 待 PM 真机
- W8 真根 untouched + 退出计数 0：stub 桥注入，未触真根；交付 electron 进程=0 —— 待 PM 真机
- 老探针零回归（T61/T60/T65/T67-B2/T59，PM 连跑）：本单未改其依赖路径，vitest 内对应单测全过 —— 待 PM 连跑

## 6. DEVIATION（待追认）

- D1 知识库库种子正文不种（降级口径，PRD §3 已预授权；5 页仅建标题，正文为空）。
- D2 头行原位重命名采用「失焦提交」语义（与既有 RenameInput/page 重命名一致），未采用任务书许可的「blur=放弃」放宽口径——无行为违规，仅说明实现选择。
- D3 i18n 值改造后，`common.currentWorkspace / sidebar.workspace / defaultName` 等键名保留 `workspace` 语义（代码/数据层不变），仅用户可见文案改「库」。

## 7. 遗留

- 删除库：后端无通道，本单不做、UI 不提供入口（红线）；后续单（如有）再议。
- 「工作台」/「工作台模板市场」/卡片注册表/市场 = T71-01 / T72-01 范围，本单不涉。
- 真机 cdp-e2e-t70-01（W1-W8）由 PM 复跑；老探针 T61/T60/T65/T67-B2/T59 由 PM 连跑。

---

## 9. PM 复跑（09-23 15:4x）

- vitest 全量独立复跑：**824 通过 / 25 跳过 / 0 失败**（=815 基线+9 新）；typecheck 9/9；no-magic ✓；与自报一致。
- **真机第一轮抓出 1 个真缺陷（jsdom 盲区）**：头行 openWsMenu「恒开」语义下 click 冒泡到 document，刚挂载的 Menu 被自己的 outside-close 当场关闭 → 菜单开了即死（expanded 恒 false、menu=0，dbg-t70-head.mjs 实锤）。PM 根修=头行 onClick `stopPropagation`（⋯ 钮同款防双关先例），复跑 11 PASS / 0 FAIL：
  W1 切换器（✓+新建/重命名项）｜W2 三类型库+切库隔离｜W3 知识库 5 结构页+**仅 MOC 1 标签无卡死重命名**（种子雷区实证过）｜W5 原地重命名即变｜W6 zh 界面「工作区」零残留（库名本体除外）｜W7 切库往返老页无损｜W8 真根 untouched+退出计数 0。
- 老探针 T61/T60/T65/T67-B2/T59 连跑结果见下一行（补记）。
