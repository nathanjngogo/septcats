/**
 * wikilinkResolve.ts —— 双链「解析语义 ↔ 页面存活」对账（TASK-T44-01-1）。
 *
 * 背景（PM 真机 B3/B3b 实证）：解析状态物化在 wikilink 节点 attrs（resolved ⇔
 * `attrs.target` 非空，packages/editor types/wikilink.ts renderHTML），target 是
 * 补全/收口时写死的页 id；目标页软删后无人重估 → 链接永远显示已解析。而
 * `pages.tree()`（page.listAll）返回 alive+deleted 全量节点，渲染层若直接拿全量
 * 树判活会把已删页当成存在。
 *
 * 本模块是**纯对账规则**：以存活页集合为唯一真源，对当前文档里的 wikilink 节点
 * 做双向收敛——
 * - target 指向已死页 → target=null（渲染转 unresolved；点击走新建路径）；
 * - target 为空且 title 与**唯一**存活页标题精确相等 → 回填该 id（回收站恢复、
 *   或先有 `[[名]]` 后建同名页时自动接上；重名歧义不回填，保持未解析）。
 *
 * 对账走正常编辑事务（setNodeMarkup → onUpdate → EditSession commit）：落库、
 * 入协作账本、联动双链派生索引（blocks commit 路径增量重算），不是纯显示层修改。
 * 幂等：全部命中规则时零事务。
 */

import type { ComponentProps } from 'react';
import { Editor } from '@septcats/editor/react';
import type { PageNodeView } from '../../../types/window';

/** wikilink 节点类型名（与 packages/editor types/wikilink.ts 的 WIKILINK_NODE_NAME 同源；该常量未从包出口，此处字面量收敛）。 */
const WIKILINK_TYPE = 'wikilink';

/** PageView 的编辑器句柄（与 PageView.tsx 同一推导，不直依赖 @tiptap）。 */
type EditorHandle = Exclude<
  Parameters<NonNullable<ComponentProps<typeof Editor>['onReady']>>[0],
  null
>;

/** 存活页 id 集合（alive=1 才算存在——软删/彻底删除都不算）。 */
export function aliveIdSet(nodes: readonly PageNodeView[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.alive === 1) {
      ids.add(node.id);
    }
  }
  return ids;
}

/**
 * 存活页标题索引：title → 唯一存活页 id；重名置空串（歧义标记，不回填）。
 * 精确相等匹配（与 rules/wikilink resolveTitleToId 的 exact 路径同口径）。
 */
export function aliveTitleIndex(nodes: readonly PageNodeView[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of nodes) {
    if (node.alive !== 1) {
      continue;
    }
    const owner = index.get(node.title);
    if (owner === undefined) {
      index.set(node.title, node.id);
    } else if (owner !== node.id) {
      index.set(node.title, '');
    }
  }
  return index;
}

/**
 * 单个 wikilink 的目标重估（纯函数）：
 * - 已有 target：存活 → 保持；已死 → null（转未解析）；
 * - 无 target：title 唯一命中存活页 → 回填 id；无命中/重名歧义/空标题 → 保持 null。
 */
export function nextWikilinkTarget(input: {
  target: string | null;
  title: string;
  aliveIds: ReadonlySet<string>;
  aliveTitles: ReadonlyMap<string, string>;
}): string | null {
  const { target, title, aliveIds, aliveTitles } = input;
  if (target !== null) {
    return aliveIds.has(target) ? target : null;
  }
  if (title.length === 0) {
    return null;
  }
  const owner = aliveTitles.get(title);
  return owner !== undefined && owner.length > 0 ? owner : null;
}

/**
 * 对当前编辑器文档里的全部 wikilink 节点做存活对账。有变更时以**单个事务**落
 * （渲染一次性收敛），返回变更节点数；无变更零事务（幂等）。
 */
export function reconcileWikilinkTargets(
  editor: EditorHandle,
  nodes: readonly PageNodeView[],
): number {
  if (nodes.length === 0) {
    return 0; // 树未就绪（加载中）绝不对账——会把全部链接误杀成未解析
  }
  const aliveIds = aliveIdSet(nodes);
  const aliveTitles = aliveTitleIndex(nodes);
  const tr = editor.state.tr;
  let changed = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== WIKILINK_TYPE) {
      return;
    }
    const target = node.attrs['target'];
    const title = node.attrs['title'];
    const next = nextWikilinkTarget({
      target: typeof target === 'string' && target.length > 0 ? target : null,
      title: typeof title === 'string' ? title : '',
      aliveIds,
      aliveTitles,
    });
    if (next === (typeof target === 'string' && target.length > 0 ? target : null)) {
      return;
    }
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, target: next });
    changed += 1;
  });
  if (changed === 0) {
    return 0;
  }
  editor.view.dispatch(tr);
  return changed;
}
