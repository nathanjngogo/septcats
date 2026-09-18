/**
 * DbPage.tsx —— 行内数据库页（TASK-T7b-01 §4；AI 属性装配 TASK-T18-04 §0.3-§0.7）。
 *
 * 组装：`useDbPage(pageId)` 取数（四态）→ 四态外壳（Skeleton / EmptyState / ErrorPanel）
 * → `@septcats/dbview/react` 的 `DbView`，props 全接上（改值→record:update、加属性→prop:add…）。
 *
 * AI 属性列（受控回调，全部走既有通道，不新增 IPC）：
 * - 门控：`ai.state()` 三态（!enabled → needEnable / 无 provider 或云端未设密钥 → needProvider），
 *   门控不过则行内引导、不开工、不调 chat；
 * - 单行：`ai.chat`（system = 列生成指令（缺省回落默认指令），user = 该记录逐列「列名：值」，
 *   跳过空值 / AI 列自身 / 无候选的 relation）→ `db.recordUpdate` 写值（op 落库可撤销）；
 * - 批量：DbView 只给「当前视图前 ≤20 行」的 id → 确认弹窗（明示条数）→ 串行逐行、
 *   失败行跳过 → 结果计数 toast；
 * - 指令：`db.propUpdate({ ai:{prompt} })`（main 侧已放行，见 TASK-T18-04 报告 DEVIATION-1）。
 *
 * 纪律：本组件只 import react + `@septcats/ui` 外壳 + `@septcats/dbview(/react)`，
 * 不碰 IPC 细节（数据经 useDbPage 桥）；自定义 CSS 一律 `var(--sc-*)`。
 */
import { useCallback, useState } from 'react';
import { DbView, type CreateRecordField } from '@septcats/dbview/react';
import { EMPTY_DISPLAY, formatValue } from '@septcats/dbview';
import type { CollectionEntity, RecordEntity } from '@septcats/dbview';
import { Button, Dialog, EmptyState, ErrorPanel, Skeleton } from '@septcats/ui';
import { t } from '../i18n';
import { pushToast } from '../state/pages';
import type { SeptcatsApi, SeptcatsAiApi } from '../../../types/window';
import { useDbPage } from './useDbPage';
import './DbPage.css';

const DEFAULT_RECORD_TITLE = '未命名';
export interface DbPageProps {
  pageId: string;
}

function dbAiApi(): SeptcatsAiApi {
  const api = (window as unknown as { septcats?: SeptcatsApi | undefined }).septcats?.ai;
  if (api === undefined) {
    throw new Error('preload 未注入 window.septcats.ai（渲染器无法调用模型）');
  }
  return api;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 门控产物：给了 providerId = 可开工；给了 notice = 行内引导（不开工、不写值）。 */
type AiGate = { providerId: string } | { notice: string };

/** 该记录逐列「列名：值」上下文（跳过空值、AI 列自身、无候选标题的 relation）。 */
function buildUserContent(collection: CollectionEntity, record: RecordEntity, aiPid: string): string {
  const lines: string[] = [];
  for (const property of Object.values(collection.schema.properties)) {
    if (property.id === aiPid) {
      continue;
    }
    const raw = record.values[property.id];
    if (raw === undefined || raw === null) {
      continue;
    }
    const text = formatValue(property, raw, { relationTitle: () => null });
    if (text === EMPTY_DISPLAY || text.trim().length === 0) {
      continue;
    }
    lines.push(`${property.name}：${text}`);
  }
  return lines.join('\n');
}

export function DbPage({ pageId }: DbPageProps) {
  const db = useDbPage(pageId);
  const { status, collection, records, error } = db;
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState<{ pid: string; recordIds: string[] } | null>(null);

  const titlePid = collection?.schema.title_pid ?? '';

  const resolveProvider = useCallback(async (): Promise<AiGate> => {
    const st = await dbAiApi().state();
    if (!st.enabled) {
      return { notice: t('db.ai.needEnable') };
    }
    const providerId = st.activeProviderId ?? st.providers[0]?.id ?? null;
    const provider = providerId === null ? undefined : st.providers.find((entry) => entry.id === providerId);
    if (provider === undefined) {
      return { notice: t('db.ai.needProvider') };
    }
    // hasKey 语义：云端服务未设密钥 = 不可用（视同未配置）；本地服务免钥
    if (!provider.isLocal && !provider.hasKey) {
      return { notice: t('db.ai.needProvider') };
    }
    return { providerId: provider.id };
  }, []);

  /** 单行生成全流程（门控 → chat → recordUpdate）。返回是否写入；引导/失败抛错或 false。 */
  const generateForRecord = useCallback(
    async (pid: string, record: RecordEntity): Promise<boolean> => {
      if (collection === null) {
        return false;
      }
      const property = collection.schema.properties[pid];
      if (property === undefined || property.type !== 'ai') {
        return false;
      }
      const gate = await resolveProvider();
      if ('notice' in gate) {
        setAiNotice(gate.notice);
        return false;
      }
      const configured = property.ai?.prompt ?? '';
      const systemPrompt = configured.length > 0 ? configured : t('db.ai.defaultPrompt');
      const res = await dbAiApi().chat({
        providerId: gate.providerId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildUserContent(collection, record, pid) },
        ],
      });
      const text = res.text.trim();
      if (text.length === 0) {
        throw new Error(t('db.ai.failed').replace('{msg}', t('db.emptyResponse')));
      }
      await db.updateRecord(record.id, { [pid]: text });
      return true;
    },
    [collection, db, resolveProvider],
  );

  const handleAiGenerate = useCallback(
    (pid: string, recordId: string): Promise<void> => {
      const record = records.find((entry) => entry.id === recordId);
      if (record === undefined) {
        return Promise.resolve();
      }
      setAiNotice(null);
      return generateForRecord(pid, record)
        .then(() => undefined)
        .catch((err: unknown) => {
          setAiNotice(t('db.ai.failed').replace('{msg}', messageOf(err)));
        });
    },
    [generateForRecord, records],
  );

  const handleAiBatchGenerate = useCallback(
    async (pid: string, recordIds: readonly string[]): Promise<{ done: number; failed: number }> => {
      // 先门控后弹窗：未启用/无 provider 不开工（隐私/成本不变量）
      let gate: AiGate;
      try {
        gate = await resolveProvider();
      } catch (err: unknown) {
        gate = { notice: messageOf(err) };
      }
      if ('notice' in gate) {
        setAiNotice(gate.notice);
        return { done: 0, failed: 0 };
      }
      if (recordIds.length === 0) {
        return { done: 0, failed: 0 };
      }
      setAiNotice(null);
      setBatchConfirm({ pid, recordIds: [...recordIds] });
      return { done: 0, failed: 0 };
    },
    [resolveProvider],
  );

  /** 确认后的批量执行：串行逐行，失败行跳过并计数（不中断批次）。 */
  const runBatch = useCallback(async (): Promise<void> => {
    if (batchConfirm === null) {
      return;
    }
    const { pid, recordIds } = batchConfirm;
    setBatchConfirm(null);
    let done = 0;
    let failed = 0;
    for (const recordId of recordIds) {
      const record = records.find((entry) => entry.id === recordId);
      if (record === undefined) {
        failed += 1;
        continue;
      }
      try {
        const ok = await generateForRecord(pid, record);
        if (ok) {
          done += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    pushToast(
      t('db.ai.batchResult').replace('{done}', String(done)).replace('{failed}', String(failed)),
      failed === 0 ? 'success' : 'danger',
    );
  }, [batchConfirm, generateForRecord, records]);

  const handleUpdateAiPrompt = useCallback(
    (pid: string, prompt: string): void => {
      void db.updatePropertyPrompt(pid, prompt);
    },
    [db],
  );

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
        <ErrorPanel description={error ?? t('db.loadFailed')} onRetry={db.reload} />
      </div>
    );
  }

  if (collection === null) {
    // ready/empty 必有 collection；此分支为兜底（理论不可达）
    return (
      <div className="dbpage">
        <ErrorPanel description={t('db.loadFailed')} onRetry={db.reload} />
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="dbpage">
        <EmptyState
          title={t('db.empty.title')}
          description={t('db.empty.desc')}
          actionLabel={t('db.empty.action')}
          onAction={() => {
            handleCreateRecord();
          }}
        />
      </div>
    );
  }

  return (
    <div className="dbpage">
      {aiNotice !== null ? (
        <p className="dbpage__ai-notice" role="status">
          {aiNotice}
        </p>
      ) : null}
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
        onAiGenerate={handleAiGenerate}
        onAiBatchGenerate={handleAiBatchGenerate}
        onUpdateAiPrompt={handleUpdateAiPrompt}
      />
      <Dialog
        open={batchConfirm !== null}
        onClose={() => {
          setBatchConfirm(null);
        }}
        title={t('db.ai.batchConfirmTitle')}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setBatchConfirm(null);
              }}
            >
              {t('ai.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void runBatch();
              }}
            >
              {t('db.ai.batchConfirm')}
            </Button>
          </>
        }
      >
        <p className="dbpage__ai-dialog-body">
          {t('db.ai.batchConfirmBody').replace('{n}', String(batchConfirm?.recordIds.length ?? 0))}
        </p>
      </Dialog>
    </div>
  );
}
