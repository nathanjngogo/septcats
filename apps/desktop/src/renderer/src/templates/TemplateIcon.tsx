/**
 * TemplateIcon.tsx —— 模板列表行的图标槽（TASK-T23-02 §0.A：icon 仅展示）。
 *
 * 模板自带 icon（继承源页的字符串，Notion 导入常见 emoji）→ 原样文本展示；
 * 为空 → 按 kind 回落 @septcats/ui 图标（page = FileText，database = Note）。
 * UI 字形只从 @septcats/ui 出口（§16.6）；数据 icon 是内容，不是 UI 字形。
 */
import { FileText, Icon, Note } from '@septcats/ui';
import type { TemplateMeta } from '../../../main/templates';

export function TemplateIcon({ template, className }: { template: TemplateMeta; className?: string }) {
  const icon = template.icon ?? '';
  if (icon.length > 0) {
    return <span className={className === undefined ? 'tpl-emoji' : `tpl-emoji ${className}`}>{icon}</span>;
  }
  return <Icon icon={template.kind === 'database' ? Note : FileText} size="sm" className={className} />;
}
