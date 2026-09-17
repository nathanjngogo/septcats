# TASK-T19-03B · 收尾补派：editor Yjs 绑定（修复 11 红 + 2 typecheck + 补报告）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T19-03 部分交付被中断（`c0756b9` 任务书提交后；HEAD 检查 `git log -1`）

## 0. 中断现场（PM 实测，勿重做已完成的）

你上一轮 T19-03 在收尾前被中断。已落盘、**不用重写**：

| 文件 | 状态 |
|---|---|
| `packages/editor/src/yjs.ts`（10.6KB） | 已落盘，结构完整（含 attach/detach/destroy/防抖/apply） |
| `packages/editor/test/yjs.test.ts`（14KB） | 已落盘，但 **11/20 红** |
| `packages/editor/package.json` + `pnpm-lock.yaml` | `yjs@13.6.32`、`y-prosemirror@1.3.7` 已加并装好 ✓ |
| `packages/editor/src/index.ts` | 已导出 ✓ |
| `docs/tasks/TASK-T19-03-report.md` | **未生成** |

## 1. 必须修复的现场（PM 复跑原文）

```
Test Files  1 failed | 8 passed (9)
     Tests  11 failed | 146 passed (157)
```

失败清单（全部在 `test/yjs.test.ts`）：
1. 单元·上行 op 生成：防抖窗口内连续本地增量合并为单 op → **`expected "spy" to be called 1 times, but got 0 times`**（`yjs.test.ts:123`）
2. 单元·上行：payload 可直接通过 core encodeOp/decodeOp/replay 链路收集
3. 单元·下行：远端增量不回灌生成 op（防回环）
4. 单元·下行：pageId 分区：跨页增量被忽略
5. 单元·下行：坏 base64 / 非法增量只记录不抛
6. 集成：本地编辑 → op → 对端 applyCrdtUpdate → 对端内容更新（双向）
7. 集成：并发编辑双端收敛
8. 集成：构造注入 crdtUpdates 冷启动：attach 即投影
9. 集成：B 端本地编辑不被远端增量回滚
10. 回归：撤销/重做正常且走上行通道
11. （同族）

`pnpm -C packages/editor typecheck`：
```
test/yjs.test.ts(339,30): error TS2339: Property 'undo' does not exist on type 'SingleCommands'.
test/yjs.test.ts(342,30): error TS2339: Property 'redo' does not exist on type 'SingleCommands'.
```

## 2. 你的任务（按序）

1. **先诊断失败 1 的根因**：本地 edit → 事务 → 为何 `onOp` 0 次调用？（怀疑方向：事务监听未挂在正确的编辑器实例上 / 防抖定时器与测试的 `sleep(FLUSH_WAIT_MS)` 不匹配 / `Y.Doc` update 回调未触发 / attach 顺序。）**根因在 `yjs.ts` 就修 `yjs.ts`；根因在测试就修测试**——不许用「放宽断言/删用例」让它变绿。
2. 修复 11 条红 + 2 处 typecheck：
   - `undo/redo`：Tiptap 未注册 Undo 扩展时无此命令。选一条正确路线（y-prosemirror 的 `YUndoPlugin` 给出 `undo`/`redo`；或改用 `editor.commands.command(...)`/直接调用历史 API），**并在 `yjs.ts` 里明确「撤销由 Yjs UndoManager 承载」的注释**（这是协作编辑器的正确语义：撤销要撤本地，不能撤别人的）。
   - 其余红：逐条定位，报出每条的真实根因（一句话）。
3. **补报告** `docs/tasks/TASK-T19-03-report.md`：交付表 / 修复前后原文 / 每条红的根因 / Yjs 版本与依赖理由 / 「撤销走 YUndoPlugin 而非 ProseMirror history」的决策说明 / PM 复跑节留「（PM 补）」。
4. 收尾自跑：`pnpm -C packages/editor test`（全绿）、`pnpm -r typecheck`（0 错）、`node packages/ui/tokens/no-magic.mjs`。

## 3. 红线（与 T19-03 相同）

只动 `packages/editor/**` + 报告。不碰 `packages/core`：**T19-02 已交付的 `crdt_update` 契约（`CrdtUpdatePayload{pageId,updateB64,svFromB64?}` / `ReplayReport.crdtUpdates[].target` / `opId` 去重）是既定接口**，如果 `yjs.ts` 与它对不上，改 `yjs.ts`，不改 core。不改既有测试语义（只许修 `yjs.test.ts` 自身的错误）。不新增依赖（yjs 生态已够）。不碰 git。

## 4. 最终回复格式

改动文件清单 + 每条红的**一行根因** + 修复后三条命令输出摘要 + Yjs 版本。