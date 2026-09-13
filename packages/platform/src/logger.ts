import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PathLayout } from './layout';

/**
 * 分模块文件日志（任务书 §4，Notion 风格 + electron-log 行格式）。
 *
 * 约束：
 * - `<logs>/<module>.log`，行格式 `[${ISO}] [${LEVEL}] (${module}) ${msg}${ctxJson}`；
 * - 立即 appendFileSync 落盘（不 flush 也在盘上），单文件超过阈值滚动为 `.old`（覆盖式）；
 * - 模块名白名单 `[a-z0-9-]{1,40}`；
 * - 写盘失败静默吞掉（日志器绝不能崩宿主），只累加 `droppedLines` 供 flush 返回；
 * - **脱敏红线**：ctx 中 key 命中 /token|secret|password|credential|apikey/i
 *   （不区分大小写、去分隔符比较）时值替换为 `[redacted]`，嵌套对象与数组递归处理。
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface ModuleLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface LoggerFlushResult {
  /** 因写盘失败被丢弃的行数（正常路径为 0）。 */
  droppedLines: number;
}

export interface Logger {
  forModule(name: string): ModuleLogger;
  flush(): Promise<LoggerFlushResult>;
}

export interface LoggerOptions {
  /** 低于该级别的日志直接丢弃（默认 info）。 */
  level?: LogLevel;
  /** 单文件滚动阈值，默认 10MB。 */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MODULE_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;
const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|apikey/i;
const LEVEL_LABEL: Record<LogLevel, string> = { info: 'INFO', warn: 'WARN', error: 'ERROR' };
const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

function rank(level: LogLevel): number {
  return LEVEL_RANK[level];
}

/** 去掉分隔符再小写比较：`api_key` / `apiKey` / `API-KEY` 都命中 `apikey`。 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.replace(/[\s._-]/g, '').toLowerCase());
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date || value instanceof Error) {
    return value;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(item);
  }
  return output;
}

function stringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? '[unserializable]' : text;
  } catch {
    return '[unserializable]';
  }
}

export function createLogger(layout: PathLayout, opts: LoggerOptions = {}): Logger {
  const minRank = rank(opts.level ?? 'info');
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const logsDir = layout.logs;
  const moduleLoggers = new Map<string, ModuleLogger>();
  let droppedLines = 0;

  function currentSize(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }

  function appendLine(moduleName: string, line: string): void {
    try {
      mkdirSync(logsDir, { recursive: true });
      const file = join(logsDir, `${moduleName}.log`);
      if (currentSize(file) >= maxBytes) {
        try {
          renameSync(file, `${file}.old`);
        } catch {
          // 滚动失败不阻断本次写入
        }
      }
      appendFileSync(file, line, 'utf8');
    } catch {
      // 日志器绝不能崩宿主：吞掉并计数
      droppedLines += 1;
    }
  }

  function emit(
    moduleName: string,
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>,
  ): void {
    if (rank(level) < minRank) {
      return;
    }
    const ctxPart = ctx === undefined ? '' : ` ${stringify(redactValue(ctx))}`;
    const line = `[${new Date().toISOString()}] [${LEVEL_LABEL[level]}] (${moduleName}) ${msg}${ctxPart}\n`;
    appendLine(moduleName, line);
  }

  return {
    forModule(name: string): ModuleLogger {
      const cached = moduleLoggers.get(name);
      if (cached !== undefined) {
        return cached;
      }
      if (!MODULE_NAME_PATTERN.test(name)) {
        throw new Error(`E_LOG_MODULE_NAME：模块名必须是 [a-z0-9-]{1,40}：'${name}'`);
      }
      const logger: ModuleLogger = {
        info: (msg, ctx) => emit(name, 'info', msg, ctx),
        warn: (msg, ctx) => emit(name, 'warn', msg, ctx),
        error: (msg, ctx) => emit(name, 'error', msg, ctx),
      };
      moduleLoggers.set(name, logger);
      return logger;
    },

    flush(): Promise<LoggerFlushResult> {
      // 每次写入都是同步 appendFileSync，落到 flush 时已无缓冲；
      // 这里只把被吞掉的写失败行数交回调用方。
      return Promise.resolve({ droppedLines });
    },
  };
}
