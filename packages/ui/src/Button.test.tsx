import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Check } from './Icon';


describe('Button', () => {
  it('变体 × 尺寸矩阵渲染；CSS 只引用 token', () => {
    const { container } = render(
      <>
        <Button variant="primary" size="md">
          主
        </Button>
        <Button variant="secondary" size="sm">
          次
        </Button>
        <Button variant="ghost" size="sm">
          隐
        </Button>
        <Button variant="destructive" size="md">
          删除
        </Button>
      </>,
    );
    expect(container.querySelectorAll('.sc-btn')).toHaveLength(4);
    expect(container.querySelector('.sc-btn--primary.sc-btn--md')).not.toBeNull();
    expect(container.querySelector('.sc-btn--secondary.sc-btn--sm')).not.toBeNull();
    expect(container.querySelector('.sc-btn--ghost.sc-btn--sm')).not.toBeNull();
    expect(container.querySelector('.sc-btn--destructive.sc-btn--md')).not.toBeNull();
    expectTokenOnlyCssFile('src/Button.css');
  });

  it('loading：禁用 + aria-busy + 图标级 Spinner，点击被吞掉', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        保存
      </Button>,
    );
    const button = screen.getByRole('button');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled：不可点；图标走 Icon 单一出口', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button disabled icon={Check} onClick={onClick}>
        确定
      </Button>,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(container.querySelector('.sc-icon')).not.toBeNull();
  });

  it('键盘可达：原生 button 且 type=button，可聚焦', () => {
    render(<Button onClick={() => undefined}>确定</Button>);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});
