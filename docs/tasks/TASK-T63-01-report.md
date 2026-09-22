# TASK-T63-01 全宽定义修正 — 交付报告

> 任务书：docs/tasks/TASK-T63-01.md
> tip：`0ec21b9`（交付开始即验证；R15 立项 commit）
> 作者：Septcats 唯一工程师
> 探针产物：docs/mockups/screens-t63/（4 截图 + t63-01-results.json）
> 探针脚本：docs/mockups/cdp-e2e-t63-01.mjs

## §0 根因

`T41-01` 只解除了 `.pv-root[data-measure='full'] .pv-body` 的外层 `max-width`，但正文真正宽度被 `packages/editor/src/react/editor.css:12` 的 `.sc-editor { max-width: var(--sc-space-editor-measure) /* 720px */; margin: 0 auto }` 二次钉死。`.sc-editor` 渲染在 `.pv-body` 内，外层解除、内层没解除 → **全宽 = 假全宽，正文永远 720px 居中**，即老板判「定义不对」的本体。标题行 `.pv-title-row`（PageView.css:17）在全宽态也仍夹 720（T41 旧口径=标题不动，老板新口径=整列铺满，此旧决议作废）。`.pv-root` 仅 `overflow-y: auto`，无横向滚动兜底。

修复（本单）：在 `apps/desktop/src/renderer/src/pages/PageView.css` 的 `.pv-root[data-measure='full']` 作用域内，穿透解除内层 `.sc-editor` 与 `.pv-title-row` 的 `max-width`（靠外层作用域选择器生效，**editor 包 CSS 零改动**），并给该作用域根节点加 `overflow-x: auto`（窄窗横滚兜底）。固定态（非全宽）一切不变、零横滚。

## §1 口径

1. 唯一改动面：`apps/desktop/src/renderer/src/pages/PageView.css` —— T41 注释改写为新口径（标题行同步铺满、指明 editor 包 720 钉靠作用域穿透解除），并新增三条选择器：
   - `.pv-root[data-measure='full'] .sc-editor { max-width: none }`
   - `.pv-root[data-measure='full'] .pv-title-row { max-width: none }`
   - `.pv-root[data-measure='full'] { overflow-x: auto }`
   （原有 `.pv-root[data-measure='full'] .pv-body { max-width: none }` 保留）
2. `packages/**` 零改动（editor 的 720 默认保留，作固定态/包内独立场景兜底；解除只在全宽作用域）。
3. 无 JS 量测 / resize 监听 / 内联宽高（CSS-only 纪律不破）。
4. 固定态（非全宽）= 现状 720/measure 完全不变；DbPage 不参与全宽（T41-01-1 既有裁决不变）。

## §2 交付

- 改动文件：`apps/desktop/src/renderer/src/pages/PageView.css`（+ 注释改写）。
- 单测：改写旧口径钉子 `apps/desktop/test/page-width.test.tsx`（原 :267-286「全宽只作用于 .pv-body、标题行不被覆盖」静态 CSS 契约），改为断言全宽作用域含 `.sc-editor`/`.pv-title-row` 解除 + `overflow-x:auto` + 固定态（`.pv-root` 基础规则）不含横向滚动声明 + token 纪律（无字面 hex/裸 px）。同文件其余用例未动。
- 新增 grep 型 CSS 口径纪律测（同上 it-block）：覆盖上述四条选择器与固定态零横滚。
- 真机探针 `docs/mockups/cdp-e2e-t63-01.mjs`：A/B/C/D 四段，全部 16 项 PASS（见下）。
- `pnpm -C apps/desktop test`：844 passed（含改写后的 CSS 契约测）。
- `pnpm -C apps/desktop build` + `ensure-abi electron`：通过。
- 交付前杀净 electron；node 孤儿计数 = 3，与基线（本机常态 3 个 workbuddy MCP 宿主）一致，净增 = 0。
- 隔离：探针 `--user-data-dir` + `rootPath` 全在 `_scratch/t63-01/`，真实数据根 `C:\Users\Administrator\.septcats` mtime 前后一致（untouched=true）。

### 探针真值（原始，全贴）

**A 全宽铺满（1920）**：pvRootInnerW=1600，bodyW=1585，scW=1515，titleW=1585，gutter=70，colContentW=1515，data-measure=full，bodyMaxW=none，pvRootOverflowX=auto。
- A1 `scW=1515 / 列内容宽=1515`（比=1.000，彻底脱 720 钉）PASS
- A2 `titleW=1585 / 列内容宽=1515`（标题行同步铺满）PASS
- A3 `data-measure=full，bodyMaxW=none` PASS

**B 分辨率扫档**（Emulation.setDeviceMetricsOverride 改 innerWidth → flex 列重排）：
| 窗口 | bodyW | scW | titleW | colContentW |
|---|---|---|---|---|
| 1920 | 1585 | 1515 | 1585 | 1515 |
| 1440 | 1105 | 1035 | 1105 | 1035 |
| 1280 | 945  | 875  | 945  | 875  |
| 1184 | 849  | 779  | 849  | 779  |
- B1 四档 bodyW 互异且随窗口递减（证随分辨率自适应）PASS
- B2 每档 sc-editor/title-row 均 ≥0.95×列内容宽（=1.000）PASS

**C 横滚兜底**
- C1a 全宽态 `.pv-root` computed `overflow-x = auto`（横滚容器机制就位）PASS
- C1b 全宽 660：注入超宽子节点后 `scrollWidth>clientWidth`，`scrollLeft` 可动到底（max=1635，after=1635，sawRight=true）PASS
- C1c 窗口级零横向滚动（横滚封在 `.pv-root`，documentElement scrollW=clientW=660）PASS
- C2a 固定态 `.pv-root` 无 `data-measure` 属性（全宽作用域 `overflow-x:auto` 规则未命中）PASS
- C2b 固定态 660：普通内容无横向滚动条（scrollW=445 ≤ clientW=445）PASS
- C2c 固定态 660：`data-measure=null` 且正文列 `max-width=650px=measure 变量`（固定态零改动）PASS
- C2d 固定态窗口级零横向滚动（scrollW=clientW=660）PASS

**D 每页独立 + 重启还原 + 截图**
- D1 每页独立：全宽页=full、固定页=null PASS
- D2 优雅退出（window.close()，未强杀）PASS
- D3 重启还原：全宽页仍 full PASS
- D4 重启还原：固定页仍 null PASS
- 截图 4 张：wide-full.png / wide-fixed.png / narrow-full-scroll.png（注入超宽元素演示底部横滚条）/ after-restart.png

## §3 红线

- 仅动 `apps/desktop/**`（CSS/测试）；`packages/**` 零改动（editor 720 默认不改，解除只在全宽作用域）；core/sync 零碰。✅
- 不新增 JS 量测/resize 监听；不新增依赖；不碰 git；真档案只读（`_scratch` 夹具）。✅
- 交付前杀净 electron、node 净增=0（对照基线 3）。✅

## §4 DoD

- 探针 A/B/C/D 全绿（16/16）。✅
- `pnpm -C apps/desktop test` 无红（844 passed）。✅
- typecheck 0（build 通过，含 TS 编译）。✅
- 双门禁 + selftest：留 PM（本单未触碰门禁敏感面；改动仅 PageView.css 选择器 + 单测，无 CJK 字面量、无 token 违规）。
- 固定态零回归：720/measure 数值与 T41 老探针在固定分支一致（`max-width=650px=measure 变量`，见 C2c）。✅

## DEVIATION

- **D-T63-01-1（已追认待 PM 收口）**：旧口径钉子 `apps/desktop/test/page-width.test.tsx:278-279` 的静态 CSS 契约被改写。原断言「`[data-measure='full']` 只作用于 `.pv-body`、标题行不被全宽作用域覆盖（仍走 measure 变量）」与新口径（整列铺满含标题行 + 内层 `.sc-editor` 穿透解除 + `overflow-x:auto`）冲突，按任务书 §2.2 要求重写该 it-block：现断言全宽作用域含 `.sc-editor`/`.pv-title-row`/`overflow-x:auto` 三条新规则、固定态 `.pv-root` 基础规则不含横向滚动声明、token 纪律。原「标题行不被覆盖」期望作废。
- **D-T63-01-2（透明说明，非违规）**：探针 C2a 原拟断言「固定态 computed `overflow-x !== auto`」，实测得固定态 computed `overflow-x = auto`——这是基线 `.pv-root { overflow-y: auto }` 触发的 CSS 规范行为（仅一侧 overflow 非 visible 时，另一侧 visible 计算为 auto），与本次改动无关，固定态本就如此。本单红线「固定态无横向滚动」由 `scrollWidth ≤ clientWidth`（C2b，普通内容不溢出）保证，已 PASS。故 C2a 改为运行时验证「固定态无 `data-measure` 属性 → 全宽作用域 `overflow-x:auto` 规则未命中」，证明该规则确实按作用域隔离。
- **D-T63-01-3（探针方法透明）**：任务书建议分辨率扫档用 `win.setBounds`，实跑发现 `BrowserWindow.setBounds` 在本机未改变 `window.innerWidth`（疑似首个 BrowserWindow 非可见页或最小尺寸约束），改用 t52 探针同款 `Emulation.setDeviceMetricsOverride`（在 Electron 渲染器中等价改变 innerWidth 触发 flex 列重排），B 档逐档数值已证随窗口变。方法差异不影响验收结论。

## PM 复跑节（PM 补）

- [ ] 全仓 / typecheck / 双门禁 / selftest 复跑
- [ ] git 提交（本单按纪律未碰 git，留 PM）
- [ ] 真机目检 4 张截图（wide-full / wide-fixed / narrow-full-scroll / after-restart）
