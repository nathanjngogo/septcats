/**
 * navState.ts —— T93-01 一级导航轨（NavRail）状态。
 *
 * 只存「二级栏显示什么」这一件事（笔记 vs 知识库）；其余一级项（工作台 / 模板 /
 * 回收站）本身就是既有视图状态（workbench.view / App view / pages.view），
 * 由 App 派生高亮 —— 单真源，不重复存一份以免两处状态打架。
 *
 * 持久化：localStorage `septcats.nav.panel`（野值回退 'notes'；隐私模式等写盘失败
 * 不影响内存态）。
 */
import { createStore, useStore } from '../state/store';

export type RailPanel = 'notes' | 'kb' | 'calendar' | 'todo';

const PANELS: readonly RailPanel[] = ['notes', 'kb', 'calendar', 'todo'];

const STORAGE_KEY = 'septcats.nav.panel';

function readPanel(): RailPanel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return PANELS.includes(raw as RailPanel) ? (raw as RailPanel) : 'notes';
  } catch {
    return 'notes';
  }
}

function writePanel(panel: RailPanel): void {
  try {
    localStorage.setItem(STORAGE_KEY, panel);
  } catch {
    /* 写盘失败（隐私模式/配额）→ 内存态照常，不阻断 */
  }
}

export interface NavState {
  panel: RailPanel;
}

export const navStore = createStore<NavState>({ panel: readPanel() });

export function useNav<T>(selector: (state: NavState) => T): T {
  return useStore(navStore, selector);
}

export const navActions = {
  setPanel(panel: RailPanel): void {
    navStore.setState((state) => ({ ...state, panel }));
    writePanel(panel);
  },
};