/**
 * WorkbenchPage.tsx —— 个人工作台（home 视图）仪表盘（TASK-T66-01 §1）。
 *
 * 全窗口**覆盖编辑区**的卡片流（侧栏/顶栏/标签条保持可见可点——点任意页面行/页签
 * 即回 pages 并正常开页；Esc / 关闭钮 = workbenchActions.closeHome）。视图态住在
 * workbench/state.ts（App 级订阅），**不动 pagesStore/tabs 语义**。
 *
 * 卡片流（§1.3 自上而下，序/显隐可配置 §1.4）：
 *   欢迎条（不进卡配置）→ 快捷行 / 待办 / 数据库（老板点名的「库」卡）/ 最近 / 收藏。
 *
 * 数据面全走现成通道：库页 = pageTypeOf==='database' 的存活页（与 main 侧 dbPageIds
 * 同判定）；行数 = db.load 的 records（现成 IPC，零新通道）；最近/收藏 = pagesStore
 * 的 recentIds/favoriteIds。打开动作统一先 closeHome() 再走既有入口（selectPage /
 * openInTab / db.create + refresh + selectPage）。
 *
 * 像素纪律：卡壳黑框线 + hover 抬升走 var(--sc-*)；房子/待办 glyph 局部自绘
 * （pixelGlyph.tsx，T65 红线）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  CheckCircle,
  Circle,
  Clock,
  FolderSimple,
  Icon,
  Note,
  Plus,
  Star,
  X,
} from '@septcats/ui';
import { t } from '../i18n';
import {
  ancestorsOf,
  nodeMap,
  pageTypeOf,
  pagesActions,
  pagesStore,
  pushToast,
  usePages,
} from '../state/pages';
import type { PageNodeView, SeptcatsApi } from '../../../types/window';
import {
  DB_CARD_LIMIT,
  RECENT_CARD_LIMIT,
  workbenchActions,
  useWorkbench,
  type WorkbenchCardId,
} from './state';
import { WorkbenchCard, WorkbenchPixelButton } from './WorkbenchCard';
import { PixelHomeGlyph, PixelTodoGlyph } from './pixelGlyph';
import {
  addTodo,
  countDbRows,
  createDailyNote,
  formatRelativeTime,
  greetingPhase,
  readTodos,
  removeTodo,
  toggleTodo,
  writeTodos,
  type TodoItem,
} from './work';
import './WorkbenchPage.css';

function septcatsApi(): SeptcatsApi | undefined {
  return (globalThis as { septcats?: SeptcatsApi }).septcats;
}

/** 关闭 home 后打开某页（§1.3：点行 = 回 pages 并打开；openInTab 自带落页签/回视图/祖先展开）。 */
function openPageFromHome(id: string): void {
  workbenchActions.closeHome();
  pagesActions.openInTab(id);
}

/** 新建库页（db.create 现成通道 → refresh 对账 → 回 pages 打开新库页）。 */
async function createDatabasePage(): Promise<void> {
  const api = septcatsApi();
  const workspaceId = pagesStore.getState().workspaceId;
  if (api === undefined || workspaceId === null) {
    return;
  }
  const created = await api.db.create({ workspaceId, title: t('common.untitled') });
  await pagesActions.refresh();
  workbenchActions.closeHome();
  pagesActions.selectPage(created.pageId);
}

// ---------------------------------------------------------------------------
// 各卡（独立组件，细粒度订阅自己的 store 切片）
// ---------------------------------------------------------------------------

function QuickCard() {
  const createPage = useCallback((): void => {
    workbenchActions.closeHome();
    void pagesActions.createPage(null);
  }, []);

  const createDatabase = useCallback((): void => {
    void createDatabasePage().then(
      () => pushToast(t('workbench.toastDatabaseCreated'), 'success'),
      (error: unknown) => {
        pushToast(error instanceof Error ? error.message : String(error), 'danger');
      },
    );
  }, []);

  const createDaily = useCallback((): void => {
    void (async () => {
      const api = septcatsApi();
      if (api === undefined) {
        return;
      }
      const id = await createDailyNote(
        api.pages,
        (dateKey) => t('workbench.dailyNoteTitle').replace('{date}', dateKey),
        new Date(),
      );
      await pagesActions.refresh();
      workbenchActions.closeHome();
      pagesActions.openInTab(id);
      pushToast(t('workbench.toastDailyNoteCreated'), 'success');
    })().catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : String(error), 'danger');
    });
  }, []);

  return (
    <WorkbenchCard cardId="quick" title={t('workbench.cardQuick')}>
      <div className="wb-quick">
        <WorkbenchPixelButton
          label={t('workbench.quickNewPage')}
          glyph={<Icon icon={Plus} size="sm" />}
          onClick={createPage}
          testId="wb-quick-page"
        />
        <WorkbenchPixelButton
          label={t('workbench.quickNewDatabase')}
          glyph={<Icon icon={FolderSimple} size="sm" />}
          onClick={createDatabase}
          testId="wb-quick-database"
        />
        <WorkbenchPixelButton
          label={t('workbench.quickDailyNote')}
          glyph={<Icon icon={Note} size="sm" />}
          onClick={createDaily}
          testId="wb-quick-daily"
        />
      </div>
    </WorkbenchCard>
  );
}

function TodoCard() {
  const [todos, setTodos] = useState<TodoItem[]>(() => readTodos());
  const [draft, setDraft] = useState('');

  const commit = useCallback((next: TodoItem[]): void => {
    setTodos(next);
    writeTodos(next);
  }, []);

  const onAdd = useCallback((): void => {
    const next = addTodo(todos, draft, Date.now());
    if (next !== null) {
      commit(next);
      setDraft('');
    }
  }, [todos, draft, commit]);

  return (
    <WorkbenchCard
      cardId="todo"
      title={t('workbench.cardTodo')}
      headerExtra={
        <WorkbenchPixelButton label={t('workbench.todoAdd')} onClick={onAdd} testId="wb-todo-add" />
      }
    >
      <div className="wb-todo">
        <PixelTodoGlyph size={16} className="wb-todo__glyph" aria-hidden="true" />
        {todos.length === 0 ? (
          <p className="wb-empty" data-testid="wb-todo-empty">
            {t('workbench.todoEmpty')}
          </p>
        ) : (
          <ul className="wb-todo__list">
            {todos.map((item) => (
              <li
                key={item.id}
                className={item.done ? 'wb-todo__item wb-todo__item--done' : 'wb-todo__item'}
              >
                <button
                  type="button"
                  className="wb-todo__check"
                  aria-pressed={item.done}
                  aria-label={item.text}
                  data-testid={`wb-todo-toggle-${item.id}`}
                  onClick={() => {
                    commit(toggleTodo(todos, item.id));
                  }}
                >
                  <Icon icon={item.done ? CheckCircle : Circle} size="sm" />
                </button>
                <span className="wb-todo__text">{item.text}</span>
                <button
                  type="button"
                  className="wb-todo__del"
                  aria-label={t('workbench.todoDelete')}
                  data-testid={`wb-todo-del-${item.id}`}
                  onClick={() => {
                    commit(removeTodo(todos, item.id));
                  }}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          className="wb-todo__input"
          value={draft}
          placeholder={t('workbench.todoPlaceholder')}
          aria-label={t('workbench.todoPlaceholder')}
          data-testid="wb-todo-input"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
        />
      </div>
    </WorkbenchCard>
  );
}

/** 存活 database 页（与 main 侧 dbPageIds 判定同口径：pageType='database' + alive=1；
 * wiki/回收站/彻底删除不混入）。 */
export function aliveDatabaseNodes(nodes: readonly PageNodeView[]): PageNodeView[] {
  return nodes.filter((node) => node.alive === 1 && pageTypeOf(node) === 'database');
}

function DatabaseCard() {
  const nodes = usePages((state) => state.nodes);
  const shown = useMemo(() => aliveDatabaseNodes(nodes).slice(0, DB_CARD_LIMIT), [nodes]);
  const totalCount = usePages((state) => aliveDatabaseNodes(state.nodes).length);
  const shownKey = useMemo(() => shown.map((node) => node.id).join('|'), [shown]);
  const [rows, setRows] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    const api = septcatsApi();
    if (api === undefined || shownKey.length === 0) {
      setRows({});
      return;
    }
    let cancelled = false;
    void countDbRows(api.db, shownKey.split('|')).then((next) => {
      if (!cancelled) {
        setRows(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shownKey]);

  const byId = useMemo(() => nodeMap(nodes), [nodes]);
  const pathOf = useCallback(
    (node: PageNodeView): string => ancestorsOf(node.id, byId).map((item) => item.title).join(' / '),
    [byId],
  );

  const createDatabase = useCallback((): void => {
    void createDatabasePage().catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : String(error), 'danger');
    });
  }, []);

  return (
    <WorkbenchCard
      cardId="database"
      title={t('workbench.cardDatabase')}
      headerExtra={
        <WorkbenchPixelButton label={t('workbench.databaseNew')} onClick={createDatabase} testId="wb-db-new" />
      }
    >
      {shown.length === 0 ? (
        <p className="wb-empty" data-testid="wb-db-empty">
          {t('workbench.databaseEmpty')}
        </p>
      ) : (
        <ul className="wb-list">
          {shown.map((node) => {
            const count = rows[node.id];
            return (
              <li key={node.id}>
                <button
                  type="button"
                  className="wb-row"
                  data-testid={`wb-db-row-${node.id}`}
                  onClick={() => {
                    openPageFromHome(node.id);
                  }}
                >
                  <Icon icon={FolderSimple} size="sm" className="wb-row__icon" />
                  <span className="wb-row__title">{node.title}</span>
                  {pathOf(node).length > 0 ? <span className="wb-row__path">{pathOf(node)}</span> : null}
                  <span className="wb-row__meta" data-testid={`wb-db-count-${node.id}`}>
                    {count === undefined
                      ? t('workbench.databaseRowsLoading')
                      : t('workbench.databaseRows').replace('{n}', String(count))}
                  </span>
                </button>
              </li>
            );
          })}
          {totalCount > DB_CARD_LIMIT ? (
            <li>
              <button
                type="button"
                className="wb-row wb-row--more"
                data-testid="wb-db-viewall"
                onClick={() => {
                  // §1.3：侧栏无「库」筛选分区（T64 红线不动 SidebarTree/scope）→ 回 pages 视图即可
                  workbenchActions.closeHome();
                }}
              >
                <span className="wb-row__title">{t('workbench.databaseViewAll')}</span>
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </WorkbenchCard>
  );
}

function RecentCard() {
  const nodes = usePages((state) => state.nodes);
  const recentIds = usePages((state) => state.recentIds);
  const byId = useMemo(() => nodeMap(nodes), [nodes]);
  const items = useMemo(
    () =>
      recentIds
        .slice(0, RECENT_CARD_LIMIT)
        .map((id) => byId.get(id))
        .filter((node): node is PageNodeView => node !== undefined && node.alive === 1),
    [recentIds, byId],
  );
  const formats = useMemo(
    () => ({
      now: t('workbench.relativeNow'),
      minutes: t('workbench.relativeMinutes'),
      hours: t('workbench.relativeHours'),
      days: t('workbench.relativeDays'),
    }),
    [],
  );
  return (
    <WorkbenchCard cardId="recent" title={t('workbench.cardRecent')}>
      {items.length === 0 ? (
        <p className="wb-empty" data-testid="wb-recent-empty">
          {t('workbench.recentEmpty')}
        </p>
      ) : (
        <ul className="wb-list">
          {items.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="wb-row"
                data-testid={`wb-recent-row-${node.id}`}
                onClick={() => {
                  openPageFromHome(node.id);
                }}
              >
                <Icon icon={Clock} size="sm" className="wb-row__icon" />
                <span className="wb-row__title">{node.title}</span>
                <span className="wb-row__meta">{formatRelativeTime(node.updatedAt ?? Date.now(), Date.now(), formats)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WorkbenchCard>
  );
}

function FavoritesCard() {
  const nodes = usePages((state) => state.nodes);
  const favoriteIds = usePages((state) => state.favoriteIds);
  const byId = useMemo(() => nodeMap(nodes), [nodes]);
  const items = useMemo(
    () =>
      favoriteIds
        .map((id) => byId.get(id))
        .filter((node): node is PageNodeView => node !== undefined && node.alive === 1),
    [favoriteIds, byId],
  );
  return (
    <WorkbenchCard cardId="favorites" title={t('workbench.cardFavorites')}>
      {items.length === 0 ? (
        <p className="wb-empty" data-testid="wb-favorites-empty">
          {t('workbench.favoritesEmpty')}
        </p>
      ) : (
        <ul className="wb-grid">
          {items.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="wb-row"
                data-testid={`wb-fav-row-${node.id}`}
                onClick={() => {
                  openPageFromHome(node.id);
                }}
              >
                <Icon icon={Star} size="sm" className="wb-row__icon" />
                <span className="wb-row__title">{node.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WorkbenchCard>
  );
}

const CARD_COMPONENTS: Record<WorkbenchCardId, ComponentType> = {
  quick: QuickCard,
  todo: TodoCard,
  database: DatabaseCard,
  recent: RecentCard,
  favorites: FavoritesCard,
};

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

export interface WorkbenchPageProps {
  onClose(): void;
}

/** 工作台视图（App 在 view==='home' 时挂在本组件位置替换编辑列）。 */
export function WorkbenchPage({ onClose }: WorkbenchPageProps) {
  const cardOrder = useWorkbench((state) => state.cardOrder);
  const hiddenCards = useWorkbench((state) => state.hiddenCards);

  // Esc 关闭回 pages（§3 红线：home 不得成为死角）。与说明书 ManualView 同款窗口级
  // keydown；卡菜单开着时 Esc 先关菜单（Menu 内 Esc 在 React 合成事件层 stopPropagation
  // 由 Menu 自身语义决定——最坏双关可接受，回 pages 仍是安全落点）。
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
          const Card = CARD_COMPONENTS[id];
          return (
            <div key={id} data-testid={`wb-slot-${id}`}>
              <Card />
            </div>
          );
        })}
      </div>
    </div>
  );
}
