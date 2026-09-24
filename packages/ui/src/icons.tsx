/*
 * icons.tsx —— 族外追加像素 glyph（TASK-T74-01：应用层局部 glyph 收编进设计系统）。
 *
 * 来源：T66-01 `renderer/workbench/pixelGlyph.tsx`（房子 / 待办 / 店铺）与 T65-01
 * `renderer/theme/pixelGlyph.tsx`（调色板）。两处当年因并行单红线（禁改 pixelIcons.tsx）
 * 各自在应用层手写了一份 `makeLocalGlyph`；本单把这四枚的**画格数据逐字符**搬进 ui 包，
 * 渲染管线改为直连 `./pixelIcons` 的 `createPixelGlyph`（同一 scanRuns + 同一 opacity 档），
 * 应用层的两份局部实现已删除。
 *
 * 硬约束（T74-01 红线）：**外观零变化**。因此：
 *  - 矩阵数据一律原样搬运，禁「顺手优化」——包括 `Shop` 的参差行宽：
 *    其第 3/4/6..9 行 15 格、第 10/11 行 14 格（原稿如此，渲染按实际行宽取格）。
 *    这属**已冻结的资产属性**，改宽度即改外观，禁止对齐成 16。
 *  - 这四枚**不进** `PIXEL_GLYPHS`（T58 资产表 28 枚口径 + PNG 门禁逐格同源），
 *    故单独成表、单独出口；`scripts/check-pixel-icons.mjs` 与 PNG 产物不受影响。
 *
 * 出口：与族内 glyph 同走 `./Icon` 的 re-export（全仓唯一图标出口 §16.6），
 * 应用层用法不变：`<Icon icon={PixelShopGlyph} />` / `<PixelHomeGlyph size={20} />`。
 */
import { createPixelGlyph } from './pixelIcons';

/** 族外 glyph 矩阵（16 行；与族内同契约：`#`=主墨 / `o`=半档 / `x`=淡档 / `.`=空）。 */
export const PIXEL_GLYPHS_EXTRA = {
  /** 房子（工作台欢迎条装饰 + 卡头）。 */
  Home: [
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '.....##..##.....',
    '....##....##....',
    '...##..oo..##...',
    '..##oooooooo##..',
    '..############..',
    '..############..',
    '..##........##..',
    '..##..###...##..',
    '..##..###...##..',
    '..##..###...##..',
    '..##..###...##..',
    '................',
  ],
  /** 待办（清单 + 勾）。 */
  Todo: [
    '................',
    '...##.....##....',
    '..####...####...',
    '...##.....##....',
    '................',
    '..##########....',
    '..#........#....',
    '..#.####...#....',
    '..#........#....',
    '..#.####...#....',
    '..#........#....',
    '..#.####...#....',
    '..#........#....',
    '..##########....',
    '................',
    '................',
  ],
  /** 店铺 / 货架（工作台模板市场入口钮）。行宽参差见文件头——原样冻结，勿对齐。 */
  Shop: [
    '................',
    '..############..',
    '..############..',
    '..#..##....##..',
    '..#..##....##..',
    '..############..',
    '..#..#o#..#o#..',
    '..#..#o#..#o#..',
    '..#..#o#..#o#..',
    '..#..#o#..#o#..',
    '..#........#..',
    '..#........#..',
    '..############..',
    '..#.#......#.#..',
    '..#.#......#.#..',
    '..###......###..',
  ],
  /** 调色板（配色画廊入口钮）。 */
  Palette: [
    '................',
    '................',
    '.....oooo.......',
    '...oo####oo.....',
    '..o########o....',
    '..##########....',
    '.o##########o...',
    '.o#######oo.o...',
    '.o######o##o....',
    '.o####o####o....',
    '.o##########o...',
    '..##########o...',
    '..o########o....',
    '...oo####oo.....',
    '.....oooo.......',
    '................',
  ],
} as const satisfies Record<string, readonly string[]>;

/** 族外 glyph 名（T74-01 收编的四枚）。 */
export type ExtraPixelGlyphName = keyof typeof PIXEL_GLYPHS_EXTRA;

/** 16×16 像素房子（原 T66-01 局部 PixelHomeGlyph）。 */
export const PixelHomeGlyph = createPixelGlyph(PIXEL_GLYPHS_EXTRA.Home, 'PixelHomeGlyph');
/** 16×16 像素待办（原 T66-01 局部 PixelTodoGlyph，待办卡头装饰）。 */
export const PixelTodoGlyph = createPixelGlyph(PIXEL_GLYPHS_EXTRA.Todo, 'PixelTodoGlyph');
/** 16×16 像素店铺 / 货架（原 T72-01 局部 PixelShopGlyph，顶栏市场入口钮）。 */
export const PixelShopGlyph = createPixelGlyph(PIXEL_GLYPHS_EXTRA.Shop, 'PixelShopGlyph');
/** 16×16 像素调色板（原 T65-01 局部 PixelPaletteGlyph，顶栏配色画廊入口钮）。 */
export const PixelPaletteGlyph = createPixelGlyph(PIXEL_GLYPHS_EXTRA.Palette, 'PixelPaletteGlyph');
