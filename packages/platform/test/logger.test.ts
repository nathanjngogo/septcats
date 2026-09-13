import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';
import type { PathLayout } from '../src/layout';

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

function layoutWith(logs: string): PathLayout {
  const root = dirname(logs);
  return {
    root,
    db: join(root, 'septcats.db'),
    attachments: join(root, 'attachments'),
    logs,
    tmp: join(root, 'tmp'),
    crashDumps: join(root, 'crashDumps'),
  };
}

describe('logger/即时落盘与格式', () => {
  it('不 flush 也在盘上，行格式符合约定', () => {
    const logs = tempDir('septcats-log-');
    const logger = createLogger(layoutWith(logs));
    logger.forModule('main').info('hello', { schemaVersion: 1 });

    const content = readFileSync(join(logs, 'main.log'), 'utf8');
    expect(content.includes('hello')).toBe(true);
    expect(content).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \(main\) hello \{"schemaVersion":1\}\n$/,
    );
  });

  it('无 ctx 时行尾不带 JSON，warn/error 级别标签正确', () => {
    const logs = tempDir('septcats-log-levels-');
    const logger = createLogger(layoutWith(logs));
    const mod = logger.forModule('db');
    mod.warn('slow query');
    mod.error('boom', { code: 'SQLITE_BUSY' });

    const lines = readFileSync(join(logs, 'db.log'), 'utf8').trimEnd().split('\n');
    expect(lines[0]).toMatch(/^\[.+\] \[WARN\] \(db\) slow query$/);
    expect(lines[1]).toMatch(/^\[.+\] \[ERROR\] \(db\) boom \{"code":"SQLITE_BUSY"\}$/);
  });

  it('模块名白名单 [a-z0-9-]{1,40}', () => {
    const logger = createLogger(layoutWith(tempDir('septcats-log-name-')));
    expect(() => logger.forModule('Bad Name')).toThrow(/E_LOG_MODULE_NAME/);
    expect(() => logger.forModule('')).toThrow(/E_LOG_MODULE_NAME/);
    expect(() => logger.forModule('Upper')).toThrow(/E_LOG_MODULE_NAME/);
    expect(() => logger.forModule('x'.repeat(41))).toThrow(/E_LOG_MODULE_NAME/);
    expect(() => logger.forModule('main')).not.toThrow();
  });

  it('level 过滤：低于配置级别不落盘', () => {
    const logs = tempDir('septcats-log-filter-');
    const logger = createLogger(layoutWith(logs), { level: 'warn' });
    logger.forModule('main').info('dropped');
    expect(existsSync(join(logs, 'main.log'))).toBe(false);

    logger.forModule('main').error('kept');
    expect(readFileSync(join(logs, 'main.log'), 'utf8').includes('kept')).toBe(true);
  });

  it('forModule 返回缓存实例并分文件落盘', () => {
    const logs = tempDir('septcats-log-cache-');
    const logger = createLogger(layoutWith(logs));
    expect(logger.forModule('main')).toBe(logger.forModule('main'));
    logger.forModule('main').info('a');
    logger.forModule('renderer').info('b');
    expect(existsSync(join(logs, 'main.log'))).toBe(true);
    expect(existsSync(join(logs, 'renderer.log'))).toBe(true);
  });
});

describe('logger/脱敏', () => {
  it('ctx 敏感 key（含嵌套对象与数组）值替换为 [redacted]', () => {
    const logs = tempDir('septcats-log-redact-');
    const logger = createLogger(layoutWith(logs));
    logger.forModule('main').info('login', {
      user: 'ada',
      token: 'tok-123',
      apiKey: 'key-456',
      api_key: 'key-789',
      nested: { userPassword: 'pw-000', depth: { secretValue: 'sec-111' } },
      list: [{ credential: 'cred-222' }, 'plain'],
    });

    const line = readFileSync(join(logs, 'main.log'), 'utf8');
    for (const secret of ['tok-123', 'key-456', 'key-789', 'pw-000', 'sec-111', 'cred-222']) {
      expect(line.includes(secret)).toBe(false);
    }
    expect(line.includes('"user":"ada"')).toBe(true);
    expect(line.includes('"plain"')).toBe(true);
    expect(line.match(/\[redacted\]/g)?.length).toBe(6);
  });
});

describe('logger/滚动与容错', () => {
  it('超过 maxBytes 时滚动为 .old（覆盖式）', () => {
    const logs = tempDir('septcats-log-rotate-');
    const logger = createLogger(layoutWith(logs), { maxBytes: 200 });
    const mod = logger.forModule('main');
    for (let i = 0; i < 10; i += 1) {
      mod.info(`line-${i}`);
    }

    expect(existsSync(join(logs, 'main.log.old'))).toBe(true);
    expect(readFileSync(join(logs, 'main.log.old'), 'utf8').includes('line-0')).toBe(true);
    expect(readFileSync(join(logs, 'main.log'), 'utf8').includes('line-9')).toBe(true);
  });

  it('写盘失败静默吞掉并计入 droppedLines，绝不抛', async () => {
    const root = tempDir('septcats-log-fail-');
    const blocker = join(root, 'blocker');
    writeFileSync(blocker, 'x', 'utf8'); // blocker 是文件，其下不可能建目录

    const logger = createLogger(layoutWith(join(blocker, 'logs')));
    const mod = logger.forModule('main');
    expect(() => mod.info('cannot write')).not.toThrow();
    expect(() => mod.error('also cannot write')).not.toThrow();
    await expect(logger.flush()).resolves.toEqual({ droppedLines: 2 });

    const okLogger = createLogger(layoutWith(root));
    okLogger.forModule('main').info('fine');
    await expect(okLogger.flush()).resolves.toEqual({ droppedLines: 0 });
  });
});
