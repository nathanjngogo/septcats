/**
 * main/ai/cache.ts —— 模型列表 TTL 内存缓存（TASK-T18-01 §2.7）。
 *
 * 照办公插件 E-030 已验证的拉取+TTL 模式：`(monotonic_ts, models)` 窗口，
 * 默认 TTL 60s；时钟注入（测试用假时钟）。键由 service 拼：
 * `${providerId}|${baseUrl}`（改 URL 自动失效）。过期条目 get 返回 null 并删除。
 *
 * 纯 Node（不 import electron），可直测。
 */
interface CacheEntry {
  models: string[];
  fetchedAt: number;
}

export class ModelListCache {
  private readonly ttlMs: number;
  private readonly nowFn: () => number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(ttlMs: number = 60_000, nowFn: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.nowFn = nowFn;
  }

  /** TTL 内命中返回条目；过期（或不存在）返回 null 并删除过期条目。 */
  get(key: string): { models: string[]; fetchedAt: number } | null {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (this.nowFn() - entry.fetchedAt >= this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, models: string[], fetchedAt: number = this.nowFn()): void {
    this.entries.set(key, { models: [...models], fetchedAt });
  }

  /** 失效：给 key 只删该键；不给清空全部（设置变更即失效语义的兜底口）。 */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
    } else {
      this.entries.delete(key);
    }
  }
}
