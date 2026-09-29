/**
 * KnowledgePanel.tsx —— 一级「知识库」的二级栏内容（T93-01）。
 *
 * 口径（PRD §3 默认值）：列出**本机全部库**（`workspaces.list` 既有通道）+ 新建库入口。
 * 为什么不是「按库类型过滤出知识库库」：库类型当前未持久化（`workspaces.create` 只收
 * name，类型只在 renderer 侧驱动播种）—— 要按类型过滤需一次 schema 迁移 + 通道扩参，
 * 属数据模型变更，见 PRD §5 待老板一句话确认。
 *
 * 行为：点条目 = 切库（既有 pagesActions.switchWorkspace，切完 load 树/页签）；
 * 「新建库…」= 复用既有 NewWorkspaceDialog（建库 + 切库 + 按类型播种），不新造通道。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { NewWorkspaceDialog } from '../pages/NewWorkspaceDialog';
import { pagesActions } from '../state/pages';
import { usePages } from '../state/pages';
import './KnowledgePanel.css';

export function KnowledgePanel(): ReactNode {
  const workspaces = usePages((state) => state.workspaces);
  const workspaceId = usePages((state) => state.workspaceId);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="kb-panel" data-testid="kb-panel">
      <div className="kb-panel__head">
        <span className="kb-panel__title">{t('kbPanel.title')}</span>
        <span className="kb-panel__count">{String(workspaces.length)}</span>
      </div>
      <div className="kb-panel__scroll">
        {workspaces.length === 0 ? (
          <div className="kb-panel__empty" data-testid="kb-empty">
            {t('kbPanel.empty')}
          </div>
        ) : (
          workspaces.map((ws, index) => {
            const isCurrent = ws.id === workspaceId;
            return (
              <button
                key={ws.id}
                type="button"
                className={isCurrent ? 'kb-panel__row kb-panel__row--on' : 'kb-panel__row'}
                title={isCurrent ? `${ws.name} (${t('kbPanel.currentTag')})` : t('kbPanel.switchHint')}
                data-testid={`kb-row-${String(index)}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => {
                  if (!isCurrent) {
                    void pagesActions.switchWorkspace(ws.id);
                  }
                }}
              >
                <span className="kb-panel__name">{ws.name}</span>
                {isCurrent ? <span className="kb-panel__tag">{t('kbPanel.currentTag')}</span> : null}
              </button>
            );
          })
        )}
      </div>
      <div className="kb-panel__foot">
        <button
          type="button"
          className="kb-panel__new"
          data-testid="kb-new"
          onClick={() => {
            setNewOpen(true);
          }}
        >
          {t('kbPanel.newWorkspace')}
        </button>
        <div className="kb-panel__hint">{t('kbPanel.subtitle')}</div>
      </div>
      <NewWorkspaceDialog
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
        }}
      />
    </div>
  );
}