# TASK-T45-01 交付报告 · P3 加固：CSP connect-src 放行 127.0.0.1

> 执行：**PM（Hermes）亲自**——本单为**一行策略改动**，属轻量任务（按老板 09-20 分派规则：轻量任务不占长任务工位；且客户端更新后 CodeBuddy CLI 路径失效，见文末）。
> 提交：见 git log（fix(sec): T45-01 CSP ... rc.24）

## 1. 改动（唯一真源，逐字对比）

真源：`apps/desktop/src/renderer/index.html:14`（PM 全仓核对：`connect-src` 仅此一处）

**改前**
```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: attachment:; font-src 'self' data:; connect-src 'self' asset: attachment: ws://localhost:* http://localhost:*
```
**改后**
```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: attachment:; font-src 'self' data:; connect-src 'self' asset: attachment: ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*
```

**安全口径**：仅在 `connect-src` 追加两条 **127.0.0.1** 条目（与既有 `localhost` 条目**语义对齐**）：
- ✅ 未放宽任何其它指令（`default-src`/`script-src`/`style-src`/`img-src`/`font-src` **逐字未变**）
- ✅ 未引入通配 `*`、未整段放开 `http:` / `ws:`

## 2. 验收（本次已取得）

| 项 | 结果 |
|---|---|
| 全仓测试 | **1232 无红**（core 51 / platform 41+1skip / ui 79 / schema 3 / sync 109 / editor 197 / dbview 98 / importer 59 / desktop 595） |
| typecheck | 9/9 ✓ |
| `no-magic` / `build-tokens --check` | ✓ / ✓ |
| 重打包 | **0.3.0-rc.24**（93,432,844 字节） |

## 3. 真机判据（进行中）

任务书要求的决定性判据 = 复跑 `docs/mockups/probe-t38-multiturn.mjs`，使原 ③（端点可达）/⑭（console error=0）**转 PASS**。
本次已在 rc.24 构建后启动该探针（electron ABI 已就位、夹具隔离）；结果见 `_scratch/t45-probe.log` 与下文 §PM 复跑补充。
**真机结果：见下方 §PM 真机复跑（rc.24）——决定性判据已通过（console error 2 → 0）。本单标记为真机闭环。**

## 4. DEVIATION / 备注

1. **执行者变更**：原计划派 CodeBuddy，但 Hermes 客户端更新后 `codebuddy` CLI 在 PATH 与既有绝对路径均**不存在**（`command not found` + 两处候选路径缺失）→ 本单由 PM 直接执行（一行改动，符合轻量任务口径）。**长代码任务的分派通道需要恢复**，已登记为环境问题。
2. `asar` 解包工具（npx asar）本机不可用，故「打包产物内含新 CSP」未用解包方式验证 → 由真机探针（实际加载打包后的渲染层策略）间接证明；如需严格产物取证，另开小单。


## §PM 真机复跑（rc.24，决定性判据）—— **20 PASS / 1 FAIL，CSP 判据已通过**

**探针**：`docs/mockups/probe-t38-multiturn.mjs`（夹具隔离；electron ABI 已就位）；日志 `_scratch/t45-probe.log`

| 判据 | 改前（rc.23 前） | 改后（rc.24） |
|---|---|---|
| **⑭ renderer console error 计数 = 0** | **FAIL**（2 条 CSP 拒绝原文） | **PASS** ✅ `consoleErrors=0 []` |
| ⑭ pageerror = 0 | PASS | PASS ✅ |
| AI 本地端点真实对话 | — | **4 轮全 ok**：1944ms / 3582ms / 7526ms / 3288ms（main 侧 ai.log 原文） |
| ③ 端点可达且含目标模型 | FAIL（CSP 拦） | 端点 **200 可达** ✓（`via=node-probe`），但因**探针期望的模型 id 已不在列表**（老板把 LM Studio 加载模型换成了 `master`）→ 该项按**期望值过期**计 FAIL |

**结论**：CSP 加固的**决定性判据通过**（渲染层不再被拦：console error 由 2 → 0）。③ 的 FAIL 与本次改动无关，是探针内置模型期望值过期（LM Studio 现仅提供 `master`）→ 属**探针侧陈旧期望**，不影响 CSP 结论。

**（PM 注）** 若要严格清零该项：把探针的 `EXPECT_MODEL` 改成「接受任意可用模型 id」，或改成读取 `/v1/models` 后取首个 —— 属可选清理，不阻断。

