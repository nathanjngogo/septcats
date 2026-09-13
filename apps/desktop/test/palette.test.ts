/**
 * palette.test.ts —— 命令面板纯函数（TASK-T8-01 §4）。
 *
 * 覆盖：拼音/别名打分（'sz'→设置）、无命中（'yin'→打印不存在）、空 query 默认命令序
 * 稳定、`>`/`@` 前缀模式、键盘行数计算。
 */
import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../src/shared/search';
import {
  COMMAND_DEFS,
  bindPaletteCommands,
} from '../src/renderer/src/palette/commands';
import {
  parsePaletteMode,
  rankCommands,
  rankPalette,
  selectableRowCount,
  scoreCommand,
} from '../src/renderer/src/palette/rank';

function hit(overrides: Partial<SearchHit> & Pick<SearchHit, 'id' | 'kind'>): SearchHit {
  return {
    pageId: 'pg-1',
    title: '标题',
    path: [],
    snippet: '',
    score: 0,
    via: 'fts',
    updatedAt: 0,
    ...overrides,
  };
}

describe('命令清单（COMMAND_DEFS）', () => {
  it('id 唯一、别名非空', () => {
    const ids = COMMAND_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of COMMAND_DEFS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.aliases.length).toBeGreaterThan(0);
    }
  });

  it('§3 静态清单覆盖：新建页面/切换工作区/打开设置/主题×3/导出/回收站/同步面板/导入', () => {
    for (const id of ['page.new', 'workspace.switch', 'app.settings', 'theme.light', 'theme.dark', 'theme.system', 'app.export', 'app.trash', 'app.sync', 'app.import']) {
      expect(COMMAND_DEFS.some((def) => def.id === id), `缺少命令 ${id}`).toBe(true);
    }
  });

  it('bindPaletteCommands：id → 行为穷尽绑定', () => {
    const calls: string[] = [];
    const commands = bindPaletteCommands({
      createPage: () => calls.push('page.new'),
      switchToNextWorkspace: () => calls.push('workspace.switch'),
      openTrash: () => calls.push('app.trash'),
      notify: (message) => calls.push(`notify:${message}`),
      setThemeMode: (mode) => calls.push(`theme:${mode}`),
    });
    for (const command of commands) {
      command.run();
    }
    expect(calls).toContain('page.new');
    expect(calls).toContain('workspace.switch');
    expect(calls).toContain('app.trash');
    expect(calls).toContain('theme:light');
    expect(calls).toContain('theme:dark');
    expect(calls).toContain('theme:system');
    // 暂未落地里程碑的命令：notify 兜底，不是静默 no-op
    expect(calls.filter((call) => call.startsWith('notify:')).length).toBe(4);
  });
});

describe('rankCommands（拼音/别名/模糊打分）', () => {
  it("'sz' → 设置（拼音首字母全等）", () => {
    const ranked = rankCommands('sz', COMMAND_DEFS);
    expect(ranked[0]?.id).toBe('app.settings');
    expect(ranked[0]?.label).toBe('打开设置');
  });

  it("'shezhi' → 设置（拼音全拼前缀）", () => {
    expect(rankCommands('shezhi', COMMAND_DEFS)[0]?.id).toBe('app.settings');
  });

  it("'设置' → 设置（中文 label 子串）", () => {
    expect(rankCommands('设置', COMMAND_DEFS)[0]?.id).toBe('app.settings');
  });

  it("'yin' → 无命中（不存在打印类命令，绝不硬凑）", () => {
    expect(rankCommands('yin', COMMAND_DEFS)).toEqual([]);
  });

  it('空 query 返回全部命令且顺序 = 内置序（稳定）', () => {
    const ranked = rankCommands('', COMMAND_DEFS);
    expect(ranked.map((command) => command.id)).toEqual(COMMAND_DEFS.map((def) => def.id));
    // 再跑一遍同序：绝不抖动
    expect(rankCommands('', COMMAND_DEFS).map((command) => command.id)).toEqual(
      ranked.map((command) => command.id),
    );
  });

  it('英文别名命中（trash → 回收站）', () => {
    expect(rankCommands('trash', COMMAND_DEFS)[0]?.id).toBe('app.trash');
  });

  it('scoreCommand 通道分级：label > 别名全等 > 前缀 > 包含', () => {
    const item = { id: 'x', label: '打开设置', aliases: ['sz', 'ashe'] };
    const total = 10;
    expect(scoreCommand(item, '设置', 0, total)).toBe(400 + total);
    expect(scoreCommand(item, 'sz', 0, total)).toBe(350 + total);
    expect(scoreCommand(item, 'as', 0, total)).toBe(300 + total);
    expect(scoreCommand(item, 'she', 0, total)).toBe(200 + total);
    expect(scoreCommand(item, 'zzz', 0, total)).toBe(0);
  });
});

describe('parsePaletteMode / rankPalette（> 与 @ 模式）', () => {
  const hits: SearchHit[] = [
    hit({ id: 'pg-1', kind: 'page', title: '暗物质探测实验笔记', pageId: 'pg-1' }),
    hit({ id: 'cl-1', kind: 'collection', title: '实验数据台账', pageId: 'pg-2' }),
    hit({ id: 'rc-1', kind: 'record', title: '实验数据台账', pageId: 'pg-2' }),
    hit({ id: 'bk-1', kind: 'block', title: '探测器矩阵', pageId: 'pg-1' }),
  ];

  it("'>' 前缀 = 仅命令（页面/数据库命中被隐藏）", () => {
    const view = rankPalette('>sz', COMMAND_DEFS, hits);
    expect(view.mode).toBe('command');
    expect(view.raw).toBe('sz');
    // 'sz' 全等命中设置（别名 'hsz' 包含 'sz' 的回收站也在列，但排在全等之后）
    expect(view.commands[0]?.id).toBe('app.settings');
    expect(view.commands[0]?.label).toBe('打开设置');
    expect(view.pageHits).toEqual([]);
    expect(view.dbHits).toEqual([]);
    expect(selectableRowCount(view)).toBe(view.commands.length);
  });

  it("'@' 前缀 = 仅页面（命令与数据库命中被隐藏）", () => {
    const view = rankPalette('@暗物质', COMMAND_DEFS, hits);
    expect(view.mode).toBe('page');
    expect(view.commands).toEqual([]);
    expect(view.pageHits).toHaveLength(1);
    expect(view.dbHits).toEqual([]);
    expect(selectableRowCount(view)).toBe(1);
  });

  it('auto 模式：命令 + 页面 + 数据库三组齐全', () => {
    const view = rankPalette('', COMMAND_DEFS, hits);
    expect(view.mode).toBe('auto');
    expect(view.commands).toHaveLength(COMMAND_DEFS.length);
    expect(view.pageHits).toHaveLength(1);
    expect(view.dbHits).toHaveLength(3);
    expect(selectableRowCount(view)).toBe(COMMAND_DEFS.length + 4);
  });

  it('parsePaletteMode：无前缀 raw 原样', () => {
    expect(parsePaletteMode('abc')).toEqual({ mode: 'auto', raw: 'abc' });
    expect(parsePaletteMode('>')).toEqual({ mode: 'command', raw: '' });
    expect(parsePaletteMode('@')).toEqual({ mode: 'page', raw: '' });
  });
});
