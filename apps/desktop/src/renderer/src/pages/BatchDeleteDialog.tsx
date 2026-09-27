/**
 * BatchDeleteDialog.tsx —— 侧栏「批量删除」二次确认弹层（TASK-T86-01）。
 *
 * **老板 09-27 令（原话）**：「5. 左侧边栏增加批量删除功能」。
 *
 * 与单页删除（PageDeleteDialog）同范式：store 状态驱动开合（`pagesStore.deleteBatch`），
 * 复用 @septcats/ui Dialog 的焦点圈闭/Esc/遮罩关闭；两者互不覆盖（可分别开合）。
 * 确认 → `pagesActions.confirmDeletePages()`：逐页软删（H-12 幂等）、逐页静默、
 * 末尾一条汇总 toast，收尾回 pages 视图 + ensureSelection 选中回落。
 * 文案走 i18n（pageDelete.bulk*），标题空回退「未命名」由 store 侧归一化保证。
 */
import { Button, Dialog } from '@septcats/ui';
import { pagesActions, usePages } from '../state/pages';
import { t } from '../i18n';

export function BatchDeleteDialog() {
  const deleteBatch = usePages((state) => state.deleteBatch);
  const count = deleteBatch?.length ?? 0;
  const open = count > 0;

  return (
    <Dialog
      open={open}
      onClose={() => {
        pagesActions.cancelDeletePages();
      }}
      title={t('pageDelete.bulkTitle')}
      footer={
        <>
          <Button
            variant="secondary"
            data-testid="bulk-delete-cancel"
            onClick={() => {
              pagesActions.cancelDeletePages();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            data-testid="bulk-delete-confirm"
            onClick={() => {
              void pagesActions.confirmDeletePages();
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {open ? t('pageDelete.bulkBody').replace('{n}', String(count)) : null}
    </Dialog>
  );
}