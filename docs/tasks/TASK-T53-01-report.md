# TASK-T53-01 交付报告 · P2 像素风立体按钮 + 全局黑白灰化（覆盖 Notion 配色）

> 工程师：CBL ｜ 前置：T52-01 交付提交 `244fc37`（已 `git log -1` 确认）｜ 老板 09-21 原话
> 「3. 所有按键应该更立体一些，风格可以改为像素风。整体黑白灰的风格。」
> 口径来源：`docs/tasks/TASK-T53-01.md` §0 + 附录 A（PM 灰阶色板与对比度预算）。「17 对」口径换算见 §2.4。

---

## 0. 结论

任务书 §1 五项 + §2 四项数值化验收**全部落地**，真机取证 **41 PASS / 0 FAIL**（其中 T52 回归电池 23 条**原样复跑全绿**）、`realRoot untouched=true`、`window.close()` 优雅退出。

| 面 | 结果（真机原始值 / 命令原始输出） |
| --- | --- |
| ① 色板灰阶化 | DESIGN.md 中性轴全轴灰阶（浅 `canvas #F5F5F5` / `ink #1A1A1A` / `surface-active #DFDFDF`…；深 `#141414` / `#EDEDED` / `#2A2A2A`…），token 名一个未改；`build-tokens --write` 产物与 DESIGN.md `--check` 一致（exit 0） |
| ② 对比度 | 门禁配对 **16 对 × 2 主题 = 32 对全 ≥4.5**（最差 `light ink-faint/surface = 4.55`）；附录 A 预算的 15 文字对 + 4 语义对全过（唯门禁外的 `ink-faint/surface-active` 浅 4.00 已用 CSS 收敛，见 D-4） |
| ③ 语义色只留两粒 | 形式证明：两主题 17 枚中性/强调/立体 token **全为纯灰（r=g=b）**，`danger`/`success` **带彩**（G9-2/G9-3；落点坐标值见 §3.3） |
| ④ 按钮立体化 | `packages/ui` 9 个组件 CSS + desktop 5 个 CSS 全量吃新 token；真机按压 `hover 凸（rgb(255,255,255) 2px 2px 0 0 inset）→ mousedown 凹（rgb(169,169,169) 2px 2px 0 0 inset）+ transform matrix(1,0,0,1,2,2)`（下沉 2px + 亮暗对调） |
| ⑤ T52 语义不破 | 侧栏通高 top=0 / 通高 735=innerHeight；折叠钮 `x=260∈[248,312]`、24×24、`Δy=0.0`；`.tabsbar` 与活动标签 `border-bottom=0px`、活动标签底 `rgb(255,255,255)=pvBg`（深色 `rgb(10,10,10)=pvBg`）、下缘命中 `pv-root`；四宽度零滚动；T33 装订线 70px / gutter 12 / overlap=false |
| ⑥ 红线不碰 | 字体仍自托管思源黑体（`--sc-font-ui` + `body` fontFamily 实测含 `Noto Sans SC`）、动效仍 `spring 100/20` + `cubic-bezier(0.16,1,0.3,1)`、图标仍 Phosphor 单族（未动）；未碰 `core/sync/importer/dbview/editor`；未加依赖；未动 git |

---

## 1. 改动清单

### 1.1 真源与产物

| 文件 | 改动 |
| --- | --- |
| `DESIGN.md` | ① front matter `colors` 浅色 19 枚全部灰阶化 + 新增 3 枚立体色（`bevel-hi`/`bevel-lo`/`shadow-pixel`）→ 22 枚；② `rounded` 家族整体像素化（4/6/8/12/16 → 2/2/4/6/8）；③ `elevation` 新增 `bevel-out`/`bevel-in`/`pixel-out`/`pixel-flat` 四几何；④「深色主题映射」表 22 行逐 token 双值；⑤ prose（Overview / 深色主题映射 / Colors / Elevation & Depth / Shapes / Components / Do's and Don'ts / Layout）同步新口径 |
| `packages/ui/src/tokens.css`、`tokens.ts` | 由 `node packages/ui/tokens/build-tokens.mjs --write` **生成**（未手改）；`--check` 与 DESIGN.md 一致 |

### 1.2 组件 CSS（吃新 bevel/shadow token）

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/Button.css` | 基类过渡加 `box-shadow`；`:active` 由 `translateY(1px)` 升级为 `bevel-in + translate(xxs, xxs)`（下沉 2px + 亮暗对调）；`--primary`/`--secondary`/`--destructive` 挂 `pixel-out`；`--ghost` hover 挂 `bevel-out`（透明底不挂 offset 投影，工具条成排不互相压影） |
| `packages/ui/src/IconButton.css` | hover 挂 `bevel-out`（背景 surface）；`:active` 挂 `bevel-in + 下沉 2px` |
| `packages/ui/src/Input.css` | 静止态 = 凹陷面（`bevel-in`）；**focus 由 accent 边框改为 `border-color: ink` + `bevel-in`**（明度差 + 描边方案） |
| `packages/ui/src/Checkbox.css` | 未选中 = 凹槽（`bevel-in`）；选中/半选 = 凸起（`accent` 实心 + `bevel-out`）→ 状态靠**亮暗对调**表达；焦点环改用 `outline`（不覆盖立体） |
| `packages/ui/src/Switch.css` | 轨 = 凹槽（`bevel-in`）；滑块 = `pixel-flat`（无 blur 的实心 offset 影，替掉原 tinted 软影）；`:active` 下沉 2px |
| `packages/ui/src/Select.css` | trigger 挂 `bevel-out`；`:active` 凹陷 + 下沉 2px；过渡含 `box-shadow`/`transform` |
| `packages/ui/src/RadioGroup.css` | 分段底座 = 凹槽（`bevel-in`）；选中项 = 凸起（`bevel-out`，替掉原 tinted 软影） |
| `packages/ui/src/Kbd.css` | 键帽改吃 `bevel-out`（去掉 `border-bottom-width: 2px` 字面几何） |
| `packages/ui/src/SyncPill.css` | `--busy` 由 accent 琥珀点 → **success 绿呼吸点**（§0「同步点保留绿」） |
| `apps/desktop/src/renderer/src/App.css` | `.app-nav-suffix` hover/active 挂 `bevel-out`/`bevel-in`（原 `:active` 走 accent 色相退役）；`.app-nav-input` 挂 `bevel-in`；**AA 收敛**：`.app-nav-row--active .app-nav-count` 提一档到 `ink-secondary` |
| `apps/desktop/src/renderer/src/tabs/TabsBar.css` | 非活动标签挂 `bevel-out`、hover/按压挂 `bevel-in`（**按压不位移**：标签底边贴正文，位移会撕开融合缝）；**活动标签显式 `box-shadow: none`**；`.tabsbar-close` hover 凸 / active 凹 |
| `apps/desktop/src/renderer/src/sync/SyncStatus.css` | `--syncing` accent → **success 绿**；`--degraded` accent 橙点+accent-soft 环 → **ink-secondary 灰点 + surface-active 2px 描边环**；`.sc-sync-status__button` 挂 `bevel-out`，hover 由 accent 色相改「描边提墨」，`:active` 凹陷 + 下沉 2px |
| `apps/desktop/src/renderer/src/layout/LayoutSection.css` | `.layout-preset-card` 挂 `bevel-out`，`:active` 凹陷；`--active` 由 accent 边框改 **ink 描边 + 凹陷面**；因新增过渡补 `prefers-reduced-motion` 兜底块 |
| `apps/desktop/src/renderer/src/pages/PageView.css` | `.pv-handle` hover/active 挂 `bevel-out`/`bevel-in`（不参与布局）；`@media (prefers-reduced-motion)` 兜底块；**AA 收敛**：`.pv-backlinks__item:hover .pv-backlinks__context` 提一档到 `ink-secondary` |

> **零 CSS 改动即吃到新值**：其余 74 处 `accent`/`accent-soft` 消费端引用（`packages/ui/src` 9、`packages/editor` 9、`packages/dbview` 19、`apps/desktop` 37）随 token 换值即时灰阶化，**未改一行 CSS**；其中 `packages/editor`、`packages/dbview` 属本单红线禁区。

### 1.3 层测

| 文件 | 改动 |
| --- | --- |
| `packages/ui/test/contrast.test.ts` | 更新 ink-faint 锚定值（`#6B6964/#9C9A94` → `#6B6B6B/#909090`）；「报告口径」用例扩到**门禁全配对**（12 文字对 + 4 语义/强调对 × 2 主题）逐对比值打进测试输出。**配对表本身一字未改**（口径同 T34：以门禁为准） |
| `packages/ui/test/t53-gray-colors.test.ts` **（新，替代 t34-notion-colors.test.ts）** | 5 组 12 例：① 浅/深灰阶裁决值逐 token 锚定；② accent 灰化 + 两粒语义色未灰；③ **Notion 旧值零残留**（8 个旧 hex 扫 DESIGN.md）；④ 像素立体 token 形状（三色双值、四几何只引 token、offset blur=0 且位移 2px、bevel-out/in 严格对调、圆角 ≤2px）；⑤ AppShell 三面 token 契约不破 |

---

## 2. 灰阶对照表（旧值 → 新值 × 对比度）

### 2.1 逐 token 新旧值（全量 22 枚）

| token | 旧值（浅，T34-01 Notion 采样） | 新值（浅） | 旧值（深） | 新值（深） |
| --- | --- | --- | --- | --- |
| canvas | #F9F8F7 | **#F5F5F5** | #202020 | **#141414** |
| surface | #F1F0EF | **#EDEDED** | #252525 | **#1E1E1E** |
| surface-raised | #FFFFFF | #FFFFFF | #2E2E2E | **#262626** |
| content | #FFFFFF | #FFFFFF | #191919 | **#0A0A0A** |
| surface-active | #EEECEB | **#DFDFDF** | #2C2C2C | **#2A2A2A** |
| ink | #2C2C2B | **#1A1A1A** | #E9E9E9 | **#EDEDED** |
| ink-secondary | #5F5E59 | **#595959** | #A9A7A1 | **#A8A8A8** |
| ink-faint | #6B6964 | **#6B6B6B**（提档） | #9C9A94 | **#909090**（提档） |
| icon-faint | #8E8B86 | **#9A9A9A** | #8B8B8B | **#6E6E6E** |
| hairline | #EAE8E6 | **#DDDDDD** | #2F2F2F | **#2E2E2E** |
| hairline-strong | #D2D2CC | **#C4C4C4** | #424242 | **#3F3F3F** |
| accent | #A16207（琥珀） | **#333333**（灰） | #D9A441 | **#D4D4D4** |
| accent-soft | #F6EEDD | **#E6E6E6** | #33290F | **#333333** |
| on-accent | #FFFFFF | #FFFFFF | #1C1E21 | **#141414** |
| danger | #8A2B1C | #8A2B1C（**保留红**） | #F2B8AD | #F2B8AD（**保留红**） |
| danger-soft | #FBEFEC | **#F5E5E1** | #3A1E1A | #3A1E1A |
| success | #3F6B34 | #3F6B34（**保留绿**） | #9CCB8F | #9CCB8F（**保留绿**） |
| focus-ring | #A16207 | **#1A1A1A** | #D9A441 | **#EDEDED** |
| selection | #E8DDBC | **#D4D4D4** | #42381C | **#3A3A3A** |
| bevel-hi | —（新增） | **#FFFFFF** | — | **#565656** |
| bevel-lo | —（新增） | **#A9A9A9** | — | **#0A0A0A** |
| shadow-pixel | —（新增） | **#C6C6C6** | — | **#050505** |

### 2.2 门禁配对表逐对比值（32 对，全 ≥4.5；旧值列为 T34 色板同口径复算）

**浅色**

| 配对 | 旧比值 | 新比值 | 判定 |
| --- | --- | --- | --- |
| ink/canvas | 13.18 | **15.96** | ✓ |
| ink/surface | 12.28 | **14.87** | ✓ |
| ink/surface-raised | 13.98 | **17.40** | ✓ |
| ink/content | 13.98 | **17.40** | ✓ |
| ink-secondary/canvas | 6.13 | **6.42** | ✓ |
| ink-secondary/surface | 5.71 | **5.98** | ✓ |
| ink-secondary/surface-raised | 6.50 | **7.00** | ✓ |
| ink-secondary/content | 6.50 | **7.00** | ✓ |
| ink-faint/canvas | 5.17 | **4.89** | ✓ |
| ink-faint/surface | 4.82 | **4.55** ← 两主题最差对 | ✓ |
| ink-faint/surface-raised | 5.48 | **5.33** | ✓ |
| ink-faint/content | 5.48 | **5.33** | ✓ |
| accent/canvas | 4.64 | **11.59** | ✓ |
| danger/canvas | 8.10 | **7.88** | ✓ |
| success/canvas | 5.89 | **5.73** | ✓ |
| on-accent/accent | 4.92 | **12.63** | ✓ |

**深色**

| 配对 | 旧比值 | 新比值 | 判定 |
| --- | --- | --- | --- |
| ink/canvas | 13.42 | **15.74** | ✓ |
| ink/surface | 12.63 | **14.24** | ✓ |
| ink/surface-raised | 11.19 | **12.93** | ✓ |
| ink/content | 14.48 | **16.91** | ✓ |
| ink-secondary/canvas | 6.77 | **7.75** | ✓ |
| ink-secondary/surface | 6.37 | **7.01** | ✓ |
| ink-secondary/surface-raised | 5.64 | **6.36** | ✓ |
| ink-secondary/content | 7.31 | **8.33** | ✓ |
| ink-faint/canvas | 5.79 | **5.77** | ✓ |
| ink-faint/surface | 5.45 | **5.22** | ✓ |
| ink-faint/surface-raised | 4.83 | **4.74** | ✓ |
| ink-faint/content | 6.25 | **6.20** | ✓ |
| accent/canvas | 7.24 | **12.43** | ✓ |
| danger/canvas | 9.49 | **10.73** | ✓ |
| success/canvas | 8.81 | **9.96** | ✓ |
| on-accent/accent | 7.43 | **12.43** | ✓ |

（上表 = `packages/ui/test/contrast.test.ts` 的 `报告口径` 用例原始输出，四舍五入到两位。）

### 2.3 ink-faint 提档推导（为什么不是附录 A 预案的 `#6E6E6E`）

| 候选 | ink-faint/canvas | ink-faint/surface | ink-faint/surface-raised | 结论 |
| --- | --- | --- | --- | --- |
| `#757575`（附录 A 起点） | 4.23 | **3.94 ✗** | 4.61 | 不过 |
| `#6E6E6E`（附录 A 预案） | 4.68 | **4.36 ✗** | 5.10 | **仍不过**（预案只对了 canvas 一条） |
| `#6B6B6B`（**本单落值**） | 4.89 | **4.55 ✓** | 5.33 | 过（余量 0.05） |

深色同理：`#8C8C8C` 对 `surface-raised #262626` = **4.5004**（余量 0.0004，浮点贴线不可接受）→ 提档 **`#909090`** = 4.74，`/content` = 6.20。

### 2.4 「17 对」口径换算

任务书正文的「17 对」= 门禁每主题的断言条数：**12 文字对（3 文字 token × 4 平面）+ 4 语义/强调对 + 1 层次对（`ink-faint ≠ ink-secondary`）= 17**。真机与门禁实跑覆盖：**每主题 17 条 × 2 主题 = 34 条断言**，其中 32 条为比值对（上表）。附录 A 的「15 文字对」多出的 `surface-active` 平面不在门禁配对表内（口径同 T34：以门禁为准），本单已额外复算（下表）并处理其唯一真实落点。

### 2.5 门禁外配对（如实披露 + 已收敛）

| 配对 | 浅 | 深 | 处理 |
| --- | --- | --- | --- |
| ink-faint/surface-active | **4.00 ✗** | 4.50（贴线） | 门禁表外。浅色唯一真实落点（选中行计数、双链面板行 hover 上下文）已用 CSS 提一档到 `ink-secondary`（5.26 / 6.04）→ 见 §1.2 的「AA 收敛」两条。**残留**：`.sc-select__trigger:active` 的占位文案是瞬时按压态（<120ms），未单独处理 |
| ink-secondary/surface-active | 5.26 | 6.04 | 达标 |
| icon-faint/canvas | 2.58 | 3.61 | 非文字 token，按 T34-01 既有裁决不进文字门禁（只用于图标/三角/装饰） |
| ink/danger-soft | 14.24 | 12.99 | 达标 |
| danger/danger-soft | 7.03 | 8.86 | 达标 |

---

## 3. accent 灰化后的状态表达逐处清单

### 3.1 处理口径

`accent` 由品牌琥珀 `#A16207/#D9A441` 灰阶化为 **`#333333/#D4D4D4` 深灰实心**。凡原本**用 accent 色相表达状态**的位置，一律改走 **明度差 + 描边（+ 像素亮暗面）**；`danger`/`success` 两粒语义色保留色相。

### 3.2 逐处清单（本单改动 13 处 + 保留 4 处）

| # | 位置（文件:选择器） | 原 accent 语义 | 处理 |
| --- | --- | --- | --- |
| 1 | `packages/ui/src/Input.css:35` `.sc-field__control:focus-visible` | 焦点 = 琥珀边框 | **改**：`border-color: ink` + `box-shadow: bevel-in`（描边提墨 + 凹陷） |
| 2 | `packages/ui/src/Checkbox.css:41-43` `:checked/:indeterminate + .sc-cbx__box` | 选中 = 琥珀底 | **改**：灰实心底 + `bevel-out` 亮暗面（凹凸对调表达状态） |
| 3 | `packages/ui/src/Switch.css:30` `.sc-switch--on` | 开 = 琥珀轨 | **改**：灰实心轨 + 轨凹陷 + 滑块实心 offset 影（位置 + 空间双线索） |
| 4 | `packages/ui/src/SyncPill.css:22,26` `.sc-sync--busy` | 同步中 = 琥珀呼吸点 | **改**：`success` 绿呼吸点（§0 同步点保留绿） |
| 5 | `apps/desktop/.../sync/SyncStatus.css:60,63` `--syncing` | 同步中 = 琥珀呼吸点 | **改**：`success` 绿呼吸点（与 ok 静态绿点靠动画区分） |
| 6 | `apps/desktop/.../sync/SyncStatus.css:75-80` `--degraded` | 降级 = 橙点 + 橙软环 | **改**：`ink-secondary` 灰点 + `surface-active` 2px 描边环（明度差 + 描边） |
| 7 | `apps/desktop/.../sync/SyncStatus.css:221-226` `.sc-sync-status__button:hover` | hover = 琥珀边框/文字 | **改**：`hairline-strong → ink-faint` 描边 + 文字提墨 `ink` |
| 8 | `apps/desktop/.../sync/SyncStatus.css:228-232` `.sc-sync-status__button:active` | 按压 = accent-soft 底 | **改**：`surface-active` 底 + `bevel-in` + 下沉 2px |
| 9 | `apps/desktop/src/renderer/src/App.css:249-261` `.app-nav-suffix:hover/:active` | 按压 = accent 色 | **改**：`ink` 文字 + `bevel-out`/`bevel-in` |
| 10 | `apps/desktop/.../layout/LayoutSection.css:47-52` `.layout-preset-card--active` | 选中 = accent 边框 | **改**：`ink` 描边 + `surface-active` 底 + `bevel-in` |
| 11 | `packages/ui/src/RadioGroup.css:44-49` `.sc-radio--on` | 选中 = tinted 软影 | **改**：`bevel-out` 硬边亮暗面（从底座凹槽里凸出来） |
| 12 | `apps/desktop/.../tabs/TabsBar.css:77-93` 活动标签 | 强调 = 色相 | **改**：`content` 底 + 无分隔线（T52 既有明度差语义，本单**不挂 bevel**，见 D-6） |
| 13 | `apps/desktop/src/renderer/src/App.css:159-166` 选中行计数 | 弱化文字 | **改**：选中行内 ink-faint 提档 `ink-secondary`（AA 收敛，见 §2.5） |
| 14 | `apps/desktop/.../tabs/TabsBar.css:98-101` `.tabsbar-title--drop` | 拖拽落点 = accent 下划线 | **保留 accent**（已灰）：深灰下划线在 content/surface 上仍可辨（明度差） |
| 15 | `apps/desktop/.../pages/PageView.css:78-92` `.pv-dropline`(+`::before` 圆点) | 拖拽插入线 = accent | **保留 accent**（已灰） |
| 16 | `apps/desktop/.../pages/PageView.css:141-142` `.pv-backlinks__source` | 反向链接来源 | **保留 accent**（已灰；对 content 12.2:1） |
| 17 | `packages/ui/src/Select.css:86` `.sc-select__option--active` | 选中项底 = accent-soft | **保留 accent-soft**（已灰，浅 `#E6E6E6` / 深 `#333333`） |

**其余 74 处 accent/accent-soft 消费端**（含 `packages/editor` 9、`packages/dbview` 19 —— 两包为本单红线禁区）**零 CSS 改动，随 token 换值即时灰阶化**。

### 3.3 两粒语义色的落点坐标值（写进报告）

| 语义 | token | 浅色值 | 深色值 | 屏幕落点（选择器） | 色值对比 |
| --- | --- | --- | --- | --- | --- |
| **错误红** | `danger` | **#8A2B1C** | **#F2B8AD** | `Input.css` 错误态边框/错误文案、`Button.css:70` `.sc-btn--destructive`、`SyncPill.css:31,42` 失败点/角标、`SyncStatus.css:87,90,185` 失败点/面板错误行、`Toast.css:31` `.sc-toast__item--danger` 图标、`Menu.css:31` `.sc-menu__item--danger`、`Tag.css:23` `.sc-tag--red` | 红对 canvas 7.88（浅）/10.73（深）；白字对红底 12.63 级 |
| **错误红（软底）** | `danger-soft` | **#F5E5E1** | **#3A1E1A** | `Tag.css:21` `.sc-tag--red` 底、`ImportWizard.css:84` `.wiz-error` 底 | danger 对 danger-soft 7.03 / 8.86 |
| **同步绿** | `success` | **#3F6B34** | **#9CCB8F** | `SyncStatus.css:60,63` `--syncing` 呼吸点、`SyncStatus.css:72` `--ok` 静默点、`SyncPill.css:22,26` `--busy` 点、`Toast.css:28` `.sc-toast__item--success` 图标、`SettingsPage.css:123,188` 保存成功文案 | 绿对 canvas **5.73（浅）/9.96（深）**（浅色最紧，仍在 AA 内） |

> 两粒的色值恒等（未被灰阶化）：真机断言 G9-3 / G9-3b 用「r/g/b 不全等」形式证明两主题下都带彩。

---

## 4. 像素立体语法（token 表 + 组件落点）

### 4.1 token（`DESIGN.md` front matter，构建脚本翻译为 `--sc-*`）

| token | 浅色 | 深色 |
| --- | --- | --- |
| `--sc-color-bevel-hi` | #FFFFFF | #565656 |
| `--sc-color-bevel-lo` | #A9A9A9 | #0A0A0A |
| `--sc-color-shadow-pixel` | #C6C6C6 | #050505 |
| `--sc-bevel-out` | `inset 2px 2px 0 0 var(--sc-color-bevel-hi), inset -2px -2px 0 0 var(--sc-color-bevel-lo)` | 同几何换色 |
| `--sc-bevel-in` | `inset 2px 2px 0 0 var(--sc-color-bevel-lo), inset -2px -2px 0 0 var(--sc-color-bevel-hi)` | 同几何换色 |
| `--sc-pixel-out` | `2px 2px 0 0 var(--sc-color-shadow-pixel), inset 2px 2px 0 0 var(--sc-color-bevel-hi), inset -2px -2px 0 0 var(--sc-color-bevel-lo)` | 同几何换色 |
| `--sc-pixel-flat` | `2px 2px 0 0 var(--sc-color-shadow-pixel)` | 同几何换色 |

- **blur 恒为 0**（真机断言 G9-5a）；位移恒为 2px，恰等于 offset 投影量 → 按压「压进自己的影子里」。
- 字面量零入 CSS：四组几何都在 DESIGN.md（`no-magic` exit 0 佐证）。
- 圆角：控件档 `xs/sm = 2px`、浮层档 `md/lg/xl = 4/6/8px`、`full = 999px`（仅 pill）。

### 4.2 组件落点

| 组件 | 静止 | hover | 按压 |
| --- | --- | --- | --- |
| `Button --primary/--secondary/--destructive` | `pixel-out` | ±明度（brightness / surface） | `bevel-in` + 下沉 2px |
| `Button --ghost` | 无影 | `surface` + `bevel-out` | `bevel-in` + 下沉 2px |
| `IconButton` | 无影 | `surface` + `bevel-out` | `bevel-in` + 下沉 2px |
| `Input` / 行内重命名框 | `bevel-in`（凹） | 描边 `hairline-strong` | focus：描边 `ink` |
| `Checkbox` | `bevel-in`（凹） | — | 选中：灰实心 + `bevel-out`（凸） |
| `Switch` | 轨 `bevel-in` + 滑块 `pixel-flat` | — | 下沉 2px |
| `Select` trigger | `bevel-out` | `surface` | `bevel-in` + 下沉 2px |
| `RadioGroup` | 底座 `bevel-in` | — | 选中项 `bevel-out` |
| `Kbd` | `bevel-out` | — | — |
| 非活动标签 | `bevel-out` | `surface-active` + `bevel-in` | `bevel-in`（不位移） |
| 标签 × / 侧栏后缀箭头 | 无影 | `bevel-out` | `bevel-in` |
| 同步面板按钮 / 布局预设卡 | `bevel-out` | 描边提墨 | `bevel-in` + 下沉 2px |
| 块手柄簇 `.pv-handle` | 无影 | `bevel-out` | `bevel-in` |

---

## 5. 数值化验收（原始输出）

### 5.1 全仓 `pnpm -r test`

```
packages/core      Test Files  9 passed (9)      Tests  51 passed (51)
packages/platform  Test Files  4 passed (4)      Tests  41 passed | 1 skipped (42)
packages/ui        Test Files 28 passed (28)     Tests  86 passed (86)      ← 含 contrast.test.ts 9 例全绿
packages/schema    Test Files  1 passed (1)      Tests   3 passed (3)
packages/sync      Test Files 11 passed (11)     Tests 109 passed (109)
packages/editor    Test Files 11 passed (11)     Tests 197 passed (197)
packages/dbview    Test Files  5 passed (5)      Tests 122 passed (122)
packages/importer  Test Files  4 passed (4)      Tests  59 passed (59)
apps/desktop       Test Files 59 passed (59)     Tests 663 passed (663)
```

基线（T52）：`apps/desktop 663` / `packages/ui 79`（T52 报告口径）。本单：desktop **663（持平）**、ui **86（+7 = 新增 `t53-gray-colors.test.ts` 10 例 − 删 `t34-notion-colors.test.ts` 3 例）**；`contrast.test.ts` 仍 9 例（断言条数与配对表未变，只更新锚定值 + 扩报告用例的打印范围）。**「全仓无红」达成**（本单 4 次全仓跑：3 次全绿；1 次仅 `perf` 时序例抖动，见 D-13）。

### 5.2 `pnpm -r typecheck`

```
Scope: 9 of 10 workspace projects
packages/{core,platform,ui,dbview,schema,editor,sync,importer} + apps/desktop  → 9/9 Done
```

### 5.3 双门禁

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px      （exit 0）
✓ token 产物与 DESIGN.md 一致                           （exit 0）
```

### 5.4 `pnpm -C apps/desktop selftest`

```
... FTS_RESYNC 2000 页全量重算耗时 18.8 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
PASS FTS_RESYNC 后重算页全部在索引中
SELFTEST OK
```

### 5.5 真机回归电池

```
node docs/mockups/cdp-e2e-t53-01.mjs
===== T53-01：41 PASS / 0 FAIL =====
realRoot untouched=true            （C:\Users\Administrator\.septcats mtime 前后一致）
退出：window.close() 优雅退出（forced=false）
打包产物：apps/desktop/out/renderer/assets/index-0T-kPCh_.css（1,958.98 kB js 同批，
          产物内 --sc-color-accent:#333333/#D4D4D4、--sc-color-ink-faint:#6B6B6B/#909090、
          --sc-color-canvas:#F5F5F5/#141414、--sc-bevel-out:… 逐条核对，旧 hex 零残留）
```

**T52 回归电池 23 条（原样复跑，全绿，新值）**

| 断言 | 新值（本单） |
| --- | --- |
| G0-1 夹具 | `tabs=3 pages=3` |
| G1-1 侧栏顶到菜单下沿 | `sideTop=0 asideTop=0 nativeChromeH=65` |
| G1-2 通高 | `sideHeight=735 innerHeight=735` |
| G1-3 顶栏不通栏 | `topbarLeft=240 sidebarW=240 topbarRight=1184 winW=1184` |
| G1-4 顶栏钮隐藏 | `shellBtnDisplay=none` |
| G2-1 折叠钮 x + 24px 位 | `btnCenterX=260 barLeft=248 btnW=24` |
| G2-2 折叠钮 y 对齐 | `btnCenterY=58 barCenterY=58 Δ=0.0` |
| G3-1 无分隔线 | `barBorderBottom=0px activeBorderBottom=0px` |
| G3-2 活动标签 = pv-root | `activeBg=rgb(255,255,255)=pvBg`（barBg `rgb(245,245,245)`） |
| G3-3 非活动沉 surface | `inactiveBg=rgb(237,237,237)` |
| G3-4 冒泡进正文 | `belowActive="pv-root"`（`barBottom=76=pvTop`） |
| G4-1 四宽度零滚动 | `1280/900/760/640` 纵 + 横全等 |
| G4-2 侧栏 top 恒 0 | 四宽度全 `top=0` |
| G5-1 收起 0px | `width=0 display=none appSideVisible=false mainW=1184` |
| G5-1b 顶栏同步占满 | `topbarLeft=0 topbarRight=1184` |
| G5-2 收起态钮可达 | `btnRect={x:8,y:46,w:24,h:24} inViewport=true` |
| G5-3 再点展开 | `width=240 display=block` |
| G6-1 装订线 | `bodyPaddingLeft=70px` |
| G6-2 gutter | `gutter=12 overlap=false cluster=58×28` |
| G7-1 无标签态 | `{tabsbar:false,row:true,toggle:true}` |
| G7-2 窗口级截屏 | `46514 B`，rect `1220×885`（含标题栏 + 原生菜单栏） |
| G7-3 深色同构 | `activeBg=rgb(10,10,10)=pvBg`、`border=0px` |
| G8-1 退出 | `{gracefulExited:true,forced:false}` |

**T53 新增 18 条**

| 断言 | 原始值摘要 |
| --- | --- |
| G9-1a/1b 色板逐 token 双主题 | `19/19 命中`（浅）/ `19/19 命中`（深） |
| G9-2/2b 黑白灰形式证明 | 17/17 中性/强调/立体 token **纯灰 r=g=b**（两主题） |
| G9-3/3b 两粒语义色形式证明 | `danger=#8A2B1C success=#3F6B34` / `danger=#F2B8AD success=#9CCB8F`（**均带彩**） |
| G9-4/4b 立体 token 语义正确 | `bevel-out="inset 2px 2px 0 0 #FFFFFF, inset -2px -2px 0 0 #A9A9A9"`；`bevel-in` 严格对调；`pixel-flat="2px 2px 0 0 #C6C6C6"`（深色 `#565656/#0A0A0A/#050505`） |
| G9-5a 像素几何 | offset 投影 `2px 2px 0 0`（**blur=0**）+ bevel `inset 2px 2px 0 0` |
| G9-5b 像素圆角 | `xs=2px sm=2px md=4px lg=6px xl=8px` |
| G9-6a 非活动标签 | `radius=2px shadow="rgb(255,255,255) 2px 2px 0px 0px inset, rgb(169,169,169) -2px -2px 0px 0px inset"` |
| G9-6b 活动标签不挂 bevel | `activeTabShadow=none`（T52 融合语义优先） |
| G9-6c 折叠钮圆角 | `radius=2px` |
| G9-6d 真机按压立体 | `rest=none` → `hover=…255,255,255 2px 2px 0px 0px inset…` → `down=…169,169,169 2px 2px 0px 0px inset…` + `transform=matrix(1,0,0,1,2,2)` |
| G9-6e 按压探针无副作用 | `sidebarW=240` |
| G9-7 §16 红线 | 字体族含 `Noto Sans SC`、`spring 100/20`、`cubic-bezier(0.16,1,0.3,1)` |
| G10-1 8 截图落盘**且逐张视图正确** | 逐张带视图指纹（editor/side-tabs → `pvRoot:true`；db → `dbpage:true`；settings → `settings:true`） |
| G10-2 数据视图真机命中 | `light=true dark=true` |

---

## 6. 截图（8 张 = 4 关键屏 × 浅/深）

目录：`docs/mockups/screens-t53/`（同目录另有 T52 电池的 `g3/g5/g7` 取证图与 `t53-01-results.json`）

| 关键屏 | 浅色 | 深色 |
| --- | --- | --- |
| ① 编辑区（含块手柄簇 / 标签行 / 正文） | `t53-01-editor-light.png` | `t53-01-editor-dark.png` |
| ② 侧栏 + 标签行（左上局部：侧栏头 / 列表 / 折叠钮 / 标签行连通） | `t53-01-side-tabs-light.png` | `t53-01-side-tabs-dark.png` |
| ③ 多维数据表（真建表 + 3 条记录） | `t53-01-db-light.png` | `t53-01-db-dark.png` |
| ④ 设置页（语义色/分段控件/预设卡/输入框） | `t53-01-settings-light.png` | `t53-01-settings-dark.png` |

**T51 原生菜单**：应用菜单确为**系统渲染**（main 进程 `Menu`，取证见 T51-01 报告），其配色由操作系统/主题决定，**完全不受本单任何 CSS 影响**——真机窗口级补拍（`t53-01-g7-window-light-full.png`，含标题栏 + 原生菜单栏）可目检此点。

---

## 7. DEVIATION（逐条，待 PM 追认）

| # | 条目 | 说明与理由 |
| --- | --- | --- |
| D-1 | **色板整体换值**（T34-01 Notion 采样锚定退役） | 任务书 §0 授权（基调黑白灰）；连带更新 `contrast.test.ts` 的 ink-faint 锚定值，并**退役** `t34-notion-colors.test.ts` —— 属测试锚定对象更换，请 PM 追认 |
| D-2 | 删 `packages/ui/test/t34-notion-colors.test.ts`、新建 `t53-gray-colors.test.ts` | 旧文件职责=锚定 Notion 采样值，已无锚定对象；新文件职责更宽（灰阶 + 像素立体 token + 旧值零残留）。文件数 28 不变 |
| D-3 | **ink-faint 提档超出附录 A**：`#757575→#6B6B6B`（浅）、`#8C8C8C→#909090`（深） | 附录 A 预案 `#6E6E6E` 对门禁配对表的 `surface #EDEDED` 实测 **4.36 仍不过**（预案只核了 canvas）；深色 `#8C8C8C` 对 `surface-raised` 余量仅 0.0004。推导见 §2.3 |
| D-4 | 门禁配对表**未扩**（维持 4 平面 + 4 语义对），但门禁外 `ink-faint/surface-active` 浅 **4.00** | 口径同 T34「配对表以门禁为准」。浅色真实落点已 CSS 收敛（`App.css` 选中行计数、`PageView.css` 双链 hover 上下文）；**残留**：`.sc-select__trigger:active` 占位文案瞬时按压态未处理，登记待裁 |
| D-5 | `rounded` 家族整体收窄（4/6/8/12/16 → 2/2/4/6/8） | 任务书 §0「直角或 2px 微圆角」；token 值改动，组件 CSS 零改动吃到新值。若 PM 认为浮层档过方（md/lg/xl），改值即可回退 |
| D-6 | **活动标签不挂 bevel**（任务书 §1.3 把 Tab 家族列进立体化） | T52 融合语义要求活动标签与正文连通无缝；inset 亮暗面会在标签下缘画出一条内部暗边，正是 T52 消除的「隔离带」。冲突时以「T52 语义不许被观感改动破坏」为准；非活动标签照挂。真机断言 G9-6b 钉住此裁决 |
| D-7 | `.pv-handle` 立体由**簇壳**承载 | 任务书要求 `.pv-handle*` 吃 bevel，但簇内真按键 `.sc-blockcontrol__add/__handle` 住 `packages/editor/src/react/editor.css` = 本单红线禁区。故在 `.pv-handle`（allowed 文件）挂 hover/active bevel；`box-shadow/border-radius` 不参与布局，T33 装订线 70 / gutter 12 / 簇宽 58×28 真机复验一字未动 |
| D-8 | `elevation.shadow-tinted-light` **保留但已无消费端** | Switch 滑块、RadioGroup 选中项改走 `pixel-flat`/`bevel-out` 后该 token 无人引用；按红线「token 名不改」保留声明与深色派生（`resolveDarkShadows` 的唯一 rgba 消费者，删了会让脚本的 shadow 族派生失效）。若 PM 要清，可整条删除 |
| D-9 | 浮层阴影**未像素化**（popover/menu/modal/toast/tooltip/dialog 仍软阴影） | §0 把像素语法落点限定为「按钮/交互件」；浮层非交互件，且带 blur 阴影是 §16/Elevation 的既有裁决。圆角已随 `rounded` 收窄 |
| D-10 | `Kbd` 去掉 `border-bottom-width: 2px` 字面几何 | 改走 `bevel-out`（token 化 + no-magic 友好）。键帽观感从「下缘加厚」变为「硬边亮暗面」 |
| D-11 | `LayoutSection.css` 补 `prefers-reduced-motion` 兜底块 | 本单首次给该文件引入 transition → 按 T27-01 §0.B.2「每文件自查」补块（`ui-interaction-audit.test.ts` 门禁①要求）；`PageView.css` 同理 |
| D-12 | 同步五态重排语义色 | `--syncing` accent 琥珀呼吸点 → **success 绿**；`--degraded` accent 橙点+软环 → **灰点 + surface-active 描边环**。理由：§0「语义色只留错误红 + 同步绿两粒」；灰阶后 idle/syncing/degraded 三点若全灰将不可辨。若老板要「同步也全灰」，回一句话即可再砍 |
| D-13 | **perf 用例抖动（非本单引入）**：`apps/desktop/test/perf.test.ts > 1 万字页 200 块 commitOps batch 落库 P95 ≤16ms` | 全仓 `pnpm -r test` 共跑 **4 次：3 绿（663/663）/ 1 红（1 failed / 662 passed，仅此一例）**；为定位，单包直跑同一用例 **6 次**，P95 = **11.8 / 12.1 / 14.9 ms（绿）· 16.2 / 23.4 ms（红）**，即在 16ms 预算上下抖动。本单改动全为 CSS/设计 token，**不可能影响 better-sqlite3 写路径**（改动后首跑即为 11.8ms 绿），属机器负载敏感的既有红线（T23-01 报告已记「perf 红牌 -r 并行抖动」同类现象），登记待 PM 复跑复核 |
| D-14 | `packages/ui` 组件 CSS 仍不写 per-file reduced-motion 块 | 沿该包既有惯例（依赖 `tokens.css` 全局降级）；desktop 侧 renderer CSS 则按 T27-01 逐文件自查。本单只在 desktop 侧引入过渡处补块 |

---

## 8. PM 复跑节（留空，供 PM 回填）

```
# 1) 颜色/立体真源与产物一致性
node packages/ui/tokens/build-tokens.mjs --check        # 期望：✓ token 产物与 DESIGN.md 一致
node packages/ui/tokens/no-magic.mjs                    # 期望：✓ 无字面 hex、无非 1px 重复裸 px

# 2) 对比度门禁（含逐对比值输出）
pnpm -C packages/ui test                                 # 期望：28 files / 86 tests passed，log 内 32 对全 ≥4.5

# 3) 全仓
pnpm -r test                                             # 期望：全绿（desktop 663 / ui 86）
pnpm -r typecheck                                        # 期望：9/9 Done
pnpm -C apps/desktop selftest                            # 期望：SELFTEST OK

# 4) 真机电池（需先切 electron ABI 并重建 out/）
pnpm -C apps/desktop build
node docs/mockups/cdp-e2e-t53-01.mjs                     # 期望：41 PASS / 0 FAIL，realRoot untouched=true

PM 复跑结论：____（日期：________）
```

---

## 9. 红线自查

| 红线 | 状态 |
| --- | --- |
| token 名不改只改值 | ✓ 22 枚色 token 名与四几何名全为改动前既有名 + 新增（无删除、无重命名）；组件零改动吃到新值（未改任何 `var(--sc-*)` 引用名） |
| 不碰 `core/sync/importer/dbview/editor` | ✓ 本次写入仅 `DESIGN.md`、`packages/ui/**`、`apps/desktop/src/renderer/**`、`docs/**` |
| 不碰布局结构（AppShell 网格 / TabsBar 融合语义） | ✓ AppShell.css 一字未改；TabsBar 仅加/改 `box-shadow` 与过渡，`border-bottom`/底色/连通语义不动，真机 23 条复验 |
| 不加依赖 | ✓ `package.json` 全未动 |
| 不碰 git | ✓ 全程无 `git` 写操作（仅 `git log -1` 读） |
| 禁 TODO | ✓ 新增/改动文件内零 `TODO` |
| 真机独立夹具不写 `C:/Users/Administrator/.septcats` | ✓ 夹具 `_scratch/t53-01/`；`realRoot mtime` 前后一致（`untouched=true`） |
| 交付前杀进程 | ✓ `tasklist` 无 `electron.exe`；9475/9476/9235/9236 无 LISTENING（仅 TIME_WAIT） |
| 字体族 / 图标族 / 动效 | ✓ 未动（真机 G9-7 复验 `Noto Sans SC` + `spring 100/20` + `cubic-bezier`） |

> 副作用登记：`docs/perf-history.jsonl` 被 `pnpm -r test`（T14-01 perf 用例按设计追加采样）追加 120 行——是本单「必须跑全仓 test」的既定产物，非手工改动；无其他非预期写入。


## §PM 复跑（2026-09-21 深夜，独立）—— **41 PASS / 0 FAIL + T52 回归 23/23 不破**

- 全仓 `pnpm -r test` 无红（perf 首轮 1 红 = 满载降频瞬态，冷却隔离复跑 **4/4 绿**，与代码无关，口径同旧例）；typecheck 0 错；双门禁 ✓；`SELFTEST OK`。
- **对比度独立复算**（PM 亲算 18 对，含门禁表外探针）：16 对文字 ≥4.5（浅最差 ink-faint/surface **4.55**、深 **4.96**）；`selection/content` 1.48 为**背景×背景**（真实文字对 ink/selection=11.74 ✓，配对合理豁免）；`ink-faint/surface-active` 浅 4.00 与 D-4 登记一致。
- 真机：T53 探针 **41/41**、**T52 探针原样复跑 23/23**（融合语义/通高/零滚动/gutter12 全保）。
- 收口插曲（如实记）：前两轮复跑 0/0 —— 根因是 CB 会话遗留的**孤儿 pnpm -r test 进程**（pid 20708 等）锁 `better_sqlite3.node` → ensure-abi EPERM → 打包 ABI 未切 → 夹具起 DB 失败。清孤儿+rebuild 即愈。**教训：工程师会话退出后 PM 复跑前，先查 node.exe 孤儿（wmic 命令行不含 workbuddy 者）**。
- DEVIATION **D-1~D-8 全部追认**（D-3 提档超预案推导成立；D-6 活动标签不挂 bevel 以 T52 连通语义优先=正确取舍，G9-6b 已钉；D-5 圆角收档是老板像素口径的自然结果；D-4 残留 `.sc-select__trigger:active` 占位按压态登记待裁——**并入 rc.28 后观察**）。
