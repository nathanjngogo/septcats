/**
 * TabsBar.tsx —— 编辑区多页签条（TASK-T37-01 §0.2）。
 *
 * 位置：顶栏下方、编辑区上方（App.tsx 编辑列容器内，与 PageView 同列）。
 * 交互：点击切换（统一走 pagesActions.openInTab）· `×` 关闭 · 中键关闭 ·
 * 拖拽排序（HTML5 DnD，落点按目标标签中点判前/后，moveTabTo 持久化）·
 * 溢出横向滚动（CSS，不换行）· 当前标签 surface-active 高亮。
 * 标题：实时来自 pagesStore.nodes（改名即刷新）；空标题回退「未命名」；
 * 过长省略号（CSS text-overflow）。
 * 关闭 ≠ 删除页面：只调 closeTab（§0.7），绝不触发 pages.remove。
 */
import { useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { Icon, X } from '@septcats/ui';
import { t } from '../i18n';
import { nodeMap, pagesActions, usePages } from '../state/pages';
import './TabsBar.css';

export function TabsBar() {
  const tabs = usePages((state) => state.tabs);
  const nodes = usePages((state) => state.nodes);
  const selectedId = usePages((state) => state.selectedId);
  const byId = useMemo(() => nodeMap(nodes), [nodes]);
  const dragIdRef = useRef<string | null>(null);
  /** 拖拽悬停目标标签 id（落点指示；null = 无）。 */
  const [dropTabId, setDropTabId] = useState<string | null>(null);

  if (tabs.length === 0) {
    return null;
  }

  const onTabDrop = (event: DragEvent<HTMLDivElement>, targetId: string): void => {
    event.preventDefault();
    const draggedId = dragIdRef.current;
    dragIdRef.current = null;
    setDropTabId(null);
    if (draggedId === null || draggedId === targetId) {
      return;
    }
    const element = event.currentTarget.getBoundingClientRect();
    // 中点判前/后：落点在目标左半 → 插到目标前；右半 → 插到目标后。
    // toIndex 按「移除被拖项后」的数组口径换算（moveTabTo 内部再夹紧）。
    const dropAfter = event.clientX > element.left + element.width / 2;
    const order = tabs;
    const targetIndex = order.indexOf(targetId);
    const fromIndex = order.indexOf(draggedId);
    const toIndex = dropAfter
      ? targetIndex + (fromIndex < targetIndex ? 0 : 1)
      : targetIndex - (fromIndex < targetIndex ? 1 : 0);
    pagesActions.moveTabTo(draggedId, toIndex);
  };

  return (
    <div className="tabsbar" role="tablist" aria-label={t('tabs.barLabel')} data-testid="tabsbar">
      {tabs.map((id) => {
        const node = byId.get(id);
        const title = node !== undefined && node.title.length > 0 ? node.title : t('common.untitled');
        const active = id === selectedId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={active ? 'tabsbar-tab tabsbar-tab--active' : 'tabsbar-tab'}
            data-testid={`tab-${id}`}
            title={title}
            onClick={() => {
              pagesActions.openInTab(id);
            }}
            onAuxClick={(event: MouseEvent<HTMLDivElement>) => {
              if (event.button === 1) {
                event.preventDefault();
                pagesActions.closeTab(id);
              }
            }}
            draggable
            onDragStart={(event: DragEvent<HTMLDivElement>) => {
              dragIdRef.current = id;
              event.dataTransfer?.setData('text/plain', id);
              event.dataTransfer?.setData('application/x-septcats-tab', id);
            }}
            onDragOver={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              if (dragIdRef.current !== null && dragIdRef.current !== id) {
                setDropTabId(id);
              }
            }}
            onDragLeave={() => {
              setDropTabId((current) => (current === id ? null : current));
            }}
            onDrop={(event) => {
              onTabDrop(event, id);
            }}
            onDragEnd={() => {
              dragIdRef.current = null;
              setDropTabId(null);
            }}
          >
            <span className={dropTabId === id ? 'tabsbar-title tabsbar-title--drop' : 'tabsbar-title'}>
              {title}
            </span>
            <button
              type="button"
              className="tabsbar-close"
              data-testid={`tab-close-${id}`}
              aria-label={`${t('tabs.close')} · ${title}`}
              // × 点击不冒泡到标签本体（否则先切换再关闭）
              onClick={(event) => {
                event.stopPropagation();
                pagesActions.closeTab(id);
              }}
            >
              <Icon icon={X} size="sm" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
