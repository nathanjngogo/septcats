/**
 * i18n.test.ts —— i18n 骨架（TASK-T10-01 §2/§5）。
 *
 * 纯 Node：t() 嵌套 key 解析、缺失 key 回退 key 本身并 console.warn、useLocale 一期 zh-CN。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t, useLocale } from '../src/renderer/src/i18n';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('i18n t()', () => {
  it('嵌套 key 解析（settings 与命令表）', () => {
    expect(t('settings.appearance.theme')).toBe('主题');
    expect(t('settings.diagnostic.export')).toBe('导出诊断包');
    expect(t('commands.app.settings')).toBe('打开设置');
    expect(t('commandHints.theme.light')).toBe('界面主题');
  });

  it('缺失 key 回退 key 本身并 console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(t('settings.does.not.exist')).toBe('settings.does.not.exist');
    expect(warn).toHaveBeenCalled();
  });
});

describe('i18n useLocale()', () => {
  it('一期生效面固定 zh-CN', () => {
    expect(useLocale()).toBe('zh-CN');
  });
});
