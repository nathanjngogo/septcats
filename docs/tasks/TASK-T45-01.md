# TASK-T45-01 · P3 加固：CSP `connect-src` 放行 `127.0.0.1`（与 `localhost` 对齐）

> PM：Hermes ｜ P3（真机验证中发现的加固项，非功能缺陷）｜ 可与任一低风险单合并派发
> 起因：T38-01 真机多轮探针（`docs/mockups/probe-t38-multiturn.mjs`）在**渲染层**直连 `http://127.0.0.1:1234` 被 CSP 拦下：
> ```
> Refused to connect to 'http://127.0.0.1:1234/v1/models' because it violates the following Content Security Policy directive:
> "connect-src 'self' asset: attachment: ws://localhost:* http://localhost:*"
> ```
> **应用功能未受影响**（AI 请求走 main 进程，不受该 CSP 约束；真实多轮/引用已在真机跑通）。本单只做**一致性加固**。

## 0. 第一步：定位 CSP 真源

PM 侦察：CSP 出现在渲染层响应头/文档策略（`connect-src 'self' asset: attachment: ws://localhost:* http://localhost:*`）。请先在仓库中定位其**唯一真源**（可能在 `apps/desktop/src/main/index.ts` 的 `onHeadersReceived`、或 `index.html` 的 `<meta http-equiv="Content-Security-Policy">`、或构建注入），确认是否**只有一处**；若多处，全部对齐。

## 1. 必须做到

1. `connect-src` 补 `http://127.0.0.1:*` 与 `ws://127.0.0.1:*`（与既有 `localhost` 条目**语义对齐**）。
2. **不得放宽其它指令**（`script-src`/`img-src` 等保持原样）；不得引入通配 `*` 或 `http:` 全开。
3. 若 CSP 在构建期注入/有多处，改成**单一真源**（避免将来再次不一致），并在报告说明。
4. 同步更新受影响的测试（若有断言 CSP 字符串的用例）。

## 2. 验收

1. 真机（独立夹具）：渲染层 `fetch('http://127.0.0.1:1234/v1/models')` **不再被 CSP 拦**（贴返回与 console 计数 = 0）。
2. 复跑 `docs/mockups/probe-t38-multiturn.mjs`：原 2 项 FAIL（③ 端点可达 / ⑭ console error = 0）**转为 PASS**，其余保持 PASS（贴新计数）。
3. 安全回归：断言 CSP 中**没有**新出现的宽松指令（贴修改前后 CSP 全文对比）。
4. 应用功能回归：AI 面板真实一轮对话仍正常（本地端点）；全仓无红；typecheck 9/9；双门禁 ✓。

## 3. 红线

- 允许动：CSP 真源所在文件（main 侧或 html 模板）+ 必要的测试。
- 不碰：`DESIGN.md`/tokens、`packages/**`（除非 CSP 真源在那，先报告）、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO。

## 4. 交付物

CSP 改动（附**修改前后全文对比**）+ 真机验证数值（新探针计数）+ `docs/tasks/TASK-T45-01-report.md`（PM 复跑节留「（PM 补）」）。
