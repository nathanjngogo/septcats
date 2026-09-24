# TASK-T79-01 · 页面导出 Markdown + 附件（R27 唯一单）

> PRD=`docs/PRD-R27-页面导出.md`（必读全文）。基线 main `b99e3d4`（0.5.0 发布后）。
> 工作目录=主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖。
> 开工侦察四问先写报告 §0 再动工：
> ① `packages/importer/src/markdown.ts` 解析器对 toggle/table/todo/callout 的**实际可识别语法**（序列化器必须产出解析器吃得回的方言——roundtrip 以自家解析器为准，不抄外部规范）；
> ② `diag:export` 的落盘确认流与 zip 打包实现（复用同款；禁静默写盘）；
> ③ image `file_id`→磁盘路径解析函数与媒体库表结构（media 表只读）；
> ④ 页面级菜单宿主链（T61 容器页菜单在哪、往哪加「导出为 Markdown…」）与 scope 选择对话框既有范式（Dialog 组件 token 类名）。

## 范围（PRD §1 全量，摘要）
- **A `packages/importer/src/serialize.ts`**：blocks→Markdown，14 块型全覆盖；纯 TS 零 electron import；table 用 GFM 管道表（单元格转义 `|`/换行 `<br>`）；code 用 ```` ```lang ````fence（lang attr 消费端首次落地）；toggle 语法按 §0-① 定稿。
- **B main `page:export` IPC**：`{pageId, scope:'single'|'subtree', dir}`→md（+子树目录层级）+ `files/` 附件拷贝 + 内链改写；孤儿 file_id 占位注释+预览清单；zip 或目录按 §0-② 对齐 diag 交互（预览→确认→落盘）；对库/媒体**全只读**。
- **C UI**：页面级菜单入口「导出为 Markdown…」+ 子页时 scope 选择 + 完成 toast；「打开所在目录」若走外链通道必须协议白名单合规（file:// 白名单外=禁走 openExternal，按 §0-④ 定 reveal 方案或一期不做记 §3）。
- **D i18n** zh/en 成对；禁「数据库」词。
- **测试**：roundtrip 双向（serialize→parse→deep-equal + parse→serialize→deep-equal）14 块型各 ≥1 例含嵌套/特殊字符；附件拷贝与内链改写单测（tmp 夹具）；scope 树展开纯函数；IPC 契约测试（mock dialog 用户取消=不落盘）。

## testid 契约
`page-export-menu`（菜单项）、`page-export-scope`（对话框）、`page-export-single`/`page-export-subtree`（scope 选项）、`page-export-confirm`、`page-export-toast`。

## 红线
§16/R14/no-magic；op-log 零新增；不建表不加 npm 依赖（zip 复用既有能力，无则 §0 选型记档）；启动零外联；禁省略号占位；**T78 多选/手柄链零破坏**（BlockControls 若被触及，bulk 变体回归测必备）。

## 交付
报告 `docs/tasks/TASK-T79-01-report.md`（§0 侦察四问→§6 门禁）。门禁四件套原始输出（基线 desktop **1111** / editor **254** / ui **168** / tsc **0** / no-magic，只增不减）。收尾打印 `CB-T79-01-EXIT=0`。
