/**
 * NewWorkspaceDialog.tsx —— 新建库弹框（T70-01 ②）。
 *
 * 名字输入（autofocus）+ 类型三选卡横排（工作台库 / 知识库库 / 空白库）。
 * 确认 → pagesActions.createWorkspaceWithType（内部建库 + 切库 + 按类型做种）。
 * 名字空 = 确认禁用；重名允许（数据层无唯一约束，不拦截）。
 * 红线：不新造 IPC，只走既有 workspaces.create + pages.create 通道。
 */
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { BookOpen, Button, Dialog, Icon, Input, Layout, Plus } from '@septcats/ui';
import type { IconGlyph } from '@septcats/ui';
import { t } from '../i18n';
import { pagesActions, type WorkspaceType } from '../state/pages';
import './NewWorkspaceDialog.css';

export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<WorkspaceType>('workbench');
  const [busy, setBusy] = useState(false);

  // 每次打开重置（避免上次输入残留）
  useEffect(() => {
    if (open) {
      setName('');
      setType('workbench');
      setBusy(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  // 类型卡（render 内构造，确保 locale 切换时文案即时刷新）
  const types: Array<{ id: WorkspaceType; icon: IconGlyph; label: string; desc: string }> = [
    { id: 'workbench', icon: Layout, label: t('workspace.typeWorkbench'), desc: t('workspace.typeWorkbenchDesc') },
    { id: 'knowledge', icon: BookOpen, label: t('workspace.typeKnowledge'), desc: t('workspace.typeKnowledgeDesc') },
    { id: 'blank', icon: Plus, label: t('workspace.typeBlank'), desc: t('workspace.typeBlankDesc') },
  ];

  const trimmed = name.trim();

  const submit = async (): Promise<void> => {
    if (trimmed.length === 0 || busy) {
      return;
    }
    setBusy(true);
    await pagesActions.createWorkspaceWithType(trimmed, type);
    setBusy(false);
    onClose();
  };

  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('workspace.newTitle')}
      footer={
        <div className="ws-dialog-actions">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            loading={busy}
            disabled={trimmed.length === 0}
            data-testid="new-ws-confirm"
            onClick={() => {
              void submit();
            }}
          >
            {t('workspace.create')}
          </Button>
        </div>
      }
    >
      <label className="ws-dialog-field">
        <span className="ws-dialog-label">{t('workspace.nameLabel')}</span>
        <Input
          value={name}
          placeholder={t('workspace.namePlaceholder')}
          disabled={busy}
          autoFocus
          data-testid="new-ws-name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onNameKeyDown}
        />
      </label>
      <div className="ws-dialog-label">{t('workspace.typeLabel')}</div>
      <div className="ws-type-cards" data-testid="new-ws-types">
        {types.map((def) => (
          <button
            key={def.id}
            type="button"
            className={type === def.id ? 'ws-type-card ws-type-card--active' : 'ws-type-card'}
            data-testid={`new-ws-type-${def.id}`}
            aria-pressed={type === def.id}
            disabled={busy}
            onClick={() => {
              setType(def.id);
            }}
          >
            <Icon icon={def.icon} size="lg" />
            <span className="ws-type-name">{def.label}</span>
            <span className="ws-type-desc">{def.desc}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
