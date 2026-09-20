# TASK-T47-01 · P2：三项严复测（E2 英文重启落点 / E3 系统语言落点 / F5 勾选格键盘）

> PM：Hermes ｜ P2（来源：`docs/fixbatches-独立复核.md` 中 5 项 FAIL 的严复测要求）｜ 前置：T46-01（rc.25）
> 背景：第三方复核在 `29 PASS / 5 FAIL` 中，4 项判定为**探针侧**问题，其中 1 项（F5）**可能是真缺陷**，另 2 项（E2/E3）**测量口径不足**。本单要求**口径更严**地复测，并把真缺陷修掉。

## 0. 三条的确切现状（原文引用自 `docs/mockups/screens-t38/audit-fixbatches-results.json`）

| 项 | 复核原始值 | PM 分类 |
|---|---|---|
| **E2**（显式选 English 后重启应仍为英文） | `boot2={"pref":"en-US","zh":{全 false},"en":{"Settings":false,"Appearance":false,"Favorites":true,"System":false},"sideText":"Personal Workspace New Page Favorites 0 Recent 8 … Trash 1"}` | 侧栏**确为英文**但探针用「Settings/Appearance/System」文案探测（重启后设置页未打开）→ 判 false。**倾向探针侧**，需严复测定论 |
| **E3**（标记 system 时按系统语言落点） | `navLang=zh-CN expected=zh-CN actual=unknown pref=en-US` | **测量缺口**（`actual=unknown`） |
| **F5**（勾选格上按 Enter 应切换并落库） | `before={"activeElement":{"tag":"BODY"},"on":1}` → `after=[{…"checkbox":true}]`（仍 true） | ⚠️ **可能真缺陷**（同组 Space 的 F6 判 PASS 但值也已是 true → 期望值受前序影响） |

## 1. 必须做到

**A. 严复测（先定论，再修）**
1. **E2**：以「设置页 + 侧栏 + 命令面板 + 页面 ⋯ 菜单」**四处文案**分别断言语言；流程 = 设置里点 English → **优雅退出（`window.close()`，禁止强杀）** → 重启 → 在**不打开设置页**的前提下断言四处（尤其侧栏与页面 ⋯ 菜单）。给出四处 `zh/en` 命中真值。
2. **E3**：断言 `system` 标记下重启的落点必须**等于 `navigator.language`**（贴 `navigator.language` 原文与 UI 实际语言，两者必须一致；不得出现 `unknown`）。
3. **F5/F6**：给出**键盘矩阵真值表**：`{Enter, Space}` × `{勾选字段单元格, 数字单元格}` × `{true→false, false→true}`，每格贴 按前值 → 按后值（读回 DB，不只读 DOM）。
4. 上述三项若判定为**真缺陷** → 在本单内修掉（同单修，不再另开）。

**B. 若为真缺陷，修法口径**
- F5（若 Enter 确实不切换）：勾选格支持 Enter 与 Space 双向切换，切换后**必须落库**（读回一致），且**不得**导致单元格进入编辑态或光标异常。
- E2/E3（若语言落点确有错）：以 `pref` 为准的落点必须可复现地生效；`system` 时以 `navigator.language` 为准。
- **不得降低既有测试强度**；既有断言语义不变（需调整 §DEVIATION 逐条）。

**C. 不做**：不改语言机制的整体设计、不新增语言、不动布局/主题体系。

## 2. 验收（数值化，必须贴原始值）

1. E2：四处文案的 `zh/en` 命中真值（重启前后各一组）+ 判定。
2. E3：`navigator.language` 原文 + UI 实际语言 + `pref` 值 → 三者关系断言（**不许出现 `unknown`**）。
3. F5/F6：**8 格键盘矩阵真值表**（含 DB 读回值）。
4. 若修了代码：修前红 → 修后绿（贴两条测试名与结果），并复跑 `docs/mockups/audit-fixbatches.mjs`（贴新计数；原 5 FAIL 中属本单范围的项应转 PASS）。
5. 回归：全仓无红；`typecheck` 9/9；`no-magic` ✓；`build-tokens --check` ✓；窗口零滚动、侧栏可完全收起、手柄装订线、对比度门禁、多页签、AI 面板、双链均不回归。
6. 双主题截图（若涉及 UI 改动）。

## 3. 红线

- 允许动：语言/落点相关的最小面（`renderer/src/i18n/**`、设置页语言控件、`main` 侧读取 `pref`/`locale` 的**最小**改动）、字段单元格键盘处理（`packages/dbview/src/react/**` 的键盘分支，**只增**既有语义）、`apps/desktop/test/**`。
- 不碰：`DESIGN.md`/tokens（配色）、CI/发布脚本；不加依赖；不碰 git；禁 TODO/占位符。
- 若确需改 `packages/core` 语义 → **先报告等 PM 裁决**。

## 4. 交付物

严复测结果（含上述三张真值表）+ 必要修复的代码与测试 + 复跑计数 + 双主题截图（如涉及 UI）+ `docs/tasks/TASK-T47-01-report.md`（含 DEVIATION 逐条；PM 复跑节留「（PM 补）」）。