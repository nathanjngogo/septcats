/**
 * DbPage.tsx —— 行内数据库页（TASK-T7b-01 §4）。
 *
 * 组装：`useDbPage(pageId)` 取数（四态）→ 四态外壳（Skeleton / EmptyState / ErrorPanel）
 * → `@septcats/dbview/react` 的 `DbView`，props 全接上（改值→record:update、加属性→prop:add…）。
 *
 * 纪律：本组件只 import react + `@septcats/ui` 外壳 + `@septcats/dbview/react`，
 * 不碰 IPC（数据经 useDbPage 桥）；自定义 CSS 一律 `var(--sc-*)`。
 */
import { useCallback } from 'react';
import { DbView, type CreateRecordField } from '@septcats/dbview/react';
import { EmptyState, ErrorPanel, Skeleton } from '@septcats/ui';
import { useDbPage } from './useDbPage';
import './DbPage.css';

const DEFAULT_RECORD_TITLE = '未命名';

export interface DbPageProps {
  pageId: string;
}

export function DbPage({ pageId }: DbPageProps) {
  const db = useDbPage(pageId);
  const { status, collection, records, error } = db;

  const titlePid = collection?.schema.title_pid ?? '';

  const handleCreateRecord = useCallback(
    (initial?: CreateRecordField | undefined): void => {
      if (initial !== undefined && initial.pid !== undefined && initial.pid.length > 0) {
        void db.createRecord({ [initial.pid]: initial.value });
        return;
      }
      void db.createRecord(titlePid.length > 0 ? { [titlePid]: DEFAULT_RECORD_TITLE } : undefined);
    },
    [db, titlePid],
  );

  const handleRenameRecord = useCallback(
    (recordId: string, title: string): void => {
      if (titlePid.length > 0) {
        void db.updateRecord(recordId, { [titlePid]: title });
      }
    },
    [db, titlePid],
  );

  const handleExportCsv = useCallback((): void => {
    void db.exportCsv().then((csv) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${collection?.name.length ? collection.name : 'database'}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }, [db, collection]);

  if (status === 'loading') {
    return (
      <div className="dbpage" aria-busy="true">
        <div className="dbpage__loading-head">
          <Skeleton lines={1} width="40%" />
        </div>
        <Skeleton lines={8} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="dbpage">
        <ErrorPanel description={error ?? '数据库加载失败'} onRetry={db.reload} />
      </div>
    );
  }

  if (collection === null) {
    // ready/empty 必有 collection；此分支为兜底（理论不可达）
    return (
      <div className="dbpage">
        <ErrorPanel description="数据库加载失败" onRetry={db.reload} />
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="dbpage">
        <EmptyState
          title="还没有记录"
          description="新建第一条记录开始填写这个数据库。"
          actionLabel="新建记录"
          onAction={() => {
            handleCreateRecord();
          }}
        />
      </div>
    );
  }

  return (
    <div className="dbpage">
      <DbView
        collection={collection}
        records={records}
        status="ready"
        onRetry={db.reload}
        onCreateRecord={handleCreateRecord}
        onDeleteRecords={(ids) => {
          void db.deleteRecords(ids);
        }}
        onChangeValue={(recordId, pid, value) => {
          void db.updateRecord(recordId, { [pid]: value });
        }}
        onRenameRecord={handleRenameRecord}
        onAddProperty={(type) => {
          void db.addProperty(type);
        }}
        onRemoveProperty={(pid) => {
          void db.removeProperty(pid);
        }}
        onRenameProperty={(pid, name) => {
          void db.renameProperty(pid, name);
        }}
        onSaveView={(view) => {
          void db.saveView(view);
        }}
        onExportCsv={handleExportCsv}
      />
    </div>
  );
}
