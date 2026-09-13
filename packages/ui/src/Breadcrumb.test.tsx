import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Breadcrumb } from './Breadcrumb';


describe('Breadcrumb', () => {
  it('最后一项为 aria-current=page，其余为路径；分隔符装饰性', () => {
    render(<Breadcrumb items={[{ label: '研究' }, { label: '论文速览' }, { label: '暗物质探测实验笔记' }]} />);
    const nav = screen.getByRole('navigation', { name: '面包屑' });
    expect(nav).not.toBeNull();
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('暗物质探测实验笔记');
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(nav.querySelectorAll('.sc-crumb__sep')).toHaveLength(2);
    expect(nav.querySelector('.sc-crumb__sep')?.getAttribute('aria-hidden')).toBe('true');
    expectTokenOnlyCssFile('src/Breadcrumb.css');
  });
});
