/**
 * cards.tsx —— 工作台卡片注册表（TASK-T71-01 §1/§2）。
 *
 * 注册表驱动：内置 5 卡迁入（行为零变，T66 探针零回归）+ 6 新原子卡。
 * 卡壳复用 `WorkbenchCard`；每卡 = 一份 `WorkbenchCardDef { id, labelKey, descKey,
 * defaultSize?, render(api) }`，render 返回卡体（壳由 WorkbenchPage 统一包）。
 *
 * 数据主权（§1 原则）：新卡数据全走 settings localStorage 守卫 `septcats.wbcard.<key>`
 * （或只读 tree 缓存），无新表 / 无新 IPC。热力写点唯一 = activity.bumpActivityToday()，
 * 由 pages/PageView.tsx 编辑提交防抖处调用。
 *
 * 红线：main/preload/shared/ipc/SCHEMA 零改动。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, Circle, Clock, FolderSimple, Icon, Note, PixelTodoGlyph, Plus, Star, X } from '@septcats/ui';
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
import { workbenchActions, type WorkbenchCardId } from './state';
import { WorkbenchPixelButton } from './WorkbenchCard';
import {
  addTodo,
  countDbRows,
  createDailyNote,
  formatRelativeTime,
  readTodos,
  removeTodo,
  toggleTodo,
  writeTodos,
  type TodoItem,
} from './work';
import { normalizeHeatmap, readActivityDays, type HeatCell } from './activity';

// ---------------------------------------------------------------------------
// CardApi：注入卡的最小能力面（§1）
// ---------------------------------------------------------------------------

export interface CardApi {
  /** 关 home 后打开某页（回到 pages 视图并选中/开页签）。 */
  openPage(id: string): void;
  /** i18n 取词（注入避免卡体直接依赖全局 t，保持注册表可独立测）。 */
  t(key: string): string;
  /** settings 读写：localStorage JSON 守卫，键 = `septcats.wbcard.<key>`。 */
  settings: {
    read<T>(key: string, def: T): T;
    write<T>(key: string, val: T): void;
  };
}

export interface WorkbenchCardDef {
  id: WorkbenchCardId;
  /** 卡标题 i18n 键。 */
  labelKey: string;
  /** 卡目录说明 i18n 键。 */
  descKey: string;
  /** 默认尺寸档（v2 sizes 缺省；UI 暂不提供改尺寸控件，预留）。 */
  defaultSize?: 'sm' | 'md' | 'lg';
  /** 渲染卡体（壳由 WorkbenchPage 统一包）。 */
  render: (api: CardApi) => ReactNode;
}

// ---------------------------------------------------------------------------
// settings 守卫读写（septcats.wbcard.<key>）
// ---------------------------------------------------------------------------

const WBCARD_PREFIX = 'septcats.wbcard.';

function safeGetItem(key: string): string | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage === undefined) {
      return null;
    }
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    storage?.setItem(key, value);
  } catch {
    // 写失败（配额/隐私模式）：仅本会话生效
  }
}

/** 读 settings（野 JSON / 损坏 → def）。 */
export function wbcardRead<T>(key: string, def: T): T {
  const raw = safeGetItem(WBCARD_PREFIX + key);
  if (raw === null) {
    return def;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

/** 写 settings（JSON 守卫，失败静默）。 */
export function wbcardWrite<T>(key: string, val: T): void {
  safeSetItem(WBCARD_PREFIX + key, JSON.stringify(val));
}

// ---------------------------------------------------------------------------
// 共享桥（从 WorkbenchPage 迁来，保持 5 卡行为零变）
// ---------------------------------------------------------------------------

function septcatsApi(): SeptcatsApi | undefined {
  return (globalThis as { septcats?: SeptcatsApi }).septcats;
}

/** 关闭 home 后打开某页（§1.3：点行 = 回 pages 并打开）。 */
export function openPageFromHome(id: string): void {
  workbenchActions.closeHome();
  pagesActions.openInTab(id);
}

/** 新建库页（db.create → refresh → 回 pages 打开）。 */
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

// ===========================================================================
// 内置 5 卡（迁入注册表；DOM/testid 与 T66 探针逐格一致）
// ===========================================================================

function QuickCardBody() {
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
  );
}

function TodoCardBody() {
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
    <>
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
    </>
  );
}

/** 存活 database 页（与 main 侧 dbPageIds 判定同口径）。 */
export function aliveDatabaseNodes(nodes: readonly PageNodeView[]): PageNodeView[] {
  return nodes.filter((node) => node.alive === 1 && pageTypeOf(node) === 'database');
}

function DatabaseCardBody() {
  const nodesRaw = usePages((state) => state.nodes);
  const nodes = nodesRaw ?? [];
  const shown = useMemo(() => aliveDatabaseNodes(nodes).slice(0, 12), [nodes]);
  const totalCount = usePages((state) => aliveDatabaseNodes(state.nodes ?? []).length);
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
    <div className="wb-database">
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
          {totalCount > 12 ? (
            <li>
              <button
                type="button"
                className="wb-row wb-row--more"
                data-testid="wb-db-viewall"
                onClick={() => {
                  workbenchActions.closeHome();
                }}
              >
                <span className="wb-row__title">{t('workbench.databaseViewAll')}</span>
              </button>
            </li>
          ) : null}
        </ul>
      )}
      <WorkbenchPixelButton
        label={t('workbench.databaseNew')}
        onClick={createDatabase}
        testId="wb-db-new"
      />
    </div>
  );
}

function RecentCardBody() {
  const nodesRaw = usePages((state) => state.nodes);
  const recentIdsRaw = usePages((state) => state.recentIds);
  const nodes = nodesRaw ?? [];
  const recentIds = recentIdsRaw ?? [];
  const byId = useMemo(() => nodeMap(nodes), [nodes]);
  const items = useMemo(
    () =>
      recentIds
        .slice(0, 8)
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
  if (items.length === 0) {
    return (
      <p className="wb-empty" data-testid="wb-recent-empty">
        {t('workbench.recentEmpty')}
      </p>
    );
  }
  return (
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
            <span className="wb-row__meta">
              {formatRelativeTime(node.updatedAt ?? Date.now(), Date.now(), formats)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FavoritesCardBody() {
  const nodesRaw = usePages((state) => state.nodes);
  const favoriteIdsRaw = usePages((state) => state.favoriteIds);
  const nodes = nodesRaw ?? [];
  const favoriteIds = favoriteIdsRaw ?? [];
  const byId = useMemo(() => nodeMap(nodes), [nodes]);
  const items = useMemo(
    () =>
      favoriteIds
        .map((id) => byId.get(id))
        .filter((node): node is PageNodeView => node !== undefined && node.alive === 1),
    [favoriteIds, byId],
  );
  if (items.length === 0) {
    return (
      <p className="wb-empty" data-testid="wb-favorites-empty">
        {t('workbench.favoritesEmpty')}
      </p>
    );
  }
  return (
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
  );
}

// ===========================================================================
// 新 6 卡（T71-01 §2）
// ===========================================================================

// --- shortcut：已选页面快捷方式（settings shortcut.links: [{pageId}]） ---

interface ShortcutLink {
  pageId: string;
}

function sanitizeShortcutLinks(value: unknown): ShortcutLink[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: ShortcutLink[] = [];
  for (const item of value) {
    if (typeof item === 'object' && item !== null && typeof (item as { pageId?: unknown }).pageId === 'string') {
      const pageId = (item as { pageId: string }).pageId;
      if (pageId.length > 0 && !seen.has(pageId)) {
        seen.add(pageId);
        out.push({ pageId });
      }
    }
  }
  return out;
}

function ShortcutCardBody({ api }: { api: CardApi }) {
  const [links, setLinks] = useState<ShortcutLink[]>(() => sanitizeShortcutLinks(wbcardRead('shortcut.links', [])));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const nodesRaw = usePages((state) => state.nodes);
  const nodes = nodesRaw ?? [];
  const byId = useMemo(() => nodeMap(nodes), [nodes]);

  const commit = useCallback(
    (next: ShortcutLink[]): void => {
      setLinks(next);
      api.settings.write('shortcut.links', next);
    },
    [api],
  );

  const addLink = useCallback(
    (pageId: string): void => {
      if (links.some((link) => link.pageId === pageId)) {
        setPickerOpen(false);
        setQuery('');
        return;
      }
      commit([...links, { pageId }]);
      setPickerOpen(false);
      setQuery('');
    },
    [links, commit],
  );

  const removeLink = useCallback(
    (pageId: string): void => {
      commit(links.filter((link) => link.pageId !== pageId));
    },
    [links, commit],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes
      .filter((node) => node.alive === 1 && (q.length === 0 || node.title.toLowerCase().includes(q)))
      .filter((node) => !links.some((link) => link.pageId === node.id))
      .slice(0, 20);
  }, [nodes, query, links]);

  return (
    <div className="wb-shortcut" data-testid="wb-shortcut">
      {links.length === 0 && !pickerOpen ? (
        <p className="wb-empty" data-testid="wb-shortcut-empty">
          {api.t('workbench.shortcutEmpty')}
        </p>
      ) : null}
      <ul className="wb-list">
        {links.map((link) => {
          const node = byId.get(link.pageId);
          return (
            <li key={link.pageId} data-testid={`wb-shortcut-item-${link.pageId}`}>
              <button
                type="button"
                className="wb-row"
                onClick={() => {
                  api.openPage(link.pageId);
                }}
              >
                <span className="wb-row__title">{node?.title ?? api.t('workbench.shortcutMissing')}</span>
              </button>
              <button
                type="button"
                className="wb-row__del"
                aria-label={api.t('workbench.shortcutRemove')}
                data-testid={`wb-shortcut-remove-${link.pageId}`}
                onClick={() => {
                  removeLink(link.pageId);
                }}
              >
                <Icon icon={X} size="sm" />
              </button>
            </li>
          );
        })}
      </ul>
      {pickerOpen ? (
        <div className="wb-picker" data-testid="wb-shortcut-picker" role="dialog" aria-label={api.t('workbench.shortcutPicker')}>
          <input
            className="wb-picker__input"
            value={query}
            autoFocus
            placeholder={api.t('workbench.shortcutSearch')}
            aria-label={api.t('workbench.shortcutSearch')}
            data-testid="wb-shortcut-picker-input"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setPickerOpen(false);
                setQuery('');
              }
            }}
          />
          <ul className="wb-picker__list">
            {candidates.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="wb-row"
                  data-testid={`wb-shortcut-pick-${node.id}`}
                  onClick={() => {
                    addLink(node.id);
                  }}
                >
                  <span className="wb-row__title">{node.title}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 ? (
              <li>
                <span className="wb-empty">{api.t('workbench.shortcutNoMatch')}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <WorkbenchPixelButton
          label={api.t('workbench.shortcutAdd')}
          glyph={<Icon icon={Plus} size="sm" />}
          onClick={() => {
            setPickerOpen(true);
          }}
          testId="wb-shortcut-add"
        />
      )}
    </div>
  );
}

// --- countdown：倒计时（settings countdown.items: [{label,date}]） ---

interface CountdownItem {
  label: string;
  date: string;
}

function sanitizeCountdownItems(value: unknown): CountdownItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CountdownItem[] = [];
  for (const item of value) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { label?: unknown }).label === 'string' &&
      typeof (item as { date?: unknown }).date === 'string'
    ) {
      const label = (item as { label: string }).label;
      const date = (item as { date: string }).date;
      if (label.length > 0 && date.length > 0) {
        out.push({ label, date });
      }
    }
  }
  return out;
}

/** 纯函数：距目标日天数（本地零点差，向下取整；date 非法 → null）。 */
export function daysUntil(date: string, now: Date = new Date()): number | null {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = target.getTime() - base.getTime();
  return Math.floor(ms / 86_400_000);
}

function CountdownCardBody({ api }: { api: CardApi }) {
  const [items, setItems] = useState<CountdownItem[]>(() => sanitizeCountdownItems(wbcardRead('countdown.items', [])));
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');

  const commit = useCallback(
    (next: CountdownItem[]): void => {
      setItems(next);
      api.settings.write('countdown.items', next);
    },
    [api],
  );

  const onAdd = useCallback((): void => {
    const trimmed = label.trim();
    if (trimmed.length === 0 || date.trim().length === 0) {
      return;
    }
    commit([...items, { label: trimmed, date: date.trim() }]);
    setLabel('');
    setDate('');
    setAdding(false);
  }, [items, label, date, commit]);

  const removeItem = useCallback(
    (index: number): void => {
      commit(items.filter((_, i) => i !== index));
    },
    [items, commit],
  );

  return (
    <div className="wb-countdown" data-testid="wb-countdown">
      {items.length === 0 && !adding ? (
        <p className="wb-empty" data-testid="wb-countdown-empty">
          {api.t('workbench.countdownEmpty')}
        </p>
      ) : null}
      <ul className="wb-list">
        {items.map((item, index) => {
          const days = daysUntil(item.date);
          const invalid = days === null;
          return (
            <li key={`${item.label}-${String(index)}`} data-testid={`wb-countdown-item-${String(index)}`}>
              <button
                type="button"
                className={invalid ? 'wb-row wb-row--danger' : 'wb-row'}
                aria-invalid={invalid}
                data-testid={`wb-countdown-days-${String(index)}`}
              >
                <span className="wb-row__title">{item.label}</span>
                <span className="wb-row__meta">
                  {invalid
                    ? api.t('workbench.countdownInvalid')
                    : api.t('workbench.countdownDays').replace('{n}', String(days))}
                </span>
              </button>
              <button
                type="button"
                className="wb-row__del"
                aria-label={api.t('workbench.countdownRemove')}
                data-testid={`wb-countdown-remove-${String(index)}`}
                onClick={() => {
                  removeItem(index);
                }}
              >
                <Icon icon={X} size="sm" />
              </button>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="wb-form" data-testid="wb-countdown-form">
          <input
            className="wb-form__input"
            value={label}
            placeholder={api.t('workbench.countdownLabel')}
            aria-label={api.t('workbench.countdownLabel')}
            data-testid="wb-countdown-input-label"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
          <input
            className="wb-form__input"
            type="text"
            value={date}
            placeholder="YYYY-MM-DD"
            aria-label={api.t('workbench.countdownDate')}
            data-testid="wb-countdown-input-date"
            onChange={(event) => {
              setDate(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAdd();
              }
            }}
          />
          <button
            type="button"
            className="wb-pixbtn"
            data-testid="wb-countdown-submit"
            onClick={onAdd}
          >
            {api.t('workbench.countdownSubmit')}
          </button>
        </div>
      ) : (
        <WorkbenchPixelButton
          label={api.t('workbench.countdownAdd')}
          glyph={<Icon icon={Plus} size="sm" />}
          onClick={() => {
            setAdding(true);
          }}
          testId="wb-countdown-add"
        />
      )}
    </div>
  );
}

// --- heatmap：近 7 日活跃（settings activity.days，写点唯一见 activity.ts） ---

function HeatmapCardBody({ api }: { api: CardApi }) {
  const [cells, setCells] = useState<HeatCell[]>(() => normalizeHeatmap(readActivityDays(), new Date()));
  useEffect(() => {
    setCells(normalizeHeatmap(readActivityDays(), new Date()));
  }, []);
  return (
    <div className="wb-heatmap" data-testid="wb-heatmap">
      <div className="wb-heatmap__grid">
        {cells.map((cell) => (
          <span
            key={cell.date}
            className={`wb-heat wb-heat--${String(cell.level)}`}
            data-testid={`wb-heatmap-cell-${cell.date}`}
            data-level={String(cell.level)}
            data-count={String(cell.count)}
            title={`${cell.date}: ${String(cell.count)}`}
            aria-label={`${cell.date}: ${String(cell.count)}`}
          />
        ))}
      </div>
      <p className="wb-empty">{api.t('workbench.heatmapHint')}</p>
    </div>
  );
}

// --- quote：引用摘抄（读最近 3 页首个 text 块，点击 openPage 定位） ---

/** 纯函数：从 Block content（PM doc | string | null）取首个非空文本。 */
export function firstTextOfBlock(content: unknown): string | null {
  const extract = (node: unknown): string | null => {
    if (typeof node === 'string') {
      return node.length > 0 ? node : null;
    }
    if (typeof node !== 'object' || node === null) {
      return null;
    }
    const obj = node as { text?: unknown; content?: unknown };
    if (typeof obj.text === 'string' && obj.text.length > 0) {
      return obj.text;
    }
    if (Array.isArray(obj.content)) {
      for (const child of obj.content) {
        const found = extract(child);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  };
  return extract(content);
}

interface Quote {
  pageId: string;
  text: string;
}

function QuoteCardBody({ api }: { api: CardApi }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const api2 = septcatsApi();
    const recentIds = pagesStore.getState().recentIds.slice(0, 3);
    if (api2 === undefined || recentIds.length === 0) {
      setLoading(false);
      return;
    }
    void Promise.all(
      recentIds.map(async (pageId) => {
        try {
          const { blocks } = await api2.blocks.list({ pageId });
          for (const block of blocks) {
            const text = firstTextOfBlock(block.content);
            if (text !== null && text.trim().length > 0) {
              return { pageId, text: text.trim() };
            }
          }
        } catch {
          // 单页读失败 → 跳过（不阻断整卡）
        }
        return null;
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const found = results.filter((item): item is Quote => item !== null);
      if (found.length === 0) {
        setQuote(null);
      } else {
        // 随机抽一页（found.length≥1，下标恒在界内；仅有 1 条时确定）
        const picked = found[Math.floor(Math.random() * found.length)] as Quote;
        setQuote(picked);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="wb-quote" data-testid="wb-quote">
        <p className="wb-empty">{api.t('workbench.quoteLoading')}</p>
      </div>
    );
  }
  if (quote === null) {
    return (
      <div className="wb-quote" data-testid="wb-quote">
        <p className="wb-empty" data-testid="wb-quote-empty">
          {api.t('workbench.quoteEmpty')}
        </p>
      </div>
    );
  }
  return (
    <div className="wb-quote" data-testid="wb-quote">
      <button
        type="button"
        className="wb-quote__text"
        data-testid="wb-quote-text"
        onClick={() => {
          api.openPage(quote.pageId);
        }}
      >
        {quote.text}
      </button>
    </div>
  );
}

// --- bookmarks：链接收藏（settings bookmarks.list: [{url,title}]） ---
// T73-01：条目有 URL 时点击经 `window.septcats.shell.openExternal` 跳系统浏览器
// （main 侧协议白名单护栏）；失败（含协议拒绝）给 toast。收藏/取消交互不变。

interface Bookmark {
  url: string;
  title: string;
}

function sanitizeBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: Bookmark[] = [];
  for (const item of value) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { url?: unknown }).url === 'string'
    ) {
      const url = (item as { url: string }).url;
      if (url.length > 0 && !seen.has(url)) {
        seen.add(url);
        const rawTitle = (item as { title?: unknown }).title;
        out.push({ url, title: typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : url });
      }
    }
  }
  return out;
}

const URL_RE = /^https?:\/\//;

function BookmarksCardBody({ api }: { api: CardApi }) {
  const [items, setItems] = useState<Bookmark[]>(() => sanitizeBookmarks(wbcardRead('bookmarks.list', [])));
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const commit = useCallback(
    (next: Bookmark[]): void => {
      setItems(next);
      api.settings.write('bookmarks.list', next);
    },
    [api],
  );

  const onAdd = useCallback((): void => {
    const trimmed = url.trim();
    if (!URL_RE.test(trimmed)) {
      pushToast(api.t('workbench.bookmarkBadUrl'), 'danger');
      return;
    }
    commit([...items, { url: trimmed, title: title.trim().length > 0 ? title.trim() : trimmed }]);
    setUrl('');
    setTitle('');
    setAdding(false);
  }, [items, url, title, commit, api]);

  const removeItem = useCallback(
    (target: string): void => {
      commit(items.filter((item) => item.url !== target));
    },
    [items, commit],
  );

  /** T73-01：跳系统浏览器（失败/协议拒绝 → toast）。桥未接时静默（降级态不误报）。 */
  const openBookmark = useCallback(
    (target: string): void => {
      const shellApi = septcatsApi()?.shell;
      if (shellApi === undefined) {
        return;
      }
      const failed = (): void => {
        pushToast(api.t('workbench.bookmarkOpenFailed'), 'danger');
      };
      void shellApi.openExternal({ url: target }).then((result) => {
        if (!result.ok) {
          failed();
        }
      }, failed);
    },
    [api],
  );

  return (
    <div className="wb-bookmarks" data-testid="wb-bookmarks">
      {items.length === 0 && !adding ? (
        <p className="wb-empty" data-testid="wb-bookmarks-empty">
          {api.t('workbench.bookmarksEmpty')}
        </p>
      ) : null}
      <ul className="wb-list">
        {items.map((item) => (
          <li key={item.url} data-testid={`wb-bookmarks-item-${item.url}`}>
            <button
              type="button"
              className="wb-row"
              data-testid={`wb-bookmarks-open-${item.url}`}
              onClick={() => {
                openBookmark(item.url);
              }}
            >
              <span className="wb-row__title">{item.title}</span>
            </button>
            <button
              type="button"
              className="wb-row__del"
              aria-label={api.t('workbench.bookmarkRemove')}
              data-testid={`wb-bookmarks-remove-${item.url}`}
              onClick={() => {
                removeItem(item.url);
              }}
            >
              <Icon icon={X} size="sm" />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="wb-form" data-testid="wb-bookmarks-form">
          <input
            className="wb-form__input"
            value={url}
            placeholder={api.t('workbench.bookmarkUrl')}
            aria-label={api.t('workbench.bookmarkUrl')}
            data-testid="wb-bookmarks-input-url"
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
          <input
            className="wb-form__input"
            value={title}
            placeholder={api.t('workbench.bookmarkTitle')}
            aria-label={api.t('workbench.bookmarkTitle')}
            data-testid="wb-bookmarks-input-title"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAdd();
              }
            }}
          />
          <button type="button" className="wb-pixbtn" data-testid="wb-bookmarks-submit" onClick={onAdd}>
            {api.t('workbench.bookmarkSubmit')}
          </button>
        </div>
      ) : (
        <WorkbenchPixelButton
          label={api.t('workbench.bookmarkAdd')}
          glyph={<Icon icon={Plus} size="sm" />}
          onClick={() => {
            setAdding(true);
          }}
          testId="wb-bookmarks-add"
        />
      )}
    </div>
  );
}

// --- libstats：库统计（纯聚合 tree 缓存，零 IPC） ---

export interface LibStats {
  pageCount: number;
  maxDepth: number;
  dbCount: number;
  favCount: number;
}

/** 纯函数：聚合当前库页统计（存活页总数 / 最深子树深度 / database 页数 / 收藏数）。 */
export function computeLibStats(nodes: readonly PageNodeView[], favoriteIds: readonly string[]): LibStats {
  const alive = nodes.filter((node) => node.alive === 1);
  const pageCount = alive.length;
  const dbCount = alive.filter((node) => pageTypeOf(node) === 'database').length;
  const byId = nodeMap(alive);
  let maxDepth = 0;
  for (const node of alive) {
    let depth = 0;
    let cursor: PageNodeView | undefined = node;
    const guard = new Set<string>();
    while (cursor !== undefined && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      depth += 1;
      const parentId: string | null = cursor.parentId;
      cursor = parentId === null ? undefined : byId.get(parentId);
    }
    maxDepth = Math.max(maxDepth, depth);
  }
  const favSet = new Set(favoriteIds);
  const favCount = alive.filter((node) => favSet.has(node.id)).length;
  return { pageCount, maxDepth, dbCount, favCount };
}

function LibStatsCardBody({ api }: { api: CardApi }) {
  const nodesRaw = usePages((state) => state.nodes);
  const favoriteIdsRaw = usePages((state) => state.favoriteIds);
  const nodes = nodesRaw ?? [];
  const favoriteIds = favoriteIdsRaw ?? [];
  const stats = useMemo(() => computeLibStats(nodes, favoriteIds), [nodes, favoriteIds]);
  const cells: Array<{ key: string; value: number; testId: string }> = [
    { key: api.t('workbench.libstatsPages'), value: stats.pageCount, testId: 'wb-libstats-pages' },
    { key: api.t('workbench.libstatsDepth'), value: stats.maxDepth, testId: 'wb-libstats-depth' },
    { key: api.t('workbench.libstatsDb'), value: stats.dbCount, testId: 'wb-libstats-db' },
    { key: api.t('workbench.libstatsFav'), value: stats.favCount, testId: 'wb-libstats-fav' },
  ];
  return (
    <div className="wb-libstats" data-testid="wb-libstats">
      <ul className="wb-grid">
        {cells.map((cell) => (
          <li key={cell.testId} className="wb-stat" data-testid={cell.testId}>
            <span className="wb-stat__value">{String(cell.value)}</span>
            <span className="wb-stat__label">{cell.key}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// 注册表（id 全集 = state.ts ALL_CARD_IDS）
// ===========================================================================

export const CARD_DEFS: Record<WorkbenchCardId, WorkbenchCardDef> = {
  quick: { id: 'quick', labelKey: 'workbench.cardQuick', descKey: 'workbench.cardQuickDesc', render: () => <QuickCardBody /> },
  todo: { id: 'todo', labelKey: 'workbench.cardTodo', descKey: 'workbench.cardTodoDesc', render: () => <TodoCardBody /> },
  database: { id: 'database', labelKey: 'workbench.cardDatabase', descKey: 'workbench.cardDatabaseDesc', render: () => <DatabaseCardBody /> },
  recent: { id: 'recent', labelKey: 'workbench.cardRecent', descKey: 'workbench.cardRecentDesc', render: () => <RecentCardBody /> },
  favorites: { id: 'favorites', labelKey: 'workbench.cardFavorites', descKey: 'workbench.cardFavoritesDesc', render: () => <FavoritesCardBody /> },
  shortcut: { id: 'shortcut', labelKey: 'workbench.cardShortcut', descKey: 'workbench.cardShortcutDesc', render: (api) => <ShortcutCardBody api={api} /> },
  countdown: { id: 'countdown', labelKey: 'workbench.cardCountdown', descKey: 'workbench.cardCountdownDesc', render: (api) => <CountdownCardBody api={api} /> },
  heatmap: { id: 'heatmap', labelKey: 'workbench.cardHeatmap', descKey: 'workbench.cardHeatmapDesc', render: (api) => <HeatmapCardBody api={api} /> },
  quote: { id: 'quote', labelKey: 'workbench.cardQuote', descKey: 'workbench.cardQuoteDesc', render: (api) => <QuoteCardBody api={api} /> },
  bookmarks: { id: 'bookmarks', labelKey: 'workbench.cardBookmarks', descKey: 'workbench.cardBookmarksDesc', render: (api) => <BookmarksCardBody api={api} /> },
  libstats: { id: 'libstats', labelKey: 'workbench.cardLibstats', descKey: 'workbench.cardLibstatsDesc', render: (api) => <LibStatsCardBody api={api} /> },
};

/** 注册表派生：全部卡 id（= ALL_CARD_IDS，供目录/校验复用）。 */
export const REGISTERED_CARD_IDS: readonly WorkbenchCardId[] = Object.keys(CARD_DEFS) as WorkbenchCardId[];
