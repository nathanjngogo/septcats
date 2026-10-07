/**
 * PageAppearance.tsx —— 页面图标 / 封面选择器（N1-②，Notion 对齐）。
 *
 * 分工与 BlockControls 同款：**纯展示 + 意图回调**，不碰数据；落库由宿主
 * （PageView → pagesActions.setPageAppearance → `page:appearance` patch op）负责。
 *
 * 图标 = emoji 画廊（关键词搜索，中英混排）；封面 = 内置渐变画廊（零资产：
 * 色值全部由 --sc-color-* 派生，随明暗主题/配色派系自适应）。
 * 封面值口径：命中 COVER_TOKENS → 内置渐变；否则视为图片 URL（为后续「上传封面」预留）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { PAGE_COVER_TOKENS, PAGE_ICON_GALLERY } from '../../../shared/pageIcons';
import { t } from '../i18n';
import './PageAppearance.css';

/**
 * 图标/封面**数据**来自 `src/shared/pageIcons.ts`（见该文件头注：门禁⑤ 禁 renderer 源码
 * 出现 CJK 字面量，数据表按 editor 包 blockLabels 的先例放在扫描面之外）。
 * 此处转出口保持既有对外符号（测试与宿主都从这里取）。
 */
export const COVER_TOKENS = PAGE_COVER_TOKENS;
export type CoverToken = (typeof PAGE_COVER_TOKENS)[number];

export type PageAppearanceKind = 'icon' | 'cover';

export interface PageAppearancePickerProps {
  kind: PageAppearanceKind;
  /** 当前值（用于高亮与「移除」可用性判定）。 */
  current: string | null;
  onPick: (value: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** 图标/封面选择浮层（Escape 与外部点击关闭；与既有浮层手感一致）。 */
export function PageAppearancePicker({
  kind,
  current,
  onPick,
  onRemove,
  onClose,
}: PageAppearancePickerProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        onClose();
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const icons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
      return PAGE_ICON_GALLERY;
    }
    return PAGE_ICON_GALLERY.filter(
      (item) => item.keywords.toLowerCase().includes(q) || item.emoji === q,
    );
  }, [query]);

  return (
    <div
      className="pv-appearance"
      ref={rootRef}
      role="dialog"
      aria-label={t(kind === 'icon' ? 'pages.appearance.changeIcon' : 'pages.appearance.changeCover')}
      data-testid={`page-appearance-${kind}`}
    >
      {kind === 'icon' ? (
        <>
          <input
            className="pv-appearance__search"
            type="search"
            value={query}
            placeholder={t('pages.appearance.iconSearch')}
            aria-label={t('pages.appearance.iconSearch')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="pv-appearance__grid">
            {icons.map((item) => (
              <button
                key={item.emoji}
                type="button"
                className="pv-appearance__emoji"
                data-testid={`page-icon-option-${item.emoji}`}
                aria-label={item.keywords}
                onClick={() => onPick(item.emoji)}
              >
                {item.emoji}
              </button>
            ))}
            {icons.length === 0 ? (
              <p className="pv-appearance__empty">{t('pages.appearance.iconEmpty')}</p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="pv-appearance__covers">
          {COVER_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              className="pv-appearance__cover"
              data-cover={token}
              data-testid={`page-cover-option-${token}`}
              aria-label={token}
              aria-pressed={current === token}
              onClick={() => onPick(token)}
            />
          ))}
        </div>
      )}
      <div className="pv-appearance__footer">
        <button
          type="button"
          className="pv-appearance__remove"
          disabled={current === null}
          onClick={onRemove}
        >
          {t(kind === 'icon' ? 'pages.appearance.removeIcon' : 'pages.appearance.removeCover')}
        </button>
      </div>
    </div>
  );
}

/** 触发按钮：无值时显示「添加…」，有值时显示「更换…」（Notion 同款两态文案）。 */
export function appearanceActionLabel(kind: PageAppearanceKind, hasValue: boolean): string {
  if (kind === 'icon') {
    return t(hasValue ? 'pages.appearance.changeIcon' : 'pages.appearance.addIcon');
  }
  return t(hasValue ? 'pages.appearance.changeCover' : 'pages.appearance.addCover');
}

/** 键盘可达性辅助：Enter/Space 触发 onClick（div 触发面用）。 */
export function onActivateKey(handler: () => void) {
  return (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}