/**
 * ai-cache.test.ts —— 模型列表 TTL 缓存（TASK-T18-01 §3，假时钟）。
 *
 * 覆盖：TTL 内命中 / 过期 miss（条目被删）/ 键隔离（同 provider 改 baseUrl 不吃旧缓存）/
 * invalidate（单键与全清）/ set 拷贝入参数组。
 */
import { describe, expect, it } from 'vitest';
import { ModelListCache } from '../src/main/ai/cache';

describe('ai/cache ModelListCache', () => {
  it('TTL 内命中；过期 miss 且条目被删', () => {
    let now = 1_000;
    const cache = new ModelListCache(60_000, () => now);
    cache.set('p|http://a', ['m1', 'm2'], now);

    now += 59_999;
    expect(cache.get('p|http://a')).toEqual({ models: ['m1', 'm2'], fetchedAt: 1_000 });

    now += 1;
    expect(cache.get('p|http://a')).toBeNull();
    // 已删除：时间倒流也不再命中
    now = 1_000;
    expect(cache.get('p|http://a')).toBeNull();
  });

  it('ttl=0 时 get 恒 miss（测试注入语义）', () => {
    const cache = new ModelListCache(0, () => 42);
    cache.set('k', ['m']);
    expect(cache.get('k')).toBeNull();
  });

  it('键隔离：同 provider 改 baseUrl 不吃旧缓存', () => {
    const cache = new ModelListCache(60_000, () => 10);
    cache.set('p|http://127.0.0.1:1234', ['a']);
    cache.set('p|http://api.example.com', ['b']);
    expect(cache.get('p|http://127.0.0.1:1234')?.models).toEqual(['a']);
    expect(cache.get('p|http://api.example.com')?.models).toEqual(['b']);
    expect(cache.get('p|http://other:1')).toBeNull();
  });

  it('invalidate 单键；不给 key 清空全部', () => {
    const cache = new ModelListCache(60_000, () => 10);
    cache.set('k1', ['a']);
    cache.set('k2', ['b']);
    cache.invalidate('k1');
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')?.models).toEqual(['b']);
    cache.invalidate();
    expect(cache.get('k2')).toBeNull();
  });

  it('set 拷贝入参数组（外部改写不影响缓存）', () => {
    const cache = new ModelListCache(60_000, () => 10);
    const models = ['a'];
    cache.set('k', models);
    models.push('b');
    expect(cache.get('k')?.models).toEqual(['a']);
  });
});
