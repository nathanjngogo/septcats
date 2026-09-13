import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, TOOLTIP_DELAY_MS } from './Tooltip';


describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hover 400ms 才出现；Esc 立即关闭；CSS 只引用 token', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tooltip content="上次同步 09:41">
        <button type="button">同步</button>
      </Tooltip>,
    );
    const wrapper = container.querySelector('.sc-tooltip') as HTMLElement;

    fireEvent.mouseEnter(wrapper);
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('上次同步 09:41');
    expect(wrapper.getAttribute('aria-describedby')).not.toBeNull();

    fireEvent.keyDown(wrapper, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expectTokenOnlyCssFile('src/Tooltip.css');
  });

  it('提前离开会取消计时器（不弹）', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tooltip content="恢复默认">
        <span>配色</span>
      </Tooltip>,
    );
    const wrapper = container.querySelector('.sc-tooltip') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 100);
    });
    fireEvent.mouseLeave(wrapper);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS + 100);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
