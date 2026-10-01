/**
 * DashboardBoard.tsx —— 多维表格「仪表盘」视图（TASK-T102，飞书对标）。
 *
 * 磁贴五型（类型与清洗规则住引擎：dashboardWidgetSchema / resolveWidgets）：
 *   metric（分组计数表）/ distribution（占比色带）/ number（聚合大数字）/ text / divider。
 * 数据口径 = **全库记录**（与看板/画廊一致；顶栏注明，不做视图 filter 二次过滤——
 * 仪表盘回答的是「这张表现怎么样」，不是「筛选后剩什么」）。
 * 所有计算复用引擎纯函数（groupBySelect / aggregate / availableAggregations），渲染层零自造。
 *
 * 色带颜色：用主色透明度梯度（color-mix token 表达式在内联 style 里合法——
 * no-magic 扫的是 CSS 文件；百分比宽度是**数据驱动**，不是设计常量）。
 */
import { useState, type ReactNode } from 'react';
import {
  NONE_GROUP_KEY,
  aggregate,
  availableAggregations,
  groupBySelect,
  propertyList,
  resolveWidgets,
  type Aggregation,
  type CollectionSchema,
  type DashboardWidget,
  type DbView,
  type RecordEntity,
  type WidgetAggregation,
  type WidgetType,
} from '@septcats/dbview';
import { t } from '../i18n';

interface DashboardBoardProps {
  schema: CollectionSchema;
  records: readonly RecordEntity[];
  view: DbView;
  /** 磁贴集变更（增删/换字段/排序）→ 宿主走 saveView 落库。 */
  onPatchWidgets: (next: DashboardWidget[]) => void;
}

/** 选项分布（色带与计数表共用）。 */
function sharesOf(schema: CollectionSchema, groupPid: string | undefined, rows: readonly RecordEntity[]) {
  if (groupPid === undefined) {
    return [];
  }
  const property = propertyList(schema).find((p) => p.id === groupPid);
  const groups = groupBySelect(rows, property);
  if (groups === undefined) {
    return [];
  }
  const total = rows.length === 0 ? 1 : rows.length;
  return groups
    // 「未分组」桶是脏数据兜底、不是声明过的选项：空桶不占图例/色带（有值才现身，提醒数据异常）
    .filter((group) => group.key !== NONE_GROUP_KEY || group.records.length > 0)
    .map((group) => ({
      key: group.key,
      label: group.key === NONE_GROUP_KEY ? t('bitable.groupByNone') : group.label,
      count: group.records.length,
      share: group.records.length / total,
    }));
}

const RAMP = ['86%', '62%', '40%', '24%', '14%', '8%'] as const;

/** 单一磁贴：按 type 分派；config 编辑控件（字段/聚合下拉）内联在卡头。 */
function WidgetTile({
  widget,
  schema,
  records,
  onChange,
  onRemove,
  onMove,
  canUp,
  canDown,
}: {
  widget: DashboardWidget;
  schema: CollectionSchema;
  records: readonly RecordEntity[];
  onChange: (next: DashboardWidget) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  canUp: boolean;
  canDown: boolean;
}): ReactNode {
  const props = propertyList(schema);
  const selectProps = props.filter((p) => p.type === 'select' || p.type === 'multi_select');
  const config = widget.config ?? {};

  const ops = (
    <span className="bitable-tile-ops">
      <button type="button" className="bitable-tile-op" disabled={!canUp} data-testid={`tile-up-${widget.id}`} onClick={() => { onMove(-1); }} aria-label={t('bitable.tileUp')}>↑</button>
      <button type="button" className="bitable-tile-op" disabled={!canDown} data-testid={`tile-down-${widget.id}`} onClick={() => { onMove(1); }} aria-label={t('bitable.tileDown')}>↓</button>
      <button type="button" className="bitable-tile-op" data-testid={`tile-del-${widget.id}`} onClick={onRemove} aria-label={t('bitable.tileDelete')}>×</button>
    </span>
  );

  if (widget.type === 'divider') {
    return (
      <div className="bitable-tile bitable-tile--divider" data-testid={`tile-${widget.id}`}>
        <hr className="bitable-tile-rule" />
        {ops}
      </div>
    );
  }

  if (widget.type === 'text') {
    return (
      <div className="bitable-tile bitable-tile--text" data-testid={`tile-${widget.id}`}>
        <textarea
          className="bitable-tile-text"
          data-testid={`tile-text-${widget.id}`}
          rows={2}
          value={config.text ?? ''}
          onChange={(event) => { onChange({ ...widget, config: { ...config, text: event.target.value.slice(0, 2000) } }); }}
        />
        {ops}
      </div>
    );
  }

  if (widget.type === 'number') {
    const property = props.find((p) => p.id === config.pid) ?? props.find((p) => p.type === 'number') ?? props[0];
    const kinds = property === undefined ? (['count'] as const) : availableAggregations(property.type);
    const agg: WidgetAggregation = (config.agg !== undefined && (kinds as readonly string[]).includes(config.agg)
      ? config.agg
      : kinds[0]) as WidgetAggregation;
    const result = aggregate(records, property, agg as Aggregation);
    return (
      <div className="bitable-tile bitable-tile--number" data-testid={`tile-${widget.id}`}>
        <header className="bitable-tile-head">
          <span className="bitable-tile-title">{property === undefined ? t('bitable.tileNoField') : `${property.name} · ${aggLabel(agg)}`}</span>
          {ops}
        </header>
        <p className="bitable-tile-big" data-testid={`tile-num-${widget.id}`}>{result.text === '' ? '—' : result.text}</p>
        <select
          className="bitable-tile-sel"
          data-testid={`tile-field-${widget.id}`}
          value={property?.id ?? ''}
          onChange={(event) => { onChange({ ...widget, config: { ...config, pid: event.target.value, agg: undefined } }); }}
        >
          {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
    );
  }

  // metric / distribution：都吃 groupPid（select/multi_select）
  const group = props.find((p) => p.id === config.groupPid && (p.type === 'select' || p.type === 'multi_select')) ?? selectProps[0];
  const rows = sharesOf(schema, group?.id, records);
  return (
    <div className={`bitable-tile bitable-tile--${widget.type}`} data-testid={`tile-${widget.id}`}>
      <header className="bitable-tile-head">
        <span className="bitable-tile-title">{group === undefined ? t('bitable.tileNoField') : group.name}</span>
        {ops}
      </header>
      {group === undefined ? (
        <p className="bitable-tile-hint">{t('bitable.tileNeedSelect')}</p>
      ) : (
        <>
          <select
            className="bitable-tile-sel"
            data-testid={`tile-field-${widget.id}`}
            value={group.id}
            onChange={(event) => { onChange({ ...widget, config: { ...config, groupPid: event.target.value } }); }}
          >
            {selectProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {widget.type === 'metric' ? (
            <table className="bitable-tile-table" data-testid={`tile-metric-${widget.id}`}>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td className="bitable-tile-tdnum">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bitable-tile-dist" data-testid={`tile-dist-${widget.id}`}>
              <div className="bitable-tile-ramp" aria-hidden="true">
                {rows.map((row, index) => (
                  <i
                    key={row.key}
                    className="bitable-tile-seg"
                    style={{
                      width: `${(row.share * 100).toFixed(1)}%`,
                      background: `color-mix(in srgb, var(--sc-color-accent) ${RAMP[index % RAMP.length]}, transparent)`,
                    }}
                  />
                ))}
              </div>
              <ul className="bitable-tile-legend">
                {rows.map((row, index) => (
                  <li key={row.key}>
                    <i className="bitable-tile-dot" style={{ background: `color-mix(in srgb, var(--sc-color-accent) ${RAMP[index % RAMP.length]}, transparent)` }} />
                    {row.label} · {row.count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function aggLabel(agg: WidgetAggregation): string {
  switch (agg) {
    case 'sum': return t('bitable.aggSum');
    case 'avg': return t('bitable.aggAvg');
    case 'earliest': return t('bitable.aggEarliest');
    case 'latest': return t('bitable.aggLatest');
    default: return t('bitable.aggCount');
  }
}

/** 各磁贴型的默认 config（新加磁贴时按可用字段取首个）。 */
function defaultConfig(type: WidgetType, schema: CollectionSchema, existing: readonly DashboardWidget[]): DashboardWidget['config'] {
  const props = propertyList(schema);
  if (type === 'text') {
    return { text: '' };
  }
  if (type === 'divider') {
    return undefined;
  }
  if (type === 'number') {
    const used = new Set(existing.filter((w) => w.type === 'number').map((w) => w.config?.pid));
    const num = props.find((p) => p.type === 'number' && !used.has(p.id)) ?? props.find((p) => p.type === 'number') ?? props[0];
    return num === undefined ? {} : { pid: num.id, agg: availableAggregations(num.type)[0] as WidgetAggregation };
  }
  // metric / distribution
  const used = new Set(existing.filter((w) => w.type === type).map((w) => w.config?.groupPid));
  const selects = props.filter((p) => p.type === 'select' || p.type === 'multi_select');
  const pick = selects.find((p) => !used.has(p.id)) ?? selects[0];
  return pick === undefined ? {} : { groupPid: pick.id };
}

let tileSeq = 0;
function nextTileId(): string {
  tileSeq += 1;
  return `w-${Date.now().toString(36)}-${String(tileSeq)}`;
}

export function DashboardBoard({ schema, records, view, onPatchWidgets }: DashboardBoardProps): ReactNode {
  const [adding, setAdding] = useState(false);
  const widgets = view.widgets ?? [];
  // 只画引用有效的磁贴（引擎口径）；但**编辑/删除按原列表下标**操作，失效项不丢配置
  const live = resolveWidgets(schema, view);

  const patchAt = (id: string, next: DashboardWidget): void => {
    onPatchWidgets(widgets.map((w) => (w.id === id ? next : w)));
  };
  const removeAt = (id: string): void => {
    onPatchWidgets(widgets.filter((w) => w.id !== id));
  };
  const moveAt = (id: string, delta: number): void => {
    const index = widgets.findIndex((w) => w.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= widgets.length) {
      return;
    }
    const copy = [...widgets];
    const item = copy.splice(index, 1)[0];
    if (item === undefined) {
      return;
    }
    copy.splice(target, 0, item);
    onPatchWidgets(copy);
  };
  const addTile = (type: WidgetType): void => {
    onPatchWidgets([...widgets, { id: nextTileId(), type, ...((config) => (config === undefined ? {} : { config }))(defaultConfig(type, schema, widgets)) }]);
    setAdding(false);
  };

  return (
    <div className="bitable-dash" data-testid="bitable-dashboard">
      <header className="bitable-dash-head">
        <span className="bitable-dash-scope">{t('bitable.dashAllRows')} · {records.length}{t('bitable.recordSuffix')}</span>
        <span className="bitable-dash-actions">
          <button type="button" className="bitable-btn" data-testid="bitable-dash-add" aria-expanded={adding} onClick={() => { setAdding((open) => !open); }}>
            {t('bitable.dashAddTile')}
          </button>
        </span>
      </header>
      {adding ? (
        <div className="bitable-dash-menu" data-testid="bitable-dash-menu" role="menu" aria-label={t('bitable.dashAddTile')}>
          {(['metric', 'distribution', 'number', 'text', 'divider'] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="bitable-dash-menuitem"
              data-testid={`bitable-dash-new-${type}`}
              onClick={() => { addTile(type); }}
            >
              {tileLabel(type)}
            </button>
          ))}
        </div>
      ) : null}
      {live.length === 0 ? (
        <p className="bitable-empty" data-testid="bitable-empty">{t('bitable.dashEmpty')}</p>
      ) : (
        <div className="bitable-dash-grid">
          {live.map((widget) => (
            <WidgetTile
              key={widget.id}
              widget={widget}
              schema={schema}
              records={records}
              onChange={(next) => { patchAt(widget.id, next); }}
              onRemove={() => { removeAt(widget.id); }}
              onMove={(delta) => { moveAt(widget.id, delta); }}
              canUp={widgets.findIndex((w) => w.id === widget.id) > 0}
              canDown={widgets.findIndex((w) => w.id === widget.id) < widgets.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function tileLabel(type: WidgetType): string {
  switch (type) {
    case 'metric': return t('bitable.tileMetric');
    case 'distribution': return t('bitable.tileDistribution');
    case 'number': return t('bitable.tileNumber');
    case 'text': return t('bitable.tileText');
    default: return t('bitable.tileDivider');
  }
}
