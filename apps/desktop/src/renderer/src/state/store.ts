/**
 * store.ts —— 极简外部 store（Zustand 同形 API，零依赖）。
 *
 * 为什么不用 zustand：本任务的依赖白名单里没有它，而纪律禁止终端命令（无法装包并更新
 * lockfile）。这里用 React 18 内建的 `useSyncExternalStore` 实现同一套语义
 * （`getState`/`setState`/`subscribe` + 选择器订阅），组件侧代码与 zustand 写法一致，
 * 若 PM 后续批准引入 zustand，只需把 `createStore` 换成 `zustand.create`。
 *
 * 选择器约束：返回值必须**引用稳定**（state 切片或原始值）。返回新对象/新数组会导致
 * React 反复比对失败；派生数据请在组件里用 `useMemo` 从切片算。
 */
import { useCallback, useSyncExternalStore } from 'react';

export type Listener = () => void;

export interface Store<S> {
  getState(): S;
  /** 传入 updater；返回同一引用（`Object.is`）视为无变化，不通知订阅者。 */
  setState(update: (state: S) => S): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: (): S => state,
    setState: (update): void => {
      const next = update(state);
      if (Object.is(next, state)) {
        return;
      }
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 选择器订阅（选择器建议在模块级定义为常量，或用引用稳定的切片）。 */
export function useStore<S, T>(store: Store<S>, selector: (state: S) => T): T {
  const getSnapshot = useCallback((): T => selector(store.getState()), [store, selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
