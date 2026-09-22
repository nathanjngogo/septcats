/**
 * ManualView.tsx —— 使用说明书阅读视图（TASK-T56-01 §1②③④）。
 *
 * 应用内**全屏像素风阅读视图**（不是外部浏览器）：左侧章节锚点表（可折叠）+
 * 右侧 Markdown 正文。正文来自构建期内联的 docs/manual/*.md（manualContent.ts），
 * 经 markdown.ts 解析成块模型后渲染——运行时零 fs、零网络。
 *
 * 视觉吃 T53-01 像素 token（--sc-bevel-out / --sc-pixel-out / 灰阶语义色），语法
 * 参考 close/CloseAskDialog.css：零字面 hex、零内联色。
 *
 * 契约：Esc / 关闭钮 → 回调 onClose（App 侧回 editor 视图）；锚点点击 →
 * scrollIntoView 到对应章节（数据面零改动，纯视图导航）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CaretDown, CaretRight, Icon, X } from '@septcats/ui';
import { t, useLocale } from '../i18n';
import { MANUAL_SOURCES } from './manualContent';
import { parseManual, type InlineNode, type MdBlock } from './markdown';
import './ManualView.css';

function renderInline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === 'code') {
      return (
        <code className="manual-view__code-inline" key={index}>
          {node.text}
        </code>
      );
    }
    if (node.kind === 'strong') {
      return <strong key={index}>{node.text}</strong>;
    }
    if (node.kind === 'link') {
      return (
        <a className="manual-view__link" href={node.href} key={index} rel="noreferrer">
          {node.text}
        </a>
      );
    }
    return <span key={index}>{node.text}</span>;
  });
}

function renderBlock(block: MdBlock, index: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      // 章节标题（h2）由 parseManual 抽到 section.title，此处只剩章内小节标题。
      if (block.level <= 2) {
        return (
          <h3 className="manual-view__h3" key={index}>
            {block.text}
          </h3>
        );
      }
      return (
        <h4 className="manual-view__h4" key={index}>
          {block.text}
        </h4>
      );
    }
    case 'paragraph':
      return (
        <p className="manual-view__p" key={index}>
          {renderInline(block.inline)}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol className="manual-view__list" key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className="manual-view__list" key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="manual-view__pre" key={index}>
          <code>{block.code}</code>
        </pre>
      );
    case 'table':
      return (
        <div className="manual-view__table-wrap" key={index}>
          <table className="manual-view__table">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export interface ManualViewProps {
  onClose(): void;
}

export function ManualView({ onClose }: ManualViewProps) {
  const locale = useLocale();
  const doc = useMemo(() => parseManual(MANUAL_SOURCES[locale]), [locale]);
  const [anchorsOpen, setAnchorsOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Esc 关闭（回编辑器视图）；窗口级监听，视图内任意焦点位置都生效。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const jumpTo = (id: string): void => {
    setActiveId(id);
    const target = document.getElementById(id);
    if (target !== null && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start' });
    }
  };

  const firstSectionId = doc.sections[0]?.id ?? null;
  const currentId = activeId ?? firstSectionId;

  return (
    <div
      className={`manual-view${anchorsOpen ? '' : ' manual-view--collapsed'}`}
      data-testid="manual-view"
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="manual-view__bar">
        <div className="manual-view__bar-title">
          <h2 className="manual-view__title">{t('manual.title')}</h2>
          <span className="manual-view__doc-title">{doc.title}</span>
        </div>
        <div className="manual-view__bar-actions">
          <button
            type="button"
            className="manual-view__toggle"
            data-testid="manual-anchors-toggle"
            aria-expanded={anchorsOpen}
            onClick={() => {
              setAnchorsOpen((open) => !open);
            }}
          >
            {anchorsOpen ? (
              <Icon icon={CaretDown} size="sm" />
            ) : (
              <Icon icon={CaretRight} size="sm" />
            )}
            <span>{anchorsOpen ? t('manual.toggleAnchors') : t('manual.toggleAnchorsExpand')}</span>
          </button>
          <button
            type="button"
            className="manual-view__close"
            data-testid="manual-close"
            aria-label={t('manual.close')}
            title={t('manual.close')}
            onClick={onClose}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      </div>
      <div className="manual-view__body">
        <nav className="manual-view__anchors" data-testid="manual-anchors" aria-label={t('manual.chapters')}>
          {doc.sections.map((section) => (
            <button
              type="button"
              key={section.id}
              className="manual-view__anchor"
              data-testid={`manual-anchor-${section.id}`}
              aria-current={currentId === section.id ? 'true' : undefined}
              onClick={() => {
                jumpTo(section.id);
              }}
            >
              {section.title}
            </button>
          ))}
        </nav>
        <div className="manual-view__content" data-testid="manual-content">
          <article className="manual-view__article">
            <h1 className="manual-view__h1">{doc.title}</h1>
            {doc.preamble.map((block, index) => renderBlock(block, index))}
            {doc.sections.map((section) => (
              <section
                className="manual-view__section"
                id={section.id}
                data-testid={`manual-section-${section.id}`}
                key={section.id}
              >
                <h2 className="manual-view__h2">{section.title}</h2>
                {section.blocks.map((block, index) => renderBlock(block, index))}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}
