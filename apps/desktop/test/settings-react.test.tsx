// @vitest-environment jsdom
/**
 * settings-react.test.tsx —— 设置页 UI（TASK-T10-01 §5）。
 *
 * 覆盖：三区块渲染（外观/数据与隐私/诊断）、主题切换派发主题事件（setGlobalThemeMode）、
 * 诊断包导出预览流程。window.septcats 用 vi.stubGlobal 假桥替换；不 import electron。
 * T17-01：同步密钥三件套（导出勾选门控 / 导入校验反馈 / 轮换确认）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';
import { SettingsPage } from '../src/renderer/src/pages/SettingsPage';

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '~/.septcats' },
    sync: { enabled: true, encrypt: false, gc: false },
  };
}

function installBridge(overrides: Partial<SeptcatsApi> = {}): {
  patch: ReturnType<typeof vi.fn>;
  exportDiag: ReturnType<typeof vi.fn>;
  exportRecovery: ReturnType<typeof vi.fn>;
  importRecovery: ReturnType<typeof vi.fn>;
  rotateKey: ReturnType<typeof vi.fn>;
} {
  const patch = vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p }));
  const exportDiag = vi.fn(async () => ({
    path: '/diagnostics/diag-1.json',
    preview: '{"meta":{"generatedAt":"2026-09-13T00:00:00.000Z"}}',
  }));
  // T17-01 D5：同步密钥三件套 mock（既有用例不触达，仅防桥缺失 + 供新用例断言）
  const exportRecovery = vi.fn(async () => ({
    code: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ',
  }));
  const importRecovery = vi.fn(async () => ({ ok: true as const, keyId: 'a1b2c3d4' }));
  const rotateKey = vi.fn(async () => ({ startedAt: 1 }));
  const bridge = {
    ping: vi.fn(),
    appMeta: vi.fn(async () => ({
      name: 'Septcats',
      version: '0.0.0',
      schemaVersion: 1,
      layoutRoot: '.septcats',
    })),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      patch,
    },
    diag: {
      export: exportDiag,
      confirm: vi.fn(async () => ({ path: '/diagnostics/diag-1.json' })),
    },
    // M10-B：更新桥（本文件用例不触达，仅防 SettingsPage 订阅 onState 时桥缺失）
    update: {
      check: vi.fn(async () => ({ status: 'idle' }) as const),
      download: vi.fn(async () => ({ status: 'idle' }) as const),
      install: vi.fn(async () => ({ ok: true }) as const),
      rollbackHint: vi.fn(async () => ({ state: { status: 'idle' } as const, hint: '' })),
      onState: vi.fn(() => () => {}),
    },
    // T17-01：同步桥（status 等四件为完备性占位，SettingsPage 不触达）
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
      exportRecovery,
      importRecovery,
      rotateKey,
    },
    ...overrides,
  };
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  return { patch, exportDiag, exportRecovery, importRecovery, rotateKey };
}

beforeEach(() => {
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsPage（三区块 + 无障碍）', () => {
  it('渲染三区块：外观 / 数据与隐私 / 诊断，且主题为 radiogroup', async () => {
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    expect(screen.getByText('外观')).toBeDefined();
    expect(screen.getByText('数据与隐私')).toBeDefined();
    expect(screen.getByText('诊断')).toBeDefined();

    const group = await screen.findByRole('radiogroup', { name: '主题' });
    expect(group).toBeDefined();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('主题切换派发 septcats:theme-mode（setGlobalThemeMode）并 patch', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { patch } = installBridge();

    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    fireEvent.click(screen.getByText('深色'));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'septcats:theme-mode' }),
      );
    });
    const call = dispatchSpy.mock.calls.find(([event]) => {
      return (event as CustomEvent).type === 'septcats:theme-mode';
    });
    expect((call?.[0] as CustomEvent).detail).toEqual({ mode: 'dark' });

    await waitFor(() => expect(patch).toHaveBeenCalledWith({ theme: 'dark' }));
    dispatchSpy.mockRestore();
  });

  it('诊断包导出：点导出 → 显示脱敏预览 + 确认/取消', async () => {
    const { exportDiag } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导出诊断包' }));
    await waitFor(() => expect(exportDiag).toHaveBeenCalled());

    expect(await screen.findByText('诊断包预览（已脱敏）')).toBeDefined();
    expect(screen.getByRole('button', { name: '确认保存' })).toBeDefined();
    expect(screen.getByRole('button', { name: '取消' })).toBeDefined();
    // 预览文本在只读 <pre> 里
    expect(screen.getByLabelText('诊断包预览（已脱敏）').textContent).toContain('generatedAt');
  });
});

describe('设置页 · 同步密钥三件套（T17-01）', () => {
  it('导出：勾选门控——完成按钮初始 disabled，勾选后可点并关窗', async () => {
    const { exportRecovery } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导出恢复码' }));
    await waitFor(() => expect(exportRecovery).toHaveBeenCalled());

    expect(await screen.findByText('恢复码（仅显示这一次）')).toBeDefined();
    expect(screen.getByTestId('recovery-code').textContent).toContain('AAAAA-BBBBB');

    const done = screen.getByRole('button', { name: '完成' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('我已安全保存恢复码'));
    await waitFor(() => expect(done.disabled).toBe(false));

    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByText('恢复码（仅显示这一次）')).toBeNull());
  });

  it('导出-失败态：role=alert 含凭据存储不可用', async () => {
    const { exportRecovery } = installBridge();
    exportRecovery.mockRejectedValueOnce(new Error('E_INVARIANT：凭据存储不可用'));
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导出恢复码' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('凭据存储不可用');
  });

  it('导入：先错（长度非法）后对（key_id 反馈）', async () => {
    const { importRecovery } = installBridge();
    importRecovery.mockRejectedValueOnce(
      new Error('E_MALFORMED：恢复码长度非法：期望 52 字符（去横杠后），实际 10'),
    );
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导入恢复码' }));
    const textarea = screen.getByRole('textbox', { name: '导入恢复码' }) as HTMLTextAreaElement;
    await screen.findByText('导入并追平');

    fireEvent.change(textarea, { target: { value: 'AAAAA-BBBBB' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并追平' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('恢复码长度非法');

    fireEvent.change(textarea, { target: { value: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并追平' }));
    const ok = await screen.findByTestId('recovery-import-ok');
    expect(ok.textContent).toContain('a1b2c3d4');
    await waitFor(() => expect(importRecovery).toHaveBeenCalledTimes(2));
  });

  it('轮换：确认弹窗 → rotateKey 被调 → 反馈行出现', async () => {
    const { rotateKey } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '轮换密钥' }));
    expect(await screen.findByText('轮换会生成新钥匙并重加密同步目录中的历史段，旧恢复码立即作废。请轮换完成后重新导出并保存新的恢复码。')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '确认轮换' }));
    await waitFor(() => expect(rotateKey).toHaveBeenCalled());

    const note = await screen.findByTestId('settings-rotate-note');
    expect(note.textContent).toBe('已开始后台重加密，进度见顶栏同步状态');
  });
});
