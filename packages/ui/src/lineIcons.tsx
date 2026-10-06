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
  | { readonly tag: 'path'; readonly d: string; readonly className?: string }
  | {
      readonly tag: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
      readonly className?: string;
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
  ],

  /* ===== 以下为 T105-01 应用面补齐（老板 10-06「取消像素风」）：
     名字与像素族应用面一一对应，几何语言与导轨八枚同源。 =====
   */
  /** 关闭 / X。 */
  X: [
    { tag: 'path', d: 'M6.5 6.5 17.5 17.5' },
    { tag: 'path', d: 'M17.5 6.5 6.5 17.5' },
  ],
  /** 对勾。 */
  Check: [{ tag: 'path', d: 'M5.25 12.4 9.75 16.9 18.75 7.4' }],
  /** 加号。 */
  Plus: [
    { tag: 'path', d: 'M12 5.5v13' },
    { tag: 'path', d: 'M5.5 12h13' },
  ],
  /** 下拉箭头。 */
  CaretDown: [{ tag: 'path', d: 'M6.75 9.75 12 15 17.25 9.75' }],
  /** 上收箭头。 */
  CaretUp: [{ tag: 'path', d: 'M6.75 14.25 12 9 17.25 14.25' }],
  /** 右向箭头。 */
  CaretRight: [{ tag: 'path', d: 'M9.75 6.75 15 12 9.75 17.25' }],
  /** 带折角的文档（页面 + 两条内文线）。 */
  FileText: [
    { tag: 'path', d: 'M6.5 3.75h7l4.5 4.5v11.5h-11.5z' },
    { tag: 'path', d: 'M13.5 3.75v4.5h4.5' },
    { tag: 'path', d: 'M9.25 12.25h5.5' },
    { tag: 'path', d: 'M9.25 15.5h3.5' },
  ],
  /** 文件夹（单层）。 */
  FolderSimple: [
    { tag: 'path', d: 'M3.75 19.75V6.5h5.4l1.8 2.1h9.3v11.15z' },
  ],
  /** 更多（三点）。 */
  DotsThree: [
    { tag: 'path', d: 'M6.5 11.25v1.5' },
    { tag: 'path', d: 'M12 11.25v1.5' },
    { tag: 'path', d: 'M17.5 11.25v1.5' },
  ],
  /** AI 机器人（两态组沿用像素族类名契约：眼 sc-icon__eye / 天线 sc-icon__antenna，
   *  由 pixelIcons.css 的 aria-pressed 规则切换明暗 → 换族后开合态语义保持不变）。 */
  AiRobot: [
    { tag: 'path', d: 'M12 3.6v2.15', className: 'sc-icon__antenna' },
    { tag: 'path', d: 'M12 3.6h0.01', className: 'sc-icon__antenna' },
    { tag: 'rect', x: 4.5, y: 5.75, width: 15, height: 12.75, rx: 3 },
    { tag: 'path', d: 'M9 10.9v2.3', className: 'sc-icon__eye' },
    { tag: 'path', d: 'M15 10.9v2.3', className: 'sc-icon__eye' },
  ],
  /** 圆形对勾（成功）。 */
  CheckCircle: [
    { tag: 'path', d: 'M12 3.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5' },
    { tag: 'path', d: 'M8.25 12.35 10.8 14.9 15.75 9.3' },
  ],
  /** 圆形叹号（警告）。 */
  WarningCircle: [
    { tag: 'path', d: 'M12 3.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5' },
    { tag: 'path', d: 'M12 8v4.75' },
    { tag: 'path', d: 'M12 15.9v0.5' },
  ],
  /** 八角叹号（严重警告）。 */
  WarningOctagon: [
    { tag: 'path', d: 'M8.7 3.75h6.6l4.95 4.95v6.6l-4.95 4.95H8.7l-4.95-4.95v-6.6z' },
    { tag: 'path', d: 'M12 8v4.75' },
    { tag: 'path', d: 'M12 15.9v0.5' },
  ],
  /** 放大镜（搜索）。 */
  MagnifyingGlass: [
    { tag: 'path', d: 'M16.75 10.75a6 6 0 1 0-12 0 6 6 0 0 0 12 0' },
    { tag: 'path', d: 'M15.1 15.1 19.5 19.5' },
  ],
  /** 顺时针箭头（刷新 / 重试）。 */
  ArrowClockwise: [
    { tag: 'path', d: 'M19.25 12a7.25 7.25 0 1 1-2.1-5.1' },
    { tag: 'path', d: 'M17.15 6.9 14.1 8.4' },
    { tag: 'path', d: 'M17.15 6.9 15.6 9.95' },
  ],
  /** 时钟。 */
  Clock: [
    { tag: 'path', d: 'M12 3.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5' },
    { tag: 'path', d: 'M12 7.5V12' },
    { tag: 'path', d: 'M12 12 15.9 14.3' },
  ],
  /** 复制（两张错位卡片）。 */
  Copy: [
    { tag: 'rect', x: 3.75, y: 8.25, width: 11.75, height: 11.75, rx: 2 },
    { tag: 'path', d: 'M8.25 8.25V5.75a2 2 0 0 1 2-2h7.75a2 2 0 0 1 2 2v7.75a2 2 0 0 1-2 2h-2.5' },
  ],
  /** 侧栏（外框 + 左栏线）。 */
  SidebarSimple: [
    { tag: 'rect', x: 3.75, y: 5, width: 16.5, height: 14, rx: 2.25 },
    { tag: 'path', d: 'M9.75 5v14' },
  ],
  /** 星标（收藏）。 */
  Star: [
    {
      tag: 'path',
      d: 'M12 4.1 14.35 8.85 19.6 9.6 15.8 13.3 16.7 18.5 12 16.05 7.3 18.5 8.2 13.3 4.4 9.6 9.65 8.85z',
    },
  ],
  /** 店铺 / 货架（模板市场入口）。 */
  Shop: [
    { tag: 'path', d: 'M4.1 9.5 5.6 4.75h12.8l1.5 4.75' },
    { tag: 'path', d: 'M5.6 9.5v10h12.8v-10' },
    { tag: 'path', d: 'M8.35 9.75v1.5' },
    { tag: 'path', d: 'M12 9.75v1.5' },
    { tag: 'path', d: 'M15.65 9.75v1.5' },
    { tag: 'path', d: 'M10.25 19.5v-4.6h3.5v4.6' },
  ],
  /** 空圈（待办未完成标记）。 */
  Circle: [{ tag: 'path', d: 'M12 3.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5' }],
  /** 齿轮（设置 / 命令回退图标）：双环 + 四枚齿（六齿在 16px 下会糊成噪点）。 */
  GearSix: [
    { tag: 'path', d: 'M19.5 12a7.5 7.5 0 1 0-15 0 7.5 7.5 0 0 0 15 0' },
    { tag: 'path', d: 'M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0' },
    { tag: 'path', d: 'M12 4.5V2' },
    { tag: 'path', d: 'M12 19.5V22' },
    { tag: 'path', d: 'M4.5 12H2' },
    { tag: 'path', d: 'M19.5 12H22' },
  ],
  /** 布局（四格仪表盘，与「多维表格=表头行」的造型区分开）。 */
  Layout: [
    { tag: 'rect', x: 3.75, y: 4.5, width: 16.5, height: 15, rx: 2.25 },
    { tag: 'path', d: 'M12 4.5v15' },
    { tag: 'path', d: 'M3.75 12h16.5' },
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
        className={shape.className}
      />
    );
  }
  return <path key={index} d={shape.d} className={shape.className} />;
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

/* ===== T105-01 应用面补齐（老板 10-06「取消像素风吧，不适合这个软件」）===== */

/** 24×24 线条：关闭 / X。 */
export const LineX = createLineGlyph('X');
/** 24×24 线条：对勾。 */
export const LineCheck = createLineGlyph('Check');
/** 24×24 线条：加号。 */
export const LinePlus = createLineGlyph('Plus');
/** 24×24 线条：下拉箭头。 */
export const LineCaretDown = createLineGlyph('CaretDown');
/** 24×24 线条：上收箭头。 */
export const LineCaretUp = createLineGlyph('CaretUp');
/** 24×24 线条：右向箭头。 */
export const LineCaretRight = createLineGlyph('CaretRight');
/** 24×24 线条：带折角的文档。 */
export const LineFileText = createLineGlyph('FileText');
/** 24×24 线条：文件夹。 */
export const LineFolderSimple = createLineGlyph('FolderSimple');
/** 24×24 线条：更多（三点）。 */
export const LineDotsThree = createLineGlyph('DotsThree');
/** 24×24 线条：AI 机器人（两态组沿用像素族类名契约）。 */
export const LineAiRobot = createLineGlyph('AiRobot');
/** 24×24 线条：圆形对勾（成功）。 */
export const LineCheckCircle = createLineGlyph('CheckCircle');
/** 24×24 线条：圆形叹号（警告）。 */
export const LineWarningCircle = createLineGlyph('WarningCircle');
/** 24×24 线条：八角叹号（严重警告）。 */
export const LineWarningOctagon = createLineGlyph('WarningOctagon');
/** 24×24 线条：放大镜（搜索）。 */
export const LineMagnifyingGlass = createLineGlyph('MagnifyingGlass');
/** 24×24 线条：顺时针箭头（刷新）。 */
export const LineArrowClockwise = createLineGlyph('ArrowClockwise');
/** 24×24 线条：时钟。 */
export const LineClock = createLineGlyph('Clock');
/** 24×24 线条：复制。 */
export const LineCopy = createLineGlyph('Copy');
/** 24×24 线条：侧栏。 */
export const LineSidebarSimple = createLineGlyph('SidebarSimple');
/** 24×24 线条：星标。 */
export const LineStar = createLineGlyph('Star');
/** 24×24 线条：店铺 / 货架（模板市场入口）。 */
export const LineShop = createLineGlyph('Shop');

/** 24×24 线条：空圈（待办未完成）。 */
export const LineCircle = createLineGlyph('Circle');
/** 24×24 线条：齿轮（设置）。 */
export const LineGearSix = createLineGlyph('GearSix');
/** 24×24 线条：布局（四格）。 */
export const LineLayout = createLineGlyph('Layout');

/* ===== 应用面名字别名（**唯一图标语言切换点**）=====
 * 老板 10-06「取消像素风」：自本版起，下列**沿用像素族旧名的名字**一律指向线族实现，
 * 因此三处消费目录（renderer / editor / dbview）的 `icon={X}` 调用点**零改动**即换装。
 *
 * 纪律：
 *  - 像素族实现与其层测仍在 `./pixelIcons` / `./icons`（作**旧观感基线**，应用零消费）；
 *    需要像素画本体时从 `./pixelIcons` 直接取（层测/质检脚本已如此）。
 *  - 应用代码一律用这里的名字（或 `Line*` 显式名），禁直接 import 图标库（§16.6 单出口）。
 *  - 冷名（ArrowsClockwise / BookOpen / Circle / Close / GearSix / Info / Layout / PencilSimple /
 *    Search）零消费，暂留像素族出口；要用时先按线族补几何再加别名，别把像素画带回应用面。
 */
export {
  LineAiRobot as AiRobot,
  LineArrowClockwise as ArrowClockwise,
  LineCaretDown as CaretDown,
  LineCaretRight as CaretRight,
  LineCaretUp as CaretUp,
  LineBookOpen as BookOpen,
  LineCircle as Circle,
  LineCheck as Check,
  LineCheckCircle as CheckCircle,
  LineClock as Clock,
  LineCopy as Copy,
  LineDotsThree as DotsThree,
  LineFileText as FileText,
  LineFolderSimple as FolderSimple,
  LineGearSix as GearSix,
  LineLayout as Layout,
  LineMagnifyingGlass as MagnifyingGlass,
  LineNote as Note,
  LinePlus as Plus,
  LineSidebarSimple as SidebarSimple,
  LineStar as Star,
  LineTrash as Trash,
  LineWarningCircle as WarningCircle,
  LineWarningOctagon as WarningOctagon,
  LineX as X,
};