# schema-v1 · Septcats 文档模型与事件规范（M3 定稿草案）

> PM 起草 2026-09-13 ｜ 状态：待 CodeBuddy 实现 M4 时逐块核对 ｜ zod 实现已在 packages/core/src/op.ts（本文件是它的字段级文档，两者冲突时**以 core 代码为准并回改本文**）。
> 真相层 = Op 事件流（不可变分段）；物化层 = SQLite（可重建）。本文件定义 payload 的**块类型词汇表**与**语义规则**。

## 1. Op 规范（core/op.ts 已锁定）

| 字段 | 类型 | 规则 |
|---|---|---|
| op_id | ULID(26) | 段内唯一，单调生成 |
| lamport | `{c:int≥1, d:ActorId}` | 全序键：先 c 后 d 字典序 |
| at | int(ms) | 墙上时间，仅展示，不参与任何判定 |
| actor | ActorId | == lamport.d（decode 时强校验一致） |
| target | `{table,id}` | table ∈ page/block/collection/record/schema |
| kind | upsert/delete/move/reorder/patch | delete ⇔ payload `{}` + 物化 alive=0 |
| payload | 对象 | upsert=整对象；patch=字段级差量（点号键不支持，一期整字段替换） |
| base? | int | patch 的期望基版本（=实体当前 version）；不等仅记并发信号，仍按 LWW（一期语义） |
| merge_policy? | 'lww' | Q5 预留；其它值 decode 拒绝 |

**不变量**：重放收敛（任意输入顺序 → 同一投影，fuzz 已证）；被 LWW 拒绝的 op 必入 `report.conflicts`（lost 版本素材不丢）。

## 2. 实体通用骨架（payload 顶层）
```
{ ...业务字段, alive?: 0|1 (缺省1), sort_key: string(base62, 同层兄弟内唯一) }
```
软删除：`alive=0`；30 天后 GC 任务物理清除（回收站语义，同步事件保留 tombstone 直至 retention 越限）。

## 3. 块类型词汇表 v1（9 种，M4.2 冻结集）

`type` 为判别键；`props` 恒为对象（块行为参数）；`content` 恒为 **PM 文档 JSON**（`{type:'doc',content:[...]}`，内联富文本容器）或 `null`。

| # | type | props 字段 | content | 备注 |
|---|---|---|---|---|
| 1 | `paragraph` | `{}` | PM doc | 默认块 |
| 2 | `heading` | `{level: 1\|2\|3}` | PM doc | 页 H1=page.title，块级标题从 H2 起？否：**允许块级 H1**（导入兼容），编辑器斜杠菜单给 H1–H3 |
| 3 | `bulleted_list` | `{}` | PM doc | 缩进层级 = parent 链，不存 level |
| 4 | `numbered_list` | `{start?: int≥1}` | PM doc | 同层序号由查询时计算，start 覆盖 |
| 5 | `to_do` | `{checked: bool}` | PM doc | |
| 6 | `quote` | `{}` | PM doc | callout = quote + props.icon（不另设类型，减一） |
| 7 | `code` | `{lang: string, wrap?: bool}` | 纯文本 string | 不走 PM doc；lang 自由串，渲染层降级 |
| 8 | `divider` | `{}` | null | |
| 9 | `image` | `{file_id: sha256(64), caption?: string, width?: int}` | null | 文件在 attachments 内容寻址存储 |

**内联 mark（content 内）**：`bold italic strike code link({href}) mention({ref:'page:'+id}) color({token})`。link href 白名单 `https?:// notion:// 站内 page:/#锚点`；`javascript:` 等拒。

二期词汇（已预留 type 命名位，v1 拒收并保留为 unknown 块）：`toggle callout(升级) bookmark table_simple equation ai_block`。**unknown 降级规则**：导入/收到未知 type → 转 `paragraph` + props 原样存 `_raw`，UI 灰显"不支持的块"，**不丢数据**。

## 4. 实体 payload 字段表

### page
| 字段 | 类型 | 规则 |
|---|---|---|
| workspace_id | id | 必填（Q4：单库分片） |
| title | string | 可空串；参与 FTS |
| icon / cover | string? | icon=emoji 或 'file:'+sha；cover='file:'+sha |
| parent_id / parent_table | id? / 'page'\|'workspace' | 根页 parent=null+workspace |
| sort_key | base62 | 兄弟序 |

### block
`page_id`、`workspace_id`、`type`、`props`、`content`、`sort_key`（均必填除标 ?）。**块永不跨页移动**（move 仅同页排序或改 parent 到子页 → 实为 page 操作），此约束大幅简化级联。

### collection
`page_id?`（独立 DB 页时 null）、`name`、`schema:{ properties: {pid:{name,type,options?,format?}} , title_pid }`、`views:[{vid,name,type:'table',filter,sort,widths}]`（type 预留 kanban/calendar 名位）。

### record
`collection_id`、`values:{pid: 值}`（值按属性类型：text string / number / select id / multi id[] / date {y,m,d,tz?} / checkbox bool / url string / file sha[] / relation id[]）+ `sort_key`。

## 5. 语义规则
1. **移动/拖拽**：`move` 改 parent；`reorder` 改 sort_key（core.sortBetween 生成）；**密集无解时整层重平衡** → 产生一批 reorder（≤2 次/千次拖拽，测试已证）。
2. **删除**：page 删 → 级联生成子树 tombstone（一次事务，N 条 delete）；record/collection 同理。
3. **撤销**：UI 栈记录"逆 op"（同 target，payload 取前值快照），不直接回滚 PM 事务；逆 op 是正常新事件（可同步）。
4. **冲突**：见 §1；冲突副本块 = 编辑器内插入 `type:'paragraph' props:{_conflict: kept/lost 对}` 特殊块，用户处置后删除（08 mockup 已定交互）。
5. **导入幂等**：`import_source(key)` 表，key=「相对路径+内容 sha」；M12 负责。
6. **schema_ver 协商**：段头携带；consumer > producer 拒收并提示升级；同 major 内只加列不加语义。

## 6. 版本与迁移
- `SCHEMA_VERSION = 1`（core 常量，段校验用）。
- 物化表列变更走 SQLite migration（migrations.ts 追加），**Op 格式变更才是大事**：需新 major + 双读窗口，本文件 §5.6 规则升级。
- 黄金样例：`packages/core/test/fixtures/`（由 M4 开工时补，覆盖 9 种块各一个标准 Op 序列）。

## 7. 未决（实现期裁决点）
- code 块 content 是否转 PM doc 统一（倾向：否，纯文本更稳）→ M4 实测定。
- mention 反链索引表（`mention(page_id,target_id)`）放 M5 建，schema 本文件已隐含字段。
- callout 与 quote 合并是否影响 01 mockup 视觉 → UI 层 props.icon 分支即可。
