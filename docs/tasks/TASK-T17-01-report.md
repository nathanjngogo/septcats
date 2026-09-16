# TASK-T17-01 · 报告：S10 断点续作（D1–D3 续接 + D4 三通道接线 + D5 设置页三件套）

> 工程师：CodeBuddy ｜ PM：Hermes ｜ 日期：2026-09-17 ｜ rev `285914c` + 工作树（D1–D3 遗产与 PM 修复已含）
> 红线遵守：`packages/sync`、`packages/core` **零 diff**（`git diff --stat -- packages/sync packages/core` 为空，见 §5）；
> **不碰 git**（全程未 add/commit）；CSS 全部 `var(--sc-*)` token（no-magic 门禁通过）。
> 本报告覆盖 TASK-T17-01 全程（D1–D3 上轮完成、PM 复跑全绿；D4–D5 本轮交付），按任务书 §0.3 原文转写 PM 修复。

## 1. 交付表

| 阶段 | 文件 | 内容 |
|---|---|---|
| D1 | `apps/desktop/src/main/sync/keyring.ts` | 恢复码 base32 编解码 `encodeRecoveryCode/decodeRecoveryCode`（52 字符，容忍横杠/大小写/空白）+ `exportRecoveryCode/importRecoveryCode`（上轮，已绿） |
| D2 | `apps/desktop/src/main/sync/crypto.ts` | 信封 v2（`0x01‖key_id(8B)‖iv‖tag‖ct`）+ v1 兼容解（上轮，已绿） |
| D3 | `apps/desktop/src/main/sync/runtime.ts` | `rotateKey/reencryptAllSegments/whenReencryptSettled/adoptRecoveredDek`，S10 段 408 行起（上轮 + PM 修复，已绿） |
| D4 | `apps/desktop/src/shared/ipc.ts` | 三通道常量 `CHANNEL_SYNC_EXPORT_RECOVERY/IMPORT_RECOVERY/ROTATE_KEY` + `SYNC_CHANNELS` 三键 + 段头注释（本轮） |
| D4 | `apps/desktop/src/main/sync/runtime.ts:564-578` | `exportRecovery()`（ensureDek → base32 文本，不落盘）/ `importRecovery(code)`（校验→keyring→`adoptRecoveredDek`→追平 await 完成）（本轮） |
| D4 | `apps/desktop/src/main/sync/ipc.ts` | 四→七通道注册：3 处理器 + `readRecoveryCode` 输入校验；`SyncKeyError` → import 转 `E_MALFORMED`、rotate 转 `E_INVARIANT`（本轮） |
| D4 | `apps/desktop/src/preload/index.ts` | sync 块追加 `exportRecovery/importRecovery/rotateKey` 三方法（本轮） |
| D4 | `apps/desktop/src/types/window.d.ts` | `SeptcatsSyncApi` 追加 3 方法签名；头注释五态→六态（含 key_mismatch 语义）（本轮） |
| D4 | `apps/desktop/src/renderer/src/sync/SyncStatus.tsx` | `pillView` 新增 `case 'key_mismatch'`（复用 error 红条视觉，文案独立）；头注释六态化（本轮） |
| D4 | `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `sync.stateKeyMismatch: '密钥不匹配'`（本轮） |
| D5 | `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | 「同步密钥」fieldset（导出/导入/轮换三行）+ 15 个 state + 6 处理器 + 3 弹窗（导出勾选门控 / 导入先错后对反馈 / 轮换 destructive 确认）；import 补 `Checkbox`（本轮） |
| D5 | `apps/desktop/src/renderer/src/pages/SettingsPage.css` | 7 新类：`.settings-recovery-code/-warn/-muted/-input/-error/-ok/-saved-row`，全部 token（本轮） |
| D5 | `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `settings.recovery` 段 23 条文案（diagnostic 与 about 之间）（本轮） |
| 测试 | `apps/desktop/test/sync-ui.test.tsx` | +1 用例（key_mismatch 红条）；头注释与 describe 五态→六态（本轮） |
| 测试 | `apps/desktop/test/settings-react.test.tsx` | 桥补 `sync` 子桥（status/setEnabled/now/onState + 三件套 mock 引用外抛）+ 4 用例（本轮） |

测试增量：48 → 53（+5，全部追加，既有断言语义零改动）。

## 2. 断点续作说明（上轮中断 + PM 修复转写）

上轮 T17-01 CodeBuddy 会话中断于 D1–D3 半成品（7 文件落盘），PM 接手修复全部缺陷并复跑 `sync-*` 三测试文件 + 全仓 224/224 全绿后下发本任务。以下四条按 PM 修复记录原文转写（症状→根因→修法→证据）：

1. **`runtime.rotateKey` 微任务竞态**
   - 症状：`rotateKey()` 返回后立即调用 `whenReencryptSettled()` 会回 `null`。
   - 根因：轮换 promise 链是异步构造后才赋值给 `reencryptPromise`，微任务时序上调用方可抢在赋值前读取。
   - 修法：整链 promise **同步赋值**（IIFE 构造链后立即 `this.reencryptPromise = chain`）；轮换中幂等守卫含 `reencryptPromise !== null`；chain finally 释放引用（未被消费也不阻塞下一次轮换）。
   - 证据：`runtime.ts:415-444`；sync-runtime.test.ts K 用例（`whenReencryptSettled` 紧随 `rotateKey` 可等待）。

2. **`runtime.reencryptBody` 幻影重加密目标**
   - 症状：读失败的 `failed=1` 假红条。
   - 根因：manifest 引用的快照被**无条件**纳入重加密目标，快照实际不存在时读文件失败（`snapshot-000000.json.enc` 幻影目标）。
   - 修法：manifest 引用的快照**仅在实际存在时**（`names.includes(snapName)`）纳入目标集。
   - 证据：`runtime.ts:506-510`；K 用例重加密报告 failed=0。

3. **`runtime.cycleBody` 快照 key_mismatch 漏判**
   - 症状：新设备先读快照时，快照 key_id 不符会漏成 `E_SYNC_CYCLE_FAILED/error`，不走 key_mismatch 语义。
   - 根因：`seedFromSnapshot` 与 `mergeRemote` 的 `SyncKeyError` 映射不同源。
   - 修法：两处共用同一 `SyncKeyError` 映射，同走 `key_mismatch`。
   - 证据：`runtime.ts:654`（注释与共用映射）；J 用例期望改 `key_mismatch`/`E_KEY_ID_MISMATCH`。

4. **测试侧夹具与断言修正**（PM 修，未动语义只对新语义对齐）
   - J 用例期望改 `key_mismatch`/`E_KEY_ID_MISMATCH`（D4 新语义）；
   - K 夹具改用 `segmentFileName()` 生成 `.jsonl.enc` 命名契约（原 `segmentName()` 缺 `.jsonl`）；
   - v1 IV 首字节防 `0x01`（1/256 判型碰撞）；
   - 落定断言改 `vi.waitFor`（runCycle 并发合并语义）；
   - `sync-crypto.test.ts` 两处 typecheck 修复。

## 3. 裁决消费（任务书裁决 → 实现与证据）

| 裁决/任务书条目 | 实现位置 | 测试证据 |
|---|---|---|
| D1 恢复码 base32（52 字符、容忍横杠/大小写/空白） | `keyring.ts`（上轮） | sync-keyring.test.ts 10 用例 |
| D2 信封 v2 + v1 兼容解 | `crypto.ts`（上轮） | sync-crypto.test.ts 17 用例 |
| D3 轮换 + 后台重加密 + 原子替换 | `runtime.ts`（上轮+PM） | sync-runtime.test.ts K 用例全流程 |
| D4 三通道（exportRecovery/importRecovery/rotateKey） | shared/ipc.ts → main/sync/ipc.ts → runtime.ts → preload → window.d.ts（本轮） | settings-react.test.ts 三件套 4 用例走全链（桥级）；sync-runtime/crypto/keyring 既有用例不回归 |
| D4 六态红条 `key_mismatch` | SyncStatus.tsx `pillView` case + i18n `stateKeyMismatch` | sync-ui.test.tsx「key_mismatch 态（T17-01 六态新增）：红点 + 密钥不匹配」 |
| D5 设置页三件套（导出勾选门控 / 导入反馈 / 轮换确认） | SettingsPage.tsx fieldset + 3 Dialog + CSS 7 类 + i18n `settings.recovery` 23 条 | settings-react.test.tsx「设置页 · 同步密钥三件套（T17-01）」4 用例 |
| 恢复码一次性明文不落盘 | runtime.exportRecovery 不落盘不进日志；UI 侧 state 关窗即清（closeRecExport 清 recCode） | settings-react 导出用例：勾选门控 → 完成后弹窗关闭 |

## 4. 验证（工程师自跑输出摘要）

基线（改动前，确认起点全绿）：

```
 ✓ test/sync-crypto.test.ts (17 tests) 8ms
 ✓ test/sync-runtime.test.ts (11 tests) 192ms
 ✓ test/sync-keyring.test.ts (10 tests) 1242ms
 ✓ test/settings-react.test.tsx (3 tests) 126ms
 ✓ test/sync-ui.test.tsx (7 tests) 473ms
 Test Files  5 passed (5)   Tests  48 passed (48)
```

`pnpm -r typecheck`（最终）：

```
packages/sync typecheck: Done
packages/core typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
（9 个 workspace 项目全部 Done，Exit Code 0）
```

`node packages/ui/tokens/no-magic.mjs`（最终）：

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

`npx vitest run test/sync-crypto.test.ts test/sync-keyring.test.ts test/sync-runtime.test.ts test/sync-ui.test.tsx test/settings-react.test.tsx`（apps/desktop，最终）：

```
 ✓ test/sync-crypto.test.ts (17 tests) 9ms
 ✓ test/sync-runtime.test.ts (11 tests) 181ms
 ✓ test/sync-keyring.test.ts (10 tests) 1024ms
 ✓ test/settings-react.test.tsx (7 tests) 332ms
 ✓ test/sync-ui.test.tsx (8 tests) 509ms
 Test Files  5 passed (5)   Tests  53 passed (53)
```

红线核验（`git diff --stat -- packages/sync packages/core` 输出为空；工作树改动仅 apps/desktop 11 文件 + 本报告）。未跑 `pnpm -r test` 全仓与 selftest（按任务书留给 PM）。

## 5. PM 复跑

（PM 复跑原文，2026-09-17；全部为 PM 手跑，非工程师转述）

1. `pnpm -r typecheck`：9 个 workspace 全 `Done`（含 packages/sync、packages/core、apps/desktop），Exit 0。
2. `pnpm -r test`（全仓）：22 文件 / **229 passed（224 → 229，= 本轮 +5 新增用例）**；commitOps P95 = 14.2 ms（预算 16，绿）、search P95 = 13.4 ms（预算 150，绿）、rebuild 1.47 s（预算 5 s，绿）。
3. `node packages/ui/tokens/no-magic.mjs`：`✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px`。
4. `pnpm -C apps/desktop selftest`：逐项 PASS，末行 `SELFTEST OK`。
5. 独立复核（PM 手跑）：sync 五文件 `53/53`（基线 48 → 53），含真实 DPAPI 后端用例（sync-keyring 1.04 s 真跑）。

红线核验：`git diff --stat -- packages/sync packages/core` 输出为空 ✓；工作树改动 = apps/desktop 11 文件 + 手册产物（本报告、TASK-T18-01）。

## 6. DEVIATIONS

1. **任务书 §1.1 要求 sync 段头注释补一句 `/* S10 三通道（T17-01 D4） */`**：已照加在三个通道常量之前（`src/shared/ipc.ts` sync 段内），非偏离，此处记录位置细节。
2. **测试用例「导入」查询器**：任务书 §3.2 写 `getByLabelText('导入恢复码')`，实际该文本同时命中按钮（aria 名）与 textarea（aria-label）→ `getMultipleElementsFoundError`；改用 `getByRole('textbox', { name: '导入恢复码' })`，语义等价（唯一命中 textarea），断言语义未变。
3. 其余全部照任务书片段实现，无出入。

## 7. PM 附注

1. **perf 环境敏感性观测**：收口期 `commit_batch_200_blocks_p95` 曾连续 6 次超线（16.6–19.4 ms / 预算 16 ms），其中含 stash 掉全部未提交改动后的干净 HEAD 对照跑（19.4 ms 同红）→ 排除代码嫌疑；静置数分钟后连续 5 次回绿（12.8–14.6 ms），全仓并行跑 14.2 ms 绿。判定为机器态瞬态（疑似连续满载后降频窗口），已同步记入 `docs/PERF-BASELINE.md`「环境敏感性观测」。处置：不改预算、不改代码；性能红线复跑留冷却窗口、如实记账。
2. **DEVIATIONS §6.2**（`getByLabelText` → `getByRole('textbox')`）系任务书笔误（该文本同时命中按钮与 textarea），工程师修正正确，接受。
3. 验收结论：T17-01（S10）代码面交付成立；**G5 门禁仍待老板双设备 7 天真机**。
