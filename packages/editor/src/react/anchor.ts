/**
 * anchor.ts —— T36-01 的**纯几何层**（无 DOM / 无 PM 依赖，可单测数值断言）。
 *
 * ① `handleTopForFirstLine`：手柄簇定位（§1.1）——簇垂直中心 = 归属块**首行行框**
 *    的垂直中心，偏差 ≤1px。多行块只喂首行盒（不用「块高/2」近似）。
 * ② `firstLineAnchorCompensation`：换块型视觉锚定（§1.2）——换型前后首行行框中心
 *    位移用 padding-top / margin-top 补偿回零（保中心不动，字号变化只在行框内吸收）。
 *    margin 补偿按 CSS 坍缩代数计算：正 margin 取 max、负 margin 相加
 *    （CSS2 §8.3.1），因此无论前邻块 margin-bottom 为何值都能精确命中目标间距。
 *
 * 数值口径：输入输出一律 px（CSS 像素，浮点，不取整）。
 */

/** 手柄簇定位：返回 .pv-handle 的 top（相对定位容器 .pv-body 的偏移）。
 * firstLine = 首行行框盒（coordsAtPos(块内容起点) 或等价量）；containerTop = 定位容器的视口 top。 */
export function handleTopForFirstLine(
  firstLine: { top: number; bottom: number },
  clusterHeight: number,
  containerTop: number,
): number {
  const lineCenter = (firstLine.top + firstLine.bottom) / 2;
  return lineCenter - clusterHeight / 2 - containerTop;
}

/**
 * 首行行框量测：非叶子块取「块内容起点（pos+1）的光标盒」——它就是该块**首行**的
 * 行框（多行块/标题/代码块都只取首行，不做「块高/2」近似）；叶子块（divider/image）
 * 无内容行框，返回 null（调用方退化整块盒）。量测失败（pos 越界/视口未布局）返回 null。
 */
export function firstLineRectOf(
  view: { coordsAtPos: (pos: number) => { top: number; bottom: number } },
  node: { isLeaf: boolean },
  pos: number,
): { top: number; bottom: number } | null {
  if (node.isLeaf) {
    return null;
  }
  try {
    const rect = view.coordsAtPos(pos + 1);
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) {
      return null;
    }
    return { top: rect.top, bottom: rect.bottom };
  } catch {
    return null;
  }
}

/** 换块型首行锚定的输入（全部为**换型后**新元素的 computed 量 + 前后中心量测值）。 */
export interface FirstLineAnchorInput {
  /** 换型前首行行框中心的视口 Y。 */
  centerBefore: number;
  /** 换型后（补偿前）首行行框中心的视口 Y。 */
  centerAfter: number;
  /** 新块型元素的 padding-top（computed px）。 */
  paddingTopAfter: number;
  /** 新块型元素的 margin-top（computed px，可为负）。 */
  marginTopAfter: number;
  /** 前邻块的 margin-bottom（computed px）；null = 该块是首块（其 margin-top 与父级
   * 坍缩、对可见布局无效，只能用 padding 补偿，残差见 report）。 */
  marginBottomPrev: number | null;
}

/** 换块型首行锚定的输出补偿样式（应写到新元素的 inline style）。 */
export interface FirstLineAnchorStyle {
  /** 应写入 el.style.paddingTop 的值（px，≥0）。 */
  paddingTop: number;
  /** 应写入 el.style.marginTop 的值（px，可为负）。 */
  marginTop: number;
}

/** 位移量测的判零阈（亚像素；低于它不落补偿，避免无谓 inline style）。 */
const SUBPIXEL = 0.5;

/**
 * 计算把首行行框中心拉回 centerBefore 所需的 padding-top / margin-top 补偿。
 *
 * 模型：首行中心 = 块顶 + padding-top + 行框半高。换型后行框半高由新块型决定
 * （不可改），因此：
 *   - 下移方向用 padding-top（不参与坍缩，精确）；
 *   - padding 被 0 截断后的残差（需要上移）用 margin-top 补——按坍缩代数把
 *     「前邻 margin-bottom + 自己 margin-top」的坍缩值精确推到目标。
 */
export function firstLineAnchorCompensation(input: FirstLineAnchorInput): FirstLineAnchorStyle {
  const delta = input.centerBefore - input.centerAfter;
  if (Math.abs(delta) < SUBPIXEL) {
    return { paddingTop: input.paddingTopAfter, marginTop: input.marginTopAfter };
  }
  const paddingTop = Math.max(0, input.paddingTopAfter + delta);
  const applied = paddingTop - input.paddingTopAfter;
  const residual = delta - applied; // ≤ 0：padding 截断后仍需上移的量
  if (input.marginBottomPrev === null || Math.abs(residual) < SUBPIXEL) {
    return { paddingTop, marginTop: input.marginTopAfter };
  }
  // 当前坍缩值 V（正负 margin 相邻时：正取 max、负相加）
  const mbPrev = input.marginBottomPrev;
  const collapsed =
    input.marginTopAfter < 0 || mbPrev < 0
      ? mbPrev + input.marginTopAfter
      : Math.max(mbPrev, input.marginTopAfter);
  const target = collapsed + residual;
  const marginTop = mbPrev >= 0 && target >= mbPrev ? target : target - mbPrev;
  return { paddingTop, marginTop };
}
