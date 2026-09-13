import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Divider } from './Divider';


describe('Divider', () => {
  it('separator 语义 + 方向类名 + aria-orientation', () => {
    const { container } = render(
      <>
        <Divider />
        <Divider orientation="vertical" />
      </>,
    );
    const dividers = screen.getAllByRole('separator');
    expect(dividers).toHaveLength(2);
    expect(dividers[0]?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(dividers[1]?.getAttribute('aria-orientation')).toBe('vertical');
    expect(container.querySelector('.sc-divider--horizontal')).not.toBeNull();
    expect(container.querySelector('.sc-divider--vertical')).not.toBeNull();
    expectTokenOnlyCssFile('src/Divider.css');
  });
});
