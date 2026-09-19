/**
 * BacklinksPanel.tsx —— 双链「反向链接」面板（TASK-T44-01 §1.4）。
 *
 * 列出引用了本页的存活源页（页名 + 上下文片段），点击条目跳到源块
 * （跨页复用 chatBridge 的 requestBlockJump：同页立即跳、跨页 pendingJump + 页签）。
 * 数据源 `links:backlinks`（main 侧派生索引，设备本地）；`revision` 变化（本页
 * 内容提交后由 PageView 递增）触发防抖重拉——链接增删后实时更新。
 */
import { useEffect, useState } from 'react';
import { requestBlockJump } from '../ai/chatBridge';
import { t } from '../i18n';

interface BacklinkEntry {
  sourcePageId: string;
  sourceTitle: string;
  sourceBlockId: string;
  context: string;
}

export interface BacklinksPanelProps {
  /** 当前页（回链目标）。 */
  pageId: string;
  /** 内容修订号（每次编辑提交后 +1；防抖重拉，实时更新）。 */
  revision: number;
}

/** 重拉防抖（ms）：等 EditSession 的提交 debounce 走完，索引已更新。 */
const REFETCH_DEBOUNCE_MS = 400;

export function BacklinksPanel({ pageId, revision }: BacklinksPanelProps) {
  const [entries, setEntries] = useState<BacklinkEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.septcats.links
        .backlinks({ pageId })
        .then((res) => {
          if (cancelled) {
            return;
          }
          setEntries(res.entries);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) {
            return;
          }
          setError(err instanceof Error ? err.message : String(err));
        });
    }, REFETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pageId, revision]);

  return (
    <div className="pv-backlinks" data-testid="backlinks-panel">
      <div className="pv-backlinks__title">{t('editor.backlinksTitle')}</div>
      {error !== null ? (
        <div className="pv-backlinks__empty">{error}</div>
      ) : entries === null ? null : entries.length === 0 ? (
        <div className="pv-backlinks__empty">{t('editor.backlinksEmpty')}</div>
      ) : (
        <ul className="pv-backlinks__list">
          {entries.map((entry) => (
            <li key={`${entry.sourcePageId}:${entry.sourceBlockId}`}>
              <button
                type="button"
                className="pv-backlinks__item"
                data-testid="backlinks-item"
                data-source-page={entry.sourcePageId}
                data-source-block={entry.sourceBlockId}
                aria-label={t('editor.backlinksJumpAria')}
                onClick={() => {
                  requestBlockJump(entry.sourcePageId, entry.sourceBlockId);
                }}
              >
                <span className="pv-backlinks__source">{entry.sourceTitle}</span>
                {entry.context.length > 0 ? (
                  <span className="pv-backlinks__context">{entry.context}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
