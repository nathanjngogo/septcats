import { expectTokenOnlyCssFile } from '../test/css-discipline';
import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Popover, type PopoverTriggerProps } from './Popover';


function triggerButton(props: PopoverTriggerProps): ReactElement {
  return (
    <button type="button" {...props}>
      配色
    </button>
  );
}

describe('Popover', () => {
  it('点击开合，aria-expanded 同步；点外与 Esc 关闭', () => {
    render(
      <Popover trigger={triggerButton} label="配色">
        <span>琥珀铃铛</span>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: '配色' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '配色' })).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();

    expectTokenOnlyCssFile('src/Popover.css');
  });
});
