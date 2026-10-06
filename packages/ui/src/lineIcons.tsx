/*
 * lineIcons.tsx —— **线条图标族**（老板 2026-10-06 令，附截图红框=一级导航轨：
 * 「红框内，全部改为线条图标，设计要简约。」）
 *
 * 与既有族的关系：
 *   - `./pixelIcons` + `./icons` = 16×16 硬边**像素族**（全仓既有默认族，T58-01 起的唯一族）。
 *   - 本文件 = 24×24 网格上的**描边线族**：`stroke=currentColor`、描边 1.5、圆头圆角、**零填充**。
 *     目前唯一消费面 = 一级导航轨（`nav/NavRail`）。
 *
 * 纪律（有意放宽的窄例外，边界写死防蔓延）：
 *   - §16.6 原口径「全仓单图标族」→ 本族是老板明令的第二族。两族仍**共用唯一出口 `./Icon`**
 *     （`<Icon icon={LineNote} />`），业务代码照样不得直接 import 任何图标库。
 *   - **新调用点除导航轨外必须先问老板**：线族不是「更精致的像素族」，是特定结构层（窄轨/导航）
 *     的语言；像素族继续服务顶栏以外的既有全部界面。
 *   - 尺寸：几何画在 24 网格上，渲染尺寸仍走 `Icon` 的 16/20/24 档（允许显式数字）。
 *   - 描边宽度与 `Icon` 的 `ICON_STROKE_WIDTH`（phosphor 时代遗留常量）同值 1.5；
 *     语义不同：像素族**不消费**该常量，本族**真的消费**（描边就是它的全部）。
 *
 * 自检（族契约见 `lineIcons.test.tsx`）：每枚 = 若干 <path>/<rect>，一律无 fill、
 * 坐标全部落在 0..24 网格内、`data-line-glyph` 标记族名（探针据此认族，不靠类名猜）。
 */
import type { ReactNode, SVGProps } from 'react';
import { clsx } from 'clsx';

/** 线族画格边长（几何坐标系）。 */
export const LINE_GLYPH_GRID = 24;
/** 线族描边宽度（几何坐标系内的值；渲染缩放到 16/20/24 档时按比例缩放）。 */
export const LINE_GLYPH_STROKE = 1.5;

export interface LineGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  /** 边长（px），默认 24（= 画格边长，1:1 不缩放）。 */
  size?: number;
  /** 语义色；缺省继承 currentColor。 */
  color?: string;
}

/** 线族形状基元（数据即几何，便于测试逐枚核对）。 */
export type LineShape =
  | { readonly tag: 'path'; readonly d: string }
  | {
      readonly tag: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    };

/**
 * 八枚线族 glyph 的几何（顺序与导航轨一致：笔记/知识库/日历/多维表格/待办/工作台/模板/回收站）。
 * 造型原则：单一视觉重量（同一描边）、光学盒统一在 3.5..20.9、圆头收尾、不用装饰线。
 */
export const LINE_GLYPHS = {
  /** 笔记：一页纸 + 两条内文线（**不画装订竖线**：上一版「框 + 左侧竖线」被独立视觉评审
   *  读成「侧栏 / 布局」，去掉竖线后语义回到"纸页"，且墨量降一档）。 */
  Note: [
    { tag: 'rect', x: 5.5, y: 4.25, width: 13, height: 15.5, rx: 2 },
    { tag: 'path', d: 'M8.75 9.5h6.5' },
    { tag: 'path', d: 'M8.75 13.25h4' },
  ],
  /** 知识库：摊开的书（左右页 + 中缝 + 每页一条内文线）。 */
  BookOpen: [
    { tag: 'path', d: 'M12 7.1c-1.8-1.5-4.4-2.1-7-2.1v12.2c2.6 0 5.2.6 7 2.1' },
    { tag: 'path', d: 'M12 7.1c1.8-1.5 4.4-2.1 7-2.1v12.2c-2.6 0-5.2.6-7 2.1' },
    { tag: 'path', d: 'M12 7.1v12.2' },
    { tag: 'path', d: 'M6.75 9.4h3.5' },
    { tag: 'path', d: 'M13.75 9.4h3.5' },
  ],
  /** 日历：表体 + 表头分隔线 + 两枚**贯穿上沿**的挂钉（上一版挂钉只贴到上沿、20px 下与边线粘连）。 */
  Calendar: [
    { tag: 'rect', x: 3.75, y: 6, width: 16.5, height: 14.5, rx: 2.25 },
    { tag: 'path', d: 'M3.75 10.75h16.5' },
    { tag: 'path', d: 'M8.5 3.5v4' },
    { tag: 'path', d: 'M15.5 3.5v4' },
  ],
  /** 多维表格：表体 + 表头行 + 表头以下一条居中列线（**撤两条通高窄列线**：20px 下会糊成灰块）。 */
  Table: [
    { tag: 'rect', x: 3.75, y: 5.5, width: 16.5, height: 14.75, rx: 2.25 },
    { tag: 'path', d: 'M3.75 10.25h16.5' },
    { tag: 'path', d: 'M12 10.25v10' },
  ],
  /** 待办：勾选框（框内打勾）+ 两条事项线 + 一条通条线（上一版「三行勾线」无外框、被读成目录）。 */
  Todo: [
    { tag: 'rect', x: 3.75, y: 6.75, width: 9.5, height: 9.5, rx: 2.5 },
    { tag: 'path', d: 'M6.5 11.3l1.4 1.5 2.7-3.3' },
    { tag: 'path', d: 'M15.75 9.75h4.5' },
    { tag: 'path', d: 'M15.75 13.5h4.5' },
    { tag: 'path', d: 'M3.75 19h16.5' },
  ],
  /** 工作台：房子（坡顶 + 墙体 + 门），语义沿用本仓既有「房子 = 工作台」心智。 */
  Home: [
    { tag: 'path', d: 'M4.25 19.75V10.4L12 4.5l7.75 5.9v9.35H4.25' },
    { tag: 'path', d: 'M9.5 19.75v-4.9h5v4.9' },
  ],
  /** 模板：模板页画廊（两小格 + 一条宽卡）——上一版「叠层」二/三层在 20px 下均并成噪块，
   *  且通用心智是"图层"而非"模板"；卡格造型与「模板市场」语义对齐，格间留空不糊。 */
  Layers: [
    { tag: 'rect', x: 3.75, y: 5.25, width: 6.5, height: 6.25, rx: 1.75 },
    { tag: 'rect', x: 13.75, y: 5.25, width: 6.5, height: 6.25, rx: 1.75 },
    { tag: 'rect', x: 3.75, y: 14.5, width: 16.5, height: 6, rx: 1.75 },
  ],
  /** 回收站：桶盖 + 提手 + 桶身 + 两条桶纹。 */
  Trash: [
    { tag: 'path', d: 'M4.5 7.25h15' },
    { tag: 'path', d: 'M9.9 7.25V4.75h4.2v2.5' },
    { tag: 'path', d: 'M6.6 7.25 7.5 20h9l.9-12.75' },
    { tag: 'path', d: 'M10 10.75v5.5' },
    { tag: 'path', d: 'M14 10.75v5.5' },
  ],
} as const satisfies Record<string, readonly LineShape[]>;

/** 线族 glyph 名。 */
export type LineGlyphName = keyof typeof LINE_GLYPHS;

/** 线族 SVG 属性（族契约集中在这一处：配色/描边/圆头/零填充）。 */
function lineSvgProps(
  size: number | undefined,
  color: string | undefined,
  className: string | undefined,
): SVGProps<SVGSVGElement> {
  const px = size ?? LINE_GLYPH_GRID;
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${String(LINE_GLYPH_GRID)} ${String(LINE_GLYPH_GRID)}`,
    width: px,
    height: px,
    fill: 'none',
    stroke: color ?? 'currentColor',
    strokeWidth: LINE_GLYPH_STROKE,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    color,
    focusable: 'false',
    className: clsx('sc-icon', 'sc-icon--line', className),
  };
}

/** 形状 → JSX（统一 key 规则，禁 fill）。 */
function renderShape(shape: LineShape, index: number): ReactNode {
  if (shape.tag === 'rect') {
    return (
      <rect
        key={index}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={shape.rx}
      />
    );
  }
  return <path key={index} d={shape.d} />;
}

/** 线族组件工厂：一枚 glyph = 一组描边基元。 */
function createLineGlyph<T extends LineGlyphName>(name: T) {
  function LineGlyph({ size, color, className, ...rest }: LineGlyphProps): ReactNode {
    return (
      <svg {...rest} {...lineSvgProps(size, color, className)} data-line-glyph={name}>
        {LINE_GLYPHS[name].map((shape, index) => renderShape(shape, index))}
      </svg>
    );
  }
  LineGlyph.displayName = `Line${name}`;
  return LineGlyph;
}

/** 24×24 线条：笔记本（笔记）。 */
export const LineNote = createLineGlyph('Note');
/** 24×24 线条：摊开的书（知识库）。 */
export const LineBookOpen = createLineGlyph('BookOpen');
/** 24×24 线条：日历。 */
export const LineCalendar = createLineGlyph('Calendar');
/** 24×24 线条：表格网格（多维表格）。 */
export const LineTable = createLineGlyph('Table');
/** 24×24 线条：清单勾（待办）。 */
export const LineTodo = createLineGlyph('Todo');
/** 24×24 线条：房子（工作台）。 */
export const LineHome = createLineGlyph('Home');
/** 24×24 线条：叠层（模板）。 */
export const LineLayers = createLineGlyph('Layers');
/** 24×24 线条：垃圾桶（回收站）。 */
export const LineTrash = createLineGlyph('Trash');