/**
 * AiActionPanel.tsx —— 编辑器块级 AI 动作的结果面板（TASK-T18-03 §2.2）。
 *
 * 纯受控组件：不拉 IPC、不管编辑器——open/phase/result/error 全由 PageView 给。
 * 四态 = 空态（未启用/未配置 provider → 引导 + 打开设置）/ busy / ok（结果 + 应用）/
 * error（E_AI_* 原文 + 重试）。结果区可手动全选复制（显式 user-select:text，
 * 不被 user-select:none 族继承破坏）。样式只用 var(--sc-*)（no-magic 门禁）。
 */
import { Button, Dialog } from '@septcats/ui';
import type { AiBlockAction } from '../../../shared/aiPrompts';
import { t } from '../i18n';
import './AiActionPanel.css';

export interface AiActionPanelProps {
  open: boolean;
  action: AiBlockAction | null;
  phase: 'idle' | 'busy' | 'ok' | 'error';
  /** phase==='ok' 的结果全文。 */
  result: string;
  /** phase==='error' 的 E_AI_* 原文照展。 */
  error: string;
  /** 空态引导文案（未启用/无 provider/空块等）。非 null 即空态。 */
  emptyReason: string | null;
  /** false = 无可替换目标（应用键禁用）。 */
  canApply: boolean;
  onApply: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function AiActionPanel({
  open,
  action,
  phase,
  result,
  error,
  emptyReason,
  canApply,
  onApply,
  onRetry,
  onOpenSettings,
  onClose,
}: AiActionPanelProps) {
  const empty = emptyReason !== null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={action === null ? t('ai.panelTitle') : t(`commands.ai.${action}`)}
      className="ai-panel"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('ai.cancel')}
          </Button>
          {phase === 'error' ? (
            <Button variant="secondary" onClick={onRetry}>
              {t('ai.retry')}
            </Button>
          ) : null}
          {phase === 'ok' || phase === 'busy' ? (
            <Button
              variant="primary"
              loading={phase === 'busy'}
              disabled={phase !== 'ok' || !canApply}
              onClick={onApply}
            >
              {t('ai.apply')}
            </Button>
          ) : null}
          {empty ? (
            <Button variant="primary" onClick={onOpenSettings}>
              {t('ai.openSettings')}
            </Button>
          ) : null}
        </>
      }
    >
      {empty ? (
        <p className="ai-panel__empty">{emptyReason}</p>
      ) : phase === 'busy' ? (
        <p className="ai-panel__busy">{t('ai.busy')}</p>
      ) : phase === 'error' ? (
        <div className="ai-panel__error" role="alert">
          {error}
        </div>
      ) : (
        <pre className="ai-panel__result">{result}</pre>
      )}
    </Dialog>
  );
}
