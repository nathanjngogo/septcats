import clsx from 'clsx';
import './Breadcrumb.css';

export interface BreadcrumbItem {
  label: string;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  className?: string;
}

/** Breadcrumb —— 最后一项是当前位置（aria-current="page"），其余为路径。 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="面包屑" className={clsx('sc-crumb', className)}>
      <ol className="sc-crumb__list">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${item.label}-${String(index)}`} className="sc-crumb__item">
              {index > 0 ? (
                <span className="sc-crumb__sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              <span className={isCurrent ? 'sc-crumb__cur' : 'sc-crumb__link'} aria-current={isCurrent ? 'page' : undefined}>
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
