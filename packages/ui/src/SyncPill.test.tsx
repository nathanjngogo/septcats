import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncPill } from './SyncPill';


describe('SyncPill', () => {
  it('三态类名与文案；tooltip 含「上次同步 HH:mm」', () => {
    const { rerender } = render(<SyncPill state="idle" lastSyncedAt="09:41" />);
    const idle = screen.getByRole('status');
    expect(idle.getAttribute('class')).toContain('sc-sync--idle');
    expect(idle.getAttribute('title')).toBe('上次同步 09:41');
    expect(idle.textContent).toBe('已同步');

    rerender(<SyncPill state="busy" lastSyncedAt="09:41" />);
    expect(screen.getByRole('status').getAttribute('class')).toContain('sc-sync--busy');
    expect(screen.getByRole('status').textContent).toBe('同步中');

    rerender(<SyncPill state="alert" pendingCount={3} lastSyncedAt="09:41" />);
    const alert = screen.getByRole('status');
    expect(alert.getAttribute('class')).toContain('sc-sync--alert');
    expect(alert.querySelector('.sc-sync__badge')?.textContent).toBe('3');
    expectTokenOnlyCssFile('src/SyncPill.css');
  });

  it('alert 无计数不渲染角标；缺省时间也有「上次同步」', () => {
    const { rerender } = render(<SyncPill state="alert" />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByRole('status').getAttribute('title')).toBe('上次同步 未知');
    rerender(<SyncPill state="idle" />);
    expect(screen.getByRole('status').getAttribute('class')).toContain('sc-sync--idle');
  });
});
