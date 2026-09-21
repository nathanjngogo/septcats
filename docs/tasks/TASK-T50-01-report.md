# TASK-T50-01 交付报告 · P2 全局字体切换为思源黑体（Source Han Sans / Noto Sans CJK）

> 执行：CodeBuddy（工程师，唯一作者，本轮直接实现）
> 任务书：`docs/tasks/TASK-T50-01.md`（已通读全文，§0 物料未重新下载）
> 结论：**代码 1 新文件 + 1 行接线 + DESIGN.md 11 行 + tokens 生成物；`pnpm -C apps/desktop test` 638/638 全绿、`packages/ui` 79/79（含对比度 9 用例）、`pnpm -r typecheck` 9/9、`build-tokens --check` ✓、`no-magic` ✓；真机 CDP 18 PASS / 0 FAIL（浅/深整页截图各 1 张 + 字体生效三层证据）。**
> 纪律：只动 `DESIGN.md` typography 段（front matter 9 处 fontFamily + 同章 2 处散文陈述）、`packages/ui/src/tokens.{css,ts}`（**build-tokens 生成物，非手改**）、renderer 入口 CSS 与入口 1 行 import、探针与截图、本报告；mono 字族一字未动；色值/尺寸未动；未加依赖；未碰 git；无 TODO；**字体文件未换源、未重下**；真机夹具全在 `_scratch/t50-01/`，真实数据根 `C:\Users\Administrator\.septcats` mtime 前后逐位一致（`untouched=true`）；交付前自起 electron 进程已清零（无 electron.exe、946x 端口空闲）。

---

## §0 前置与物料复验

### 0.1 前置提交

`git log -1 --format='%H %s'`：

```
eba8f5ea2b19da93c6994542972eaa659c96a347 docs(QA): 登记 Q-27——设置页中点侧栏页面行不离开设置页（T49 真机顺带发现，疑为 T47 深色截图失败根因；待老板定口径）
```

- 任务书/用户侧口径的前置是 T49-01 交付提交 `4ca7079` —— **实测 tip 是它的下一个提交 `eba8f5e`（纯 docs(QA) 登记，无代码面改动）**，`4ca7079` 确在历史第 2 位（`git log -5`）。登记见 DEVIATION-1，未做任何 git 操作。
- 工作区在本单开始前已有 2 处非本单脏项：` M docs/perf-history.jsonl`（T49 报告 §6.5 已登记）与 `?? docs/tasks/TASK-T49-01.md`（未跟踪）。本单**未手改**这两个文件。

### 0.2 捆绑字体复验（防误替换）

| 项 | §0 声明 | 本单实测 | 判定 |
|---|---|---|---|
| 路径 | `apps/desktop/src/renderer/assets/fonts/NotoSansSC-wght.ttf` | 同 | ✅ |
| 字节数 | 17 772 300 B | `17772300`（`ls -l`） | ✅ |
| sha256 | 前缀 `a3041811a78c361b` | `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da` | ✅ |
| magic | `00010000` | `00000000: 0001 0000 0017 0100 0004 0070 4241 5345`（前 4 字节 `00010000`，紧接 `numTables=0x0017`=23） | ✅ |
| 表结构 | 23 表含 `fvar`+`glyf` | `numTables= 23`；表名 `BASE,GDEF,GPOS,GSUB,HVAR,OS/2,STAT,avar,cmap,fvar,gasp,glyf,gvar,head,hhea,hmtx,loca,maxp,name,post,prep,vhea,vmtx`（含 `fvar`/`gvar`/`glyf`/`HVAR`/`avar`/`STAT`） | ✅ |

### 0.3 真名字族读取（脚本读 ttf `name` 表原文）

脚本：读 offset table → 定位 `name` 表 → 遍历 name record，`platformID∈{0,3}` 按 UTF-16BE 解码。

```
numTables= 23
name fmt= 0 count= 37 storageOffset= 450
{"nid":1,"pid":3,"eid":1,"lid":1033,"value":"Noto Sans SC Thin"}
{"nid":2,"pid":3,"eid":1,"lid":1033,"value":"Regular"}
{"nid":6,"pid":3,"eid":1,"lid":1033,"value":"NotoSansSC-Thin"}
{"nid":16,"pid":3,"eid":1,"lid":1033,"value":"Noto Sans SC"}
```

**结论：栈里必须排在最前的是 `Noto Sans SC`（name ID 16 排版族名）。**
`name(1)` 是 `Noto Sans SC Thin` —— 可变字体的 name ID 1 会取「默认实例名（Thin）」，**用它当族名会张冠李戴**（浏览器能按 name(16) 找到同一个面，但把 `Noto Sans SC Thin` 写在栈首是错名）。故最终栈序：

```
"Noto Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif
```

（任务书 §1.1 给的是 `"Source Han Sans SC"` 打头的字面例，并明确「以实际文件 name 表为准后决定排在最前的名字」——按授权改为实证名打头。见 DEVIATION-2。）

---

## §1 需求 ↔ 交付对照

| 任务书要求 | 落地 | 判定 |
|---|---|---|
| ① 所有**非 mono** fontFamily 改为新栈 | `DESIGN.md` front matter 9 处（`font-ui`/`font-serif-note`/`editor-body`/`h1`/`h2`/`h3`/`ui-sm`/`ui-md`/`ui-xs`）逐处替换；2 处 mono（`font-mono`/`code`）**一字未动** | ✅ §2.1 门禁 + §3.5 G2-2 |
| ② 新建 `@font-face`（相对 url / 可变轴 / swap / 不裁 range） | 新文件 `apps/desktop/src/renderer/src/styles/fonts.css`；`main.tsx` 第 1 个 import | ✅ §3.4 G1-1/G1-3 |
| ③ `build-tokens --write` 同步、`--check` 与 `no-magic` 必须过 | 已 `--write`；`--check` ✓、`no-magic` ✓ | ✅ §2.3 |
| ④ 对比度门禁 17 对复跑全绿 | `packages/ui` 79/79；对比度 9 用例全绿，实测组合最差 4.82/4.83 | ✅ §2.4 |
| ⑤ 真机 CDP 独立夹具：`document.fonts.check` + `getComputedStyle` + 浅/深整页截图各 1 张（含正文/标题/代码块） | 新探针 `docs/mockups/cdp-e2e-t50-01.mjs` → `screens-t50/t50-01-results.json`；**18 PASS / 0 FAIL** | ✅ §3 |
| ⑥ `pnpm -C apps/desktop test` 全绿 + `pnpm -r typecheck` 9/9；快照失败按 token 新值改断言 | 638/638（**无一条断言需要修改**）+ 9/9 | ✅ §2.1/§2.2 |
| 交付：报告含 §0–§8 原始值 + DEVIATION，PM 复跑节留空 | 本文件 | ✅ |

**脚手架期「字体占位」叙事的收口**：`DESIGN.md` §Typography 首条（第 154 行）与 §Do's and Don'ts（第 201 行）此前写的是「Geist + CJK 系统栈 / 字体占位 Geist，若授权受阻用系统栈首字族，由 PM 另行换发」。两条都是**纯字体陈述**，本单同步改写为「自托管思源黑体随包分发、禁一切在线字体」（见 DEVIATION-3）。

---

## §2 数值门禁（逐条贴值）

### 2.1 `pnpm -C apps/desktop test`（pretest 自动 `ensure-abi node`）

```
 Test Files  57 passed (57)
      Tests  638 passed (638)
   Duration  27.84s
```

- 基线：T49-01 PM 复跑时 desktop = **638**；本单 **638 → 638（±0）**。
- **无一条断言因 font-family 字符串变化而失败**：全仓 `.ts/.tsx/.json` 里没有任何断言钉 `Geist`/`PingFang SC` 字面（已 grep 全仓确认，命中的只有 `DESIGN.md`、`docs/brand/brand-review.html`、`docs/mockups/tokens.css`、`docs/PROJECT_PLAN.md` 四份文档，均非测试）。故任务书「按 token 新值修正断言」的授权**本轮未触发**。

### 2.2 类型

`pnpm -r typecheck` → `Scope: 9 of 10 workspace projects`，9 个包 `Done`（含 `apps/desktop` 双 tsconfig）。**9/9 ✓**。

### 2.3 双门禁

```
$ node packages/ui/tokens/build-tokens.mjs --check
✓ token 产物与 DESIGN.md 一致
$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

生成物实际改动（`git diff --stat`：`tokens.css` 4 行、`tokens.ts` 18 行）：

```diff
-  --sc-font-ui: Geist, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
-  --sc-font-serif-note: Geist, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
+  --sc-font-ui: "Noto Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
+  --sc-font-serif-note: "Noto Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
   --sc-font-mono: "Geist Mono", "Sarasa Mono SC", "Microsoft YaHei Mono", Consolas, monospace;   ← 未动
```

新增的 `fonts.css` 也过 `no-magic`（无字面 hex、无重复裸 px；`font-weight: 100 900` 不含 px，不触规则②）。

### 2.4 对比度门禁复跑（字体变更不影响色值，按要求复跑证明）

`npx vitest run packages/ui` → `Test Files 28 passed (28) / Tests 79 passed (79)`（含 `test/contrast.test.ts` 9 用例）。

对比度用例的**报告口径**打印（打进测试输出供报告引用，浅深各 12 条，全 ≥4.5）：

```
light ink/canvas = 13.18   surface = 12.28   surface-raised = 13.98   content = 13.98
light ink-secondary/canvas = 6.13   surface = 5.71   surface-raised = 6.50   content = 6.50
light ink-faint/canvas = 5.17   surface = 4.82   surface-raised = 5.48   content = 5.48
dark  ink/canvas = 13.42   surface = 12.63   surface-raised = 11.19   content = 14.48
dark  ink-secondary/canvas = 6.77   surface = 6.37   surface-raised = 5.64   content = 7.31
dark  ink-faint/canvas = 5.79   surface = 5.45   surface-raised = 4.83   content = 6.25
```

- **最差对：浅色 `ink-faint/surface` = 4.82、深色 `ink-faint/surface-raised` = 4.83**，与 `DESIGN.md` 第 142 行登记的 T34-01 值（4.82 / 4.83）**逐位一致 → 色值零漂移**。
- 口径说明：门禁断言面 = `TEXT_TOKENS(3) × BACKDROPS(4) = 12` + `on-accent/accent` + `STATUS_ON_CANVAS(3)/canvas` = **16 对/主题**，另加「`ink-faint ≠ ink-secondary`」1 条层次断言 → **17 对/主题**（与 `MILESTONES.md` T34-01 条「对比度门禁 13→17 对」同口径）；两主题合计 34 条实测比值全绿。
- 另有锚定断言：`ink-faint` 浅 `#6B6964` / 深 `#9C9A94` ✓（防回归旧值）。

---

## §3 真机取证（`docs/mockups/cdp-e2e-t50-01.mjs` → `screens-t50/t50-01-results.json`）

### 3.1 被测对象与环境（先钉身份）

| 项 | 值 |
|---|---|
| 被测体 | `apps/desktop/out/**`（`pnpm -C apps/desktop build` = `ensure-abi electron` + electron-vite build 后的 freshly-built out） |
| `out/main/index.js` | mtime `Mon Sep 21 2026 21:04:36` ｜ size **1 004 441 B** |
| 渲染层 bundle | `out/renderer/assets/index-jR33wiKF.js` **1 954 161 B**、`index-CyJ1rWNf.css` **110 096 B** |
| **字体产物** | `out/renderer/assets/NotoSansSC-wght-Dz1u1FRy.ttf` **17 772 300 B**（= 源文件字节，vite 未内联、原样搬运） |
| 启动 | `electron.exe . --user-data-dir=…\_scratch\t50-01\ud --remote-debugging-port=9467` |
| 夹具（物理隔离） | UD=`E:\Hermes Agent工作空间\_scratch\t50-01\ud`（`septcats.settings.json` 里 `rootPath=…\_scratch\t50-01\data`） |
| 真实数据根 | `C:\Users\Administrator\.septcats`：mtime `1789991614995.1055` → `1789991614995.1055`，`untouched=true` |
| 夹具内容 | 新建页 `T50 字体验收页`，**用真实键入**写出 4 块（见 3.2） |
| 汇总 | **18 PASS / 0 FAIL**，console error **0** / pageerror **0**，`window.close()` 优雅退出（`gracefulExited=true`，未强杀） |

### 3.2 夹具内容（真键入，不是塞 DOM）

`page.keyboard.type` 逐字打进编辑器（走编辑器自身输入规则：`# ` → heading、```` ``` ```` → code）：

```
[{"tag":"P","cls":"sc-block sc-block--paragraph","text":"字体验收：自托管思源黑体（Noto Sans SC 可变体）"},
 {"tag":"H1","cls":"sc-block sc-block--heading","text":"一级标题 思源黑体"},
 {"tag":"P","cls":"sc-block sc-block--paragraph","text":"正文段落：中文正文、标点，。！？—— 数字 0123456789，西文 ABCdef。"},
 {"tag":"PRE","cls":"sc-block sc-block--code","text":"const 字族 = 'Noto Sans SC'; // mono 不受影响"}]
```

→ `focused=true hasHeading=true hasPara=true hasCode=true`（截图对象成立）。

### 3.3 `document.fonts` 与 `@font-face` 原文

`document.fonts` 面列表（原文）：

```json
[{"family":"Noto Sans SC","weight":"100 900","style":"normal","status":"loaded","display":"swap"}]
```

`@font-face` 规则原文（页内 `CSSFontFaceRule.cssText`，vite 已把相对 url 重写为产物内文件名）：

```
@font-face { font-family: "Noto Sans SC"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("./NotoSansSC-wght-Dz1u1FRy.ttf") format("truetype-variations"), url("./NotoSansSC-wght-Dz1u1FRy.ttf") format("truetype"); }
```

`document.fonts.check` 原文（**含对照组，见 G2-4**）：

```json
{"400 16px \"Noto Sans SC\"":true,"450 14px \"Noto Sans SC\"":true,"650 28px \"Noto Sans SC\"":true,
 "400 16px \"Source Han Sans SC\"":true,"400 14px \"Geist Mono\"":true,
 "400 16px \"__septcats_no_such_family__\"":true}
```

### 3.4 `getComputedStyle` 原文（浅色；深色逐字相同）

```json
{"body":{"fontFamily":"\"Noto Sans SC\", \"Source Han Sans SC\", \"Noto Sans CJK SC\", \"Microsoft YaHei\", sans-serif","fontWeight":"500","fontSize":"13px"},
 "paragraph":{"fontFamily":"\"Noto Sans SC\", \"Source Han Sans SC\", \"Noto Sans CJK SC\", \"Microsoft YaHei\", sans-serif","fontWeight":"400","fontSize":"16px"},
 "heading":{"fontFamily":"\"Noto Sans SC\", \"Source Han Sans SC\", \"Noto Sans CJK SC\", \"Microsoft YaHei\", sans-serif","fontWeight":"650","fontSize":"28px"},
 "code":{"fontFamily":"\"Geist Mono\", \"Sarasa Mono SC\", \"Microsoft YaHei Mono\", Consolas, monospace","fontWeight":"400","fontSize":"14px"}}
```

### 3.5 「实际生效」的三层证据（本轮最重要的一段——单一 `check()` 会给出**假绿**）

> **先说坑**：`document.fonts.check()` 在本 build 上**对根本不存在的族也返回 `true`**（上表对照组 `__septcats_no_such_family__` = `true`）。本机 registry 里还**已装有** `Noto Sans SC (TrueType) = NotoSansSC-VF.ttf`。这两条叠加会让「check 通过 + 宽度和兜底一致」看起来像证据，实际上什么都证明不了。故本单不拿 check 当生效依据，改走下面三层。

**G2-5 源对照（判定性）**：把三个**独立族名**分别挂进 `FontFaceSet` 再量同一串文字，`app` 与 `ours` 必须相等：

| 族名 | 源 | 400 档宽度 | 650 档宽度 |
|---|---|---|---|
| `Noto Sans SC`（= 应用生产栈首字族，由本页 `@font-face` 定义） | 页面 @font-face | **344.094** | **354.219** |
| `T50ProbeBundled`（探针现场 `new FontFace(url(<构建产物绝对路径>))`） | `file:///…/out/renderer/assets/NotoSansSC-wght-Dz1u1FRy.ttf` | **344.094**（`loaded`） | **354.219** |
| `T50ProbeSystemLocal`（`local("Noto Sans SC")`） | 本机 registry 那份 | 344.094（`loaded`） | — |

→ `app === ours`（400 与 650 **两档都逐位相等**）⇒ **应用生产族名解析到的就是构建产物里那份 ttf**。

**G2-4b 摘除/还原实验**：把本页 FontFace 从集合里 `delete()` 后同串宽度 `344.094 → 344.094`（无变化），`add()` 回来 `344.094`（`restoreOk=true`）。→ 本机系统那份**与本文件同款同形**（渲染不可分辨），如实登记，不再当"证明"用。

**G2-6 浮层像素（探针全权掌控的浮层，非应用 DOM）**：同一串 `思源黑体 Septcats 0123456789 Wm@#` 换三个族，各截同尺寸图：

| 族 | computed 回读 | 截图字节 |
|---|---|---|
| `"Noto Sans SC"` | `"Noto Sans SC"` | **10 771** |
| `"Microsoft YaHei"` | `"Microsoft YaHei"` | **11 238** |
| `Consolas` | `Consolas` | **9 476** |

→ 三张**互不相同** ⇒ 族名真的换到了字形，不是只写在栈字符串里。

**G2-7 体检（解释本轮一度出现的「全都一样」假结论）**：改应用自己元素的内联 `font-family` 后——

```
immediate : font-family: serif !important;   → computed "serif"      ← 打上了
500ms 后  : styleAttr=null                   → computed 回到生产栈   ← 被上层重渲染抹掉
```

→ **应用元素（ProseMirror/React 管理）上的内联样式不可靠**，拿它做像素对照会得到「三张全同」的**假结论**。故像素证据改由 G2-6 自建浮层承担。这条同时说明：前两轮探针里 `prodDiffers…=false` 是**探针自身的缺陷**，不是产品缺陷。

### 3.6 双主题整页截图

| 文件 | 字节 | 实测状态 |
|---|---|---|
| `docs/mockups/screens-t50/t50-01-light-typography.png` | `59 045` | `data-theme=light`、`h1.sc-block--heading` + 正文段 + `.sc-block--code` 三块可见、视口 1184×735 |
| `docs/mockups/screens-t50/t50-01-dark-typography.png` | `60 565` | 同上，`data-theme=dark` |

两图内容：页标题「T50 字体验收页」、正文行、**28px/650 的 h1「一级标题 思源黑体」**、**14px mono 代码块** `const 字族 = 'Noto Sans SC'; // mono 不受影响` —— 正文/标题（走新栈）/代码块（走 mono 未动）同框，可直接目视对比。

> **SSIM-NOTE**：本单截图是**状态/字形证据**而非像素基线比对——**无基线图、未做 SSIM/差异度量**。除整页截图外，本轮另在 `_scratch/t50-01/debug/overlay-{noto,yahei,consolas}.png` 落了三张浮层对照小图（未交付，仅复核用）。

### 3.7 探针断言清单（18 条，全 PASS）

| 组 | 断言 |
|---|---|
| G0 | 夹具页渲染出编辑器；正文段/h1/代码块三块成立 |
| G1 | FontFaceSet 含 `Noto Sans SC` 且 `status=loaded`、`weight=100 900`；check 三档全 true（标注仅辅证）；`@font-face` 原文含 `truetype-variations`+`truetype`+`swap`、**无 `unicode-range`**；out/ 里 ttf 字节 = 17 772 300 |
| G2 | body/正文/h1 computed 族名以 `Noto Sans SC` 打头；代码块仍以 `Geist Mono` 打头且不含 `Noto Sans SC`；度量具区分力；check 对照组披露；源对照 `app===ours`；摘除/还原实验；浮层像素三族互不相同；内联保持性体检 |
| G3/G4 | 浅色/深色整页截图（主题属性 + 三块可见 + 文件非空）；深色下族名同样以 `Noto Sans SC` 打头 |
| 收尾 | `window.close()` 优雅退出 |

---

## §4 代码改动（最小面，逐文件）

1. **`DESIGN.md`（+11/-11 行）**
   - front matter `typography` 段 **9 处非 mono** `fontFamily` → `"Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"`；`font-mono` 与 `code` 的 2 处 mono 栈**原样**。
   - §Typography 首条与 §Do's and Don'ts 的 2 处 `Geist` 散文陈述改写为「自托管思源黑体 + 禁一切在线字体」。字号/行高/字重/字距/颜色**一处未动**。

2. **`apps/desktop/src/renderer/src/styles/fonts.css`（新文件，30 行，其中 20 行是注释）**

   ```css
   @font-face {
     font-family: "Noto Sans SC";
     font-style: normal;
     font-weight: 100 900;
     font-display: swap;
     src:
       url('../../assets/fonts/NotoSansSC-wght.ttf') format('truetype-variations'),
       url('../../assets/fonts/NotoSansSC-wght.ttf') format('truetype');
   }
   ```

   - **相对 `url()`**，走 vite 资源解析（无新增依赖、无 `?url` 导入、无 public/ 拷贝）；构建实测被重写为 `url("./NotoSansSC-wght-Dz1u1FRy.ttf")`。
   - **不写 `unicode-range`**（全量中文）；`font-display: swap`；`font-weight: 100 900` 覆盖 DESIGN.md 真用到的 400/450/500/600/620/650（非整档）。
   - 文件头注释写清了「为什么不塞进 tokens 构建链」：`src` 是资产路径不是设计决策，塞进去会让 `packages/ui` 的产物反向依赖 `apps/desktop/assets`。

3. **`apps/desktop/src/renderer/src/main.tsx`（+2 行）** —— 在 `@septcats/ui/tokens.css` **之前**第一个 import：

   ```ts
   // 自托管思源黑体（T50-01）：@font-face 必须最先注册，后面的 tokens.css 才引用得到族名。
   import './styles/fonts.css';
   ```

4. **`packages/ui/src/tokens.css`（-2/+2）、`packages/ui/src/tokens.ts`（-9/+9）** —— `node packages/ui/tokens/build-tokens.mjs --write` 生成物，**非手改**。

5. **探针/证据**：`docs/mockups/cdp-e2e-t50-01.mjs`（新，1092 行）、`docs/mockups/screens-t50/{t50-01-results.json, t50-01-{light,dark}-typography.png}`。

---

## §5 DEVIATION（与任务书字面不一致处 + 处置 + 理由）

### DEVIATION-1 · 前置 tip 与口径不一致（登记，未处置）
任务书/用户侧称「tip 为 T49-01 交付提交 `4ca7079`」，实测 `git log -1` = **`eba8f5e docs(QA): 登记 Q-27…`**（`4ca7079` 在历史第 2 位）。
**处置/理由**：红线禁碰 git，未做任何 git 操作；全文已按任务书执行，前置差异仅登记，不影响实现面。

### DEVIATION-2 · 栈序以**实证名**打头，与任务书 §1.1 的字面例不同（任务书授权内）
任务书 §1.1 字面例是 `"Source Han Sans SC", "Noto Sans SC", …`，同时明文授权「以实际文件 name 表为准——确认真实族名后决定排在最前的名字」。
**处置**：`name(16)` 实测 = `Noto Sans SC`（`name(1)` 是 `Noto Sans SC Thin`），故栈首改为 `"Noto Sans SC"`，其余保持 §1.1 列出的顺序。
**理由**：本机构建的 `@font-face` 只声明了 `Noto Sans SC` 这一个族名。若把 `Source Han Sans SC` 留在栈首，本机不存在该族 → 会一路落到 `Microsoft YaHei`（本机确有），**捆绑文件永不生效**——正是 §0 点名要消灭的「违反映本地优先」。`docs/PROJECT_PLAN.md` §16.5 也是同款字面序，建议随本单口径一并追认。

### DEVIATION-3 · `DESIGN.md` 两处**非 fontFamily** 的字体散文同步改写（字体变更范畴，非 typography 段）
红线字面是「只动 DESIGN.md typography 段」，而 `## Do's and Don'ts` 第 201 行（「Don't：用 Inter（字体占位 Geist…）」）不在该章。
**处置**：第 154 行（在 `## Typography` 内，属 typography 段）与第 201 行**两处都改**，都只删改字体陈述，未动任何数值/色值/其它条目。
**理由**：两条都是纯字体陈述；留旧文会让「唯一真相源 DESIGN.md」自相矛盾（下文仍说字体是 Geist 占位）。改动可逆、无副作用；若 PM 认为 201 行应另立账，回退该行即可，`--check` 不受影响（该行不进 front matter）。

### DEVIATION-4 · 真机需要重建 `out/**`（非重打包）
红线「全仓/打包留 PM」。
**处置**：跑了一次 `pnpm -C apps/desktop build`（= `ensure-abi electron` + **electron-vite build**），把新 CSS/字体打进 `out/`；**`electron-builder`（dist/安装包）未执行**。
**理由**：`out/` 是 gitignore 的构建产物；T34/T39/T49 探针自述的既定口径就是「直接跑 freshly-built out/（非重打包）」。不重建则真机跑不到本单改动。**全仓回归与打包仍留 PM**。

### DEVIATION-5 · 探针相对任务书要的断言做了**证据强化**（并暴露 `document.fonts.check()` 假绿）
任务书 §1.5 要求「用 `document.fonts.check(...)` 与 `getComputedStyle` 断言实际生效」。
**处置**：`check` 与 `getComputedStyle` **照做并全部贴原文**，但**不把 `check` 当生效依据**，另加三层证据：① 源对照（`app === ours`，指向 `out/` 里那份 ttf）；② 自建浮层同串三族像素互不相同；③ 内联保持性体检。
**理由**：实测 `document.fonts.check('400 16px "__septcats_no_such_family__"')` 也返回 `true`（该 API 在本 build 对不存在的族不具区分力），且本机 registry 已装 `Noto Sans SC (TrueType) = NotoSansSC-VF.ttf`，单靠 `check` + 宽度对照 **必然给出假绿**。这一发现写进了 `results.json` 的 G2-4/G2-4b 断言与 §3.5，供 PM 复核。

### DEVIATION-6 · 探针新增自建浮层与「源对照」实验（任务书未要求）
**处置**：新探针内注入一张 `#t50-probe` 固定浮层（三行同串不同族）截三张小图；并用 `new FontFace(...)` 现场挂两个额外族名做源对照；实验后 `overlayHide()` / `document.fonts.add()` 原样还原。
**理由**：见 DEVIATION-5——这是本环境唯一能**判定性**区分「应用真的用了捆绑文件」与「栈里写了但落回系统字」的路子。全部改动只发生在页面内存里，不落盘、不改产品代码。

### DEVIATION-7 · 登记（未修，红线外）：改应用元素的内联样式会被上层重渲染抹掉
**现象**（原始值）：对 `h1.sc-block--heading` 设 `style="font-family: serif !important"` → 立即回读 computed = `serif`（生效）；**500ms 后 `styleAttr=null`、computed 回到生产栈**（被抹掉）。
**处置**：未改任何产品代码（`apps/desktop/**` 的产品面不在本单授权面），只把它作为**探针方法论约束**记录（G2-7），并把像素证据改由自建浮层承担。
**给 PM 的提示**：这解释了本轮前两次探针里「生产栈 vs 强制兜底族三张截图逐字节相同」的假结论（是探针打在会被抹掉的 DOM 上，不是字体没生效）。是否值得单独立账（「谁在重渲染并清内联 style」）由 PM 定。

---

## §6 未做 / 留给 PM

1. **全仓回归**（`pnpm -r test` 全包）未跑 —— 按任务书「全仓留 PM」。本单只跑了 `apps/desktop`（638）与 `packages/ui`（79，含对比度 9）；其余包未受本单改动影响（未碰 `packages/**` 源码）。
2. **打包（electron-builder dist / 安装包 / asar 实证）**未跑 —— 本单只到 `out/` 层。**需要 PM 关注**：字体 16.9 MB 会进 `out/renderer/assets/` → 按 §0 的 `files: out/**` 入 asar，安装包体积预计 +16.9 MB（未压缩）。
3. **真实数据根 `C:\Users\Administrator\.septcats` 全程只读**（mtime `1789991614995.1055` 前后逐位一致，`untouched=true`）；夹具与进程已清理：无 `electron.exe` 残留、9467/946x 端口空闲、`_scratch/t50-01/` 为独立夹具目录。
4. **工作树里两处非本单脏项**（本单开始前即存在，**未经本单手改**）：
   - ` M docs/perf-history.jsonl` —— 由 `apps/desktop/test/perf.test.ts` 运行时追加写入（本单跑测试时它又追加了几条，非人工编辑）；
   - `?? docs/tasks/TASK-T49-01.md` —— 未跟踪（T49 遗留）。
   本单 `git diff` 的产品面改动只有 `DESIGN.md`、`main.tsx`、`tokens.{css,ts}`（+ 3 个新增未跟踪文件）。
5. **字体文件只增不减**：本单未改 `NotoSansSC-wght.ttf` 一个字节（sha256 前缀 `a3041811` 与 §0 一致），未新增任何字体文件/依赖。
6. **等宽（mono）按任务书留现状**：`Geist Mono` 等 5 族本机全无 → 实际落 `Consolas` + 系统 CJK 兜底。老板未指定等宽，如需换（如 `Sarasa Mono SC` / `Noto Sans Mono CJK`）请另立单。

---

## §7 PM 复跑节（留空，PM 补）

<!-- 留空：由 PM 独立复跑后填写 -->

复跑建议命令（与本单口径一致）：

```
node packages/ui/tokens/build-tokens.mjs --check      # ✓ token 产物与 DESIGN.md 一致
node packages/ui/tokens/no-magic.mjs                  # ✓ 0 违规
pnpm -C apps/desktop test                             # 638/638
pnpm -r typecheck                                     # 9/9
pnpm -C apps/desktop build && node docs/mockups/cdp-e2e-t50-01.mjs   # 18 PASS / 0 FAIL
```

---

## §8 证据索引（逐文件 + 关键原始值定位）

| 产物 | 路径 | 关键原始值 |
|---|---|---|
| 设计源改动 | `DESIGN.md` | front matter 9 处非 mono `fontFamily`（第 30/32/36/42/48/54/59/64/69 行）+ 散文 2 处（第 154/201 行）；diff `11/11` |
| 字体声明 | `apps/desktop/src/renderer/src/styles/fonts.css` | 30 行；`font-family: "Noto Sans SC"`、`font-weight: 100 900`、`font-display: swap`、无 `unicode-range` |
| 入口接线 | `apps/desktop/src/renderer/src/main.tsx` | +2 行（注释 + `import './styles/fonts.css';`，位次在 tokens.css 之前） |
| token 生成物 | `packages/ui/src/tokens.{css,ts}` | `--sc-font-ui: "Noto Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;`（mono 行 `--sc-font-mono: "Geist Mono", …` 未动） |
| 字体资产（**未改**） | `apps/desktop/src/renderer/assets/fonts/NotoSansSC-wght.ttf` | 17 772 300 B；sha256 `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da` |
| 构建产物 | `apps/desktop/out/renderer/assets/` | `NotoSansSC-wght-Dz1u1FRy.ttf` 17 772 300 B、`index-CyJ1rWNf.css` 110 096 B、`index-jR33wiKF.js` 1 954 161 B；`out/main/index.js` 1 004 441 B @ `21:04:36` |
| 真机探针 | `docs/mockups/cdp-e2e-t50-01.mjs` | 1092 行；18 条断言；端口 9467 |
| 真机结果 | `docs/mockups/screens-t50/t50-01-results.json` | `pass=18 fail=0`；`consoleErrors=[] pageErrors=[]`；`untouched=true`；`phases.sourceCompare.app=ours=344.094`（650 档 354.219） |
| 真机截图 | `docs/mockups/screens-t50/t50-01-light-typography.png` / `t50-01-dark-typography.png` | 59 045 B / 60 565 B；`data-theme` = `light` / `dark` |
| 复核用小图（未交付） | `E:\Hermes Agent工作空间\_scratch\t50-01\debug\overlay-{noto,yahei,consolas}.png` | 10 771 / 11 238 / 9 476 B（三张互不相同） |
| 夹具（物理隔离） | `E:\Hermes Agent工作空间\_scratch\t50-01\{ud,data}` | `--user-data-dir` + `rootPath` 双隔离；真实根永不触碰 |


## §PM 复跑（2026-09-21，独立）—— **18 PASS / 0 FAIL**

- 全仓 `pnpm -r test` 无红（desktop 638 / importer 59 / …全部 passed）；typecheck 0 error；`no-magic` ✓；`build-tokens --check` ✓。
- 字体文件复验：17,772,300 B、sha256 前缀 `a3041811a78c361b` 与 §0 逐位一致；构建产物 `out/renderer/assets/NotoSansSC-wght-Dz1u1FRy.ttf` 原样搬运 ✓。
- 独立复跑 `cdp-e2e-t50-01.mjs`：**18 PASS / 0 FAIL**。三层硬证据重现：源对照 `app==ours==344.094`（400）/`354.219`（650）；`check()` 假绿对照组如实披露（不存在的族也 true → 不作生效依据）；自建浮层三族像素互不相同。
- **视觉模型判读**（Qwen3.8-Flash-Next，按老板分工规则）：浅色整页截图「正文/标题/代码块全部正常，无缺字、无豆腐块、无错位、行高正常；整体为黑体类无衬线（思源黑体观感），代码块保持 mono」✓。
- **采纳 CB 对任务书的修正**（DEVIATION-5）：`document.fonts.check()` 在本 build 不具区分力——**以后所有字体验收探针禁以 check() 为判据**，以「源对照 + 浮层像素」为准。此坑记入 skill。
