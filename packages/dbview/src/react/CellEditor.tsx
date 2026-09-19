/**
 * CellEditor.tsx —— 按属性类型分发的单元格编辑器（TASK-T7-01 §1）。
 *
 * 分派表：
 * | type | 非编辑态 | 编辑态 |
 * |---|---|---|
 * | text/number/url/email | 文本（数字右对齐 mono） | 原生 input（number 用 input[type=number]） |
 * | date | `YYYY-MM-DD` mono | 原生 `input[type=date]` |
 * | select | tag | 菜单（选项 + 「清空」） |
 * | multi_select | tag 组 | 复选菜单（多选，逐项提交） |
 * | checkbox | ✓ / 占位 | 立即切换（无需进入编辑态） |
 * | relation | 目标记录标题（可点击跳转） | 搜索 + 候选列表（多选，逐项提交） |
 * | file | 文件名（一期只读占位） | 同左（不提供编辑器） |
 *
 * 键盘：Enter 提交、Esc 取消由本组件在**编辑态**内处理（并 `stopPropagation`，
 * 避免 TableGrid 的方向键导航抢事件）；未进入编辑态时按键交给 TableGrid。
 *
 * `ai` 列（TASK-T18-04 §2.2）：值 = 纯字符串，非编辑态 = 文本展示 + 「AI 生成」按钮
 * （`onAiGenerate` 未提供则按钮不渲染，库侧保持纯净）；编辑态复用 text 输入器
 * （手工编辑与 text 一致）。
 *
 * 纪律：本文件只 import react + @septcats/ui 图标/Spinner + `../types`/`../values`，无 IO。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon, Sparkle, Spinner } from '@septcats/ui';
import { type FieldType, type Property, type PropertyOption } from '../types';
import { EMPTY_DISPLAY, formatDate, formatValue, parseDateText } from '../values';

/** 关系候选（目标记录的 id + 显示标题）。由调用方从目标 collection 派生。 */
export interface RelationCandidate {
  id: string;
  title: string;
  /** 次级说明（缺省不显示）。 */
  hint?: string | undefined;
}

/** CellEditor 的只读展示所需依赖（select/multi 用 options；relation 用 candidates/标题）。 */
export interface CellDisplayDeps {
  /** 关系候选列表（仅 relation 属性需要）。 */
  relationCandidates?: readonly RelationCandidate[] | undefined;
  /** 关系 id → 标题（relation 单元格默认态显示用）。 */
  relationTitle?: ((id: string) => string | null) | undefined;
  /** 单条关系是否可点击跳转。 */
  onClickRelation?: ((id: string) => void) | undefined;
}

export interface CellEditorProps extends CellDisplayDeps {
  property: Property;
  value: unknown;
  /** 提交新值（空值：`null`）。 */
  onCommit: (value: unknown) => void;
  /** 是否处于编辑态。 */
  editing: boolean;
  /** 请求进入编辑态（Enter / 单击）。 */
  onBeginEdit: () => void;
  /** 退出编辑态（提交或取消后由父级收敛）。 */
  onEndEdit: () => void;
  /** 关系候选为空等情况下禁用编辑（仍可选中单元格）。 */
  disabled?: boolean | undefined;
  /** AI 列：该行是否生成中（busy 态 → 按钮禁用 + spinner）。 */
  aiBusy?: boolean | undefined;
  /** AI 列：单行生成回调；未提供则「AI 生成」按钮不渲染。 */
  onAiGenerate?: (() => void) | undefined;
  /**
   * select/multi_select 单元格内新建选项（TASK-T40-01 §B3）：传入名称 → 创建并返回新选项 id
   * （已存在同名选项时返回既有 id）；未提供则 picker 不渲染新建入口。
   */
  onCreateOption?: ((name: string) => string | undefined) | undefined;
}

/** 链接值口径（与 main 侧 migrateValueForType 的 URL_VALUE_RE 同语义；只放行 http(s)/www.）。 */
const CELL_URL_RE = /^(https?:\/\/|www\.)\S+$/i;
/** 邮箱值口径（宽松：非空白@非空白.非空白）。 */
const CELL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionTone(option: PropertyOption): 'neutral' | 'amber' | 'red' {
  return option.tone ?? 'neutral';
}

/** 多值显示：tag 组（超过 2 个折叠为「+n」）。 */
function TagList({
  ids,
  options,
  titles,
}: {
  ids: readonly string[];
  options?: readonly PropertyOption[] | undefined;
  titles?: ((id: string) => string | null) | undefined;
}) {
  const visible = ids.slice(0, 2);
  const rest = ids.length - visible.length;
  return (
    <span className="sc-dbc-tags">
      {visible.map((id) => {
        const option = options?.find((candidate) => candidate.id === id);
        const label = option?.name ?? titles?.(id) ?? id;
        const tone = option === undefined ? 'neutral' : optionTone(option);
        return (
          <span key={id} className={`sc-dbtag sc-dbtag--${tone}`}>
            {label}
          </span>
        );
      })}
      {rest > 0 ? <span className="sc-dbtag sc-dbtag--neutral">+{String(rest)}</span> : null}
    </span>
  );
}

/** 未编辑态的单元格内容。 */
function CellDisplay({
  property,
  value,
  relationTitle,
  onClickRelation,
}: Pick<CellEditorProps, 'property' | 'value' | 'relationTitle' | 'onClickRelation'>) {
  if (property.type === 'checkbox') {
    return value === true ? (
      <span className="sc-dbc-check sc-dbc-check--on" aria-label="已勾选">
        ✓
      </span>
    ) : (
      <span className="sc-dbc-empty">{EMPTY_DISPLAY}</span>
    );
  }

  if (property.type === 'select' && typeof value === 'string') {
    const option = property.options?.find((candidate) => candidate.id === value);
    if (option === undefined) {
      return <span className="sc-dbc-empty">{EMPTY_DISPLAY}</span>;
    }
    return <span className={`sc-dbtag sc-dbtag--${optionTone(option)}`}>{option.name}</span>;
  }

  if (property.type === 'multi_select' && Array.isArray(value) && value.length > 0) {
    return <TagList ids={value.map(String)} options={property.options} />;
  }

  if (property.type === 'relation' && Array.isArray(value) && value.length > 0) {
    const ids = value.map(String);
    return (
      <span className="sc-dbc-rels">
        {ids.slice(0, 2).map((id) => {
          const title = relationTitle?.(id) ?? id;
          if (onClickRelation === undefined) {
            return (
              <span key={id} className="sc-dbtag sc-dbtag--neutral">
                {title}
              </span>
            );
          }
          return (
            <button
              key={id}
              type="button"
              className="sc-dbtag sc-dbtag--neutral sc-dbtag--link"
              onClick={(event) => {
                event.stopPropagation();
                onClickRelation(id);
              }}
            >
              {title}
            </button>
          );
        })}
        {ids.length > 2 ? (
          <span className="sc-dbtag sc-dbtag--neutral">+{String(ids.length - 2)}</span>
        ) : null}
      </span>
    );
  }

  const text = formatValue(property, value, { relationTitle: relationTitle ?? (() => null) });
  if (text === EMPTY_DISPLAY) {
    return <span className="sc-dbc-empty">{EMPTY_DISPLAY}</span>;
  }
  if (property.type === 'number') {
    return <span className="sc-dbc-num">{text}</span>;
  }
  if (property.type === 'date') {
    return <span className="sc-dbc-date">{text}</span>;
  }
  if (property.type === 'url' || property.type === 'email') {
    const raw = typeof value === 'string' ? value.trim() : '';
    // 链接只放行 http(s)/www.（防 javascript: 注入）；邮箱走 mailto:
    if (property.type === 'url' && CELL_URL_RE.test(raw)) {
      const href = raw.toLowerCase().startsWith('www.') ? `https://${raw}` : raw;
      return (
        <a
          className="sc-dbc-text sc-dbc-text--link"
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            // 不冒泡：点击打开链接 ≠ 进入单元格编辑态
            event.stopPropagation();
          }}
        >
          {text}
        </a>
      );
    }
    if (property.type === 'email' && CELL_EMAIL_RE.test(raw)) {
      return (
        <a
          className="sc-dbc-text sc-dbc-text--link"
          href={`mailto:${raw}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {text}
        </a>
      );
    }
    return <span className="sc-dbc-text">{text}</span>;
  }
  return <span className="sc-dbc-text">{text}</span>;
}

/** 复选菜单（multi_select / relation 共用）。 */
function MultiPicker({
  candidates,
  selected,
  searchable,
  onToggle,
  onClose,
  onCreateOption,
}: {
  candidates: readonly RelationCandidate[];
  selected: readonly string[];
  searchable: boolean;
  onToggle: (id: string) => void;
  onClose: () => void;
  /** 仅 multi_select 提供（relation 不新建记录）。 */
  onCreateOption?: ((name: string) => string | undefined) | undefined;
}) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    if (query.trim().length === 0) {
      return candidates;
    }
    const needle = query.trim().toLowerCase();
    return candidates.filter((candidate) => candidate.title.toLowerCase().includes(needle));
  }, [candidates, query]);

  return (
    <div className="sc-dbc-picker" ref={rootRef} role="listbox" aria-multiselectable="true">
      {searchable ? (
        <input
          autoFocus
          className="sc-dbc-picker__search"
          value={query}
          placeholder="搜索记录"
          aria-label="搜索记录"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
          }}
        />
      ) : null}
      <ul className="sc-dbc-picker__list">
        {filtered.length === 0 ? (
          <li className="sc-dbc-picker__empty">没有匹配项</li>
        ) : (
          filtered.map((candidate) => {
            const on = selected.includes(candidate.id);
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={on ? 'sc-dbc-picker__item sc-dbc-picker__item--on' : 'sc-dbc-picker__item'}
                  onClick={() => {
                    onToggle(candidate.id);
                  }}
                >
                  <span className="sc-dbc-picker__tick" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="sc-dbc-picker__label">{candidate.title}</span>
                  {candidate.hint === undefined ? null : (
                    <span className="sc-dbc-picker__hint">{candidate.hint}</span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
      {onCreateOption !== undefined ? (
        <CreateOptionRow
          onCreate={(name) => {
            const id = onCreateOption(name);
            if (id !== undefined) {
              onToggle(id);
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** picker 底部的「新建选项」输入（select/multi_select 共用；TASK-T40-01 §B3）。 */
function CreateOptionRow({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    onCreate(trimmed);
    setName('');
  };
  return (
    <div className="sc-dbc-picker__create">
      <input
        className="sc-dbc-picker__create-input"
        value={name}
        placeholder="新建选项…"
        aria-label="新建选项"
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            submit();
            return;
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
          }
        }}
      />
      <button type="button" className="sc-dbc-picker__create-btn" onClick={submit}>
        添加
      </button>
    </div>
  );
}

/** 单值菜单（select 用）。 */
function SinglePicker({
  options,
  selected,
  onPick,
  onClose,
  onCreateOption,
}: {
  options: readonly PropertyOption[];
  selected: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  onCreateOption?: ((name: string) => string | undefined) | undefined;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  return (
    <div className="sc-dbc-picker" ref={rootRef} role="listbox">
      <ul className="sc-dbc-picker__list">
        {options.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={option.id === selected}
              autoFocus={index === 0}
              className={
                option.id === selected ? 'sc-dbc-picker__item sc-dbc-picker__item--on' : 'sc-dbc-picker__item'
              }
              onClick={() => {
                onPick(option.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  onClose();
                }
              }}
            >
              <span className="sc-dbc-picker__tick" aria-hidden="true">
                {option.id === selected ? '✓' : ''}
              </span>
              <span className={`sc-dbtag sc-dbtag--${optionTone(option)}`}>{option.name}</span>
            </button>
          </li>
        ))}
        {selected === null ? null : (
          <li>
            <button
              type="button"
              className="sc-dbc-picker__item sc-dbc-picker__clear"
              onClick={() => {
                onPick(null);
              }}
            >
              清空
            </button>
          </li>
        )}
      </ul>
      {onCreateOption !== undefined ? (
        <CreateOptionRow
          onCreate={(name) => {
            const id = onCreateOption(name);
            if (id !== undefined) {
              onPick(id);
              onClose();
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** 简单文本/数字/日期输入（Enter 提交、Esc 取消由本组件收敛）。 */
function PlainEditor({
  type,
  initial,
  onCommit,
  onCancel,
}: {
  type: 'text' | 'number' | 'date' | 'url' | 'email';
  initial: string;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  // url/email 格式校验（TASK-T40-01 §B1）：非法时 Enter 不提交、保持编辑态并标错
  const [invalid, setInvalid] = useState(false);

  const validOf = useCallback(
    (text: string): boolean => {
      if (type === 'url') {
        const trimmed = text.trim();
        return trimmed.length === 0 || CELL_URL_RE.test(trimmed);
      }
      if (type === 'email') {
        const trimmed = text.trim();
        return trimmed.length === 0 || CELL_EMAIL_RE.test(trimmed);
      }
      return true;
    },
    [type],
  );

  const submit = useCallback((): void => {
    if (type === 'number') {
      const trimmed = draft.trim();
      if (trimmed.length === 0) {
        onCommit(null);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        onCancel();
        return;
      }
      onCommit(parsed);
      return;
    }
    if (type === 'date') {
      const trimmed = draft.trim();
      if (trimmed.length === 0) {
        onCommit(null);
        return;
      }
      const parsed = parseDateText(trimmed);
      if (parsed === null) {
        onCancel();
        return;
      }
      onCommit(parsed);
      return;
    }
    if (!validOf(draft)) {
      setInvalid(true);
      return; // 校验不过：不提交（失焦时由外层 onCancel 收敛）
    }
    onCommit(draft);
  }, [draft, onCancel, onCommit, type, validOf]);

  const inputType =
    type === 'url' ? 'url' : type === 'email' ? 'email' : type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';

  return (
    <span className={type === 'date' ? 'sc-dbc-dateedit' : undefined}>
      <input
        autoFocus
        className={type === 'number' ? 'sc-dbc-input sc-dbc-input--num' : 'sc-dbc-input'}
        type={inputType}
        value={draft}
        aria-label="单元格编辑"
        aria-invalid={invalid || undefined}
        data-invalid={invalid ? 'true' : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          if (invalid) {
            setInvalid(!validOf(event.target.value));
          }
        }}
        onFocus={(event) => {
          if (type === 'text' || type === 'url' || type === 'email') {
            event.currentTarget.select();
          }
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            submit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={submit}
      />
      {type === 'date' ? (
        <button
          type="button"
          className="sc-dbc-dateedit__clear"
          aria-label="清空日期"
          onMouseDown={(event) => {
            // 阻止 input 先失焦触发 submit 覆盖清空意图
            event.preventDefault();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onCommit(null);
          }}
        >
          清空
        </button>
      ) : null}
    </span>
  );
}

/**
 * 单元格编辑器主入口。未进入编辑态时只渲染展示层；
 * `checkbox` 例外：不进编辑态，单击/Enter 直接切换。
 */
export function CellEditor({
  property,
  value,
  onCommit,
  editing,
  onBeginEdit,
  onEndEdit,
  relationCandidates,
  relationTitle,
  onClickRelation,
  disabled = false,
  aiBusy = false,
  onAiGenerate,
  onCreateOption,
}: CellEditorProps) {
  const type: FieldType = property.type;

  const candidates = useMemo<RelationCandidate[]>(() => {
    if (type === 'relation') {
      return relationCandidates === undefined ? [] : [...relationCandidates];
    }
    if (type === 'select' || type === 'multi_select') {
      return (property.options ?? []).map((option) => ({ id: option.id, title: option.name }));
    }
    return [];
  }, [property.options, relationCandidates, type]);

  const selectedIds = useMemo<string[]>(() => {
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === 'string' && value.length > 0) {
      return [value];
    }
    return [];
  }, [value]);

  const onCellKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (editing || disabled) {
      return;
    }
    if (type === 'checkbox' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      onCommit(value === true ? null : true);
      return;
    }
    if (type !== 'checkbox' && type !== 'file' && event.key === 'Enter') {
      // Enter 进入编辑态（编辑态内 Enter 由 PlainEditor 收敛为提交）
      event.preventDefault();
      event.stopPropagation();
      onBeginEdit();
    }
  };

  const initialText =
    type === 'date'
      ? (() => {
          const parsed = value as { y?: number; m?: number; d?: number } | null | undefined;
          if (parsed === null || parsed === undefined || typeof parsed.y !== 'number') {
            return '';
          }
          return formatDate({ y: parsed.y, m: parsed.m ?? 1, d: parsed.d ?? 1 });
        })()
      : value === undefined || value === null
        ? ''
        : typeof value === 'string'
          ? value
          : String(value);

  const showDisplay =
    !editing || (type !== 'text' && type !== 'number' && type !== 'url' && type !== 'email' && type !== 'date' && type !== 'select' && type !== 'multi_select' && type !== 'relation' && type !== 'ai');

  return (
    <div
      className="sc-dbc"
      data-editing={editing ? 'true' : 'false'}
      data-type={type}
      onKeyDown={onCellKeyDown}
      onClick={() => {
        if (disabled) {
          return;
        }
        // checkbox：单击直接切换，不进编辑态（T40-01-1：原先在此早退，但内层
        // 元素永不获焦、键盘分支同样收不到事件，导致勾选值两条路径都写不进去）
        if (type === 'checkbox') {
          onCommit(value === true ? null : true);
          return;
        }
        if (type === 'file') {
          return;
        }
        if (!editing) {
          onBeginEdit();
        }
      }}
      role="presentation"
    >
      {editing && (type === 'text' || type === 'number' || type === 'url' || type === 'email' || type === 'date' || type === 'ai') ? (
        <PlainEditor
          type={type === 'ai' ? 'text' : type}
          initial={initialText}
          onCommit={(next) => {
            onCommit(next);
            onEndEdit();
          }}
          onCancel={onEndEdit}
        />
      ) : null}

      {editing && type === 'select' ? (
        <SinglePicker
          options={property.options ?? []}
          selected={typeof value === 'string' ? value : null}
          onPick={(id) => {
            onCommit(id);
            onEndEdit();
          }}
          onClose={onEndEdit}
          onCreateOption={onCreateOption}
        />
      ) : null}

      {editing && (type === 'multi_select' || type === 'relation') ? (
        <MultiPicker
          candidates={candidates}
          selected={selectedIds}
          searchable={type === 'relation'}
          onToggle={(id) => {
            const next = selectedIds.includes(id)
              ? selectedIds.filter((item) => item !== id)
              : [...selectedIds, id];
            onCommit(next.length === 0 ? null : next);
          }}
          onClose={onEndEdit}
          onCreateOption={type === 'multi_select' ? onCreateOption : undefined}
        />
      ) : null}

      {showDisplay ? (
        <CellDisplay
          property={property}
          value={value}
          relationTitle={relationTitle ?? (() => null)}
          onClickRelation={onClickRelation}
        />
      ) : null}

      {type === 'ai' && !editing && onAiGenerate !== undefined ? (
        <button
          type="button"
          className="sc-dbc-aibtn"
          aria-label="AI 生成"
          aria-busy={aiBusy ? 'true' : undefined}
          disabled={aiBusy}
          onClick={(event) => {
            event.stopPropagation();
            onAiGenerate();
          }}
        >
          {aiBusy ? <Spinner size="sm" label="AI 生成中" /> : <Icon icon={Sparkle} size="sm" />}
        </button>
      ) : null}
    </div>
  );
}
