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
import { CaretRight, Clock, FileText, FolderSimple, Icon, Plus, Star, Trash } from '@septcats/ui';
import { aliveNodes, nodeMap, pagesActions, trashNodes, usePages } from '../state/pages';

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
      aria-label="重命名页面"
    />
  );
}

interface NavRowProps {
  testId?: string;
  label: string;
  icon: ComponentProps<typeof Icon>['icon'];
  depth?: number;
  active?: boolean;
  /** 有子节点 → tw 槽渲染折叠三角（点击切展开，不冒泡到行选中）。 */
  branch?: boolean;
  open?: boolean;
  count?: number;
  /** 提供时替换标题文本槽（行内重命名的输入框走这里）。 */
  labelNode?: ReactNode;
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
  branch = false,
  open = false,
  count,
  labelNode,
  onClick,
  onCaretClick,
  onDoubleClick,
}: NavRowProps) {
  return (
    <div
      data-testid={testId}
      className={active ? 'app-nav-row app-nav-row--active' : 'app-nav-row'}
      style={indentStyle(depth)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className={open ? 'app-nav-tw app-nav-tw--open' : 'app-nav-tw'} onClick={onCaretClick}>
        {branch ? <Icon icon={CaretRight} size="sm" /> : null}
      </span>
      <Icon icon={icon} size="sm" className="app-nav-ic" />
      {labelNode ?? <span className="app-nav-tx">{label}</span>}
      {count === undefined ? null : <span className="app-nav-count">{count}</span>}
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
        个人工作区
      </div>
      <div className="app-side-scroll">
        <NavRow
          testId="side-new-page"
          label="新建页面"
          icon={Plus}
          onClick={() => {
            void pagesActions.createPage(null);
          }}
        />
        {renderGroupRows('favorites', '收藏', Star, favoriteNodes, '暂无收藏')}
        {renderGroupRows('recent', '最近', Clock, recentNodes, '暂无最近')}
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
        回收站
        {trashCount > 0 ? <span className="app-nav-count">{trashCount}</span> : null}
      </div>
    </div>
  );
}
