/**
 * SidebarTree.tsx —— 侧栏真树（TASK-T21-02 §0.1）。
 *
 * 数据全部来自 pagesStore：`nodes` 渲染页面树（点击行 selectPage、折叠三角
 * toggleExpand、active = selectedId）；「收藏」「最近」用 favoriteIds/recentIds
 * 经 nodes 解析（找不到/已删除的 id 跳过，为空显示空态行）；「新建页面」=
 * createPage(null)（store 内部已选中新页并进入重命名）；「回收站」=
 * showTrash()，再次点击 showPages() 回页面视图。
 * 行内重命名：双击行标题 → beginRename → 既有 editingId 输入框
 * （Enter 提交 / Esc 取消 / **失焦提交**，T51-01：点别处不再吞掉改名）。
 * 视觉零新增：复用 App.css 的 app-side* 与 app-nav-* 类及 var(--sc-*) token，
 * 图标只从 @septcats/ui 出口取。
 */
import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import type {
  ComponentProps,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import type { PageNode } from '@septcats/editor';
import { CaretDown, CaretRight, Clock, DotsThree, FileText, FolderSimple, Icon, IconButton, Menu, Note, Plus, Star, Trash } from '@septcats/ui';
import type { MenuEntry } from '@septcats/ui';
import type { PageNodeView } from '../../../types/window';
import { aliveNodes, ancestorsOf, nodeMap, pageTypeOf, pagesActions, trashNodes, usePages } from '../state/pages';
import { registerFlushTask } from '../state/flushRegistry';
import { pageWidthActions, usePageWidth } from '../state/pageWidth';
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

/** 收藏/最近/Wiki 分组展开态（本地视图态；store 的 expanded 只管页面树行）。 */
interface GroupOpen {
  favorites: boolean;
  recent: boolean;
  /** T42-01：Wiki 分区（默认展开，转换后立即可见）。 */
  wiki: boolean;
}

/**
 * 行内重命名输入框（最小实现：行内 input + 既有 token 样式）。
 *
 * T51-01：三键语义 = Enter 提交 / Esc 取消 / **失焦提交**（点别处不再吞改名）。
 * 空值、仅空白、或与原标题同值 → 不落库、回退原标题（只退出编辑，不动节点）；
 * `settledRef` 保证提交/取消只发生一次——Enter 提交触发卸载后浏览器仍可能派发
 * blur，若再提交会多发一次 rename op。三条路径共用既有 `pagesActions.renamePage`
 * / `cancelRename` 单一入口，不新造协议。
 *
 * T54-01 §1①：编辑中（未提交）是「待结算态」——注册进关窗冲刷链：main 拦 close
 * 发 editor:flush 时立刻按当前输入值提交（关窗 ≠ 失焦，不注册就会丢这一笔改名）。
 */
function RenameInput({ id, title }: { id: string; title: string }) {
  const settledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settle = (value: string, action: 'commit' | 'cancel'): void => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    const trimmed = value.trim();
    if (action === 'commit' && trimmed.length > 0 && trimmed !== title) {
      void pagesActions.renamePage(id, trimmed);
      return;
    }
    pagesActions.cancelRename();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      settle(event.currentTarget.value, 'commit');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      settle(event.currentTarget.value, 'cancel');
    }
  };
  // 关窗冲刷（T54-01）：按输入框现值提交，并 await 落库（settle 幂等，settled 后空操作）
  useEffect(() =>
    registerFlushTask(async () => {
      if (settledRef.current) {
        return;
      }
      settledRef.current = true;
      const trimmed = (inputRef.current?.value ?? title).trim();
      if (trimmed.length > 0 && trimmed !== title) {
        await pagesActions.renamePage(id, trimmed);
        return;
      }
      pagesActions.cancelRename();
    }),
  );
  return (
    <input
      className="app-nav-input"
      data-testid="side-rename-input"
      defaultValue={title}
      autoFocus
      ref={inputRef}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onBlur={(event) => settle(event.currentTarget.value, 'commit')}
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
  /** T60-01 ④：右键行 → 打开行菜单（位置=光标处；子控件命中由回调内自行放行）。 */
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
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
  onContextMenu,
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
      onContextMenu={onContextMenu}
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
  // T52-01 §1.1：工作区名移进侧栏头部（顶栏左端不再承载）——显示**真实**工作区名
  // （store 里已加载的 name），未就绪时回落 i18n 默认名（原静态文案，行为不变）。
  const workspaceId = usePages((state) => state.workspaceId);
  const workspaces = usePages((state) => state.workspaces);
  const workspaceName =
    workspaces.find((item) => item.id === workspaceId)?.name ?? t('sidebar.workspace');
  // T23-02 §C.1：「新建页面 ▾」模板子菜单展开态（本地视图态；列表订阅 templates slice）
  const [tplOpen, setTplOpen] = useState(false);
  // T24-01 §0.A：页面行「⋯」菜单展开态（本地视图态；每树同时至多一个）
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  /**
   * T60-01 ④：右键菜单的落点（光标处，视口坐标）。null = 本行菜单由 ⋯ 钮开（贴钮定位）；
   * 非 null = 由右键开（fixed 定位到光标，clamp 进视口）。**两者共用 rowMenuId 与同一份
   * items/onSelect**（不双份实现）。
   */
  const [rowMenuAt, setRowMenuAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * T61-01 §1.3：「移入…」的二级选择态——值 = 正在挑目标父页的页 id（null = 一级菜单）。
   * 与 rowMenuId 共用同一宿主/锚点（见 renderPageRow 的 key 切换与 moveTargetMenu）。
   */
  const [movePickId, setMovePickId] = useState<string | null>(null);
  const ctxHostRef = useRef<HTMLSpanElement | null>(null);
  // T41-01：页面级「全宽 / 固定宽度」集合（行菜单项显示当前页状态并切换）
  const fullWidthPages = usePageWidth((state) => state.full);
  const templates = useTemplates((state) => state.templates);
  const [groupOpen, setGroupOpen] = useState<GroupOpen>({ favorites: false, recent: false, wiki: true });

  const byId = useMemo(() => nodeMap(nodes), [nodes]);

  /**
   * T61-01 §1.2：派生「文件夹」集合 = **有 ≥1 个活子页的页 id**（O(n) 一次索引，
   * 行渲染里 O(1) 反查；不在每次行渲染时全树扫）。判定只做「父指针指向它」，
   * 与协议无关——零新实体、零 schema/op-log 改动。
   */
  const folderIds = useMemo(() => {
    const parents = new Set<string>();
    for (const node of nodes) {
      if (node.alive === 1 && node.parentId !== null) {
        parents.add(node.parentId);
      }
    }
    return parents;
  }, [nodes]);

  /** 关闭行菜单（⋯/右键共用出口；Escape、点空白、选中条目都走这里）。 */
  const closeRowMenu = (): void => {
    setRowMenuId(null);
    setRowMenuAt(null);
    setMovePickId(null);
  };

  /** 右键菜单宿主节点（存活页才有菜单可弹）。 */
  const ctxNode = useMemo(
    () => (rowMenuAt !== null && rowMenuId !== null ? byId.get(rowMenuId) ?? null : null),
    [rowMenuAt, rowMenuId, byId],
  );

  /**
   * T60-01 ④：右键菜单 clamp 进视口——渲染后实测宿主盒尺寸，超出右/下缘时把
   * left/top 压回（留 8px 余量）；收敛后再写一次 state（第二次比较相等 → 不再 set）。
   * jsdom 无布局（rect 全 0）时退化为纯 clamp，不会死循环。
   */
  useLayoutEffect(() => {
    if (rowMenuAt === null) {
      return;
    }
    const host = ctxHostRef.current;
    if (host === null) {
      return;
    }
    const rect = host.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const x = Math.min(Math.max(rowMenuAt.x, margin), maxX);
    const y = Math.min(Math.max(rowMenuAt.y, margin), maxY);
    if (x !== rowMenuAt.x || y !== rowMenuAt.y) {
      setRowMenuAt({ x, y });
    }
  }, [rowMenuAt]);

  /** 收藏/最近 → 存活页节点解析（找不到/已删除的 id 跳过）。 */
  const resolveGroup = (ids: readonly string[]): PageNodeView[] =>
    ids
      .map((id) => byId.get(id))
      .filter((node): node is PageNodeView => node !== undefined && node.alive === 1);

  const favoriteNodes = useMemo(() => resolveGroup(favoriteIds), [byId, favoriteIds]);
  const recentNodes = useMemo(() => resolveGroup(recentIds), [byId, recentIds]);
  const trashCount = useMemo(() => trashNodes(nodes).length, [nodes]);

  /** 可见树行：roots 按 sortKey 序；展开的节点下钻 alive 子行（childIds 已排序）。
   *  T42-01：wiki 页及其子树在此**整枝剪除**（改在「Wiki」分区渲染），普通分区不受影响。 */
  const visibleTree = useMemo(() => {
    const rows: PageNodeView[] = [];
    const walk = (node: PageNodeView): void => {
      if (pageTypeOf(node) === 'wiki') {
        return;
      }
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

  /**
   * T42-01：Wiki 分区行 = 以 wiki 页为根的子树（按 sortKey 序）；下行遇到嵌套
   * wiki 页即截断（它自己会作为独立根出现在本分区，避免重复行）。
   */
  const wikiRootCount = useMemo(
    () => aliveNodes(nodes).filter((node) => pageTypeOf(node) === 'wiki').length,
    [nodes],
  );
  const wikiRows = useMemo(() => {
    const rows: Array<{ node: PageNodeView; depth: number }> = [];
    const walk = (node: PageNodeView, depth: number): void => {
      rows.push({ node, depth });
      if (!expanded.has(node.id)) {
        return;
      }
      for (const childId of node.childIds) {
        const child = byId.get(childId);
        if (child === undefined || child.alive !== 1) {
          continue;
        }
        if (pageTypeOf(child) === 'wiki') {
          continue;
        }
        walk(child, depth + 1);
      }
    };
    for (const root of aliveNodes(nodes).filter((node) => pageTypeOf(node) === 'wiki').sort(bySortKey)) {
      walk(root, 0);
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

  /**
   * 行菜单的**单一构造**（T60-01 ④）：⋯ 钮与右键两个入口共用同一份 items 与 onSelect，
   * 不双份实现。返回 Menu 组件所需的 items + onSelect。
   */
  const pageRowMenu = (
    node: PageNodeView,
  ): { items: MenuEntry[]; onSelect: (action: string) => void } => {
    const type = pageTypeOf(node);
    const convertItem =
      type === 'wiki'
        ? { id: 'convertToPage', label: t('editor.convertToPage') }
        : type === 'page'
          ? { id: 'convertToWiki', label: t('editor.convertToWiki') }
          : null;
    // T41-01-1：全宽开关对 DB 页无视觉效果（DbPage 不吃 pageWidth 宽度口径），
    // 按 convertItem 同款条件构造隐藏，不提供无效控件；普通页/wiki 页照常出现。
    const fullWidthItem =
      type === 'database'
        ? null
        : {
            id: 'fullWidth',
            label: fullWidthPages.has(node.id)
              ? `\u2713 ${t('pageWidth.full')}`
              : t('pageWidth.fixed'),
          };
    return {
      items: [
        // T60-01 ④（PRD-R13 ⑤）：「重命名」复用既有行内编辑态（双击行用的 beginRename），
        // 不新造 state；位置在删除之前、非 danger。
        { id: 'rename', label: t('sidebar.rename') },
        // T61-01 §1.1（PRD-R13 ④）：「新建子页面」= 既有 createPage(该行 id)——
        // 新页挂在行下即成为「文件夹」长相（派生，无新实体）；store 内部已选中并进入重命名。
        { id: 'newSubpage', label: t('sidebar.newSubpage') },
        // T61-01 §1.3：「移入…」→ 二级选择（同宿主换列表，见 moveTargetMenu）
        { id: 'moveTo', label: t('sidebar.moveTo') },
        ...(fullWidthItem !== null ? [fullWidthItem] : []),
        ...(convertItem !== null ? [convertItem] : []),
        { id: 'delete', label: t('common.delete'), danger: true },
      ],
      onSelect: (action: string): void => {
        // 「移入…」不关菜单：一级列表整体换成二级目标列表（同一宿主/锚点/出口）
        if (action === 'moveTo') {
          setMovePickId(node.id);
          return;
        }
        closeRowMenu();
        if (action === 'rename') {
          pagesActions.beginRename(node.id);
        }
        if (action === 'newSubpage') {
          void pagesActions.createPage(node.id);
        }
        if (action === 'fullWidth') {
          pageWidthActions.toggle(node.id);
        }
        if (action === 'convertToWiki') {
          void pagesActions.convertPage(node.id, 'wiki');
        }
        if (action === 'convertToPage') {
          void pagesActions.convertPage(node.id, 'page');
        }
        if (action === 'delete') {
          pagesActions.requestDeletePage(node.id);
        }
      },
    };
  };

  /**
   * T61-01 §1.3：「移入…」二级选择（复用同一个 Menu 组件与同一个宿主）。
   *
   * 目标集 = 全部活页（排除多维数据行——它是集合视图不是容器）+「工作区根」；
   * **排除自身与自身后代**（防环）。后代判定借 `ancestorsOf` 反向用：
   * 候选的祖先链里出现本行 id ⇒ 该候选是它的后代。
   * 移动走既有 `movePage`（:537）；成功后目标父页自动展开（子树折叠态不变，落点可见）。
   */
  const moveTargetMenu = (
    node: PageNodeView,
  ): { items: MenuEntry[]; onSelect: (action: string) => void } => {
    const candidates = aliveNodes(nodes)
      .filter((candidate) => pageTypeOf(candidate) !== 'database')
      .filter((candidate) => candidate.id !== node.id)
      .filter(
        (candidate) => !ancestorsOf(candidate.id, byId).some((ancestor) => ancestor.id === node.id),
      )
      .sort(bySortKey);
    return {
      items: [
        { id: 'root', label: t('sidebar.moveToRoot'), disabled: node.parentId === null },
        ...candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.title.length > 0 ? candidate.title : t('common.untitled'),
          // 已在目标下 = 无操作，禁掉（避免误点触发一次无意义 move）
          disabled: node.parentId === candidate.id,
        })),
      ],
      onSelect: (action: string): void => {
        closeRowMenu();
        const newParentId = action === 'root' ? null : action;
        void pagesActions.movePage({ id: node.id, newParentId }).then((ok) => {
          if (ok && newParentId !== null && !expanded.has(newParentId)) {
            pagesActions.toggleExpand(newParentId);
          }
        });
      },
    };
  };

  /**
   * 页面行（普通分区与 Wiki 分区共用，T42-01 抽取）：
   * ⋯ 菜单 = 重命名 + 全宽开关 + 承载类型转换（wiki 页显示「转为普通页」，普通页显示
   * 「转为 Wiki」，多维数据页无此项）+ 删除。
   */
  const renderPageRow = (
    node: PageNodeView,
    depth: number,
    testIdPrefix: string,
    rootIcon: ComponentProps<typeof Icon>['icon'],
  ): ReactNode => {
    const childCount = node.childIds.filter((childId) => byId.get(childId)?.alive === 1).length;
    const isEditing = editingId === node.id;
    const type = pageTypeOf(node);
    // T61-01 §1.3：「移入…」二级态与一级共用同一宿主 → 用 key 换实例（老实例在本次
    // click 事件派发中被卸载，其 document 外点监听按 DOM 规范跳过，不会「刚换列表就关」）；
    // 换实例同时让 Menu 的「聚焦首项」effect 对新列表重跑（键盘可达性不丢）。
    const inMovePick = movePickId === node.id;
    const menu = inMovePick ? moveTargetMenu(node) : pageRowMenu(node);
    return (
      <NavRow
        key={node.id}
        testId={`${testIdPrefix}-${node.id}`}
        label={node.title}
        /* T60-01 ②（PRD-R13 ②）：普通页行一律 FileText（含树根：树根原走 rootIcon=
           FolderSimple → 「新建页面」出来的行是文件夹图标，老板点名要文件图标）；
           wiki/database 行保持现状（depth>0 仍 FileText、wiki 根仍 Note），
           Wiki 分区头图标不在本函数（:500 处 Note）不动。
           T61-01 §1.2（PRD-R13 ④）：**有活子页的普通页 = 文件夹长相（FolderSimple）** ——
           派生语义（folderIds 由 parentId 反查索引得出），零新实体/零协议改动。 */
        icon={
          type === 'page'
            ? folderIds.has(node.id)
              ? FolderSimple
              : FileText
            : depth === 0
              ? rootIcon
              : FileText
        }
        depth={depth}
        active={selectedId === node.id}
        branch={childCount > 0}
        open={expanded.has(node.id)}
        labelNode={isEditing ? <RenameInput id={node.id} title={node.title} /> : undefined}
        onClick={() => {
          pagesActions.selectPage(node.id);
          // T61-01 §1.5：折叠态点行 = 选中 + 展开其子树（一次性视图态；点 Caret 的
          // 折叠/展开语义不变——见 onCaretClick，它不冒泡到本 handler）。
          if (childCount > 0 && !expanded.has(node.id)) {
            pagesActions.toggleExpand(node.id);
          }
        }}
        onCaretClick={(event) => {
          event.stopPropagation();
          pagesActions.toggleExpand(node.id);
        }}
        onDoubleClick={() => pagesActions.beginRename(node.id)}
        onContextMenu={(event) => {
          const target = event.target;
          // 子控件（重命名输入框 / ⋯ 钮 / 折叠三角）命中 → 放行，不抢它们各自的语义
          if (target instanceof Element && target.closest('input, .app-nav-more-wrap, .app-nav-tw') !== null) {
            return;
          }
          event.preventDefault();
          setMovePickId(null);
          setRowMenuId(node.id);
          setRowMenuAt({ x: event.clientX, y: event.clientY });
        }}
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
                // ⋯ 钮 = 贴钮定位（rowMenuAt=null），与右键的「光标处」互斥
                setRowMenuAt(null);
                setMovePickId(null);
                setRowMenuId((current) => (current === node.id ? null : node.id));
              }}
            />
            {rowMenuId === node.id && rowMenuAt === null ? (
              <Menu
                key={inMovePick ? 'move' : 'main'}
                className="app-nav-menu"
                label={inMovePick ? t('sidebar.moveToTitle') : t('sidebar.pageActions')}
                items={menu.items}
                onSelect={menu.onSelect}
                onDismiss={closeRowMenu}
              />
            ) : null}
          </span>
        }
      />
    );
  };

  /** 右键菜单配置（仅在右键态存在存活目标页时构造一次；二级态同理）。 */
  const ctxInMovePick = ctxNode !== null && movePickId === ctxNode.id;
  const ctxMenu =
    ctxNode !== null && ctxNode.alive === 1
      ? ctxInMovePick
        ? moveTargetMenu(ctxNode)
        : pageRowMenu(ctxNode)
      : null;

  return (
    <div className="app-side">
      <div className="app-side-head" data-testid="side-workspace">
        <Icon icon={FolderSimple} size="sm" />
        {workspaceName}
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
        {/* T42-01：Wiki 独立分区（图标走 @septcats/ui 出口 Note），列本工作区全部 wiki 页
            （及其子树；嵌套 wiki 页独立成根）。空态与收藏/最近同款 .app-nav-empty。 */}
        <NavRow
          testId="side-wiki"
          label={t('sidebar.wiki')}
          icon={Note}
          head
          count={wikiRootCount}
          onClick={() => toggleGroup('wiki')}
        />
        {groupOpen.wiki ? (
          wikiRows.length === 0 ? (
            <div className="app-nav-empty" style={indentStyle(1)} data-testid="side-wiki-empty">
              {t('sidebar.emptyWiki')}
            </div>
          ) : (
            wikiRows.map(({ node, depth }) => renderPageRow(node, depth, 'side-wiki-node', Note))
          )
        ) : null}
        {visibleTree.map((node) => renderPageRow(node, node.depth, 'side-node', FolderSimple))}
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
      {/* T60-01 ④：右键行菜单（与 ⋯ 钮同一份 items/onSelect，见 pageRowMenu）。
          宿主 fixed 定位到光标（clamp 进视口，见上面的 useLayoutEffect）；
          样式只借用 .sc-menu 自身（不再叠 .app-nav-menu 的 absolute/right/top，
          否则会被二次偏移）；z-index 走既有 dropdown token。 */}
      {ctxMenu !== null && rowMenuAt !== null ? (
        <span
          ref={ctxHostRef}
          style={{
            position: 'fixed',
            left: `${String(rowMenuAt.x)}px`,
            top: `${String(rowMenuAt.y)}px`,
            zIndex: 'var(--sc-z-dropdown)',
          }}
        >
          <Menu
            key={ctxInMovePick ? 'move' : 'main'}
            label={ctxInMovePick ? t('sidebar.moveToTitle') : t('sidebar.pageActions')}
            items={ctxMenu.items}
            onSelect={ctxMenu.onSelect}
            onDismiss={closeRowMenu}
          />
        </span>
      ) : null}
    </div>
  );
}
