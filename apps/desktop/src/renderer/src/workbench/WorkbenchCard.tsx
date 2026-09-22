/**
 * WorkbenchCard.tsx —— 工作台卡片壳 + ⋯ 配置菜单（TASK-T66-01 §1.4/§1.5）。
 *
 * 像素卡壳：黑框线（--sc-color-ink-edge 2px）+ --sc-pixel-out 抬升，hover 语义
 * 与全站一致（借 T62 token 语法；零字面 hex/px，ui-interaction-audit 门禁面内）。
 * 卡右上 ⋯：显示/隐藏、上移/下移、恢复默认（配置读写走 workbench/state.ts，
 * 菜单本体复用 @septcats/ui Menu——Esc/点空白关闭语义免费）。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { DotsThree, IconButton, Menu } from '@septcats/ui';
import { t } from '../i18n';
import { workbenchActions, workbenchStore, type WorkbenchCardId } from './state';

export interface WorkbenchCardProps {
  cardId: WorkbenchCardId;
  title: string;
  /** 空态/错误态等卡体右上区的附加动作（如数据库卡的「新建库」）。 */
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function WorkbenchCard({ cardId, title, headerExtra, children }: WorkbenchCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const order = workbenchStore.getState().cardOrder;
  const hidden = workbenchStore.getState().hiddenCards;
  const isHidden = hidden.includes(cardId);
  const visible = order.filter((id) => !hidden.includes(id));
  const pos = visible.indexOf(cardId);
  const first = pos === 0;
  const last = pos === visible.length - 1;

  const items = [
    { id: 'toggle', label: t(isHidden ? 'workbench.cardShow' : 'workbench.cardHide') },
    { id: 'up', label: t('workbench.cardMoveUp'), disabled: first },
    { id: 'down', label: t('workbench.cardMoveDown'), disabled: last },
    { id: 'reset', label: t('workbench.cardReset') },
  ];

  return (
    <section
      className="wb-card"
      data-testid={`wb-card-${cardId}`}
      data-hidden={isHidden ? '1' : undefined}
      aria-label={title}
    >
      <header className="wb-card__head">
        <h3 className="wb-card__title">{title}</h3>
        <div className="wb-card__head-actions">
          {headerExtra ?? null}
          <span className={menuOpen ? 'wb-card__menu-wrap wb-card__menu-wrap--open' : 'wb-card__menu-wrap'}>
            <IconButton
              icon={DotsThree}
              label={t('workbench.cardMenu')}
              data-testid={`wb-card-more-${cardId}`}
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
            />
            {menuOpen ? (
              <Menu
                className="wb-card__menu"
                label={t('workbench.cardMenu')}
                items={items}
                onSelect={(id) => {
                  setMenuOpen(false);
                  if (id === 'toggle') {
                    workbenchActions.setCardHidden(cardId, !isHidden);
                  } else if (id === 'up') {
                    workbenchActions.moveCard(cardId, -1);
                  } else if (id === 'down') {
                    workbenchActions.moveCard(cardId, 1);
                  } else if (id === 'reset') {
                    workbenchActions.resetCards();
                  }
                }}
                onDismiss={() => {
                  setMenuOpen(false);
                }}
              />
            ) : null}
          </span>
        </div>
      </header>
      <div className="wb-card__body">{children}</div>
    </section>
  );
}

/** 卡内像素行按钮（快捷行/空态动作共用；样式在 WorkbenchPage.css）。 */
export function WorkbenchPixelButton({
  label,
  glyph,
  onClick,
  testId,
}: {
  label: string;
  /** 装饰性像素 glyph 节点（缺省 = 纯文字钮）。 */
  glyph?: ReactNode;
  onClick(): void;
  testId?: string;
}) {
  return (
    <button type="button" className="wb-pixbtn" data-testid={testId} onClick={onClick}>
      {glyph !== undefined ? <span className="wb-pixbtn__glyph" aria-hidden="true">{glyph}</span> : null}
      <span>{label}</span>
    </button>
  );
}
