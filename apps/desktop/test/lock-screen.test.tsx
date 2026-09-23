// @vitest-environment jsdom
/**
 * lock-screen.test.tsx —— 锁屏卡（范围2）渲染/交互用例（TASK-T67-01-B2-01）。
 *
 * 覆盖：错口令→失败计数文案（含剩余次数）；对口令→onUnlock 解除；
 * E_LOCK_LOCKED→输入禁用；恢复码折叠→recover 成功展示一次性新恢复码。
 * 纪律：不 import electron；window.septcats 用 vi.stubGlobal 假桥替换；
 * 口令/恢复码值只经组件 state，不落 localStorage/日志（grep 自查）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LockStatusView } from '../src/renderer/src/lockStatus';
import { PageLockScreen } from '../src/renderer/src/pages/PageLockScreen';
import type { SeptcatsApi } from '../src/types/window';

interface LockBridge {
  getStatus: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  recover: ReturnType<typeof vi.fn>;
}

function installLockBridge(overrides: Partial<LockBridge> = {}): LockBridge {
  const lock: LockBridge = {
    getStatus: vi.fn(async (): Promise<LockStatusView> => ({
      locked: true,
      failures: 0,
      lockedUntil: null,
    })),
    verify: vi.fn(async () => ({ ok: true })),
    recover: vi.fn(async () => ({ ok: true as const, recoveryCode: 'ABCD-1234-EFGH' })),
    ...overrides,
  };
  const bridge = { lock } as unknown as SeptcatsApi;
  vi.stubGlobal('septcats', bridge);
  return lock;
}

const PAGE = { pageId: 'pg-lk', title: '机密页' };

beforeEach(() => {
  installLockBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PageLockScreen（范围2 锁屏卡）', () => {
  it('错口令 → 失败提示含「剩余次数」文案（attemptsLeft）', async () => {
    const lock = installLockBridge({
      getStatus: vi.fn(async (): Promise<LockStatusView> => ({
        locked: true,
        failures: 3,
        lockedUntil: null,
      })),
      verify: vi.fn(async () => {
        throw new Error('E_LOCK_BADPASS 口令错误');
      }),
    });
    const onUnlock = vi.fn();
    render(<PageLockScreen pageId={PAGE.pageId} title={PAGE.title} onUnlock={onUnlock} />);

    const input = await screen.findByTestId('lock-pass-input');
    const user = userEvent.setup();
    await user.type(input, 'wrongpass');
    await user.click(screen.getByTestId('lock-unlock-button'));

    const error = await screen.findByTestId('lock-error');
    expect(error.textContent).toContain('剩余');
    expect(onUnlock).not.toHaveBeenCalled();
    expect(lock.getStatus).toHaveBeenCalled();
  });

  it('E_LOCK_LOCKED → 输入禁用 + 倒计时禁用态', async () => {
    const lockedUntil = Date.now() + 60_000;
    installLockBridge({
      getStatus: vi.fn(async (): Promise<LockStatusView> => ({
        locked: true,
        failures: 5,
        lockedUntil,
      })),
    });
    render(<PageLockScreen pageId={PAGE.pageId} title={PAGE.title} onUnlock={vi.fn()} />);
    const input = (await screen.findByTestId('lock-pass-input')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const countdown = screen.getByTestId('lock-countdown');
    expect(countdown.textContent).toContain('60');
  });

  it('对口令 → onUnlock 携带 { locked:false }（解锁渲染真内容）', async () => {
    const onUnlock = vi.fn();
    render(<PageLockScreen pageId={PAGE.pageId} title={PAGE.title} onUnlock={onUnlock} />);
    const input = await screen.findByTestId('lock-pass-input');
    const user = userEvent.setup();
    await user.type(input, 'secret123');
    await user.click(screen.getByTestId('lock-unlock-button'));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(onUnlock.mock.calls[0]?.[0]).toEqual({ locked: false, unlockedInSession: true, failures: 0, lockedUntil: null });
  });

  it('使用恢复码折叠 → recover 成功展示一次性新恢复码（lock-new-recovery）', async () => {
    const lock = installLockBridge();
    render(<PageLockScreen pageId={PAGE.pageId} title={PAGE.title} onUnlock={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('lock-use-recovery'));

    const code = (await screen.findByTestId('lock-recovery-input')) as HTMLInputElement;
    const np = screen.getByTestId('lock-new-pass') as HTMLInputElement;
    const np2 = screen.getByTestId('lock-new-pass2') as HTMLInputElement;
    await user.type(code, 'WXYZ-9876');
    await user.type(np, 'newpass01');
    await user.type(np2, 'newpass01');
    await user.click(screen.getByTestId('lock-recover-button'));

    const box = await screen.findByTestId('lock-new-recovery');
    expect(box.textContent).toContain('ABCD-1234-EFGH');
    expect(lock.recover).toHaveBeenCalledWith({ pageId: PAGE.pageId, code: 'WXYZ-9876', newPass: 'newpass01' });
  });

  it('blur 不提交（D1：口令类全局例外）——失焦不触发 verify', async () => {
    const lock = installLockBridge();
    render(<PageLockScreen pageId={PAGE.pageId} title={PAGE.title} onUnlock={vi.fn()} />);
    const input = (await screen.findByTestId('lock-pass-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'secret123' } });
    fireEvent.blur(input);
    // 失焦不应调用 verify（仅 Enter / 提交钮触发）
    expect(lock.verify).not.toHaveBeenCalled();
  });
});
