# TASK-T64-01 报告 · R16 侧栏两修（菜单 clamp + 新建文件夹）

> 任务书：docs/tasks/TASK-T64-01.md · 根因 commit：edacb13（T64 prep）· 基线 tip：bc60368
> 执行者：工程师 CodeBuddy（代码+单测落盘后会话死于上游中断，探针未及写）；**收尾/复跑/本报告 = PM 代写，判定依据=PM 实跑**。

## 阶段 A · ⋯菜单与右键菜单统一 clamp
- 改动文件：apps/desktop/src/renderer/**/SidebarTree.tsx、apps/desktop/src/renderer/**/App.css（.app-nav-menu absolute 定位移除）
- 机制：⋯ 按钮打开时写入 `rowMenuAt`（触发钮 getBoundingClientRect 作锚），与 ctxMenu 共用 fixed+clamp useLayoutEffect；删除 absolute 分支渲染。
- 结果数值：**待 PM 真机 A 段**（CB 死在探针之前）。

## 阶段 B · 新建文件夹（page_type='folder'）
- 改动文件：main/pages.ts（PageType 联合 + createFolder:518）、db/statements.ts:123 enum、**main/commit.ts PAGE_TYPES 闸门（CB 漏改，PM 收口补，见 DEVIATION-1）**、renderer state/pages.ts（pageTypeOf:108 兜底 + createFolder action:535）、SidebarTree.tsx（分体钮三选菜单/行菜单「新建子文件夹」/folder 行点击=展开不建页签/转换/回收站/搜索兜底）、i18n zh-CN/en 双 locale（folder.* 键在位）。
- 零 DB 迁移（列本就 TEXT DEFAULT 'page'）。
- 图标：像素族 FolderSimple 复用（未新增 glyph）。

## 单测结果（PM 实跑）
- 跑法：`node apps/desktop/scripts/ensure-abi.mjs node && pnpm -C apps/desktop test`
- desktop：**857 passed (857)**（含 T64 新增组：enum 接受 folder/拒野值、createFolder+级联删恢复、pageTypeOf 兜底、selectPage folder 不建页签、转换持久化）
- 全仓 `pnpm -r test`：无红（desktop 857 / core 51 / dbview 122 / editor 200 / importer 59 / platform 41+1skip / schema 3 / sync 109 / ui 156）
- `pnpm -C apps/desktop typecheck`：**0 错误**；`node packages/ui/tokens/no-magic.mjs`：✓

## 真机（cdp-e2e-t64-01.mjs）
- 段计划：A 菜单 clamp 盒四边 ≥8px（首/末行 ⋯ + 右键）；B 分体钮→folder 行→展开无新页签→挂子页；C 拖入/面包屑/转页；D 重启还原；E 搜索/回收站回归。截图 ≥6 → screens-t64/。
- 结果：**待补（PM 接手写探针并跑）**。

## 手测（PM/CB 真机记录）
- 待真机段完成后补。

## DEVIATION
1. CB 漏改 `main/commit.ts:150` 的 `PAGE_TYPES` 校验闸门（只改了 statements 的 z.enum）→ folder upsert 被 op 校验抛「非法」；**PM 补**，两处校验现同清单。
2. CB 的 pages.test 从 `main/pages` import 不存在的 `STATEMENTS`（真源 `db/statements`）；**PM 修 import**。
3. CB 的 pages-store 新 describe 引用未提升的局部 helper（`installBridgeWithNodes is not defined`）+ 一处 `globalThis as {septcats}` 断言 typecheck 红；**PM** 提为顶层 helper、断言改经 `unknown`。
4. 旧口径钉子按新语义改写（任务书 §2.2 预告）：templates-ui 三条（箭头直开模板列表 → 分体三选菜单再「从模板新建」）、t61-01-folder 一条（钉死下标 → 相对顺序钉「新建子页面<新建子文件夹<移入…」）。

## PM 复跑节（PM 补）
- 单测/typecheck/全仓：数值见上，PM 实跑。
- 真机探针：待补。
