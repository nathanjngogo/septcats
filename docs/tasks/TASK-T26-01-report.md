# TASK-T26-01 交付报告 · 收尾两项残留：空库回落 demo 假内容 +「已同步」未英化（含门禁硬化）

> 工程师：CodeBuddy ｜ 前置确认：`git log -1` = `9ab001c`（任务书提交）✓
> 红线遵守：改动仅落在 `apps/desktop/src/renderer/src/**` 与 `apps/desktop/test/**`；未碰 `packages/**`、`shared/**`、`main/**`、CI/发布脚本；未加依赖；未碰 git。

---

## §A T24-01-1 空库回落 demo 假内容 → 空态

### 判据（§0 允许「自选」的两个口径中选了后者：直接移除兜底）

`PageView` 的 `DEMO_PAGE` / `buildDemoDoc` / `PAGE_ID`（`pg…demo`）/ `DEMO_IMAGE_SHA` / 内存账本 `ledgerRef` / `docState` 的 `'demo'` 态**整体删除**，而非给 demo 加启用开关。理由：

- 唯一生产调用方 `App.tsx:192` 是 `<PageView />`（无 `page` prop）——demo 路径在生产代码中本就不可达，是纯死代码；
- demo 常量含 9 处 CJK 字符串字面量，是门禁⑤的最大命中源；移除后门禁**无需为演示内容开白名单**，比「夹具根/演示开关判据 + 白名单」更干净、更不可逆；
- 「夹具/演示场景」的合理替身已存在：测试统一用 `vi.stubGlobal` 假桥 + 自己的 fixture 节点，不依赖 demo 页（修前已如此，无测试断言 demo 内容，见 §DEVIATION-7）。

### 修法

- `PageView.tsx`：`activePage` 变为 `PageViewPage | null`——无 `page` prop 且无选中页（空库/删掉唯一页/树未就绪）→ `null` → 渲染 `.pv-empty` 空态，不再回落 demo 假内容；加载/会话/touchRecent/协作 attach 各 effect 以 `activePageId === null` 守卫；`createSession` 去掉 demo 内存账本分支（commit 一律透传 `blocks:commit`）。
- 空态样式：`PageView.css` 新增 `.pv-empty`，与 `.trash-empty` / `.search-empty` 同 token 组合（`--sc-text-ui-sm` / `--sc-color-ink-faint` / `--sc-space-xxl` 居中留白），只用 `var(--sc-*)`，颜色走 ink-faint token，双主题天然成立；无图标需求，不涉及 `@septcats/ui` 图标出口。
- 文案走 `t('editor.emptyPage')`，两侧字典补键：
  - zh-CN：`还没有页面。在左侧栏「新建页面」，或从模板开始。`
  - en-US：`No pages yet. Use "New Page" in the sidebar, or start from a template.`

### 验收对应

- 新库删除唯一页 → `selectedId` 回落 `null` → 空态（无 demo 假标题/假正文）；
- `grep -rnE "DEMO_PAGE|buildDemoDoc|DEMO_IMAGE_SHA|pg…demo" apps/desktop/src/**` → 代码零命中，仅注释存留（PageView 头注释的移除史说明；`main/blocks.ts:7` 为禁碰区内的历史注释，无代码引用）。

---

## §B T25-01-1「已同步」未英化 + 门禁硬化

### 根因（真机 cjk=7 的两段因果）

1. **顶栏那颗钮不是 T13-01 的 i18n 钮**。`App.tsx` 顶栏渲染的是 `@septcats/ui` 的 `<SyncPill state="idle" lastSyncedAt="09:41" />`——一个静态假态组件，其 `STATE_LABEL` 映射（`已同步/同步中/待处理`）**硬编码在 `packages/ui/src/SyncPill.tsx`**。T13-01 交付的 `SyncStatusButton`（六态、全 `t()`、`sync.*` 键 zh/en 双语齐备）从未被接线，只被 `sync-ui.test.tsx` 直测。
2. **非 JSX 来源文案没有 locale 订阅面**。`SyncStatusButton` 的 label 全走 `t()`，但组件未订阅 locale 跃迁（App 顶层 `useLocale()` 不保证子树即时重取），切换后 label 停留在切换前快照。

### 修法（红线内唯一正解）

- `App.tsx`：`<SyncPill state="idle" lastSyncedAt="09:41" />` → `<SyncStatusButton />`（`packages/**` 红线禁碰，故改接线而非改 SyncPill；附带收益：顶栏从静态假态升级为真实六态 + 同步面板）。
- `SyncStatus.tsx`：`SyncStatusButton` 顶部补 `useLocale()` 订阅 → 切 English 顶栏即时变 `Synced · …`，切回中文复原。
- 键：**不新增**。`sync.stateOk/stateIdle/stateSyncing/...` 与面板全部文案 T13-01/T17-01 已双语齐备（`zh-CN.ts:288` `已同步` / `en-US.ts:302` `Synced`）——PM 预期的「补键」实际形态是「键已在、补接线」，见 §DEVIATION-1。

### 门禁⑤（硬化，`apps/desktop/test/i18n.test.ts`）

- 扫描面：`renderer/src/**`（`.ts` + `.tsx`）中**字符串字面量**（单引号/双引号/模板串，逐行提取、转义不跨界；语料内无跨行模板字面量）是否含 CJK（字符类沿用门禁②/③的 `CJK` 正则，含假名/汉字/谚文/全角形/CJK 标点）。命中即失败并列出 `文件:行 → 片段（含「X」）`。
- 豁免口径（白名单理由）：
  | 豁免 | 理由 |
  | --- | --- |
  | 注释（行/块/JSX `{/* */}`，经既有 `stripComments`） | 非运行时文案；工程注释中文是既有惯例 |
  | `console.*` 日志行 | 日志不是用户可见文案（沿用任务书口径） |
  | `renderer/src/i18n/` 整目录（字典 + `errorText()` 键引用表） | 文案本源按值受门禁②约束（en 值不得含 CJK）；`errorText()` 属键引用非文案，按 §0 指示按其值判定——值在字典里，②已覆盖 |
  | `*.test.*`（测试文件） | 断言文本非产品文案（任务书明示） |
  | demo 演示内容常量 | **白名单不再需要**——§A 已整体移除（任务书预设的「若保留则白名单」分支未触发） |
- 正则字面量（如 `ImportWizard.tsx` 的 `/单计划 (\d+) 个条目/`）不是字符串字面量，不在扫描面；该处是匹配 main 侧固定消息格式的协议耦合（T25-01 §0.B 口径：main 文案不动），非文案产出点。

### 门禁修前红 → 修后绿（原文）

修前（改动落地后、源码修正前，`pnpm -C apps/desktop exec vitest run test/i18n.test.ts`）：

```
× 门禁⑤ renderer 源码字符串字面量无 CJK（T26-01 硬化） > 非注释/非日志/非字典的字符串字面量（.ts+.tsx，含模板串）不含 CJK
  → expected [ …(17) ] to deeply equal []
+ "…\db\DbPage.tsx:30 → 未命名（含「未」）",
+ "…\db\DbPage.tsx:38 → preload 未注入 window.septcats.ai（渲染器无法调用模型）（含「未」）",
+ "…\db\DbPage.tsx:65 → ${property.name}：${text}（含「：」）",
+ "…\db\useDbPage.ts:33 → preload 未注入 window.septcats.db（渲染器无法访问数据层）（含「未」）",
+ "…\pages\PageView.tsx:65 → 暗物质探测实验笔记（含「暗」）",
+ "…\pages\PageView.tsx:83 → 本页汇总 LZ 类稀有事件探测的实验现状与文献线索。（含「本」）",
+ "…\pages\PageView.tsx:85 → 一、探测器矩阵（含「一」）",
+ "…\pages\PageView.tsx:89 → 整理 XENONnT 2025 SR 的 WIMP 上限图，录入阅读清单（含「整」）",
+ "…\pages\PageView.tsx:94 → 复核 LZ 核反冲效率曲线的统计误差来源（含「复」）",
+ "…\pages\PageView.tsx:99 → 口径提醒：各家实验的曝光量单位不同，制表前统一换算为 ton·yr。（含「口」）",
+ "…\pages\PageView.tsx:103 → 「稀有事件率本底是暗物质直接探测的终极限制。」（含「「」）",
+ "…\pages\PageView.tsx:110 → 低本底计数与屏蔽方案（含「低」）",
+ "…\pages\PageView.tsx:111 → 先统一单位，再制表（含「先」）",
+ "…\pages\PageView.tsx:115 → 图 1：排除曲线（待插入）（含「图」）",
+ "…\pages\PageView.tsx:468 → PageView：未知块操作 ${String(exhaustive)}（含「：」）",
+ "…\state\palette.ts:65 → preload 未注入 window.septcats（渲染器无法访问搜索通道）（含「未」）",
+ "…\sync\SyncStatus.tsx:185 → ${ariaLabel}（${view.label}）（含「（」）",
```

（17 处；其中 9 处为 demo 演示内容，随 §A 移除清零。）

修后：同文件 `10 passed (10)`，门禁⑤绿（下方 §自跑）。

---

## §自跑

| 命令 | 结果 |
| --- | --- |
| `pnpm -C apps/desktop test` | **37 files / 408 tests 全绿**（上轮 407 → +1 = 门禁⑤新用例；perf 红牌区 `rebuild 1576ms/5000`、`commitOps P95 12.4ms/16`、`冷首查 37ms/150` 均在预算内） |
| `pnpm -r typecheck` | 9 包全过（含 apps/desktop node+web 双 tsconfig） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 无字面 hex、无非 1px 重复裸 px |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ token 产物与 DESIGN.md 一致 |

全仓 / selftest / 重打包 / 真机（删唯一页→空态非 demo；切 English→顶栏无 CJK→切回中文；双主题截图）留 PM。

---

## §DEVIATION（逐条）

1. **B① 修法形态差异：换接线而非补键。** PM 预期「该文案改走 t()，补 zh-CN/en-US 键」；实际「已同步」硬编码在 `packages/ui/src/SyncPill.tsx` 的 `STATE_LABEL`（红线禁碰），而 renderer 侧 `sync.*` 键 T13-01 起双语已齐备。落地为 App 换 `SyncStatusButton` + 组件补 `useLocale()` 订阅，**零新增键**。附带语义变化：顶栏从静态假态（恒 `idle`、假时间 09:41）变为真实六态+面板——这是把 T13-01 已交付组件按其设计位置接线，非新功能。
2. **`SyncStatus.tsx:185` tooltip 拼接括号全角→半角**（`（label）` → `(label)`）。门禁⑤命中（全角形 CJK 标点）；组合文案的括号统一半角，中文 locale 下 tooltip 为 `同步状态 (已同步 · 1 分钟前)` 样式，可读性无损。
3. **`DbPage.tsx` buildUserContent 列分隔符 `：` → `: `**。门禁⑤命中；该字符串是发给 AI 模型的逐列上下文格式（非 UI 文案），半角冒号 locale 中立。连带 `test/dbview-ai.test.tsx:203` 断言按新语义调整（「列名: 值」结构不变，仅分隔符字形）——既有测试断言调整按红线要求在此登记。
4. **三处 renderer 内部诊断 `throw new Error` 消息中→英**（`DbPage.tsx:38` / `useDbPage.ts:33` / `palette.ts:65` 的 `preload 未注入…`）。门禁⑤命中且 PM 白名单枚举未含「内部错误消息」；这些消息理论上可经 `errorText()` 未知码回落路径露出，英化同时满足门禁与「用户可见文案不含 CJK」。无测试断言其原文。
5. **`PageView.tsx` 未知块操作 throw 消息中→英**（`PageView：未知块操作 …` → `PageView: unknown block action …`）。同 4，开发者诊断，不可达分支。
6. **`PageView` 结构性连带**：`docRef` 类型 `BlockDoc` → `BlockDoc | null`（demo 初始文档移除后无构造期初值），`onDrop` 补空守卫；`docState` 初始 `'demo'` → `'loading'`。对真实页路径行为零变化（ready 态语义不变）。
7. **无既有测试断言 demo 页文案**（红线预检）：`page-delete-ui.test.tsx` 两处 `render(<PageView />)` 均先置 `selectedId`（走真实加载），demo 内容无测试依赖；`palette/sidebar/trash` 等处的「暗物质探测实验笔记」是测试自建 fixture 标题，与 demo 常量无关，未动。
8. **`page-delete-ui.test.tsx` 假桥补 `sync` 通道**。App 换真钮后，渲染 `<App />` 的测试假桥需含 `sync.status/onState/now/setEnabled`（`status → null` = 加载态），否则挂载即 TypeError。测试基建补齐，断言语义未动。
9. **测试规模 407 → 408**：+1 为门禁⑤新用例；其余既有用例断言语义不变（除 DEVIATION-3 的分隔符字形）。

---

## §PM 复跑（PM 补）

- 全仓 + selftest + 重打包；
- 真机：新库删除唯一页 → 正文区空态（非 demo）；切 English → 顶栏 `Synced · …` 无 CJK → 切回中文复原（顶栏现在是真的 SyncStatusButton：点开有面板/设备列表/立即同步）；
- 双主题四态截图（空态页、顶栏六态）。

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 990 无红（desktop 407→408 = +1 门禁⑤）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
重打包（0.3.0-rc.3）+ 真机 CDP（docs/mockups/cdp-e2e-t26-01.mjs，独立夹具根）→ ALL-PASS 7/7
```

| 环节 | 结果 | 证据 |
|---|---|---|
| 删唯一页 → 空态 | ✅ | `.pv-empty` 存在；文案「还没有页面。在左侧栏「新建页面」，或从模板开始。」 |
| 空态**无 demo 假内容** | ✅ | 无「暗物质探测」/「探测器矩阵」（demo 常量已整体移除，grep 代码面零残留） |
| English 整页零 CJK | ✅ | `cjk(剔除工作区名)=0` |
| **顶栏同步状态已英化** | ✅ | `Synced · Just now`（根因：顶栏原是 `@septcats/ui` SyncPill 静态假态、T13-01 的 `SyncStatusButton` 从未接线 → 已换接真实组件） |
| 切回中文 | ✅ | `cjk=45` 恢复 |
| pageerror | ✅ | 0 |

**登记 T26-01-1（小项，非 UI 文案缺陷）**：English 模式下残留的 5 个 CJK 字符=**默认工作区名「个人工作区」**——它是**建库时种进数据库的数据**（用户可改名），不属 UI 文案；严格说应由「创建时的 locale」决定种子名（en → `Personal Workspace`）。真机已把这条单独断言出来（②c：`差=5 字`），不混进 i18n 门禁。

**DEVIATIONS 追认（9 条，抽查核对）**：①以「换接线」而非「补键」修同步状态 ✓（更本质，修掉了从未接线的遗留）；②③全角标点→半角（含 `dbview-ai.test` 断言同步调整，属文案规范化）✓；④⑤诊断 Error 消息英化 ✓；⑧测试假桥补 sync 通道 ✓；**门禁硬化已按要求给出「修前红 17 处 → 修后绿」原文** ✓（这是本单最有价值的产出：扫非注释/非日志字符串字面量，防同类残留再漏网）。
