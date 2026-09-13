import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Input } from './Input';


describe('Dialog', () => {
  it('open 时 role=dialog + aria-modal + aria-labelledby；Esc 关闭', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="删除页面" footer={<Button variant="destructive">删除</Button>}>
        删除后可在回收站保留 30 天。
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: '删除页面' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expectTokenOnlyCssFile('src/Dialog.css');
  });

  it('焦点圈闭：Tab 从末项回首项，Shift+Tab 从首项到末项', () => {
    render(
      <Dialog
        open
        onClose={() => undefined}
        title="导入预览"
        footer={
          <>
            <Button variant="secondary">取消</Button>
            <Button>开始导入</Button>
          </>
        }
      >
        <Input label="文件" />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    const runs = [...dialog.querySelectorAll<HTMLElement>('input, button')];
    const first = runs[0];
    const last = runs[runs.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    last?.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first?.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('关闭后卸载（open=false 返回 null）', () => {
    const { rerender } = render(
      <Dialog open onClose={() => undefined} title="设置">
        <span>内容</span>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeNull();
    rerender(
      <Dialog open={false} onClose={() => undefined} title="设置">
        <span>内容</span>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
