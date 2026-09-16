# TASK-T17-01 · G5-1 故障矩阵补齐：S10 换钥匙/恢复码（加密段钥匙生命周期）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：M8a+M8b 已合入（HEAD `b7fc837`）
> G5 门禁 = S1–S10 全过 + 双设备 7 天。PM 盘点：S1–S9 已有覆盖（S7=runtime 场景 D 实证），
> **S10（加密后换钥匙/重装系统）是当前唯一矩阵空洞**：keyring 只有 load/ensure/rotate，
> crypto.ts 信封 `base64(iv+tag+ct)` 无 key_id，恢复码与历史段重加密全无。
> 必读：apps/desktop/src/main/sync/{crypto,keyring,runtime,bridge,ipc}.ts、
> packages/sync/src/{manifest,naming}.ts、PROJECT_PLAN §S10/Q6、docs/tasks/TASK-T13-01-report.md（既有接缝）。
> 纪律：packages/sync **零改动**（红线）；不碰 git；每写完一个测试立即 pnpm 跑；禁占位符。

## 0. PM 设计裁决（照此实现，勿改架构）

**D1 恢复码 = DEK 的 base32 文本形态**（RFC4648 alphabet 无填充，256bit→52 字符，
分组显示 XXXXX-xxxxx-… 每 5 位一横杠）。不做 KDF——保护对象就是 DEK 本身，加派生只增
复杂度不增安全。导出=一次性明文展示（用户抄存/下载 txt）；导入=输入框粘贴（容忍横杠/
大小写/空白，校验长度+字母表）。

**D2 信封 v2（key_id 头）**：`base64( 0x01 || key_id(8B) || iv(12B) || tag(16B) || ct )`，
key_id = sha256(DEK)[0..8) 十六进制前 8 字节。
解密兼容矩阵：解出首字节==0x01 且长度≥37 → v2（校验 key_id 匹配，不匹配抛
`SyncKeyError(code=E_KEY_ID_MISMATCH)`）；否则 → 按 v1 旧格式（iv+tag+ct）用**当前 DEK**
解（老包无缝）。AAD 沿用现契约。

**D3 轮换 = 新钥 + 后台重加密**：`keyring.rotateDek()` 现有语义不动；runtime 新增
`reencryptAllSegments()`：枚举同步目录段文件（naming 正则）+ manifest 引用集 → 逐段
v1/旧 key_id 密文 → 旧 DEK 解 → 新 DEK 加密（v2）→ **原子替换**（写 tmp→rename），
幂等（key_id 已新值即跳过）。失败红条 + 可重试；进行中段的当前轮 flush 直接用新钥。

**D4 IPC/桥新增**（shared/ipc.ts 单源命名）：
- `sync:exportRecovery → {code}`（首次调用 ensureDek 后回文本；UI 需二次确认才显示）
- `sync:importRecovery {code} → {ok, keyId}`（校验→写入 keyring→触发追平）
- `sync:rotateKey → {startedAt}`（异步启动 D3，状态走既有 sync:progress/state 通道）
- 状态机新增 `key_mismatch` 红条态（E_KEY_ID_MISMATCH 冒泡：提示「用恢复码导入或重设」）

**D5 恢复码 UI**：设置页同步区块加三件套——导出（弹窗一次性明文+「我已保存」勾选）、
导入（textarea+校验反馈）、轮换（确认弹窗写明「旧恢复码作废」）。四态双主题，CSS 只吃
var(--sc-*)，图标走 @septcats/ui Icon。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/main/sync/crypto.ts` | 信封 v2 读写 + 兼容解 v1（D2） |
| `apps/desktop/src/main/sync/keyring.ts` | +exportRecoveryCode/importRecoveryCode（D1，含 base32 编解码小工具，stdlib Buffer 可写死实现） |
| `apps/desktop/src/main/sync/runtime.ts` | +reencryptAllSegments + key_mismatch 态接线（D3/D4） |
| `apps/desktop/src/main/sync/bridge.ts` + `ipc.ts` + `shared/ipc.ts` + `shared/sync.ts` + `preload` + `window.d.ts` | 三通道（D4） |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`(+css) | 同步区块三件套 UI（D5） |
| `apps/desktop/test/sync-crypto.test.ts` | 扩：v1↔v2 兼容矩阵、key_id 不符 E_KEY_ID_MISMATCH、AAD 不破 |
| `apps/desktop/test/sync-keyring.test.ts` | 扩：导出→清 keyring→导入→密文可读闭环；非法码拒绝 |
| `apps/desktop/test/sync-runtime.test.ts` | 扩：场景 E=S10 全流程（v1 老段+新钥轮换重加密→旧钥丢失→导入恢复码→全段可读；幂等重跑） |
| `docs/tasks/TASK-T17-01-report.md` | 交付表/裁决消费/验证原文/DEVIATIONS |

## 2. DoD（PM 复跑）

```
pnpm -r typecheck && pnpm -r test && node packages/ui/tokens/no-magic.mjs && pnpm -C apps/desktop selftest
```
+ 测试计数与新增用例数对账（skipped=失败）。git 红线：packages/sync 与 packages/core 零 diff。
