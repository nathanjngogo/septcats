/**
 * ThemeGallery.tsx —— 主题画廊弹框（TASK-T65-01 §1.2，老板 R17 选①「画廊」）。
 *
 * **renderer 自绘像素模态**（同 LayoutPicker 范式）：面板 = 2px 描边（--sc-color-ink-edge）
 * + --sc-shadow-modal + --sc-pixel-out 抬升；钮复用 @septcats/ui Button 家族。
 *
 * 内容 = 六派系 × 当前明暗态 = 6 张**迷你预览卡**（每卡用该派系 token 值画一个微缩
 * 三行界面：标题条 / 正文两行 + 一个按钮，纯 CSS token 驱动、不截图不 canvas）。
 * 关键点：卡根同时挂 `data-theme` + `data-palette`（与 documentElement 同组合选择器口径），
 * 使 themes.css 的 `[data-theme="X"][data-palette="Y"]` 覆写在该卡子树内生效——
 * 于是同一画廊里六张卡各自呈现真实派系配色，可直接对比。
 *
 * 点卡 = 即时切换（paletteActions.setPalette → store + 持久化 + 根属性）+ 卡上出「当前」
 * 角标；弹框不关闭（可连续试六张，关闭由 Esc / 遮罩承担）。
 * oled 仅深色生效：浅色基底下该卡置灰（isPaletteDisabled）并按 mono 渲染、不可点。
 *
 * 文案全走 i18n（`settings.appearance.*` / `commands.theme.palette`），无硬编码。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@septcats/ui';
import { t } from '../i18n';
import {
  effectivePalette,
  isPaletteDisabled,
  PALETTE_IDS,
  paletteActions,
  usePaletteId,
  type PaletteId,
} from './paletteState';
import { LOOK_IDS, lookActions, useLookId, type LookId } from './lookState';
import './ThemeGallery.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root === null ? [] : [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

export interface ThemeGalleryProps {
  open: boolean;
  /** 当前实际生效的明暗基底（来自 useTheme().resolved）。 */
  resolvedTheme: 'light' | 'dark';
  /** 关闭弹框（Esc / 遮罩都经此出口；点卡不关闭）。 */
  onClose: () => void;
}

export function ThemeGallery({ open, resolvedTheme, onClose }: ThemeGalleryProps) {
  const current = usePaletteId();
  const currentLook = useLookId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const effectiveCurrent = effectivePalette(current, resolvedTheme);

  // 打开：记住来处焦点 + 聚焦当前派系卡；关闭：归还焦点。
  useEffect(() => {
    if (!open) {
      return;
    }
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const currentCard = panel?.querySelector<HTMLElement>(`[data-testid="theme-gallery-card-${effectiveCurrent}"]`);
    const initial = currentCard ?? focusables(panel)[0] ?? panel;
    initial?.focus();
    return () => {
      restoreRef.current?.focus();
    };
  }, [open, effectiveCurrent]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const list = focusables(panelRef.current);
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const onOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="theme-gallery__overlay"
      data-testid="theme-gallery-overlay"
      onMouseDown={onOverlayMouseDown}
    >
      <div
        className="theme-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-gallery-title"
        data-testid="theme-gallery"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <h2 className="theme-gallery__title" id="theme-gallery-title">
          {t('commands.theme.palette')}
        </h2>
        <p className="theme-gallery__hint">{t('settings.appearance.paletteDesc')}</p>

        {/* T85-01：质感派系行（pixel/linear/glass 三选一；卡内同时挂 data-look，
            与配色六卡同口径——预览子树即时呈现该质感 token 覆写） */}
        <div
          className="theme-gallery__cards theme-gallery__cards--look"
          role="group"
          aria-label={t('settings.appearance.look')}
        >
          {LOOK_IDS.map((id: LookId) => {
            const isCurrent = currentLook === id;
            return (
              <button
                key={id}
                type="button"
                className={`theme-gallery__card${isCurrent ? ' theme-gallery__card--current' : ''}`}
                aria-pressed={isCurrent}
                data-testid={`theme-gallery-card-${id}`}
                data-look={id}
                data-current={isCurrent ? 'true' : 'false'}
                onClick={() => {
                  lookActions.setLook(id);
                }}
              >
                <span className="theme-gallery__card-name">
                  {t(`settings.appearance.lookNames.${id}`)}
                  {isCurrent ? (
                    <span className="theme-gallery__badge" data-testid="theme-gallery-look-current">
                      {t('settings.appearance.paletteCurrent')}
                    </span>
                  ) : null}
                </span>
                {/* 迷你预览：同配色卡构图；质感差异（边框粗细/圆角/磨砂）由卡内 data-look 驱动 */}
                <span className="theme-gallery__preview" aria-hidden="true">
                  <span className="theme-gallery__preview-title" />
                  <span className="theme-gallery__preview-line" />
                  <span className="theme-gallery__preview-line" />
                  <span className="theme-gallery__preview-btn" />
                </span>
              </button>
            );
          })}
        </div>

        <div className="theme-gallery__cards" role="group" aria-label={t('settings.appearance.palette')}>
          {PALETTE_IDS.map((id: PaletteId) => {
            const isCurrent = effectiveCurrent === id;
            const disabled = isPaletteDisabled(id, resolvedTheme);
            return (
              <button
                key={id}
                type="button"
                className={`theme-gallery__card${isCurrent ? ' theme-gallery__card--current' : ''}${
                  disabled ? ' theme-gallery__card--disabled' : ''
                }`}
                aria-pressed={isCurrent}
                aria-disabled={disabled}
                disabled={disabled}
                data-testid={`theme-gallery-card-${id}`}
                data-palette={id}
                data-theme={resolvedTheme}
                data-current={isCurrent ? 'true' : 'false'}
                title={disabled ? t('settings.appearance.paletteDisabledOled') : undefined}
                onClick={() => {
                  if (disabled) {
                    return;
                  }
                  paletteActions.setPalette(id);
                }}
              >
                <span className="theme-gallery__card-name">
                  {t(`settings.appearance.paletteNames.${id}`)}
                  {isCurrent ? (
                    <span className="theme-gallery__badge" data-testid="theme-gallery-current">
                      {t('settings.appearance.paletteCurrent')}
                    </span>
                  ) : null}
                </span>
                {/* 微缩三行界面：标题条 / 正文两行 + 一个按钮（纯 token 驱动，见 ThemeGallery.css） */}
                <span className="theme-gallery__preview" aria-hidden="true">
                  <span className="theme-gallery__preview-title" />
                  <span className="theme-gallery__preview-line" />
                  <span className="theme-gallery__preview-line" />
                  <span className="theme-gallery__preview-btn" />
                </span>
                {disabled ? (
                  <span className="theme-gallery__card-note">{t('settings.appearance.paletteDisabledOled')}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="theme-gallery__footer">
          <Button variant="secondary" size="sm" data-testid="theme-gallery-close" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
