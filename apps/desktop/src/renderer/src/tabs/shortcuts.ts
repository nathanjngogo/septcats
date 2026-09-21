/**
 * shortcuts.ts —— 页签键盘快捷键的真实处理逻辑（TASK-T37-01 §0.3）。
 *
 * 从 App 的 keydown 监听抽出为可单测模块（测试直调 handleTabsKeydown +
 * 合成事件，无需渲染整个 App）。键位判定（Ctrl/Cmd+W · Ctrl/Cmd+Tab ·
 * Ctrl/Cmd+1..9）在 state/tabs.ts 的 tabsShortcutAction 纯函数；
 * 本模块只负责「消费动作 → pagesStore 变更」：关当前（相邻回落）、下一个
 * （循环）、跳第 N（超出页签数夹到最后一个）。
 * 与既有 Ctrl/Cmd+K 命令面板不冲突：键位不相交，且面板打开时调用方置
 * editorVisible=false 直接短路。
 */
import { pagesActions, pagesStore } from '../state/pages';
import { tabsShortcutAction } from '../state/tabs';

export interface TabsShortcutGate {
  /** 编辑器视图可见（settings/import/回收站/搜索页/命令面板打开 → false）。 */
  editorVisible: boolean;
}

/**
 * 关当前标签（相邻回落；不触碰页面/回收站）。返回是否真的关了。
 * 键盘 Ctrl+W 与原生菜单 File→Close Tab 共用本函数（T51-01 §1②「同键同动作」，
 * 菜单绝不挂 role:'close'）。
 */
export function closeActiveTab(): boolean {
  const state = pagesStore.getState();
  if (state.tabs.length === 0 || state.selectedId === null) {
    return false;
  }
  pagesActions.closeTab(state.selectedId);
  return true;
}

/** 处理一次 keydown；返回是否消费（消费时已 preventDefault）。 */
export function handleTabsKeydown(event: KeyboardEvent, gate: TabsShortcutGate): boolean {
  const action = tabsShortcutAction(event);
  if (action === null || !gate.editorVisible) {
    return false;
  }
  if (action === 'close') {
    if (!closeActiveTab()) {
      return false;
    }
    event.preventDefault();
    return true;
  }
  const state = pagesStore.getState();
  if (state.tabs.length === 0) {
    return false;
  }
  if (action === 'next') {
    event.preventDefault();
    const current = state.selectedId !== null ? state.tabs.indexOf(state.selectedId) : -1;
    const nextId = state.tabs[(current + 1) % state.tabs.length];
    if (nextId !== undefined) {
      pagesActions.openInTab(nextId);
    }
    return true;
  }
  const target = state.tabs[Math.min(action.index, state.tabs.length - 1)];
  if (target === undefined) {
    return false;
  }
  event.preventDefault();
  pagesActions.openInTab(target);
  return true;
}
