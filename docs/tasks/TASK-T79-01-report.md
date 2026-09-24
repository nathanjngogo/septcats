# T79-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T79-01.md` · PRD：`docs/PRD-R27-页面导出.md`

## §0 开工侦察结论

- ① markdown.ts 解析器对 toggle/table/todo/callout 实际可识别语法（序列化方言据此定）：
- ② diag:export 落盘确认流与 zip 打包实现（复用同款）：
- ③ image file_id→磁盘路径解析函数与 media 表结构：
- ④ 页面级菜单宿主链与 scope 对话框既有范式（reveal 方案合规性）：

## §1 交付概览（DoD 自检）

- [ ] A serialize.ts（14 块型全覆盖、纯 TS 零 electron）
- [ ] B page:export IPC（scope/子树目录层级/附件拷贝+内链改写/预览→确认落盘/全只读）
- [ ] C 页面菜单入口 + scope 对话框 + toast（reveal 方案按 §0-④）
- [ ] D i18n zh/en 成对
- [ ] roundtrip 双向 14 块型钉 + 附件 tmp 夹具测 + scope 纯函数测 + IPC 取消不落盘测
- [ ] testid 契约 5 名挂齐

## §2 用例计数

（CB 填）

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| （无则写「无」） | | | |

## §4 文件改动清单

（CB 填）

## §5 红线自检

- [ ] op-log 零新增；不建表不加依赖（zip 选型记 §0）
- [ ] 菜单/对话框全 token；媒体库只读（拷贝非移动）
- [ ] T78 多选/手柄链零破坏（bulk 回归测在）
- [ ] 禁「数据库」词零回归；无省略号占位；启动零外联

## §6 门禁原始输出

（CB 贴：typecheck / desktop vitest / editor vitest / ui vitest / no-magic）
