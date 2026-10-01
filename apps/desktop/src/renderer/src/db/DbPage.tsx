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
import { EMPTY_DISPLAY, formatValue, recordTitle } from '@septcats/dbview';
import type { CollectionEntity, FieldType, RecordEntity } from '@septcats/dbview';
import { Button, Dialog, EmptyState, ErrorPanel, Skeleton } from '@septcats/ui';
import { t } from '../i18n';
import { pushToast } from '../state/pages';
import type { SeptcatsApi, SeptcatsAiApi } from '../../../types/window';
import { useDbPage } from './useDbPage';
import './DbPage.css';

/**
 * 本页只画表格 → 视图条白名单固定为 `table`（T99-01）。
 * 看板视图由多维表格一级页渲染；若不挡，用户在这里切到看板会看到一张「表格形态的看板」。
 * 模块级常量：引用稳定，避免 DbView 内部的收敛 effect 每次渲染都跑。
 */
const TABLE_VIEW_TYPES = ['table'] as const;

export interface DbPageProps {
  pageId: string;
}

function dbAiApi(): SeptcatsAiApi {
  const api = (window as unknown as { septcats?: SeptcatsApi | undefined }).septcats?.ai;
  if (api === undefined) {
    throw new Error('preload did not inject window.septcats.ai (renderer cannot call the model)');
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
    lines.push(`${property.name}: ${text}`);
  }
  return lines.join('\n');
}

export function DbPage({ pageId }: DbPageProps) {
  const db = useDbPage(pageId);
  const { status, collection, records, error } = db;
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState<{ pid: string; recordIds: string[] } | null>(null);
  // 字段管理二次确认（TASK-T40-01 §B2）：删除（含该列值清理）/ 改类型（值迁移说明）
  const [removeConfirm, setRemoveConfirm] = useState<{ pid: string } | null>(null);
  const [typeConfirm, setTypeConfirm] = useState<{ pid: string; to: FieldType } | null>(null);

  const titlePid = collection?.schema.title_pid ?? '';

  /** relation picker 候选：一期数据模型没有 target 字段（向后兼容，不扩 schema），
   * 候选 = 本库全部存活记录（自关联口径，DEVIATION-5）；点击关系标签跳转留后续。 */
  const relationCandidates = useCallback((): Array<{ id: string; title: string }> => {
    if (collection === null) {
      return [];
    }
    return records.map((record) => ({ id: record.id, title: recordTitle(collection.schema, record.values, record.id) }));
  }, [collection, records]);

  /** 单元格内新建选项：生成 id → 全量 options 落库 → 立即回填选中（TASK-T40-01 §B3）。 */
  const handleCreateCellOption = useCallback(
    (pid: string, name: string): string | undefined => {
      if (collection === null) {
        return undefined;
      }
      const property = collection.schema.properties[pid];
      if (property === undefined || (property.type !== 'select' && property.type !== 'multi_select')) {
        return undefined;
      }
      const existing = property.options?.find((option) => option.name === name);
      if (existing !== undefined) {
        return existing.id;
      }
      const id = `opt-${crypto.randomUUID()}`;
      void db.updatePropertyOptions(pid, [...(property.options ?? []), { id, name }]);
      return id;
    },
    [collection, db],
  );

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
      // T26-01 §0.B：默认记录标题走 t()（调用点现取，locale 切换即时生效）
      void db.createRecord(titlePid.length > 0 ? { [titlePid]: t('common.untitled') } : undefined);
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
        viewTypes={TABLE_VIEW_TYPES}
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
          // 二次确认（§B2）：删除后该列值一并清理、不复活
          setRemoveConfirm({ pid });
        }}
        onRenameProperty={(pid, name) => {
          void db.renameProperty(pid, name);
        }}
        onChangePropertyType={(pid, to) => {
          // 改类型确认（§B2）：明示迁移策略后再提交
          setTypeConfirm({ pid, to });
        }}
        onUpdatePropertyOptions={(pid, options) => {
          void db.updatePropertyOptions(pid, options);
        }}
        onMoveProperty={(pid, beforePid) => {
          void db.moveProperty(pid, beforePid);
        }}
        onCreateCellOption={handleCreateCellOption}
        relationCandidates={relationCandidates()}
        onSaveView={(view) => {
          void db.saveView(view);
        }}
        onMoveView={(fromVid, toVid) => {
          void db.reorderViews(fromVid, toVid);
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

      <Dialog
        open={removeConfirm !== null}
        onClose={() => {
          setRemoveConfirm(null);
        }}
        title={t('db.prop.deleteTitle')}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRemoveConfirm(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const pid = removeConfirm?.pid;
                setRemoveConfirm(null);
                if (pid !== undefined) {
                  void db.removeProperty(pid);
                }
              }}
            >
              {t('db.prop.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p className="dbpage__ai-dialog-body">
          {t('db.prop.deleteBody').replace(
            '{name}',
            collection?.schema.properties[removeConfirm?.pid ?? '']?.name ?? '',
          )}
        </p>
      </Dialog>

      <Dialog
        open={typeConfirm !== null}
        onClose={() => {
          setTypeConfirm(null);
        }}
        title={t('db.prop.typeTitle')}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTypeConfirm(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const pending = typeConfirm;
                setTypeConfirm(null);
                if (pending !== null) {
                  void db.updatePropertyType(pending.pid, pending.to);
                }
              }}
            >
              {t('db.prop.typeConfirm')}
            </Button>
          </>
        }
      >
        <p className="dbpage__ai-dialog-body">
          {t('db.prop.typeBody')
            .replace('{name}', collection?.schema.properties[typeConfirm?.pid ?? '']?.name ?? '')
            .replace('{from}', collection?.schema.properties[typeConfirm?.pid ?? '']?.type ?? '')
            .replace('{to}', typeConfirm?.to ?? '')}
        </p>
      </Dialog>
    </div>
  );
}
