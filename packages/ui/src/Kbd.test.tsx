import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kbd } from './Kbd';


describe('Kbd', () => {
  it('原生 kbd 元素承载快捷键文案', () => {
    render(<Kbd>Ctrl+K</Kbd>);
    const node = screen.getByText('Ctrl+K');
    expect(node.tagName).toBe('KBD');
    expect(node.textContent).toBe('Ctrl+K');
    expectTokenOnlyCssFile('src/Kbd.css');
  });
});
