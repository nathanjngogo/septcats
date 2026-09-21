// @vitest-environment jsdom
/**
 * sync-ui.test.tsx —— 同步状态面板 UI smoke（TASK-T13-01 §4）。
 *
 * 六态渲染（vi.stubGlobal 假桥 + sync.onState 推流驱动）：idle/syncing/ok/degraded/error
 * + key_mismatch 红条（T17-01 六态新增）；
 * 面板：设备列表、待发段、最近错误、立即同步、加密/启用开关。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatusSnapshot } from '../src/shared/sync';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';
import { SyncStatusButton } from '../src/renderer/src/sync/SyncStatus';

function statusOf(overrides: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot {
  return {
    state: 'ok',
    enabled: true,
    lastSyncAt: Date.now() - 60_000,
    devices: [
      { actorId: 'aaaa0001', lastLamport: 12, lastSeenAt: 1, clientVer: '0.1.0' },
      { actorId: 'bbbb0002', lastLamport: 9, lastSeenAt: 2, clientVer: '0.1.0' },
    ],
    pendingOps: 3,
    pendingSegs: 0,
    conflicts: 0,
    errors: [],
    ...overrides,
  };
}

const defaultSettings: AppSettings = {
  theme: 'system',
  locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  trayClose: 'ask',
  data: { note: '~/.septcats' },
  sync: { enabled: true, encrypt: false, gc: false },
  ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
};

interface Bridge {
  status: ReturnType<typeof vi.fn>;
  setEnabled: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
  onState: ReturnType<typeof vi.fn>;
}

function installBridge(initial: SyncStatusSnapshot): { bridge: Bridge; push: (s: SyncStatusSnapshot) => void } {
  let listener: ((s: SyncStatusSnapshot) => void) | null = null;
  const bridge: Bridge = {
    status: vi.fn(async () => initial),
    setEnabled: vi.fn(async (input: { on: boolean }) => statusOf({ enabled: input.on, state: input.on ? 'ok' : 'idle' })),
    now: vi.fn(async () => statusOf()),
    onState: vi.fn((l: (s: SyncStatusSnapshot) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
  };
  const stub = {
    ping: vi.fn(),
    appMeta: vi.fn(),
    settings: {
      get: vi.fn(async () => defaultSettings),
      patch: vi.fn(async () => defaultSettings),
    },
    sync: bridge,
  };
  vi.stubGlobal('septcats', stub as unknown as SeptcatsApi);
  return {
    bridge,
    push: (s: SyncStatusSnapshot) => listener?.(s),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderPill(initial: SyncStatusSnapshot = statusOf()) {
  const env = installBridge(initial);
  render(<SyncStatusButton />);
  await waitFor(() => expect(env.bridge.status).toHaveBeenCalled());
  return env;
}

describe('sync/UI 顶栏状态钮六态', () => {
  it('ok 态：绿点 + 已同步 · 相对时间', async () => {
    await renderPill();
    const pill = screen.getByRole('button', { name: '同步状态' });
    expect(pill.className).toContain('sc-sync-status__pill--ok');
    expect(pill.textContent).toContain('已同步');
    expect(pill.textContent).toMatch(/1 分钟前|刚刚/);
  });

  it('syncing 态：琥珀呼吸点 + 同步中', async () => {
    await renderPill(statusOf({ state: 'syncing' }));
    expect(screen.getByRole('button', { name: '同步状态' }).className).toContain(
      'sc-sync-status__pill--syncing',
    );
    expect(screen.getByRole('button', { name: '同步状态' }).textContent).toContain('同步中');
  });

  it('idle 态（enabled=false）：灰点 + 同步未开启', async () => {
    await renderPill(statusOf({ enabled: false, state: 'idle' }));
    const pill = screen.getByRole('button', { name: '同步状态' });
    expect(pill.className).toContain('sc-sync-status__pill--idle');
    expect(pill.textContent).toContain('同步未开启');
  });

  it('degraded 态：橙点 + 同步文件夹不可访问', async () => {
    await renderPill(statusOf({ state: 'degraded' }));
    const pill = screen.getByRole('button', { name: '同步状态' });
    expect(pill.className).toContain('sc-sync-status__pill--degraded');
    expect(pill.textContent).toContain('同步文件夹不可访问');
  });

  it('error 态（E_SYNC_KEY_MISMATCH 红条入口）：红点 + 同步错误', async () => {
    await renderPill(
      statusOf({
        state: 'error',
        errors: [{ code: 'E_SYNC_KEY_MISMATCH', message: '解密失败（密钥不符或密文被篡改）', at: 1 }],
      }),
    );
    const pill = screen.getByRole('button', { name: '同步状态' });
    expect(pill.className).toContain('sc-sync-status__pill--error');
    expect(pill.textContent).toContain('同步错误');
  });

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
});

describe('sync/UI 面板', () => {
  it('点击弹面板：设备列表/待发段/立即同步/开关，onState 推流可更新五态', async () => {
    const env = await renderPill();
    fireEvent.click(screen.getByRole('button', { name: '同步状态' }));

    // 设备列表（actorId + 水位）
    expect(await screen.findByText('aaaa0001')).toBeDefined();
    expect(screen.getByText('水位 12')).toBeDefined();
    expect(screen.getByText('bbbb0002')).toBeDefined();
    // 待发段 3 + 0
    expect(screen.getByText('3')).toBeDefined();
    // 开关两枚（同步启用 + 加密）
    expect(screen.getByRole('switch', { name: '启用同步' })).toBeDefined();
    expect(screen.getByRole('switch', { name: '加密同步段' })).toBeDefined();
    // 最近错误空态
    expect(screen.getByText('无')).toBeDefined();

    // onState 推流：面板内状态行同步更新为 degraded
    env.push(statusOf({ state: 'degraded' }));
    await waitFor(() => expect(screen.getAllByText('同步文件夹不可访问').length).toBeGreaterThan(0));

    // 立即同步 → sync:now
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(env.bridge.now).toHaveBeenCalled());

    // 加密开关 → settings.patch({sync:{encrypt:true}})
    fireEvent.click(screen.getByRole('switch', { name: '加密同步段' }));
    await waitFor(() =>
      expect(env.bridge.status).toHaveBeenCalled(),
    );
    expect(
      (window.septcats.settings.patch as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => JSON.stringify(call[0]) === JSON.stringify({ sync: { encrypt: true } }),
      ),
    ).toBe(true);

    // Esc 关闭
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('setEnabled(false) → idle 态；「立即同步」在未启用时禁用', async () => {
    const env = await renderPill();
    fireEvent.click(screen.getByRole('button', { name: '同步状态' }));
    fireEvent.click(screen.getByRole('switch', { name: '启用同步' }));
    await waitFor(() => expect(env.bridge.setEnabled).toHaveBeenCalledWith({ on: false }));
    env.push(statusOf({ enabled: false, state: 'idle' }));
    await waitFor(() => expect(screen.getAllByText('同步未开启').length).toBeGreaterThan(0));
    expect(
      (screen.getByRole('button', { name: '立即同步' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
