/**
 * focusState.ts —— 专注模式开关（创意项 IDEA-A，老板 10-01「在现有产品基础上发挥」授权）。
 *
 * 定位：写作时的「无干扰态」——藏起一级导轨、二级侧栏、顶栏读数区，
 * 编辑列收窄到舒适行长（65~75 字符的设计口径在这里天然成立）。
 *
 * 口径与 lookState 同族：**旁路存储**（localStorage `septcats.focus`，瞬时可逆视图态，
 * 不进 Op 账本、不参与同步）；生效路径 = setFocus → store + localStorage + documentElement[data-focus]。
 * 默认**不记忆**（每次启动回到正常态）：专注是"此刻写作"的模式，不是外观偏好。
 */

export const FOCUS_STORAGE_KEY = 'septcats.focus';

let current = false;

/** 读存储（异常/缺省一律 false：专注模式是可选增强，坏了不能挡启动）。 */
export function readFocus(): boolean {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage?.getItem(FOCUS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function applyFocusToRoot(on: boolean): void {
  const root = document.documentElement;
  if (on) {
    root.dataset.focus = 'on';
  } else {
    delete root.dataset.focus;
  }
}

const listeners = new Set<(on: boolean) => void>();

export function onFocusChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getFocus(): boolean {
  return current;
}

/** 开关的唯一入口（命令面板 / 快捷键 / Esc 全走这里，状态不发散）。 */
export function setFocus(on: boolean): void {
  current = on;
  try {
    if (on) {
      window.localStorage.setItem(FOCUS_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(FOCUS_STORAGE_KEY);
    }
  } catch { /* 存储不可用：模式本次会话内仍生效 */ }
  applyFocusToRoot(on);
  for (const fn of listeners) {
    fn(on);
  }
}

export function toggleFocus(): void {
  setFocus(!current);
}

/** 启动时应用（默认关：readFocus 恒 false 除非用户开着窗口崩了）。 */
export function initFocus(): void {
  current = readFocus();
  applyFocusToRoot(current);
}
