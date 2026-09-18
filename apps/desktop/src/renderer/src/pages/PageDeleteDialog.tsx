/**
 * PageDeleteDialog.tsx —— 「删除页面」二次确认弹层（TASK-T24-01 §0.A）。
 *
 * 命令面板命令与侧栏行「⋯」菜单共用同一入口：pagesStore.deleteConfirmId 驱动开合
 * （回收站「彻底删除」确认弹层同范式，复用 @septcats/ui Dialog 的焦点圈闭/Esc/遮罩关闭）。
 * 确认 → pagesActions.confirmDeletePage()：软删进回收站（乐观更新 + 失败回滚 + 对账，
 * 侧栏树/收藏/最近/回收站角标随既有动作同步）→ 回 pages 视图 → ensureSelection 选中回落。
 * 文案继承回收站「彻底删除」弹层的措辞风格（含子页提示）；标题空回退「未命名」。
 */
import { useMemo } from 'react';
import { childrenIndex, collectDescendants } from '@septcats/editor';
import { Button, Dialog } from '@septcats/ui';
import { nodeMap, pagesActions, usePages } from '../state/pages';
import { t } from '../i18n';

export function PageDeleteDialog() {
  const deleteConfirmId = usePages((state) => state.deleteConfirmId);
  const nodes = usePages((state) => state.nodes);

  const target = useMemo(() => {
    if (deleteConfirmId === null) {
      return null;
    }
    const byId = nodeMap(nodes);
    const node = byId.get(deleteConfirmId);
    if (node === undefined || node.alive === 0) {
      return null;
    }
    const childCount = collectDescendants(node.id, childrenIndex(nodes)).filter(
      (id) => byId.get(id)?.alive === 1,
    ).length;
    return { title: node.title, childCount };
  }, [deleteConfirmId, nodes]);

  return (
    <Dialog
      open={target !== null}
      onClose={() => {
        pagesActions.cancelDeletePage();
      }}
      title={t('pageDelete.title')}
      footer={
        <>
          <Button
            variant="secondary"
            data-testid="page-delete-cancel"
            onClick={() => {
              pagesActions.cancelDeletePage();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            data-testid="page-delete-confirm"
            onClick={() => {
              void pagesActions.confirmDeletePage();
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {target === null
        ? null
        : t(target.childCount > 0 ? 'pageDelete.bodyWithChildren' : 'pageDelete.body')
            .replace(
              '{name}',
              target.title.length > 0 ? target.title : t('common.untitled'),
            )
            .replace('{n}', String(target.childCount))}
    </Dialog>
  );
}
