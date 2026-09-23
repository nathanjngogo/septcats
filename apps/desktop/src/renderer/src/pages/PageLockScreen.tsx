/**
 * PageLockScreen.tsx —— 锁屏卡（T67-01-B2-01 范围2）。
 *
 * 编辑列位替代 .pv-root 内容：锁 glyph + 页标题 + 口令输入（Enter=验证；**blur 不提交**
 * = 口令类全局例外，报告记 D1）+ 失败提示含剩余次数；E_LOCK_LOCKED / lockedUntil
 * 生效 → 输入禁用 + 秒级倒计时（展示用本地时钟，判定以主进程返回码为准）；
 * 「使用恢复码」折叠区 → recover → 成功展示新恢复码 → 进内容。
 *
 * 红线：锁屏态编辑器彻底卸载（PageView 在 locked 时根本不渲染本组件之外的编辑器/
 * 不请求 blocks）——本组件内不 mount ProseMirror，也不读 blocks。
 * 口令/恢复码值仅存本组件 state（内存），绝不写 localStorage/日志（红线自查）。
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { LockGlyph } from '../components/LockGlyph';
import type { LockStatusView } from '../lockStatus';
import './PageLockScreen.css';

const MAX_FAILURES = 5;

export interface PageLockScreenProps {
  pageId: string;
  title: string;
  /** 解锁成功回调（verify/recover 后）：父组件据此解除 locked 并重新加载 blocks。 */
  onUnlock: (status: LockStatusView) => void;
}

function errorCodeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/E_LOCK_LOCKED/.test(message)) return 'E_LOCK_LOCKED';
  if (/E_LOCK_BADPASS/.test(message)) return 'E_LOCK_BADPASS';
  if (/E_LOCK_NOT_SET/.test(message)) return 'E_LOCK_NOT_SET';
  return 'OTHER';
}

export function PageLockScreen({ pageId, title, onUnlock }: PageLockScreenProps) {
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [newRecovery, setNewRecovery] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = (): void => {
    window.septcats.lock
      .getStatus({ pageId })
      .then((status) => {
        setFailures(status.failures);
        setLockedUntil(status.lockedUntil);
      })
      .catch(() => {
        setFailures(0);
        setLockedUntil(null);
      });
  };

  useEffect(() => {
    refresh();
  }, [pageId]);

  // 倒计时：lockedUntil 有效时每秒强制重渲（展示用本地时钟，判定以主进程返回为准）
  const counting = lockedUntil !== null && lockedUntil > Date.now();
  useEffect(() => {
    if (!counting) {
      return;
    }
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  const remaining = lockedUntil !== null ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  async function doVerify(event?: React.FormEvent): Promise<void> {
    if (event !== undefined) {
      event.preventDefault();
    }
    setError(null);
    if (pass.length === 0) {
      setError(t('lock.passRequired'));
      return;
    }
    try {
      await window.septcats.lock.verify({ pageId, pass });
      onUnlock({ locked: false, failures: 0, lockedUntil: null });
    } catch (err) {
      const code = errorCodeOf(err);
      setErrorCode(code);
      refresh();
      if (code === 'E_LOCK_LOCKED') {
        setError(t('lock.lockedFor').replace('{n}', String(remaining > 0 ? remaining : 60)));
      } else if (code === 'E_LOCK_NOT_SET') {
        setError(t('lock.notSet'));
      } else {
        setError(t('lock.wrongPass'));
      }
    }
  }

  async function doRecover(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (recoveryCode.length === 0) {
      setError(t('lock.recoveryRequired'));
      return;
    }
    if (newPass.length === 0) {
      setError(t('lock.passRequired'));
      return;
    }
    if (newPass !== newPass2) {
      setError(t('lock.mismatch'));
      return;
    }
    try {
      const res = await window.septcats.lock.recover({ pageId, code: recoveryCode, newPass });
      setNewRecovery(res.recoveryCode);
    } catch (err) {
      const code = errorCodeOf(err);
      setErrorCode(code);
      setError(code === 'E_LOCK_LOCKED' ? t('lock.lockedFor').replace('{n}', String(remaining)) : t('lock.wrongPass'));
    }
  }

  // recover 成功：展示一次性新恢复码 + 进入内容
  if (newRecovery !== null) {
    return (
      <div className="lock-screen-root" data-testid="lock-screen">
        <div className="lock-card">
          <LockGlyph size={28} className="lock-glyph" />
          <h2 className="lock-title">{title}</h2>
          <p className="lock-hint lock-hint--ok">{t('lock.newCodeHint')}</p>
          <div className="lock-recovery-box" data-testid="lock-new-recovery">
            <code className="lock-mono">{newRecovery}</code>
          </div>
          <ButtonEnterContent onClick={() => onUnlock({ locked: false, failures: 0, lockedUntil: null })} />
        </div>
      </div>
    );
  }

  return (
    <div className="lock-screen-root" data-testid="lock-screen">
      <div className="lock-card">
        <LockGlyph size={28} className="lock-glyph" />
        <h2 className="lock-title">{title}</h2>
        {counting ? (
          <p className="lock-countdown" data-testid="lock-countdown">
            {t('lock.lockedFor').replace('{n}', String(remaining))}
          </p>
        ) : (
          <p className="lock-hint">{t('lock.screenTitle')}</p>
        )}

        <form className="lock-form" onSubmit={doVerify}>
          <input
            ref={inputRef}
            className="lock-input"
            type={showPass ? 'text' : 'password'}
            data-testid="lock-pass-input"
            placeholder={t('lock.passLabel')}
            value={pass}
            disabled={counting}
            autoComplete="off"
            // D1：口令类全局例外——blur 不提交（不挂 onBlur 提交逻辑）
            onChange={(event) => setPass(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void doVerify();
              }
            }}
          />
          <button
            type="button"
            className="lock-eye"
            data-testid="lock-show-pass"
            aria-label={showPass ? t('lock.hidePass') : t('lock.showPass')}
            onClick={() => setShowPass((value) => !value)}
          >
            {showPass ? t('lock.hidePass') : t('lock.showPass')}
          </button>
            {error !== null ? (
            <p className="lock-error" data-testid="lock-error">
              {error}
              {errorCode === 'E_LOCK_BADPASS' && failures > 0 ? (
                <> · {t('lock.attemptsLeft').replace('{n}', String(Math.max(0, MAX_FAILURES - failures)))}</>
              ) : null}
            </p>
          ) : null}
          <button type="submit" className="lock-submit" data-testid="lock-unlock-button" disabled={counting}>
            {t('lock.unlock')}
          </button>
        </form>

        {!recovering ? (
          <button
            type="button"
            className="lock-link"
            data-testid="lock-use-recovery"
            onClick={() => setRecovering(true)}
          >
            {t('lock.useRecovery')}
          </button>
        ) : (
          <form className="lock-form lock-form--recover" onSubmit={doRecover}>
            <label className="lock-label">{t('lock.recoveryCodeLabel')}</label>
            <input
              className="lock-input"
              type="text"
              data-testid="lock-recovery-input"
              value={recoveryCode}
              autoComplete="off"
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
            />
            <label className="lock-label">{t('lock.newPassLabel')}</label>
            <input
              className="lock-input"
              type={showPass ? 'text' : 'password'}
              data-testid="lock-new-pass"
              value={newPass}
              autoComplete="off"
              onChange={(event) => setNewPass(event.target.value)}
            />
            <label className="lock-label">{t('lock.newPassConfirmLabel')}</label>
            <input
              className="lock-input"
              type={showPass ? 'text' : 'password'}
              data-testid="lock-new-pass2"
              value={newPass2}
              autoComplete="off"
              onChange={(event) => setNewPass2(event.target.value)}
            />
            <button type="submit" className="lock-submit" data-testid="lock-recover-button">
              {t('lock.recoverButton')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ButtonEnterContent({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="lock-submit" data-testid="lock-enter-content" onClick={onClick}>
      {t('lock.unlock')}
    </button>
  );
}
