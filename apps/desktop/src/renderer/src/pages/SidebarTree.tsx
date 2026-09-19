/**
 * SidebarTree.tsx —— 侧栏真树（TASK-T21-02 §0.1）。
 *
 * 数据全部来自 pagesStore：`nodes` 渲染页面树（点击行 selectPage、折叠三角
 * toggleExpand、active = selectedId）；「收藏」「最近」用 favoriteIds/recentIds
 * 经 nodes 解析（找不到/已删除的 id 跳过，为空显示空态行）；「新建页面」=
 * createPage(null)（store 内部已选中新页并进入重命名）；「回收站」=
 * showTrash()，再次点击 showPages() 回页面视图。
 * 行内重命名：双击行标题 → beginRename → 既有 editingId 输入框（Enter 提交 / Esc 取消）。
 * 视觉零新增：复用 App.css 的 app-side* 与 app-nav-* 类及 var(--sc-*) token，
 * 图标只从 @septcats/ui 出口取。
 */
import { useMemo, useState } from 'react';
import type {
  ComponentProps,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import type { PageNode } from '@septcats/editor';
import { CaretDown, CaretRight, Clock, DotsThree, FileText, FolderSimple, Icon, IconButton, Menu, Plus, Star, Trash } from '@septcats/ui';
import { aliveNodes, nodeMap, pagesActions, trashNodes, usePages } from '../state/pages';
import { templatesActions, useTemplates } from '../state/templates';
import { t } from '../i18n';
import { TemplateIcon } from '../templates/TemplateIcon';

/** 行缩进：与既有假树 TreeRow 同式（app-nav-row 的 paddingLeft）。 */
function indentStyle(depth: number): CSSProperties {
  return { paddingLeft: `calc(var(--sc-space-sm) + var(--sc-space-md) * ${String(depth)})` };
}

/** sortKey 升序、id 决胜（与 main 侧派生序一致）。 */
function bySortKey(a: PageNode, b: PageNode): number {
  if (a.sortKey !== b.sortKey) {
    return a.sortKey < b.sortKey ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

/** 收藏/最近分组展开态（本地视图态；store 的 expanded 只管页面树行）。 */
interface GroupOpen {
  favorites: boolean;
  recent: boolean;
}

/** 行内重命名输入框（最小实现：行内 input + 既有 token 样式）。 */
function RenameInput({ id, title }: { id: string; title: string }) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = event.currentTarget.value.trim();
      if (value.length > 0) {
        void pagesActions.renamePage(id, value);
      } else {
        pagesActions.cancelRename();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      pagesActions.cancelRename();
    }
  };
  return (
    <input
      className="app-nav-input"
      data-testid="side-rename-input"
      defaultValue={title}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onBlur={() => pagesActions.cancelRename()}
      aria-label={t('sidebar.renameAria')}
    />
  );
}

interface NavRowProps {
  testId?: string;
  label: string;
  icon: ComponentProps<typeof Icon>['icon'];
  depth?: number;
  active?: boolean;
  /** 分组标题行（T34-01：收藏/最近的小字弱化态，只动样式不改结构）。 */
  head?: boolean;
  /** 有子节点 → tw 槽渲染折叠三角（点击切展开，不冒泡到行选中）。 */
  branch?: boolean;
  open?: boolean;
  count?: number;
  /** 提供时替换标题文本槽（行内重命名的输入框走这里）。 */
  labelNode?: ReactNode;
  /** 提供时替换图标槽（T23-02：模板行携带数据 icon）。 */
  iconNode?: ReactNode;
  /** 提供时追加在行尾（margin-left:auto；T23-02「新建页面 ▾」的右侧箭头）。 */
  suffix?: ReactNode;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCaretClick?: (event: ReactMouseEvent<HTMLSpanElement>) => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

function NavRow({
  testId,
  label,
  icon,
  depth = 0,
  active = false,
  head = false,
  branch = false,
  open = false,
  count,
  labelNode,
  iconNode,
  suffix,
  onClick,
  onCaretClick,
  onDoubleClick,
}: NavRowProps) {
  const rowClass = head
    ? 'app-nav-row app-nav-row--head'
    : active
      ? 'app-nav-row app-nav-row--active'
      : 'app-nav-row';
  return (
    <div
      data-testid={testId}
      className={rowClass}
      style={indentStyle(depth)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className={open ? 'app-nav-tw app-nav-tw--open' : 'app-nav-tw'} onClick={onCaretClick}>
        {branch ? <Icon icon={CaretRight} size="sm" /> : null}
      </span>
      {iconNode ?? <Icon icon={icon} size="sm" className="app-nav-ic" />}
      {labelNode ?? <span className="app-nav-tx">{label}</span>}
      {count === undefined ? null : <span className="app-nav-count">{count}</span>}
      {suffix ?? null}
    </div>
  );
}

export function SidebarTree() {
  const nodes = usePages((state) => state.nodes);
  const expanded = usePages((state) => state.expanded);
  const selectedId = usePages((state) => state.selectedId);
  const editingId = usePages((state) => state.editingId);
  const favoriteIds = usePages((state) => state.favoriteIds);
  const recentIds = usePages((state) => state.recentIds);
  const view = usePages((state) => state.view);
  // T23-02 §C.1：「新建页面 ▾」模板子菜单展开态（本地视图态；列表订阅 templates slice）
  const [tplOpen, setTplOpen] = useState(false);
  // T24-01 §0.A：页面行「⋯」菜单展开态（本地视图态；每树同时至多一个）
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const templates = useTemplates((state) => state.templates);
  const [groupOpen, setGroupOpen] = useState<GroupOpen>({ favorites: false, recent: false });

  const byId = useMemo(() => nodeMap(nodes), [nodes]);

  /** 收藏/最近 → 存活页节点解析（找不到/已删除的 id 跳过）。 */
  const resolveGroup = (ids: readonly string[]): PageNode[] =>
    ids
      .map((id) => byId.get(id))
      .filter((node): node is PageNode => node !== undefined && node.alive === 1);

  const favoriteNodes = useMemo(() => resolveGroup(favoriteIds), [byId, favoriteIds]);
  const recentNodes = useMemo(() => resolveGroup(recentIds), [byId, recentIds]);
  const trashCount = useMemo(() => trashNodes(nodes).length, [nodes]);

  /** 可见树行：roots 按 sortKey 序；展开的节点下钻 alive 子行（childIds 已排序）。 */
  const visibleTree = useMemo(() => {
    const rows: PageNode[] = [];
    const walk = (node: PageNode): void => {
      rows.push(node);
      if (!expanded.has(node.id)) {
        return;
      }
      for (const childId of node.childIds) {
        const child = byId.get(childId);
        if (child !== undefined && child.alive === 1) {
          walk(child);
        }
      }
    };
    for (const root of aliveNodes(nodes).filter((node) => node.parentId === null).sort(bySortKey)) {
      walk(root);
    }
    return rows;
  }, [nodes, expanded, byId]);

  const toggleGroup = (key: keyof GroupOpen): void => {
    setGroupOpen((current) => ({ ...current, [key]: !current[key] }));
  };

  const renderGroupRows = (
    key: keyof GroupOpen,
    label: string,
    icon: ComponentProps<typeof Icon>['icon'],
    group: PageNode[],
    emptyText: string,
  ): ReactNode => {
    const open = groupOpen[key];
    const rows: ReactNode[] = [
      <NavRow
        key={key}
        testId={`side-${key}`}
        label={label}
        icon={icon}
        head
        count={group.length}
        onClick={() => toggleGroup(key)}
      />,
    ];
    if (!open) {
      return rows;
    }
    if (group.length === 0) {
      rows.push(
        <div key={`${key}-empty`} className="app-nav-empty" style={indentStyle(1)}>
          {emptyText}
        </div>,
      );
      return rows;
    }
    group.forEach((node, index) => {
      rows.push(
        <NavRow
          key={`${key}-${node.id}`}
          testId={`side-${key}-item-${String(index)}`}
          label={node.title}
          icon={FileText}
          depth={1}
          active={selectedId === node.id}
          onClick={() => pagesActions.selectPage(node.id)}
        />,
      );
    });
    return rows;
  };

  return (
    <div className="app-side">
      <div className="app-side-head">
        <Icon icon={FolderSimple} size="sm" />
        {t('sidebar.workspace')}
      </div>
      <div className="app-side-scroll">
        {/* T23-02 §C.1：主体点击仍 = 新建空白页；右侧箭头展开模板子菜单 */}
        <NavRow
          testId="side-new-page"
          label={t('commands.page.new')}
          icon={Plus}
          onClick={() => {
            void pagesActions.createPage(null);
          }}
          suffix={
            <span
              className="app-nav-suffix"
              data-testid="side-new-page-arrow"
              role="button"
              aria-expanded={tplOpen}
              aria-label={t('sidebar.createFromAria')}
              onClick={(event) => {
                event.stopPropagation();
                const next = !tplOpen;
                setTplOpen(next);
                if (next) {
                  void templatesActions.loadTemplates();
                }
              }}
            >
              <Icon icon={CaretDown} size="sm" />
            </span>
          }
        />
        {tplOpen
          ? templates.length === 0
            ? (
              <div className="app-nav-empty" style={indentStyle(1)} data-testid="side-tpl-empty">
                {t('templates.empty')}
              </div>
            )
            : templates.map((template, index) => (
              <NavRow
                key={template.id}
                testId={`side-tpl-item-${String(index)}`}
                label={template.title}
                icon={FileText}
                iconNode={<TemplateIcon template={template} className="app-nav-ic" />}
                depth={1}
                onClick={() => {
                  setTplOpen(false);
                  void templatesActions.createFromTemplate(template.id);
                }}
              />
            ))
          : null}
        {renderGroupRows('favorites', t('sidebar.favorites'), Star, favoriteNodes, t('sidebar.emptyFavorites'))}
        {renderGroupRows('recent', t('sidebar.recent'), Clock, recentNodes, t('sidebar.emptyRecent'))}
        {visibleTree.map((node) => {
          const childCount = node.childIds.filter((childId) => byId.get(childId)?.alive === 1).length;
          const isEditing = editingId === node.id;
          return (
            <NavRow
              key={node.id}
              testId={`side-node-${node.id}`}
              label={node.title}
              icon={node.depth === 0 ? FolderSimple : FileText}
              depth={node.depth}
              active={selectedId === node.id}
              branch={childCount > 0}
              open={expanded.has(node.id)}
              labelNode={
                isEditing ? <RenameInput id={node.id} title={node.title} /> : undefined
              }
              onClick={() => pagesActions.selectPage(node.id)}
              onCaretClick={(event) => {
                event.stopPropagation();
                pagesActions.toggleExpand(node.id);
              }}
              onDoubleClick={() => pagesActions.beginRename(node.id)}
              suffix={
                // T24-01 §0.A：行「⋯」菜单（hover/选中时露出，见 .app-nav-more-wrap）；
                // 点击不冒泡到行选中；「删除」→ 既有二次确认弹层（PageDeleteDialog）
                <span
                  className={
                    rowMenuId === node.id
                      ? 'app-nav-more-wrap app-nav-more-wrap--open'
                      : 'app-nav-more-wrap'
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <IconButton
                    icon={DotsThree}
                    label={t('sidebar.pageActions')}
                    data-testid={`side-more-${node.id}`}
                    aria-expanded={rowMenuId === node.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRowMenuId((current) => (current === node.id ? null : node.id));
                    }}
                  />
                  {rowMenuId === node.id ? (
                    <Menu
                      className="app-nav-menu"
                      label={t('sidebar.pageActions')}
                      items={[{ id: 'delete', label: t('common.delete'), danger: true }]}
                      onSelect={(action) => {
                        setRowMenuId(null);
                        if (action === 'delete') {
                          pagesActions.requestDeletePage(node.id);
                        }
                      }}
                      onDismiss={() => {
                        setRowMenuId(null);
                      }}
                    />
                  ) : null}
                </span>
              }
            />
          );
        })}
      </div>
      <div
        className={view === 'trash' ? 'app-side-foot app-side-foot--active' : 'app-side-foot'}
        data-testid="side-trash"
        onClick={() => {
          if (view === 'trash') {
            pagesActions.showPages();
          } else {
            pagesActions.showTrash();
          }
        }}
      >
        <Icon icon={Trash} size="sm" />
        {t('sidebar.trash')}
        {trashCount > 0 ? <span className="app-nav-count">{trashCount}</span> : null}
      </div>
    </div>
  );
}
