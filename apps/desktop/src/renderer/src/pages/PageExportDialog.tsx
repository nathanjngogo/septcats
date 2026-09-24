/**
 * PageExportDialog.tsx —— R27（TASK-T79-01 §C）页面导出 scope 选择弹层。
 *
 * 入口：侧栏页面行菜单「导出为 Markdown…」（`page-export-menu`）→
 * `pagesActions.openPageExport(id)`：无活子页直接单页导出；有子页由本弹层选 scope。
 * 复用 @septcats/ui Dialog（焦点圈闭/Esc/遮罩关闭）与 Button。确认 → `runPageExport`
 * （预览→确认→落盘全在 main；用户取消目录选择 = 零落盘）。testid 契约：`page-export-scope`/
 * `page-export-single`/`page-export-subtree`/`page-export-confirm`。
 */
import { useEffect, useState } from 'react';
import { Button, Dialog } from '@septcats/ui';
import type { PageExportPreview } from '../../../shared/pageExport';
import { pagesActions, usePages } from '../state/pages';
import { t } from '../i18n';

export function PageExportDialog() {
  const dialog = usePages((state) => state.exportDialog);
  const [scope, setScope] = useState<'single' | 'subtree'>('single');
  const [preview, setPreview] = useState<PageExportPreview | null>(null);

  // 每次打开重置为「仅本页」（上一次选择不跨次保留）
  useEffect(() => {
    if (dialog !== null) {
      setScope('single');
    }
  }, [dialog]);

  // 开/换 scope → 只读预览（列文件名 + 孤儿清单；**不落盘**）
  const pageId = dialog?.pageId ?? null;
  useEffect(() => {
    if (pageId === null) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview(null);
    void pagesActions.loadPageExportPreview(pageId, scope).then((result) => {
      if (alive) {
        setPreview(result);
      }
    });
    return () => {
      alive = false;
    };
  }, [pageId, scope]);

  return (
    <Dialog
      open={dialog !== null}
      onClose={() => {
        pagesActions.closePageExport();
      }}
      title={t('pageExport.dialogTitle')}
      footer={
        <>
          <Button
            variant="secondary"
            data-testid="page-export-cancel"
            onClick={() => {
              pagesActions.closePageExport();
            }}
          >
            {t('pageExport.cancel')}
          </Button>
          <Button
            variant="primary"
            data-testid="page-export-confirm"
            onClick={() => {
              if (dialog !== null) {
                void pagesActions.runPageExport(dialog.pageId, scope);
              }
            }}
          >
            {t('pageExport.confirm')}
          </Button>
        </>
      }
    >
      <div data-testid="page-export-scope">
        <p style={{ margin: '0 0 var(--sc-space-md) 0' }}>{t('pageExport.dialogHint')}</p>
        {dialog !== null && dialog.childCount > 0 ? (
          <div style={{ display: 'flex', gap: 'var(--sc-space-sm)' }}>
            <Button
              variant={scope === 'single' ? 'primary' : 'secondary'}
              size="sm"
              data-testid="page-export-single"
              aria-pressed={scope === 'single'}
              onClick={() => {
                setScope('single');
              }}
            >
              {t('pageExport.scopeSingle')}
            </Button>
            <Button
              variant={scope === 'subtree' ? 'primary' : 'secondary'}
              size="sm"
              data-testid="page-export-subtree"
              aria-pressed={scope === 'subtree'}
              onClick={() => {
                setScope('subtree');
              }}
            >
              {t('pageExport.scopeSubtree')}
            </Button>
          </div>
        ) : null}
        <div data-testid="page-export-preview" style={{ marginTop: 'var(--sc-space-md)' }}>
          <p style={{ margin: '0 0 var(--sc-space-xs) 0' }}>{t('pageExport.filesTitle')}</p>
          {preview === null ? (
            <p style={{ margin: 0 }}>{t('pageExport.previewLoading')}</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sc-space-lg)' }}>
              {preview.files.map((file) => (
                <li key={`${file.kind}:${file.relPath}`}>{file.relPath}</li>
              ))}
            </ul>
          )}
          {preview !== null && preview.counts.orphans > 0 ? (
            <p style={{ margin: 'var(--sc-space-xs) 0 0 0' }} data-testid="page-export-orphans">
              {t('pageExport.orphansHint').replace('{n}', String(preview.counts.orphans))}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
