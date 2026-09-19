/**
 * chatBridge.ts —— AI 对话侧栏 ↔ 编辑器（PageView）的解耦桥（TASK-T38-01 §0.3）。
 *
 * PageView 在编辑器就绪时注册 provider（当前页上下文 + 块跳转），卸载/换到
 * 数据库页时注销；AiChatPanel 只经本模块访问，不 import PageView 内部
 * （照 palette/sync 的窗口事件解耦同思路，这里是模块级单槽注册）。
 *
 * 跨页跳转：引用页 ≠ 当前页时，先挂 pendingJump 再 openInTab 切页；
 * PageView 编辑器就绪 effect 里 consumePendingJump 消费（Editor key=pageId
 * 重建后 blockPosById 才可用）。
 */
import { pagesActions } from '../state/pages';
import type { PageChatContext } from './chatContext';

export interface EditorChatProvider {
  /** provider 绑定的页（跨页跳转判据）。 */
  pageId: string;
  /** 取当前页上下文（编辑器未就绪/数据库页 → null）。 */
  getPageContext(): PageChatContext | null;
  /** 跳到本页指定块（选中 + 滚入视口）。 */
  jumpToBlock(blockId: string): void;
}

let provider: EditorChatProvider | null = null;
let pendingJump: { pageId: string; blockId: string } | null = null;

export function setEditorChatProvider(next: EditorChatProvider | null): void {
  provider = next;
}

export function getEditorChatProvider(): EditorChatProvider | null {
  return provider;
}

/**
 * 引用跳转统一入口：同页 → 立即跳；跨页 → 记 pending + 切页
 * （PageView 编辑器重建后消费）。页不存在/已被删 → openInTab 由 pages store 兜底。
 */
export function requestBlockJump(pageId: string, blockId: string): void {
  const current = provider;
  if (current !== null && current.pageId === pageId) {
    current.jumpToBlock(blockId);
    return;
  }
  pendingJump = { pageId, blockId };
  pagesActions.openInTab(pageId);
}

/** PageView 编辑器就绪时消费与本页匹配的 pending 跳转；无匹配 → null。 */
export function consumePendingJump(pageId: string): { blockId: string } | null {
  if (pendingJump !== null && pendingJump.pageId === pageId) {
    const { blockId } = pendingJump;
    pendingJump = null;
    return { blockId };
  }
  return null;
}
