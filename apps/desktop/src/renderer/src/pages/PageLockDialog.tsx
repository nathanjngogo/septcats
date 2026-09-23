/**
 * PageLockDialog.tsx —— 加锁/改密/移除 弹层（T67-01-B2-01 范围1）。
 *
 * 由 pagesStore.lockDialog 驱动（侧栏行菜单 + 命令面板共用同一入口）：
 * - set：两栏口令（显示/隐藏 eye 钮）+「恢复码将由我保管」必勾 → setPass →
 *   成功后弹**恢复码展示框**（等宽大字 + 「我已抄写保存」确认钮才可关；明写"只显示这一次"）。
 * - change：当前口令 + 新口令两栏 → changePass。
 * - remove：口令验证 → remove（解锁当前页，lockRev 驱动 PageView 立即卸载编辑器）。
 *
 * 红线：恢复码/口令值仅存本组件 state（内存），绝不写 localStorage/日志（grep 自查）。
 * 恢复码展示框复用既有 @septcats/ui Dialog（焦点圈闭/Esc/遮罩关闭），天然叠一切弹层（§16 纪律）。
 */
import { useEffect, useState } from 'react';
import { Button, Dialog } from '@septcats/ui';
import { nodeMap, pagesActions, usePages } from '../state/pages';
import { t } from '../i18n';
import './PageLockDialog.css';

function lockErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/E_LOCK_BADPASS/.test(message)) return t('lock.wrongPass');
  if (/E_LOCK_LOCKED/.test(message)) return t('lock.lockedFor').replace('{n}', '60');
  if (/E_LOCK_NOT_SET/.test(message)) return t('lock.notSet');
  if (/E_LOCK_RECOVERY_USED/.test(message)) return t('lock.recoveryRequired');
  return message;
}

export function PageLockDialog() {
  const lockDialog = usePages((state) => state.lockDialog);
  const nodes = usePages((state) => state.nodes);

  const title = (() => {
    if (lockDialog === null) {
      return '';
    }
    const node = nodeMap(nodes).get(lockDialog.pageId);
    return node?.title ?? '';
  })();

  const [pass, setPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 弹层开合/模式切换时重置表单（避免上一次输入残留到下一次）
  useEffect(() => {
    setPass('');
    setNewPass('');
    setConfirm('');
    setShowPass(false);
    setKeep(false);
    setError(null);
    setRecoveryCode(null);
    setBusy(false);
  }, [lockDialog]);

  if (lockDialog === null) {
    return null;
  }
  const { pageId, mode } = lockDialog;

  const close = (): void => {
    pagesActions.closeLockDialog();
  };

  async function submitSet(): Promise<void> {
    setError(null);
    if (pass.length === 0) {
      setError(t('lock.passRequired'));
      return;
    }
    if (pass !== confirm) {
      setError(t('lock.mismatch'));
      return;
    }
    if (!keep) {
      setError(t('lock.keepRecovery'));
      return;
    }
    setBusy(true);
    try {
      const res = await window.septcats.lock.setPass({ pageId, pass });
      setRecoveryCode(res.recoveryCode);
    } catch (err) {
      setError(lockErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitChange(): Promise<void> {
    setError(null);
    if (pass.length === 0 || newPass.length === 0) {
      setError(t('lock.passRequired'));
      return;
    }
    if (newPass !== confirm) {
      setError(t('lock.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await window.septcats.lock.changePass({ pageId, oldPass: pass, newPass });
      close();
    } catch (err) {
      setError(lockErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRemove(): Promise<void> {
    setError(null);
    if (pass.length === 0) {
      setError(t('lock.passRequired'));
      return;
    }
    setBusy(true);
    try {
      await window.septcats.lock.remove({ pageId, pass });
      // 解锁当前打开的编辑器（lockRev bump → PageView 立即重探并卸载编辑器）
      pagesActions.setPageLocked(pageId, false);
      close();
    } catch (err) {
      setError(lockErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  // set 成功：一次性恢复码展示框（叠于 Dialog，天然最高层）
  if (recoveryCode !== null) {
    return (
      <Dialog
        open
        title={t('lock.recoveryTitle')}
        onClose={close}
        footer={
          <Button
            variant="primary"
            data-testid="lock-recovery-ok"
            onClick={() => {
              pagesActions.setPageLocked(pageId, true);
              close();
            }}
          >
            {t('lock.iSaved')}
          </Button>
        }
      >
        <p className="lock-dialog-hint">{t('lock.recoveryOnce')}</p>
        <div className="lock-recovery-box" data-testid="lock-recovery-code">
          <code className="lock-mono">{recoveryCode}</code>
        </div>
        <button
          type="button"
          className="lock-dialog-copy"
          data-testid="lock-recovery-copy"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
              void navigator.clipboard.writeText(recoveryCode).catch(() => undefined);
            }
          }}
        >
          {t('lock.copied')}
        </button>
      </Dialog>
    );
  }

  const titleKey =
    mode === 'set' ? 'dialogTitleSet' : mode === 'change' ? 'dialogTitleChange' : 'dialogTitleRemove';

  return (
    <Dialog
      open
      title={t(`lock.${titleKey}`)}
      onClose={close}
      footer={
        mode === 'set' ? (
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" data-testid="lock-set-button" disabled={busy} onClick={() => void submitSet()}>
              {t('lock.setButton')}
            </Button>
          </>
        ) : mode === 'change' ? (
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" data-testid="lock-change-button" disabled={busy} onClick={() => void submitChange()}>
              {t('lock.changeButton')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" data-testid="lock-remove-button" disabled={busy} onClick={() => void submitRemove()}>
              {t('lock.removeButton')}
            </Button>
          </>
        )
      }
    >
      <p className="lock-dialog-title" data-testid="lock-dialog-title">
        {title}
      </p>

      {mode === 'change' ? (
        <label className="lock-dialog-field">
          <span>{t('lock.passLabel')}</span>
          <input
            className="lock-input"
            type={showPass ? 'text' : 'password'}
            data-testid="lock-current-pass"
            value={pass}
            autoComplete="off"
            onChange={(event) => setPass(event.target.value)}
          />
        </label>
      ) : (
        <label className="lock-dialog-field">
          <span>{t('lock.passLabel')}</span>
          <input
            className="lock-input"
            type={showPass ? 'text' : 'password'}
            data-testid="lock-pass"
            value={pass}
            autoComplete="off"
            onChange={(event) => setPass(event.target.value)}
          />
        </label>
      )}

      {mode === 'change' && (
        <label className="lock-dialog-field">
          <span>{t('lock.newPassLabel')}</span>
          <input
            className="lock-input"
            type={showPass ? 'text' : 'password'}
            data-testid="lock-new-pass"
            value={newPass}
            autoComplete="off"
            onChange={(event) => setNewPass(event.target.value)}
          />
        </label>
      )}

      {(mode === 'set' || mode === 'change') && (
        <label className="lock-dialog-field">
          <span>{mode === 'change' ? t('lock.newPassConfirmLabel') : t('lock.confirmPassLabel')}</span>
          <input
            className="lock-input"
            type={showPass ? 'text' : 'password'}
            data-testid="lock-confirm-pass"
            value={confirm}
            autoComplete="off"
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
      )}

      <button
        type="button"
        className="lock-eye"
        data-testid="lock-dialog-show-pass"
        onClick={() => setShowPass((value) => !value)}
      >
        {showPass ? t('lock.hidePass') : t('lock.showPass')}
      </button>

      {mode === 'set' ? (
        <label className="lock-dialog-check">
          <input
            type="checkbox"
            data-testid="lock-keep"
            checked={keep}
            onChange={(event) => setKeep(event.target.checked)}
          />
          <span>
            {t('lock.keepRecovery')}
            <em className="lock-dialog-check-hint">{t('lock.keepRecoveryHint')}</em>
          </span>
        </label>
      ) : null}

      {error !== null ? (
        <p className="lock-error" data-testid="lock-dialog-error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
