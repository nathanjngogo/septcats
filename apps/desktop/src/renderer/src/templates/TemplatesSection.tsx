/**
 * TemplatesSection.tsx —— 设置页「模板」区块（TASK-T23-02 §D，纯 renderer）。
 *
 * mount 拉一次 templates:list；此后每次写操作（重命名/删除）由 slice 内统一刷新，
 * 命令面板分组与侧栏子菜单订阅同一 slice，三处列表天然一致。
 * 行 = 图标 + 名称 + 右侧「⋯」（Menu：重命名 / 删除）；删除走 Dialog 二次确认（软删）；
 * 空态「暂无模板」（读失败同样回落空态，错误不打断设置页）。
 */
import { useEffect, useState } from 'react';
import { Button, Dialog, IconButton, Input, Menu } from '@septcats/ui';
import { DotsThree } from '@septcats/ui';
import { t } from '../i18n';
import { templatesActions, useTemplates } from '../state/templates';
import { TemplateIcon } from './TemplateIcon';
import './templates.css';

/** i18n 模板替换：'{name}' 槽位（t() 本身不做插值；AiSection 同款小实现）。 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

export function TemplatesSection() {
  const templates = useTemplates((state) => state.templates);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    void templatesActions.loadTemplates();
  }, []);

  const renameTarget = templates.find((template) => template.id === renameId) ?? null;
  const deleteTarget = templates.find((template) => template.id === deleteId) ?? null;

  const closeRename = (): void => {
    setRenameId(null);
    setRenameBusy(false);
  };

  const submitRename = async (): Promise<void> => {
    const target = renameTarget;
    const trimmed = renameTitle.trim();
    if (target === null || trimmed.length === 0 || renameBusy) {
      return;
    }
    setRenameBusy(true);
    const ok = await templatesActions.renameTemplate(target.id, trimmed);
    setRenameBusy(false);
    if (ok) {
      closeRename();
    }
  };

  const closeDelete = (): void => {
    setDeleteId(null);
    setDeleteBusy(false);
  };

  const submitDelete = async (): Promise<void> => {
    const target = deleteTarget;
    if (target === null || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    const ok = await templatesActions.deleteTemplate(target.id);
    setDeleteBusy(false);
    if (ok) {
      closeDelete();
    }
  };

  return (
    <div data-testid="settings-templates">
      {templates.length === 0 ? (
        <div className="tpl-empty" data-testid="settings-tpl-empty">
          {t('templates.empty')}
        </div>
      ) : (
        templates.map((template, index) => (
          <div key={template.id} className="tpl-row" data-testid={`settings-tpl-row-${String(index)}`}>
            <TemplateIcon template={template} className="tpl-row-ic" />
            <span className="tpl-row-tx">{template.title}</span>
            <span className="tpl-menu-wrap">
              <IconButton
                icon={DotsThree}
                label={t('templates.rowMenu')}
                data-testid={`settings-tpl-menu-${String(index)}`}
                aria-expanded={menuId === template.id}
                onClick={() => {
                  setMenuId((current) => (current === template.id ? null : template.id));
                }}
              />
              {menuId === template.id ? (
                <Menu
                  className="tpl-menu"
                  label={t('templates.rowMenu')}
                  items={[
                    { id: 'rename', label: t('templates.rename') },
                    { id: 'delete', label: t('templates.delete'), danger: true },
                  ]}
                  onSelect={(id) => {
                    setMenuId(null);
                    if (id === 'rename') {
                      setRenameId(template.id);
                      setRenameTitle(template.title);
                    }
                    if (id === 'delete') {
                      setDeleteId(template.id);
                    }
                  }}
                  onDismiss={() => {
                    setMenuId(null);
                  }}
                />
              ) : null}
            </span>
          </div>
        ))
      )}

      <Dialog
        open={renameTarget !== null}
        onClose={closeRename}
        title={t('templates.renameTitle')}
        footer={
          <div className="tpl-dialog-actions">
            <Button variant="secondary" size="sm" disabled={renameBusy} onClick={closeRename}>
              {t('templates.cancel')}
            </Button>
            <Button
              size="sm"
              loading={renameBusy}
              disabled={renameTitle.trim().length === 0}
              data-testid="template-rename-confirm"
              onClick={() => {
                void submitRename();
              }}
            >
              {t('templates.saveAsConfirm')}
            </Button>
          </div>
        }
      >
        <Input
          label={t('templates.nameLabel')}
          value={renameTitle}
          disabled={renameBusy}
          data-testid="template-rename-name"
          onChange={(event) => setRenameTitle(event.target.value)}
        />
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={closeDelete}
        title={t('templates.deleteTitle')}
        footer={
          <div className="tpl-dialog-actions">
            <Button variant="secondary" size="sm" disabled={deleteBusy} onClick={closeDelete}>
              {t('templates.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={deleteBusy}
              data-testid="template-delete-confirm"
              onClick={() => {
                void submitDelete();
              }}
            >
              {t('templates.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="tpl-dialog-text">
          {fillTemplate(t('templates.deleteBody'), { name: deleteTarget?.title ?? '' })}
        </p>
      </Dialog>
    </div>
  );
}
