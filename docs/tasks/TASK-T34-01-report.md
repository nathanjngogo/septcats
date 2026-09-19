# TASK-T34-01 交付报告 · 设计对齐：侧栏与顶栏模仿 Notion（配色 + 层级）

> 工程师：CodeBuddy（唯一作者）｜日期：2026-09-19
> 前置确认：起点 `f61e22b fix(ui): 块手柄装订线——四个窗口宽 overlap=false / gutter=12（T33-01 收口）` ✓
> 任务书：docs/tasks/TASK-T34-01.md（§0 采样表为真值来源）

## 0. 结论

完成。PM 逐像素采样表（浅色）已全量落进 `DESIGN.md` → token 产物 → 侧栏/顶栏/内容区 CSS；深色按 Notion 深色同构；双主题 × 四态齐备。全部门禁与自跑绿：

| 自跑项 | 结果 |
|---|---|
| `node packages/ui/tokens/build-tokens.mjs --write` 后 `--check` | ✓ 一致 |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 0 命中 |
| `pnpm -C packages/ui test` | ✓ 28 文件 79 用例全绿（含对比度 9 条 + T34 色值锚定 3 条） |
| `pnpm -C apps/desktop test` | ✓ 43 文件 449 用例全绿 |
| `pnpm -r typecheck` | ✓ 全部 Done |

真机 CDP 层测（docs/mockups/cdp-shots-t34.mjs，独立夹具根 `--user-data-dir` + rootPath，未触碰默认根）：

| 探针 | 结果 |
|---|---|
| 浅色：顶栏 = 侧栏 = rgb(249,248,247)（#F9F8F7） | PASS |
| 浅色：内容区 = rgb(255,255,255)（#FFFFFF） | PASS |
| 浅色：选中行 = rgb(238,236,235)（#EEECEB） | PASS |
| 浅色：主文字 = rgb(44,44,43)（#2C2C2B） | PASS |
| 深色：顶栏 = 侧栏 = rgb(32,32,32)（#202020） | PASS |
| 深色：内容区 = rgb(25,25,25)（#191919） | PASS |
| 回归（T30）：折叠后侧栏 display:none | PASS |

截图（浅/深各一，侧栏+顶栏同框，顶栏与侧栏同色可辨）：
- docs/mockups/screens-t34/t34-light-sidebar-topbar.png
- docs/mockups/screens-t34/t34-dark-sidebar-topbar.png

## 1. 色值对照表（目标 = 任务书 §0 采样值 ｜ 实现 = tokens 产物 + CDP computed style 实测）

### 浅色

| 语义 | 目标 | 实现 token | 实现值 | 实测 |
|---|---|---|---|---|
| 侧栏背景 | `#F9F8F7` | `canvas` | `#F9F8F7` | ✓ rgb(249,248,247) |
| 顶栏背景（与侧栏同色） | `#F9F8F7` | `canvas`（同 token 保证同色） | `#F9F8F7` | ✓ rgb(249,248,247) |
| 内容区背景 | `#FFFFFF` | `content`（新） | `#FFFFFF` | ✓ rgb(255,255,255) |
| 行悬停 | `#F1F0EF` | `surface` | `#F1F0EF` | token 层锚定（t34 测试） |
| 行选中 | `#EEECEB` | `surface-active`（新） | `#EEECEB` | ✓ rgb(238,236,235) |
| 主文字 | `#2C2C2B` | `ink` | `#2C2C2B` | ✓ rgb(44,44,43) |
| 次级文字 | `#5F5E59` | `ink-secondary` | `#5F5E59` | token 层锚定 |
| 图标/弱化（非文字） | `#8E8B86` | `icon-faint`（新） | `#8E8B86` | 仅图标位（三角/行图标/分组标题图标） |
| hairline | `#EAE8E6` | `hairline` | `#EAE8E6` | token 层锚定 |
| 强调色 | `#FA5151` | 未落 token | — | 见 DEVIATION-3 |

### 深色（Notion 深色同构）

| 语义 | 目标 | 实现 token | 实现值 | 实测 |
|---|---|---|---|---|
| 侧栏/顶栏 | `#202020` | `canvas` dark | `#202020` | ✓ rgb(32,32,32) |
| 内容区 | `#191919` | `content` dark | `#191919` | ✓ rgb(25,25,25) |
| 主文字 | `#FFFFFFE6` | `ink` dark | `#E9E9E9`（对 #202020 合成） | ✓ rgb(233,233,233) |
| 弱化（非文字） | `#FFFFFF7A` | `icon-faint` dark | `#8B8B8B`（对 #202020 合成） | 仅图标位 |
| hairline | `#2F2F2F` | `hairline` dark | `#2F2F2F` | token 层锚定 |
| 行悬停 | （未采样） | `surface` dark | `#252525`（派生，见 DEVIATION-7） | — |
| 行选中 | （未采样） | `surface-active` dark | `#2C2C2C`（派生，见 DEVIATION-7） | ✓ rgb(44,44,44) |

## 2. 对比度门禁（packages/ui/test/contrast.test.ts，≥4.5）

既有断言全绿且**加强**：BACKDROPS 纳入 `content` 平面（文字断言 13 对 → 17 对，无放松）。文字 token 全矩阵实测（测试日志原样）：

```
light ink/canvas 13.18 · ink/surface 12.28 · ink/surface-raised 13.98 · ink/content 13.98
light ink-secondary 6.13/5.71/6.50/6.50    light ink-faint 5.17/4.82/5.48/5.48（最差 4.82 /surface）
dark  ink 13.42/12.63/11.19/14.48
dark  ink-secondary 6.77/6.37/5.64/7.31    dark  ink-faint 5.79/5.45/4.83/6.25（最差 4.83 /surface-raised）
```

on-accent/accent、accent/canvas、danger/canvas、success/canvas 两主题全部 ≥4.5（测试断言通过）。锚定测试更新为新裁决值：ink-faint 浅 `#6B6964` / 深 `#9C9A94`（见 DEVIATION-1）。`icon-faint`（#8E8B86/#8B8B8B）不是文字 token，只用于图标/三角/非文字弱化位，未出现在任何正文级文字上。

## 3. 改动清单（均在任务书红线允许面内）

- `DESIGN.md`：front matter colors 全表换采样值并新增 `content` / `surface-active` / `icon-faint`；typography 新增 `ui-md`（14px）；「深色主题映射」表重写；Overview/Colors/Layout/Components 同步（五级平面、icon-faint 禁令、侧栏行几何、面包屑组件规格）。
- token 产物（脚本生成，未手改）：`packages/ui/src/tokens.css`、`packages/ui/src/tokens.ts`。
- `packages/ui/src/AppShell.css`：topbar 注释明确与侧栏同用 `canvas`（同 token 保证同色）；`.sc-shell__main` 新增 `background: var(--sc-color-content)`；sidebar 注释。几何零改动（T30 折叠契约原样）。
- `packages/ui/src/Breadcrumb.css`：面包屑 `ui-sm`(13px) → `ui-md`(14px)。
- `apps/desktop/src/renderer/src/App.css`：行高 26px→28px（`calc(xxl+xs)`，token 派生）、行内左右 padding 8px；hover=surface、按压/选中=surface-active；行图标与折叠三角 icon-faint（选中行回 ink）；分组标题行 `app-nav-row--head`（ui-xs + ink-faint 文字 + icon-faint 图标）；重命名输入框底改 surface-raised；底部工具行（回收站）文字弱化 ink-faint，激活态 surface-active + ink。结构与折叠行为零改动。
- `apps/desktop/src/renderer/src/pages/SidebarTree.tsx`：NavRow 增加 `head` 布尔 prop（收藏/最近分组标题行样式位），数据流/结构/测试 id 零改动。
- `apps/desktop/src/renderer/src/pages/PageView.css`：`.pv-root` 底色 canvas → content（内容区白）。
- 测试：`packages/ui/test/contrast.test.ts`（锚定值更新 + content 平面 + 报告口径矩阵）、新增 `packages/ui/test/t34-notion-colors.test.ts`（采样值锚定 + AppShell 接线断言）、`apps/desktop/test/ui-interaction-audit.test.ts`（1 条断言 token 名更新，见 DEVIATION-4）。
- 截图脚本：`docs/mockups/cdp-shots-t34.mjs`（可复跑）。

## 4. DEVIATION 逐条（待 PM 追认）

1. **ink-faint 未用采样弱化色**：`#8E8B86` 对 canvas 实测 3.11 < 4.5（AA 门禁 + 任务书 §1.5 自身禁令），文字级弱化改用同亮度档暖灰 `#6B6964`（浅）/`#9C9A94`（深）；`#8E8B86` 落为新 token `icon-faint`，仅图标/非文字。contrast.test.ts 锚定断言值随之更新（原 #666C75/#8E94A0 为冷灰，与 Notion 暖灰家族不相容；断言语义不变：防回归锚定 + ≥4.5）。
2. **深色带 alpha 采样值以合成 6-hex 落 token**：`#FFFFFFE6`→`#E9E9E9`、`#FFFFFF7A`→`#8B8B8B`（对侧栏底 #202020 合成）。原因：contrast 门禁与 build-tokens 解析器只接受 6-hex；换算式已写进 DESIGN.md 深色表头注。
3. **强调色未采用采样红 `#FA5151`**：对 canvas 实测 3.11 < 4.5（门禁 accent/canvas 必须 ≥4.5），且当前 UI 无红点/提醒角标位可承载；accent 保持品牌琥珀 `#A16207`（DESIGN.md §17 铃铛叙事）。后续若做提醒角标，建议另立 danger 系 token 而非动 accent。
4. **侧栏选中/按压态从 accent 口径改为中性面**（Notion 同构）：`app-nav-row:active/--active`、`app-side-foot--active` 由 accent-soft/accent → `surface-active`/`ink`；选中行图标 accent → ink。T27-01 巡检断言 `app-nav-row:active` 的期望 token 由 accent-soft 改为 surface-active（其余 4 个内容区组件仍钉 accent-soft，语义不变：按压态走 token 色无字面色）。DESIGN.md accent 用途清单同步删去「当前选中指示」（侧栏语境）。
5. **分组标题文字色**：§1.3 建议「小字 + #8E8B86」，与 §1.5「#8E8B86 不允许用于正文级文字」冲突——组标题是可读文字，取 §1.5 优先：文字 ink-faint（AA 4.82+）、图标 icon-faint、字号 ui-xs。
6. **对比度门禁扩展**：BACKDROPS 增加 content 平面（13→17 对文字断言）+ 报告口径日志扩展为全文字 token 矩阵。纯加强、无放松，两主题最差对 4.82/4.83 仍 ≥4.5。
7. **深色派生值待复采**：老板截图仅浅色；深色 surface `#252525`、surface-active `#2C2C2C`、surface-raised `#2E2E2E`、ink-secondary `#A9A7A1`、hairline-strong `#424242` 为 Notion 深色同构派生（任务书 §0 已预告 PM 后续深色采样精修）。
8. **DbPage 底色未动**：`.dbpage` 仍走 canvas（文件不在本单允许清单），数据库页内容底与 PageView（content 白）在浅色下存在 #F9F8F7 vs #FFFFFF 差异。待 PM 追认后另单接线 content。
9. **hover 底色采用推得值 `#F1F0EF`**：任务书注明「由 #F9F8F7/#EEECEB 推得，允许微调」，未再实测微调。
10. **面包屑 13px → 14px**：新增字阶 token `ui-md`（14px/450）承接 §1.2「14px 量级」，Breadcrumb 组件消费；其余 ui-sm 场景不动。

## 5. 复跑指引（PM 补）

（PM 补）

## 6. 遗留与移交

- 真机验收（老板截图并排对比）、全仓 `pnpm -r test`、selftest、重打包：留 PM。
- DEVIATION-8（DbPage content 接线）待 PM 追认后立小单。
- 深色主题待老板深色截图后复采精修（DEVIATION-7）。
