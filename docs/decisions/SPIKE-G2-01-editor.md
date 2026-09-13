# SPIKE-G2-01 · 编辑器选型：Tiptap vs BlockNote（决策门 G2 前置）

日期 2026-09-13 ｜ 决策人 Hermes（PM）｜ 数据 npm registry 实测（非记忆）

| 维度 | Tiptap 3.31.3 | BlockNote 0.54.2 |
|---|---|---|
| 发布 | 2026-09-04，活跃 | 2026-09-09，活跃 |
| 直接依赖 | core **0**、react 3、pm 13 | core **21**、react 9、mantine 2 |
| 样式体系 | 无绑定，自绘 | **绑 Mantine**（与 §16 tokens 单一来源冲突，需覆盖其主题层） |
| 块模型 | 自定义 Schema 完全自由（PM 节点规格 = 我们的 M3 块规范） | 预设块类型 + schema 扩展点，**绑架块模型命名** |
| Yjs 协同（Q5 二期） | 官方 @tiptap/extension-collab 一等支持 | 内置协同，但同样是 Yjs |
| 体量（估算） | 可 tree-shake 到最小 | 预置 UI 较重 |

## 结论：选 **Tiptap v3**，计划书 M4.1 按此实现。理由三条
1. **依赖洁癖**：core 零依赖，符合 §16 与"不装白名单外的包"纪律；BlockNote 的 32 依赖 + Mantine 是为"开箱 UI"付的税，而我们 UI 必须走自绘 token（§16.1），开箱 UI 反成负债。
2. **块模型主权**：M3 已定「真相是块模型，PM doc 是投影」（计划书 M4.1）。Tiptap 的节点/mark 规格让我们完全掌控这条映射；BlockNote 会先把它的 block schema 强加给我们，逆向改造成本 > 自研斜杠菜单/手柄。
3. **协同预留**：Q5 二期上 Yjs 时 `@tiptap/extension-collab` 是成熟路径，Op 的 `merge_policy` 字段与之正交。

## 代价与缓解
- BlockNote 免费送的手柄/斜杠菜单/选区工具条，我们要自建 → 已在 M4.3/M4.4 预算内（编辑器 25–32 PD 本就是最大单体）。
- spike 产物即 mockup 01-editor.html 展示的交互，已验证视觉可行。
- Plan B 保留：若 M4.7（IME/撤销映射）在真机连续 3 天阻塞，回评 BlockNote 的自绘主题层成本。

## 编辑器最终栈（写入 DESIGN/计划书附录）
`@tiptap/core` + `@tiptap/react` + `@tiptap/pm` + `@tiptap/starter-kit`（精简启用）+ `@tiptap/extension-code-block-lowlight`（代码高亮）+ CodeMirror 6 可选延后。图标 @phosphor-icons/react。
