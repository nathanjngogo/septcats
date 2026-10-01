/**
 * FocusMode.tsx —— 专注模式的界面挂件（创意项 IDEA-A，老板 10-01「在现有产品基础上发挥」）。
 *
 * 三件套：
 *  ① FocusToggleButton —— 顶栏那颗「专注」钮（走 TopBarButton 契约：中文文字、可访问面全保留）。
 *     它带 `sc-focus-toggle` 类；CSS 用 `.sc-shell__actions > *:not(.sc-focus-toggle)` 把**其余**动作钮
 *     在专注时整体让位，唯独保留这颗（不然进得去出不来）。
 *  ② FocusBadge —— 右下角「专注中 · Esc 退出」角标（aria-hidden 纯视觉；状态由 aria-live 播报）。
 *  ③ 状态订阅 —— 组件只读 focusState（真相源在 localStorage + documentElement[data-focus]），
 *     切换一律经 setFocus/toggleFocus，绝不在组件里私改 dataset。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { TopBarButton } from '../layout/TopBarButton';
import { getFocus, onFocusChange, toggleFocus } from '../theme/focusState';
import { t } from '../i18n';
import '../theme/focus.css';

/**
 * 全局快捷键：F9 切换专注；专注中 Esc 退出。
 * App 与测试**共用这一份实现**（曾把逻辑内联在 App.tsx 里——那样测试只能复制同款逻辑=假绿）。
 * 让位规则：命令面板开着时两键都不抢；Esc 在有 role=dialog 弹层时让位给弹层（一次按键只干一件事）。
 */
export function useFocusHotkeys(paletteOpen: boolean): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key === 'F9') {
        if (paletteOpen) {
          return;
        }
        event.preventDefault();
        toggleFocus();
        return;
      }
      if (event.key === 'Escape' && getFocus() && !paletteOpen
        && document.querySelector('[role="dialog"]') === null) {
        toggleFocus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [paletteOpen]);
}

/** 顶栏「专注」钮（不进 .sc-shell__act-hideable：专注时要留着当出口）。 */
export function FocusToggleButton(): ReactNode {
  const [on, setOn] = useState(getFocus());
  useEffect(() => onFocusChange(setOn), []);
  return (
    <TopBarButton
      className="sc-focus-toggle"
      label={t('app.focusLabel')}
      text={t('app.focusText')}
      pressed={on}
      testId="focus-toggle"
      onClick={toggleFocus}
    />
  );
}

/** 右下角模式角标（视觉提示；退出靠 Esc / 再点钮 / 命令面板）。 */
export function FocusBadge(): ReactNode {
  const [on, setOn] = useState(getFocus());
  useEffect(() => onFocusChange(setOn), []);
  if (!on) {
    return null;
  }
  return (
    <span className="sc-focus-badge" aria-hidden="true" data-testid="focus-badge">
      {t('app.focusOn')} · {t('app.focusExitHint')}
    </span>
  );
}
