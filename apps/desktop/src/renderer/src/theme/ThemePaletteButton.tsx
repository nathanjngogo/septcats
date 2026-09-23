/**
 * ThemePaletteButton.tsx —— 顶栏调色板入口钮（TASK-T65-01 §1.2）。
 *
 * 学 workbench-open 房子钮的接线方式（App.tsx 同款 IconButton + testid 惯例）；
 * glyph 为 theme 目录内局部自绘（pixelIcons 族无对应 glyph，T65 红线禁改主文件）。
 * 纯展示钮：aria-pressed / onClick 由 App 注入（开合画廊状态住 App）。
 */
import { IconButton } from '@septcats/ui';
import { t } from '../i18n';
import { PixelPaletteGlyph } from './pixelGlyph';

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
