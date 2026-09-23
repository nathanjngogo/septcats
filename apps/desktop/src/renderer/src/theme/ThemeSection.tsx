/**
 * ThemeSection.tsx —— 设置页「外观」节内的配色派系入口（TASK-T65-01 §1.2）。
 *
 * 仅一枚入口按钮：派发 `OPEN_THEME_GALLERY_EVENT`，App 监听后开画廊（与 T18-03
 * `septcats:open-settings` / LayoutSection 同范式解耦）。复用 SettingsPage.css 的
 * `.settings-row/.settings-lab*` 布局类（不新开 CSS 文件，避免多余框线纪律面）。
 * 「跟随明暗三态」既有主题开关（RadioGroup）不动，已在上层 外观 fieldset。
 */
import { Button } from '@septcats/ui';
import { t } from '../i18n';
import { OPEN_THEME_GALLERY_EVENT } from './paletteState';

export function ThemeSection() {
  return (
    <div className="settings-row" data-testid="theme-section">
      <div className="settings-lab">
        <span className="settings-lab-b">{t('settings.appearance.palette')}</span>
        <span className="settings-lab-d">{t('settings.appearance.paletteDesc')}</span>
      </div>
      <div className="settings-ctl">
        <Button
          variant="secondary"
          size="sm"
          data-testid="theme-gallery-entry"
          onClick={() => {
            window.dispatchEvent(new CustomEvent(OPEN_THEME_GALLERY_EVENT));
          }}
        >
          {t('settings.appearance.paletteGallery')}
        </Button>
      </div>
    </div>
  );
}
