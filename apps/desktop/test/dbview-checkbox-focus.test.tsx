// @vitest-environment jsdom
/**
 * dbview-checkbox-focus.test.tsx —— TASK-T47-01 勾选格键盘「跨 reload / 跨重挂」回归。
 *
 * 复现的真实链路（真机可复现，见 docs/tasks/TASK-T47-01-report.md）：
 *   单击勾选格 → onFocusCell 记焦点 → onChangeValue → 宿主 DbPage reload
 *   → status='loading'（真机渲染骨架）→ DbView 整树**卸载**（组件内 focusedCell
 *   随之丢失）→ 数据到位后重挂，DOM 焦点落回 body
 *   → 此后 Enter/Space 收不到事件（onGridKeyDown 以 focusedCell===null 早退）
 *   ⇒ 勾选格键盘「只能生效一次」，点击后无法键盘接力。
 *
 * 修复（packages/dbview/src/react/DbView.tsx）两处：
 *   ① focusedCell 的收敛口径从「views 引用变化」收窄到「collection.id 变化」——
 *      reload 换 views 引用不再吞焦点；
 *   ② 会话级记忆最后聚焦的单元格（collection + 记录 id + 属性 id），整树重挂后
 *      按记录 id 反查行号恢复 state 与 DOM 焦点。
 * 键处理与持久化通道一字未改。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectionEntitySchema,
  collectionSchemaSchema,
  defaultView,
  propertySchema,
} from '@septcats/dbview';
import type { CollectionEntity, RecordEntity } from '@septcats/dbview';
import { DbPage } from '../src/renderer/src/db/DbPage';
import { pagesStore } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

const PAGE_ID = 'pg-focus-1';
const TITLE_PID = 'p_title';
const CHECK_PID = 'p_check';

const SCHEMA = collectionSchemaSchema.parse({
  properties: {
    [TITLE_PID]: propertySchema.parse({ id: TITLE_PID, name: '名称', type: 'text' }),
    [CHECK_PID]: propertySchema.parse({ id: CHECK_PID, name: '勾选', type: 'checkbox' }),
  },
  title_pid: TITLE_PID,
});

const COLLECTION: CollectionEntity = collectionEntitySchema.parse({
  id: 'col-focus',
  page_id: PAGE_ID,
  workspace_id: 'ws-test',
  name: '焦点验收库',
  schema: SCHEMA,
  views: [defaultView('v1', '表格')],
  alive: 1,
  version: 1,
});

function makeRecord(values: Record<string, unknown>): RecordEntity {
  return {
    id: 'rec-1',
    collection_id: 'col-focus',
    workspace_id: 'ws-test',
    values,
    sort_key: 'A1',
    alive: 1,
    version: 1,
  };
}

/** 可变存储：假装桥的写真的落库，reload 读回新值（真机同链路）。 */
let store: RecordEntity[] = [];
let loadCalls = 0;

function installBridge(): { recordUpdate: ReturnType<typeof vi.fn> } {
  const recordUpdate = vi.fn(async (input: { recordId: string; patch: Record<string, unknown> }) => {
    store = store.map((record) =>
      record.id === input.recordId ? { ...record, values: { ...record.values, ...input.patch } } : record,
    );
    return { record: store[0] };
  });
  const api = {
    ping: vi.fn(),
    appMeta: vi.fn(),
    db: {
      load: vi.fn(async () => {
        loadCalls += 1;
        // 真机 IPC 是 structured clone：每次 load 都换 collection.views 的数组引用
        // （这正是「reload 顺带清掉 focusedCell」的触发条件，必须复现）
        return {
          collection: structuredClone(COLLECTION),
          records: store.map((record) => ({ ...record, values: { ...record.values } })),
        };
      }),
      create: vi.fn(),
      recordCreate: vi.fn(),
      recordUpdate,
      recordDelete: vi.fn(),
      propAdd: vi.fn(),
      propRemove: vi.fn(),
      propUpdate: vi.fn(),
      viewSave: vi.fn(),
      rename: vi.fn(),
      relationSearch: vi.fn(),
      exportCsv: vi.fn(),
    },
  };
  vi.stubGlobal('septcats', api as unknown as SeptcatsApi);
  return { recordUpdate };
}

const activeCellType = (): string | null => {
  const active = document.activeElement;
  if (active === null || active === undefined) return null;
  // 必须是**单元格本身**获焦（body/祖先元素里也能查到 .sc-dbc，会假绿）
  if ((active as HTMLElement).getAttribute?.('role') !== 'gridcell') return null;
  const dbc = (active as HTMLElement).querySelector?.('.sc-dbc') ?? null;
  return dbc === null ? null : dbc.getAttribute('data-type');
};

const checkboxNode = (): Element | null => document.querySelector('.sc-dbc[data-type="checkbox"]');

/** 落库读回（当前单条记录上的勾选值）。 */
const checkValue = (): unknown => store[0]?.values[CHECK_PID];

/** 等 reload 落地：值已被表格渲染出来（勾选态 class 出现/消失）。 */
async function waitForCheckboxOn(on: boolean): Promise<void> {
  await waitFor(() => {
    expect(document.querySelectorAll('.sc-dbc-check--on').length > 0).toBe(on);
  });
}

beforeEach(() => {
  store = [makeRecord({ [TITLE_PID]: '记录1', [CHECK_PID]: null })];
  loadCalls = 0;
  // jsdom 未实现 scrollIntoView（focusedCell 变化时焦点 effect 会调）
  HTMLElement.prototype.scrollIntoView = vi.fn();
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('勾选格键盘焦点跨 reload / 跨重挂存活（T47-01）', () => {
  it('单击勾选格 → reload 落地后焦点仍在同一格 → Enter 仍能切换（修前红）', async () => {
    installBridge();
    render(<DbPage pageId={PAGE_ID} />);
    await screen.findByText('焦点验收库');
    await waitFor(() => expect(checkboxNode()).not.toBeNull());

    // ① 真实路径：单击勾选格（既有语义：直切 + 落库）。真机单击 = mousedown
    //    （gridcell 的 onMouseDown → onFocusCell）+ click（直切落库）。
    fireEvent.mouseDown(checkboxNode() as HTMLElement);
    fireEvent.click(checkboxNode() as HTMLElement);
    await waitFor(() => expect(checkValue()).toBe(true));
    await waitForCheckboxOn(true);

    // ② reload 落地后，焦点必须仍在同一格（修复点）
    expect(activeCellType()).toBe('checkbox');

    // ③ 键盘接力：Enter 把 true 切回 null 并落库
    const loadsBeforeEnter = loadCalls;
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(checkValue()).toBeNull());
    expect(loadCalls).toBeGreaterThan(loadsBeforeEnter);
  });

  it('键盘双向：Enter / Space 连续切换并落库，且每轮焦点都回到同一格', async () => {
    installBridge();
    render(<DbPage pageId={PAGE_ID} />);
    await screen.findByText('焦点验收库');
    await waitFor(() => expect(checkboxNode()).not.toBeNull());

    // 方向键路径聚焦（标题格 → → 勾选格），不写库
    const titleCell = document.querySelector('.sc-dbcell--title') as HTMLElement;
    fireEvent.mouseDown(titleCell);
    titleCell.focus();
    expect(activeCellType()).toBeNull();
    fireEvent.keyDown(titleCell, { key: 'ArrowRight' });
    await waitFor(() => expect(activeCellType()).toBe('checkbox'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(checkValue()).toBe(true));
    await waitForCheckboxOn(true);
    expect(activeCellType()).toBe('checkbox');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: ' ' });
    await waitFor(() => expect(checkValue()).toBeNull());
    await waitForCheckboxOn(false);
    expect(activeCellType()).toBe('checkbox');
  });

  it('整树重挂（真机 reload 骨架语义）后按记录 id 恢复焦点，Enter 可继续切换', async () => {
    installBridge();
    render(<DbPage pageId={PAGE_ID} />);
    await screen.findByText('焦点验收库');
    await waitFor(() => expect(checkboxNode()).not.toBeNull());

    const titleCell = document.querySelector('.sc-dbcell--title') as HTMLElement;
    fireEvent.mouseDown(titleCell);
    titleCell.focus();
    fireEvent.keyDown(titleCell, { key: 'ArrowRight' });
    await waitFor(() => expect(activeCellType()).toBe('checkbox'));

    // 模拟宿主 reload 的整树卸载/重挂（真机上由 status='loading' 骨架触发）
    cleanup();
    render(<DbPage pageId={PAGE_ID} />);
    await screen.findByText('焦点验收库');
    await waitFor(() => expect(checkboxNode()).not.toBeNull());

    await waitFor(() => expect(activeCellType()).toBe('checkbox'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(checkValue()).toBe(true));
  });
});
