/**
 * ThemePaletteButton.tsx —— 顶栏调色板入口钮（TASK-T65-01 §1.2）。
 *
 * 学 workbench-open 房子钮的接线方式（App.tsx 同款 IconButton + testid 惯例）；
 * glyph 曾为 theme 目录内局部自绘，T74-01 已收编进 @septcats/ui（src/icons.tsx），
 * 调用点零改动。
 * 纯展示钮：aria-pressed / onClick 由 App 注入（开合画廊状态住 App）。
 */
import { IconButton, PixelPaletteGlyph } from '@septcats/ui';
import { t } from '../i18n';

export interface ThemePaletteButtonProps {
  ariaPressed: boolean;
  onClick: () => void;
}

export function ThemePaletteButton({ ariaPressed, onClick }: ThemePaletteButtonProps) {
  return (
    <IconButton
      icon={PixelPaletteGlyph}
      label={t('app.paletteLabel')}
      aria-pressed={ariaPressed}
      data-testid="palette-open"
      onClick={onClick}
    />
  );
}
