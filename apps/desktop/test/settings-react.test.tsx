// @vitest-environment jsdom
/**
 * settings-react.test.tsx —— 设置页 UI（TASK-T10-01 §5）。
 *
 * 覆盖：三区块渲染（外观/数据与隐私/诊断）、主题切换派发主题事件（setGlobalThemeMode）、
 * 诊断包导出预览流程。window.septcats 用 vi.stubGlobal 假桥替换；不 import electron。
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
} {
  const patch = vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p }));
  const exportDiag = vi.fn(async () => ({
    path: '/diagnostics/diag-1.json',
    preview: '{"meta":{"generatedAt":"2026-09-13T00:00:00.000Z"}}',
  }));
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
    ...overrides,
  };
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  return { patch, exportDiag };
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
