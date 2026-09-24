# T79-02 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T79-02.md` · 背景：`docs/tasks/TASK-T79-01.md` + `docs/PRD-R27-页面导出.md`

## §0 开工侦察结论

- ① `blockContentOf`（main/blocks.ts）与 `contentOfRow`（main/pageExport.ts）当前各自处理哪些 content 形态？逐行列出分歧点：
- ② `blockContentSchema`（packages/editor/src/model.ts）允许的形态清单，与两实现的覆盖差异：
- ③ `blocks.list` 消费方清单（渲染层重载、导出、其它）——统一实现后影响面：
- ④ 围栏输入规则的触发时机（哪一帧命中）：`matchInputRule` 与 `applyInputRule` 的调用链实证：

## §1 缺陷 A 修复

- 统一实现的做法（单一函数所在文件 / pageExport 改为引用）：
- 分流表（type → content 形态）：
- 韧性：损坏 JSON / 未知 type / 空 content 的行为：

## §2 缺陷 B 修复

- 方案选择与理由（等 Enter / 允许空格分隔 / 其它）：
- ```` ``` ```` 现行行为不破的证据：
- 删除字符数与残留反引号断言：

## §3 测试与门禁

- 新增/修改测试文件与用例数：
- 门禁原始输出（desktop / editor / importer / ui / tsc / no-magic）：
- 与基线对比（只增不减）：

## §4 DEVIATION 记录（偏离任务书之处，逐条给理由）

- 无

## §5 遗留与观察项

- （如：其它 blocks.list 消费方仍需后续加固的点）