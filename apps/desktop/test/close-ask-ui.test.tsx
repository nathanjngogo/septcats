// @vitest-environment jsdom
/**
 * close-ask-ui.test.tsx —— 关窗询问框 UI 用例（TASK-T54-01 §1②）。
 *
 * 覆盖：close:ask 到达才渲染（未到达零 DOM）；三钮与默认聚焦（最小化到托盘）；
 * Esc / 遮罩 = 取消（面板内点击不关）；勾选「记住我的选择」随决议上送；
 * 「记住我的选择」文案真源（i18n closeAsk.*）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（不 import electron），断言落在假桥调用。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseAskDialog } from '../src/renderer/src/close/CloseAskDialog';
import { setLocale, t } from '../src/renderer/src/i18n';
import type { CloseDecisionInput } from '../src/shared/ipc';

let askListener: (() => void) | null = null;
let decide: ReturnType<typeof vi.fn>;

function installBridge(): void {
  decide = vi.fn(async (input: CloseDecisionInput) => ({ action: input.action }));
  vi.stubGlobal('septcats', {
    close: {
      onAsk: (listener: () => void) => {
        askListener = listener;
        return () => {
          askListener = null;
        };
      },
      decide,
      onFlushRequest: () => () => undefined,
      flushAck: vi.fn(),
    },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  askListener = null;
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale('zh-CN');
});

/** 推一次 close:ask（模拟 main 冲刷完后的推送）。 */
function pushAsk(): void {
  act(() => {
    askListener?.();
  });
}

describe('CloseAskDialog（T54-01 §1②）', () => {
  it('未收到 close:ask：零渲染（不占 DOM、不挡交互）', () => {
    render(<CloseAskDialog />);
    expect(screen.queryByTestId('close-ask')).toBeNull();
    expect(screen.queryByTestId('close-ask-overlay')).toBeNull();
  });

  it('收到 close:ask：弹框 + 标题/正文/三钮（文案走 i18n closeAsk.*）', () => {
    render(<CloseAskDialog />);
    pushAsk();
    expect(screen.getByTestId('close-ask')).toBeTruthy();
    expect(screen.getByText(t('closeAsk.title'))).toBeTruthy();
    expect(screen.getByText(t('closeAsk.body'))).toBeTruthy();
    expect(screen.getByTestId('close-ask-tray').textContent).toBe(t('closeAsk.minimizeToTray'));
    expect(screen.getByTestId('close-ask-quit').textContent).toBe(t('closeAsk.quit'));
    expect(screen.getByTestId('close-ask-cancel').textContent).toBe(t('common.cancel'));
    expect(screen.getByTestId('close-ask-remember')).toBeTruthy();
  });

  it('默认聚焦「最小化到托盘」（任务书 §1②）', () => {
    render(<CloseAskDialog />);
    pushAsk();
    expect(document.activeElement).toBe(screen.getByTestId('close-ask-tray'));
  });

  it('点「最小化到托盘」→ decide({action:tray, remember:false}) 且弹框关闭', () => {
    render(<CloseAskDialog />);
    pushAsk();
    fireEvent.click(screen.getByTestId('close-ask-tray'));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith({ action: 'tray', remember: false });
    expect(screen.queryByTestId('close-ask')).toBeNull();
  });

  it('勾选「记住我的选择」+「退出」→ decide({action:quit, remember:true})', () => {
    render(<CloseAskDialog />);
    pushAsk();
    fireEvent.click(screen.getByTestId('close-ask-remember'));
    fireEvent.click(screen.getByTestId('close-ask-quit'));
    expect(decide).toHaveBeenCalledWith({ action: 'quit', remember: true });
  });

  it('Esc = 取消；点遮罩 = 取消；面板内点击不取消', () => {
    render(<CloseAskDialog />);
    pushAsk();
    fireEvent.keyDown(document.activeElement ?? screen.getByTestId('close-ask'), { key: 'Escape' });
    expect(decide).toHaveBeenLastCalledWith({ action: 'cancel', remember: false });
    expect(screen.queryByTestId('close-ask')).toBeNull();

    pushAsk();
    fireEvent.mouseDown(screen.getByTestId('close-ask'));
    expect(decide).toHaveBeenCalledTimes(1); // 面板内不关
    fireEvent.mouseDown(screen.getByTestId('close-ask-overlay'));
    expect(decide).toHaveBeenLastCalledWith({ action: 'cancel', remember: false });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('close-ask')).toBeNull();
  });

  it('决议只发一次（连点两钮不重复 decide）', () => {
    render(<CloseAskDialog />);
    pushAsk();
    const tray = screen.getByTestId('close-ask-tray');
    fireEvent.click(tray);
    fireEvent.click(tray);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('二次 close:ask：重新打开且「记住我的选择」复位（不记忆上次勾选）', () => {
    render(<CloseAskDialog />);
    pushAsk();
    fireEvent.click(screen.getByTestId('close-ask-remember'));
    fireEvent.click(screen.getByTestId('close-ask-cancel'));
    expect(decide).toHaveBeenLastCalledWith({ action: 'cancel', remember: true });
    pushAsk();
    const checkbox = screen.getByTestId('close-ask-remember') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId('close-ask-tray'));
  });

  it('locale 切 en-US：文案即时英文（键完备，无硬编码残留）', () => {
    render(<CloseAskDialog />);
    setLocale('en-US');
    pushAsk();
    expect(screen.getByText('Close Septcats')).toBeTruthy();
    expect(screen.getByTestId('close-ask-tray').textContent).toBe('Minimize to Tray');
  });
});
