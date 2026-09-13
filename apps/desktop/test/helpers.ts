/**
 * apps/desktop 的 vitest 公共夹具。
 *
 * 关于原生模块：better-sqlite3 是原生扩展，`@electron/rebuild` 之后其二进制是
 * 为 Electron 的 ABI 编译的，普通 Node 运行时可能无法加载（NODE_MODULE_VERSION 不匹配）。
 * 因此这里**惰性 + 容错**加载：加载不到就跳过 DB 相关用例，纯逻辑用例照常全绿。
 * 详见 src/db/README.md。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { applyPragmaBaseline, type SqliteConstructor } from '../src/db/migrations';
import { createDbServerCore, type DbServerCore } from '../src/db/server';
import type { DbErrorPayload, DbRequest, DbResponseData } from '../src/db/rpc';

let cached: SqliteConstructor | null | undefined;
let loadError = '';
let warned = false;

/** 尝试取 better-sqlite3 构造器并**真正开一个内存库**探针；不可用返回 null。 */
export function getSqliteConstructor(): SqliteConstructor | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    const nodeRequire = createRequire(import.meta.url);
    const loaded = nodeRequire('better-sqlite3') as SqliteConstructor;
    const probe = new loaded(':memory:');
    probe.close();
    cached = loaded;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    cached = null;
  }
  return cached;
}

export function sqliteUnavailableReason(): string {
  return loadError;
}

/**
 * 注册一个「需要 better-sqlite3」的 describe：可用则正常跑，不可用则整组跳过，
 * 并只打印一次原因（避免刷屏）。
 */
export function describeDb(name: string, fn: (ctor: SqliteConstructor) => void): void {
  const ctor = getSqliteConstructor();
  if (ctor === null) {
    if (!warned) {
      warned = true;
      console.warn(`[db tests] better-sqlite3 原生模块不可用，DB 用例已跳过：${loadError}`);
    }
    describe.skip(`${name}（跳过：better-sqlite3 不可用）`, () => {
      it('skipped', () => {
        // 见 src/db/README.md 的 ABI/electron-rebuild 说明
      });
    });
    return;
  }
  describe(name, () => {
    fn(ctor);
  });
}

export interface TempDb {
  readonly dir: string;
  readonly path: string;
  cleanup(): void;
}

/** 建一个临时目录 + 库路径；用完调用 cleanup()。 */
export function makeTempDb(label = 'septcats-test'): TempDb {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  return {
    dir,
    path: join(dir, 'septcats.db'),
    cleanup: (): void => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 打开临时库、上 PRAGMA 基线，包成 DbServerCore。 */
export function makeCore(ctor: SqliteConstructor, dbPath: string): DbServerCore {
  const db = new ctor(dbPath);
  applyPragmaBaseline(db);
  return createDbServerCore(db);
}

/** 发一条请求并断言成功，返回 data。 */
export async function requestOk<T extends DbResponseData>(
  core: DbServerCore,
  request: DbRequest,
): Promise<T> {
  const response = await core.handleRequest(request);
  if (!response.ok) {
    throw new Error(`${request.t} 未预期失败：${response.error.code} ${response.error.message}`);
  }
  return response.data as T;
}

/** 发一条请求并断言失败，返回 error 载荷。 */
export async function requestFail(core: DbServerCore, request: DbRequest): Promise<DbErrorPayload> {
  const response = await core.handleRequest(request);
  if (response.ok) {
    throw new Error(`${request.t} 未预期成功`);
  }
  return response.error;
}
