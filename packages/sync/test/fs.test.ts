import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../src/fs';
import { NotFoundError, SkipError } from '../src/errors';

describe('MemoryFs', () => {
  it('write/read/exists/size 基础读写', async () => {
    const fs = new MemoryFs();
    await fs.write('a/b.txt', 'hello');
    expect(await fs.read('a/b.txt')).toBe('hello');
    expect(await fs.exists('a/b.txt')).toBe(true);
    expect(await fs.size('a/b.txt')).toBe(5);
  });

  it('size 按 UTF-8 字节数', async () => {
    const fs = new MemoryFs();
    await fs.write('x', '中文');
    expect(await fs.size('x')).toBe(Buffer.byteLength('中文', 'utf8'));
  });

  it('list 仅返回直接子项文件名且不递归', async () => {
    const fs = new MemoryFs();
    await fs.write('root/seg-b.jsonl', 'b');
    await fs.write('root/seg-a.jsonl', 'a');
    await fs.write('root/sub/seg-c.jsonl', 'c');
    const names = await fs.list('root');
    expect(names).toEqual(['seg-a.jsonl', 'seg-b.jsonl']);
  });

  it('write ifAbsent 命中已存在文件抛 SkipError', async () => {
    const fs = new MemoryFs();
    await fs.write('x', '1', { ifAbsent: true });
    await expect(fs.write('x', '2', { ifAbsent: true })).rejects.toBeInstanceOf(SkipError);
    // 已存在内容不被覆盖
    expect(await fs.read('x')).toBe('1');
  });

  it('write 非 ifAbsent 覆盖写', async () => {
    const fs = new MemoryFs();
    await fs.write('x', '1');
    await fs.write('x', '2');
    expect(await fs.read('x')).toBe('2');
  });

  it('remove 幂等（不存在不抛）', async () => {
    const fs = new MemoryFs();
    await fs.remove('missing');
    await fs.write('x', '1');
    await fs.remove('x');
    expect(await fs.exists('x')).toBe(false);
    await fs.remove('x');
  });

  it('read/size 不存在抛 NotFoundError', async () => {
    const fs = new MemoryFs();
    await expect(fs.read('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(fs.size('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('injectFailure halfwrite 写截断（S2）', async () => {
    const fs = new MemoryFs();
    fs.injectFailure = 'halfwrite';
    await fs.write('seg.jsonl', '0123456789');
    expect(await fs.read('seg.jsonl')).toBe('01234');
  });

  it('injectFailure duplicate 额外写网盘副本（S3）', async () => {
    const fs = new MemoryFs();
    fs.injectFailure = 'duplicate';
    await fs.write('seg-x.jsonl', 'body');
    expect(await fs.read('seg-x.jsonl')).toBe('body');
    expect(await fs.read('seg-x (1).jsonl')).toBe('body');
  });

  it('injectFailure 自定义函数可改写内容', async () => {
    const fs = new MemoryFs();
    fs.injectFailure = (op) => {
      op.content = op.content.toUpperCase();
    };
    await fs.write('x', 'abc');
    expect(await fs.read('x')).toBe('ABC');
  });
});
