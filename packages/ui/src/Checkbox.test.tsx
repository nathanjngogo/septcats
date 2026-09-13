import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';


describe('Checkbox', () => {
  it('原生 checkbox 语义 + label 关联 + 键盘可切换', () => {
    const onChange = vi.fn();
    render(<Checkbox label="录入阅读清单" onChange={onChange} />);
    const input = screen.getByRole('checkbox', { name: '录入阅读清单' }) as HTMLInputElement;
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(false);
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expectTokenOnlyCssFile('src/Checkbox.css');
  });

  it('受控 checked + disabled 状态矩阵', () => {
    const { rerender } = render(<Checkbox label="已完成" checked readOnly />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    rerender(<Checkbox label="已完成" checked readOnly disabled />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBeNull();
  });

  it('indeterminate 走 DOM 属性（视觉与 aria 由原生承载）', () => {
    render(<Checkbox label="部分选中" indeterminate />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).indeterminate).toBe(true);
  });
});
