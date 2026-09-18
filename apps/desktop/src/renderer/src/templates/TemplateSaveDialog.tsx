/**
 * TemplateSaveDialog.tsx —— 「另存为模板」命名弹窗（TASK-T23-02 §B）。
 *
 * 命令面板命令（page.saveAsTemplate）经 templatesActions.beginSaveFromPage 触发；
 * 弹窗在 App 级渲染——面板执行命令后自身关闭，弹窗独立存在。
 * 默认名 = 当前页标题；确认调 templatesActions.saveFromPage（只传 title，
 * icon 继承源页 §0.A）；成功后关弹窗（slice 内已刷新模板列表 + 轻提示）。
 */
import { useEffect, useState } from 'react';
import { Button, Dialog, Input } from '@septcats/ui';
import { t } from '../i18n';
import { nodeMap, pagesStore } from '../state/pages';
import { templatesActions, useTemplates } from '../state/templates';
import './templates.css';

export function TemplateSaveDialog() {
  const open = useTemplates((state) => state.saveDialogOpen);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  // 打开时以当前页标题为默认名（从 store 现取，避免 open 期间输入被覆盖）
  useEffect(() => {
    if (!open) {
      return;
    }
    const state = pagesStore.getState();
    const current = state.selectedId !== null ? nodeMap(state.nodes).get(state.selectedId) : undefined;
    setTitle(current?.title ?? '');
    setBusy(false);
  }, [open]);

  if (!open) {
    return null;
  }

  const trimmed = title.trim();

  const submit = async (): Promise<void> => {
    const pageId = pagesStore.getState().selectedId;
    if (pageId === null || trimmed.length === 0 || busy) {
      return;
    }
    setBusy(true);
    const ok = await templatesActions.saveFromPage(pageId, trimmed);
    setBusy(false);
    if (ok) {
      templatesActions.cancelSaveFromPage();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        templatesActions.cancelSaveFromPage();
      }}
      title={t('templates.saveAsTitle')}
      footer={
        <div className="tpl-dialog-actions">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => templatesActions.cancelSaveFromPage()}>
            {t('templates.cancel')}
          </Button>
          <Button
            size="sm"
            loading={busy}
            disabled={trimmed.length === 0}
            data-testid="template-save-confirm"
            onClick={() => {
              void submit();
            }}
          >
            {t('templates.saveAsConfirm')}
          </Button>
        </div>
      }
    >
      <Input
        label={t('templates.saveAsNameLabel')}
        value={title}
        disabled={busy}
        data-testid="template-save-name"
        onChange={(event) => setTitle(event.target.value)}
      />
    </Dialog>
  );
}
