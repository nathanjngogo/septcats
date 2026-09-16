# TASK-T17-01B · S10 断点续作：D4 三通道接线 + D5 设置页三件套 + 报告

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：TASK-T17-01（HEAD `285914c`，工作树含未提交的 D1–D3 遗产+PM 修复）
> **背景**：T17-01 上一轮 CodeBuddy 会话中断于 D1–D3 半成品（7 文件落盘）；PM 已修复全部缺陷并复跑
> `sync-*` 三测试文件 + 全仓 224/224 全绿。**本任务 = §1 D4 + §2 D5 + §3 测试补充 + §4 报告。不要重做 D1–D3。**
> 纪律：`packages/sync`、`packages/core` **零改动**（红线）；**不碰 git**；禁占位符/TODO（没写完就写注释说明，不许留 `// ...` 空壳）；
> CSS 只吃 `var(--sc-*)` token（`node packages/ui/tokens/no-magic.mjs` 强制）；每完成一组改动立即自跑对应测试。

---

## 0. 断点现状（先通读，理解后再动手）

### 0.1 必读文件（当前真实状态）
`src/main/sync/crypto.ts`（信封 v2 + v1 兼容解）、`src/main/sync/keyring.ts`（恢复码编解码 + export/importRecoveryCode）、
`src/main/sync/runtime.ts`（rotateKey/reencryptAllSegments/whenReencryptSettled/adoptRecoveredDek，S10 段在 408 行起）、
`src/main/sync/ipc.ts`、`src/shared/ipc.ts`、`src/shared/sync.ts`、`src/preload/index.ts`、`src/types/window.d.ts`、
`src/renderer/src/sync/SyncStatus.tsx`、`src/renderer/src/pages/SettingsPage.tsx`（+`.css`）、`src/renderer/src/i18n/zh-CN.ts`、
`test/sync-ui.test.tsx`、`test/settings-react.test.tsx`。

### 0.2 已完成（全绿，勿重做）
- D1 恢复码 base32（`encodeRecoveryCode/decodeRecoveryCode`，52 字符、容忍横杠/大小写/空白）；D2 信封 v2（`0x01||key_id(8B)||iv||tag||ct`）+ v1 兼容解；D3 轮换 + 后台重加密 + 原子替换。
- `SyncRuntimeState` 六态已含 `key_mismatch`；runtime 已把 `E_KEY_ID_MISMATCH` 冒泡为 `key_mismatch` 态（seed 与 merge 同口径）。
- 测试已绿：`test/sync-crypto.test.ts`、`test/sync-keyring.test.ts`、`test/sync-runtime.test.ts`（K = S10 全流程）。

### 0.3 PM 修复记录（写报告 §2 时照此转写，勿改写事实）
1. `runtime.rotateKey`：整链 promise 同步赋值（修 `whenReencryptSettled` 在 rotateKey 返回后立即被调用时的微任务竞态，原实现会回 null）；轮换中幂等守卫含 `reencryptPromise !== null`；chain finally 释放引用（未被消费也不阻塞下一次轮换）。
2. `runtime.reencryptBody`：manifest 引用的快照**仅在实际存在时**纳入重加密目标（原实现无条件加 `snapshot-000000.json.enc` 幻影目标 → 读失敗 failed=1 假红条）。
3. `runtime.cycleBody`：`seedFromSnapshot` 与 `mergeRemote` 共用同一 `SyncKeyError` 映射（新设备先读快照，快照 key_id 不符原会漏成 `E_SYNC_CYCLE_FAILED/error`；现同走 `key_mismatch`）。
4. 测试侧：J 用例期望改 `key_mismatch`/`E_KEY_ID_MISMATCH`（D4 新语义）；K 夹具改用 `segmentFileName()` 生成 `.jsonl.enc` 命名契约（原 `segmentName()` 缺 `.jsonl`）+ v1 IV 首字节防 `0x01`（1/256 判型碰撞）+ 落定断言用 `vi.waitFor`（runCycle 并发合并语义）；`sync-crypto.test.ts` 两处 typecheck 修复。

---

## 1. 任务 D4 —— 恢复码/轮换三通道接线

### 1.1 `src/shared/ipc.ts`
sync 段（`CHANNEL_SYNC_STATE` 之后）追加：

```ts
/** 导出恢复码：→ {code}（一次性明文；D1/D4）。 */
export const CHANNEL_SYNC_EXPORT_RECOVERY = 'sync:exportRecovery';
/** 导入恢复码：{code} → {ok, keyId}（校验→写入 keyring→触发追平；D1/D4）。 */
export const CHANNEL_SYNC_IMPORT_RECOVERY = 'sync:importRecovery';
/** 轮换钥匙：→ {startedAt}（异步启动后台重加密，进度走 sync:state；D3/D4）。 */
export const CHANNEL_SYNC_ROTATE_KEY = 'sync:rotateKey';
```

`SYNC_CHANNELS` 追加三个键：`exportRecovery` / `importRecovery` / `rotateKey`（映射到上面对应常量）。
sync 段头注释补一句：`/* S10 三通道（T17-01 D4） */`。

### 1.2 `src/main/sync/runtime.ts` —— 新增 2 个公共方法（放在 `adoptRecoveredDek` 之前，S10 段落内）

```ts
  /**
   * 导出恢复码（D4 sync:exportRecovery）：ensureDek → base32 文本（5 字符一横杠）。
   * 一次性明文由 UI 侧保证——本方法不落盘；调用方禁止把 code 写进日志。
   */
  async exportRecovery(): Promise<string> {
    return await this.keyring.exportRecoveryCode();
  }

  /**
   * 导入恢复码（D4 sync:importRecovery）：校验→keyring 覆盖写入→新 DEK 接管→
   * 触发追平（await 完成，回包前状态已刷新）。非法码抛 SyncKeyError（ipc 层转 E_MALFORMED）。
   */
  async importRecovery(code: string): Promise<{ ok: true; keyId: string }> {
    const dek = await this.keyring.importRecoveryCode(code);
    await this.adoptRecoveredDek(dek);
    return { ok: true, keyId: keyIdOf(dek) };
  }
```

（`keyIdOf` 已在本文件 import；勿新增依赖。）

### 1.3 `src/main/sync/ipc.ts` —— 3 个处理器 + 输入校验
- import 段补：`CHANNEL_SYNC_EXPORT_RECOVERY`、`CHANNEL_SYNC_IMPORT_RECOVERY`、`CHANNEL_SYNC_ROTATE_KEY`（从 `../../shared/ipc`），以及 `import { SyncKeyError } from './crypto';`
- 头注释「sync:* 四通道注册」改为「sync:* 七通道注册」并补三行说明。
- `readOn` 之后新增：

```ts
function readRecoveryCode(raw: unknown): string {
  const code = (raw as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new PagesApiError('E_MALFORMED', 'code 必须是非空字符串');
  }
  return code;
}
```

- `CHANNEL_SYNC_NOW` 处理器之后追加：

```ts
  options.registrar.handle(CHANNEL_SYNC_EXPORT_RECOVERY, async (): Promise<{ code: string }> => {
    return { code: await requireRuntime().exportRecovery() };
  });

  options.registrar.handle(
    CHANNEL_SYNC_IMPORT_RECOVERY,
    async (raw: unknown): Promise<{ ok: true; keyId: string }> => {
      const code = readRecoveryCode(raw);
      try {
        return await requireRuntime().importRecovery(code);
      } catch (error) {
        if (error instanceof SyncKeyError) {
          throw new PagesApiError('E_MALFORMED', error.message); // 非法码：长度/字母表（不落盘）
        }
        throw error;
      }
    },
  );

  options.registrar.handle(CHANNEL_SYNC_ROTATE_KEY, async (): Promise<{ startedAt: number }> => {
    try {
      return requireRuntime().rotateKey();
    } catch (error) {
      if (error instanceof SyncKeyError) {
        throw new PagesApiError('E_INVARIANT', error.message); // 无 DEK：先开启加密同步
      }
      throw error;
    }
  });
```

### 1.4 `src/preload/index.ts` —— sync 块追加（照既有写法）

```ts
    exportRecovery: () =>
      ipcRenderer.invoke(SYNC_CHANNELS.exportRecovery) as ReturnType<SeptcatsApi['sync']['exportRecovery']>,
    importRecovery: (input) =>
      ipcRenderer.invoke(SYNC_CHANNELS.importRecovery, input) as ReturnType<SeptcatsApi['sync']['importRecovery']>,
    rotateKey: () =>
      ipcRenderer.invoke(SYNC_CHANNELS.rotateKey) as ReturnType<SeptcatsApi['sync']['rotateKey']>,
```

### 1.5 `src/types/window.d.ts` —— `SeptcatsSyncApi` 追加 3 方法 + 注释改六态

```ts
  /** 导出恢复码（一次性明文；D1/D4）。加解密全在本地，不经网络。 */
  exportRecovery(): Promise<{ code: string }>;
  /** 导入恢复码：校验→写入 keyring→新钥接管→追平；非法码经 E_MALFORMED 透传。 */
  importRecovery(input: { code: string }): Promise<{ ok: true; keyId: string }>;
  /** 轮换钥匙：立即回 {startedAt}；后台重加密进度经 onState（sync:state）推送。 */
  rotateKey(): Promise<{ startedAt: number }>;
```

接口头注释「五态：idle（未启用）/ syncing / ok / degraded（同步文件夹不可访问）/ error。」改为：
「六态：idle（未启用）/ syncing / ok / degraded（同步文件夹不可访问）/ error / key_mismatch（E_KEY_ID_MISMATCH 红条，提示用恢复码导入或重设）。」

### 1.6 `src/renderer/src/sync/SyncStatus.tsx` —— 六态红条
- 头注释「五态（07 屏顶栏状态钮逐态对应）」改为「六态……」，`error` 行后补 `key_mismatch 红点「密钥不匹配」（E_KEY_ID_MISMATCH；面板最近错误里带「用恢复码导入或重设」提示）`。
- `switch (status.state as SyncRuntimeState)` 的 `case 'error'` 之后追加：

```tsx
    case 'key_mismatch':
      // T17-01 D4：密钥不匹配——沿用 error 红条视觉，文案独立（修复指引在错误消息里）
      return { key: 'error', label: t('sync.stateKeyMismatch') };
```

（`PillView.key` 与 CSS 均不改动。）

### 1.7 `src/renderer/src/i18n/zh-CN.ts`
- `sync` 段 `stateError` 之后追加：`stateKeyMismatch: '密钥不匹配',`
- `settings` 段在 `diagnostic` 与 `about` 之间插入 `recovery` 段（D5 用，全文见 §2.5）。
- **main/index.ts 无需改动**（`registerSyncIpc` 的 registrar/getRuntime 已就位；状态推流已有）。

---

## 2. 任务 D5 —— 设置页「同步密钥」区块三件套

### 2.1 位置与结构
`SettingsPage.tsx`：在「数据与隐私」fieldset 之后、「诊断」fieldset 之前，插入新 fieldset（legend = `t('settings.recovery.title')`），三行 `SettingsRow`：
导出恢复码 / 导入恢复码 / 轮换密钥（按钮均 `variant="secondary" size="sm"`，`disabled={saving}`），行下条件渲染轮换反馈行。

### 2.2 状态与处理器（加在现有 state 之后）
```tsx
  // T17-01 D5：同步密钥三件套（一次性明文不落任何持久态；关窗即清）
  const [recExportOpen, setRecExportOpen] = useState(false);
  const [recCode, setRecCode] = useState<string | null>(null);
  const [recExportBusy, setRecExportBusy] = useState(false);
  const [recExportError, setRecExportError] = useState<string | null>(null);
  const [recSaved, setRecSaved] = useState(false);
  const [recImportOpen, setRecImportOpen] = useState(false);
  const [recImportText, setRecImportText] = useState('');
  const [recImportBusy, setRecImportBusy] = useState(false);
  const [recImportError, setRecImportError] = useState<string | null>(null);
  const [recImportOk, setRecImportOk] = useState<string | null>(null);
  const [recRotateOpen, setRecRotateOpen] = useState(false);
  const [recRotateBusy, setRecRotateBusy] = useState(false);
  const [recRotateError, setRecRotateError] = useState<string | null>(null);
  const [recRotateMsg, setRecRotateMsg] = useState<string | null>(null);
```

处理器（`handleInstall` 之后追加）：
```tsx
  const closeRecExport = (): void => {
    setRecExportOpen(false);
    setRecCode(null);
    setRecSaved(false);
    setRecExportError(null);
  };

  const openRecExport = (): void => {
    setRecExportOpen(true);
    setRecCode(null);
    setRecSaved(false);
    setRecExportError(null);
    setRecExportBusy(true);
    void (async () => {
      try {
        const result = await window.septcats.sync.exportRecovery();
        setRecCode(result.code);
      } catch (cause) {
        setRecExportError(describeError(cause));
      } finally {
        setRecExportBusy(false);
      }
    })();
  };

  const closeRecImport = (): void => {
    setRecImportOpen(false);
    setRecImportText('');
    setRecImportBusy(false);
    setRecImportError(null);
    setRecImportOk(null);
  };

  const submitRecImport = async (): Promise<void> => {
    setRecImportBusy(true);
    setRecImportError(null);
    setRecImportOk(null);
    try {
      const result = await window.septcats.sync.importRecovery({ code: recImportText });
      setRecImportOk(result.keyId);
    } catch (cause) {
      setRecImportError(describeError(cause));
    } finally {
      setRecImportBusy(false);
    }
  };

  const closeRecRotate = (): void => {
    setRecRotateOpen(false);
    setRecRotateError(null);
  };

  const confirmRecRotate = async (): Promise<void> => {
    setRecRotateBusy(true);
    setRecRotateError(null);
    try {
      await window.septcats.sync.rotateKey();
      setRecRotateMsg(t('settings.recovery.rotateStarted'));
      setRecRotateOpen(false);
    } catch (cause) {
      setRecRotateError(describeError(cause));
    } finally {
      setRecRotateBusy(false);
    }
  };
```

### 2.3 区块 JSX（插在隐私 fieldset 与诊断 fieldset 之间）
```tsx
          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.recovery.title')}</legend>
            <SettingsRow
              title={t('settings.recovery.export')}
              desc={t('settings.recovery.exportDesc')}
              control={
                <Button variant="secondary" size="sm" disabled={saving} onClick={openRecExport}>
                  {t('settings.recovery.export')}
                </Button>
              }
            />
            <SettingsRow
              title={t('settings.recovery.import')}
              desc={t('settings.recovery.importDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setRecImportOpen(true);
                  }}
                >
                  {t('settings.recovery.import')}
                </Button>
              }
            />
            <SettingsRow
              title={t('settings.recovery.rotate')}
              desc={t('settings.recovery.rotateDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setRecRotateOpen(true);
                  }}
                >
                  {t('settings.recovery.rotate')}
                </Button>
              }
            />
            {recRotateMsg === null ? null : (
              <div className="settings-saved" data-testid="settings-rotate-note">
                {recRotateMsg}
              </div>
            )}
          </fieldset>
```

### 2.4 三个弹窗（追加在更新 confirm Dialog 之后；四态齐全：加载/错误/成功/就绪）

```tsx
      <Dialog
        open={recExportOpen}
        onClose={closeRecExport}
        title={t('settings.recovery.exportDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeRecExport}>
              {t('settings.recovery.cancel')}
            </Button>
            <Button size="sm" disabled={!recSaved || recCode === null} onClick={closeRecExport}>
              {t('settings.recovery.exportDialogDone')}
            </Button>
          </div>
        }
      >
        {recExportBusy ? <p className="settings-recovery-muted">{t('settings.recovery.busy')}</p> : null}
        {recExportError === null ? null : (
          <p className="settings-recovery-error" role="alert">
            {recExportError}
          </p>
        )}
        {recCode === null ? null : (
          <>
            <code className="settings-recovery-code" data-testid="recovery-code">
              {recCode}
            </code>
            <p className="settings-recovery-warn">{t('settings.recovery.exportDialogBody')}</p>
            <div className="settings-recovery-saved-row">
              <Checkbox
                checked={recSaved}
                onChange={(event) => {
                  setRecSaved(event.target.checked);
                }}
                label={t('settings.recovery.exportDialogSaved')}
              />
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={recImportOpen}
        onClose={closeRecImport}
        title={t('settings.recovery.importDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeRecImport}>
              {t('settings.recovery.cancel')}
            </Button>
            {recImportOk === null ? (
              <Button
                size="sm"
                loading={recImportBusy}
                disabled={recImportText.trim().length === 0}
                onClick={() => {
                  void submitRecImport();
                }}
              >
                {t('settings.recovery.importDialogSubmit')}
              </Button>
            ) : (
              <Button size="sm" onClick={closeRecImport}>
                {t('settings.recovery.exportDialogDone')}
              </Button>
            )}
          </div>
        }
      >
        <p className="settings-recovery-warn">{t('settings.recovery.importDialogBody')}</p>
        <textarea
          className="settings-recovery-input"
          rows={3}
          value={recImportText}
          placeholder={t('settings.recovery.importDialogPlaceholder')}
          aria-label={t('settings.recovery.importDialogTitle')}
          disabled={recImportOk !== null}
          onChange={(event) => {
            setRecImportText(event.target.value);
          }}
        />
        {recImportError === null ? null : (
          <p className="settings-recovery-error" role="alert">
            {recImportError}
          </p>
        )}
        {recImportOk === null ? null : (
          <p className="settings-recovery-ok" data-testid="recovery-import-ok">
            {fillTemplate(t('settings.recovery.importDialogSuccess'), { keyId: recImportOk })}
          </p>
        )}
      </Dialog>

      <Dialog
        open={recRotateOpen}
        onClose={closeRecRotate}
        title={t('settings.recovery.rotateDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeRecRotate}>
              {t('settings.recovery.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={recRotateBusy}
              onClick={() => {
                void confirmRecRotate();
              }}
            >
              {t('settings.recovery.rotateDialogConfirm')}
            </Button>
          </div>
        }
      >
        <p className="settings-recovery-warn">{t('settings.recovery.rotateDialogBody')}</p>
        {recRotateError === null ? null : (
          <p className="settings-recovery-error" role="alert">
            {recRotateError}
          </p>
        )}
      </Dialog>
```

import 行补 `Checkbox`（`@septcats/ui`，按字母序插好）。头注释补一行 D5 说明。

### 2.5 i18n 文案（`settings.recovery` 全文，插在 `diagnostic` 段之后）
```ts
    recovery: {
      title: '同步密钥',
      export: '导出恢复码',
      exportDesc: '恢复码 = 同步数据的钥匙。换机或重装系统后凭它找回全部内容',
      import: '导入恢复码',
      importDesc: '粘贴已保存的恢复码，立即接管本机同步数据',
      rotate: '轮换密钥',
      rotateDesc: '生成全新钥匙并后台重加密历史段；旧恢复码立即作废',
      busy: '处理中…',
      cancel: '取消',
      exportDialogTitle: '恢复码（仅显示这一次）',
      exportDialogBody: '请立即抄写或存入密码管理器。本窗口关闭后不再显示。',
      exportDialogSaved: '我已安全保存恢复码',
      exportDialogDone: '完成',
      importDialogTitle: '导入恢复码',
      importDialogBody: '粘贴此前保存的恢复码（容忍横杠、空格与大小写）。导入后本机立即切换到该钥匙并追平数据。',
      importDialogPlaceholder: 'XXXXX-XXXXX-XXXXX-…',
      importDialogSubmit: '导入并追平',
      importDialogSuccess: '导入成功（key_id {keyId}），已触发追平',
      rotateDialogTitle: '轮换密钥',
      rotateDialogBody: '轮换会生成新钥匙并重加密同步目录中的历史段，旧恢复码立即作废。请轮换完成后重新导出并保存新的恢复码。',
      rotateDialogConfirm: '确认轮换',
      rotateStarted: '已开始后台重加密，进度见顶栏同步状态',
    },
```

### 2.6 `SettingsPage.css` 追加（全部 token；数值/写法照抄同文件既有类）
新增类：`.settings-recovery-code`（等宽+可整段选中+可换行；底色/边框/圆角照 `.settings-preview`）、`.settings-recovery-warn`（次要文案色）、`.settings-recovery-muted`（次要文案色）、`.settings-recovery-input`（宽 100%、等宽字体、边框/圆角照 `.settings-preview`）、`.settings-recovery-error`（危险语义色，照同文件错误类）、`.settings-recovery-ok`（成功语义色，如无先例用 token 里最接近的绿色语义变量，去 `packages/ui/src/tokens*` 与 `ErrorPanel.css` 找对照）、`.settings-recovery-saved-row`（上边距小节奏）。**严禁字面 hex/裸 px 违规值——改完必须跑 no-magic 检查。**

---

## 3. 测试补充（只许追加，不许改既有断言的语义）

### 3.1 `test/sync-ui.test.tsx`：+1 用例 + 头注释
头注释「五态渲染（…）」改「六态渲染（… + key_mismatch 红条）」，describe 串「五态」改「六态」；追加：

```tsx
  it('key_mismatch 态（T17-01 六态新增）：红点 + 密钥不匹配', async () => {
    await renderPill(
      statusOf({
        state: 'key_mismatch',
        errors: [
          {
            code: 'E_KEY_ID_MISMATCH',
            message:
              "'seg-0000000a-aaaa0001-000001.jsonl' key_id 不匹配（密文属于另一把钥匙；用恢复码导入或重设同步）",
            at: 1,
          },
        ],
      }),
    );
    const pill = screen.getByRole('button', { name: '同步状态' });
    expect(pill.className).toContain('sc-sync-status__pill--error');
    expect(pill.textContent).toContain('密钥不匹配');
  });
```

### 3.2 `test/settings-react.test.tsx`：桥补 sync 子桥 + 4 用例
- `installBridge` 的 bridge 对象补：
```ts
    sync: {
      status: vi.fn(async () => ({
        state: 'idle' as const,
        enabled: false,
        lastSyncAt: null,
        devices: [],
        pendingOps: 0,
        pendingSegs: 0,
        conflicts: 0,
        errors: [],
      })),
      setEnabled: vi.fn(),
      now: vi.fn(),
      onState: vi.fn(() => () => {}),
      exportRecovery: vi.fn(async () => ({
        code: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ',
      })),
      importRecovery: vi.fn(async () => ({ ok: true as const, keyId: 'a1b2c3d4' })),
      rotateKey: vi.fn(async () => ({ startedAt: 1 })),
    },
```
- `installBridge` 返回值与返回类型扩展 `sync` 三件套 mock 的引用（既有用例解构 `{ patch }`/`{ exportDiag }` 不受影响）。
- 追加 4 用例（都在 `describe('SettingsPage（三区块 + 无障碍）')` 里，或用新 describe「设置页 · 同步密钥三件套」）：
  1. **导出**：点「导出恢复码」→ `exportRecovery` 被调 → 弹窗标题「恢复码（仅显示这一次）」出现 → 「完成」按钮初始 disabled → 勾选「我已安全保存恢复码」→ enabled → 点击后弹窗关闭。
  2. **导出-失败态**：`exportRecovery.mockRejectedValueOnce(new Error('E_INVARIANT：凭据存储不可用'))` → 打开弹窗出现 `role="alert"` 文案含「凭据存储不可用」。
  3. **导入**：点「导入恢复码」→ textarea（`getByLabelText('导入恢复码')`）填入后点「导入并追平」→ 成功路径断言 `recovery-import-ok` 含 `a1b2c3d4`；随后（同一用例内重开或直接 mockRejectedValueOnce 先错后对）错误路径断言 `role="alert"` 含「恢复码长度非法」——**顺序：先错后对**（第一次 `mockRejectedValueOnce(new Error('E_MALFORMED：恢复码长度非法：期望 52 字符（去横杠后），实际 10'))`，再点提交走默认 resolve）。
  4. **轮换**：点「轮换密钥」→「确认轮换」出现 → 点击 → `rotateKey` 被调 → `settings-rotate-note` 文案「已开始后台重加密，进度见顶栏同步状态」。
- 头注释补「T17-01：同步密钥三件套（导出勾选门控 / 导入校验反馈 / 轮换确认）」。

### 3.3 自跑命令（每组改动做完立即跑；PM 最后复跑全仓）
```bash
# 仓库根
pnpm -r typecheck
node packages/ui/tokens/no-magic.mjs
# apps/desktop 内
npx vitest run test/sync-crypto.test.ts test/sync-keyring.test.ts test/sync-runtime.test.ts test/sync-ui.test.tsx test/settings-react.test.tsx
```
全部通过后（0 failed；已有用例一条都不许改红）方可收尾写报告。

---

## 4. 报告 `docs/tasks/TASK-T17-01-report.md`

结构（照 `docs/tasks/TASK-T16-01-report.md` 的风格：表格 + 原文 + 诚实）：

1. **头注**：工程师/PM/日期/rev（`285914c` + 工作树）/红线遵守声明（packages/sync·core 零 diff、不碰 git）。
2. **交付表**：D1–D5 → 文件 → 内容（含关键行数/新增用例数）。
3. **断点续作说明**：上轮中断点 + §0.3 四条 PM 修复原文转写（逐条：症状→根因→修法→证据）。
4. **裁决消费**：D1–D5 逐条 → 实现位置与测试证据（用例名）。
5. **验证**：你自跑的最终输出摘要（命令 + 通过数；原文贴关键行）。
6. **PM 复跑**：留「（PM 补）」占位小节，由 PM 追加 DoD 原文——**不要替 PM 伪造内容**。
7. **DEVIATIONS**：实现与任务书任何出入逐条列；无则写「无」。

**报告里禁止出现恢复码明文/任何密钥材料。**

## 5. 收尾交付
- 改动文件清单（绝对路径）+ 每条自跑命令的最后一次输出摘要（原地贴在你的最终回复里）。
- 不要跑 `pnpm -r test` 全仓（PM 跑）、不要跑 selftest（PM 跑）、**不要 git add/commit**。
