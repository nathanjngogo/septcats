/**
 * CommandPalette.tsx —— Ctrl/Cmd+K 命令面板（TASK-T8-01 §3，视觉基准 = mockup 04）。
 *
 * 组装（纯 UI；逻辑在 state/palette.ts 与 palette/rank.ts）：
 * - 双路打开：renderer keydown + 主进程 CHANNEL_PALETTE_TOGGLE 广播（toggle 护栏去重）；
 * - 输入态：debounce 150ms 搜索（store）+ 命令过滤（rank.ts）；`>` 仅命令、`@` 仅页面；
 * - 键盘：↑↓ 循环、Enter 执行、Esc 关；hover 同步 activeIndex；
 * - 无障碍：role=combobox + listbox + aria-activedescendant + aria-expanded；
 *   焦点进面板自动全选文本（§3 红线）。
 */
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { FileText, GearSix, Icon, Kbd, MagnifyingGlass, Note, Plus } from '@septcats/ui';
import type { IconGlyph } from '@septcats/ui';
import { t } from '../i18n';
import { paletteActions, usePalette } from '../state/palette';
import { templatesActions, useTemplates } from '../state/templates';
import type { TemplateMeta } from '../../../main/templates';
import { TemplateIcon } from '../templates/TemplateIcon';
import { rankPalette } from './rank';
import type { CommandLike, HitLike, PaletteView } from './rank';
import './CommandPalette.css';

interface PaletteRow {
  key: string;
  /** 分组标题行（不可选）。 */
  header?: string;
  /** 可选行内容。 */
  option?: {
    selectableIndex: number;
    /** 图标槽（T23-02：模板行可携带数据 icon → 节点而非字形）。 */
    iconNode: ReactNode;
    title: ReactNode;
    meta?: ReactNode;
    onHover: () => void;
    onPick: () => void;
  };
}

/** label 中首个 query 出现处加粗（mockup 04 的 `<b>移动</b>到…`）。 */
function highlightMatch(label: string, raw: string): ReactNode {
  const needle = raw.trim().toLowerCase();
  if (needle.length === 0) {
    return label;
  }
  const index = label.toLowerCase().indexOf(needle);
  if (index < 0) {
    return label;
  }
  return (
    <>
      {label.slice(0, index)}
      <b>{label.slice(index, index + needle.length)}</b>
      {label.slice(index + needle.length)}
    </>
  );
}

function commandIcon(command: CommandLike): IconGlyph {
  return command.id === 'page.new' ? Plus : GearSix;
}

function glyphNode(icon: IconGlyph, className: string): ReactNode {
  return <Icon icon={icon} size="sm" className={className} />;
}

function templateIconNode(template: TemplateMeta): ReactNode {
  return <TemplateIcon template={template} className="palette-row-ic" />;
}

function hitTitle(hit: HitLike): ReactNode {
  return (
    <>
      {hit.title}
      {hit.path.length > 0 ? <span className="palette-path"> / {hit.path.join(' / ')}</span> : null}
    </>
  );
}

function buildRows(
  view: PaletteView<CommandLike, HitLike, TemplateMeta>,
): PaletteRow[] {
  const rows: PaletteRow[] = [];
  let selectableIndex = 0;
  if (view.commands.length > 0) {
    rows.push({ key: 'h-cmd', header: '命令' });
    for (const command of view.commands) {
      const index = selectableIndex;
      selectableIndex += 1;
      rows.push({
        key: `cmd-${command.id}`,
        option: {
          selectableIndex: index,
          iconNode: glyphNode(commandIcon(command), 'palette-row-ic'),
          title: highlightMatch(command.label, view.raw),
          meta: <span className="palette-hint">{command.hint}</span>,
          onHover: (): void => paletteActions.setActive(index),
          onPick: (): void => paletteActions.executeActive(),
        },
      });
    }
  }
  if (view.pageHits.length > 0) {
    rows.push({ key: 'h-page', header: '页面与跳转' });
    for (const hit of view.pageHits) {
      const index = selectableIndex;
      selectableIndex += 1;
      rows.push({
        key: `hit-${hit.kind}-${hit.id}`,
        option: {
          selectableIndex: index,
          iconNode: glyphNode(FileText, 'palette-row-ic'),
          title: hitTitle(hit),
          meta: <span className="palette-hint">页面</span>,
          onHover: (): void => paletteActions.setActive(index),
          onPick: (): void => paletteActions.executeActive(),
        },
      });
    }
  }
  if (view.dbHits.length > 0) {
    rows.push({ key: 'h-db', header: '数据库' });
    for (const hit of view.dbHits) {
      const index = selectableIndex;
      selectableIndex += 1;
      rows.push({
        key: `hit-${hit.kind}-${hit.id}`,
        option: {
          selectableIndex: index,
          iconNode: glyphNode(Note, 'palette-row-ic'),
          title: hitTitle(hit),
          meta: <span className="palette-hint">数据库</span>,
          onHover: (): void => paletteActions.setActive(index),
          onPick: (): void => paletteActions.executeActive(),
        },
      });
    }
  }
  // T23-02 §C.2：模板独立分组（排最后），行文案「从模板新建：<名称>」；检索已按模板标题过滤
  if (view.templates.length > 0) {
    rows.push({ key: 'h-tpl', header: t('templates.group') });
    for (const template of view.templates) {
      const index = selectableIndex;
      selectableIndex += 1;
      rows.push({
        key: `tpl-${template.id}`,
        option: {
          selectableIndex: index,
          iconNode: templateIconNode(template),
          title: highlightMatch(`${t('templates.createFromPrefix')}${template.title}`, view.raw),
          meta: <span className="palette-hint">{t('templates.rowMeta')}</span>,
          onHover: (): void => paletteActions.setActive(index),
          onPick: (): void => paletteActions.executeActive(),
        },
      });
    }
  }
  return rows;
}

export function CommandPalette() {
  const open = usePalette((state) => state.open);
  const query = usePalette((state) => state.query);
  const activeIndex = usePalette((state) => state.activeIndex);
  const hits = usePalette((state) => state.hits);
  const commands = usePalette((state) => state.commands);
  const searching = usePalette((state) => state.searching);
  // T23-02 §E：模板分组订阅同一 slice（新建/重命名/删除后随 store 刷新）
  const templates = useTemplates((state) => state.templates);

  const inputRef = useRef<HTMLInputElement>(null);

  const view = useMemo(() => rankPalette(query, commands, hits, templates), [query, commands, hits, templates]);
  const rows = useMemo(() => buildRows(view), [view]);

  // 打开：焦点进输入框并全选（§3）；并行拉模板列表（§C.2，失败回落空分组）
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
      void templatesActions.loadTemplates();
    }
  }, [open]);

  // 双路 Ctrl/Cmd+K：renderer keydown + 主进程广播（toggle 内有护栏）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        paletteActions.toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const unsub =
      (globalThis as { septcats?: { search?: { onTogglePalette(listener: () => void): () => void } } })
        .septcats?.search?.onTogglePalette(() => paletteActions.toggle()) ?? null;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsub?.();
    };
  }, []);

  if (!open) {
    return null;
  }

  const hasResults = rows.some((row) => row.option !== undefined);
  const activeId = hasResults ? `palette-opt-${String(activeIndex)}` : undefined;

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        paletteActions.moveActive(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        paletteActions.moveActive(-1);
        return;
      case 'Enter':
        event.preventDefault();
        paletteActions.executeActive();
        return;
      case 'Escape':
        event.preventDefault();
        paletteActions.close();
        return;
      default:
        return;
    }
  };

  return (
    <div
      className="palette-overlay"
      data-testid="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          paletteActions.close();
        }
      }}
    >
      <div className="palette" role="dialog" aria-label="命令面板" data-testid="palette-panel">
        <div className="palette-input">
          <Icon icon={MagnifyingGlass} size="sm" className="palette-input-ic" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="septcats-palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="搜索或输入命令"
            placeholder="搜索页面、数据库，或输入 > 命令"
            value={query}
            onChange={(event) => paletteActions.setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            spellCheck={false}
          />
          <span className="palette-esc">Esc 关闭</span>
        </div>
        <div className="palette-list" role="listbox" id="septcats-palette-list">
          {hasResults ? (
            rows.map((row) =>
              row.header !== undefined ? (
                <div key={row.key} className="palette-group" role="presentation">
                  {row.header}
                </div>
              ) : (
                ((): ReactNode => {
                  const option = row.option;
                  if (option === undefined) {
                    return null;
                  }
                  const active = option.selectableIndex === activeIndex;
                  return (
                    <div
                      key={row.key}
                      id={`palette-opt-${String(option.selectableIndex)}`}
                      role="option"
                      aria-selected={active}
                      className={active ? 'palette-row palette-row--active' : 'palette-row'}
                      onMouseEnter={option.onHover}
                      onClick={option.onPick}
                    >
                      {option.iconNode}
                      <span className="palette-row-tx">{option.title}</span>
                      {option.meta === undefined ? null : (
                        <span className="palette-row-meta">{option.meta}</span>
                      )}
                    </div>
                  );
                })()
              ),
            )
          ) : (
            <div className="palette-empty" role="presentation">
              {searching ? '搜索中…' : '没有匹配的命令或内容'}
            </div>
          )}
          {query.trim().length > 0 && !query.startsWith('>') ? (
            <button
              type="button"
              className="palette-opensearch"
              onClick={() => paletteActions.openSearchPage()}
            >
              在搜索结果页打开「{query.trim()}」
            </button>
          ) : null}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> 选择
          </span>
          <span>
            <Kbd>Enter</Kbd> 执行
          </span>
          <span>
            <Kbd>&gt;</Kbd> 仅命令
          </span>
          <span>
            <Kbd>@</Kbd> 仅页面
          </span>
        </div>
      </div>
    </div>
  );
}
