import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorPanel } from './ErrorPanel';


describe('ErrorPanel', () => {
  it('role=alert + 说明 + 重试按钮', () => {
    const onRetry = vi.fn();
    render(<ErrorPanel description="同步文件夹当前不可访问，请检查网盘客户端是否在运行。" onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('同步文件夹当前不可访问');
    expect(screen.getByText('加载失败')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expectTokenOnlyCssFile('src/ErrorPanel.css');
  });

  it('无 onRetry 时不给按钮（不可恢复错误不假装能恢复）', () => {
    render(<ErrorPanel title="密钥不可恢复" description="本地钥匙串中找不到主密钥，且没有恢复码。" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('密钥不可恢复')).not.toBeNull();
  });
});
