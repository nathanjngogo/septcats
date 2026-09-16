// @vitest-environment jsdom
/**
 * ai-panel.test.tsx —— AI 动作面板四态（TASK-T18-03 §3）。
 *
 * 纯受控组件直测（不拉 IPC、不接编辑器）：busy 文案 / ok 结果可见且 user-select
 * 未被禁用（jsdom 不解析外链 CSS，用「内联非 none + 结果区类名」作代理断言）/
 * error role=alert 原文 / 空态引导 + 打开设置回调；ok 态应用、error 态重试被调。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiActionPanel } from '../src/renderer/src/ai/AiActionPanel';
import type { AiActionPanelProps } from '../src/renderer/src/ai/AiActionPanel';

afterEach(() => {
  cleanup();
});

function baseProps(overrides: Partial<AiActionPanelProps> = {}): AiActionPanelProps {
  return {
    open: true,
    action: 'summarize',
    phase: 'ok',
    result: '要点一\n要点二',
    error: '',
    emptyReason: null,
    canApply: true,
    onApply: vi.fn(),
    onRetry: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('AiActionPanel 四态', () => {
  it('标题 = 动作名（commands.ai.<action>）', () => {
    render(<AiActionPanel {...baseProps()} />);
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText('AI 摘要')).toBeTruthy();
  });

  it('busy 态：生成中文案，应用键 loading', () => {
    render(<AiActionPanel {...baseProps({ phase: 'busy', result: '' })} />);
    expect(screen.getByText('生成中…')).toBeTruthy();
    const apply = screen.getByText('应用').closest('button');
    expect(apply?.getAttribute('aria-busy')).toBe('true');
    expect(apply?.hasAttribute('disabled')).toBe(true);
  });

  it('ok 态：结果全文可见、结果区 user-select 未被禁用、点应用回调', () => {
    const onApply = vi.fn();
    render(<AiActionPanel {...baseProps({ onApply })} />);
    const pre = document.querySelector('.ai-panel__result');
    expect(pre?.textContent).toBe('要点一\n要点二');
    // jsdom 不算外链样式表：断言内联 user-select 非 none + 结果区专用类（样式表给它 text）
    expect((pre as HTMLElement).style.userSelect).not.toBe('none');
    expect((pre as HTMLElement).className).toBe('ai-panel__result');
    fireEvent.click(screen.getByText('应用'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('ok 态 canApply=false：应用键禁用', () => {
    render(<AiActionPanel {...baseProps({ canApply: false })} />);
    const apply = screen.getByText('应用').closest('button');
    expect(apply?.hasAttribute('disabled')).toBe(true);
  });

  it('error 态：role=alert 展示 E_AI_* 原文、点重试回调', () => {
    const onRetry = vi.fn();
    render(
      <AiActionPanel
        {...baseProps({ phase: 'error', error: 'E_AI_UNREACHABLE：端点不可达', onRetry })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('E_AI_UNREACHABLE：端点不可达');
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('空态：引导文案 + 「打开设置」回调，且无应用/重试键', () => {
    const onOpenSettings = vi.fn();
    render(
      <AiActionPanel
        {...baseProps({
          phase: 'idle',
          result: '',
          emptyReason: 'AI 功能尚未启用（设置 → AI 助手）',
          onOpenSettings,
        })}
      />,
    );
    expect(screen.getByText('AI 功能尚未启用（设置 → AI 助手）')).toBeTruthy();
    fireEvent.click(screen.getByText('打开设置'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('应用')).toBeNull();
    expect(screen.queryByText('重试')).toBeNull();
  });

  it('open=false 不渲染任何内容', () => {
    render(<AiActionPanel {...baseProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('取消回调（关闭即丢弃，面板自身不落任何持久态）', () => {
    const onClose = vi.fn();
    render(<AiActionPanel {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
