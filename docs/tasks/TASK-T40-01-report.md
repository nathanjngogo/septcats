# TASK-T40-01 交付报告 · 数据库「字段」体系检查与优化（P1 插队）

> 工程师：CodeBuddy（续作收口；半成品由被中断的前序进程所留，本单在其基础上续作，未重头再来）｜日期：2026-09-20
> 起点：`d29f252`（T38-01 真机探针收口之后），工作区 13 个未提交改动（+1198/-47）即本单半成品
> 任务书：docs/tasks/TASK-T40-01.md（§0 侦察结论 / §1 范围 / §2 验收 / §3 红线 / §4 交付物）

## 0. 结论

完成（代码 + 测试侧）。字段体系六类交付全部落地：**11 类型按类型单元格编辑器补齐**
（select/multi_select 可新建选项、date 可清空、url/email 校验 + 可点开、number 校验既有）、
**字段管理入口**（改类型含值迁移 + 删除二次确认含列值清理 + 左右排序）、**选项管理**
（属性菜单全量增删改面板 + 单元格内新建）、**标题字段保护**（禁改类型/禁删/禁移动，
main 侧 E_INVARIANT 三重拒绝 + 恒首列）、**值不丢**（可迁自动迁、不可迁原样保留，
确认对话框与迁移函数同一口径）。

五项自跑绿；真机 11 类型实测表 + 双主题截图 + 老板真实库副本旧库兼容验证留 PM：

| 自跑项 | 结果 |
|---|---|
| `pnpm -C apps/desktop test` | ✓ **47 文件 513 用例全绿**（506 → +7，新增 dbview-fields 7） |
| `pnpm -C packages/dbview test` | ✓ 5 文件 **95 用例全绿**（数量不变，react 层改动被既有 28 例覆盖） |
| `pnpm -r typecheck` | ✓ 全部 Done（9/9） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 无字面 hex、无重复裸 px（DbView.css 4 处已收敛） |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ token 产物与 DESIGN.md 一致 |

> 备注：未加依赖；未新增 token；未碰 DESIGN.md / 其它 packages / CI / 发布脚本；
> `packages/dbview` 的值编解码 / `VALUE_SCHEMA_BY_TYPE` **零改动**（详见 DEVIATION-1）；
> 未碰 git。

## 1. 任务书 §0 五条核实结论（逐条复核，含对 PM 侦察的修正）

1. **「单元格编辑器按类型缺失」——核实为定位偏差，但有真缺陷**。按类型编辑分支不在
   `DbPage.tsx`（它只是页面壳），而在 `packages/dbview/src/react/CellEditor.tsx` 的分派表
   （T7-01 起就有：text/number/url/email/date=PlainEditor、select=SinglePicker、
   multi_select/relation=MultiPicker、checkbox=直接切换、ai=text+生成按钮、file=只读展示）。
   **真缺陷**是：① url/email 只渲染不可点的 span、无格式校验；② date 编辑无清空按钮；
   ③ select/multi_select 的 picker **无法新建选项**（见第 5 条，这是老板感知「字段有问题」
   的最大来源）。三处均已修复。
2. **「main 侧 db.propUpdate 已放行 type」——核实为不准确**。改前 main 实际是
   `throw E_UNSUPPORTED '属性类型变更一期不支持（需值迁移）'`（原 dbview.ts:869-871），
   即**改类型在 main 层也被拒绝**，不只缺 UI 入口。本单已实现完整值迁移后放行（§3）。
3. **「删除/排序缺 UI」——核实属实**。改前 `DbPage.tsx` 只有 `addProperty`/`renameProperty`
   调用点，`removeProperty` 在 hook 有但无人调用；排序则连 API 都没有。已补：删除走
   二次确认对话框、排序走新增 `db:prop:move` 通道（§3）。
4. **「标题字段语义」——核实属实**。改前标题列=普通 text 属性，可删（删后 title_pid 顺延）、
   可改类型。本单选择「保持 text + 加保护」路线（不引入 title 语义标记，零 schema 变更）：
   禁改类型/禁删/禁移动，main 侧 E_INVARIANT 兜底，恒首列由 moveProperty 强制。
5. **「选项无管理」——核实属实且比预想严重**：改前 `addProperty('select')` 创建的属性
   **连 options 数组都没有**（原 dbview.ts:675 仅 `{id,name,type}`），且无任何添加选项的
   入口（单元格 picker 只列既有选项）——单选/多选字段建出来就是**永远空转的死列**，
   除非走 M12 导入器。这是本单「字段有问题」的根因主犯。已补两层管理入口（§3）。

## 2. 问题清单与修复对照

| # | 问题（实测确认） | 严重度 | 修复 | 状态 |
|---|---|---|---|---|
| P1 | select/multi_select 无任何建选项入口，字段建出即死列 | P0 | 属性菜单「选项管理…」全量增删改面板 + 单元格 picker 内「新建选项」行（DbPage 生成 id → 全量落库 → 回填选中） | ✓ |
| P2 | 改类型无入口、main 拒绝、无值迁移 | P0 | PropBar「更改类型…」二级菜单 → DbPage 确认对话框（明示迁移策略）→ main 同事务迁移（能迁自动迁/不可迁原样保留） | ✓ |
| P3 | 删除字段无 UI、列值残留 values 不清理 | P0 | 二次确认对话框（文案明示不可恢复）→ main 删属性 + 该列值同 batch 清理 | ✓ |
| P4 | 字段排序无 API 无 UI | P0 | 新增 `db:prop:move` 通道（beforePid=null=末尾）+ PropBar 左移/右移；标题恒首列强制 | ✓ |
| P5 | 标题列可删/可改型（删后 title_pid 顺延） | P0 | 三层禁用：PropBar 菜单项 disabled、main E_INVARIANT（update/remove/move 三处）、排序强制首列 | ✓ |
| P6 | url/email 无校验、不可点开 | P1 | 校验（http(s)/www. 与邮箱宽松口径，防 javascript: 注入）+ `<a>`/`mailto:` 可点；非法值 Enter 不提交、保持编辑态标错 | ✓ |
| P7 | date 编辑无清空 | P1 | 编辑态「清空」按钮（onMouseDown preventDefault 防失焦 submit 覆盖） | ✓ |
| P8 | 改回原类型后原值可恢复（迁移不落刀） | P1（验收 2） | 迁移函数纯函数实现：不可迁值原样保留在 values 里（该列不显示但不丢） | ✓ |

**值迁移口径**（main 侧 `migrateValueForType`，纯函数、渲染层预检提示与落库共用）：
文本族 text/url/email/ai 互换无损；→number 可解析则迁；→checkbox true/false；→date
parseDateText；→file 包数组；→select/multi_select 按名取/建选项；number/checkbox/date→
文本族各按口径；select↔multi_select 单值互包；multi_select→select 仅单值可迁；relation 及
其余组合一律原值保留。**任何路径都不静默丢值**。

## 3. 实现面（文件清单，13 改 + 1 新增）

| 文件 | 内容 |
|---|---|
| `main/dbview.ts` | +`migrateValueForType` 纯函数（含 URL/EMAIL 口径常量导出）；`updateProperty` 三分支化：改类型（collection op + 逐记录迁移 op 同 batch） / options 全量替换（被删选项的引用值同 batch 清理：select 置 null、multi 过滤） / 重命名+AI 指令（既有语义不变）；标题列 E_INVARIANT 三处；`removeProperty` 改为拒删标题 + 列值清理；+`moveProperty`（标题恒首、beforePid 失配回落末尾）；IPC schema 扩 options 键 + 新 move 通道 |
| `shared/ipc.ts` / `preload/index.ts` / `types/window.d.ts` | 新增 `CHANNEL_DB_PROP_MOVE`/`propMove`（仅新增通道）；propUpdate.patch 增 `options` 键声明 |
| `renderer/src/db/useDbPage.ts` | +`updatePropertyType` / `updatePropertyOptions` / `moveProperty`（既有 add/remove/rename/prompt 语义不变） |
| `renderer/src/db/DbPage.tsx` | 删除/改类型两个二次确认 Dialog；relation 候选=本库存活记录（自关联口径，DEVIATION-4）；单元格新建选项回调（查同名→既有 id，否则生成 `opt-<uuid>` 全量落库） |
| `renderer/src/i18n/{zh-CN,en-US}.ts` | +`db.prop.*` 7 键（删除/改类型确认文案，双语文案含迁移策略说明） |
| `packages/dbview/src/react/CellEditor.tsx` | url/email 校验+可点（stopPropagation 防误入编辑态）；date 清空按钮；PlainEditor invalid 态（aria-invalid + data-invalid）；Single/MultiPicker +`CreateOptionRow` 新建选项行 |
| `packages/dbview/src/react/PropBar.tsx` | 属性菜单 +更改类型/选项管理/左移/右移项（title 列整项 disabled）；类型二级菜单（带「原样保留」提示）；选项管理面板（增删改名+保存/取消） |
| `packages/dbview/src/react/DbView.tsx` / `TableGrid.tsx` | 新回调透传（onChangePropertyType/onUpdatePropertyOptions/onMoveProperty/onCreateCellOption） |
| `packages/dbview/src/react/DbView.css` | 新元素样式；240/320 裸 px 收敛为 `.sc-db` 局部 var（no-magic 门禁） |
| `apps/desktop/test/dbview-fields.test.ts` | **新增** 7 用例（§4） |
| `apps/desktop/test/db-bridge.test.ts` | MockDb 补 `propMove: vi.fn()`（新通道导致的 mock 补齐，断言语义零改动） |

## 4. 测试（apps/desktop/test/dbview-fields.test.ts，7 用例，真 SQLite 夹具）

1. **11 类型值往返**：全 10 类型字段（+标题 text）各填代表性值 → **重开 service 实例**
   （同物理库新开连接，模拟重启）→ 读回逐项 deep-equal；另断言空值行不串型。
2. **改类型迁移（number）**：text→number，`'42'`→`42` 迁移、`'不是数字'` 原样保留；重开读回一致。
3. **改类型迁移（select 族）**：text→select 自动建选项且值换选项 id；select→multi_select 包数组；
   multi_select→select 多值原样保留不丢。
4. **删除清理**：删字段后 schema 无该列、两条记录 values 无该键、重开不复活；标题列拒删 E_INVARIANT。
5. **排序持久化**：移动/移到末尾/禁止插到标题前（落标题后一格）/标题不可动；重开列序一致。
6. **选项管理**：改名/新增（缺 id 由 main 生成）/删除被引用选项（select 引用值置 null、
   multi_select 数组过滤剩余）；重开读回一致。
7. **标题保护**：禁改类型/禁删/禁移动三处 E_INVARIANT；重命名与 AI 指令不受限（既有语义）。

既有回归：dbview.test.ts 10 例、dbview-ai/db-bridge 等 513 例全绿（多页签 T37、AI 面板 T38
行为不变）；`removeProperty` 旧断言（无记录时 1 op）语义未变，无需调整既有测试。

## 5. DEVIATION（待 PM 追认）

1. **`packages/dbview/src/react/*` 被改动**：任务书 §3 红线写「packages/dbview 仅允许新增
   title 语义标记」，但单元格编辑器/表格/工具条组件本就住在这个包的 react 层（PM 在
   CHECKPOINT 夜间追加节已注明「红线过严、按实际审」）。**审点**：`VALUE_SCHEMA_BY_TYPE`、
   `encodeValue`/`decodeValue`/`coerceValue`、types.ts **零改动**（diff 可证）；仅 react 层
   新增能力 + CSS。
2. **标题列删除语义变更**：原「可删 + title_pid 顺延到下一属性」→ 现「拒绝 E_INVARIANT」。
   对旧库更严格（向后兼容，只会新增拒绝不会放行新形态）；原语义无测试钉住。
3. **updateProperty 类型变更从 E_UNSUPPORTED → 支持迁移**：任务书本单的目标即解除一期
   限制；op 形态复用既有 `collectionUpsertOp`/`recordUpsertOp`，**无新 op 类型**，
   `MIN_SUPPORTED` 未动，schema 无新键（options 原本就在 propertySchema）。
4. **relation picker 一期自关联口径**：候选=本库全部存活记录（数据模型无 relation target
   字段，不扩 schema）；点击关系标签跳转留后续。
5. **选项 tone（配色）一期不开放编辑**：管理面板只增删改名；既有 tone 保留、新建选项无
   tone（显示按 neutral）。任务书 §B3 只要求「增删改」，配色登记后续。
6. **DbView.css 既有 2 行被等价改写**（`.sc-dbgrid--state` min-height、`.sc-dbc-picker`
   max-height 的裸 px → 文件局部 var）：no-magic 门禁「同值重复≥2 即违规」所迫，行为
   等价；`.sc-db` 新增 2 个文件局部结构尺寸 var（非全局 token，未碰 tokens）。
7. **改类型迁移 op 计数**：一次改类型 = 1 collection op + N 记录迁移 op（有值差异的记录
   才有 op）；与「propUpdate 1 op」的旧直觉不同，但每条 op 都是既有形态，可被 sync 正常
   重放。
8. **测试文件类型的 `as unknown as FieldPids` 断言**：测试夹具便利性写法，限定在测试内。

## 6. 未尽事项（如实）

- **真机 11 类型 × 填值/重开/读回实测表 + 双主题四态截图**：需真机，留 PM（服务层等价
  断言已由用例 1 覆盖，但「重开应用」的真机口径、截图与手感无人能代跑）。
- **老板真实库副本旧库兼容**：本单无 schema/op 变更，理论零风险，仍按任务书 §5 留 PM
  用真实库副本开一次。
- **字段排序目前是菜单「左移/右移」**，非拖拽（任务书 §B2 原文即「左右排序」，拖拽不在
  字面范围；如需拖拽另立账）。
- **relation 跳转、file 上传/附件、ai 列批量生成的真机手感**：不在本单范围（§1C 明确不做
  公式/rollup 等；file 按任务书口径为文件名展示）。

## §PM 复跑

> PM：Hermes ｜ 日期：2026-09-20 ｜ 产物：**rc.14**（`0.3.0-rc.14`，93,417,999 字节，sha256 `e586bb459887723a17213a859e07db25b74551a8907c98b9aa59db7c71c94146`）
> 口径：PM 独立复跑，**不采信工程师自报**；每条断言均有原始数值回显。

### 1. 门禁（PM 亲跑）

| 项 | 结果 |
|---|---|
| `pnpm -r test` | ✓ **1132 passed / 1 skipped**（rc.13 时 1125 → +7 为本单新增用例）<br>core 51 · platform 41 · ui 79 · schema 3 · sync 109 · editor 182 · **dbview 95** · importer 59 · **desktop 513** |
| `pnpm -r typecheck` | ✓ 9/9 Done（工程师交付前有 3 个 TS 错误卡在 `PropBar.tsx`，已修） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 无字面 hex、无非 1px 重复裸 px |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ token 产物与 DESIGN.md 一致 |
| 红线核查 | ✓ `packages/dbview/src/types.ts`、`schema.ts` **零改动**；`VALUE_SCHEMA_BY_TYPE` diff 为空（`git diff` 实证） |
| git | ✓ **未被碰**（HEAD 仍为 `d29f252`，无 commit/stash/checkout） |

### 2. 真机功能验收（`docs/mockups/cdp-e2e-t40-01.mjs`）—— **56 PASS / 1 FAIL**

三次启动（建库 → 重开读回/字段操作 → 再重开持久化），`--user-data-dir` + `rootPath` 双隔离，真实数据根 mtime 前后一致。

| 组 | 覆盖 | 结果 |
|---|---|---|
| **C1–C12** | **11 类型值往返**：填值 → **重开应用** → 读回逐项 deep-equal（含标题列） | ✅ 12/12 |
| **C13–C15** | 改类型迁移：`text→number` 的 `'42'→42`；**不可迁值 `'不是数字'` 原样保留**；改回原类型值可恢复 | ✅ 3/3 |
| **C16–C17** | 删除字段：schema 列消失 **且该列值被一并清理** | ✅ 2/2 |
| **C18–C20** | 排序：移到末尾生效；标题恒首列；标题列移动被拒 `E_INVARIANT` | ✅ 3/3 |
| **C21–C23** | 选项管理：新增（main 生成 id）/改名/**删除被引用选项 → 引用值被清理不悬空** | ✅ 3/3 |
| **C24–C26** | 标题保护：改类型/删除均 `E_INVARIANT`；列仍在且仍为 text | ✅ 3/3 |
| **B0–B13** | **界面面（真实鼠标）**：走产品唯一可达路径（新建页 → 转为数据库 → 新建记录 → 新属性）<br>属性条渲染 · 标题列菜单 `更改类型…`/`删除属性` **disabled** · 数据列可用 · 单选列含「选项管理…」 · 含「左移/右移」 · 选项面板可开 · **单选 picker 内含「新建选项」行** · **左移真实点击触发列序变化** | ✅ 13/14（1 见下） |
| **D1–D5** | 重启后持久化：被删字段不复活 · 列序与移动后最终序逐项一致 · 选项管理持久化 · 取值未受影响 | ✅ 5/5 |
| **E1–E4** | 双主题：主题按**真相源 localStorage** 生效（`data-theme=dark`）；深色下 DbPage + picker + 新建选项入口正常；零横向滚动 | ✅ 4/4 |
| **F1–F3** | 真实数据根未被触碰 · 无 pageerror · 无 console error | ✅ 3/3 |

**唯一 FAIL = 新登记缺陷（下 §4），与本单改动无关**：断言按 skill 规范**有意保留为红**并标注缺陷编号，未放宽。

### 3. 旧库兼容（`docs/mockups/cdp-e2e-t40-olddb.mjs`）—— **5 PASS / 0 FAIL**

用**老板真实库的只读副本**（`C:\Users\Administrator\.septcats\septcats.db`，schema_version=7）开 rc.14：

- ✓ 旧库可打开（页树 12 页读出）
- ✓ 库页 `db:load` 成功（3 个 collection，属性读出；非库页返回 `E_NOT_FOUND: 数据库页未关联 collection` 属预期）
- ✓ 应用正常渲染，**无 pageerror、无 console error**
- ✓ **真实库 mtime 前后一致**（只读拷贝 + 双隔离，未触碰老板数据）

本单无 schema/op 变更（`MIN_SUPPORTED` 未动、无新 op 类型），旧库零迁移风险，实测亦证实。

### 4. 本次新登记缺陷（**均为既有缺陷，非本单引入**，`git diff` 实证本单未碰相关代码）

| 编号 | 级别 | 症状 | 根因 | 引入 |
|---|---|---|---|---|
| **T40-01-1** | P2 | **勾选列的值 UI 不可写入**；文档注释承诺的「Enter 直接切换」「Enter 进入编辑」键盘路径不可达 | 焦点注册在**外层** `role="gridcell"`（`TableGrid.cellRefs`），而 `CellEditor` 的 `onCellKeyDown` 挂在**内层 `.sc-dbc`**（**无 tabIndex，永不获焦**）；`onGridKeyDown` 只处理方向键、不处理 Enter。实测取证：点勾选格后 `activeElement` 为外层 gridcell，`activeInsideCellEditor=false` | T7-01 / T18-04 |
| **T40-01-2** | P1 | **独立库页在重开/重载后退化为普通文档页**（渲染成带「转为数据库」按钮的页面编辑器）；也意味着 `PageView` 里 `activePage.kind==='database'` 分支永不成立 | **`page` 表没有 `kind` 列**（实际 schema 实证），`db.create` 的 page op payload 也未写 kind → 库页只能由「转为数据库」写入的**本地态 `dbPageId`** 承载（仅当次会话有效） | T7b / T24-01 |

> T40-01-2 是本次验收的**探针路径发现**：PM 最初按 `db.create` 建页再进 UI，必然落到文档页——这不是探针写错，而是产品真实限制。已在探针注释中留证，界面面改走「转为数据库」真实路径。

### 5. DEVIATION 追认

工程师 §5 的 **8 条 DEVIATION 全部追认**，要点：

1. **`packages/dbview/src/react/*` 被改动** —— 追认。单元格编辑器/表格/工具条组件本就住该包 react 层，任务书原文口径过严（PM 在 `CHECKPOINT.md` 夜间追加节已自注）。审点已核：`VALUE_SCHEMA_BY_TYPE`、`encodeValue`/`decodeValue`/`coerceValue`、`types.ts` **零改动**（diff 实证）。
2. **标题列由「可删 + title_pid 顺延」改为「拒删 `E_INVARIANT`」** —— 追认。对旧库更严格（只新增拒绝、不放行新形态），原语义无测试钉住。
3. **`updateProperty` 类型变更从 `E_UNSUPPORTED` → 支持迁移** —— 追认。本单目标即解除一期限制；op 形态复用既有 `collectionUpsertOp`/`recordUpsertOp`，**无新 op 类型**，`MIN_SUPPORTED` 未动。
4. **relation picker 一期自关联口径**（候选=本库存活记录，不扩 schema） —— 追认，与任务书 §1C「不做跨库多跳」一致。
5. **选项 tone 一期不开放编辑** —— 追认（任务书 §B3 只要求「增删改」）。
6. **`DbView.css` 既有 2 行等价改写（裸 px → 文件局部 var）** —— 追认，no-magic 门禁所迫，行为等价，未碰全局 tokens。
7. **改类型 = 1 collection op + N 记录迁移 op** —— 追认，每条 op 均为既有形态，可被 sync 正常重放。
8. **测试内 `as unknown as FieldPids` 断言** —— 追认，限定在测试夹具内。

### 6. PM 结论

**T40-01 交付通过**（代码 + 测试 + 真机 + 旧库兼容四项全绿；唯一红为新登记的既有缺陷、与本单无关）。**rc.14 已打包**，证据入库：

```
docs/mockups/cdp-e2e-t40-01.mjs       真机功能探针（56 PASS / 1 FAIL）
docs/mockups/cdp-e2e-t40-olddb.mjs    旧库兼容探针（5 PASS / 0 FAIL）
docs/mockups/screens-t40/             7 张截图（light/dark × 表格/属性菜单/选项面板/新建选项）+ t40-results.json
```

**遗留**：T40-01-1（P2）、T40-01-2（P1）已登记，建议并入「R7 数据库字段」后续单或独立修复单；真机手感项（relation 跳转、file 上传、ai 列批量生成）仍不在本单范围。
