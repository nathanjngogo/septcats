/**
 * ImportWizard.tsx —— 三步导入向导（TASK-T11-01C §0.8，视觉基准 = mockup 09）。
 *
 * 选择（pick）→ 预览（preview）→ 执行（execute）→ 结果（result）：
 * - 预览页 = counts 摘要 + warnings 折叠列表（<details>，展开即全量，绝不藏）
 *   + items 树前 50 条（超出部分计数提示）；
 * - warnings 非空时确认按钮文案 = 「继续导入（N 项降级）」（confirmLabel）；
 * - 执行页 = ProgressBar done/total（轮询 import:progress）+ 取消（batch 边界生效）；
 * - 结果页 = report 全文 + 「打开首页」；
 * - E_TOO_LARGE 在预览前抛出 → 错误态「共 N 个条目超过 5000 上限，请分批导入」，不白屏；
 * - 四态（空/加载/错误/成功）经 data-state 驱动，双主题只吃 var(--sc-*)；
 * - 图标只从 @septcats/ui Icon 出口。
 *
 * 纯逻辑（wizardNext / confirmLabel / tooLargeCount）单独导出供测试
 * （test/import-entry.test.ts 的 ImportWizard 段）。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Check,
  CheckCircle,
  Copy,
  FileText,
  Icon,
  Note,
  ProgressBar,
  Spinner,
  WarningCircle,
  WarningOctagon,
} from '@septcats/ui';
import type { IconGlyph } from '@septcats/ui';
import type { ImportPlanPreview, ImportReport, ImportWarning } from '../../../shared/importer';
import { t } from '../i18n';
import './ImportWizard.css';

// ---------------------------------------------------------------------------
// 纯逻辑（测试锁定）
// ---------------------------------------------------------------------------

export type WizardStep = 'pick' | 'preview' | 'execute' | 'result';

export type WizardEvent =
  | { type: 'picked' }
  | { type: 'back' }
  | { type: 'confirmed' }
  | { type: 'finished' }
  | { type: 'restart' };

/** 步骤状态机：pick → preview → execute → result（back/restart 回退）。 */
export function wizardNext(step: WizardStep, event: WizardEvent): WizardStep {
  switch (step) {
    case 'pick':
      return event.type === 'picked' ? 'preview' : step;
    case 'preview':
      if (event.type === 'confirmed') {
        return 'execute';
      }
      return event.type === 'back' ? 'pick' : step;
    case 'execute':
      return event.type === 'finished' ? 'result' : step;
    case 'result':
      return event.type === 'restart' ? 'pick' : step;
  }
}

/** 确认按钮文案：warnings 非空（degraded/skipped）→「继续导入（N 项降级）」，否则「开始导入」（T25-01 起文案走 i18n）。 */
export function confirmLabel(warnings: ReadonlyArray<Pick<ImportWarning, 'action'>>): string {
  const degraded = warnings.filter((warning) => warning.action === 'degraded').length;
  return degraded > 0
    ? t('importWizard.continueWithWarnings').replace('{n}', String(degraded))
    : t('importWizard.startImport');
}

/** E_TOO_LARGE 的 IPC 错误消息 → 条目数（提取不到回 null，调用方用通用文案）。 */
export function tooLargeCount(message: string): number | null {
  const match = /单计划 (\d+) 个条目/.exec(message);
  return match === null ? null : Number(match[1]);
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const OP_ICON: Record<'page' | 'collection' | 'asset', IconGlyph> = {
  page: FileText,
  collection: Note,
  asset: Copy,
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ImportWizardProps {
  /** 结果页「打开首页」：回到编辑器视图。 */
  onOpenHome: () => void;
}

export function ImportWizard({ onOpenHome }: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPlanPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const planIdRef = useRef<string | null>(null);

  const state: 'empty' | 'loading' | 'error' | 'success' =
    error !== null ? 'error' : busy ? 'loading' : step === 'result' ? 'success' : 'empty';

  // 执行页轮询 import:progress（400ms；页面卸载/离开执行页即停）
  useEffect(() => {
    if (step !== 'execute') {
      return;
    }
    const timer = window.setInterval(() => {
      const planId = planIdRef.current;
      if (planId === null) {
        return;
      }
      void window.septcats.import
        .progress({ planId })
        .then((snapshot) => {
          if (snapshot !== null) {
            setProgress({ done: snapshot.done, total: snapshot.total });
          }
        })
        .catch(() => {
          // 轮询失败不打断执行（execute promise 本身负责最终报告）
        });
    }, 400);
    return () => {
      window.clearInterval(timer);
    };
  }, [step]);

  const handlePick = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const picked = await window.septcats.import.pick();
      if (picked === null) {
        return; // 用户取消选择
      }
      const nextPreview = await window.septcats.import.plan(picked);
      planIdRef.current = nextPreview.planId;
      setPreview(nextPreview);
      setReport(null);
      setStep(wizardNext('pick', { type: 'picked' }));
    } catch (cause) {
      const message = describeError(cause);
      const count = tooLargeCount(message);
      setError(
        count === null
          ? t('importWizard.errorPlanFmt').replace('{msg}', message)
          : tooLargeText(count),
      );
    } finally {
      setBusy(false);
    }
  };

  const tooLargeText = (count: number): string =>
    t('importWizard.errorTooLargeFmt').replace('{n}', String(count));

  const handleConfirm = async (): Promise<void> => {
    if (preview === null) {
      return;
    }
    setError(null);
    setBusy(true);
    setProgress({ done: 0, total: preview.totalItems });
    setStep(wizardNext('preview', { type: 'confirmed' }));
    try {
      const nextReport = await window.septcats.import.execute({
        planId: preview.planId,
        confirm: true,
      });
      setReport(nextReport);
      setStep(wizardNext('execute', { type: 'finished' }));
    } catch (cause) {
      setError(describeError(cause));
      setStep('preview');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    const planId = planIdRef.current;
    if (planId !== null) {
      await window.septcats.import.cancel({ planId }).catch(() => undefined);
    }
  };

  const handleRestart = (): void => {
    setError(null);
    setPreview(null);
    setReport(null);
    planIdRef.current = null;
    setStep(wizardNext('result', { type: 'restart' }));
  };

  const stepIndex = step === 'pick' ? 0 : step === 'preview' ? 1 : 2;
  const stepper = [t('importWizard.stepPick'), t('importWizard.stepPreview'), t('importWizard.stepExecute')];

  return (
    <div className="wiz" data-state={state} data-step={step}>
      <div className="wiz-stepper" aria-label={t('importWizard.title')}>
        {stepper.map((label, index) => (
          <div
            key={label}
            className={
              index < stepIndex || step === 'result'
                ? 'wiz-sp wiz-sp--done'
                : index === stepIndex
                  ? 'wiz-sp wiz-sp--on'
                  : 'wiz-sp'
            }
          >
            <span className="wiz-sp-no">
              {index < stepIndex || step === 'result' ? <Icon icon={Check} size="sm" /> : index + 1}
            </span>
            {label}
          </div>
        ))}
      </div>

      {error !== null ? (
        <div className="wiz-error" role="alert">
          <Icon icon={WarningOctagon} size="md" />
          <span>{error}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
            }}
          >
            {t('settings.diagnostic.cancel')}
          </Button>
        </div>
      ) : null}

      {busy ? (
        <div className="wiz-loading" aria-live="polite">
          <Spinner />
        </div>
      ) : null}

      {step === 'pick' ? (
        <section className="wiz-body">
          <h2 className="wiz-title">{t('importWizard.pickTitle')}</h2>
          <p className="wiz-sub">{t('importWizard.pickDesc')}</p>
          <button
            type="button"
            className="wiz-drop"
            onClick={() => {
              void handlePick();
            }}
            disabled={busy}
          >
            <Icon icon={Copy} size="lg" className="wiz-drop-ic" />
            <span>{t('importWizard.pickButton')}</span>
            <span className="wiz-drop-hint">{t('importWizard.pickHint')}</span>
          </button>
        </section>
      ) : null}

      {step === 'preview' && preview !== null ? (
        <section className="wiz-body">
          <h2 className="wiz-title">{t('importWizard.previewTitle')}</h2>
          <p className="wiz-sub">{t('importWizard.previewDesc')}</p>

          <div className="wiz-rpt">
            <Icon icon={FileText} size="md" />
            <div className="wiz-rpt-meta">
              <b>{preview.source.rootName}</b>
              <span>
                {preview.source.kind} · {String(preview.totalItems)} {t('importWizard.itemsUnit')}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep(wizardNext('preview', { type: 'back' }));
              }}
            >
              {t('importWizard.back')}
            </Button>
          </div>

          <div className="wiz-counts">
            <span>
              {t('importWizard.countsPages')} {String(preview.counts.pages)}
            </span>
            <span>
              {t('importWizard.countsCollections')} {String(preview.counts.collections)}
            </span>
            <span>
              {t('importWizard.countsRecords')} {String(preview.counts.records)}
            </span>
            <span>
              {t('importWizard.countsAssets')} {String(preview.counts.assets)}
            </span>
            <span>
              {t('importWizard.countsSkipped')} {String(preview.counts.skippedDuplicate)}
            </span>
          </div>

          <div className="wiz-tree" role="list">
            {preview.items.map((item) => {
              const rowKey = item.op === 'asset' ? `asset:${item.hash}` : `${item.op}:${item.path}`;
              const rowLabel = item.op === 'asset' ? `${item.hash.slice(0, 12)}${item.ext}` : item.path;
              const rowMeta =
                item.op === 'page'
                  ? `${t('importWizard.treePage')} ${String(item.blockCount)}`
                  : item.op === 'collection'
                    ? `${t('importWizard.treeCollection')} ${String(item.recordCount)}`
                    : t('importWizard.treeAsset');
              return (
                <div
                  key={rowKey}
                  className="wiz-trow"
                  role="listitem"
                  style={{
                    paddingLeft: `calc(var(--sc-space-sm) + var(--sc-space-md) * ${String(rowLabel.split('/').length - 1)})`,
                  }}
                >
                  <Icon icon={OP_ICON[item.op]} size="sm" />
                  <span className="wiz-trow-n">{rowLabel}</span>
                  <span className="wiz-trow-c">{rowMeta}</span>
                </div>
              );
            })}
            {preview.totalItems > preview.items.length ? (
              <div className="wiz-trow wiz-trow--more">
                {`…${String(preview.totalItems - preview.items.length)} ${t('importWizard.itemsMore')}`}
              </div>
            ) : null}
          </div>

          {preview.warnings.length > 0 ? (
            <details className="wiz-warnlist">
              <summary>
                <Icon icon={WarningCircle} size="sm" />
                {`${String(preview.warnings.length)} ${t('importWizard.warningsTitle')}`}
              </summary>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={`${String(index)}:${warning.path}`}>
                    <b>{warning.what}</b>
                    <span className="wiz-warn-path">{warning.path}</span>
                    <span>{warning.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="wiz-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(wizardNext('preview', { type: 'back' }));
              }}
            >
              {t('importWizard.back')}
            </Button>
            <Button onClick={() => void handleConfirm()}>{confirmLabel(preview.warnings)}</Button>
            <span className="wiz-actions-hint">{t('importWizard.pickHint')}</span>
          </div>
        </section>
      ) : null}

      {step === 'execute' ? (
        <section className="wiz-body">
          <h2 className="wiz-title">{t('importWizard.executeTitle')}</h2>
          <ProgressBar
            value={progress.total === 0 ? 0 : (progress.done / progress.total) * 100}
            label={t('importWizard.executeTitle')}
            className="wiz-progress"
          />
          <p className="wiz-sub">
            {`${String(progress.done)} / ${String(progress.total)} ${t('importWizard.executeOf')}`}
          </p>
          <div className="wiz-actions">
            <Button variant="secondary" onClick={() => void handleCancel()}>
              {t('importWizard.cancel')}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'result' && report !== null ? (
        <section className="wiz-body">
          <h2 className="wiz-title">
            {report.status === 'done' ? (
              <>
                <Icon icon={CheckCircle} size="md" /> {t('importWizard.resultTitle')}
              </>
            ) : report.status === 'failed' ? (
              <>
                <Icon icon={WarningOctagon} size="md" /> {t('importWizard.resultFailed')}
              </>
            ) : (
              <>
                <Icon icon={WarningCircle} size="md" /> {t('importWizard.resultCancelled')}
              </>
            )}
          </h2>
          <p className="wiz-sub">{`${String(report.done)} / ${String(report.total)} ${t('importWizard.executeOf')}`}</p>
          <pre className="wiz-report" aria-label={t('importWizard.reportTitle')}>
            {JSON.stringify(report, null, 2)}
          </pre>
          <div className="wiz-actions">
            <Button variant="secondary" onClick={handleRestart}>
              {t('importWizard.again')}
            </Button>
            <Button onClick={onOpenHome}>{t('importWizard.openHome')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
