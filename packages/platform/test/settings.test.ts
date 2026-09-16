import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveLayout } from '../src/layout';
import {
  DEFAULT_APP_SETTINGS,
  bootstrapPaths,
  copyFileAtomic,
  mergeSettingsPatch,
  migrateRootPath,
  readSettings,
  writeSettings,
} from '../src/settings';

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sourceLayout(root: string) {
  return resolveLayout({
    appName: 'septcats',
    overrideRoot: root,
    homeDir: tmpdir(),
    platform: process.platform,
  });
}

describe('settings/读写', () => {
  it('文件缺失时退化为默认应用配置（不告警）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const userData = tempDir('septcats-settings-empty-');
    expect(readSettings(userData)).toEqual({ schema: 1, ...DEFAULT_APP_SETTINGS });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('损坏 JSON / 非法 app 配置回退默认值并 console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const userData = tempDir('septcats-settings-corrupt-');

    writeFileSync(join(userData, 'septcats.settings.json'), '{ not json', 'utf8');
    expect(readSettings(userData)).toEqual({ schema: 1, ...DEFAULT_APP_SETTINGS });
    expect(warn).toHaveBeenCalled();

    warn.mockClear();
    writeFileSync(join(userData, 'septcats.settings.json'), '{"schema":1,"theme":"neon"}', 'utf8');
    expect(readSettings(userData)).toEqual({ schema: 1, ...DEFAULT_APP_SETTINGS });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('writeSettings 原子写且可读回（rootPath replace + app settings merge）', () => {
    const userData = tempDir('septcats-settings-write-');
    const root = tempDir('septcats-settings-root-');

    writeSettings(userData, { rootPath: root });
    expect(readSettings(userData)).toEqual({ schema: 1, rootPath: root, ...DEFAULT_APP_SETTINGS });

    // rootPath 清空，app settings 保持
    writeSettings(userData, {});
    expect(readSettings(userData)).toEqual({ schema: 1, ...DEFAULT_APP_SETTINGS });
  });

  it('app 配置 roundtrip：theme/privacy/editor 持久化并可读回', () => {
    const userData = tempDir('septcats-settings-app-');
    writeSettings(userData, {
      theme: 'dark',
      privacy: { telemetry: false, linkPreviewOnType: false },
      editor: { defaultEditMode: 'markdown', spellcheck: false },
    });
    const s = readSettings(userData);
    expect(s.theme).toBe('dark');
    expect(s.privacy).toEqual({ telemetry: false, linkPreviewOnType: false });
    expect(s.editor).toEqual({ defaultEditMode: 'markdown', spellcheck: false });
  });
});

describe('settings/mergeSettingsPatch', () => {
  it('合并局部 patch 并严格校验（非法值抛 E_SETTINGS_INVALID）', () => {
    const base = DEFAULT_APP_SETTINGS;
    expect(mergeSettingsPatch(base, { theme: 'dark' }).theme).toBe('dark');
    expect(mergeSettingsPatch(base, { privacy: { linkPreviewOnType: false } }).privacy).toEqual({
      telemetry: false,
      linkPreviewOnType: false,
    });
    expect(() => mergeSettingsPatch(base, { theme: 'neon' })).toThrow(/E_SETTINGS_INVALID/);
    expect(() => mergeSettingsPatch(base, { privacy: { telemetry: true } })).toThrow(
      /E_SETTINGS_INVALID/,
    );
  });
});

describe('settings/ai 段（TASK-T18-01 §2.1）', () => {
  it('默认含 ai 且全关/空（隐私不变量：云端默认关）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const userData = tempDir('septcats-settings-ai-default-');
    const s = readSettings(userData);
    expect(s.ai).toEqual({
      enabled: false,
      cloudConsent: false,
      activeProviderId: null,
      providers: [],
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('写读往返保留 providers（数组整体替换语义）', () => {
    const userData = tempDir('septcats-settings-ai-write-');
    const providers = [
      {
        id: 'local',
        kind: 'lmstudio' as const,
        name: 'LM Studio',
        baseUrl: 'http://127.0.0.1:1234',
        model: 'qwen2.5-7b',
      },
      {
        id: 'cloud',
        kind: 'openai-compatible' as const,
        name: '云',
        baseUrl: 'https://api.example.com',
        model: null,
      },
    ];
    writeSettings(userData, {
      ai: { enabled: true, cloudConsent: false, activeProviderId: 'local', providers },
    });
    const s = readSettings(userData);
    expect(s.ai.enabled).toBe(true);
    expect(s.ai.activeProviderId).toBe('local');
    expect(s.ai.providers).toEqual(providers);

    // 整体替换：providers 以 patch 为准，其余字段需整段给出（patch 的 ai 为整段语义）
    writeSettings(userData, {
      ai: {
        enabled: true,
        cloudConsent: false,
        activeProviderId: 'local',
        providers: [providers[0]!],
      },
    });
    const next = readSettings(userData);
    expect(next.ai.enabled).toBe(true);
    expect(next.ai.providers).toEqual([providers[0]]);
  });

  it('非法值（kind:claude / id:A!）抛 E_SETTINGS_INVALID', () => {
    const base = DEFAULT_APP_SETTINGS;
    expect(() =>
      mergeSettingsPatch(base, {
        ai: {
          enabled: true,
          cloudConsent: false,
          activeProviderId: null,
          providers: [
            { id: 'x', kind: 'claude', name: 'X', baseUrl: 'http://127.0.0.1:1234', model: null },
          ],
        },
      }),
    ).toThrow(/E_SETTINGS_INVALID/);
    expect(() =>
      mergeSettingsPatch(base, {
        ai: {
          enabled: true,
          cloudConsent: false,
          activeProviderId: null,
          providers: [
            { id: 'A!', kind: 'lmstudio', name: 'X', baseUrl: 'http://127.0.0.1:1234', model: null },
          ],
        },
      }),
    ).toThrow(/E_SETTINGS_INVALID/);
  });

  it('缺 ai 段的旧文件读回不炸（补默认）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const userData = tempDir('septcats-settings-ai-legacy-');
    writeFileSync(
      join(userData, 'septcats.settings.json'),
      JSON.stringify({ schema: 1, theme: 'dark', locale: 'zh-CN' }),
      'utf8',
    );
    const s = readSettings(userData);
    expect(s.theme).toBe('dark');
    expect(s.ai).toEqual({ ...DEFAULT_APP_SETTINGS.ai });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('settings/bootstrapPaths', () => {
  it('默认根为 <home>/.septcats 并建齐目录', async () => {
    const home = tempDir('septcats-bootstrap-home-');
    const userData = tempDir('septcats-bootstrap-udd-');

    const layout = await bootstrapPaths({
      appName: 'septcats',
      electronUserData: userData,
      homeDir: home,
      platform: process.platform,
    });

    expect(layout.root).toBe(join(home, '.septcats'));
    expect(existsSync(layout.logs)).toBe(true);
    expect(existsSync(layout.attachments)).toBe(true);
    expect(existsSync(layout.tmp)).toBe(true);
    expect(existsSync(layout.crashDumps)).toBe(true);
  });

  it('设置里的 rootPath 生效', async () => {
    const home = tempDir('septcats-bootstrap-home2-');
    const userData = tempDir('septcats-bootstrap-udd2-');
    const override = tempDir('septcats-bootstrap-override-');
    writeSettings(userData, { rootPath: override });

    const layout = await bootstrapPaths({
      appName: 'septcats',
      electronUserData: userData,
      homeDir: home,
      platform: process.platform,
    });

    expect(layout.root).toBe(override);
    expect(existsSync(join(override, 'attachments'))).toBe(true);
  });

  it('设置里的 rootPath 非法（相对路径）时忽略，回落到默认根', async () => {
    const home = tempDir('septcats-bootstrap-home3-');
    const userData = tempDir('septcats-bootstrap-udd3-');
    writeFileSync(
      join(userData, 'septcats.settings.json'),
      JSON.stringify({ schema: 1, rootPath: 'relative/root' }),
      'utf8',
    );

    const layout = await bootstrapPaths({
      appName: 'septcats',
      electronUserData: userData,
      homeDir: home,
      platform: process.platform,
    });

    expect(layout.root).toBe(join(home, '.septcats'));
  });
});

describe('settings/migrateRootPath', () => {
  it('复制 db + attachments/** + settings.json，写 marker 并更新设置（旧目录保留）', async () => {
    const srcRoot = tempDir('septcats-migrate-src-');
    const userData = tempDir('septcats-migrate-udd-');
    const target = tempDir('septcats-migrate-dst-');
    const layout = sourceLayout(srcRoot);

    mkdirSync(join(layout.attachments, 'sub'), { recursive: true });
    writeFileSync(layout.db, 'sqlite-bytes', 'utf8');
    writeFileSync(join(layout.attachments, 'a.txt'), 'A', 'utf8');
    writeFileSync(join(layout.attachments, 'sub', 'b.txt'), 'B', 'utf8');
    writeSettings(userData, { rootPath: srcRoot });

    const next = await migrateRootPath(layout, target, { userDataDir: userData });

    expect(next.root).toBe(target);
    expect(readFileSync(next.db, 'utf8')).toBe('sqlite-bytes');
    expect(readFileSync(join(next.attachments, 'a.txt'), 'utf8')).toBe('A');
    expect(readFileSync(join(next.attachments, 'sub', 'b.txt'), 'utf8')).toBe('B');
    const snapshot = JSON.parse(
      readFileSync(join(next.root, 'septcats.settings.json'), 'utf8'),
    ) as { rootPath?: string };
    expect(snapshot.rootPath).toBe(srcRoot);

    const marker = JSON.parse(readFileSync(join(next.root, '.septcats-root'), 'utf8')) as {
      from: string;
      migratedAt: string;
    };
    expect(marker.from).toBe(layout.root);
    expect(marker.migratedAt.length).toBeGreaterThan(0);

    expect(readSettings(userData).rootPath).toBe(target);
    // 旧目录保守不删
    expect(existsSync(layout.db)).toBe(true);
    expect(existsSync(join(layout.attachments, 'a.txt'))).toBe(true);
  });

  it('第 3 个文件复制失败：回滚已复制的新文件，marker 不落，settings 不变', async () => {
    const srcRoot = tempDir('septcats-rollback-src-');
    const userData = tempDir('septcats-rollback-udd-');
    const target = tempDir('septcats-rollback-dst-');
    const layout = sourceLayout(srcRoot);

    writeFileSync(layout.db, 'db', 'utf8');
    mkdirSync(layout.attachments, { recursive: true });
    writeFileSync(join(layout.attachments, 'a.txt'), 'A', 'utf8');
    writeFileSync(join(layout.attachments, 'b.txt'), 'B', 'utf8');
    writeFileSync(join(layout.attachments, 'c.txt'), 'C', 'utf8');
    writeSettings(userData, { rootPath: srcRoot });

    let call = 0;
    const failing = async (from: string, to: string): Promise<void> => {
      call += 1;
      if (call === 3) {
        throw new Error('注入失败：第 3 个文件');
      }
      await copyFileAtomic(from, to);
    };

    await expect(
      migrateRootPath(layout, target, { copyFile: failing, userDataDir: userData }),
    ).rejects.toThrow(/注入失败/);

    expect(existsSync(join(target, 'septcats.db'))).toBe(false);
    expect(existsSync(join(target, 'attachments', 'a.txt'))).toBe(false);
    expect(existsSync(join(target, 'attachments', 'b.txt'))).toBe(false);
    expect(existsSync(join(target, 'attachments', 'c.txt'))).toBe(false);
    expect(existsSync(join(target, '.septcats-root'))).toBe(false);
    expect(readSettings(userData).rootPath).toBe(srcRoot);
    // 源目录毫发无损
    expect(existsSync(layout.db)).toBe(true);
  });

  it('目标必须绝对且已存在', async () => {
    const layout = sourceLayout(tempDir('septcats-migrate-guard-'));
    const target = tempDir('septcats-migrate-guard-dst-');

    await expect(migrateRootPath(layout, 'relative/dir')).rejects.toThrow(
      /E_MIGRATE_TARGET_NOT_ABSOLUTE/,
    );
    await expect(
      migrateRootPath(layout, join(target, 'does-not-exist')),
    ).rejects.toThrow();
  });
});
