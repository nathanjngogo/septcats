/**
 * TemplateIcon.tsx —— 模板列表行的图标槽（TASK-T23-02 起家；09-29 C 轮老板令：
 * 「模板那一行的图标全部改成中文描述的按键」）。
 *
 * 图标不再用 emoji/字形混排（源页继承的 icon 字符串内容不可控、观感参差），
 * 统一为**中文文字徽标**：按 kind 显示「数据」（多维数据模板）或「页面」
 * （文档模板）——所见即所得地描述模板类型。数据 icon 字段不再消费（存储层
 * 原样保留，导出/导入兼容不动）。样式 .tpl-badge 走 var(--sc-*) token。
 */
import type { TemplateMeta } from '../../../main/templates';
import { t } from '../i18n';

/** kind → 徽标文案键（zh=「数据/页面」，en=Base/Page；老板令：中文描述按键）。 */
export function templateBadgeLabel(kind: TemplateMeta['kind']): string {
  return t(kind === 'database' ? 'templates.badgeDatabase' : 'templates.badgePage');
}

export function TemplateIcon({ template, className }: { template: TemplateMeta; className?: string }) {
  return (
    <span className={className === undefined ? 'tpl-badge' : `tpl-badge ${className}`} aria-hidden="true">
      {templateBadgeLabel(template.kind)}
    </span>
  );
}
