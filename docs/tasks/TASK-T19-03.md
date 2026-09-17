# TASK-T19-03 · 协作（CRDT）落地 2/4：editor Yjs 绑定

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T19-02 已交付（HEAD `475b6bb`，开工 `git log -1` 确认）

## 0. 任务背景与目标

**目标**：将 T19-02 的 core `crdt_update` op 与 Yjs 绑定，实现**块内容实时协作**。  
**范围**：只动 `packages/editor`（Tiptap 编辑器集成）；不碰 sync/desktop/apps/ui/schema。

## 1. 实现要求

### 1.1 Yjs 引擎集成
- **Yjs 依赖**：`@yjs/yjs`、`@yjs/y-prosemirror`、`yjs`（按需，无冗余）
- **核心绑定**：`packages/editor/src/` 新增 `yjs.ts`（导出 `YjsEditor` 类）
  - 构造函数：`pageId: string`，注入 `ReplayReport.crdtUpdates`（从 T19-02 来）
  - 内部维护 `Y.Doc`，监听 `crdt_update` op，自动 apply 到 ProseMirror
  - 提供 `sync()` 方法：收集当前 Yjs 状态，生成 `crdt_update` op payload（base64 编码）

### 1.2 编辑器事件桥接
- **Tiptap 事件监听**：`yjs.ts` 监听 `editor.view.state.tr`（事务）
  - 事务触发 → 检测变更 → 生成 `crdt_update` op → 透传到 `packages/core`
  - **防抖**：连续事务合并为单 op（100ms 窗口，防高频小 op）
- **冲突处理**：`YjsEditor` 处理 Yjs 的 `update` 事件时，若检测到本地事务冲突，优先本地（CRDT 决胜由 core 保证）

### 1.3 数据流与状态同步
- **上行**：编辑器变更 → `crdt_update` op → `packages/core`（T19-02 已支持）
- **下行**：`crdt_update` op → `YjsEditor.applyCrdtUpdate()` → Tiptap 更新
- **状态隔离**：`pageId` 分区，跨 page 不干扰

### 1.4 测试要求
- **单元测试**：`yjs.ts`（Yjs 基础绑定、op 生成、冲突处理）
- **集成测试**：模拟双客户端同 page 编辑，验证 op 生成与同步
- **回归测试**：确保编辑器基础功能（撤销/重做/光标）仍正常

### 1.5 红线
- 不碰 `packages/core`、`packages/sync`、`apps/desktop`、`packages/ui`、`packages/schema`
- 不改 Tiptap 核心代码（只通过 Yjs 事件监听）
- 不新增依赖（除 Yjs 生态，需列明具体包名）

## 2. 交付物

| 文件 | 内容 |
|---|---|
| `packages/editor/src/yjs.ts` | YjsEditor 类，Yjs 与 Tiptap 绑定 |
| `packages/editor/test/yjs.test.ts` | 单元测试 + 集成测试 |
| `docs/tasks/TASK-T19-03-report.md` | 交付报告，含测试结果与性能数据 |

## 3. 验收标准

- ✅ 编辑器实时协作功能正常（本地变更 → op → 同步）
- ✅ 双客户端同 page 编辑无冲突（Yjs 决胜）
- ✅ 编辑器基础功能（撤销/重做/光标）正常
- ✅ 测试通过（单元 + 集成）
- ✅ 无回归（typecheck 全绿）

## 4. 注意事项

- **Yjs 版本**：使用最新稳定版（需在任务中指定版本）
- **性能**：op 生成防抖（100ms），避免高频小 op
- **错误处理**：Yjs 错误需捕获并记录（不影响编辑器功能）
- **兼容性**：确保与现有 Tiptap 插件兼容（如历史记录、协作光标）