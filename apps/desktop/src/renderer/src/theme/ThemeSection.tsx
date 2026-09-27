/**
 * ThemeSection.tsx —— 设置页「外观」节内的主题两项（配色派系 + 质感风格）。
 *
 * **老板 09-27 令（原话）**：「2. 根本没有毛玻璃等主题 … 4. 取消主题画廊」——
 * 主题相关选项原先只藏在「主题画廊」浮层里（还要先点「打开主题画廊」按钮才看得见），
 * 现改为**内联设置行**：一眼可见、点一下即生效，不再需要浮层。
 * 两行复用 @septcats/ui 的 RadioGroup（与上方「主题（明暗三态）」同款控件，
 * 用户已认识这个控件），选中即 paletteActions/lookActions 一步到位（store + 持久化 + 根属性）。
 * 文案全走 i18n（settings.appearance.*），无硬编码；布局复用 SettingsPage.css 的
 * `.settings-row/.settings-lab*` 类（不新开 CSS 文件，避免多余框线纪律面）。
 */
import { RadioGroup } from '@septcats/ui';
import { t } from '../i18n';
import {
  isPaletteDisabled,
  PALETTE_IDS,
  paletteActions,
  usePaletteId,
  type PaletteId,
} from './paletteState';
import { LOOK_IDS, lookActions, useLookId, type LookId } from './lookState';

export function ThemeSection() {
  const palette = usePaletteId();
  const look = useLookId();
  // 明暗基底只读根属性（与 App 同口径：不借 useTheme，兼容「直渲设置页」的集成测试未包 ThemeProvider）。
  const resolvedTheme: 'light' | 'dark' =
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light';

  return (
    <>
      <div className="settings-row" data-testid="theme-section">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.appearance.palette')}</span>
          <span className="settings-lab-d">{t('settings.appearance.paletteDesc')}</span>
        </div>
        <div className="settings-ctl">
          <RadioGroup<PaletteId>
            label={t('settings.appearance.palette')}
            name="settings-palette"
            options={PALETTE_IDS.map((id) => ({
              value: id,
              label: t(`settings.appearance.paletteNames.${id}`),
              // 浅色基底下 oled（纯黑）无意义（按 mono 渲染）→ 置灰不可选，与原画廊卡同口径
              disabled: isPaletteDisabled(id, resolvedTheme),
            }))}
            value={palette}
            onChange={(id) => {
              paletteActions.setPalette(id);
            }}
          />
        </div>
      </div>

      <div className="settings-row" data-testid="theme-look-section">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.appearance.look')}</span>
          <span className="settings-lab-d">{t('settings.appearance.lookDesc')}</span>
        </div>
        <div className="settings-ctl">
          <RadioGroup<LookId>
            label={t('settings.appearance.look')}
            name="settings-look"
            options={LOOK_IDS.map((id) => ({
              value: id,
              label: t(`settings.appearance.lookNames.${id}`),
            }))}
            value={look}
            onChange={(id) => {
              lookActions.setLook(id);
            }}
          />
        </div>
      </div>
    </>
  );
}
