/**
 * WikiLanding.tsx —— Wiki 落地页（TASK-T42-01 §1.3，口径 A）。
 *
 * 结构 = 标题（双击行内重命名，复用既有 pages.rename）+ 简介（独立于正文块的
 * summary 列，失焦自动保存）+ 子页索引（来自 pagesStore 真树，随增删改名移动
 * 实时更新）+ 「新建子页」（pages.create({parentId: wikiId}) 既有通道）。
 * 「转为普通页」= pages.convert({to:'page'})（承载类型走账本，内容零丢失）。
 * 视觉复用 .pv-* 既有类 + 本文件 .wiki-*（全部 var(--sc-*) token，见 WikiLanding.css）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PageNode } from '@septcats/editor';
import { Button, Icon, FileText, Note } from '@septcats/ui';
import type { PageNodeView } from '../../../types/window';
import { errorText, t } from '../i18n';
import { pagesActions, pushToast, usePages } from '../state/pages';
import './WikiLanding.css';

/** 子页行序：sortKey 升序、id 决胜（与 main 侧派生序一致）。 */
function bySortKey(a: PageNode, b: PageNode): number {
  if (a.sortKey !== b.sortKey) {
    return a.sortKey < b.sortKey ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

/** 末次更新时间展示（子页索引第三列；无 updated_at 的行不显示）。 */
function formatUpdatedAt(ts: number): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

export function WikiLanding({ node }: { node: PageNodeView }) {
  const nodes = usePages((state) => state.nodes);
  const [summaryDraft, setSummaryDraft] = useState(node.summary ?? '');
  /** 已保存基线（与草稿比较决定 dirty；node.summary 外部变更后同步）。 */
  const [savedSummary, setSavedSummary] = useState(node.summary ?? '');
  const [editingTitle, setEditingTitle] = useState(false);
  const summarySavingRef = useRef(false);

  useEffect(() => {
    setSummaryDraft(node.summary ?? '');
    setSavedSummary(node.summary ?? '');
  }, [node.id, node.summary]);

  // 子页索引：真树派生（alive + parentId 命中 + sortKey 序）——增删改名移动后
  // pagesStore 节点更新，索引无需手动刷新。
  const children = useMemo(
    () =>
      nodes
        .filter((child) => child.alive === 1 && child.parentId === node.id)
        .sort(bySortKey),
    [nodes, node.id],
  );

  const summaryDirty = summaryDraft !== savedSummary;

  const saveSummary = async (): Promise<void> => {
    if (!summaryDirty || summarySavingRef.current) {
      return;
    }
    summarySavingRef.current = true;
    try {
      await window.septcats.pages.setSummary({ pageId: node.id, summary: summaryDraft });
      setSavedSummary(summaryDraft);
      await pagesActions.refresh();
    } catch (error) {
      pushToast(errorText(error), 'danger');
    } finally {
      summarySavingRef.current = false;
    }
  };

  const convertToPage = async (): Promise<void> => {
    await pagesActions.convertPage(node.id, 'page');
  };

  const createSubpage = (): void => {
    // 既有通道：create({parentId}) 落在 wiki 之下 → openInTab + 行内重命名 + refresh
    void pagesActions.createPage(node.id);
  };

  const submitTitle = (value: string): void => {
    setEditingTitle(false);
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== node.title) {
      void pagesActions.renamePage(node.id, trimmed);
    }
  };

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitTitle(event.currentTarget.value);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingTitle(false);
    }
  };

  return (
    <div className="pv-root">
      <div className="pv-title-row">
        <span className="pv-page-icon" aria-hidden="true">
          📓
        </span>
        {editingTitle ? (
          <input
            className="app-nav-input wiki-title-input"
            data-testid="wiki-title-input"
            defaultValue={node.title}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => submitTitle(event.currentTarget.value)}
            onKeyDown={onTitleKeyDown}
            aria-label={t('sidebar.renameAria')}
          />
        ) : (
          <h1
            className="pv-page-title wiki-title"
            data-testid="wiki-title"
            onDoubleClick={() => setEditingTitle(true)}
          >
            {node.title}
          </h1>
        )}
        <Button variant="secondary" size="sm" onClick={() => void convertToPage()}>
          {t('editor.convertToPage')}
        </Button>
      </div>
      <div className="wiki-body">
        <div className="wiki-summary">
          <label className="wiki-summary-label" htmlFor="wiki-summary-input">
            {t('editor.wikiSummaryLabel')}
          </label>
          <textarea
            id="wiki-summary-input"
            data-testid="wiki-summary"
            className="wiki-summary-input"
            value={summaryDraft}
            placeholder={t('editor.wikiSummaryPlaceholder')}
            rows={3}
            onChange={(event) => setSummaryDraft(event.target.value)}
            onBlur={() => void saveSummary()}
          />
        </div>
        <div className="wiki-index" data-testid="wiki-index">
          <div className="wiki-index-head">
            <span className="wiki-index-title">
              <Icon icon={Note} size="sm" />
              {t('editor.wikiIndexTitle')}
            </span>
            <Button variant="secondary" size="sm" onClick={createSubpage}>
              {t('editor.wikiNewSubpage')}
            </Button>
          </div>
          {children.length === 0 ? (
            <div className="wiki-index-empty" data-testid="wiki-index-empty">
              {t('editor.wikiEmptyIndex')}
            </div>
          ) : (
            children.map((child) => (
              <div
                key={child.id}
                className="wiki-index-row"
                data-testid="wiki-index-row"
                role="button"
                tabIndex={0}
                onClick={() => pagesActions.openInTab(child.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pagesActions.openInTab(child.id);
                  }
                }}
              >
                <Icon icon={FileText} size="sm" className="wiki-index-icon" />
                <span className="wiki-index-label">{child.title}</span>
                {child.updatedAt != null && child.updatedAt > 0 ? (
                  <span className="wiki-index-time">
                    {t('editor.wikiUpdatedAt')} {formatUpdatedAt(child.updatedAt)}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
