// @vitest-environment jsdom
/**
 * t73-bookmarks-open.test.tsx —— TASK-T73-01 §3：书签卡跳转接线（jsdom）。
 *
 * 覆盖：
 * - URL 条目点击 → 调 `window.septcats.shell.openExternal({url})`（通道调用锚）；
 * - 成功（ok:true）→ 不弹 toast；
 * - 结构化拒绝（ok:false）与通道抛错 → 失败 toast（danger，T73 新增文案）；
 * - 收藏/取消交互零回归：+ 表单仍可添加、X 仍可移除，且二者不触达 openExternal。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；只渲染 bookmarks 卡体（注册表 render）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_DEFS, wbcardRead, wbcardWrite, type CardApi } from '../src/renderer/src/workbench/cards';
import { pagesStore } from '../src/renderer/src/state/pages';
import { t } from '../src/renderer/src/i18n';
import type { SeptcatsApi } from '../src/types/window';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOOKMARK_KEY = 'septcats.wbcard.bookmarks.list';
const SAMPLE_URL = 'https://example.com/article';

const api: CardApi = {
  openPage: () => {},
  t: (key: string): string => t(key),
  settings: { read: wbcardRead, write: wbcardWrite },
};

function installShell(openExternal: (input: { url: string }) => Promise<unknown>): void {
  vi.stubGlobal('septcats', { shell: { openExternal } } as unknown as SeptcatsApi);
}

function clickFirstOpen(): void {
  fireEvent.click(screen.getByTestId(`wb-bookmarks-open-${SAMPLE_URL}`));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(BOOKMARK_KEY, JSON.stringify([{ url: SAMPLE_URL, title: '示例' }]));
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T73-01 bookmarks 卡跳转', () => {
  it('点击 URL 条目 → 调 shell.openExternal({url})；成功不弹 toast', async () => {
    const openExternal = vi.fn(async () => ({ ok: true }));
    installShell(openExternal);
    render(<div>{CARD_DEFS.bookmarks.render(api)}</div>);
    clickFirstOpen();
    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith({ url: SAMPLE_URL });
    });
    expect(pagesStore.getState().toasts).toHaveLength(0);
  });

  it('结构化拒绝（ok:false）→ 失败 toast（danger）', async () => {
    installShell(async () => ({ ok: false, error: { code: 'E_PROTOCOL', message: '协议不允许：file:' } }));
    render(<div>{CARD_DEFS.bookmarks.render(api)}</div>);
    clickFirstOpen();
    await waitFor(() => {
      expect(pagesStore.getState().toasts).toHaveLength(1);
    });
    const toast = pagesStore.getState().toasts[0];
    expect(toast?.tone).toBe('danger');
    expect(toast?.message).toBe(t('workbench.bookmarkOpenFailed'));
  });

  it('通道抛错 → 失败 toast', async () => {
    installShell(async () => {
      throw new Error('ipc down');
    });
    render(<div>{CARD_DEFS.bookmarks.render(api)}</div>);
    clickFirstOpen();
    await waitFor(() => {
      expect(pagesStore.getState().toasts).toHaveLength(1);
    });
    expect(pagesStore.getState().toasts[0]?.tone).toBe('danger');
  });

  it('桥未接（无 shell）→ 静默，不误报失败', async () => {
    vi.stubGlobal('septcats', {} as unknown as SeptcatsApi);
    render(<div>{CARD_DEFS.bookmarks.render(api)}</div>);
    clickFirstOpen();
    await new Promise((r) => setTimeout(r, 0));
    expect(pagesStore.getState().toasts).toHaveLength(0);
  });

  it('收藏 / 取消交互零回归：添加与移除正常且不调 openExternal', async () => {
    const openExternal = vi.fn(async () => ({ ok: true }));
    installShell(openExternal);
    render(<div>{CARD_DEFS.bookmarks.render(api)}</div>);

    fireEvent.click(screen.getByTestId('wb-bookmarks-add'));
    fireEvent.change(await screen.findByTestId('wb-bookmarks-input-url'), {
      target: { value: 'https://added.example' },
    });
    fireEvent.click(screen.getByTestId('wb-bookmarks-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('wb-bookmarks-item-https://added.example')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('wb-bookmarks-remove-https://added.example'));
    await waitFor(() => {
      expect(screen.queryByTestId('wb-bookmarks-item-https://added.example')).toBeNull();
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
