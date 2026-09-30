/**
 * state.ts —— 多维表格一级页的「当前表」选择（TASK-T99-01）。
 *
 * 单真源：localStorage `septcats.bitable.table`（旁路存储，同 navState 口径；
 * 野值/写盘失败 → 回退 null，不阻断）。只存「当前打开哪张表」，其余视图态
 * 由 db 引擎的 collection.views 承载（不在这里重复存一份）。
 */
import { createStore, useStore } from '../state/store';

const STORAGE_KEY = 'septcats.bitable.table';

function readTableId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null || raw.length === 0 ? null : raw;
  } catch {
    return null;
  }
}

function writeTableId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 写盘失败（隐私模式/配额）→ 内存态照常 */
  }
}

export interface BitableState {
  /** 当前打开的表（= 承载 collection 的页面 id）；null = 未选择。 */
  tableId: string | null;
}

export const bitableStore = createStore<BitableState>({ tableId: readTableId() });

export function useBitable<T>(selector: (state: BitableState) => T): T {
  return useStore(bitableStore, selector);
}

export const bitableActions = {
  setTable(tableId: string | null): void {
    bitableStore.setState(() => ({ tableId }));
    writeTableId(tableId);
  },
};

/** 读当前表 id（非 React 上下文用）。 */
export function currentTableId(): string | null {
  return bitableStore.getState().tableId;
}