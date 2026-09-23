/**
 * WorkbenchPage.tsx —— 个人工作台（home 视图）仪表盘（TASK-T66-01 §1 + T71-01 注册表）。
 *
 * 全窗口**覆盖编辑区**的卡片流（侧栏/顶栏/标签条保持可见可点）。视图态住在
 * workbench/state.ts（App 级订阅），**不动 pagesStore/tabs 语义**。
 *
 * T71-01 改为注册表驱动：卡片由 `workbench/cards.tsx` 的 CARD_DEFS 渲染（内置 5 卡 +
 * 6 新卡）；visibleCards 经 state 的 order/hidden 过滤。新增「自定义模式」：拖拽重排
 * （⋮⋮ 手柄 + HTML5 drag，T60 语法）、⊟ 移除、+ 添加卡片目录（T70 宿主钮 stopPropagation），
 * 每次变更即时写 v2 localStorage。
 *
 * 数据面全走现成通道 / tree 缓存 / settings localStorage；main/preload/shared/ipc 零改动。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Menu, X } from '@septcats/ui';
import { t } from '../i18n';
import { pagesActions } from '../state/pages';
import {
  workbenchActions,
  useWorkbench,
  type WorkbenchCardId,
} from './state';
import { WorkbenchCard, WorkbenchPixelButton } from './WorkbenchCard';
import { PixelHomeGlyph } from './pixelGlyph';
import { CARD_DEFS, wbcardRead, wbcardWrite, type CardApi } from './cards';
import { greetingPhase } from './work';
import './WorkbenchPage.css';

/** 自定义模式：添加卡片目录（卡市场的前端形态）——列出当前隐藏（已移除）的卡。 */
function hiddenCatalogItems(hidden: readonly WorkbenchCardId[]): Array<{ id: string; label: string; disabled?: boolean }> {
  const items = hidden.map((id) => {
    const def = CARD_DEFS[id];
    return { id, label: `${t(def.labelKey)} · ${t('workbench.catalogRestore')}` };
  });
  return [...items, { id: 'more', label: t('workbench.catalogMore'), disabled: true }];
}

export interface WorkbenchPageProps {
  onClose(): void;
}

/** 工作台视图（App 在 view==='home' 时挂在本组件位置替换编辑列）。 */
export function WorkbenchPage({ onClose }: WorkbenchPageProps) {
  const cardOrder = useWorkbench((state) => state.cardOrder);
  const hiddenCards = useWorkbench((state) => state.hiddenCards);
  const [customizing, setCustomizing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [dragId, setDragId] = useState<WorkbenchCardId | null>(null);
  const [dragOverId, setDragOverId] = useState<WorkbenchCardId | null>(null);

  const api: CardApi = useMemo(
    () => ({
      openPage: (id: string): void => {
        workbenchActions.closeHome();
        pagesActions.openInTab(id);
      },
      t: (key: string): string => t(key),
      settings: { read: wbcardRead, write: wbcardWrite },
    }),
    [],
  );

  // Esc 关闭回 pages（§3 红线：home 不得成为死角）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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

  const visibleCards = cardOrder.filter((id) => !hiddenCards.includes(id));

  // 自定义模式拖拽重排（T60 同款 HTML5 drag 语法）
  const onSlotDragStart = useCallback(
    (id: WorkbenchCardId) => (event: React.DragEvent): void => {
      setDragId(id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    },
    [],
  );
  const onSlotDragOver = useCallback(
    (id: WorkbenchCardId) => (event: React.DragEvent): void => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverId(id);
    },
    [],
  );
  const onSlotDrop = useCallback(
    (id: WorkbenchCardId) => (event: React.DragEvent): void => {
      event.preventDefault();
      if (dragId !== null && dragId !== id) {
        workbenchActions.reorderCard(dragId, id);
      }
      setDragId(null);
      setDragOverId(null);
    },
    [dragId],
  );
  const onSlotDragEnd = useCallback((): void => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  const catalogItems = useMemo(() => hiddenCatalogItems(hiddenCards), [hiddenCards]);

  return (
    <div
      className="wb-root"
      role="region"
      aria-label={t('workbench.title')}
      data-testid="workbench"
      tabIndex={-1}
    >
      <div className="wb-head">
        <h1 className="wb-title">
          <PixelHomeGlyph size={20} className="wb-title__glyph" aria-hidden="true" />
          {t('workbench.title')}
        </h1>
        <div className="wb-head__actions">
          {visibleCards.length !== cardOrder.length ? (
            <WorkbenchPixelButton
              label={t('workbench.cardReset')}
              onClick={() => {
                workbenchActions.resetCards();
              }}
              testId="wb-reset"
            />
          ) : null}
          <button
            type="button"
            className={customizing ? 'wb-customize wb-customize--active' : 'wb-customize'}
            aria-pressed={customizing}
            aria-label={t('workbench.customize')}
            data-testid="wb-customize"
            onClick={() => {
              setCustomizing((value) => !value);
              setCatalogOpen(false);
            }}
          >
            {t('workbench.customize')}
          </button>
          {customizing ? (
            <button
              type="button"
              className="wb-customize-done"
              aria-label={t('workbench.customizeDone')}
              data-testid="wb-customize-done"
              onClick={() => {
                setCustomizing(false);
                setCatalogOpen(false);
              }}
            >
              {t('workbench.customizeDone')}
            </button>
          ) : null}
          <button
            type="button"
            className="wb-close"
            aria-label={t('workbench.close')}
            title={t('workbench.close')}
            data-testid="wb-close"
            onClick={onClose}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      </div>
      <div className="wb-flow">
        <WelcomeBar />
        {visibleCards.map((id) => {
          const def = CARD_DEFS[id];
          const slotClass =
            customizing && dragOverId === id
              ? 'wb-slot wb-slot--drop'
              : customizing && dragId === id
                ? 'wb-slot wb-slot--dragging'
                : 'wb-slot';
          return (
            <div
              key={id}
              className={slotClass}
              data-testid={`wb-slot-${id}`}
              draggable={customizing}
              onDragStart={customizing ? onSlotDragStart(id) : undefined}
              onDragOver={customizing ? onSlotDragOver(id) : undefined}
              onDrop={customizing ? onSlotDrop(id) : undefined}
              onDragEnd={customizing ? onSlotDragEnd : undefined}
            >
              <WorkbenchCard
                cardId={id}
                title={t(def.labelKey)}
                customizing={customizing}
                onRemove={() => {
                  workbenchActions.setCardHidden(id, true);
                }}
              >
                {def.render(api)}
              </WorkbenchCard>
            </div>
          );
        })}
        {customizing ? (
          <div className="wb-add-card" data-testid="wb-add-card">
            <button
              type="button"
              className="wb-add-card__btn"
              aria-label={t('workbench.addCard')}
              data-testid="wb-add-card-btn"
              onClick={(event) => {
                // T70 教训：宿主钮 stopPropagation 再开，避免 document click 自关菜单
                event.stopPropagation();
                setCatalogOpen((open) => !open);
              }}
            >
              + {t('workbench.addCard')}
            </button>
            {catalogOpen ? (
              <Menu
                className="wb-card__menu"
                label={t('workbench.addCard')}
                items={catalogItems}
                onSelect={(selectedId) => {
                  setCatalogOpen(false);
                  if (selectedId !== 'more') {
                    workbenchActions.setCardHidden(selectedId as WorkbenchCardId, false);
                  }
                }}
                onDismiss={() => {
                  setCatalogOpen(false);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WelcomeBar() {
  const now = new Date();
  const phase = greetingPhase(now.getHours());
  const greeting =
    phase === 'morning'
      ? t('workbench.greetingMorning')
      : phase === 'afternoon'
        ? t('workbench.greetingAfternoon')
        : t('workbench.greetingEvening');
  const dateText = now.toLocaleDateString();
  return (
    <div className="wb-welcome" data-testid="wb-welcome">
      <PixelHomeGlyph size={24} className="wb-welcome__glyph" aria-hidden="true" />
      <div className="wb-welcome__text">
        <h2 className="wb-welcome__title">{greeting}</h2>
        <p className="wb-welcome__date">{t('workbench.today').replace('{date}', dateText)}</p>
      </div>
    </div>
  );
}

// 旧测试从 WorkbenchPage 导入 aliveDatabaseNodes（T66 探针）；转由 cards 模块实现，此处再导出保兼容。
export { aliveDatabaseNodes } from './cards';
