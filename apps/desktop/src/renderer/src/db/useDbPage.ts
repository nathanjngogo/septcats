/**
 * useDbPage.ts —— 行内数据库页的数据状态机（TASK-T7b-01 §4）。
 *
 * 四态：loading / ready / empty / error（+ retry）。挂载时 `db:load` 拉 collection + records，
 * 写操作后按需 `reload`（一期以 IPC 回包为准，不做乐观）。
 *
 * 纪律：本 hook **不 import @septcats/dbview/react**（那是 DbPage 的事），只依赖
 * `@septcats/dbview` 的纯类型与 `window.septcats.db` 桥；错误原样上抛给组件渲染。
 */
import { useCallback, useEffect, useState } from 'react';
import type { CollectionEntity, DbView, FieldType, RecordEntity } from '@septcats/dbview';
import type { SeptcatsApi, SeptcatsDbApi } from '../../../types/window';

export type DbPageStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface DbPageSnapshot {
  status: DbPageStatus;
  collection: CollectionEntity | null;
  records: RecordEntity[];
  error: string | null;
}

const INITIAL_SNAPSHOT: DbPageSnapshot = {
  status: 'loading',
  collection: null,
  records: [],
  error: null,
};

function dbApi(): SeptcatsDbApi {
  const api = (window as unknown as { septcats?: SeptcatsApi | undefined }).septcats?.db;
  if (api === undefined) {
    throw new Error('preload 未注入 window.septcats.db（渲染器无法访问数据层）');
  }
  return api;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseDbPage {
  status: DbPageStatus;
  collection: CollectionEntity | null;
  records: RecordEntity[];
  error: string | null;
  /** 重试 / 重新拉取（写操作后或 error 态点重试）。 */
  reload(): void;
  createRecord(values?: Record<string, unknown> | undefined): Promise<void>;
  updateRecord(recordId: string, patch: Record<string, unknown>): Promise<void>;
  deleteRecords(ids: readonly string[]): Promise<void>;
  addProperty(type: FieldType): Promise<void>;
  removeProperty(pid: string): Promise<void>;
  renameProperty(pid: string, name: string): Promise<void>;
  saveView(view: DbView): Promise<void>;
  renameCollection(title: string): Promise<void>;
  /** 返回 CSV 文本（由调用方决定下载/复制）。 */
  exportCsv(): Promise<string>;
}

export function useDbPage(pageId: string): UseDbPage {
  const [snapshot, setSnapshot] = useState<DbPageSnapshot>(INITIAL_SNAPSHOT);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSnapshot((current) => ({ ...current, status: 'loading', error: null }));
    dbApi()
      .load({ pageId })
      .then(({ collection, records }) => {
        if (cancelled) {
          return;
        }
        setSnapshot({
          status: records.length === 0 ? 'empty' : 'ready',
          collection,
          records,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setSnapshot({ status: 'error', collection: null, records: [], error: messageOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, nonce]);

  const reload = useCallback((): void => {
    setNonce((current) => current + 1);
  }, []);

  const createRecord = useCallback(
    async (values?: Record<string, unknown> | undefined): Promise<void> => {
      await dbApi().recordCreate({ pageId, values });
      reload();
    },
    [pageId, reload],
  );

  const updateRecord = useCallback(
    async (recordId: string, patch: Record<string, unknown>): Promise<void> => {
      await dbApi().recordUpdate({ pageId, recordId, patch });
      reload();
    },
    [pageId, reload],
  );

  const deleteRecords = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      await dbApi().recordDelete({ pageId, ids: [...ids] });
      reload();
    },
    [pageId, reload],
  );

  const addProperty = useCallback(
    async (type: FieldType): Promise<void> => {
      await dbApi().propAdd({ pageId, type });
      reload();
    },
    [pageId, reload],
  );

  const removeProperty = useCallback(
    async (pid: string): Promise<void> => {
      await dbApi().propRemove({ pageId, pid });
      reload();
    },
    [pageId, reload],
  );

  const renameProperty = useCallback(
    async (pid: string, name: string): Promise<void> => {
      await dbApi().propUpdate({ pageId, pid, patch: { name } });
      reload();
    },
    [pageId, reload],
  );

  const saveView = useCallback(
    async (view: DbView): Promise<void> => {
      await dbApi().viewSave({ pageId, view });
      reload();
    },
    [pageId, reload],
  );

  const renameCollection = useCallback(
    async (title: string): Promise<void> => {
      await dbApi().rename({ pageId, title });
      reload();
    },
    [pageId, reload],
  );

  const exportCsv = useCallback(async (): Promise<string> => {
    const { csv } = await dbApi().exportCsv({ pageId });
    return csv;
  }, [pageId]);

  return {
    status: snapshot.status,
    collection: snapshot.collection,
    records: snapshot.records,
    error: snapshot.error,
    reload,
    createRecord,
    updateRecord,
    deleteRecords,
    addProperty,
    removeProperty,
    renameProperty,
    saveView,
    renameCollection,
    exportCsv,
  };
}
