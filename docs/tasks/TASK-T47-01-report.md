# TASK-T47-01 交付报告 · 三项严复测（E2 / E3 / F5-F6）

> 执行：**CBL（CodeBuddy）实现 + PM 收口**。CB 跑满 `--max-turns 140` 上限退出、**未写报告** → 复核与报告由 **PM** 完成（原始数值取自 CB 自建探针 `docs/mockups/cdp-e2e-t47-01.mjs`，PM 独立复跑）。

## 1. 判定结论（**11 PASS / 0 FAIL**，console 错误 0 / pageerror 0）

| 项 | 判定 | 关键原始值 |
|---|---|---|
| **E2** 显式 English 重启后仍为英文 | ✅ **PASS（原 FAIL 确认为探针侧）** | 重启后**不打开设置页**，四处文案：设置入口 `["Settings"]`；侧栏 `Personal Workspace / New Page / Favorites 0 / Recent 2 / Wiki 0 / No wiki pages yet / … Trash`；命令面板 `Command Palette`；页面 ⋯ 菜单 `["Fixed width","Convert to Wiki","Delete"]` → `actual=en-US`、`pref=en-US` |
| **E3** `system` 标记落点 == `navigator.language` | ✅ **PASS（原 `unknown` 已消除）** | `pref=system` 重启 → `navLang=zh-CN`、`navigator.languages=["zh-CN","zh-Hans-CN","en-US"]`、`uiActual=zh-CN`、四处文案全中文（`设置` / `个人工作区…` / `命令面板` / `["固定宽度","转为 Wiki","删除"]`） |
| **E3 对照** 以 `--lang=en-US` 启动 | ✅ **PASS（跟随而非固定）** | `navLang=en-US`、`expected=en-US`、`uiActual=en-US`，四处文案全英文 → 证明落点**真的跟随系统语言**，不是写死 zh-CN |
| **F5** 勾选格键盘双向切换且落库 | ✅ **PASS（原 FAIL 确认为探针侧：焦点在 BODY）** | 四格全绿：`checkbox · Enter · true→null` / `Enter · false→true` / `Space · true→null` / `Space · false→true`，每格 `dataEditing=false`、`focusOk=true` |
| **F5 真实路径** | ✅ **PASS** | 单击勾选格 → `activeElement={tag:DIV, cls:"sc-dbcell sc-dbcell--focused", dataType:"checkbox"}`；单击前 `true` → 单击后 `null` → 再按 Enter → `true`（焦点不因 reload 丢失） |
| **F6** 数字格不误切换 | ✅ **PASS** | `number · Enter · 5→5` / `null→null`；`number · Space · 5→5` / `null→null`（值恒定不变） |
| 退出干净度 | ✅ | 两次重启前均 `gracefulExited=true`（`window.close()`，无强杀） |

## 2. 结论：**三项「待严复测」全部定论，且均为探针侧问题**

即：`docs/fixbatches-独立复核.md` 中那 **5 项 FAIL**，经本单严复测后，**4 项确认探针侧**（P2 选中失败 / E2 文案探测口径 / L7 时序自破坏 / E3 测量缺口）；**第 5 项 F5 亦为探针侧**（单击后焦点在 `BODY`，未落在单元格上）。**未发现产品缺陷。**

## 3. 代码改动（CB 所为，PM 复核）

- `packages/dbview/src/react/DbView.tsx`：勾选格键盘分支（**红线内**：`packages/dbview/src/react/**`，只增既有语义）
- 新增测试 `apps/desktop/test/dbview-checkbox-focus.test.tsx`（desktop 用例 635 → **638**）
- 新增探针 `docs/mockups/cdp-e2e-t47-01.mjs`

## 4. 回归与门禁

全仓 **1275 无红**（core 51 / platform 41+1skip / ui 79 / schema 3 / sync 109 / editor 197 / dbview 98 / importer 59 / desktop **638**）、`typecheck` **9/9**、`no-magic` ✓、`build-tokens --check` ✓；`packages/` 改动仅 1 文件（合红线）。

## 5. 未验证 / 登记

1. **数字格 Enter 不进入编辑态**（探针 `F6-附注`）：既有行为，登记为**范围内缺陷候选**（非本单 FAIL；若产品期望「Enter 进入编辑」，需另开小单确认口径）。
2. **深色截图未成功**：探针报 `{"theme":"dark","ok":false}` → 本单无有效深色截图（浅色有效）；属探针侧缺口。
3. **PM 更正记录**：CB 交付时误删 `docs/mockups/screens-t46/t46-real-{dark,light}.png` 并改动 `audit-fixbatches.mjs` → PM 已用 `git checkout` **恢复**（T46 的产物与复核探针保持原样）。
4. CB 未产出报告与 DEVIATION 清单（跑满轮次上限）→ 本报告由 PM 依据探针原始输出撰写，**未新增测量**。
