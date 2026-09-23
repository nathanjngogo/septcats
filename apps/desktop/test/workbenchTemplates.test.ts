/**
 * workbenchTemplates.test.ts —— 主进程「内置工作台模板」只读服务（TASK-T72-01 §范围3）。
 *
 * 覆盖：list() 注入 resourcesDir 读取随包 4 个 JSON（坏 JSON 跳过不抛）；
 * parseWorkbenchTemplateFile 单元（坏 JSON / 非对象 / 缺 title / layout 形状 / 落库形状）。
 * 与 renderer 侧 t72-market-model.test.ts 同源读取同一批 JSON，但本套盯的是「主进程通道」。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createWorkbenchTemplatesService,
  parseWorkbenchTemplateFile,
} from '../src/main/workbenchTemplates';

const here = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(here, '..', 'resources');

describe('workbenchTemplates（主进程 §范围3 只读通道）', () => {
  it('resources/workbench-templates 目录存在且含 4 个 JSON', () => {
    const dir = join(RESOURCES_DIR, 'workbench-templates');
    expect(existsSync(dir)).toBe(true);
  });

  it('list() 注入 resourcesDir → 4 个内置模板，形状齐备（v:2 + order/hidden 数组）', async () => {
    const service = createWorkbenchTemplatesService({ resourcesDir: RESOURCES_DIR });
    const { templates } = await service.list();
    const ids = templates.map((tpl) => tpl.id).sort();
    expect(ids).toEqual(['project-board', 'reading-tracker', 'weekly-review', 'work-journal']);
    for (const tpl of templates) {
      expect(tpl.title.length).toBeGreaterThan(0);
      expect(tpl.layout.v).toBe(2);
      expect(Array.isArray(tpl.layout.order)).toBe(true);
      expect(Array.isArray(tpl.layout.hidden)).toBe(true);
      expect(Array.isArray(tpl.seedPages)).toBe(true);
    }
  });

  it('parseWorkbenchTemplateFile：坏 JSON → null（坏 JSON 跳过不抛）', () => {
    expect(parseWorkbenchTemplateFile('{not json', 'fallback')).toBeNull();
  });

  it('parseWorkbenchTemplateFile：非对象 / 缺 title → null', () => {
    expect(parseWorkbenchTemplateFile('[1,2,3]', 'fallback')).toBeNull();
    expect(parseWorkbenchTemplateFile('{"layout":{"v":2,"order":[],"hidden":[]}}', 'fallback')).toBeNull();
  });

  it('parseWorkbenchTemplateFile：layout 形状不合法（v≠2 / order 非数组）→ null', () => {
    expect(
      parseWorkbenchTemplateFile(
        JSON.stringify({ title: 't', layout: { v: 1, order: [], hidden: [] } }),
        'fallback',
      ),
    ).toBeNull();
    expect(
      parseWorkbenchTemplateFile(
        JSON.stringify({ title: 't', layout: { v: 2, order: 'x', hidden: [] } }),
        'fallback',
      ),
    ).toBeNull();
  });

  it('parseWorkbenchTemplateFile：合法 → 落库形状（v:2 + order/hidden 字符串数组 + seedPages）', () => {
    const ok = parseWorkbenchTemplateFile(
      JSON.stringify({
        title: 't',
        desc: 'd',
        layout: { v: 2, order: ['quick', 'todo'], hidden: ['database'] },
        seedPages: [{ title: 's', body: 'b' }],
      }),
      'fallback',
    );
    expect(ok).not.toBeNull();
    expect(ok?.id).toBe('fallback');
    expect(ok?.layout).toEqual({ v: 2, order: ['quick', 'todo'], hidden: ['database'] });
    expect(ok?.seedPages).toEqual([{ title: 's', body: 'b' }]);
  });
});
