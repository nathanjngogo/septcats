/**
 * blockLabels.ts —— R25（T76-01）两个新块内置控件的**文案注入点**。
 *
 * 为什么要有这一层：`@septcats/editor` 包（含 NodeView）不在 apps 的 i18n 扫描面内，
 * 本包既有控件（BlockControls 的「块操作」「新增块」等）一律用中文字面量。R25 的红线
 * 要求「i18n 成对（zh/en）」，故把新控件的可访问名/占位文案抽成**注入契约**：
 * 宿主（PageView）用 `t(...)` 传入 en/zh 文案，缺省回落到本包的中文默认值
 * （与既有控件口径一致，editor 包单测无需任何 i18n 依赖）。
 *
 * 值里禁省略号占位（T71 D-4 教训）：全部是完整文案。
 */

/** 表格块的按钮/输入文案。 */
export interface BlockLabels {
  /** 「添加行」。 */
  tableAddRow: string;
  /** 「添加列」。 */
  tableAddCol: string;
  /** 「删除行」（行柄可访问名）。 */
  tableDelRow: string;
  /** 「删除列」（列柄可访问名）。 */
  tableDelCol: string;
  /** 表头开关：当前为表头态时的可访问名（点击=取消表头）。 */
  tableHeaderOn: string;
  /** 表头开关：当前为非表头态时的可访问名（点击=设为表头）。 */
  tableHeaderOff: string;
  /** 列宽拖拽柄可访问名。 */
  tableColResize: string;
  /** 单元格输入框可访问名前缀（后接行列号）。 */
  tableCell: string;
  /** 单元格占位符。 */
  tableCellPlaceholder: string;
  /** 折叠列表：展开（当前收起）。 */
  toggleExpand: string;
  /** 折叠列表：收起（当前展开）。 */
  toggleCollapse: string;
  /** 折叠列表标题占位符。 */
  toggleTitlePlaceholder: string;
  /** 折叠列表正文行占位符。 */
  toggleBodyPlaceholder: string;
}

/** 本包默认文案（中文；与 BlockControls/SlashMenu 既有的中文字面量口径一致）。 */
export const DEFAULT_BLOCK_LABELS: BlockLabels = {
  tableAddRow: '添加行',
  tableAddCol: '添加列',
  tableDelRow: '删除行',
  tableDelCol: '删除列',
  tableHeaderOn: '取消表头',
  tableHeaderOff: '设为表头',
  tableColResize: '调整列宽',
  tableCell: '单元格',
  tableCellPlaceholder: ' ',
  toggleExpand: '展开',
  toggleCollapse: '收起',
  toggleTitlePlaceholder: '折叠列表标题',
  toggleBodyPlaceholder: ' ',
};

/** 合并宿主注入（缺省/缺键回落默认；注入 undefined 不覆盖）。 */
export function mergeBlockLabels(partial?: Partial<BlockLabels>): BlockLabels {
  if (partial === undefined) {
    return DEFAULT_BLOCK_LABELS;
  }
  const merged: BlockLabels = { ...DEFAULT_BLOCK_LABELS };
  for (const key of Object.keys(DEFAULT_BLOCK_LABELS) as Array<keyof BlockLabels>) {
    const value = partial[key];
    if (typeof value === 'string') {
      merged[key] = value;
    }
  }
  return merged;
}
