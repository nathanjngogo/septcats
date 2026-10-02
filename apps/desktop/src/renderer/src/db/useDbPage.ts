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
    throw new Error('preload did not inject window.septcats.db (renderer cannot access the data layer)');
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
  /** 改字段类型（main 侧做值迁移；TASK-T40-01 §B2）。 */
  updatePropertyType(pid: string, type: FieldType): Promise<void>;
  /** select / multi_select 选项全量替换（缺 id 项由 main 生成）。 */
  updatePropertyOptions(
    pid: string,
    options: Array<{ id?: string; name: string; tone?: 'neutral' | 'amber' | 'red' | undefined }>,
  ): Promise<void>;
  /** 字段左右排序（`beforePid=null` = 移到末尾）。 */
  moveProperty(pid: string, beforePid: string | null): Promise<void>;
  /** AI 列生成指令提交（空串 = 清除配置回落默认指令；TASK-T18-04 §2.2）。 */
  updatePropertyPrompt(pid: string, prompt: string): Promise<void>;
  saveView(view: DbView): Promise<void>;
  /** IDEA-E 视图排序：把 fromVid 移到 toVid 位（main 侧零写语义，见 db:view:reorder）。 */
  reorderViews(fromVid: string, toVid: string): Promise<void>;
  /** T103 删除视图（vid）：软刷新换 collection，未知 vid 幂等；最后一个视图 main 侧 E_INVARIANT 拒绝。 */
  removeView(vid: string): Promise<void>;
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

  const updatePropertyType = useCallback(
    async (pid: string, type: FieldType): Promise<void> => {
      await dbApi().propUpdate({ pageId, pid, patch: { type } });
      reload();
    },
    [pageId, reload],
  );

  const updatePropertyOptions = useCallback(
    async (
      pid: string,
      options: Array<{ id?: string; name: string; tone?: 'neutral' | 'amber' | 'red' | undefined }>,
    ): Promise<void> => {
      await dbApi().propUpdate({ pageId, pid, patch: { options } });
      reload();
    },
    [pageId, reload],
  );

  const moveProperty = useCallback(
    async (pid: string, beforePid: string | null): Promise<void> => {
      await dbApi().propMove({ pageId, pid, beforePid });
      reload();
    },
    [pageId, reload],
  );

  const updatePropertyPrompt = useCallback(
    async (pid: string, prompt: string): Promise<void> => {
      // PM 收口：window.d.ts 的 propUpdate.patch 已声明 ai 键，原最小断言已移除。
      await dbApi().propUpdate({ pageId, pid, patch: { ai: { prompt } } });
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

  const reorderViews = useCallback(
    async (fromVid: string, toVid: string): Promise<void> => {
      const { collection } = await dbApi().viewReorder({ pageId, fromVid, toVid });
      // 软刷新（IDEA-E R4 修复）：改序只动 collection.views，records 不变。
      // 走 reload() 会把 status 打回 'loading' → DbPage 整体换 Skeleton → PropBar/Menu
      // 重挂 → 菜单被物理关闭，违反「点动作钮不关菜单」契约（64882e7）。
      // 因此直接以 IPC 回包替换 collection，保留 status/records/error。
      setSnapshot((current) => ({ ...current, collection }));
    },
    [pageId],
  );

  const removeView = useCallback(
    async (vid: string): Promise<void> => {
      const { collection: next } = await dbApi().viewRemove({ pageId, vid });
      // 软刷新（IDEA-E R4 同款）：删视图只动 collection.views，records 不变 →
      // 直接替换 collection，不走 reload()（避免 status 回 loading 把菜单/编辑态冲掉）。
      setSnapshot((current) => ({ ...current, collection: next }));
    },
    [pageId],
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
    updatePropertyType,
    updatePropertyOptions,
    moveProperty,
    updatePropertyPrompt,
    saveView,
    reorderViews,
    removeView,
    renameCollection,
    exportCsv,
  };
}
