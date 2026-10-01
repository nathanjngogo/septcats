/**
 * PageFind.tsx —— 页内查找条（创意项 IDEA-D，Ctrl+F）。
 *
 * v1 = **块级定位**（不做块内高亮，理由见 packages/editor/find.ts 头注）：
 *  浮层搜索框 + 「i/N」计数 + ↑↓ 在命中块间游走；跳转复用大纲/ AI 面板同一条
 *  jumpToBlockId（data-id 锚 + scrollIntoView）——定位语义单一出处。
 *  Esc 关闭（关闭 = 清查询与游标，不留状态）；输入即重算（collectMatches 纯函数）。
 *  命中 0 也显示「0/0」：用户要的是"确实找过了"，不是消失的框。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collectMatches, previewMatch, type FindSource, type FindMatch } from '@septcats/editor';
import { t } from '../i18n';
import './PageFind.css';

interface PageFindProps {
  /** 现读 PM 文档的面（宿主传 () => editor.state.doc）。 */
  getDoc: () => FindSource | null;
  onJump: (blockId: string) => void;
  onClose: () => void;
}

export function PageFind({ getDoc, onJump, onClose }: PageFindProps): ReactNode {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches: FindMatch[] = useMemo(() => {
    const doc = getDoc();
    return doc === null ? [] : collectMatches(doc, query);
    // query 变了必须重算；getDoc 每次渲染新闭包无妨（依赖里带上 query 即可）
  }, [getDoc, query]);

  const current = matches[cursor] ?? matches[0] ?? null;

  // 输入即跳当前块（防抖 250ms 让"边打字边追"不结巴）
  const jumpTimer = useRef<number | null>(null);
  const jumpTo = useCallback((hit: FindMatch | null): void => {
    if (jumpTimer.current !== null) {
      window.clearTimeout(jumpTimer.current);
    }
    if (hit === null) {
      return;
    }
    jumpTimer.current = window.setTimeout(() => {
      onJump(hit.id);
    }, 250);
  }, [onJump]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (jumpTimer.current !== null) {
        window.clearTimeout(jumpTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    jumpTo(current);
  }, [current, jumpTo]);

  const step = (delta: number): void => {
    if (matches.length === 0) {
      return;
    }
    const next = (cursor + delta + matches.length) % matches.length;
    setCursor(next);
    const hit = matches[next] ?? null;
    if (hit !== null) {
      // 手动游走**立即**跳（防抖只给打字场景）
      if (jumpTimer.current !== null) {
        window.clearTimeout(jumpTimer.current);
      }
      onJump(hit.id);
    }
  };

  return (
    <div className="pv-find" data-testid="pv-find" role="search" aria-label={t('editor.findTitle')}>
      <input
        ref={inputRef}
        className="pv-find-input"
        data-testid="pv-find-input"
        type="search"
        placeholder={t('editor.findPlaceholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span className="pv-find-count" data-testid="pv-find-count" aria-live="polite">
        {matches.length === 0 ? t('editor.findNone') : `${String(cursor + 1)}/${String(matches.length)}`}
      </span>
      <button type="button" className="pv-find-nav" data-testid="pv-find-prev" onClick={() => { step(-1); }} aria-label={t('editor.findPrev')}>↑</button>
      <button type="button" className="pv-find-nav" data-testid="pv-find-next" onClick={() => { step(1); }} aria-label={t('editor.findNext')}>↓</button>
      <button type="button" className="pv-find-nav" data-testid="pv-find-close" onClick={onClose} aria-label={t('editor.findClose')}>×</button>
      {current === null ? null : (
        <span className="pv-find-hint" data-testid="pv-find-hint" title={current.text}>{previewMatch(current)}</span>
      )}
    </div>
  );
}
