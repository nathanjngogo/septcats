# T78-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T78-01.md` · PRD：`docs/PRD-R26-编辑器体验包.md` §2

## §0 开工侦察结论

- ① BlockControls 菜单开态与 onAction 宿主链（多选态最薄插法）：
- ② dnd.ts DropPlan 单块假设点 + 组拖最小改法：
- ③ 撤销链事务边界（批量=N op 同提交的 undo 口径）：

## §1 交付概览（DoD 自检）

- [ ] 选择模型（Shift+click 区间重算/Esc 清选/单块零回归）+ selection.ts 纯函数
- [ ] 批量动作（删/复制/转/色 = N 单块 op 同事务）+ 菜单变体
- [ ] 组拖拽（区间整体落位，单块拖拽零回归）
- [ ] T76 新块在批量删/转两路不炸（各有测）
- [ ] i18n 成对 + testid 5 名挂齐

## §2 用例计数

（CB 填）

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| （无则写「无」） | | | |

## §4 文件改动清单

（CB 填）

## §5 红线自检

- [ ] op-log v3 零新增类型（sync 109 / importer 59 零修改为证）
- [ ] 选择条/菜单变体全 token
- [ ] 禁「数据库」词零回归；无省略号占位
- [ ] 非连续多选/跨页多选零涉及（显性不做清单）

## §6 门禁原始输出

（CB 贴：typecheck / desktop vitest / ui vitest / no-magic）
