import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ensureDirs,
  estimateFreeBytes,
  isAbsolutePath,
  layoutFromRoot,
  resolveLayout,
} from '../src/layout';

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

describe('layout/resolveLayout', () => {
  it('默认数据根 = <home>/.<appName 小写>，子路径齐全且都是原生路径', () => {
    const home = tempDir('septcats-home-');
    const layout = resolveLayout({ appName: 'Septcats', homeDir: home, platform: process.platform });

    expect(layout.root).toBe(normalize(join(home, '.septcats')));
    expect(layout.db).toBe(normalize(join(layout.root, 'septcats.db')));
    expect(layout.attachments).toBe(normalize(join(layout.root, 'attachments')));
    expect(layout.logs).toBe(normalize(join(layout.root, 'logs')));
    expect(layout.tmp).toBe(normalize(join(layout.root, 'tmp')));
    expect(layout.crashDumps).toBe(normalize(join(layout.root, 'crashDumps')));
  });

  it('overrideRoot 生效（相对路径 throw）', () => {
    const root = tempDir('septcats-override-');
    const layout = resolveLayout({
      appName: 'septcats',
      overrideRoot: root,
      homeDir: tempDir('septcats-home2-'),
      platform: process.platform,
    });
    expect(layout.root).toBe(normalize(root));

    expect(() =>
      resolveLayout({
        appName: 'septcats',
        overrideRoot: 'relative/root',
        homeDir: '/home/demo',
        platform: 'linux',
      }),
    ).toThrow(/E_LAYOUT_ROOT_NOT_ABSOLUTE/);
  });

  it('appName 为空 / homeDir 非绝对路径 throw', () => {
    expect(() => resolveLayout({ appName: '', homeDir: '/home/demo', platform: 'linux' })).toThrow(
      /E_LAYOUT_APP_NAME/,
    );
    expect(() =>
      resolveLayout({ appName: 'septcats', homeDir: 'relative/home', platform: 'linux' }),
    ).toThrow(/E_LAYOUT_HOME_NOT_ABSOLUTE/);
  });

  it.skipIf(process.platform !== 'win32')('win32 认盘符与 UNC', () => {
    expect(isAbsolutePath('C:\\Users\\demo', 'win32')).toBe(true);
    expect(isAbsolutePath('C:/Users/demo', 'win32')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share', 'win32')).toBe(true);
    expect(isAbsolutePath('relative', 'win32')).toBe(false);
    const layout = resolveLayout({ appName: 'Septcats', homeDir: 'C:\\Users\\demo', platform: 'win32' });
    expect(layout.root).toBe('C:\\Users\\demo\\.septcats');
  });

  it.skipIf(process.platform === 'win32')('posix 只认前导 /', () => {
    expect(isAbsolutePath('/Users/demo', 'darwin')).toBe(true);
    expect(isAbsolutePath('relative', 'darwin')).toBe(false);
    expect(resolveLayout({ appName: 'Septcats', homeDir: '/Users/demo', platform: 'darwin' }).root).toBe(
      '/Users/demo/.septcats',
    );
  });
});

describe('layout/ensureDirs 与磁盘余量', () => {
  it('ensureDirs 幂等且建出全部目录', async () => {
    const root = tempDir('septcats-dirs-');
    const layout = layoutFromRoot(root);
    await ensureDirs(layout);
    await ensureDirs(layout); // 再来一次不应抛

    expect(existsSync(layout.root)).toBe(true);
    expect(existsSync(layout.attachments)).toBe(true);
    expect(existsSync(layout.logs)).toBe(true);
    expect(existsSync(layout.tmp)).toBe(true);
    expect(existsSync(layout.crashDumps)).toBe(true);
  });

  it('estimateFreeBytes 返回有限的非负数', async () => {
    const root = tempDir('septcats-free-');
    const free = await estimateFreeBytes(root);
    expect(Number.isFinite(free)).toBe(true);
    expect(free).toBeGreaterThanOrEqual(0);
  });
});
