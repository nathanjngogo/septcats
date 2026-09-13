import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';


const options = [
  { value: 'table', label: '表格视图' },
  { value: 'board', label: '看板视图' },
  { value: 'calendar', label: '日历视图' },
] as const;

function root(container: HTMLElement): HTMLElement {
  const node = container.querySelector('.sc-select');
  if (node === null) {
    throw new Error('缺少 .sc-select 根节点');
  }
  return node as HTMLElement;
}

describe('Select', () => {
  it('闭合态只渲染 trigger（aria-expanded=false），选中项文案正确', () => {
    const { container } = render(<Select options={options} value="board" label="视图" />);
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(container.textContent).toContain('看板视图');
    expect(screen.queryByRole('listbox')).toBeNull();
    expectTokenOnlyCssFile('src/Select.css');
  });

  it('方向键展开 listbox，Enter 选中并回调，Esc 关闭', () => {
    const onChange = vi.fn();
    const { container } = render(<Select options={options} value="table" onChange={onChange} label="视图" />);
    const box = root(container);

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    expect(listbox).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(listbox.getAttribute('aria-labelledby')).not.toBeNull();

    // 初始高亮在已选项（索引 0）→ ↓ 到索引 1 → Enter 选中 board
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('board');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('点击选项选中；aria-selected 只落在当前值上', () => {
    const onChange = vi.fn();
    const { container } = render(<Select options={options} value="table" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    const items = screen.getAllByRole('option');
    expect(items[0]?.getAttribute('aria-selected')).toBe('true');
    expect(items[1]?.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(items[2] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('calendar');
    expect(root(container)).not.toBeNull();
  });

  it('disabled：不展开、不可点', () => {
    const { container } = render(<Select options={options} value="table" disabled label="视图" />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(root(container), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
