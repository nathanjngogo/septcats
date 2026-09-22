# TASK-T56-01 交付报告 · P1：使用说明书（嵌入帮助菜单）

> 老板 2026-09-22 原话：「要做一份使用说明书，嵌入菜单栏的帮助里。」前置 T55-02 后派发。
> 开工锚点：`git log -1` → **26f66d4**（T55-02 接线收口）✓ 与任务书一致。
> 正文版权归 PM：`docs/manual/manual.zh.md` / `manual.en.md` **零改动**（`git diff` 为空）；本轮只做嵌入工程。

---

## 0. 一句话结论

说明书正文（PM 定稿，13 章）经 **vite `?raw` 构建期内联**进 renderer bundle（运行时零 fs、零网络），
渲染由**自写最小 Markdown 子集解析器**（纯函数，13 例单测）驱动，查看器为**应用内全屏像素风阅读视图**
（左锚点章表可折叠 + 右正文，全吃 T53 token）；入口两处（帮助菜单「使用说明书」+ 命令面板同名命令）已接线；
真机探针 **18 PASS / 0 FAIL**，三张截图落地，退出后 **electron 进程数 = 0**。

---

## 1. 交付物清单

| # | 类型 | 路径 | 说明 |
| --- | --- | --- | --- |
| 1 | 代码·内容通道 | `apps/desktop/src/renderer/src/manual/manualContent.ts` | `?raw` 内联两份 md（按 locale 取） |
| 2 | 代码·渲染器 | `apps/desktop/src/renderer/src/manual/markdown.ts` | 纯函数 md→块模型（标题/段落/列表/表格/行内码/代码块/链接/加粗） |
| 3 | 代码·查看器 | `apps/desktop/src/renderer/src/manual/ManualView.tsx` + `.css` | 全屏像素风阅读视图（左章表可折叠 + 右正文），零内联色 |
| 4 | 类型声明 | `apps/desktop/src/types/raw.d.ts` | `declare module '*?raw'`（双 tsconfig 均在 include 面内） |
| 5 | IPC 契约 | `apps/desktop/src/shared/ipc.ts` | `MENU_ACTIONS` 追加 `'helpManual'` |
| 6 | 菜单模板 | `apps/desktop/src/main/menuTemplate.ts` | Help 子菜单 = [使用说明书, separator, 关于 Septcats] |
| 7 | App 接线 | `apps/desktop/src/renderer/src/App.tsx` | `view` 状态机第四态 `'manual'` + `menu:action helpManual` 分支 + 面包屑 + 命令装配 |
| 8 | 命令面板 | `apps/desktop/src/renderer/src/palette/commands.ts` | `MANUAL_DEF`（id `app.manual`，deps 门 `openManual`） |
| 9 | i18n | `apps/desktop/src/renderer/src/i18n/{zh-CN,en}.ts` | `menu.helpManual` / `manual.*`(5 键) / `commands.app.manual` / `commandHints.app.manual` 双语 |
| 10 | 单测 | `apps/desktop/test/manual-markdown.test.ts`（13）、`manual-view.test.tsx`（8）、`menu.test.ts`（+2） | 共 **+23** 例 |
| 11 | 真机探针 | `docs/mockups/cdp-e2e-t56-01.mjs` | 18 断言 |
| 12 | 截图 | `docs/mockups/screens-t56/t56-zh-content.png`、`t56-en-content.png`、`t56-anchors-collapsed.png` | + `t56-01-results.json` |

**红线自查**：`packages/**` 零改动（`git status` 无条目；未动 `Icon.tsx`——现有 re-export 的 `CaretDown/CaretRight/X` 够用）；
`docs/manual/*.md` 零改动；未新增 npm 依赖（`package.json` 无 diff）；未碰 git（无 add/commit/push）；无 TODO；真档案只读（探针 `realRoot untouched=true`）。

---

## 2. 关键实现口径

### 2.1 内容通道（运行时零 fs 零网络）

```ts
import enRaw from '../../../../../../docs/manual/manual.en.md?raw';
import zhRaw from '../../../../../../docs/manual/manual.zh.md?raw';
export const MANUAL_SOURCES: Record<Locale, string> = { 'zh-CN': zhRaw, 'en-US': enRaw };
```

构建期把两份 md 内联进 `out/renderer/assets/index-*.js`——**产物内可直接搜到** `Septcats 使用说明书`（1 处）与
`Getting Started`，证明是在包里而不是运行期读盘。

### 2.2 章节切分与锚点

`parseManual()`：首个 `# ` → `title`，其余引言 → `preamble`，`## ` 切章 → `sections[]`。
章节 id = `section-N`（**按序、与语言无关**）——切 English 后锚点位置不跳位（单测钉住：两份文档 section id 序列逐一同构）。
真实语料：**13 章**（快速上手 / 页面与标签 / 块编辑器 / 数据库视图 / 搜索与命令面板 / 模板 / 导入与导出 / 同步（可选）/ AI 助手（可选）/ 设置 / 布局与窗口 / 键盘快捷键总表 / 常见问题），en 同构。

### 2.3 渲染器（自写子集，红线禁依赖）

仓内 `package.json` 无任何 markdown 库（已逐包 grep `markdown|marked|remark|mdast`：0 命中），故自写最小子集：
围栏代码块（含语言、内容原样，且块内 `##` 不切章）· 表格（表头 + 数据行，逐格再跑行内解析）· 有序/无序列表（不混流）·
标题（层级 + 稳定 id）· 段落（软换行折空格）· 行内码 / 加粗 / 链接（行内码优先级最高）。
`parseInline` 与 `parseMarkdown` / `parseManual` 均为纯函数，`node` 环境直测（不依赖 jsdom/React）。

### 2.4 查看器（T53 像素 token）

- 结构：`.manual-view`（顶栏 + `flex:1` 主行）→ `.manual-view__anchors`（`width: var(--sc-layout-sidebar)`）+ `.manual-view__content`（`overflow:auto`）。
  高度链闭合于 `.sc-shell__main`（1fr 定高）——**两栏各自滚动，窗口零滚动红线不变**。
- token：面板 `--sc-color-surface-raised` + `2px solid var(--sc-color-hairline-strong)` + `--sc-pixel-out`（按钮）/`--sc-pixel-flat`（活动锚点/代码块），
  折叠 = `display:none`（不占位，展开钮仍在顶栏可达）。**零字面 hex、零重复裸 px**（两门禁实测 exit 0）。
- 交互：锚点点击 → `scrollIntoView({block:'start'})` + `aria-current` 唯一高亮；Esc（window 级）/ 关闭钮 → `onClose()` → App 回 `editor`；挂载即聚焦视图根（键盘可达）。

---

## 3. 原始数值

### 3.1 `pnpm -C apps/desktop test`

```
Test Files  1 failed | 63 passed (64)
      Tests  1 failed | 726 passed (727)
```

唯一红牌 = `test/perf.test.ts > commitOps 200 块 batch P95 ≤16ms`（**并行负载抖动**）：

```
[并行首跑]  commitOps batch P95 26.2ms 超预算（expected 26.155… to be ≤ 16）
[隔离复跑]  [perf] commitOps 200 块 batch P95 = 13.4 ms （40 次采样，预算 16 ms） → Test Files 1 passed / Tests 4 passed (4)
```

与本任务改动无因果（本任务未触碰 db/perf 路径），口径同 T53/T55 旧例（见 D-5）。

**基线核对**：T55-02 收口 704 例 → 本轮 **+23**（渲染器 13 + 查看器 8 + 菜单 2）= **727**，满足「≥704+12=716」。

### 3.2 `pnpm -r typecheck`

```
Scope: 9 of 10 workspace projects
packages/{core,platform,ui,dbview,editor,schema,sync,importer} + apps/desktop → 9/9 Done（0 错）
```

### 3.3 双门禁

```
✓ token 产物与 DESIGN.md 一致          （exit 0）
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px（exit 0）
```

### 3.4 `pnpm -C apps/desktop selftest`

```
  FTS_RESYNC 2000 页全量重算耗时 18.0 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
PASS FTS_RESYNC 后重算页全部在索引中
SELFTEST OK
```

### 3.5 真机探针 `node docs/mockups/cdp-e2e-t56-01.mjs`（ABI=electron，先 `pnpm -C apps/desktop build`）

```
===== T56-01：18 PASS / 0 FAIL =====
realRoot untouched=true  electron 进程数=0
```

关键断言原始值：

```
G1-1 Help 子菜单 = [{"label":"使用说明书","type":"normal"},{"label":"","type":"separator"},{"label":"关于 Septcats","type":"normal"}]
G2-1 点菜单项 → manual-view 出现（clicked:使用说明书）
G2-2 crumb=使用说明书 editorCol=false      G2-3 docTitle=Septcats 使用说明书 anchors=13
G3-1 {"before":0,"after":1227,"active":"true","activeCount":1,"deltaTop":0,"heading":"数据库视图"}
G3-3 {"cls":"manual-view manual-view--collapsed","expanded":"false","navDisplay":"none"}
G4-1 {"manual":false,"editorCol":true}
G5-1 {"count":1,"found":true,"text":"使用说明书在应用内阅读使用说明书"}
G5-2 manualVisible=true
G6-1 Help = [{"label":"User Manual"},{"label":"","type":"separator"},{"label":"About Septcats"}]
G6-2 {"title":"User Manual","docTitle":"Septcats User Manual","hasGettingStarted":true,"anchors":13}
G7-1 {"gracefulExited":true,"forced":false}
```

### 3.6 交付后进程状态（杀净自起进程）

```
electron=0      （PowerShell Get-Process electron 计数）
wmic node.exe 命中 "electron|Septcats" 的进程 = 1 → 经 commandline 核对为**本会话 Agent 自身的 CLI 进程**（prompt 含 "Septcats"），
                 非探针遗留；探针 electron 树已 0 残留，无 node 孤儿。
```

---

## 4. DEVIATION（待 PM 追认）

- **D-1｜渲染器自写（非选型偏好）**：仓内无 markdown 库且红线「禁止新增 npm 依赖」，故按任务书 §1② 的后备方案自写最小子集；
  覆盖范围以两份实际语料为准（含表格与代码块）。单测 13 例（含真实文档结构不变量：章节数 13、id 同构、快捷键表 2×6）。
- **D-2｜「全屏」的落点 = 应用主内容区**：按 §1④「`view` 状态机新增 `'manual'`（editor/settings/import 同族）」，说明书在
  AppShell 主区渲染（侧栏/顶栏保留），未做覆盖整窗的模态。真机截图为准；若 PM 要「盖住侧栏」，属口径变更，可 10 分钟内改。
- **D-3｜图标经 `@septcats/ui` 的 `Icon` 包装**：首版直接使用 re-export 的 phosphor 组件并传 `size="sm"`（phosphor 的 `size` 是数字），
  真机截图暴露图标被放大到整屏；已改为 `<Icon icon={CaretDown} size="sm" />` 并重建复验。**`packages/**` 零改动**（复用既有 re-export，未追加）。
- **D-4｜切 English 的取证法**：`settings.patch({locale:'en-US'})`（原生菜单 label 由 main 权威读取，断言变 `User Manual`）
  ＋ `localStorage['septcats.localePref']='en-US'` 后 `page.reload()`（让 renderer 走与真实重启同一条 `initLocale` 路径取英文语料）。
  未走设置页 UI 点选（选择器脆、且需在说明书视图外多一次往返）；两条都是产品明示的用户动作。
- **D-5｜`perf.test.ts` 并行首跑 1 红**：`commitOps batch P95 26.2ms > 16ms`，隔离复跑 **13.4ms / 4 例全绿**。
  系满负载（64 个测试文件并发）下的抖动，与代码无关；口径同 T53-01 / T55-02 报告。
- **D-6｜工作树既有脏项（非本任务所改）**：`docs/tasks/TASK-T58-01.md`（+6 行）与未跟踪的
  `apps/desktop/scripts/render-svg-png.mjs` 在本轮开工前即存在；`docs/perf-history.jsonl` 的 +220 行是 perf 用例运行的
  **登记产物**（测试设计行为）。上述三项本任务未手工编辑，按「不碰 git」红线保持原样，归 PM 决定。
- **D-7｜快捷键不设**：菜单项**不挂 accelerator**（任务书 §1③「避免抢占」），入口仅菜单 + 命令面板两处。
- **D-8｜内容零改动 + 通道纪律**：`docs/manual/*.md` `git diff` 为空；`docs/mockups/screens-t56/` 与探针为新增文件。
  构建产物已复核含两份正文（`Septcats 使用说明书` / `Getting Started`）。

---

## 5. PM 复跑节（09-22 13:40，独立）—— **18 PASS / 0 FAIL**

- 亲跑 `cdp-e2e-t56-01.mjs`（build+ensure-abi electron 后）：原始输出 `===== T56-01：18 PASS / 0 FAIL =====`、`realRoot untouched=true`、`electron 进程数=0`。与 CB 自报一致。
- 全仓 `pnpm -r test` desktop **727**=704+23（首跑 perf 1 红 26.2ms；PM 隔离复跑 **15.0ms 4/4 绿**，口径同 T53/T55 案——并行满载抖动）；typecheck 0 错；红线 `packages/**`、`docs/manual/*.md`、package.json 零触碰（git status 实证）。
- DEVIATION **D-1~D-8 全部追认**。特别：D-2「全屏=主内容区（侧栏/顶栏保留）」**追认为产品口径**（帮助视图属应用内页，与设置同级；不是模态）；D-3 暴露的 phosphor `size` 数字坑在 T58 像素图标族统一消灭（像素 glyph 天然 16/20 两档）。
- 遗留小项（登记不阻塞）：说明书入口暂不挂 accelerator（D-7），若老板日后要快捷键一行即加。


```
（PM 复跑命令与原始输出）
```
