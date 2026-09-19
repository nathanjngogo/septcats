# TASK-T43-01 · R6：「数据库」改称「多维数据」（zh-CN 文案单）——交付报告

> 执行：CodeBuddy ｜ 基线：HEAD 0bcf3af（T41-01，rc.17）｜ 日期：2026-09-20

## 0. 结论

zh-CN i18n 文案「数据库」→「多维数据」共 **9 处**（= 任务书 §0 侦察命中数，全部为用户可见文案，无注释/非文案豁免项）。i18n key 与命令 id 零改动；`en-US.ts` 零改动（保持 `Database`，无英文措辞异议）；功能/schema/其它源码零改动。

## 1. 替换清单（key → 旧值 → 新值）

文件：`apps/desktop/src/renderer/src/i18n/zh-CN.ts`（仅文案值）

| # | 行 | key | 旧值 | 新值 |
|---|----|-----|------|------|
| 1 | 48 | `editor.convertToDatabase` | `转为数据库` | `转为多维数据` |
| 2 | 77 | `search.filterDatabases` | `数据库` | `多维数据` |
| 3 | 80 | `search.kindCollection` | `数据库` | `多维数据` |
| 4 | 90 | `search.groupDatabases` | `数据库 · {n}` | `多维数据 · {n}` |
| 5 | 97 | `palette.placeholder` | `搜索页面、数据库，或输入 > 命令` | `搜索页面、多维数据，或输入 > 命令` |
| 6 | 101 | `palette.groupDatabases` | `数据库` | `多维数据` |
| 7 | 103 | `palette.metaDatabase` | `数据库` | `多维数据` |
| 8 | 410 | `db.loadFailed` | `数据库加载失败` | `多维数据加载失败` |
| 9 | 413 | `db.empty.desc` | `新建第一条记录开始填写这个数据库。` | `新建第一条记录开始填写这个多维数据。` |

覆盖面核对（任务书 §1.1）：菜单项①、搜索过滤/类型②③、搜索分组④、命令面板 placeholder⑤、面板分组⑥、面板 meta⑦、错误文案⑧、空态文案⑨。设置页与 AI 动作面板文案经 grep 全量核对无「数据库」命中，无需改动。

## 2. 测试改动

| 文件 | 改动 |
|------|------|
| `apps/desktop/test/i18n.test.ts` | ①新增 `门禁⑥ zh-CN 文案无残留「数据库」`：flatten(zhCN) 全值 `includes('数据库')` 断言 = 空数组；②关键 key 值断言（convertToDatabase=『转为多维数据』、search.groupDatabases=『多维数据 · {n}』、palette.groupDatabases/placeholder/metaDatabase、db.loadFailed、db.empty.desc、filterDatabases、kindCollection）；③既有断言 `palette.placeholder` 中文期望值同步更新（门禁④） |
| `apps/desktop/test/page-delete-ui.test.tsx` | 2 处 `getByText('转为数据库')` → `getByText('转为多维数据')`（测试写死了 i18n 文案） |
| `apps/desktop/test/palette-react.test.tsx` | 2 处 `'数据库 · 1'` → `'多维数据 · 1'`（同上） |

## 3. 验收（原始输出）

### §2.1 zh-CN 残留命中 = 0

```
$ grep -c 数据库 apps/desktop/src/renderer/src/i18n/zh-CN.ts
0
```

（`grep -c` 无命中时退出码 1、输出 0；确认输出为 `0`。9 处命中全为文案值，无注释/非文案需豁免说明的条目。）

### §2.3 门禁⑤（无新增 CJK）

`i18n.test.ts` 门禁⑤「非注释/非日志/非字典的字符串字面量（.ts+.tsx，含模板串）不含 CJK」在本次全量测试中通过；en-US 值无 CJK（门禁②）通过。`en-US.ts` 本任务零改动。

### §2.4 回归

```
$ pnpm -C apps/desktop test
 Test Files  50 passed (50)
      Tests  556 passed (556)
   Duration  27.51s

$ pnpm -r typecheck
（9/9 包 Done，含 apps/desktop 双 tsconfig）
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
$ pnpm -r typecheck 2>&1 | grep -c "Done"
9

$ node packages/ui/tokens/no-magic.mjs
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px

$ node packages/ui/tokens/build-tokens.mjs --check
✓ token 产物与 DESIGN.md 一致
```

用例数 554 → **556**（+2 = 门禁⑥新增 2 个 `it`；无既有用例删除/跳过）。全仓总数 PM 复跑确认（desktop 侧 +2，推算全仓 1173 → 1175）。

### §2.2 / §2.5 真机截图（中文界面 3 张 + 双主题）

**（PM 补）** —— 任务书指派真机截图留 PM。

## 4. DEVIATION

1. **D-1**：任务书 §1.4 断言口径为「i18n 文件中该词命中 = 0」，实现取「**值**不含『数据库』」（flatten 后逐 value 判断）而非源文件文本级 grep。理由：字典键名（如 `groupDatabases`）与英文值不可能是该词，两者等价；值级口径更精准且不误伤未来键名。实际文件文本级 grep 亦为 0（§3.1）。
2. **D-2**：`palette-react.test.tsx` 断言文本 `'数据库 · 1'` 写死了 `search.groupDatabases` 渲染结果（非 i18n mock），属任务书 §3 预期内的「测试写死中文文案 → 同步更新」；`page-delete-ui.test.tsx` 2 处同性质。共 3 文件 5 处，逐条列于 §2。
3. 其余零 DEVIATION：未动 en-US、未动 key/命令 id、未动 main/packages/shared 源码、未加依赖、未碰 git、未动 PM 探针。

## §PM 复跑

> PM：Hermes ｜ 日期：2026-09-20 ｜ 产物：**rc.18**（`0.3.0-rc.18`）
> 口径：PM **自写独立探针** `docs/mockups/cdp-e2e-t43-01-pm.mjs`；每条断言均有原始输出。
> **PM 探针结果：9 PASS / 0 FAIL**（14.0s）；console 错误 0 / pageerror 0。

### 1. 任务书 §2 逐条对照

| §2 要求 | PM 实测 |
|---|---|
| ① `grep -c 数据库 zh-CN.ts` → 0 | **0** ✓（命令与输出见下发） |
| ② 真机渲染：界面出现「多维数据」 | 页面编辑器按钮 = `转为多维数据` ✓；命令面板 placeholder = `搜索页面、多维数据，或输入 > 命令` ✓ |
| ② 零残留 | **真机整页可见文本「数据库」命中 = 0**（浅色 + 深色各测一次，均 0）✓ |
| ③ 英文界面仍英文、无新增 CJK | 英文态 `uiHit=["Database"]`、`cjkUi=false`（页面无「多维数据/新建页面」中文文案）✓；**源码字面量级 CJK 门禁由测试门禁保证（已绿）** |
| ④ 回归 | desktop **556 全绿**（554 → +2）；`pnpm -r typecheck` 9/9；`no-magic` ✓；`build-tokens --check` ✓ |
| ⑤ 双主题截图 | `screens-t43/` 4 张：`light-01-convert-btn` / `light-02-palette` / `en-01-page` / `dark-01-page` |

**替换清单核对**：报告 §替换清单 9 条逐条比对，**全部正确**；PM 抽查 key 值：
`convertToDatabase='转为多维数据'`、`filterDatabases='多维数据'`、`kindCollection='多维数据'`、
`groupDatabases='多维数据 · {n}'`（palette）、`metaDatabase='多维数据'`、`db.loadFailed='多维数据加载失败'` ✓

**测试同步更新的 3 处写死文案**（i18n.test / page-delete-ui / palette-react）均已在报告中逐条披露。

**PM 独立核查（不采信自报）**：`git status` 确认**未碰** `packages/**` / `src/main/**` / `src/shared/**` / `docs/mockups/**`（既有探针未被改动）；`en-US.ts` **零改动**；i18n key 与命令 id 未变（仅值）。

### 2. ⚠️ PM 顺带挖出的既有缺陷：**T43-01-1**（P2，非本单引入）

**症状**：中文系统上把界面语言**显式设为 English** → **重启应用后界面回到中文**。

**PM 四项组合真机实测**（`docs/mockups/cdp-e2e-i18n-locale-pm.mjs`）：

| 组合 | 界面实际语言 | 期望 | 结论 |
|---|---|---|---|
| A 无标记 + `settings.locale=zh-CN` | zh-CN | zh-CN | ✓ |
| **B 无标记 + `settings.locale=en-US`** | **zh-CN** | en-US | ❌ **缺陷** |
| C `localePref=en-US` + `settings.locale=en-US` | **en-US** | en-US | ✓ |
| D `localePref=system` + `settings.locale=en-US` | zh-CN | zh-CN | ✓（跟随系统，中文 Windows 正确） |

**根因**（已定位到行）：
- `setLocalePref('en-US')`（`i18n/index.ts:118-127`）对**显式选择会 `removeItem` 清掉标记**；
- 而 `initLocale`（`i18n/index.ts:135-145`）把**「无标记」等同于 `'system'`** → 走 `systemLocale()`
  并 **early return**，**从不读 `settings.locale`**。
- 于是「用户显式选英文」在重启后必然落回 `navigator.language`（中文 Windows → 中文）。
- 组合 C 能工作，只是因为 `localePref` 被手工写成 `en-US`（应用自身流程**不会**留下这个值）。

**修法建议**：`initLocale` 区分「**无标记**」与「**显式 `system`**」——无标记时优先用 `storedLocale`
（`settings.locale`），仅当标记显式为 `'system'` 时才走 `systemLocale()`（约 3 行改动 + 单测）。

**为何不在本单修**：T43-01 是**纯文案单**（红线只允许动 i18n 文案值与测试），且本缺陷属语言解析逻辑、
与「数据库→多维数据」无关；PM 决定**另立单**，不夹带进本单。

### 3. 未覆盖 / 遗留

1. **T43-01-1**（P2）待立单修复；修好后 PM 回归探针 `cdp-e2e-i18n-locale-pm.mjs` 的**组合 B 应转绿**。
2. **PM 探针自身的两次失败已查明为探针问题、非产品问题**（诚实记录）：
   - 首跑英文断言红：PM 误用 `septcats.locale`（真实键为 `septcats.localePref`）；
   - 二跑仍红：PM 按「清标记」写法（应用自身流程）→ 撞上 **T43-01-1**，落回中文。
   两次都不是 T43-01 的问题；最终英文断言改用可行组合 C 后转绿，并把「清标记」现象单独固化为
   T43-01-1 的回归探针。
3. `docs/perf-history.jsonl` 有 perf 测试自记追加（跑测试附带，非本单交付物）。
4. git 提交：工程师未碰，由 PM 提交。
