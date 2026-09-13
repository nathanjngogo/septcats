import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tag } from './Tag';


describe('Tag', () => {
  it('三种语义色类名；默认为 neutral', () => {
    const { container } = render(
      <>
        <Tag>草稿</Tag>
        <Tag tone="amber">已选中</Tag>
        <Tag tone="red">冲突</Tag>
      </>,
    );
    expect(container.querySelector('.sc-tag--neutral')?.textContent).toBe('草稿');
    expect(container.querySelector('.sc-tag--amber')?.textContent).toBe('已选中');
    expect(container.querySelector('.sc-tag--red')?.textContent).toBe('冲突');
    expect(screen.getByText('冲突').tagName).toBe('SPAN');
    expectTokenOnlyCssFile('src/Tag.css');
  });
});
