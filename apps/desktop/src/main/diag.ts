/**
 * main/diag.ts —— 诊断包生成（TASK-T10-01 §4，隐私红线）。
 *
 * 纯 Node（不 import electron / ipcMain / 任何网络模块），供 main/index.ts 的
 * `diag:export` / `diag:confirm` 调用，也供 test/diag.test.ts 直测脱敏断言。
 *
 * 脱敏三条：
 *  1. 值级：key 命中 `/(?i)(api[-_]?(key|token)|secret|password)/` → value 替换 `[REDACTED]`；
 *  2. 路径级：任何字符串里的用户主目录绝对路径前缀替换为 `~`；
 *  3. 内容级：只收集文件名/大小/日志尾部，绝不读正文与标题；凭据目录整体跳过。
 */

import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type { SeptcatsSettings } from '@septcats/platform';

export const REDACTED = '[REDACTED]';
/** 与任务书 §4 完全一致：api_key/api-key/apikey/api_token/api-token/apitoken/secret/password。 */
export const DIAG_SENSITIVE_KEY_RE = /(?:api[-_]?(?:key|token)|secret|password)/i;

/** key 命中敏感词 → value 替换 [REDACTED]；嵌套对象与数组递归。 */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = DIAG_SENSITIVE_KEY_RE.test(key) ? REDACTED : redactSensitive(item);
  }
  return output;
}

/** 字符串里的主目录绝对路径替换为 `~`（递归；空 homeDir 不替换）。 */
export function redactHomeDir(value: unknown, homeDir: string): unknown {
  if (typeof value === 'string') {
    return homeDir.length === 0 ? value : value.split(homeDir).join('~');
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactHomeDir(item, homeDir));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactHomeDir(item, homeDir);
  }
  return output;
}

export interface DiagnosticDbFile {
  name: string;
  sizeBytes: number;
}

export interface DiagnosticMeta {
  generatedAt: string;
  appVersion: string;
  platform: string;
  /** 数据库 `PRAGMA user_version`（迁移版本）。 */
  userVersion: number;
  dbFiles: DiagnosticDbFile[];
  /** 最近 N 条日志尾部：模块日志文件名 → 行数组。 */
  logTail: Record<string, string[]>;
}

export interface DiagnosticPackage {
  meta: DiagnosticMeta;
  /** settings.json 全量（已脱敏）。 */
  settings: unknown;
  /** 同步目录文件名清单（已脱敏为 `~` 前缀，不含内容）。 */
  syncDirFiles: string[];
}

export interface DiagnosticInput {
  appVersion: string;
  platform: string;
  userVersion: number;
  /** 主库文件绝对路径（`layout.db`）。 */
  dbFilePath: string;
  /** 日志目录（`layout.logs`）。 */
  logsDir: string;
  /** 同步目录（`layout.root`）。 */
  syncDir: string;
  /** 用户主目录（路径脱敏基准）。 */
  homeDir: string;
  /** 完整设置（含 rootPath/schema）。 */
  settings: SeptcatsSettings;
  /** 每个模块日志取尾部行数（默认 200）。 */
  logTailLines?: number;
  /** 时间戳注入（测试用）。 */
  now?: () => string;
}

async function listDbFiles(dbFilePath: string): Promise<DiagnosticDbFile[]> {
  const files: DiagnosticDbFile[] = [];
  for (const candidate of [dbFilePath, `${dbFilePath}-wal`, `${dbFilePath}-shm`]) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        files.push({ name: basename(candidate), sizeBytes: stat.size });
      }
    } catch {
      // 文件不存在则跳过
    }
  }
  return files;
}

async function readLogTail(logsDir: string, tailLines: number): Promise<Record<string, string[]>> {
  let names: string[];
  try {
    names = (await fs.readdir(logsDir)).filter((name) => name.endsWith('.log')).sort();
  } catch {
    return {};
  }
  const output: Record<string, string[]> = {};
  for (const name of names) {
    try {
      const content = await fs.readFile(join(logsDir, name), 'utf8');
      output[name] = content
        .split('\n')
        .slice(-(tailLines + 1))
        .filter((line) => line.length > 0);
    } catch {
      output[name] = [];
    }
  }
  return output;
}

/** 递归收集同步目录文件名（跳过凭据目录；不含文件内容）。 */
async function listSyncDirFiles(syncDir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'credentials') {
          continue; // 不含凭据目录
        }
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  await walk(syncDir);
  return files;
}

/** 生成诊断包：先值级脱敏 settings，组装后再整包替换主目录绝对路径。 */
export async function buildDiagnosticPackage(input: DiagnosticInput): Promise<DiagnosticPackage> {
  const now = input.now ?? (() => new Date().toISOString());
  const tailLines = input.logTailLines ?? 200;

  const [dbFiles, logTail, syncDirFiles] = await Promise.all([
    listDbFiles(input.dbFilePath),
    readLogTail(input.logsDir, tailLines),
    listSyncDirFiles(input.syncDir),
  ]);

  const settings = redactSensitive(input.settings);

  const raw: DiagnosticPackage = {
    meta: {
      generatedAt: now(),
      appVersion: input.appVersion,
      platform: input.platform,
      userVersion: input.userVersion,
      dbFiles,
      logTail,
    },
    settings,
    syncDirFiles,
  };

  return redactHomeDir(raw, input.homeDir) as DiagnosticPackage;
}
