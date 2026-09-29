/**
 * NavRail.tsx —— T93-01 一级导航轨（老板 09-29 令：「在左侧边栏再加一级侧边栏，
 * 用来区分笔记、知识库等一级菜单」）。
 *
 * 一级 = 去哪块地；二级 = 那块地里的内容（页面树 / 库列表）。五项：
 *   笔记 / 知识库 / 工作台 / 模板 / 回收站。
 * 纯中文短标签（延续 09-29「图标去掉」口径，不挂 glyph）；当前项 aria-current
 * 高亮；键盘可达（Tab 序在页面树之前，天然满足——rail 是 DOM 里侧栏区第一个）。
 *
 * 高亮单真源：active 由 App 从既有视图状态派生（workbench.view / view / pages.view
 * / nav.panel），本组件只渲染，不自己存一份。
 */
import type { ReactNode } from 'react';
import { t } from '../i18n';
import './NavRail.css';

export type RailKey = 'notes' | 'kb' | 'home' | 'templates' | 'trash';

interface RailItem {
  key: RailKey;
  /** 可见短标签（双语键） */
  labelKey: string;
  /** tooltip 补一句这级是干什么的 */
  hintKey: string;
}

const ITEMS: readonly RailItem[] = [
  { key: 'notes', labelKey: 'nav.notes', hintKey: 'nav.notesHint' },
  { key: 'kb', labelKey: 'nav.kb', hintKey: 'nav.kbHint' },
  { key: 'home', labelKey: 'nav.home', hintKey: 'nav.homeHint' },
  { key: 'templates', labelKey: 'nav.templates', hintKey: 'nav.templatesHint' },
  { key: 'trash', labelKey: 'nav.trash', hintKey: 'nav.trashHint' },
];

export function NavRail({
  active,
  onSelect,
}: {
  active: RailKey;
  onSelect: (key: RailKey) => void;
}): ReactNode {
  return (
    <nav className="nav-rail" aria-label={t('nav.railLabel')} data-testid="nav-rail">
      {ITEMS.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            className={isActive ? 'nav-rail__item nav-rail__item--on' : 'nav-rail__item'}
            aria-current={isActive ? 'page' : undefined}
            title={`${t(item.labelKey)} —— ${t(item.hintKey)}`}
            data-testid={`nav-rail-${item.key}`}
            onClick={() => {
              onSelect(item.key);
            }}
          >
            {t(item.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}