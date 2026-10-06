/**
 * NavRail.tsx —— T93-01 一级导航轨（老板 09-29 令：「在左侧边栏再加一级侧边栏，
 * 用来区分笔记、知识库等一级菜单」）。
 *
 * 一级 = 去哪块地；二级 = 那块地里的内容（页面树 / 库列表）。八项：
 *   笔记 / 知识库 / 日历 / 多维表格 / 待办 / 工作台 / 模板 / 回收站。
 * （老板 09-30 令：「在知识库功能下方增加日历功能，增加待办功能」→ 日历/待办紧随知识库。）
 *
 * 视觉（老板 2026-10-06 令，附截图红框=本导轨：「红框内，全部改为线条图标，设计要简约。」
 * ＋ 同日追加「取消像素风吧，不适合这个软件。」）：
 *   条目 = **24×24 线条图标**（@septcats/ui 线族，stroke=currentColor / 1.5 / 圆头），
 *   不再显示两位编号与中文短标签——窄轨里同时出现「数字 + 图形 + 文字」与「简约」冲突。
 *   文字保留为**无障碍标签**（`.nav-rail__label`，视觉隐藏）：既给读屏与 tooltip 语义，
 *   也让 `item.textContent` 契约（既有断言与真机探针按文本取标签）零改动。
 *
 * 高亮单真源：active 由 App 从既有视图状态派生（workbench.view / view / pages.view
 * / nav.panel），本组件只渲染，不自己存一份。
 */
import type { ReactNode } from 'react';
import {
  Icon,
  LineBookOpen,
  LineCalendar,
  LineHome,
  LineLayers,
  LineNote,
  LineTable,
  LineTodo,
  LineTrash,
} from '@septcats/ui';
import { t } from '../i18n';
import './NavRail.css';

export type RailKey = 'notes' | 'kb' | 'calendar' | 'bitable' | 'todo' | 'home' | 'templates' | 'trash';

interface RailItem {
  key: RailKey;
  /** 可见短标签（双语键）；现作无障碍标签 + tooltip 用 */
  labelKey: string;
  /** tooltip 补一句这级是干什么的 */
  hintKey: string;
  /** 线条图标（@septcats/ui 线族） */
  glyph: typeof LineNote;
}

const ITEMS: readonly RailItem[] = [
  { key: 'notes', labelKey: 'nav.notes', hintKey: 'nav.notesHint', glyph: LineNote },
  { key: 'kb', labelKey: 'nav.kb', hintKey: 'nav.kbHint', glyph: LineBookOpen },
  { key: 'calendar', labelKey: 'nav.calendar', hintKey: 'nav.calendarHint', glyph: LineCalendar },
  { key: 'bitable', labelKey: 'nav.bitable', hintKey: 'nav.bitableHint', glyph: LineTable },
  { key: 'todo', labelKey: 'nav.todo', hintKey: 'nav.todoHint', glyph: LineTodo },
  { key: 'home', labelKey: 'nav.home', hintKey: 'nav.homeHint', glyph: LineHome },
  { key: 'templates', labelKey: 'nav.templates', hintKey: 'nav.templatesHint', glyph: LineLayers },
  { key: 'trash', labelKey: 'nav.trash', hintKey: 'nav.trashHint', glyph: LineTrash },
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
        const label = t(item.labelKey);
        return (
          <button
            key={item.key}
            type="button"
            className={isActive ? 'nav-rail__item nav-rail__item--on' : 'nav-rail__item'}
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
            title={`${label} —— ${t(item.hintKey)}`}
            data-testid={`nav-rail-${item.key}`}
            onClick={() => {
              onSelect(item.key);
            }}
          >
            <Icon icon={item.glyph} size={24} />
            {/* 视觉隐藏的可见标签：读屏=无障碍名（与 aria-label 同源），
                textContent 契约不变（既有断言/探针按文本取标签）。 */}
            <span className="nav-rail__label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}