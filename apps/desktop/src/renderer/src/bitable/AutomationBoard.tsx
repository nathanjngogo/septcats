/**
 * AutomationBoard.tsx —— 多维表格「自动化」视图（TASK-T102，飞书「流程自动化」对标）。
 *
 * 一条规则 = 触发（当记录 创建/更新·字段）+ 条件（当 字段 等于 值）+ 动作（写入 字段=值）。
 * 执行在主进程 createRecord/updateRecord（不动点 ≤5 轮），界面只负责**编辑配置**——
 * 经 saveView({rules}) 落库，与看板 groupPid/画廊 coverPid 同一条通道。
 *
 * 值编辑器：if/set 的目标字段若是 select ⇒ 选项下拉；number ⇒ 数字框；checkbox ⇒ 三态；
 * 其余文本框（引擎 equalsValue 对字符串按文本比较，口径统一）。
 */
import type { ReactNode } from 'react';
import {
  propertyList,
  type AutomationRule,
  type CollectionEntity,
  type DbView,
  type Property,
} from '@septcats/dbview';
import { t } from '../i18n';

interface AutomationBoardProps {
  collection: CollectionEntity;
  view: DbView;
  onPatchRules: (next: AutomationRule[]) => void;
}

let ruleSeq = 0;
function nextRuleId(): string {
  ruleSeq += 1;
  return `ar-${Date.now().toString(36)}-${String(ruleSeq)}`;
}

/** 编辑器里的规则值（字符串 ↔ 真值按字段类型往返）。 */
function editValue(property: Property | undefined, raw: unknown): string {
  if (property === undefined) {
    return typeof raw === 'string' ? raw : '';
  }
  if (property.type === 'checkbox') {
    return raw === true ? 'true' : (raw === false ? 'false' : '');
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

function parseValue(property: Property | undefined, text: string): unknown {
  if (property === undefined) {
    return text;
  }
  switch (property.type) {
    case 'number': {
      const n = Number(text);
      return text.length > 0 && Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return text === 'true' ? true : (text === 'false' ? false : null);
    default:
      return text;
  }
}

function ValueControl({ property, value, onChange, testid }: {
  property: Property | undefined;
  value: unknown;
  onChange: (next: unknown) => void;
  testid: string;
}): ReactNode {
  if (property !== undefined && (property.type === 'select' || property.type === 'multi_select')) {
    return (
      <select className="bitable-rule-input" data-testid={testid} value={typeof value === 'string' ? value : ''} onChange={(event) => { onChange(event.target.value === '' ? null : event.target.value); }}>
        <option value="">{t('bitable.ruleValueEmpty')}</option>
        {(property.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    );
  }
  if (property !== undefined && property.type === 'checkbox') {
    return (
      <select className="bitable-rule-input" data-testid={testid} value={editValue(property, value)} onChange={(event) => { onChange(event.target.value === 'true' ? true : (event.target.value === 'false' ? false : null)); }}>
        <option value="">{t('bitable.ruleValueEmpty')}</option>
        <option value="true">{t('bitable.ruleValueYes')}</option>
        <option value="false">{t('bitable.ruleValueNo')}</option>
      </select>
    );
  }
  return (
    <input
      className="bitable-rule-input"
      data-testid={testid}
      type={property?.type === 'number' ? 'number' : 'text'}
      value={editValue(property, value)}
      onChange={(event) => { onChange(parseValue(property, event.target.value)); }}
    />
  );
}

function RuleCard({ rule, properties, index, count, onChange, onRemove, onMove }: {
  rule: AutomationRule;
  properties: readonly Property[];
  index: number;
  count: number;
  onChange: (next: AutomationRule) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}): ReactNode {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const ifProp = byId.get(rule.if.pid);
  const setProp = byId.get(rule.set.pid);
  return (
    <article className="bitable-rule" data-testid={`bitable-rule-${rule.id}`}>
      <header className="bitable-rule-head">
        <input
          className="bitable-rule-name"
          data-testid={`bitable-rule-name-${rule.id}`}
          value={rule.name}
          placeholder={t('bitable.ruleNamePh')}
          onChange={(event) => { onChange({ ...rule, name: event.target.value }); }}
        />
        <label className="bitable-rule-switch">
          <input
            type="checkbox"
            data-testid={`bitable-rule-enabled-${rule.id}`}
            checked={rule.enabled}
            onChange={(event) => { onChange({ ...rule, enabled: event.target.checked }); }}
          />
          {t('bitable.ruleEnabled')}
        </label>
        <span className="bitable-rule-ops">
          <button type="button" className="bitable-tile-op" disabled={index === 0} data-testid={`bitable-rule-up-${rule.id}`} onClick={() => { onMove(-1); }} aria-label={t('bitable.ruleUp')}>↑</button>
          <button type="button" className="bitable-tile-op" disabled={index >= count - 1} data-testid={`bitable-rule-down-${rule.id}`} onClick={() => { onMove(1); }} aria-label={t('bitable.ruleDown')}>↓</button>
          <button type="button" className="bitable-tile-op" data-testid={`bitable-rule-del-${rule.id}`} onClick={onRemove} aria-label={t('bitable.ruleDelete')}>×</button>
        </span>
      </header>
      <div className="bitable-rule-flow">
        {/* 触发 */}
        <span className="bitable-rule-seg">
          <span className="bitable-rule-word">{t('bitable.ruleWhen')}</span>
          <select className="bitable-rule-input" data-testid={`bitable-rule-kind-${rule.id}`} value={rule.on.kind} onChange={(event) => { onChange({ ...rule, on: { kind: event.target.value as 'create' | 'update', ...(rule.on.pid === undefined ? {} : { pid: rule.on.pid }) } }); }}>
            <option value="create">{t('bitable.ruleOnCreate')}</option>
            <option value="update">{t('bitable.ruleOnUpdate')}</option>
          </select>
          <select className="bitable-rule-input" data-testid={`bitable-rule-onpid-${rule.id}`} value={rule.on.pid ?? ''} onChange={(event) => {
            const pid = event.target.value;
            onChange({ ...rule, on: { kind: rule.on.kind, ...(pid.length === 0 ? {} : { pid }) } });
          }}>
            <option value="">{t('bitable.ruleAnyField')}</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
        {/* 条件 */}
        <span className="bitable-rule-seg">
          <span className="bitable-rule-word">{t('bitable.ruleIf')}</span>
          <select className="bitable-rule-input" data-testid={`bitable-rule-ifpid-${rule.id}`} value={rule.if.pid} onChange={(event) => { onChange({ ...rule, if: { pid: event.target.value, eq: null } }); }}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="bitable-rule-word">=</span>
          <ValueControl property={ifProp} value={rule.if.eq} onChange={(eq) => { onChange({ ...rule, if: { pid: rule.if.pid, eq } }); }} testid={`bitable-rule-eq-${rule.id}`} />
        </span>
        {/* 动作 */}
        <span className="bitable-rule-seg">
          <span className="bitable-rule-word">{t('bitable.ruleThen')}</span>
          <select className="bitable-rule-input" data-testid={`bitable-rule-setpid-${rule.id}`} value={rule.set.pid} onChange={(event) => { onChange({ ...rule, set: { pid: event.target.value, to: null } }); }}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="bitable-rule-word">=</span>
          <ValueControl property={setProp} value={rule.set.to} onChange={(to) => { onChange({ ...rule, set: { pid: rule.set.pid, to } }); }} testid={`bitable-rule-to-${rule.id}`} />
        </span>
      </div>
    </article>
  );
}

export function AutomationBoard({ collection, view, onPatchRules }: AutomationBoardProps): ReactNode {
  const properties = propertyList(collection.schema);
  const rules = view.rules ?? [];

  const startCreate = (): void => {
    const first = properties[0];
    if (first === undefined) {
      return;
    }
    const title = properties.find((p) => p.id === collection.schema.title_pid) ?? first;
    onPatchRules([...rules, {
      id: nextRuleId(),
      name: '',
      enabled: true,
      on: { kind: 'update', pid: title.id },
      if: { pid: title.id, eq: '' },
      set: { pid: title.id, to: '' },
    }]);
  };
  const patchAt = (id: string, next: AutomationRule): void => {
    onPatchRules(rules.map((r) => (r.id === id ? next : r)));
  };
  const removeAt = (id: string): void => {
    onPatchRules(rules.filter((r) => r.id !== id));
  };
  const moveAt = (id: string, delta: number): void => {
    const index = rules.findIndex((r) => r.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= rules.length) {
      return;
    }
    const copy = [...rules];
    const item = copy.splice(index, 1)[0];
    if (item === undefined) {
      return;
    }
    copy.splice(target, 0, item);
    onPatchRules(copy);
  };

  return (
    <div className="bitable-auto" data-testid="bitable-automation">
      <header className="bitable-dash-head">
        <span className="bitable-dash-scope">{t('bitable.autoHint')}</span>
        <button type="button" className="bitable-btn" data-testid="bitable-rule-new" onClick={startCreate}>
          +{t('bitable.ruleAdd')}
        </button>
      </header>
      {rules.length === 0 ? (
        <p className="bitable-empty" data-testid="bitable-empty">{t('bitable.autoEmpty')}</p>
      ) : (
        rules.map((rule, index) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            properties={properties}
            index={index}
            count={rules.length}
            onChange={(next) => { patchAt(rule.id, next); }}
            onRemove={() => { removeAt(rule.id); }}
            onMove={(delta) => { moveAt(rule.id, delta); }}
          />
        ))
      )}
    </div>
  );
}
