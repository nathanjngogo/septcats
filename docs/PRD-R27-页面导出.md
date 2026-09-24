# PRD-R27 · 数据出门一期（页面导出 Markdown + 附件）

> 立项：PM（Hermes）09-24 · 基线 main `b99e3d4`（0.5.0 已发布）· 授权：老板「继续」
> 范围：T79（单页/子树导出 Markdown+资源 zip）。T80 便携包（§8.5/U5）记排队，本 PRD 不展开。
> 状态：✅ 09-24 收口（f137b92）——T79-01 交付 + T79-02 双缺陷修复；真机 T79 16/0、回归 T76 13/0+T77 9/0+T78 13/0；门禁 desktop 1140/editor 270/importer 99/ui 168/tsc 9/9/no-magic✓。

## 0. 侦察结论（现状=代码事实，09-24 grep 实证）

- **导出面现状**：`db:export:csv`（多维数据）、`diag:export`（诊断包）、`sync:exportRecovery`（恢复码）、工作台布局 JSON——**页面内容导出 = 零**。
- **可复用件**：`packages/importer/src/markdown.ts` 有 md→块解析器（M12/T76 刚加固：表格/折叠语法、窄口纪律）；**反向序列化器不存在**。
- **PLAN 欠账定位**：M4.5 明文「导出（Markdown/HTML/.zip 全库）」，至今只落了导入方向——本单补 Markdown 方向的页面级出口。
- **附件现状**：图片块 `file_id` 引用媒体库（`media` 表）；导出 zip 需要把 file_id 解析为磁盘文件并改写 md 内链。
- **T76 联动**：table/toggle 块刚上线，序列化器=它们的第二个消费端（读得出必须写得出）。

## 1. T79 范围

- **A 块→Markdown 序列化器**（`packages/importer/src/serialize.ts`，与解析器同包对偶）：
  - 覆盖全部 14 块型：paragraph/heading(1-3)/bullet/numbered/todo/quote/callout/divider/code(lang fence)/image(![]()+file 引用改写)/toggle（`> ` 折叠语法或 `- [ ]`? ——**按自家解析器能 roundtrip 的语法为准**，CB §0 侦察 `markdown.ts` 实际支持面定）/table（GFM 管道表，单元格内转义 `|` 与换行 `<br>`）；
  - **roundtrip 铁律**：`serialize(parse(md))` 与 `parse(serialize(blocks))` 双向往返测试，全部 14 块型各 ≥1 例（含嵌套列表、代码围栏内特殊字符）；无法无损表达的（如表头开关关闭态）记 §0 口径；
  - 纯 TS 零 electron import（对齐 `packages/core` 硬约束，node 直测）。
- **B 导出管线**（main 进程，按域拆文件范式）：
  - IPC `page:export`：入参 `{pageId, scope: 'single'|'subtree', dir}`；单页→`<title>.md`；子树→目录层级 + 每页 md + `files/` 附件；打包 zip 或落目录（**CB §0 侦察既有 diag:export 落盘确认流后对齐交互口径**：预览文件名→用户确认→写盘，禁静默写盘）；
  - 附件解析：image.file_id→媒体库磁盘路径→拷入包内 `files/` + md 内链改写为相对路径；孤儿 file_id（文件缺失）→md 留占位注释 + 预览清单列出（对齐导入器「不静默丢弃」纪律）；
  - 导出内容含新块=数据只读消费，op-log/库零写入。
- **C UI 入口**：页面手柄菜单（BlockControls 宿主链外的 **页面级** 菜单，与 T61 容器页菜单同源）加「导出为 Markdown…」；子页存在时弹 scope 选择（本页/含子页）；导出完成 toast + 打开所在目录（走 T73 openExternal 白名单通道——`file://` 不在白名单，用 shell 的 reveal 通道或记 §0 由 CB 侦察 electron shell.showItemInFolder 合规性）。
- **D i18n**：全部文案 zh/en 成对；中文禁「数据库」词纪律适用。

## 2. 红线
§16/R14/no-magic；不建表不加 npm 依赖（zip 用既有归档能力——CB §0 侦察 diag 打包用什么，同款复用；若无则 tar 内置能力或手写 store-mode zip，选型记 §0）；启动零外联；真实媒体库只读拷贝；op-log 零新增；testid 契约：`page-export-menu`、`page-export-scope`（对话框）、`page-export-confirm`、`page-export-toast`。

## 3. 验收
四门禁只增不减（基线 desktop 1111 / editor 254 / ui 168 / tsc 0 / no-magic）；roundtrip 双向往返 14 块型全钉；PM 真机探针：建含全块型+图片的页→菜单导出→子树 zip 落夹具目录→解包验 md 内容与附件文件在场→**导出物再走导入器反向 parse 回块（三方闭环：编辑器→md→解析器）**；零回归（BlockControls/PageView 接线动到 T78 多选，回归电池含 t78）。

## 4. 显性不做（记档）
HTML/PDF 导出（无既有渲染件，二期候选）；全库便携包（T80 排队，涉及段重放设计单开 PRD）；Notion 格式导出（自家 md 方言）；导出即分享（加密导出、链接分享全不做）；附件去重优化（一期按页拷，重复附件重复拷）。
