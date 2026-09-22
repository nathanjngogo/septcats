/**
 * LayoutPreview.tsx —— 布局预览缩略图（TASK-T57-01 §1.2/§1.3）。
 *
 * **CSS/div 画的抽象微缩窗口**（禁位图截图）：侧栏位置与宽度比例、AI 面板落位、
 * 正文列宽度、标签条有无、密度档，全部由 `layoutPreviewOf`（layoutState.ts 纯函数）
 * 派生的 `LayoutPreview` 决定；本组件只消费，不做任何量测、不写死几何数值。
 *
 * 两档尺寸：`sm` = 弹框预设卡缩略图，`lg` = 编辑器页大图（同 DOM 同 CSS，只换档 class）。
 * 图形是装饰性的（aria-hidden），语义由卡片上的名称/描述文案承载。
 */
import type { CSSProperties } from 'react';
import type { LayoutPreview } from './layoutState';
import './LayoutPreview.css';

export interface LayoutPreviewDiagramProps {
  preview: LayoutPreview;
  size?: 'sm' | 'lg';
}

/** 正文示意行（三段灰条，宽递减 → 读作「正文」而非容器）。 */
const DOC_LINES = ['full', 'wide', 'short'] as const;

export function LayoutPreviewDiagram({ preview, size = 'sm' }: LayoutPreviewDiagramProps) {
  const vars = {
    '--sc-layout-preview-sidebar': `${String(preview.sidebarPercent)}%`,
    '--sc-layout-preview-content': `${String(preview.contentPercent)}%`,
  } as CSSProperties;

  return (
    <div
      className={`layout-preview layout-preview--${size}`}
      style={vars}
      data-testid="layout-preview"
      data-sidebar={preview.sidebarVisible ? 'left' : 'collapsed'}
      data-ai={preview.aiPlacement}
      data-ai-expanded={preview.aiExpanded ? 'on' : 'off'}
      data-tabs={preview.tabsVisible ? 'on' : 'off'}
      data-density={preview.density}
      aria-hidden="true"
    >
      <div className="layout-preview__chrome" />
      <div className="layout-preview__row">
        {preview.sidebarVisible ? <div className="layout-preview__side" /> : null}
        <div className="layout-preview__col">
          {preview.tabsVisible ? <div className="layout-preview__tabs" /> : null}
          <div className="layout-preview__body">
            <div className="layout-preview__doc">
              {DOC_LINES.map((kind) => (
                <span key={kind} className={`layout-preview__line layout-preview__line--${kind}`} />
              ))}
            </div>
          </div>
          {preview.aiPlacement === 'bottom' ? (
            <div
              className={`layout-preview__ai layout-preview__ai--bottom${preview.aiExpanded ? '' : ' layout-preview__ai--collapsed'}`}
            />
          ) : null}
        </div>
        {preview.aiPlacement === 'right' ? (
          <div
            className={`layout-preview__ai layout-preview__ai--right${preview.aiExpanded ? '' : ' layout-preview__ai--collapsed'}`}
          />
        ) : null}
      </div>
    </div>
  );
}
