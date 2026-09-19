# TASK-T30-01 报告 · P1 布局三缺陷（侧栏完全收起 / 侧栏随内容滚动 / 转库编辑被遮）

> 工程师：CodeBuddy（唯一作者）｜前置确认：`git log -1 = 751c5ce`（任务书提交）✓
> 自跑：`pnpm -C apps/desktop test` 435/435 ✓、`pnpm -C packages/ui test` 76/76 ✓、`pnpm -r typecheck` ✓、`no-magic` ✓、`build-tokens --check` ✓
> 全仓 / selftest / 重打包 / 真机复跑留 PM（PM 打包前先 `node apps/desktop/scripts/ensure-abi.mjs electron`）。

## 0. 复现环境与证据清单

- **修复前**：rc.5 打包 exe（`apps/desktop/dist/win-unpacked/Septcats.exe`，2026-09-19 09:05 构建 = 4c9e272 代码态），独立夹具根 `--user-data-dir=E:\Hermes Agent工作空间\_scratch\t30*-ud` + `rootPath=…\t30*-data`（不触默认根）。
- **修复后**：`pnpm -C apps/desktop build` 重建 `out/`，以 `electron . --user-data-dir=… --remote-debugging-port` 直跑（重打包留 PM）。
- CDP（playwright-core connectOverCDP）脚本：`docs/mockups/cdp-audit-t30-before.mjs`、`cdp-audit-t30-before-extra.mjs`（小视口）、`cdp-audit-t30-after.mjs`（11 条验收断言，11/11 PASS）。
- 截图：`docs/mockups/screens-t30/before-0…7*.png`、`after-1…5*.png`。

## 1. 三症状根因与验收数值

### ① 侧边栏不能完全收起

**根因**（与 PM 定位一致）：`AppShell.css` 的 `.sc-shell--collapsed .sc-shell__body` 只把列宽换成 `var(--sc-layout-sidebar-collapsed)`（48px 窄轨），`<aside>` 与 `.app-side` 内容仍渲染占位、可点。

**修复前实测**（收起态）：`.sc-shell__sidebar` width = **48**，`.app-side` 可见 = true，主区宽 1121 < 窗口 1184。（before-2-collapsed.png）

**修复**：`packages/ui/src/AppShell.css` —— 折叠态侧栏 `display: none` + body 单列 `grid-template-columns: 1fr`（`AppShell.tsx` 仅同步 docstring 注释，props API 零改动）。

**修复后实测**：`.sc-shell__sidebar` `getBoundingClientRect().width` = **0**（computed display=none）；`.app-side` 不可见（getClientRects 空）；主区宽 **1184 = 窗口宽**；顶部按钮仍在，再点恢复 width = **240**（after-2-collapsed.png）。

### ② 侧边栏跟着编辑区一起滚动

**根因**（与 PM 定位一致，且补全了缺口）：`tokens.css` 基线只给了 `html, body { height: 100% }`，**`#root` 未定高** → `.sc-shell` 的 `height: 100%` 依 auto 高父级解析为 auto → shell 被内容撑高 → 滚动发生在窗口级，侧栏随内容上移；`.sc-shell__main { overflow: auto }` 因 main 自身也被撑高而形同失效（实测 `main.scrollTop` 恒 0）。

**修复前实测**（40 段长页，视口 1184×735）：
- `scrollingElement.scrollHeight` = **2406** vs clientHeight = 735（窗口滚动 1671px）；
- `#root` 高 = 2405.89 = 内容高（高度链断点实证）；
- 主区滚到底后 `.app-side` top 不变（因为 main 根本没在滚）；**窗口滚轮后 `.app-side` top = −1631**（侧栏被拽出视口外，before-1-window-scroll.png 即顶栏/侧栏上半截消失）。

**修复**：`apps/desktop/src/renderer/src/App.css`（全局 CSS，授权面内）——
```css
html, body { overflow: hidden; }
#root { height: 100%; overflow: hidden; }
```
高度链闭合后 `AppShell.css` 既有约束（`.sc-shell` height:100% + body 行 1fr/min-height:0 + `__main` overflow:auto）自然生效，**AppShell.css 的高度/溢出规则零改动**。

**修复后实测**（同一 40 段长页）：`scrollHeight` = 735 = clientHeight（窗口零滚动）；内部滚动容器 `.pv-root` scrollTop = **1671 > 0**（主区可滚）；滚到底 `.app-side` top **40 → 40（Δ0，±1px 达标）**（after-1-longpage-scrolled.png）。

### ③ 转为数据库编辑时软件区域约一半被遮掩

**复现定位（按任务书要求先取证，未猜着改）**：
- 复现步骤：建页 → 输入多段内容 → 点「转为数据库」→ 建若干记录 →（老板机器为 DPI 缩放/小窗口，用 CDP `Emulation.setDeviceMetricsOverride` 压到 1184×560 等效复现）。
- **elementFromPoint 网格采样（主区 10×8/10×10）**：命中的全部是数据库表格自身元素（`sc-dbrow`/`sc-dbcell`/`sc-db` 等），**不存在任何覆盖浮层**（无 dialog/overlay/palette 命中）；采样点为 null 的恰是落在视口外的主区下缘。
- **确切结论**：③ 不是浮层遮挡，而是与 ② 同根因——高度链断裂使 `.dbpage`（height:100% 链同样失效）把 shell 撑到 866.39px，主区下缘溢出视口、底部内容（表格脚部/聚合行/「新建记录」条）被裁剪且需窗口滚动才能看到：
  - 修复前（25 条记录，视口 735）：main bottom = **866.39**，裁剪 **131.4px（17.9% 视口）**，winScrollH 866 > 735；null 采样 10/80；
  - 修复前（小视口 560，等效老板窗口）：main bottom = 819.39，裁剪 **259.4px = 视口的 46.3%**，null 采样 **30/100**（before-7-db-smallvp.png，即「一半被遮掩」）。
- 面板可关性核查：单元格编辑（标题列 = TitleCell，**双击**进入）Esc 可取消；select/multi_select/relation 的 `.sc-dbc-picker` 点外关闭 + Esc 可关；AI 批量确认走既有 Dialog（Esc/按钮均可关）。

**修复**：与 ② 同一改动（高度链闭合）。无 dbview/dbpage 侧改动需求（未越授权面）。

**修复后实测**：小视口 560 下 winScrollH = 560 = clientHeight（窗口零滚动）；主区 100 采样 **0 null**（内容完整落在视口内，after-3-db-smallvp.png）；标题格双击 → 编辑输入框 rect top/bottom = 250.39/278.39，完全在 `.sc-shell__main` 内；Esc 退出后主区可继续交互（after-4-db-celledit.png）。

## 2. 改动清单（全部在授权面内）

| 文件 | 改动 |
|---|---|
| `packages/ui/src/AppShell.css` | 折叠态：侧栏 `display:none` + body `grid-template-columns: 1fr`（替换窄轨规则）；高度/溢出既有规则未动 |
| `packages/ui/src/AppShell.tsx` | 仅 docstring 注释同步（「折叠 48px」→「折叠 = 完全收起，宽度 0」）；**props API 零改动** |
| `apps/desktop/src/renderer/src/App.css` | 新增 `html,body{overflow:hidden}` + `#root{height:100%;overflow:hidden}`（§②③ 高度链闭合） |
| `packages/ui/src/AppShell.test.tsx` | 新增 1 用例：折叠态 CSS 契约（display:none / 单列 1fr / 不再引用窄轨 token） |
| `apps/desktop/test/layout-invariants.test.ts` | 新增 7 用例：高度链闭合 / 窗口不滚动 / 内部容器滚动 / 折叠收起（静态 CSS 契约范式，同 ui-interaction-audit） |
| `docs/mockups/cdp-audit-t30-{before,before-extra,after}.mjs` + `screens-t30/*.png` | 真机取证与验收脚本/证据 |

红线自查：新增 CSS 零字面 hex、零裸 px（只用 0/100%）；图标未动；双主题走 token 未动；`--sc-layout-sidebar-collapsed` token 仍在 tokens.css 生成（仅 AppShell.css 不再引用）；既有测试断言语义零调整。

## 3. DEVIATION 逐条

1. **③ 根因结论与任务书 §1 假设不同**：任务书预判「记录编辑面板/浮层覆盖半屏且不易关闭」；真机取证（elementFromPoint 全量采样 + 截图）证实**无浮层元素**，实为高度链断裂导致主区下缘溢出视口（DPI 缩放窗口下 ≈46%）。修复走 §② 同一改动，未新增任何面板关闭逻辑（既有 Esc/按钮关闭均验证可用）。
2. **`--sc-layout-sidebar-collapsed` 在组件 CSS 中失去引用**：折叠语义从「窄轨」改为「完全收起」，token 本体仍在 DESIGN.md/tokens.css/build-tokens 链路中原样生成（`build-tokens --check` ✓）。若 PM 决定彻底退役该 token，属 build-tokens/DESIGN.md 改动，超出本单授权，未动。
3. **AppShell.css 折叠规则改用 `display:none`** 而非「宽度 0」：验收 §2① 明示二者等价可接受；`display:none` 顺带消除 1px 右边线残留与可聚焦性，无障碍语义由顶栏按钮 aria-expanded 承担（既有用例断言未变、全绿）。
4. **`html,body` 兜底禁滚放在 apps 侧 App.css** 而非 packages/ui：#root 定高本属 apps 装配职责（packages/ui 不知道宿主结构）；`.sc-shell` 自身高度规则无需改动即恢复正确，符合「最小化动共享 shell」。
5. **`docs/perf-history.jsonl` 追加 4 行**：`pnpm -C apps/desktop test` 的 perf 基线自动追加（git_rev=fe747ca，4 项全 pass、在预算内），非本单意图改动，PM 可整体还原或并入台账。
6. **修复后真机验证用 `electron .` 直跑 out/**（非重打包 exe）：打包留 PM（先 ensure-abi electron）；修复前证据用 rc.5 打包 exe，前后证据代码态对齐（4c9e272 = rc.5 → 本单改动仅上表 6 文件）。
7. **无既有断言调整**（任务书 §3「如需调整 §DEVIATION 逐条」→ 不适用，登记为空声明）：ui 76/76、desktop 435/435 均为原断言全绿。

## 4. PM 复跑节

（PM 补）

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 1028 无红（ui 75→76 = +1 折叠契约；desktop 428→435 = +7 layout-invariants）
no-magic ✓ / build-tokens --check ✓
授权面核对：改动 = AppShell.{tsx,css} + AppShell.test.tsx + renderer/App.css + apps/desktop/test/**；packages/{core,sync,editor,dbview,importer} 零改动 ✓（props API 未动 ✓）
```

**PM 立场更正（追认工程师的取证结论）**：③「转库编辑被遮一半」**不是浮层遮挡**——工程师用 `elementFromPoint` 全量采样证明**无任何浮层元素**（命中全为表格自身），真因与②同源：主区内容溢出视口被裁（560px 等效视口下裁掉 **46.3%**、100 采样中 30 null）。**PM 原假设（记录编辑面板盖半屏）错误**，工程师按「先取证再改」的要求给出了反证并修了真因 ✓ 这正是我要的纪律。

**真机数值（工程师自跑，PM 将于 rc.6 独立复跑）**：①折叠态 sidebar `width 48 → 0`、`.app-side` 不可见、主区 1184=窗口宽、再展开 240 ✓；②`scrollHeight 2406 → 735`（=clientHeight，窗口零滚动）、`.pv-root` 内滚 1671px、`.app-side` `top 40 → 40`（Δ0）✓；③修复后 100 采样 **0 null**、单元格编辑器全在主区内、Esc 可关 ✓；`cdp-audit-t30-after.mjs` 11/11 PASS。

**DEVIATIONS 追认（1–7）**：窄轨 token 随 `display:none` 失去组件引用（保留 token 供未来窄轨形态）✓；`#root` 定高放 App.css 而非 AppShell.css ✓（AppShell 保持与外壳无关的高度约束）；`html,body{overflow:hidden}` ✓；③浮层假设不成立并由采样反证 ✓；`perf-history.jsonl` 由测试自动追加 ✓。
