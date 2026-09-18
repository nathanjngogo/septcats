/**
 * TrashList.tsx —— 回收站列表（TASK-T22-01 §0.B）。
 *
 * 主区列出待删页树（trashNodes 已在 store 裁好：alive=0 且 deletedAt>0；
 * 被删页的子页按 parentId/childIds 关系下钻，深度即相对回收站根的层级）。
 * 每行两个动作：「恢复」→ restorePage(id)（级联整棵子树，store 内已处理）；
 * 「彻底删除」→ 复用 @septcats/ui 的 Dialog 做二次确认（renderer/src 内无既有
 * 确认组件，UI 包的 Dialog 带 focus trap / Esc / 遮罩关闭，直接复用）→
 * 确认后 purgePage(id)。空态与搜索页空态同一 token 组合（.trash-empty）。
 * 返回 pages 视图走既有 showPages()。视觉只用 var(--sc-*) token，图标只从
 * @septcats/ui 出口取（恢复=ArrowClockwise、删除=Trash）。
 */
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PageNode } from '@septcats/editor';
import { ArrowClockwise, Button, Dialog, Icon, Trash } from '@septcats/ui';
import { BREADCRUMB_UNTITLED, nodeMap, pagesActions, trashNodes, usePages } from '../state/pages';
import './TrashList.css';

/** sortKey 升序、id 决胜（与 SidebarTree/main 侧派生序同式）。 */
function bySortKey(a: PageNode, b: PageNode): number {
  if (a.sortKey !== b.sortKey) {
    return a.sortKey < b.sortKey ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

export interface TrashRow {
  node: PageNode;
  /** 相对「回收站根」（父不在回收站的待删页）的深度，0 起。 */
  depth: number;
}

/**
 * 回收站行序（纯函数，供组件与测试复用）：回收站根按 sortKey 排列，
 * 每棵根内沿 childIds 下钻仍在回收站的子页（已 purge 的 deletedAt=0 行不露出）。
 */
export function trashRows(nodes: readonly PageNode[]): TrashRow[] {
  const trash = trashNodes(nodes);
  if (trash.length === 0) {
    return [];
  }
  const trashIds = new Set(trash.map((node) => node.id));
  const byId = nodeMap(nodes);
  const rows: TrashRow[] = [];
  const walk = (node: PageNode, depth: number): void => {
    rows.push({ node, depth });
    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (child !== undefined && trashIds.has(child.id)) {
        walk(child, depth + 1);
      }
    }
  };
  const roots = trash
    .filter((node) => {
      const parent = node.parentId === null ? undefined : byId.get(node.parentId);
      return parent === undefined || !trashIds.has(parent.id);
    })
    .sort(bySortKey);
  for (const root of roots) {
    walk(root, 0);
  }
  return rows;
}

/** 行缩进：与 SidebarTree 的 indentStyle 同式（token 化）。 */
function indentStyle(depth: number): CSSProperties {
  return { paddingLeft: `calc(var(--sc-space-sm) + var(--sc-space-md) * ${String(depth)})` };
}

export function TrashList() {
  const nodes = usePages((state) => state.nodes);
  const rows = useMemo(() => trashRows(nodes), [nodes]);
  /** 待二次确认「彻底删除」的行 id；null = 弹层关闭。 */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmNode =
    confirmId === null ? undefined : rows.find((row) => row.node.id === confirmId)?.node;

  return (
    <div className="trash-page">
      <div className="trash-head">
        <h2 className="trash-title">回收站</h2>
        <Button
          variant="ghost"
          size="sm"
          data-testid="trash-back"
          onClick={() => {
            pagesActions.showPages();
          }}
        >
          返回页面
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="trash-empty">回收站是空的，删除的页面会先存放在这里</div>
      ) : (
        <div className="trash-list" role="list">
          {rows.map((row) => (
            <div
              key={row.node.id}
              role="listitem"
              className="trash-row"
              data-testid={`trash-row-${row.node.id}`}
              style={indentStyle(row.depth)}
            >
              <Icon icon={Trash} size="sm" className="trash-row-ic" />
              <span className="trash-row-tx">
                {row.node.title.length > 0 ? row.node.title : BREADCRUMB_UNTITLED}
              </span>
              <span className="trash-row-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ArrowClockwise}
                  data-testid={`trash-restore-${row.node.id}`}
                  onClick={() => {
                    void pagesActions.restorePage(row.node.id);
                  }}
                >
                  恢复
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  icon={Trash}
                  data-testid={`trash-purge-${row.node.id}`}
                  onClick={() => {
                    setConfirmId(row.node.id);
                  }}
                >
                  彻底删除
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={confirmNode !== undefined}
        onClose={() => {
          setConfirmId(null);
        }}
        title="彻底删除页面"
        footer={
          <>
            <Button
              variant="secondary"
              data-testid="trash-purge-cancel"
              onClick={() => {
                setConfirmId(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              data-testid="trash-purge-confirm"
              onClick={() => {
                if (confirmId !== null) {
                  void pagesActions.purgePage(confirmId);
                }
                setConfirmId(null);
              }}
            >
              彻底删除
            </Button>
          </>
        }
      >
        「{confirmNode !== undefined && confirmNode.title.length > 0 ? confirmNode.title : BREADCRUMB_UNTITLED}
        」及其子页面将从回收站永久清除，此操作不可撤销。
      </Dialog>
    </div>
  );
}
