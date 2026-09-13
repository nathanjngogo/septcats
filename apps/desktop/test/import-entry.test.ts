/**
 * import-entry.test.ts —— 导入器三态入口（TASK-T11-01C §1）。
 *
 * 覆盖：
 * - 三态入口检测：.zip / 目录 / .csv（dirPath 兼 .md 单文件变体）经 defaultSourceLoader；
 * - zip 解压：fflate 内存合成 zip（禁二进制大文件），内容逐一断言 + zip slip 收口；
 * - E_TOO_LARGE 透传：PlanTooLargeError → code 'E_TOO_LARGE'（IPC 错误映射口径）。
 *
 * 夹具全部程序化生成（临时目录 + 内存字节），不提交任何二进制文件。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { PlanTooLargeError } from '@septcats/importer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultSourceLoader,
  toImporterError,
  type ImporterService,
} from '../src/main/importer';
import type { StatementExecutor } from '../src/main/pages';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `septcats-import-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const encoder = new TextEncoder();

describe('defaultSourceLoader（三态入口检测）', () => {
  function tempFile(label: string, name: string, data: Uint8Array | string): string {
    const dir = makeTempDir(label);
    const path = join(dir, name);
    writeFileSync(path, typeof data === 'string' ? encoder.encode(data) : data);
    return path;
  }

  it('zip 源：fflate 解压为 Map（POSIX 键、内容逐字节一致），目录项与 zip slip 条目被拒', () => {
    const md = '# 研究笔记\n\n正文段落。';
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04]);
    const pageKey = `Export-2026-01-01/研究 ${'a'.repeat(32)}.md`;
    const tree: Zippable = {
      [pageKey]: encoder.encode(md),
      'Export-2026-01-01/img.png': png,
      'Export-2026-01-01/内嵌目录/': new Uint8Array(0),
      '../evil.md': encoder.encode('slip'),
      '/abs.md': encoder.encode('abs'),
    };
    const zipPath = tempFile('zip', 'export.zip', zipSync(tree));
    const loaded = defaultSourceLoader({ zipPath });

    expect(loaded.kind).toBe('notion-zip');
    expect(loaded.path).toBeUndefined();
    const keys = [...loaded.files.keys()].sort();
    expect(keys.filter((key) => !key.startsWith('Export-'))).toEqual([]);
    const mdKey = keys.find((key) => key.endsWith('.md'));
    expect(mdKey).toBeDefined();
    // 正文 md 与 png 都在（zip slip 的 ../evil.md、/abs.md 与目录项不在）
    expect(keys.filter((key) => key.endsWith('.md')).length).toBe(1);
    expect(loaded.files.get(mdKey!)).toEqual(encoder.encode(md));
    expect(loaded.files.get('Export-2026-01-01/img.png')).toEqual(png);
  });

  it('目录源：递归收集，rel 为 POSIX 相对路径，二进制附件原样字节', () => {
    const dir = makeTempDir('dir');
    mkdirSync(join(dir, '子目录'), { recursive: true });
    writeFileSync(join(dir, 'root.md'), encoder.encode('# 根页'));
    writeFileSync(join(dir, '子目录', 'leaf.md'), encoder.encode('# 叶页'));
    writeFileSync(join(dir, '子目录', 'pic.png'), new Uint8Array([1, 2, 3, 4]));

    const loaded = defaultSourceLoader({ dirPath: dir });
    expect(loaded.kind).toBe('md-dir');
    expect([...loaded.files.keys()].sort()).toEqual(['root.md', '子目录/leaf.md', '子目录/pic.png']);
    expect(loaded.files.get('root.md')).toEqual(encoder.encode('# 根页'));
    expect(loaded.files.get('子目录/pic.png')).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('csv 源：单文件 → kind csv，源内路径取 basename；md 单文件经 dirPath → kind md-file', () => {
    const csvPath = tempFile('csv', '台账.csv', 'Name,Age\n甲,3\n');
    const loadedCsv = defaultSourceLoader({ csvPath });
    expect(loadedCsv.kind).toBe('csv');
    expect(loadedCsv.path).toBe('台账.csv');
    expect(loadedCsv.files.get('台账.csv')).toEqual(encoder.encode('Name,Age\n甲,3\n'));

    const mdPath = tempFile('md', '单页.md', '# 单页\n');
    const loadedMd = defaultSourceLoader({ dirPath: mdPath });
    expect(loadedMd.kind).toBe('md-file');
    expect(loadedMd.path).toBe('单页.md');
    expect(loadedMd.files.get('单页.md')).toEqual(encoder.encode('# 单页\n'));
  });

  it('非法入口：三字段全空 / 多填 / dirPath 指向非 md 文件 → E_MALFORMED', async () => {
    const csvPath = tempFile('bad', 'x.csv', 'A\n1\n');
    const txtPath = tempFile('bad', 'x.txt', '不是 md');
    expect(() => defaultSourceLoader({})).toThrowError(/三选一|恰好/);
    // 多填在 service.plan 入口校验（loader 本身按 zipPath 优先）
    const { createImporterService } = await import('../src/main/importer');
    const service = createImporterService({
      executor: stubExecutor(),
      actor: 'aaaa0001',
      attachmentsDir: makeTempDir('attachments'),
      activeWorkspaceId: async () => 'ws-test',
      loadSource: defaultSourceLoader,
    });
    await expect(service.plan({ zipPath: csvPath, csvPath })).rejects.toMatchObject({
      code: 'E_MALFORMED',
    });
    expect(() => defaultSourceLoader({ dirPath: txtPath })).toThrowError(/只支持目录|\.md/);
  });
});

// ---------------------------------------------------------------------------
// E_TOO_LARGE 透传（熔断边界 5000/5001 已由 packages/importer test/plan.test.ts 锁定）
// ---------------------------------------------------------------------------

function stubExecutor(): StatementExecutor {
  return {
    run: () => {
      throw new Error('stub 不应触达 run');
    },
    get: () => {
      throw new Error('stub 不应触达 get');
    },
    all: () => {
      throw new Error('stub 不应触达 all');
    },
    batch: () => {
      throw new Error('stub 不应触达 batch');
    },
  };
}

describe('E_TOO_LARGE 透传', () => {
  it('toImporterError：PlanTooLargeError → ImporterApiError(E_TOO_LARGE)，消息含条目数', () => {
    const mapped = toImporterError(new PlanTooLargeError(5001));
    expect(mapped.code).toBe('E_TOO_LARGE');
    expect(mapped.message).toContain('5001');
  });

  it('service.plan：装载期熔断错误原样透传（code 保持 E_TOO_LARGE）', async () => {
    const { createImporterService } = await import('../src/main/importer');
    const service: ImporterService = createImporterService({
      executor: stubExecutor(),
      actor: 'aaaa0001',
      attachmentsDir: makeTempDir('attachments'),
      activeWorkspaceId: async () => 'ws-test',
      loadSource: () => {
        throw new PlanTooLargeError(5001);
      },
    });
    await expect(service.plan({ zipPath: 'whatever.zip' })).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    });
  });
});

// ---------------------------------------------------------------------------
// ImportWizard 纯逻辑（TASK-T11-01C §2：步骤状态机 + 按钮文案，UI 不做组件测试）
// ---------------------------------------------------------------------------

describe('ImportWizard 纯逻辑', async () => {
  const { wizardNext, confirmLabel, tooLargeCount } = await import('../src/renderer/src/pages/ImportWizard');

  it('wizardNext：pick→preview→execute→result 主链，back/restart 回退，无关事件保持原步', () => {
    expect(wizardNext('pick', { type: 'picked' })).toBe('preview');
    expect(wizardNext('preview', { type: 'confirmed' })).toBe('execute');
    expect(wizardNext('execute', { type: 'finished' })).toBe('result');
    expect(wizardNext('result', { type: 'restart' })).toBe('pick');
    expect(wizardNext('preview', { type: 'back' })).toBe('pick');
    expect(wizardNext('preview', { type: 'picked' })).toBe('preview');
    expect(wizardNext('pick', { type: 'back' })).toBe('pick');
  });

  it('confirmLabel：warnings 非空 →「继续导入（N 项降级）」，否则「开始导入」；tooLargeCount 提取条目数', () => {
    expect(confirmLabel([])).toBe('开始导入');
    expect(confirmLabel([{ action: 'skipped-duplicate' }])).toBe('开始导入');
    expect(
      confirmLabel([{ action: 'degraded' }, { action: 'skipped-duplicate' }, { action: 'degraded' }]),
    ).toBe('继续导入（2 项降级）');
    expect(tooLargeCount('E_TOO_LARGE: 单计划 5001 个条目，超过上限 5000，请分批导')).toBe(5001);
    expect(tooLargeCount('无关错误')).toBeNull();
  });
});
