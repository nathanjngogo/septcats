/**
 * diag.test.ts —— 诊断包脱敏（TASK-T10-01 §4/§5）。
 *
 * 隐私红线断言：假 secret/token 值不出现、主目录绝对路径替换为 `~`、
 * 凭据目录不进清单、无 net/http/fetch 模块。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { SeptcatsSettings } from '@septcats/platform';
import {
  REDACTED,
  buildDiagnosticPackage,
  redactHomeDir,
  redactSensitive,
} from '../src/main/diag';

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

describe('diag 值级脱敏（redactSensitive）', () => {
  it('key/token/secret/password 的 value 替换为 [REDACTED]', () => {
    const result = redactSensitive({
      api_key: 'sk-1234567890',
      apiToken: 'tok-abc',
      secret: 'hunter2',
      password: 'pw-1',
      keep: 'ok',
      nested: { 'api-key': 'k-2' },
      list: [{ secret: 's-3' }],
    });
    expect(result).toEqual({
      api_key: REDACTED,
      apiToken: REDACTED,
      secret: REDACTED,
      password: REDACTED,
      keep: 'ok',
      nested: { 'api-key': REDACTED },
      list: [{ secret: REDACTED }],
    });
  });
});

describe('diag 路径脱敏（redactHomeDir）', () => {
  it('主目录绝对路径替换为 ~', () => {
    expect(redactHomeDir('/home/alice/.septcats/a.md', '/home/alice')).toBe('~/.septcats/a.md');
    expect(redactHomeDir(['/home/alice/x', 'y'], '/home/alice')).toEqual(['~/x', 'y']);
  });
});

describe('diag 导出整体', () => {
  it('假 secret 不出现、~ 路径替换、凭据目录不进清单、meta 齐全', async () => {
    const home = tempDir('septcats-diag-home-');
    const syncDir = join(home, '.septcats');
    mkdirSync(join(syncDir, 'attachments'), { recursive: true });
    mkdirSync(join(syncDir, 'credentials'), { recursive: true });
    mkdirSync(join(syncDir, 'logs'), { recursive: true });
    writeFileSync(join(syncDir, 'attachments', 'a.txt'), 'A', 'utf8');
    writeFileSync(join(syncDir, 'credentials', 'x.enc'), 'cipher', 'utf8');
    writeFileSync(join(syncDir, 'logs', 'main.log'), 'line1\nline2\n', 'utf8');
    writeFileSync(join(syncDir, 'septcats.db'), 'db-bytes', 'utf8');

    const settings = {
      schema: 1,
      theme: 'system',
      locale: 'zh-CN',
      privacy: { telemetry: false, linkPreviewOnType: true },
      editor: { defaultEditMode: 'rich', spellcheck: true },
      trayClose: 'ask',
      data: { note: syncDir },
      sync: { enabled: true, encrypt: false, gc: false, folder: '' },
      ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
      rootPath: syncDir,
      apiKey: 'sk-fake-secret-999',
    } as SeptcatsSettings;

    const pkg = await buildDiagnosticPackage({
      appVersion: '0.0.0',
      platform: process.platform,
      userVersion: 4,
      dbFilePath: join(syncDir, 'septcats.db'),
      logsDir: join(syncDir, 'logs'),
      syncDir,
      homeDir: home,
      settings,
      now: () => '2026-09-13T00:00:00.000Z',
    });

    const json = JSON.stringify(pkg);
    // 假 secret 值不出现（值级脱敏）
    expect(json).not.toContain('sk-fake-secret-999');
    // 主目录绝对路径不出现（路径脱敏）
    expect(json).not.toContain(home);
    // 有 ~ 替换
    expect(json).toContain('~');
    // 凭据目录不进文件名清单
    expect(pkg.syncDirFiles.some((file) => file.includes('credentials'))).toBe(false);
    // 附件文件在清单（内容未收集，只文件名）
    expect(pkg.syncDirFiles.some((file) => file.endsWith('a.txt'))).toBe(true);
    // meta 有 userVersion / db 文件清单 / 日志尾部
    expect(pkg.meta.userVersion).toBe(4);
    expect(pkg.meta.dbFiles.some((file) => file.name === 'septcats.db')).toBe(true);
    expect(pkg.meta.logTail['main.log']).toEqual(['line1', 'line2']);
  });

  it('无 net/http/fetch 模块', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/main/diag.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/from\s+['"](?:node:)?(net|http|https)['"]/);
    expect(source).not.toMatch(/require\(['"](?:node:)?(net|http|https)['"]\)/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
