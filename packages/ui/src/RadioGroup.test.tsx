import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './RadioGroup';

const OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const;

describe('RadioGroup', () => {
  it('role=radiogroup + 原生 radio 语义；选中态反映 value', () => {
    render(<RadioGroup options={OPTIONS} value="system" label="主题" name="theme" />);
    const group = screen.getByRole('radiogroup', { name: '主题' });
    expect(group).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect((radios[2] as HTMLInputElement).checked).toBe(true);
    expectTokenOnlyCssFile('src/RadioGroup.css');
  });

  it('点击回调携带选中值', () => {
    const onChange = vi.fn();
    render(<RadioGroup options={OPTIONS} value="light" onChange={onChange} name="theme" />);
    fireEvent.click(screen.getByText('深色'));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('disabled：不可触发', () => {
    const onChange = vi.fn();
    render(<RadioGroup options={OPTIONS} value="light" onChange={onChange} name="theme" disabled />);
    const radio = screen.getAllByRole('radio')[0] as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    fireEvent.click(screen.getByText('深色'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
