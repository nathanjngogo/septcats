/**
 * settings.test.ts —— main 侧设置服务（TASK-T10-01 §5）。
 *
 * 纯 Node（不 import electron）：直测 main/settings.ts 的 get/patch。
 * patch 非法值（theme:'neon'）必须抛 E_SETTINGS_INVALID。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { patchAppSettings, readAppSettings } from '../src/main/settings';

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

describe('main/settings（settings:get / settings:patch）', () => {
  it('get 回整份（默认 system + data.note = 同步目录）', () => {
    const userData = tempDir('septcats-main-settings-');
    const syncDir = join(tmpdir(), 'septcats-sync-dir');
    const settings = readAppSettings(userData, syncDir);
    expect(settings.theme).toBe('system');
    expect(settings.locale).toBe('zh-CN');
    expect(settings.data.note).toBe(syncDir);
  });

  it('patch roundtrip：theme 持久化并可读回', () => {
    const userData = tempDir('septcats-main-settings-write-');
    const syncDir = join(tmpdir(), 'septcats-sync-dir');
    const next = patchAppSettings(userData, syncDir, { theme: 'dark' });
    expect(next.theme).toBe('dark');
    expect(readAppSettings(userData, syncDir).theme).toBe('dark');
  });

  it('patch 非法值（theme: neon）被 zod 拒绝', () => {
    const userData = tempDir('septcats-main-settings-invalid-');
    expect(() => patchAppSettings(userData, '/sync', { theme: 'neon' })).toThrow(
      /E_SETTINGS_INVALID/,
    );
  });

  it('patch roundtrip：ai 段 providers 持久化并可读回（TASK-T18-01 §3）', () => {
    const userData = tempDir('septcats-main-settings-ai-');
    const syncDir = join(tmpdir(), 'septcats-sync-dir');
    const next = patchAppSettings(userData, syncDir, {
      ai: {
        enabled: true,
        cloudConsent: false,
        activeProviderId: 'local',
        providers: [
          {
            id: 'local',
            kind: 'lmstudio',
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234',
            model: null,
          },
        ],
      },
    });
    expect(next.ai.enabled).toBe(true);
    expect(next.ai.providers).toHaveLength(1);
    const reread = readAppSettings(userData, syncDir);
    expect(reread.ai).toEqual(next.ai);
  });
});
