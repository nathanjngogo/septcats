# TASK-T55-02 交付报告 · P1 像素布偶猫图标接线（PM 原型资产 → 正式装包）

> 工程师：CBL ｜ 前置：`git log -1` = **`9af2ad5`**（T55 设计资产定稿 + R11 任务书）
> 口径来源：`docs/tasks/TASK-T55-02.md` §1（本单为**接线单**：资产已由 PM 定稿，只做运行时接线 + 文档）。
> 本轮实际范围以派发词 §①–⑥ 为准（明确「禁止重新设计或改 `scripts/`」）。

---

## 0. 结论

派发词 ①–⑥ 全部落地，真机取证 **14 PASS / 0 FAIL**、`realRoot untouched=true`、交付后 `electron` 进程计数 **0**。

| 面 | 结果（原始值） |
| --- | --- |
| ① 托盘换图 | `tray.ts` 查找序列首位 = `icon-tray.png`（`.ico` 降为兜底）；真机解析实测命中 `…\apps\desktop\build\icon-tray.png` 且 `existsSync=true`；候选 6 条 = 三基目录的 `icon-tray.png` 全排在 `icon.ico` 之前 |
| ② 窗口 icon + 灰阶漏网 | `BrowserWindow` 构造加 `icon: <解析到的 build/icon.png>`（真机命中且存在）；`backgroundColor` 实测 `#F5F5F5`（原 `#FBFBFA`） |
| ③ 装包资源 | `electron-builder.yml` 新增 `extraResources: build → <resources>/build/`（filter 四份图标，合计 **4973 B**） |
| ④ 文档 | `DESIGN.md` 新增「品牌」节 + 旧铃铛叙述收敛；`PROJECT_PLAN §17` 整节改写并标注覆盖；`项目交接文档.md` 增「品牌图标」行；新建 `assets/brand/README.md` |
| ⑤ 单测 | 新增 `test/t55-icons.test.ts` **11 例**（纯函数 6 + ico 五层回读 5）；desktop **693 → 704**（62 文件） |
| ⑥ 真机探针 | `docs/mockups/cdp-e2e-t55-02.mjs` **14 PASS / 0 FAIL**；5 张截图落 `docs/mockups/screens-t55/`（任务书要求的 2 张 + 3 张放大/浮层补充证据） |
| 数值 | desktop 704 全绿 / `pnpm -r typecheck` **9/9** / 双门禁 exit 0 / `SELFTEST OK` |

---

## 1. 改动清单

### 1.1 运行时代码（`apps/desktop/src/main/`）

| 文件 | 改动 |
| --- | --- |
| `iconAssets.ts`（**新增**） | 纯函数查找序列：`TRAY_ICON_NAMES = ['icon-tray.png','icon.ico']`、`WINDOW_ICON_NAMES = ['icon.png']`、`iconCandidatePaths(names, baseDirs, joinFn)`（**名字外层 × 基目录内层**）、`pickFirstExisting(candidates, exists)`。**刻意不 import electron**（无 electron 依赖 → 可进 node 单测） |
| `tray.ts` | 新增 `trayIconBaseDirs()`（`process.resourcesPath` → `app.getAppPath()` → `out/main/../../build`）；`resolveTrayIconPath()` 改为「纯函数展开候选 + `pickFirstExisting(…, existsSync)`」；未找到时的日志改为提示 `icon-tray.png`；文件头注释同步新口径 |
| `index.ts` | 新增 `resolveWindowIconPath()`（同一查找序列，取 `icon.png`）→ `BrowserWindow` 构造 `...(iconPath === null ? {} : { icon: iconPath })`（找不到交回可执行文件默认图标，不阻断建窗）；`backgroundColor: '#FBFBFA' → '#F5F5F5'`；建窗时记一行「窗口图标解析：…」；新增只读取证出口 `export const t55Probe`（`trayIconPath` / `windowIconPath` / `iconCandidates`，沿用 T54-01 `t54Probe` 模式，产品路径不读） |
| `pixelIco.ts`（**新增**） | `.ico` 目录表 + 逐层 PNG 表项回读：`readIco(buf)`（校验保留位/类型/层数/偏移不越界；宽高 `0 → 256` 归一）、`readPngIhdrWidth(buf, offset)`、`PNG_SIGNATURE`。纯 `Buffer` 解析、无 electron、无 fs、无副作用，**产品运行时不调用** |

查找序列实测（dev，`pnpm -C apps/desktop build` 产物）：

```
["…\node_modules\electron\dist\resources\build\icon-tray.png",
 "…\apps\desktop\build\icon-tray.png",
 "…\apps\desktop\build\icon-tray.png",
 "…\node_modules\electron\dist\resources\build\icon.ico",
 "…\apps\desktop\build\icon.ico",
 "…\apps\desktop\build\icon.ico"]
```

> 口径说明：dev 下 `app.getAppPath()` 与 `out/main/../../build` 是同一物理目录，故候选出现两次——与旧实现的三位结构同构，非缺陷。

### 1.2 打包配置

`apps/desktop/electron-builder.yml` 新增：

```yaml
extraResources:
  - from: build
    to: build
    filter: [icon.png, icon.ico, icon-tray.png, icon-tray@2x.png]
```

**为什么是四份而不是两份**（见 DEVIATION D-1，附实证）：`files:` 为**显式白名单**（`out/**` + `package.json`），`directories.buildResources` 只服务 builder 生成 exe 图标/安装器素材、**不进包**。0.3.0 产物实测（`dist/win-unpacked/`）：`resources/` 下**无** `build/`，解析 `app.asar` 头得顶层仅 `node_modules, out, package.json` → 旧包内 `resolveTrayIconPath()` 三个候选**全不存在**，托盘在**正式包里是空图**（本单顺带修掉这个真缺陷）。

### 1.3 文档

| 文件 | 改动 |
| --- | --- |
| `DESIGN.md` | 新增 `### 品牌（T55-02 · 覆盖计划书 §17 旧「单线描猫 + 铃铛」决议）` 节（图形标语法/三变体/托盘子型/尺寸档/资产真源指针/§16.6 例外/猫形语言仅 sync-status）；`Overview` 铃铛句改写为「T55-02 起品牌标不再向 UI 供色」；`sync-status` 处「铃铛」补注旧称（伴随文案收敛，见 D-3） |
| `docs/PROJECT_PLAN.md` | §17 整节改写为「3D 像素浮雕布偶猫 · 白底圆角 · 黑白灰；托盘 16px 原生简化子型」，表内 10 行（名称/图形标/三变体/托盘子型/字标/应用图标/尺寸档/主题呼应/冻结流程）+ 顶部覆盖声明块（旧线猫草案留痕 `docs/brand/`） |
| `项目交接文档.md` | 「项目现状速览」表新增 **品牌图标** 行（默认 C 已接线 / 托盘 T / 资产真源 `assets/brand/` + README） |
| `assets/brand/README.md`（**新增**） | 决策区（A/B/C/T 判读 + 状态）、换型一行命令（`sed -i 's/3dpix-C/3dpix-A/g' …`）、两条生成命令、四组质检断言（连通性/不触边/零彩色/直角满幅 + 硬边与灰阶 + ico 机器复现）、接线点清单 |

---

## 2. 单测（`test/t55-icons.test.ts`，新增 11 例）

### 2.1 查找序列纯函数（6 例）

```
✓ 名字优先于基目录：三个基目录的 icon-tray.png 候选全部排在 icon.ico 之前
✓ 空/缺省基目录被跳过：未打包态 resourcesPath 缺失不产生空串候选
✓ pickFirstExisting：命中首个存在项（新图优先，旧 ico 不作数）
✓ pickFirstExisting：全不存在 → null（调用方回落空图/默认图标，不抛错）
✓ 名表口径：托盘首位 = icon-tray.png、窗口 = icon.png（换图硬约束）
✓ 真机同款解析（真实 existsSync + dev 基目录）：托盘命中 icon-tray.png、窗口命中 icon.png
```

### 2.2 icon.ico 五层回读（5 例，PM 亲验口径的机器复现）

读取 `apps/desktop/build/icon.ico` 的原始回读值：

```
count = 5
widths   = [16, 24, 32, 48, 256]        （目录项 0 章 0 归一成 256）
lengths  = [156, 183, 184, 470, 1777]
offsets  = [86, 242, 425, 609, 1079]
文件总长 = 2856 = 6 + 16×5 + Σlengths   ✓ 首尾相接不越界
每层 bitCount = 32 且 isPng = true（8 字节 PNG 签名齐）；IHDR 宽 = 目录声明宽（逐层复核）
16 层 ≡ build/icon-tray.png、32 层 ≡ icon-tray@2x.png、256 层 ≡ icon.png（逐字节）
畸形输入（截断头 / 类型非 1 / 层数据越界 / 空缓冲）全部抛错或回 null（解析器非空转）
```

```
✓ 目录层数 = 5，尺寸序列 = [16, 24, 32, 48, 256]
✓ 每层都是 PNG 表项：8 字节签名齐、IHDR 宽 = 目录声明宽
✓ 层数据首尾相接且不越界：Σ byteLength + 表头 = 文件长度
✓ 小尺寸层 = 托盘 T 子型、256 层 = C 全细节（与 build/ 同名 PNG 逐字节同源）
✓ 畸形输入抛错（解析器非空转）：截断头 / 类型非图标 / 层数据越界
```

### 2.3 测试计数

`pnpm -C apps/desktop test`：**Test Files 62 passed (62) / Tests 704 passed (704)**（基线 61 files / 693 tests → +1 文件 / +11 例）。

---

## 3. 真机取证（`node docs/mockups/cdp-e2e-t55-02.mjs`）

```
===== T55-02：14 PASS / 0 FAIL =====
realRoot untouched=true  electron 进程数=0
```

| 断言 | 原始值 |
| --- | --- |
| G0-1 夹具成立 | `.app-side` + `pages.tree` API 就绪（独立 `--user-data-dir` + `rootPath`） |
| G0-2 夹具数据根物化 | `_scratch/t55-02/data` exists=true |
| G1-1 托盘解析命中新图 | `trayIcon = …\apps\desktop\build\icon-tray.png` |
| G1-2 文件存在 | `existsSync=true` |
| G1-3 候选序列口径 | 6 条，前 3 条全 `build/icon-tray.png`、后 3 条全 `build/icon.ico` |
| G1-4 托盘已装图 | `destroyed=false`，`getBounds()={"x":2314,"y":1392,"width":32,"height":48}`（空图会是 0×0） |
| G2-1 窗口 title | `getTitle() = "Septcats"` |
| G2-2 窗口 icon 解析 | `windowIcon = …\apps\desktop\build\icon.png`，`exists=true` |
| G2-3 背景色 | `getBackgroundColor() = "#F5F5F5"` |
| G3-1 任务栏区截图 | `rect={x:0,y:1392,w:2560,h:48}` 9087 B |
| G3-1b 任务栏按钮群 6× 放大 | `rect={x:1080,y:1392,w:400,h:48}` 11327 B |
| G3-2 托盘区截图 | `rect={x:2140,y:1392,w:420,h:48}` 2618 B |
| G3-3 通知区溢出浮层 | 真点 `(2330,1416)` → 浮层开（`before=16106B → after=19916B`）+ 3× 放大 33467 B |
| G4-1 退出 | `window.close()` 优雅退出（`gracefulExited=true, forced=false`） |

**截图（5 张，`docs/mockups/screens-t55/`）**

| 文件 | 内容（人眼判读） |
| --- | --- |
| `t55-02-taskbar.png` | 主屏任务栏全宽条带（2560×48） |
| `t55-02-taskbar-buttons-zoom.png` | 任务栏按钮群 6× 最近邻放大：**最右 Septcats 按钮 = 白底像素布偶猫**（窗口 `icon.png` = C-256 落地；该按钮带 Win11 活动态高亮） |
| `t55-02-tray.png` | 通知区条带（420×48） |
| `t55-02-tray-overflow.png` | 通知区**溢出浮层** 1:1（真点 chevron 打开） |
| `t55-02-tray-icon-zoom.png` | 溢出浮层 3× 最近邻放大：**左上第 1 格 = 白底像素猫脸（双尖耳 + 大眼 + 鼻）** = 托盘 `icon-tray.png`（T 子型） |

> 取证法：renderer CDP（playwright-core over `--remote-debugging-port`）+ main 进程 Node inspector（`--inspect`）读 `require.cache` 的 `t55Probe`/`t54Probe`（**绝不 `require(path)`**：缓存未命中会重跑 main 入口 → 单实例锁自杀）+ main 内 `desktopCapturer` 抓主屏 → DIP 矩形裁剪 →（`zoom>1` 时 `toBitmap` → 手工像素复制 → `createFromBitmap` 最近邻放大，无插值）。
> 隔离：夹具全在 `E:\Hermes Agent工作空间\_scratch\t55-02\`；真实档案 `C:\Users\Administrator\.septcats` mtime 前后一致（`untouched=true`）。

---

## 4. 数值验收（命令与原始输出）

### 4.1 `pnpm -C apps/desktop test`

```
 Test Files  62 passed (62)
      Tests  704 passed (704)
   Duration  34.29s
```

### 4.2 `pnpm -r typecheck`

```
Scope: 9 of 10 workspace projects
packages/{core,platform,ui,dbview,schema,editor,sync,importer} + apps/desktop → 9/9 Done（0 错）
```

### 4.3 双门禁

```
✓ token 产物与 DESIGN.md 一致          （exit 0；DESIGN.md 改后复跑）
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px（exit 0）
```

### 4.4 `pnpm -C apps/desktop selftest`

```
  FTS_RESYNC 2000 页全量重算耗时 18.6 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
PASS FTS_RESYNC 后重算页全部在索引中
SELFTEST OK
```

### 4.5 资产硬边/灰阶独立复算（24 份产物，脚本口径见 §6 D-7）

```
PASS build/icon.png 256x256 实心=63552 透明=1984 alpha档=[0,255] 带彩=0
PASS build/icon-tray.png 16x16 实心=256 透明=0 alpha档=[255] 带彩=0
PASS build/icon-tray@2x.png 32x32 实心=1024 透明=0 alpha档=[255] 带彩=0
PASS build/icon.ico[0..4] 16/24/32/48/256px（alpha 档 ∈ {[255],[0,255]}，带彩=0）
PASS assets/brand/dist/png/** 16 份（同上）
ALL-PASS：全档 alpha∈{0,255} 且非透明像素全纯灰
```

### 4.6 交付后进程与 ABI 状态

```
electron 计数 = 0        （交付前先清掉 1 个自起 vitest 孤儿 pid 29196 —— 它持有
                         better_sqlite3.node 致 ensure-abi electron EPERM，清后 √ Rebuild Complete）
ABI 现状 = electron（apps/desktop/out/** 已为最新构建，PM 可直接复跑探针；
                         跑 pnpm test 时 pretest 会自动 ensure-abi node）
```

---

## 5. 红线自查

| 红线 | 状态 |
| --- | --- |
| `packages/**` 零改动 | ✓ `git status -- packages` 空 |
| `scripts/` 与 `assets/brand` 设计资产零改动 | ✓ `git status -- scripts assets/brand/dist assets/brand/septcats-3dpix-*.svg` 空（`assets/brand/README.md` 为任务书允许的新增文档） |
| 不加依赖 | ✓ 无 `package.json` 改动 |
| 不碰 git | ✓ 全程零 git 写操作（仅 `git log -1` / `git status` 读） |
| 禁 TODO | ✓ 全部新增/改动文件 `grep TODO` = 空 |
| 真档案只读 | ✓ 探针 `realRoot untouched=true`（mtime 前后一致） |
| 杀净自起进程 | ✓ `electron` 计数 = 0；`node.exe` 中无指向 Septcats 的孤儿（`wmic`/`Get-CimInstance` 双查） |
| ABI 纪律 | ✓ 测试前 `ensure-abi node`；探针前 `ensure-abi electron` + `pnpm -C apps/desktop build` |
| 不重新设计/不改资产 | ✓ 未跑任何生成脚本覆盖资产；`build/` 四份图标保持 PM 交付指纹（`md5`: `icon-tray.png 60071c8a…`、`icon-tray@2x.png 76d4c6b4…`、`icon.png 07129e28…`、`icon.ico bd15dc8c…`） |

---

## 6. DEVIATION（待 PM 追认）

| # | 事项 | 说明 / 依据 |
| --- | --- | --- |
| D-1 | **`extraResources` 复制四份图标**（任务书预设「只需补 tray 两文件」） | `files:` 是显式白名单，`buildResources` 不进包 → `icon.png`/`icon.ico` 同样不在包内。实证：0.3.0 `dist/win-unpacked/resources/` 无 `build/`；解析 `app.asar` 头顶层仅 `node_modules, out, package.json`。即**旧正式包的托盘本来就是空图**，本单按「运行时 `<resourcesPath>/build/<name>` 探测」口径补齐四份（合计 4973 B，无体积感）。**请 PM 打包后核实 `<resources>/build/` 四文件在位** |
| D-2 | 任务书 §1.1（新脚本 `apps/desktop/scripts/pixel-icons.mjs` + `make-icon.mjs` 头注）**未做** | 派发词红线「`scripts/` 零改动」且资产已由 PM 收敛在根 `scripts/`（`build-pixel-ico.mjs` 已直出 `build/` 四份图标）。故接线不新增桌面侧脚本、不改 `make-icon.mjs` |
| D-3 | `DESIGN.md` 另改 2 处伴随文案（铃铛退役句、`sync-status` 旧称注） | 旧叙述与新品牌直接矛盾（品牌标已不供色）；仅为口径一致性收敛，**token 名与色值一字未动**，`build-tokens --check` 复跑仍绿（exit 0） |
| D-4 | 新增 2 个纯函数模块 + 单测 11 例（> 要求的 4 例） | `iconAssets.ts`（序列纯逻辑）+ `pixelIco.ts`（ico 回读）均无 electron 依赖；11 例 = 序列 6 + ico 回读 5，覆盖畸形输入防「空转断言」 |
| D-5 | 真机截图 **5 张**（要求 2 张） | Win11 默认把新应用托盘图标收进**溢出浮层**，实测 `tray.getBounds()` 上报的就是溢出按钮位（`x=2314, w=32`），故任务书要求的「托盘区」条带截图里**看不到图标**；补真点溢出按钮 → 浮层 1:1 + 3× 放大（`t55-02-tray-icon-zoom.png` 人眼可判读 T 子型）+ 任务栏按钮群 6× 放大（白底像素猫可见） |
| D-6 | `index.ts` 新增只读取证出口 `t55Probe` | 同 T54-01 `t54Probe` 模式：探针经 main inspector 读解析结果，产品路径不读、无副作用 |
| D-7 | `index.ts` 增 1 行启动日志「窗口图标解析：…」 | 诊断用（打包环境图标是否命中一眼可见），与托盘既有 `[tray] … icon=` 日志对称 |
| D-8 | 独立 QA 复算脚本住在 `_scratch/`（未入库） | `_scratch/t55-png-qc.mjs`（PNG 解码断言硬边/纯灰）、`_scratch/t55-asar-peek.mjs`（0.3.0 包体实证）、`_scratch/t55-flyout-zoom.mjs`（人眼放大核对）。`_scratch/` 是既有 gitignore 诊断区；`ico` 五层与逐字节同源断言已回灌到入库单测 |

---

## 7. PM 复跑节（留空，供 PM 回填）

```bash
# 0) 前置：清 node 孤儿（wmic 命令行不含 workbuddy 者），否则 ensure-abi 会 EPERM
wmic process where "name='node.exe'" get processid,commandline

# 1) 单测（ABI 自动切 node）
pnpm -C apps/desktop test                                  # 期望：62 files / 704 passed（+11）
pnpm -r typecheck                                          # 期望：9/9 Done
node packages/ui/tokens/build-tokens.mjs --check           # 期望：✓ token 产物与 DESIGN.md 一致
node packages/ui/tokens/no-magic.mjs                       # 期望：✓ no-magic（exit 0）
pnpm -C apps/desktop selftest                              # 期望：SELFTEST OK

# 2) 真机探针（需切 electron ABI + 重建 out/）
node apps/desktop/scripts/ensure-abi.mjs electron
pnpm -C apps/desktop build
node docs/mockups/cdp-e2e-t55-02.mjs                       # 期望：14 PASS / 0 FAIL，realRoot untouched=true，electron 计数=0

# 3) 打包后核实（全仓/打包归 PM）
#    dist/win-unpacked/resources/build/{icon.png,icon.ico,icon-tray.png,icon-tray@2x.png} 四份在位

PM 复跑结论：____（日期：________）
```

---

## 8. 登记待办（非本单范围）

| # | 事项 | 说明 |
| --- | --- | --- |
| R-1 | 老板三选一**尚未拍板** | 当前 = **C（默认）已接线**；A/B 资产齐备，换型一行命令见 `assets/brand/README.md` §0 |
| R-2 | Win11 托盘图标默认收进溢出浮层 | 用户侧可在「任务栏设置 → 其他系统托盘图标」把 Septcats 拖出/置为常显；非产品缺陷，PM 可在真机演示时处理 |
| R-3 | `mac.icon: build/icon.icns` 未更新 | 仍指向旧链路产物；本单不动 `scripts/`（icns 生成属资产线），mac 构建入 CI 时需一并出图 |
| R-4 | `docs/brand/`（旧线猫/voxel 草案 HTML+SVG）未清理 | 任务书只要求 §17 改写留痕；是否归档/删除待 PM 定 |


## §PM 复跑（09-22 13:15，独立）—— **14 PASS / 0 FAIL**

- 亲跑 `cdp-e2e-t55-02.mjs` 原始值：G1-1 托盘解析命中 `icon-tray.png`（exists=true）；G1-3 候选序列「名字优先于目录」实证（icon-tray×3 全排在 icon.ico×3 前）；窗口 icon 命中 `icon.png`；`backgroundColor=#F5F5F5` 在窗实证；`realRoot untouched=true`、electron 计数=0。
- 全仓 `pnpm -r test` 无红（desktop **704**=693+11；perf 首跑 1 红=负载瞬态，隔离复跑 **4/4 绿**，口径同 T53 案）；typecheck 0 错；双门禁 ✓；`SELFTEST OK`。
- ico 五层独立回读（PM 亲算，派发前已验一次，CB 测试又复现一次）：`[16,24,32,48,256]` 逐层 PNG 签名+IHDR 宽一致，2856 B。
- DEVIATION **D-1~D-8 全部追认**。特别：D-1 属**真缺陷修复**（0.3.0 包实测 resources/ 无 build/ → 旧包托盘一直是空图；四份补齐 4973B 无感）——打包后需按 D-1 请求实测 `<resources>/build/` 四文件在位（已写入 rc.28 冒烟清单）；D-2 合理（根 scripts/ 已直出 build 四份，无需桌面侧新脚本，任务书 §1.1 由 PM 撤回）；D-3 伴随文案收敛成立（token 未动、门禁复绿）。
- **rc.28 新增验证项**：装包冒烟必须开真托盘（溢出浮层法）确认像素猫可见。
