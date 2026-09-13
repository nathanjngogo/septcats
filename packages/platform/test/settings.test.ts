import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveLayout } from '../src/layout';
import {
  bootstrapPaths,
  copyFileAtomic,
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
  it('文件缺失/损坏时退化为 { schema: 1 }', () => {
    const userData = tempDir('septcats-settings-empty-');
    expect(readSettings(userData)).toEqual({ schema: 1 });

    writeFileSync(join(userData, 'septcats.settings.json'), '{ not json', 'utf8');
    expect(readSettings(userData)).toEqual({ schema: 1 });

    writeFileSync(join(userData, 'septcats.settings.json'), '{"schema":1,"rootPath":""}', 'utf8');
    expect(readSettings(userData)).toEqual({ schema: 1 });
  });

  it('writeSettings 原子写且可读回', () => {
    const userData = tempDir('septcats-settings-write-');
    const root = tempDir('septcats-settings-root-');

    writeSettings(userData, { rootPath: root });
    expect(readSettings(userData)).toEqual({ schema: 1, rootPath: root });

    writeSettings(userData, {});
    expect(readSettings(userData)).toEqual({ schema: 1 });
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
