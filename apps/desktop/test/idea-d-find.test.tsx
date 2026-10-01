// @vitest-environment jsdom
/**
 * idea-d-find.test.tsx —— 页内查找条组件（IDEA-D）契约。
 *
 * 匹配口径（collectMatches/previewMatch）已被 packages/editor/test/find.test.ts 钉死；
 * 这里测**交互面**：输入即计数、0 匹配「无匹配」、Enter 游走立即跳、打字防抖跳、
 * Esc/× 关闭回调、↑↓ 按钮。跳转一律断回调（锚定位逻辑归 jumpToBlockId 单源）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageFind } from '../src/renderer/src/pages/PageFind';
import type { FindSource, FindSourceNode } from '@septcats/editor';

const NODES: FindSourceNode[] = [
  { type: { name: 'paragraph' }, attrs: { id: 'b1' }, textContent: '夜航船 是一本奇书' },
  { type: { name: 'heading' }, attrs: { id: 'b2' }, textContent: '夜航 章标题' },
  { type: { name: 'paragraph' }, attrs: { id: 'b3' }, textContent: '无关内容' },
];
const DOC: FindSource = {
  forEach(cb: (n: FindSourceNode, o: number, i: number) => void): void {
    for (const n of NODES) {
      cb(n, 0, 0);
    }
  },
};

function setup(): { onJump: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onJump = vi.fn();
  const onClose = vi.fn();
  render(<PageFind getDoc={() => DOC} onJump={onJump} onClose={onClose} />);
  return { onJump, onClose };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PageFind', () => {
  it('输入即出计数「1/2」（大小写不敏感命中 b1、b2）', () => {
    const { onJump } = setup();
    const input = screen.getByTestId('pv-find-input');
    fireEvent.change(input, { target: { value: '夜航' } });
    expect(screen.getByTestId('pv-find-count').textContent).toBe('1/2');
    // 打字路径 = 250ms 防抖后跳当前块
    vi.advanceTimersByTime(300);
    expect(screen.getByTestId('pv-find-hint').textContent).toContain('夜航');
    expect(onJump).toHaveBeenCalledWith('b1');
  });

  it('无匹配 → 「无匹配」且提示区不渲染', () => {
    setup();
    fireEvent.change(screen.getByTestId('pv-find-input'), { target: { value: '查无此词' } });
    expect(screen.getByTestId('pv-find-count').textContent).toBe('无匹配');
    expect(screen.queryByTestId('pv-find-hint')).toBeNull();
  });

  it('Enter 下一个：游标 1/2→2/2 且**立即**跳（手动游走不等防抖）', () => {
    const { onJump } = setup();
    fireEvent.change(screen.getByTestId('pv-find-input'), { target: { value: '夜航' } });
    onJump.mockClear();
    fireEvent.keyDown(screen.getByTestId('pv-find-input'), { key: 'Enter' });
    expect(onJump).toHaveBeenCalledWith('b2');
    expect(screen.getByTestId('pv-find-count').textContent).toBe('2/2');
  });

  it('↑ 环绕：1/2 的上一个 = 最后一个（2/2）', () => {
    const { onJump } = setup();
    fireEvent.change(screen.getByTestId('pv-find-input'), { target: { value: '夜航' } });
    onJump.mockClear();
    fireEvent.keyDown(screen.getByTestId('pv-find-input'), { key: 'Enter', shiftKey: true });
    expect(onJump).toHaveBeenCalledWith('b2');
    expect(screen.getByTestId('pv-find-count').textContent).toBe('2/2');
  });

  it('Enter 回绕：2/2 的下一个 = 1/2（循环查找）', () => {
    const { onJump } = setup();
    fireEvent.change(screen.getByTestId('pv-find-input'), { target: { value: '夜航' } });
    fireEvent.keyDown(screen.getByTestId('pv-find-input'), { key: 'Enter' }); // 2/2
    onJump.mockClear();
    fireEvent.keyDown(screen.getByTestId('pv-find-input'), { key: 'Enter' });
    expect(onJump).toHaveBeenCalledWith('b1');
    expect(screen.getByTestId('pv-find-count').textContent).toBe('1/2');
  });

  it('Esc 与 × 都回调 onClose（宿主关条）', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByTestId('pv-find-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('pv-find-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('清空查询 → 计数回「无匹配」且不再触发跳转', () => {
    const { onJump } = setup();
    fireEvent.change(screen.getByTestId('pv-find-input'), { target: { value: '夜航' } });
    vi.advanceTimersByTime(300);
    onJump.mockClear();
    fireEvent.change(screen.getByTestId('pv-find-input'), { target: { value: '   ' } });
    vi.advanceTimersByTime(300);
    expect(screen.getByTestId('pv-find-count').textContent).toBe('无匹配');
    expect(onJump).not.toHaveBeenCalled();
  });
});
