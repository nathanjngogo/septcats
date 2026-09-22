/**
 * menu.test.ts —— 原生应用菜单（TASK-T51-01 §1②）单测。
 *
 * 只测纯模板 menuTemplate.ts（不 import electron，Node 环境可直跑）：
 * - label 全走 i18n 字典（zh-CN 全中文、en-US 全英文，值取自 menu.* 键）；
 * - 结构 = File / Edit / View / Help；
 * - 快捷键双绑核查：Close Tab 委托 renderer（click → onAction('closeTab')、
 *   registerAccelerator:false、**无 role:'close'**）；Edit 标准 role 不抢注册；
 *   Ctrl+K 命令面板不注册；缩放 role 正常注册（键位不在页签 1..9 内）。
 */
import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildMenuTemplate, menuText, toMenuLocale } from '../src/main/menuTemplate';
import type { MenuActionId } from '../src/shared/ipc';
import { enUS } from '../src/renderer/src/i18n/en-US';
import { zhCN } from '../src/renderer/src/i18n/zh-CN';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/;

/** 收集模板里全部 label（含各子菜单）。 */
function allLabels(template: MenuItemConstructorOptions[]): string[] {
  const out: string[] = [];
  const walk = (items: MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      if (typeof item.label === 'string') {
        out.push(item.label);
      }
      if (Array.isArray(item.submenu)) {
        walk(item.submenu);
      }
    }
  };
  walk(template);
  return out;
}

function submenu(
  template: MenuItemConstructorOptions[],
  topLabel: string,
): MenuItemConstructorOptions[] {
  const top = template.find((item) => item.label === topLabel);
  if (top === undefined || !Array.isArray(top.submenu)) {
    throw new Error(`未找到子菜单：${topLabel}`);
  }
  return top.submenu;
}

describe('buildMenuTemplate（TASK-T51-01 §1②）', () => {
  it('结构 = File / Edit / View / Help；label 全取自 i18n menu.* 字典', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const dict = locale === 'zh-CN' ? zhCN : enUS;
      const template = buildMenuTemplate(locale, () => undefined);
      expect(template.map((item) => item.label)).toEqual([
        dict.menu.file,
        dict.menu.edit,
        dict.menu.view,
        dict.menu.help,
      ]);
      const allowed = new Set<string>(Object.values(dict.menu));
      for (const label of allLabels(template)) {
        expect(allowed.has(label), `未走 i18n 字典的 label：${label}`).toBe(true);
      }
    }
  });

  it('zh-CN 全中文、en-US 全英文（同键同义）', () => {
    const zhLabels = allLabels(buildMenuTemplate('zh-CN', () => undefined));
    const enLabels = allLabels(buildMenuTemplate('en-US', () => undefined));
    expect(zhLabels.length).toBe(enLabels.length);
    for (const label of zhLabels) {
      expect(CJK.test(label), `zh label 应为中文：${label}`).toBe(true);
    }
    for (const label of enLabels) {
      expect(CJK.test(label), `en label 不应含 CJK：${label}`).toBe(false);
    }
  });

  it('toMenuLocale：en-US 直通，其余（含未知）回落 zh-CN', () => {
    expect(toMenuLocale('en-US')).toBe('en-US');
    expect(toMenuLocale('zh-CN')).toBe('zh-CN');
    expect(toMenuLocale('fr-FR')).toBe('zh-CN');
  });

  it('File→New Page / Import / Trash 派发到 renderer 动作', () => {
    const actions: MenuActionId[] = [];
    const file = submenu(buildMenuTemplate('zh-CN', (a) => actions.push(a)), zhCN.menu.file);
    const clickable = file.filter((item) => typeof item.label === 'string' && item.label !== zhCN.menu.fileQuit);
    for (const item of clickable) {
      item.click?.({} as never, undefined, {} as never);
    }
    expect(actions).toEqual(['newPage', 'import', 'openTrash', 'closeTab']);
  });

  it('Close Tab 委托 renderer：同键 Ctrl+W、不注册系统键、绝不 role:close', () => {
    const actions: MenuActionId[] = [];
    const file = submenu(buildMenuTemplate('zh-CN', (a) => actions.push(a)), zhCN.menu.file);
    const closeItem = file.find((item) => item.label === zhCN.menu.fileCloseTab);
    expect(closeItem).toBeDefined();
    expect(closeItem?.accelerator).toBe('CmdOrCtrl+W');
    expect(closeItem?.registerAccelerator).toBe(false); // 不抢系统键 → 页签门控路径照常
    expect(closeItem?.role).toBeUndefined(); // 绝不 role:'close'（会关窗口）
    closeItem?.click?.({} as never, undefined, {} as never);
    expect(actions).toContain('closeTab');
  });

  it('菜单任何一项都不挂 role:close / quit 之外的窗口语义；Edit 用标准 role 且不抢注册', () => {
    const template = buildMenuTemplate('zh-CN', () => undefined);
    const flat: MenuItemConstructorOptions[] = [];
    const walk = (items: MenuItemConstructorOptions[]): void => {
      for (const item of items) {
        flat.push(item);
        if (Array.isArray(item.submenu)) {
          walk(item.submenu);
        }
      }
    };
    walk(template);
    expect(flat.some((item) => item.role === 'close')).toBe(false);

    const edit = submenu(template, zhCN.menu.edit);
    const roleItems = edit.filter((item) => item.role !== undefined);
    expect(roleItems.map((item) => item.role)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
    for (const item of roleItems) {
      // 页内 ProseMirror 自持 history/keymap：菜单不注册快捷键，避免 Ctrl+Z/C/V/A 被截断
      expect(item.registerAccelerator).toBe(false);
    }
  });

  it('View→命令面板不注册 Ctrl+K（与 main globalShortcut 不双绑）；缩放 role 正常注册', () => {
    const view = submenu(buildMenuTemplate('zh-CN', () => undefined), zhCN.menu.view);
    const palette = view.find((item) => item.label === zhCN.menu.viewCommandPalette);
    expect(palette?.accelerator).toBe('CmdOrCtrl+K');
    expect(palette?.registerAccelerator).toBe(false);

    const zoom = view.filter((item) => item.role === 'zoomIn' || item.role === 'zoomOut' || item.role === 'resetZoom');
    expect(zoom).toHaveLength(3);
    for (const item of zoom) {
      expect(item.registerAccelerator).toBeUndefined(); // 正常注册（键位不与页签 1..9 冲突）
    }
  });

  it('menuText 双语言取值正确（同键同义）', () => {
    expect(menuText('zh-CN', 'file')).toBe('文件');
    expect(menuText('en-US', 'file')).toBe('File');
    expect(menuText('zh-CN', 'fileCloseTab')).toBe('关闭标签');
    expect(menuText('en-US', 'fileCloseTab')).toBe('Close Tab');
  });

  // TASK-T56-01 §1③：帮助子菜单「使用说明书」（MenuActionId=helpManual），
  // 位置在「关于」上方 + 分隔线；中英双语 label 走 menuText 字典。
  it('Help→「使用说明书」派发 helpManual，位于「关于」上方并以分隔线隔开（双语）', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const dict = locale === 'zh-CN' ? zhCN : enUS;
      const actions: MenuActionId[] = [];
      const help = submenu(buildMenuTemplate(locale, (a) => actions.push(a)), dict.menu.help);
      expect(help.map((item) => item.label ?? item.type)).toEqual([
        dict.menu.helpManual,
        'separator',
        dict.menu.helpAbout,
      ]);
      const manualItem = help[0];
      manualItem?.click?.({} as never, undefined, {} as never);
      expect(actions).toEqual(['helpManual']);
      const aboutItem = help[2];
      aboutItem?.click?.({} as never, undefined, {} as never);
      expect(actions).toEqual(['helpManual', 'about']);
    }
  });

  it('「使用说明书」label 双语且 en 含 Manual（切语言菜单文案随动）', () => {
    expect(menuText('zh-CN', 'helpManual')).toBe('使用说明书');
    expect(menuText('en-US', 'helpManual')).toContain('Manual');
  });
});
