/**
 * table.ts —— R25（T76-01）10 · table（单块自包含表格）。
 *
 * 三层分工：
 * - 真相层 content = `{ rows: string[][], header: boolean, colWidths?: number[] }`（content.ts）；
 * - PM 侧是 **atom 节点**（无 content 表达式），attrs 与 content 键**逐字同名**
 *   （rows / header / colWidths）——投影/反投影两侧零映射；
 * - 交互（单元格输入、加删行列、表头开关、列宽拖拽、Tab 移焦）全在**原生 DOM NodeView**
 *   内：本包依赖白名单只有 @tiptap/core + @tiptap/pm（无 @tiptap/react、无第三方
 *   UI 库、不加依赖），故不引 ReactNodeViewRenderer，直接手写 NodeView。
 *
 * 为什么 atom 而非嵌套 PM 子节点：PRD §2A 显性不做嵌套子块——op-log 事件流下
 * 行/列的增删序列化边界会爆炸；单块模型下「一个块 = 一个原子」的落库/同步/导入导出
 * 与 code 块同构，op-log targetTable 一字不动。
 */
import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import {
  TABLE_DEFAULT_COL_WIDTH,
  normalizeTableContent,
  tableAddCol,
  tableAddRow,
  tableColCount,
  tableDeleteCol,
  tableDeleteRow,
  tableGridTemplate,
  tableResizeColumn,
  tableSetCell,
  tableSetHeader,
  type TableContent,
} from '../content';
import { DEFAULT_BLOCK_LABELS, type BlockLabels } from './blockLabels';
import { blockClass, blockIdAttribute, joinClass } from './shared';

/**
 * PM 节点名 = 真相层类型名（无同名 mark，故不需要 code 那样的改名映射）。
 * 导出为常量：NodeView/测试/其它模块都从这里取，禁散落字面量。
 */
export const TABLE_PM_NAME = 'table';

/** 表格根 DOM 的 testid（探针锚点）。 */
export const TABLE_ROOT_TESTID = 'septcats-block-table';
/** 列宽拖拽的最小位移（px）：低于此值不产生事务（避免点击抖动改宽度）。 */
export const TABLE_RESIZE_DRAG_THRESHOLD = 2;

/** 行/列操作后的目标焦点（结构重建后由 update() 兑现）。 */
interface CellFocus {
  row: number;
  col: number;
}

/** 从 PM 节点读回规范 content（attrs 缺省/半合法也永不抛）。 */
export function tableContentOf(node: PMNode): TableContent {
  return normalizeTableContent({
    rows: node.attrs['rows'],
    header: node.attrs['header'],
    colWidths: node.attrs['colWidths'],
  });
}

function buttonOf(testId: string, label: string, className: string, glyph: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('data-testid', testId);
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.textContent = glyph;
  return button;
}

/** 内置控件吃的 DOM 事件白名单——PM 一律不参与（见 stopEvent）。 */
const INNER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'cut',
  'copy',
  'dragstart',
  'dragover',
  'drop',
  'dragend',
  'focusin',
  'focusout',
  'wheel',
]);

/**
 * 表格 NodeView（原生 DOM）。
 * 结构变化（行/列数、表头、列宽）→ 重建 DOM；仅数值变化 → 就地改写 input.value，
 * 避免「每敲一个字就重建 DOM 丢焦点」。
 */
export function createTableView(
  props: { node: PMNode; editor: Editor; getPos: () => number | undefined },
  labels: BlockLabels = DEFAULT_BLOCK_LABELS,
): NodeView {
  let current = props.node;
  let inputs: HTMLInputElement[][] = [];
  let pendingFocus: CellFocus | null = null;
  let drag: { index: number; startX: number; base: number[] } | null = null;
  const inner = document.createElement('div');
  const dom = document.createElement('div');
  dom.className = blockClass(TABLE_PM_NAME);
  dom.setAttribute('data-testid', TABLE_ROOT_TESTID);
  // 原子块：整块非可编辑区，交互全部落在内置控件（input/button）上
  dom.contentEditable = 'false';
  inner.className = 'sc-table';
  dom.appendChild(inner);

  const content = (): TableContent => tableContentOf(current);

  const commit = (next: TableContent): void => {
    const pos = props.getPos();
    if (typeof pos !== 'number') {
      return;
    }
    props.editor.view.dispatch(
      props.editor.state.tr.setNodeMarkup(pos, undefined, {
        ...current.attrs,
        rows: next.rows,
        header: next.header,
        colWidths: next.colWidths ?? null,
      }),
    );
  };

  const applyId = (): void => {
    const id: unknown = current.attrs['id'];
    if (typeof id === 'string' && id.length > 0) {
      dom.setAttribute('data-id', id);
    } else {
      dom.removeAttribute('data-id');
    }
  };

  const rowTemplate = (value: TableContent): string =>
    `${tableGridTemplate(value)} var(--sc-size-control-sm)`;

  const applyTemplate = (value: TableContent): void => {
    const template = rowTemplate(value);
    for (const child of [...inner.children]) {
      if (child instanceof HTMLElement && child.classList.contains('sc-table__row')) {
        child.style.gridTemplateColumns = template;
      }
    }
  };

  /** 量测当前渲染宽度（jsdom 恒 0 → 退化到默认列宽，保证确定性）。 */
  const measureWidths = (): number[] => {
    const cols = tableColCount(content());
    const first = inputs[0] ?? [];
    const widths: number[] = [];
    for (let col = 0; col < cols; col += 1) {
      const input = first[col];
      const measured = input?.parentElement?.getBoundingClientRect().width ?? 0;
      widths.push(measured > 0 ? measured : TABLE_DEFAULT_COL_WIDTH);
    }
    return widths;
  };

  const focusCell = (row: number, col: number): void => {
    const input = inputs[row]?.[col];
    if (input !== undefined) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };

  const moveFocus = (row: number, col: number, delta: number): void => {
    const value = content();
    const cols = tableColCount(value);
    const flat = row * cols + col + delta;
    const total = value.rows.length * cols;
    if (flat < 0) {
      focusCell(0, 0);
      return;
    }
    if (flat >= total) {
      // 末尾再 Tab：补一行（Notion 手感），落新行首格
      pendingFocus = { row: value.rows.length, col: 0 };
      commit(tableAddRow(value));
      return;
    }
    focusCell(Math.floor(flat / cols), flat % cols);
  };

  const onCellKeyDown = (event: KeyboardEvent, row: number, col: number): void => {
    if (event.key === 'Tab') {
      event.preventDefault();
      moveFocus(row, col, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = content();
      if (row >= value.rows.length - 1) {
        pendingFocus = { row: value.rows.length, col };
        commit(tableAddRow(value));
      } else {
        focusCell(row + 1, col);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      (event.target as HTMLElement | null)?.blur();
    }
  };

  const startColResize = (event: MouseEvent, index: number): void => {
    event.preventDefault();
    const value = content();
    drag = { index, startX: event.clientX, base: value.colWidths ?? measureWidths() };
    const onMove = (moveEvent: MouseEvent): void => {
      if (drag === null) {
        return;
      }
      const widened = tableResizeColumn({ ...value, colWidths: drag.base }, drag.index, moveEvent.clientX - drag.startX);
      if (widened.colWidths !== undefined) {
        applyTemplate({ ...value, colWidths: widened.colWidths });
      }
    };
    const onUp = (upEvent: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (drag === null) {
        return;
      }
      const state = drag;
      drag = null;
      const delta = upEvent.clientX - state.startX;
      if (Math.abs(delta) < TABLE_RESIZE_DRAG_THRESHOLD) {
        return;
      }
      commit(tableResizeColumn({ ...content(), colWidths: state.base }, state.index, delta));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const build = (): void => {
    applyId();
    const value = content();
    const cols = tableColCount(value);
    const template = rowTemplate(value);
    inner.textContent = '';
    inputs = [];

    const colTools = document.createElement('div');
    colTools.className = 'sc-table__row sc-table__row--coltools';
    colTools.style.gridTemplateColumns = template;
    for (let col = 0; col < cols; col += 1) {
      const holder = document.createElement('div');
      holder.className = 'sc-table__toolcell';
      const del = buttonOf(
        `block-table-del-col-${String(col)}`,
        labels.tableDelCol,
        'sc-table__handle',
        '×',
      );
      del.addEventListener('click', () => {
        commit(tableDeleteCol(content(), col));
      });
      const grip = document.createElement('span');
      grip.className = 'sc-table__colresize';
      grip.setAttribute('data-col', String(col));
      grip.setAttribute('role', 'separator');
      grip.setAttribute('aria-orientation', 'vertical');
      grip.setAttribute('aria-label', `${labels.tableColResize} ${String(col + 1)}`);
      grip.addEventListener('mousedown', (mouseEvent) => {
        startColResize(mouseEvent, col);
      });
      holder.append(del, grip);
      colTools.appendChild(holder);
    }
    const colSpacer = document.createElement('div');
    colSpacer.className = 'sc-table__toolcell sc-table__toolcell--spacer';
    colTools.appendChild(colSpacer);
    inner.appendChild(colTools);

    value.rows.forEach((cells, rowIndex) => {
      const rowEl = document.createElement('div');
      const isHeaderRow = value.header && rowIndex === 0;
      rowEl.className = joinClass(
        'sc-table__row',
        isHeaderRow ? 'sc-table__row--header' : '',
      );
      rowEl.setAttribute('data-row', String(rowIndex));
      rowEl.style.gridTemplateColumns = template;
      const rowInputs: HTMLInputElement[] = [];
      cells.forEach((cell, colIndex) => {
        const cellEl = document.createElement('div');
        cellEl.className = 'sc-table__cell';
        cellEl.setAttribute('data-col', String(colIndex));
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sc-table__input';
        input.setAttribute('data-testid', `block-table-cell-${String(rowIndex)}-${String(colIndex)}`);
        input.setAttribute('data-row', String(rowIndex));
        input.setAttribute('data-col', String(colIndex));
        input.setAttribute(
          'aria-label',
          `${labels.tableCell} ${String(rowIndex + 1)} ${String(colIndex + 1)}`,
        );
        input.placeholder = labels.tableCellPlaceholder;
        input.value = cell;
        // 单元格写入：input（键入/IME）与 change（失焦提交）两路同口径；
        // 值未变则**不派发事务**（否则每次失焦都白写一轮 patch op）。
        const onCellValue = (): void => {
          const value = content();
          if (value.rows[rowIndex]?.[colIndex] === input.value) {
            return;
          }
          commit(tableSetCell(value, rowIndex, colIndex, input.value));
        };
        input.addEventListener('input', onCellValue);
        input.addEventListener('change', onCellValue);
        input.addEventListener('keydown', (keyEvent) => {
          onCellKeyDown(keyEvent, rowIndex, colIndex);
        });
        cellEl.appendChild(input);
        rowEl.appendChild(cellEl);
        rowInputs.push(input);
      });
      const rowTools = document.createElement('div');
      rowTools.className = 'sc-table__rowtools';
      const delRow = buttonOf(
        `block-table-del-row-${String(rowIndex)}`,
        labels.tableDelRow,
        'sc-table__handle',
        '×',
      );
      delRow.addEventListener('click', () => {
        commit(tableDeleteRow(content(), rowIndex));
      });
      rowTools.appendChild(delRow);
      rowEl.appendChild(rowTools);
      inner.appendChild(rowEl);
      inputs.push(rowInputs);
    });

    const bar = document.createElement('div');
    bar.className = 'sc-table__bar';
    const addRow = buttonOf('block-table-add-row', labels.tableAddRow, 'sc-table__pixbtn', '+');
    addRow.addEventListener('click', () => {
      const value2 = content();
      pendingFocus = { row: value2.rows.length, col: 0 };
      commit(tableAddRow(value2));
    });
    const addCol = buttonOf('block-table-add-col', labels.tableAddCol, 'sc-table__pixbtn', '+');
    addCol.addEventListener('click', () => {
      commit(tableAddCol(content()));
    });
    const headerBtn = buttonOf(
      'block-table-header-toggle',
      value.header ? labels.tableHeaderOn : labels.tableHeaderOff,
      'sc-table__pixbtn',
      'H',
    );
    headerBtn.setAttribute('aria-pressed', value.header ? 'true' : 'false');
    headerBtn.addEventListener('click', () => {
      commit(tableSetHeader(content(), !content().header));
    });
    bar.append(addRow, addCol, headerBtn);
    inner.appendChild(bar);
  };

  /** 仅数值变化（输入/撤销/协同回声）：就地改写，绝不重建 DOM（防丢焦点）。 */
  const syncValues = (): void => {
    applyId();
    const value = content();
    for (let row = 0; row < value.rows.length; row += 1) {
      const cells = value.rows[row] ?? [];
      for (let col = 0; col < cells.length; col += 1) {
        const input = inputs[row]?.[col];
        const expected = cells[col] ?? '';
        if (input !== undefined && input.value !== expected && document.activeElement !== input) {
          input.value = expected;
        }
      }
    }
    applyTemplate(value);
  };

  const structureKey = (node: PMNode): string => {
    const value = tableContentOf(node);
    return [
      String(value.rows.length),
      String(tableColCount(value)),
      value.header ? 'h1' : 'h0',
      (value.colWidths ?? []).join(','),
    ].join('|');
  };

  // 第三道保险：表内按键/输入**不冒泡出表**——宿主在 .pv-body 上的 keydown
  // （斜杠菜单触发）不得被表内打字唤醒（stopEvent 只挡 PM 自己，挡不住宿主监听）。
  for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput']) {
    dom.addEventListener(type, (event) => {
      event.stopPropagation();
    });
  }

  build();

  return {
    dom,
    update: (updated: PMNode): boolean => {
      if (updated.type.name !== TABLE_PM_NAME) {
        return false;
      }
      const previousKey = structureKey(current);
      current = updated;
      if (structureKey(updated) !== previousKey) {
        build();
        if (pendingFocus !== null) {
          const target = pendingFocus;
          pendingFocus = null;
          focusCell(target.row, target.col);
        }
      } else {
        syncValues();
      }
      return true;
    },
    // PM 不参与内置控件的任何事件（否则 mousedown 会被抢成 NodeSelection、keydown 会被
    // 抢成块级快捷键）。stopEvent 是 ProseMirror 官方口子（经 eventBelongsToView 生效）；
    // 容器上的 stopPropagation 是第二道保险（见 build 前的 keydown 兜底监听）。
    // 注：本文件的 `Node` 标识符被 Tiptap 的 Node 占用，DOM 判定显式走 globalThis.Node。
    stopEvent: (event: Event): boolean =>
      INNER_EVENT_TYPES.has(event.type) &&
      event.target instanceof globalThis.Node &&
      dom.contains(event.target),
    ignoreMutation: (): boolean => true,
    destroy: (): void => {
      drag = null;
    },
    selectNode: (): void => {
      dom.classList.add('sc-block--selected');
    },
    deselectNode: (): void => {
      dom.classList.remove('sc-block--selected');
    },
  };
}

export const TableNode = Node.create({
  name: TABLE_PM_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { labels: DEFAULT_BLOCK_LABELS as BlockLabels };
  },

  addAttributes() {
    return {
      ...blockIdAttribute,
      // 结构化内容走 attrs（与真相层 content 键逐字同名）；默认值全是**静态标量**
      // （null/true）——数组默认值会被同型节点共享，故一律由 normalize 现场生成。
      rows: {
        default: null,
        parseHTML: (): null => null,
        renderHTML: (): Record<string, unknown> => ({}),
      },
      header: {
        default: true,
        parseHTML: (): null => null,
        renderHTML: (): Record<string, unknown> => ({}),
      },
      colWidths: {
        default: null,
        parseHTML: (): null => null,
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },

  // 外部 HTML 不产出表格块（本块只由斜杠菜单 / markdown 表格解析 / 输入规则创建）：
  // 无 parseHTML 规则 = DOMParser 永不命中，粘贴外部 <table> 时按默认段落粒度收口。
  parseHTML() {
    return [];
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = tableContentOf(node);
    const body: DOMOutputSpec[] = value.rows.map((cells, rowIndex) => {
      const tag = value.header && rowIndex === 0 ? 'th' : 'td';
      const cellSpecs: DOMOutputSpec[] = cells.map((cell) => [tag, {}, cell]);
      return ['tr', {}, ...cellSpecs];
    });
    const table: DOMOutputSpec = ['table', { class: 'sc-table__plain' }, ['tbody', {}, ...body]];
    return [
      'div',
      { ...HTMLAttributes, class: blockClass(TABLE_PM_NAME), 'data-table': 'true' },
      table,
    ];
  },

  addNodeView() {
    const labels = this.options.labels;
    return (viewProps) =>
      createTableView(
        { node: viewProps.node, editor: viewProps.editor, getPos: () => viewProps.getPos() },
        labels,
      );
  },
});
