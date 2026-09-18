# TASK-T28-01 · 🔴 P0：修复「编辑内容触发同步错误」（op 设备 id 硬编码）

> PM：Hermes ｜ 优先级 **P0（阻断 0.3.0 发布）** ｜ 前置：`docs/QA-巡检报告.md` 的 Q-1
> 实测环境：`0.3.0-rc.3` 真机，全新夹具根

## 0. 症状与根因（PM 已定位，勿重复排查）

**症状**：在编辑器输入任意内容后，顶栏状态栏由「已同步」变「**同步错误**」并**不再恢复**；`window.septcats.sync.status()` → `state:'error'`、`pendingOps` 稳定不降（实测 3）。

**报错原文（决定性证据）**：

```
E_SYNC_CYCLE_FAILED：同步轮失败：非法段：第 3 个 op 的设备 desktop0001 与段头 dev=01m2vf7cw8vgwtesznzd7dakh5 不符
```

**根因**：
- `apps/desktop/src/renderer/src/pages/PageView.tsx:45` → `const PAGE_ACTOR = 'desktop0001';`：**渲染层硬编码设备 id**，编辑器产出的 op 都带它；
- `apps/desktop/src/main/index.ts:144` → `FALLBACK_ACTOR = 'desktop0001'`（main 兜底，保留合理）；
- 段写入时校验 `op.actor` 必须等于段头 `dev`（本机真实 actor，ULID）→ 不匹配即拒绝整段 → 同步轮失败并保持错误态。
- **为何现在才暴露**：T21-01 才把「编辑器 → 落库」真正接通；此前编辑器不落库、产生的 op 不进入账本。

## 1. PM 裁决（修法，勿另择）

**设备身份的唯一真源在 main**：渲染层不携带、也不得决定设备身份。

1. **main 侧权威改写（主修）**：`blocks:commit` 所走的 op 物化路径（与 `commitOps` 同处）在写入前，把每个 op 的 `actor` **改写为本机真实 actor**（main 已有的设备 actor 真源；`FALLBACK_ACTOR` 仅保留为极端兜底）。**只增不改**既有语义：改写仅针对 actor 字段，其余字段与幂等/去重行为不变。
2. **渲染层去硬编码**：删除 `PageView.tsx` 的 `PAGE_ACTOR` 与一切传 actor 的构造（若 EditSession/工具函数需要占位，用显式常量并在注释说明「会被 main 覆盖」——**但不得再出现 `desktop0001` 之外的设备语义**）。
3. **同类路径一并检查**（根因级修复，不只修报告点）：全仓 `grep -rn "desktop0001\|PAGE_ACTOR\|actor:" apps/desktop/src` → 凡渲染层参与构造 op 的地方都按 §1.1/§1.2 处理；模板/DB/导入等写路径若也自造 actor，同样归位。报告需列出逐处处理清单。
4. **不许「只改测试」**：必须是产品路径修复。

## 2. 必须交付的验证（缺一不可）

1. **回归测试（修前红、修后绿）**：渲染层提交带**错误 actor**（如 `desktop0001`）的 op → 物化后段的 `dev` 必须=本机真实 actor；且同步轮推进到 `ok`、`pendingOps` 归 0。**报告须含「修前红 → 修后绿」原文**。
2. **域测试**：主修路径单测（actor 改写、其余字段不变、幂等去重不回归）。
3. **真机证据（PM 会复核，但你也自跑一次并贴原文）**：全新夹具 → 新建页 → 输入文字 → `sync.status()` 的 `state` 必须为 `ok`、`errors` 为空、`pendingOps=0`；状态栏文本为「已同步」。
4. 全仓门禁：`pnpm -r test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

## 3. 红线

- 允许动：`apps/desktop/src/**`（含 `main/**`、`renderer/**`）、`apps/desktop/test/**`。
- **不碰**：`packages/**`（若确需改 schema/sync 契约，先停下并在报告写明理由，等 PM 裁决）、CI/发布脚本、`docs/**` 既有内容。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（如确需调整，报告 §DEVIATION 逐条列出）。

## 4. 交付物

代码 + 测试 + `docs/tasks/TASK-T28-01-report.md`（PM 复跑节留「（PM 补）」；含报错前后对照、逐处 actor 处理清单、DEVIATION）。