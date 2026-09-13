/**
 * Aggregations.tsx —— 底部计算行（TASK-T7-01 §1，对齐 03 mockup 的「计算：评分 平均 = 3.67」）。
 *
 * 可用聚合集按属性类型收敛（`view.availableAggregations`）：
 * - number → 计数 / 求和 / 平均；
 * - date   → 计数 / 最早 / 最晚；
 * - 其余   → 只有计数。
 *
 * 空集时展示「—」，不显示 NaN/Infinity；结果文本与数值同源（见 `view.aggregate`）。
 */
import { useMemo, useState } from 'react';
import { Button, CaretDown, Menu, type MenuEntry } from '@septcats/ui';
import { propertyList, type CollectionSchema, type RecordEntity } from '../types';
import { aggregate, aggregationLabel, type Aggregation } from '../view';

export interface AggregationsProps {
  schema: CollectionSchema;
  rows: readonly RecordEntity[];
}

const NONE_ID = '__none__';

export function Aggregations({ schema, rows }: AggregationsProps) {
  const properties = useMemo(() => propertyList(schema), [schema]);
  const [pid, setPid] = useState<string | null>(properties[0]?.id ?? null);
  const [kind, setKind] = useState<Aggregation>('none');
  const [menuOpen, setMenuOpen] = useState(false);

  const property = pid === null ? undefined : schema.properties[pid];
  const result = useMemo(() => aggregate(rows, property, kind), [rows, property, kind]);

  const items: MenuEntry[] = useMemo(() => {
    if (property === undefined) {
      return [];
    }
    const kinds =
      property.type === 'number'
        ? (['none', 'count', 'sum', 'avg'] as const)
        : property.type === 'date'
          ? (['none', 'count', 'earliest', 'latest'] as const)
          : (['none', 'count'] as const);
    return [
      { id: `${NONE_ID}:${property.id}`, label: '不计算' },
      ...kinds
        .filter((entry) => entry !== 'none')
        .map((entry) => ({ id: `${entry}:${property.id}`, label: aggregationLabel(entry) })),
    ];
  }, [property]);

  const label =
    property === undefined || kind === 'none'
      ? '计算'
      : `计算：${property.name} ${aggregationLabel(kind)} = ${result.text === '' ? '—' : result.text}`;

  return (
    <div className="sc-agg">
      <div className="sc-agg__wrap">
        <Button
          variant="ghost"
          size="sm"
          icon={CaretDown}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          {label}
        </Button>
        {menuOpen ? (
          <div className="sc-agg__pop">
            <Menu
              items={items}
              label="计算"
              onSelect={(id) => {
                setMenuOpen(false);
                if (id.startsWith(NONE_ID)) {
                  setKind('none');
                  return;
                }
                const separator = id.indexOf(':');
                if (separator <= 0) {
                  return;
                }
                const nextKind = id.slice(0, separator) as Aggregation;
                const nextPid = id.slice(separator + 1);
                setPid(nextPid);
                setKind(nextKind);
              }}
              onDismiss={() => {
                setMenuOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>
      <span className="sc-agg__count">共 {rows.length} 条</span>
    </div>
  );
}
