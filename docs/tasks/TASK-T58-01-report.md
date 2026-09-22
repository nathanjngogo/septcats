# TASK-T58-01 报告 · P1：AI 按钮像素化 + 全仓图标像素族接线

> 状态：**完成**（数字全部为真机/真跑输出；PM 复跑节按纪律留空）
> 日期：2026-09-22
> 工程师：CB
> 基线：T56/T57 收口后（ce87a84/2144fce）—— desktop 754 用例 / typecheck 9/9 / selftest OK
> 结果：desktop **767** 用例全绿（+13）· packages/ui **133** 用例全绿（+47）· typecheck **9/9** · 双门禁绿 · selftest OK · 真机探针 **14 PASS / 0 FAIL**

## 0. 任务摘要

把 PM 定稿的 `scripts/gen-pixel-glyphs.mjs`（GLYPHS 28 枚 16×16）变成 React 组件库
`packages/ui/src/pixelIcons.tsx`，并把全仓图标族（Icon.tsx 唯一出口）整体换装；AI 钮由
Sparkle 换为 **AiRobot 像素机器人头**（开=眼亮 / 关=眼暗）。**未重新设计任何图标**。

## 1. 侦察结论（原始现状）

| 事实 | 实测 |
|---|---|
| 图标唯一出口 | `packages/ui/src/Icon.tsx`，改造前 re-export **26 个**phosphor 名字（任务书说 24 → 实际以文件为准，见 DEV-8） |
| 业务代码 phosphor 直连 | 0 处（仅 Icon.tsx 一处 import） |
| `Sparkle` 调用点 | **3 处**：`App.tsx`（顶栏 AI 钮）/ `ai/AiChatPanel.tsx`（面板标题）/ `packages/dbview/src/react/CellEditor.tsx`（AI 列「AI 生成」钮） |
| 资产表与 re-export 名的差集 | 资产多 `Layout`/`BookOpen`/`AiRobot`；少 `MagnifyingGlass`（≡Search）/`X`（≡Close）/`Sparkle`（无像素 glyph） |
| 资产表实际墨迹占比 | 10.16%（Check）– 40.23%（BookOpen）；**5 枚 < 18%**（任务书 §1.3 的下限） |
| 资产表自检带宽 | `gen-pixel-glyphs.mjs` 自身断言 8–50% + 8-邻域连通 ≤6，28/28 绿 |
| 消费面 `icon={X}` 调用点 | **19 个不同名字 × 51 处**（renderer/editor/dbview 三目录，`grep -rhoE "icon=\{[A-Z][A-Za-z0-9_]*\}"`） |
| 颜色落点 | `IconButton` → `--sc-color-ink-secondary`（hover 升 `ink`），底 `--sc-color-canvas` |
| 基线用例数 | desktop 754（67 文件）/ packages/ui 86（28 文件） |

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `packages/ui/src/pixelIcons.tsx` | **新增**：`PIXEL_GLYPHS`（28 枚 ×16 行 ASCII 矩阵，逐格等于资产表）+ 28 个组件 + 两个旧权利名别名（`MagnifyingGlass`≡`Search`、`X`≡`Close`）+ `TONE_OPACITY`/`GLYPH_TONES`/`AI_ROBOT_EYE` 等合同常量；行内同档格合并成 rect 横条；`AiRobot` 的眼/天线单独成组 |
| `packages/ui/src/pixelIcons.css` | **新增**：两态接线（默认眼/天线 opacity 1；`[aria-pressed='false']` → 眼 0.35 / 天线 0.55）。零字面 hex、零裸 px |
| `packages/ui/src/Icon.tsx` | re-export 块整体换成像素族（含别名 + 数据出口）；`weight`/`strokeWidth` 不再下传；`ICON_STROKE_WIDTH` 保留为 legacy 导出；不再 import phosphor |
| `packages/ui/src/Icon.test.tsx` | 断言改为像素族契约（viewBox/crispEdges/rect 网格/尺寸穿透/color 透传），2 → 4 用例 |
| `packages/ui/src/pixelIcons.test.tsx` | **新增**（41 用例）：矩阵合法性、tone 映射覆盖、25 个旧名全在 + Sparkle 退役、别名同源、逐名渲染、**28 枚渲染掩码 == 资产矩阵**、2 个内联快照锚、两态分组与 CSS、零 phosphor 引用 |
| `packages/ui/test/pixel-icon-contrast.test.ts` | **新增**（4 用例）：48 组「前景 × 平面 × 档位」≥3:1、档位单调可分、关态记录、报告用实测表 |
| `packages/ui/src/index.ts` | 头部纪律注释同步（族 = 仓内像素 glyph） |
| `scripts/check-pixel-icons.mjs` | **新增**：视觉质检门禁（同源/半透明/色相/墨带四项 + 产物落盘） |
| `apps/desktop/src/renderer/src/App.tsx` | 顶栏 AI 钮 `Sparkle` → `AiRobot`（import + 1 处调用点；`aria-pressed={chatOpen}` 未动） |
| `apps/desktop/src/renderer/src/ai/AiChatPanel.tsx` | 标题栏图标 `Sparkle` → `AiRobot`（同语义） |
| `packages/dbview/src/react/CellEditor.tsx` | AI 生成钮 `Sparkle` → `AiRobot`（**2 行，见 DEV-1**） |
| `apps/desktop/test/t58-pixel-icons.test.ts` | **新增**（7 用例）：调用点全量落在像素族、零 phosphor 直连、Sparkle 零用法、产物入盘、依赖面不扩张、尺寸档契约、同名出口 |
| `apps/desktop/test/t58-ai-button.test.tsx` | **新增**（6 用例）：App 集成的 AI 钮像素化 + 两态钩子可达 + 顶栏一个不漏 + 位置回归 |
| `docs/mockups/cdp-e2e-t58-01.mjs` | **新增**：真机探针（14 断言，含自写 PNG 解码的逐像素采样） |
| `docs/mockups/screens-t58/` | **新增**：6 张截图 + `t58-01-results.json` |
| `assets/icons/png/` | **新增**：113 个 PNG（28 枚 × {16,24}px × {浅,深} = 112 + 拼版总览 1） |
| `DESIGN.md` | 新增「## Icons」节（§16.6 修订：族=仓内像素 glyph 自绘 + 迁移对照表）；Do's/Don'ts 与品牌节措辞同步 |
| `docs/PROJECT_PLAN.md` | §16 第 6 条改写 + §16 技术选型表措辞同步 |

零新依赖（`packages/ui/package.json` dependencies 仍为 `{clsx, @phosphor-icons/react}`）；未碰 git。

## 3. 测试命令与真实输出

```
# ① 像素图标视觉质检门禁（本单独有）
$ node scripts/check-pixel-icons.mjs
① 同源：资产 28 枚 ↔ 运行时 28 枚，逐格不等价 0 枚
② 半透明像素：0（要求 0）
③ 色相：非法像素 0（要求 0；合法色 = 背景 ∪ 前景×{1,0.8,0.72,0} 压底色）
④ 16px 墨迹占比（带 18–46%）：…（28 枚逐项，见 §4）
拼版总览：assets\icons\png\glyph-sheet-overview.png（626×4322，行序 = 资产表序）
⚠ 5 枚以下低于 18% 下限，属 PM 定稿资产属性（T58-01 D-1）：Plus 14.06% / Check 10.16% / Close 14.84% / ArrowClockwise 14.06% / ArrowsClockwise 17.97%
✓ 像素图标门禁全绿：28 枚 × {16,24}px × {浅,深} 硬边直画，同源/半透明/色相/墨带 四项通过
exit=0

# ② 资产表自检（PM 资产原样）
$ node scripts/gen-pixel-glyphs.mjs
glyph 数: 28 … 质检全绿        （28/28 ✓）

# ③ packages/ui
$ cd packages/ui && npx vitest run --reporter=basic
 Test Files  30 passed (30)
      Tests  133 passed (133)          （基线 28/86 → +2 文件 / +47 用例）
$ npx tsc -p tsconfig.json --noEmit
typecheck-exit=0

# ④ desktop
$ cd apps/desktop && node scripts/ensure-abi.mjs node && npx vitest run --reporter=basic
 Test Files  69 passed (69)
      Tests  767 passed (767)          （基线 67/754 → +2 文件 / +13 用例 ≥ +10）

# ⑤ 全仓
$ pnpm -r --no-bail run typecheck
Scope: 9 of 10 workspace projects … 9 个包 typecheck: Done        typecheck 9/9

$ node packages/ui/tokens/build-tokens.mjs --check
✓ token 产物与 DESIGN.md 一致
$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
$ cd apps/desktop && node scripts/run-selftest.mjs
… SELFTEST OK

# ⑥ 真机探针
$ node docs/mockups/cdp-e2e-t58-01.mjs
===== T58-01：14 PASS / 0 FAIL =====
realRoot untouched=true
results -> docs/mockups/screens-t58/t58-01-results.json

# ⑦ 杀净校验（交付前）
$ tasklist /FI "IMAGENAME eq electron.exe" /NH | grep -c "electron.exe"
0
$ netstat -ano | grep ":9477"        （空输出 = 无监听）
```

## 4. 视觉质检门禁执行结果（§1.3）

真跑 `node scripts/check-pixel-icons.mjs`（exit 0），四项断言：

| # | 断言 | 实测 |
|---|---|---|
| ① | 运行时矩阵 == 资产 GLYPHS（28 枚逐格） | 不等价 **0 枚** |
| ② | 半透明像素 = 0（16/24px × 浅/深 直画） | **0** 个 alpha∈(0,255) |
| ③ | 色相合法（每像素 ∈ 底色 ∪ 前景×档位，r=g=b） | 非法像素 **0** |
| ④ | 16px 档墨迹占比 ∈ 18–46% | 23 枚 ✓；**5 枚 ⚠豁免**（见 DEV-2 与 D-5） |

16px 墨迹占比全表（%）：Check 10.16 ｜ Plus 14.06 ｜ ArrowClockwise 14.06 ｜ Close 14.84 ｜
ArrowsClockwise 17.97 ｜ DotsThree 18.75 ｜ Circle 20.31 ｜ CaretDown/CaretUp 21.09 ｜
Search 22.27 ｜ Note 22.66 ｜ WarningCircle/WarningOctagon 23.05 ｜ SidebarSimple/Layout/
FileText/PencilSimple/Clock 23.44 ｜ Info 24.61 ｜ AiRobot 25.00 ｜ Copy 25.78 ｜
CheckCircle 27.73 ｜ FolderSimple 30.47 ｜ GearSix 32.03 ｜ Star/CaretRight 32.81 ｜
Trash 35.16 ｜ BookOpen 40.23

产物：`assets/icons/png/` 共 **113** 个文件（每枚 4 档 + `glyph-sheet-overview.png` 拼版总览，
626×4322，行序 = 资产表序，每行 4 档 = 16 浅 / 16 深 / 24 浅 / 24 深）。

对比度门禁（`packages/ui/test/pixel-icon-contrast.test.ts` 实测，阈值 3:1）：

```
light ink-secondary/canvas      t1=6.42 t0.8=4.05 t0.72=3.38
light ink-secondary/surface-raised t1=7.00 t0.8=4.29 t0.72=3.59
dark  ink-secondary/canvas      t1=7.75 t0.8=5.34 t0.72=4.60
dark  ink-secondary/surface-raised t1=6.36 t0.8=4.62 t0.72=4.05
（另 ink 前景四组更高：light 6.63–17.40 / dark 7.38–16.91）
light 关态 eye=0.35→1.70 antenna=0.55→2.43（刻意降档的状态修饰，非静止态）
dark  关态 eye=0.35→2.01 antenna=0.55→3.16
```

## 5. 三判读区（16px 语义自评，1–5 分）

> 依据：`assets/icons/png/glyph-sheet-overview.png` + 本轮真机 4×/8× 放大图目视；
> 分数低的三类都源自**轮廓族在 16px 退化**（资产冻结不重画），如实列出供 PM 抽查。

| glyph | 分 | 一句话 |
|---|---|---|
| Plus | 5 | 2 格粗十字，无歧义 |
| Check | 4 | 斜勾双笔可辨；笔画细（10.2% 墨）但不糊 |
| Close | 5 | 对角十字，交点连续 |
| Search | 4 | 方角镜圈 + 斜柄可读；圈是方形不是圆（像素风可接受） |
| GearSix | 2 | 读成「十字花/四叶」而非齿轮：四向齿是 4×3 大方块，中心孔只剩断续亮点 |
| SidebarSimple | 4 | 左栏分隔 + 两条短线 → 侧栏语义成立 |
| Layout | 4 | 上横栏 + 中竖分栏；与 SidebarSimple 靠横栏位置区分 |
| BookOpen | 2 | 左右页 + 中缝在中区糊成一团（`o` 档纹理与主墨交织），16px 下近噪点 |
| FileText | 5 | 文档框 + 三条内线，标准 |
| Note | 4 | 折角 + 两条内线；折角仅 1 格宽略轻 |
| FolderSimple | 4 | 文件夹 Tab 折角成立；口内 `o` 档横线偏灰 |
| Copy | 4 | 双页错位清楚；后页左下缺口略怪 |
| Trash | 3 | 桶体/盖/提手可读，两侧 `o` 档竖线过细，16px 下像「实验瓶」 |
| PencilSimple | 5 | 斜铅笔 + 笔尖，本族最清晰 |
| Star | 5 | 实心五角星，无歧义 |
| Clock | 4 | 方框 + 指针成立；四角补丁让轮廓近圆 |
| Info | 4 | 点 + 竖条 = i；方圈不碍识别 |
| CheckCircle | 4 | 勾在方圈内；勾尾与右框相碰略挤 |
| WarningCircle | 4 | 感叹号在方圈内，清晰 |
| WarningOctagon | 2 | 顶盖与主框之间空一整行（资产第 2 行为空）→ 像「悬空盖子」，八边形语义丢失 |
| Circle | 3 | 无处可指的「空方框」：四角 1 格缺口不足以读出圆 |
| ArrowClockwise | 2 | 右框断续 + 箭头碎片，16px 读不出「旋转更新」 |
| ArrowsClockwise | 2 | 同上一枚且底部多一截，更碎 |
| CaretDown | 5 | 实心三角，标准 |
| CaretUp | 5 | 同上（镜像） |
| CaretRight | 5 | 同上（转向） |
| DotsThree | 5 | 三条 4×4 方块，⋯ 语义清楚 |
| AiRobot | 4 | 方头 + 双天线 + 方眼 + 嘴 + 双腿 = 机器人头；右缘 5–8 行多 1 格外凸（见 DEV-6），像侧耳 |

**均分 3.89**（5 分 9 枚 / 4 分 12 枚 / 3 分 2 枚 / 2 分 5 枚）。低分集中在
GearSix / BookOpen / WarningOctagon / ArrowClockwise / ArrowsClockwise 五枚。

## 6. AI 钮两态证据（screens-t58/）

| 文件 | 内容 |
|---|---|
| `t58-01-ai-closed-zoom8x.png` | AI 钮关态 **8× 放大**（224×224）：机器人头 + 暗眼 + 暗天线 |
| `t58-01-actions-zoom4x.png` | 顶栏整排 4× 放大（浅色）：搜索/机器人/同步/＋/布局/设置 全像素族 |
| `t58-01-actions-dark-zoom4x.png` | 同上（深色，同一 CSS 档生效） |
| `t58-01-ai-panel-open.png` | AI 面板打开（顶栏钮眼亮 + 面板标题同族机器人头） |
| `t58-01-editor-light.png` / `t58-01-editor-dark.png` | 主界面双主题（侧栏 17 枚图标零漏网） |
| `t58-01-settings-light.png` | 设置页（浅色） |
| `t58-01-results.json` | 14 条断言 + phases 原始值 |

真机实测（`t58-01-results.json` → `phases`）：

```
G2-1 硬边证明：8× 放大图 224×224 全部像素 ∈ {底色 ∪ 前景×{1,0.8,0.72} ∪ 关态眼档{0.35,0.55}}，非法像素 = 0
G2-2 像素级证据：8× 放大图逐格采样掩码 == AiRobot 资产矩阵（16×16），不等格数 = 0
G3-1 关态（getComputedStyle）：眼 opacity=0.35 / 天线=0.55（aria-pressed=false）
G3-2 开态：眼=1 / 天线=1（几何 rect 清单完全一致 → 两态只切明暗，不变形）
G3-3 面板标题图标同族：.ai-chat__head-icon 内 .sc-icon__eye rect = 4 + crispEdges
G3-4 再点回关态：0.35/0.55 复原，面板收起（两态可反复往返）
G1-1/G1-2：顶栏 5 枚钮全 viewBox 0 0 16 16 + crispEdges + rect>0，stroke-width 一律 null
G4-1：深色主题下同为像素族且眼档 0.35 同值生效
G4-2：整屏 17 枚 svg.sc-icon 全像素族几何（零混族残留）
G5-1：window.close() 优雅退出（forced=false）；realRoot untouched=true
```

## 7. 决策记录 D-x

- **D-1 glyph 数据的落法**：把资产表 ASCII 化**内联**进 `pixelIcons.tsx`，并由门禁/测试双向断言
  「资产表 ↔ 运行时表逐格等价」。不采用「运行时 import `gen-pixel-glyphs.mjs`」——那会在每次测试/探针
  运行时重写 `assets/icons/glyph-sheet.png`（副作用污染），且把设计脚本拖进产品依赖链。
- **D-2 渲染实现 = 行内同档合并 rect**（非 `box-shadow` 拼像素）：`viewBox="0 0 16 16"` + `shapeRendering="crispEdges"`，
  相邻同档格合并成一条横条 → DOM 节点数实测 10–30 个/枚（side-by-side 对照 `box-shadow` 方案：不可读、无法逐格取证）。
- **D-3 tone → opacity 映射 = 1 / 0.8 / 0.72**（资产 tone 1 / .45 / .3）：字面 `.45` 在浅色 canvas 上
  对 `ink-secondary` 实测仅 **2.01:1**，低于本单「非文字 ≥3:1」；映射后每档实测 3.38–17.40，全部达标且保留
  「亮 > 中 > 淡」相对关系（资产注释本身写明「代码渲染时映射」）。
- **D-4 两态方向与载体**：`aria-pressed` = 唯一状态源（App 既有 `aria-pressed={chatOpen}`），CSS 只改 opacity；
  「开=true → 眼亮(1) / 天线亮(1)，关=false → 眼暗(0.35) / 天线暗一档(0.55)」。任务书 §1.2 括号「按下=眼灭」
  与验收锚「开=眼亮/关=眼暗」表述相左，按**验收锚 + 用户口径**取后者，并同时给天线降档以兼容两种读法（详见 DEV-5）。
- **D-5 墨带豁免机制显式化**：门禁把 5 枚低墨 glyph 做成 `THIN_WAIVER` 白名单，**每次运行都打印实测值**，
  撤豁免即红——不做静默放行，也不擅自重画资产。
- **D-6 出口用显式 re-export（非 `export *`）**：`Icon.tsx` 逐名列出像素组件 + 数据出口，保留换族可审计性；
  旧权利名 `MagnifyingGlass`/`X` 以**别名同源**（同一组件对象）落地，调用点 `icon={X}` 零改动。

## 8. DEVIATION 清单（待 PM 追认）

- **DEV-1（越界改动）**：动了 `packages/dbview/src/react/CellEditor.tsx` **2 行**（`Sparkle` → `AiRobot`）。
  红线写「只动 packages/ui/src + 文档」，但 `Sparkle` 出口退役后该文件会编译失败；不改则只能保留非像素的
  phosphor 兼容层（违反「所有图标都是像素风」）。`packages/core`、`packages/sync` 零改动。
- **DEV-2（墨带下限冲突）**：任务书 §1.3 的下限 18% 与 PM 定稿资产（自检带 8–50%）冲突：资产实测
  Plus 14.06 / Check 10.16 / Close 14.84 / ArrowClockwise 14.06 / ArrowsClockwise 17.97（5 枚）。**未重画**
  （禁止），门禁以显式豁免 + 逐项打印处理。请 PM 裁决：① 接受资产带 8–50%；或 ② 解冻这 5 枚重画。
- **DEV-3（未新增 i18n 键）**：任务书 §1.5 要求「i18n/tooltip 新键双语」，但本单**无新用户可见文案**：
  AI 钮沿用 `app.aiChatLabel`（双语已存在）+ `aria-pressed` 表达开合，tooltip 走 `IconButton` 的 `title=label`
  既有口径；icon 本身不进文案。「无新键」而不是「漏做键」。
- **DEV-4（legacy 出口保留为惰性值）**：`ICON_STROKE_WIDTH = 1.5` 为兼容「API 完全不变」保留，但像素族不消费
  （硬边实心无描边）。已加注释标注 legacy；若 PM 认为应删除出口，请另行派发（会破坏下游引用面）。
- **DEV-5（两态表述取锚）**：见 D-4。天线降档 0.55 是任务书括号里的「天线暗一档」，验收锚只写了眼睛，两者都实现了。
- **DEV-6（资产 1 格瑕疵未修）**：`AiRobot` 右缘第 5–8 行边界在 col 14，而顶/底框在 col 13（左缘恒 col 2，
  对称位应为 col 13）→ 右侧多 1 格外凸。**未擅自修改资产**（禁止重画）；修法是把第 5/6/8 行末位 `#` 左移 1 格。
  请 PM 裁决是否解冻。同一枚的其它观察：`B##` 处无异常。
- **DEV-7（产物入库）**：`assets/icons/png/` 113 个 PNG 为本单交付物（任务书 §1.3 要求输出），已落盘待 PM 纳入提交；
  可由 `node scripts/check-pixel-icons.mjs` 幂等重生成（对应测试会校验在盘）。
- **DEV-8（清单数量口径）**：任务书说 re-export「24 个」、覆盖清单列举里含 `Warning`/`Sparkle` 等；
  实际文件是 **26 个**，且没有名为 `Warning` 的出口（是 `WarningCircle`/`WarningOctagon`）。以文件为准全迁，
  并在 `pixelIcons.test.tsx` 里把 25 名 + Sparkle 退役写成回归锚。
- **DEV-9（门禁渲染口径）**：门禁的 16/24px PNG 是**最近邻取格自绘**（证明网格与色相离散），不是浏览器渲染；
  浏览器侧另有真机 8× 放大 + 逐像素采样（G2-1/G2-2）补证硬边与掩码全等。

- **DEV-10（跑测试的既有副作用）**：跑 desktop 全套件时 `test/perf.test.ts` 会按既有设计追加一行
  `docs/perf-history.jsonl`（T14-01 的性能历史落盘），与本单改动无关；`git status` 里该文件显示 M 属此因。

## 9. 遗留风险

1. **5 枚低墨 glyph 的可读性**（Plus/Check/Close/ArrowClockwise/ArrowsClockwise）：真机 16px 下可辨但笔画细；
   若 PM 接受资产带则维持现状，若要提墨需解冻重画（DEV-2）。
2. **轮廓族 16px 退化**：GearSix / BookOpen / WarningOctagon / Circle / ArrowClockwise / ArrowsClockwise
   在 16px 下语义弱（判读区给 2–3 分）。这些是资产层面的形状选择，非渲染问题；本单只能如实上报。
3. **`ICON_STROKE_WIDTH` 成为惰性常量**：下游若有代码改它期待视觉变化，会静默失效（本仓无此用法，已 grep 确认）。
4. **phosphor 依赖仍在 dependencies**：按 §1.5 保留作 fallback；若 PM 后续要彻底移除，需同步清理
   `apps/desktop/electron.vite.config.ts` 的 `optimizeDeps.include` 条目（本单未动 desktop 构建配置）。
5. **24px 档的像素格不均匀**：16px 网格放大到 20/24px 时每格 = 1.25/1.5 物理像素（crispEdges 下硬边但格宽不等）；
   16px 档为 1:1。真机证据里顶栏图标（16px 档）全部为整数格。
6. **关态眼档 0.35 低于 3:1**（实测浅色 1.70 / 深色 2.01）：这是「眼灭」状态语义本身的要求（状态修饰而非静止态），
   已按 INFO 记录在对比度用例中；若 PM 要求关态也 ≥3:1，把 0.35 提到 0.66 即可（一行 CSS）。

## 10. PM 复跑节（09-22 15:33~15:50，PM 实跑）

```
vitest desktop（electron ABI）:  Tests 767 passed (767)   ✓ 与申报一致
vitest packages/ui:              Tests 133 passed (133)   ✓
contrast.test.ts:                9 passed（T53 门禁复跑）  ✓
pnpm -r typecheck:               9/9 Done                 ✓
apps/desktop selftest:           SELFTEST OK              ✓
真机探针 cdp-e2e-t58-01.mjs:     14 PASS / 0 FAIL（一次过）
  · 顶栏 5 钮全像素族（viewBox 16 + crispEdges + 无 stroke 残留）
  · AI 钮 8× 放大逐格采样 == AiRobot 资产矩阵（不等格数=0）；硬边离散色阶非法像素=0
  · 两态往返：关 eye/antenna=.35/.55 → 开 =1/1 → 关回 .35/.55（aria-pressed 唯一状态源实证）
  · 整屏 17 图标零漏网 allPixel=true；深浅双主题同档生效
  · 优雅退出，realRoot untouched=true，electron 残留=0
screens-t58/ 截图 8 张在档；门禁 check-pixel-icons.mjs 28×{16,24}×{浅,深} 全绿
```

**判读抽查（独立视觉模型交叉判读）**：与 CB 三判读区吻合——GearSix/WarningOctagon/Arrow↔ArrowsClockwise 16px 语义确实模糊、BookOpen 尚可；**虚报检查通过（如实上报，非粉饰）**。

**PM 裁决**：
- **D-1/D-3/D-4/D-5（豁免显式化/tone 映射/两态方向）全部追认**；D-3 实测比 3.38–17.40 达标、"每次打印实测值、撤豁免即红"是好设计。
- 资产层 5 枚低墨 + 轮廓族 16px 退化 → **接受现状**（配套 tooltip/文字标签已普遍存在），列入 T58-02 可选资产精修单，不阻塞 0.3.0。
- 风险 6（关态眼 0.35 <3:1）：状态修饰语义成立，追认。
- 风险 2/3/4/5 记录在案；phosphor 移除另议。

**结论：T58-01 验收通过**（R11 三单全部收口）。
