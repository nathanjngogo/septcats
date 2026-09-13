import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './Input';


describe('Input', () => {
  it('结构固定：label 上 / 控件 / helper 中 / error 下', () => {
    const { container } = render(
      <Input label="数据库名称" helper="仅本地可见" error="名称已被占用" defaultValue="阅读清单" />,
    );
    const field = container.querySelector('.sc-field');
    expect(field).not.toBeNull();
    const children = [...(field?.children ?? [])].map((node) => node.className);
    expect(children).toEqual([
      'sc-field__label',
      'sc-field__control',
      'sc-field__helper',
      'sc-field__error',
    ]);

    const input = screen.getByLabelText('数据库名称') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('-helper');
    expect(input.getAttribute('aria-describedby')).toContain('-error');
    expect(screen.getByRole('alert').textContent).toBe('名称已被占用');
    expectTokenOnlyCssFile('src/Input.css');
  });

  it('错误态挂 sc-field--error；正常态无 role=alert 且 aria-invalid 缺省', () => {
    const { container, rerender } = render(<Input label="标题" />);
    expect(container.querySelector('.sc-field--error')).toBeNull();
    expect(screen.getByLabelText('标题').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<Input label="标题" error="不能为空" />);
    expect(container.querySelector('.sc-field--error')).not.toBeNull();
    expect(screen.getByLabelText('标题').getAttribute('aria-invalid')).toBe('true');
  });

  it('disabled 透传到原生控件（键盘/点击均被浏览器拦截）', () => {
    render(<Input label="标题" disabled />);
    expect((screen.getByLabelText('标题') as HTMLInputElement).disabled).toBe(true);
  });
});
