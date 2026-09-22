# TASK-T62-01 报告 · 全局像素黑框线（老板 09-22）

- 基线 tip：`0f1b416`
- 执行者：工程师 CodeBuddy（`proc_8bb840b036c7`，26 个 CSS + DESIGN/PROJECT_PLAN + 纪律测试 + 探针骨架全部落盘后，**会话死于上游 429 额度限制**——非任务失败；收尾/复跑/本报告=PM）
- 状态：**完成**（PM 真机复跑 **83 PASS / 0 FAIL**）

## 0. 侦察复核

任务书 §0 盘点（352 处 border、17 处已吃 ink-edge）与 CB 实测一致。CB 未重复调查，直接按清单施工。PM 收口复扫：产品 CSS 框轮廓语义残留=**0**（透明占位/复位/语义色/Spinner 动段四类白名单外）。

## 1. 口径落地映射

- §1.1 外框 → `2px solid var(--sc-color-ink-edge)`：ui 控件族（Input/Button/Checkbox/Radio/Switch/Select/Tag/Kbd/Spinner/ProgressBar/EmptyState/ErrorPanel/SyncPill…）+ 桌面全部面板页 + DbView 表头/表体/输入格 + editor 代码块/块菜单/斜杠菜单/选区工具条。
- §1.2 内网格 → `1px solid var(--sc-color-ink-edge)`：DbView 单元格/列头分隔、ManualView 表格、editor 分隔线、App 侧栏底行线。宽度谱纪律测试钉死「仅 1px/2px」。
- §1.3 focus → 恒 ink-edge + 全局 focus-ring，禁彩晕（原 accent 光晕点已清）。
- §1.4 虚线（拖放区/空态 art/占位钮）线型保留、色升 ink-edge、宽归 2px。
- §1.5 `--sc-border` 系灰线在框轮廓处退役（token 保留给滚动条/内线）。

## 2. 改动清单

**35 文件（+311/−137）**：`git diff --stat` 全量在案。

- 2.1 packages/ui：20 CSS（控件族全覆盖）+ Divider.tsx 仅注释 + borders-t59.test.ts/tsx 回归适配 + 新纪律测试
- 2.2 packages/dbview：DbView.css（40 处 border：外框 2px/网格 1px；accent 编辑框→ink-edge；danger 校验态→白名单保留）——**零 TS 改动** ✓
- 2.3 packages/editor：editor.css（21 处）——**零 TS 改动** ✓
- 2.4 apps/desktop：18 CSS（App/AiChatPanel/ImportWizard/LayoutEditor/Manual/Settings/SyncStatus/AiSection/CommandPalette/Search/PageView/LayoutPicker/LayoutPreview/TabsBar/WikiLanding/CloseAsk/DbPage/TrashList）
- 文档：DESIGN.md「Pixel Borders」扩全局口径；PROJECT_PLAN §16.11 划旧「控件不加黑边」+ 新增 §16.12（R14 全局框线条款）

## 3. 纪律测试

`packages/ui/test/pixel-borders.test.ts`（292 行，CB 交付）：全产品 CSS 扫描逐条要求 ink-edge 或落**带理由白名单**（复位/透明占位/语义色 danger/accent-soft 底衬/Spinner 弱档）；扫描数与命中数、白名单分档、宽度谱分布每次运行打印；T59 17 处锚点回归护栏；28 个代表落点逐条钉。ui 包 156 用例全绿（含本文件）。

## 4. 真机探针（PM 复跑 `E:\Hermes Agent工作空间\_scratch\t62-pm4.log`）

**83 PASS / 0 FAIL**。要点原始值：

- 4.1/4.2 双主题 × 8 屏 computed：`topbar="2px solid rgb(26,26,26)"`、`pvRoot="2px solid rgb(26,26,26)"`、`tabLeft="2px solid rgb(26,26,26)"`（深色段 ink=rgb(237,237,237) 同构命中）
- 4.3 DbView 网格：G2 像素实测 dsf=1 截图解码——竖向网格线**整列 ink-edge 像素=1**、表头外框=2（宽度分层真机成立）
- 4.4 抽噪判：G3 浅/深 `inkShare=2.63%`（阈值 <25%）——黑网格成网格但不淹没内容
- G4 老成果零回归：T59 五接缝 + T52 骑缝（活动标签下缘 0px）全过
- G5/G7：16 截图落地、优雅退出、electron=0、真档案 untouched、node 净增=0

### 4.5 探针侧修复（PM，第 2/3 次验证「CB 探针首轮必带缺陷」惯例）

首轮 76/14 → 定性全为**探针侧**（产品 CSS 无缺陷）：① `.palette-opensearch` 需非空 query 才渲染——探针补输入「链接」；② `.layout-editor__json` 在「导入布局」Dialog 内——探针补点开+Escape；③ reload 还原最后激活页（db 轮后=DbPage 无 `.pv-root`）——新 `openNormalPage()` 按夹具标题点回；④ G7-2 node 绝对计数误伤本机 workbuddy MCP 宿主 3 进程——改基线差分。修后 83/0。

## 5. 截图清单

`docs/mockups/screens-t62/`：8 组 × 2 主题 = 16 张 + results.json（G2 像素量测 2 张为内存 clip，不入盘）。

## 6. 各包测试原始数值（PM 亲跑）

全仓 9 包无红：desktop **844** / ui **156** / editor **200** / dbview **122** / sync 109 / importer 59 / core 51 / platform 41+1skip / schema 3；typecheck 0 错；token `--check` ✓、no-magic ✓、像素图标门禁 ✓、`SELFTEST OK`；electron 残留=0。

## 7. DESIGN.md / tokens 同步

「Pixel Borders」小节已扩为全局口径（外框 2px/内网格 1px/接缝只画一次/控件豁免取消）；`build-tokens.mjs --check` 一致（ink-edge 值未动）。

## 8. 遗留与观察

- rc.3 未构建：本单未进任何包，等老板对 0.4.1 的发版决定一并处理（rc.2=本单前内容）。
- 建议老板装新包后随手开设置页/AI 面板/数据库页看一眼全局黑框观感（抽噪判 2.63% 属量化过，主观感受归老板）。

## DEVIATION

- **D-1（CB 预登记，PM 追认）**：danger 校验态红框（DbView 3 处 + Input 1 处 `--sc-color-danger`）保留语义色——与 T53「语义色仅留错误红/同步绿」既成立法一致，纪律测试白名单显式放行并打印。
- **D-2（CB 预登记，PM 追认）**：Spinner 旋转弧动段弱档 `hairline-strong`（旋转指示器非框轮廓）；白名单限定「仅 Spinner.css 允许」并有专测钉蔓延。
- **D-3（PM）**：CB 会话未及自报数值即被上游 429（09-23 12:53 重置）掐断，收尾与真机验证由 PM 完成；交付物完整度经工作树盘点确认（代码+纪律测试+探针骨架全在）。探针 4 处缺陷见 §4.5。
- **D-4（PM）**：Divider.tsx 有 diff——审核为**纯注释更新**（说明 hairline 走 background 非 border 属不动清单），零行为改动，追认。

## PM 复跑节

**判定依据=PM 实跑**：`cdp-e2e-t62-01.mjs` **83 PASS / 0 FAIL**（§4 原始值）；全仓 9 包无红 desktop 844 + ui 156；typecheck 0；token/no-magic/像素图标三门禁 ✓；SELFTEST OK；真档案 untouched。结论：**T62-01 验收通过**。
