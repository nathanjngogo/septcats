# T79-02 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T79-02.md` · 背景：`docs/tasks/TASK-T79-01.md` + `docs/PRD-R27-页面导出.md`
> 落盘方式：只 Write/Edit，未碰 git（无 commit / 无 reset / 无 checkout）。
> 续跑说明：本单开工时工作树已有部分落盘（blocks.ts 分流、inputRules.ts 围栏、content.ts 反解、pageExport.ts 引用、pages-store.test.ts 的 exportDialog 初值），本轮**未重做这些已完成项**，只补 ④ 的收尾核验、测试与报告。

## §0 开工侦察结论

### ① `blockContentOf`（main/blocks.ts）与 `contentOfRow`（main/pageExport.ts）各自处理哪些 content 形态？逐行分歧点

现状（本轮核验后的**修复后**形态，pageExport 侧已无副本）：

| 行 | `main/blocks.ts` `blockContentOf`（唯一实现，已 export） | `main/pageExport.ts`（现为 `blockSpecOfRow`） |
| --- | --- | --- |
| divider / image | `return null`（不看 `content_json`） | 引用同一函数 → 同 |
| code | `return contentJson ?? ''`（纯文本 string，不 JSON 化） | 引用同一函数 → 同 |
| table | `normalizeTableContent(parseContentJson(...))` → `{rows,header[,colWidths]}` | 引用同一函数 → 同 |
| toggle | `normalizeToggleContent(parseContentJson(...))` → `{title,body}` | 引用同一函数 → 同 |
| 其余文本类 | `parseContentJson` 后 `isDocJson`（`type === 'doc'`）才透传 | 引用同一函数 → 同 |
| 解析失败 / 形态不符 | 文本类 → `EMPTY_PARAGRAPH_DOC`；结构化类 → normalize 兜底 | 引用同一函数 → 同 |
| image 资源适配 | 无（读路径不管附件） | 保留在本文件：`file_id`+磁盘 ext → `asset://<hash><ext>`、孤儿 → 占位注释 |

修复前的分歧点（两处**同口径复制**，这是缺陷 A 的根因）：

1. 两处的共同放行条件都是 `parsed.type === 'doc'`，而 table 的 `content_json` 是 `{"rows":[["格A","",""],["","",""],["","",""]],"header":true}`、toggle 是 `{"title":"折叠标题Q","body":[""]}` —— **顶层没有 `type:'doc'`**，一律落降级分支。
2. `blocks.ts` 版在 `contentJson === null` 时还区分了 code（`''`）与非 code（空段落 doc）；`pageExport.ts` 版是同一判定的复制件（注释自称「与 main/blocks.ts blockContentOf 同口径」），因此两处**同时**在 table/toggle 上丢内容：IPC 读到空段落 doc、导出写出 3×3 全空表。
3. 记账说明：`pageExport.ts` 是 T79-01 新建的**未跟踪文件**（`git status` 里为 `??`），`contentOfRow` 的原始文本未入 git，本轮无法 `git diff` 取证；其「只放行 doc」的形态按任务书 §A「根因（两处同口径复制，均只放行 doc）」记账。本轮已用全仓 grep 确认 `contentOfRow` **零残留**（`grep -rn "contentOfRow" --include=*.ts --include=*.tsx .` 无输出）。

### ② `blockContentSchema`（packages/editor/src/model.ts）允许的形态清单，与两实现的覆盖差异

`packages/editor/src/model.ts:138-144`：

```
blockContentSchema = z.union([pmDocSchema, z.string(), tableContentSchema, toggleContentSchema, z.null()])
```

即五种合法形态：PM doc（`type:'doc'`）/ 纯文本 string（code）/ 结构化 table / 结构化 toggle / null（divider、image）。

覆盖差异：

| 形态 | 修复前两实现 | 修复后 `blockContentOf` |
| --- | --- | --- |
| PM doc | ✅ 透传 | ✅ 透传（`isDocJson` 校验保留） |
| string（code） | ✅ 原样 | ✅ 原样（null → `''`） |
| table 结构化 | ❌ 降级空段落 | ✅ `normalizeTableContent` 归一 |
| toggle 结构化 | ❌ 降级空段落 | ✅ `normalizeToggleContent` 归一 |
| null（divider/image） | ✅ null | ✅ null |

### ③ `blocks.list` 消费方清单（渲染层重载、导出、其它）——统一实现后影响面

| 消费方 | 用法 | 统一后影响 |
| --- | --- | --- |
| `renderer/src/pages/PageView.tsx:384`（编辑器挂载/重载，唯一把 content 投影回 PM 的读方） | `blocks:list` → Block[] → 编辑器投影（`packages/editor/src/blocks.ts:118/128` 有 `case 'table' / 'toggle'` 分支） | **正向变化**：table/toggle 不再被读成空段落，重载后内容保留（这正是 PM 实锤的「IPC 降级空段落」同一根因） |
| `renderer/src/workbench/cards.tsx:887` → `firstTextOfBlock(content)`（cards.tsx:842） | 只取卡片摘要首行文本 | **零回归**：该函数防御式（`obj.content` 非数组即返回 null）。table `{rows:[["格A","",""]],header:true}` / toggle `{title:"折叠标题Q",body:[""]}` 都无 `content` 键 → null；修复前拿到空段落 doc（`{type:'paragraph'}` 无 `content`）→ 同样 null |
| `renderer/src/workbench/SaveTemplateDialog.tsx:66` → `extractPlainText(blocks)`（market.ts:239） | 模板种子正文 | **零回归**：同为防御式，`paragraph.content` 缺失 → `''`；修复前空段落也是 `''` |
| `main/lock.ts:412` `readBlocks`（锁页解密后） | 解密行 → `blockRowToBlock`（同一 `blockContentOf`） | 同步受益：解锁后的 table/toggle 内容同样不再丢 |
| `main/pageExport.ts:326` 导出 | `blockSpecOfRow` → `blocksToMarkdown` | **修复目标**：table 单元格文本、toggle title/body 进 md |

验证方式：① 新增 main 侧 6 形态单测（`apps/desktop/test/blocks.test.ts`）、② 新增导出侧「table 单元格文本进 md」「toggle title/body 进 md」两条真库用例 + `blockSpecOfRow` 与读路径同实现断言（`apps/desktop/test/page-export.test.ts`）、③ desktop 全量 1140 绿（含 `t76-blocks-ui`、`t76-content-blocks`、`t79-page-export-ui`、`pageview-blocks-ui` 等消费方用例）。

### ④ 围栏输入规则的触发时机（哪一帧命中）：`matchInputRule` 与 `applyInputRule` 的调用链实证

- 调用链：`createInputRulesPlugin()`（`packages/editor/src/rules/inputRules.ts:256`）的 `handleTextInput` → `applyInputRule(view, from, to, text)`（:120）→ 取 `before = parent.textBetween(0, from - blockStart)`，判定串是 `before + text`（:131）。**`handleTextInput` 在字符插入之前触发**，所以第三个反引号那一帧的判定串就是 `'```'` → `FENCE_RULE` 命中、`lang` 捕获为 `''` → 立刻转代码块，随后键入的 `python` 落进代码正文。这就是缺陷 B 的根因。
- 插件顺序实证（jsdom 里打印 `editor.state.plugins`）：`septcatsInputRules` 位于 **index 3**，早于按键映射类插件；Enter 帧由它先接管（实测 `handleKeyDown` 首个返回 true 的插件 index = 3、`key = septcatsInputRules$`），故「Enter 帧兑现」不会被 baseKeymap 的 splitBlock 抢走。
- 修复后：`applyInputRule` 对 `kind === 'code'` 直接 `return false`（不在文本帧兑现）；新增 `applyFenceEnterRule`（:212）挂在同一个插件的 `handleKeyDown`，与既有 `applyTableEnterRule` 同通道（`applyFenceEnterRule(view, from, to) || applyTableEnterRule(view, from, to)`）。

## §1 缺陷 A 修复

**统一实现的做法**：`content_json → content` 的唯一实现落在 `apps/desktop/src/main/blocks.ts:119` 的 `export function blockContentOf(type, contentJson)`；`apps/desktop/src/main/pageExport.ts` 删掉自带副本，改为 `import { blockContentOf } from './blocks'`（:27），在 `blockSpecOfRow`（:149）里直接调用。导出侧只保留自身逻辑：image 的 `file_id`+磁盘 ext → `asset://` 适配、孤儿占位、相对前缀改写。

**分流表（type → content 形态）**：

| type | content 形态 | 归一/降级 |
| --- | --- | --- |
| `divider`、`image` | `null` | 不看 `content_json` |
| `code` | 纯文本 `string` | `null` → `''`（不 JSON 化） |
| `table` | `{rows, header[, colWidths]}` | `normalizeTableContent`：rows 非字符串网格 → 默认 3×N 空表；`colWidths` 长度 ≠ 列数则丢弃 |
| `toggle` | `{title, body}` | `normalizeToggleContent`：title 非串 → `''`；body 非法/空 → `['']`（恒 ≥1 行） |
| 其余文本类 | PM doc JSON | `type === 'doc'` 才透传 |
| 解析失败 / 形态不符（文本类） | `EMPTY_PARAGRAPH_DOC` = `{type:'doc',content:[{type:'paragraph'}]}` | 不丢块，只丢内容 |
| 解析失败（table/toggle） | 同型空结构（见 DEVIATION-1） | 不丢块 |

**韧性**：`parseContentJson` 对 `null` / 空串 / `JSON.parse` 抛错统一回 `null`，调用方按类型分流；未知 type 走「其余文本类」分支（非 doc → 空段落）。损坏行不会让 `blocks:list` 或导出抛错，块仍然出场。

**配套（表格单元格往返闭环）**：`packages/editor/src/content.ts` 的 `splitTableCells` 已按**未转义** `|` 切分，并把导出方言的 `\|`→`|`、`<br>`→换行反解回来（serialize.ts 的 `escapeCell` 是正解），使「表格单元格含竖线/换行」在导出→导入往返里不丢字符。本轮未改 serialize.ts 的 Markdown 方言。

## §2 缺陷 B 修复

**方案选择**：**等 Enter 帧兑现**（不是「允许空格分隔」）。
理由：① lang 是「转块之后继续键入」的字符，只要兑现帧在文本帧，lang 必然被吞进正文——空格方案同样要放宽字符集、且 `'``` python'` 会带来新的歧义（用户可能真想写以空格开头的代码正文）；② 项目内已有同构先例：表格 shorthand `|a|b|` 就是 Enter 帧兑现（`applyTableEnterRule`），围栏走同一通道、同一 `RULE_EXEMPT_TYPES` 豁免、同一「保留原块 id」纪律，零新增机制；③ 判定器不删：`matchFenceRule` 仍是纯函数并被 `matchInputRule` 复用，既有 `'```'`/`'```ts'` 断言面不动。

**现行 ``` + Enter → 空 lang 行为不破的证据**：新增用例「真 PM：\`\`\` + Enter → codeBlock 空 lang（现行行为不破）」——`applyFenceEnterRule` 走插件真实 `handleKeyDown` 通道，断言 `firstChild.type.name === 'codeBlock'`、`attrs['lang'] === ''`、`attrs['id']` 保留、文档里零反引号。

**删除字符数与残留反引号断言**：
- 纯判定层：`matchFenceRule('```', false)` = `{kind:'code', lang:'', deleteChars:3}`；`'```python'` = `{lang:'python', deleteChars:9}`；`'```c++'` = `{lang:'c++', deleteChars:6}` —— `deleteChars` 恒等于判定串全长（含三个反引号与 lang）。
- 执行层：转换后 `firstChild.textContent === ''` 且 `state.doc.textContent.includes('`') === false` —— 即删除字符数覆盖了整串，零残留反引号。
- 尾随字符不误判：`'```python x'`、`'```py thon'`、`'``` python'`、`'````'`、`'``'`、`'```py!'`、`'a```py'` 判定全为 `null`；真机路径下 `'```python x'` + Enter 仍是段落。
- 完整手感链路：段落 `'``'` → 第三帧 `applyInputRule(view, from, from, '`')` 返回 `false`（不转块）→ PM 插入第三个反引号 → 键入 `python` → Enter → `codeBlock(lang='python')`、正文空。

**对既有 T77 语言栏路径无回归**：语言栏是「块已存在后改 `attrs.lang`」的路径，不经过输入规则；本单只改了「文本帧是否兑现 code 动作」与「新增 Enter 帧兑现函数」。`packages/editor` 全量 270 绿（含 T77 的 `code-image.test.tsx`）、desktop 全量 1140 绿（含 `t77-code-image-ui.test.tsx`）。

## §3 测试与门禁

**新增/修改测试文件与用例数**（本轮新增 18 例）：

- `apps/desktop/test/blocks.test.ts`（+8）：`blockContentOf` 六形态 —— 文本类 PM doc 透传 / code 纯文本（含 null→`''`）/ table 结构化（PM 真机夹具 3×3）/ table `colWidths` 齐列保留·不齐丢弃 / toggle 结构化 / divider·image 恒 null / 损坏 JSON·非 doc·空串降级空段落 / 结构化类型损坏 JSON 归一。
- `apps/desktop/test/page-export.test.ts`（+3）：`blockSpecOfRow` 与读路径同实现（table/toggle 结构化、image·divider null、code 纯文本、损坏 JSON 降级）；真库导出「table 单元格文本进 md（3×3 + header 分隔行，管道行共 4 行）」；真库导出「toggle title/body 进 md（`> [!toggle] 折叠标题Q` + `> 正文行R`）」。
- `packages/editor/test/rules.test.ts`（+7）：围栏判定命中与 `deleteChars`、尾随字符/空格分隔/组合期不误判、`\`\`\`python`+Enter 落 lang 且零残留反引号、`\`\`\``+Enter 空 lang 不破、第三帧不兑现 + 完整键入链路、尾随字符真机不转块、`|a|b|`+Enter 仍走 table（T76 语义不破）。

**门禁原始输出**：

```
# desktop（apps/desktop：先 node scripts/ensure-abi.mjs node 保障 Node ABI）
 Test Files  104 passed (104)
      Tests  1140 passed (1140)
   Duration  29.39s

# editor（packages/editor）
 Test Files  15 passed (15)
      Tests  270 passed (270)

# importer（packages/importer）
 Test Files  5 passed (5)
      Tests  99 passed (99)

# ui（packages/ui）
 Test Files  33 passed (33)
      Tests  168 passed (168)

# typecheck（pnpm typecheck → pnpm -r）
packages/core typecheck: Done
packages/platform typecheck: Done
packages/ui typecheck: Done
packages/dbview typecheck: Done
packages/editor typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done      （tsc -p tsconfig.node.json 与 tsconfig.web.json 双份，0 error）

# no-magic（pnpm --filter @septcats/ui lint:magic）
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

**与基线对比（只增不减）**：desktop 1129 → **1140**（+11）；editor 263 → **270**（+7）；importer 99 → **99**；ui 168 → **168**；tsc 0 error → 0 error；no-magic ✓ → ✓。无跳过、无 xit、无删除既有用例。

## §4 DEVIATION 记录（偏离任务书之处，逐条给理由）

- **DEVIATION-1**：结构化类型（table/toggle）的**损坏 JSON** 归一为「同型空结构」（`defaultTableContent()` / `defaultToggleContent()`），而非任务书 §1.2 末句写的「降级为空段落」。
  **Why**：任务书 §1.2 同时给了「可用 `normalizeTableContent` 归一」与「解析失败 → 降级为空段落」两句，对结构化类型二者互斥。空段落 doc 虽然 schema-legal，但对 table/toggle 是**形态不符**的降级：编辑器投影与导出都按结构化读，喂一个空段落等于把块显示成空白段落，比「同型空结构」更丢语义。
  **How to apply**：语义与任务书一致（不丢块、只丢内容）；口径差异已在新用例里钉死（`blockContentOf('table','{坏了')` = `defaultTableContent()`）。若 PM 要求严格按字面降级为空段落，改 `blockContentOf` 的 table/toggle 两支为「parse 失败 → EMPTY_PARAGRAPH_DOC」即可，一处改动。
- **DEVIATION-2**：围栏修复选「Enter 帧兑现」而非任务书举例的「允许空格分隔」。理由见 §2；未放宽 `FENCE_RULE` 字符集（`[A-Za-z0-9_+#-]{0,32}` 原样），故 `'``` python'`（带空格）**不**触发——与现有判定集零冲突。
- **DEVIATION-3**：`applyInputRule` 对 `kind === 'code'` 显式 `return false`，但 `matchInputRule` 仍保留 code 分支。这是**有意的不对称**：判定面（既有 `'```'`/`'```ts'` 断言）不动，只把「执行」从文本帧移到 Enter 帧。若后续有人只看 `matchInputRule` 会误判行为，已在 `inputRules.ts` 顶部注释与 `matchFenceRule` 文档注释里写明。
- **DEVIATION-4**：新增的导出用例用 `executor.run('block.upsert', { id, page_id, type, content_json, … })` 直接插块，不经 `commitOps`。**Why**：本单只验读路径分流，且红线要求 op-log 零新增；经 commitOps 会在测试库里写 op_ledger，与既有导出用例「op_ledger 零变化」的口径冲突。
- **DEVIATION-5**：`pageExport.ts` 的 `blockSpecOfRow` 以 export 形态被单测直接引用（原先只服务内部）。**Why**：任务书 §1.1 要「单一实现」，只有直接断言它才证明导出侧与 `blocks:list` 同源，而不是靠人眼读代码。

## §5 遗留与观察项

- **`blocks:list` 的另两个消费方仍是「丢文本」状态**（不是本单回归，是既有行为）：`firstTextOfBlock`（cards.tsx:842）与 `extractPlainText`（market.ts:239）都只认 PM doc，table/toggle 现在拿到结构化对象后仍抽不出文本（与修复前的空段落一样是空）。若要「最近页卡片/模板种子」能摘到表格与折叠的文字，需在这两个抽取函数里加结构化分支——**建议单独立单**，本单不动（越界不碰）。
- **围栏与表格同帧互斥**已验（`|a|b|` 必以 `|` 起收，`\`\`\`` 必以反引号起），但若将来再往 `handleKeyDown` 加第三条 Enter 规则，需重新审视顺序（`applyFenceEnterRule || applyTableEnterRule` 的短路语义）。
- **`\`\`\`lang` 的长 lang（>32 字符）不触发**：沿用 `FENCE_RULE` 既有上限，未放宽；真机暂无此诉求。
- **真机探针**：本单为纯逻辑 + 单测门禁，未跑真机 CDP；PM 真机复验建议两条——① 新建 table/toggle 块后导出，看 md 是否带单元格文本与折叠标题；② 键入 `\`\`\`python` + Enter，看代码块语言栏是否显示 python。
- **better-sqlite3 ABI**：跑 desktop 测试前需要 `node scripts/ensure-abi.mjs node`（本轮已执行，native 模块现为 Node ABI）；若要接着跑 electron 真机，需先 `node scripts/ensure-abi.mjs electron` 切回。
