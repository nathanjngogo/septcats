/**
 * page-export.test.ts —— TASK-T79-01 §B：page:export 服务（真库 + tmp 附件夹具）。
 *
 * 覆盖：scope 树展开纯函数 / 附件拷贝与内链改写 / 孤儿占位 / 全只读（源媒体与库零写入）/
 * 预览不落盘 / 目录选择取消 = 零落盘 / subtree 目录层级。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreExecutor, describeDb, makeCore, makeTempDb, requestOk } from './helpers';
import type { SqliteConstructor } from '../src/db/migrations';
import {
  blockSpecOfRow,
  collectSubtree,
  createPageExportService,
  registerPageExportIpc,
  sanitizeFileName,
  type PageLite,
} from '../src/main/pageExport';

const WORKSPACE = 'ws-t79';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function doc(text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
}

const temps: string[] = [];
function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe('page:export 纯函数', () => {
  it('sanitizeFileName：非法字符净化 / 空标题回落', () => {
    expect(sanitizeFileName('a/b:c*d?', 'x')).toBe('a_b_c_d_');
    expect(sanitizeFileName('   ', 'untitled')).toBe('untitled');
    expect(sanitizeFileName('正常标题', 'x')).toBe('正常标题');
  });

  it('IPC 注册：service=null → E_INVARIANT 前缀（DbServer 未就绪降级）', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerPageExportIpc(null, { handle: (channel, listener) => handlers.set(channel, listener) });
    const preview = handlers.get('page:export:preview');
    expect(preview).toBeDefined();
    await expect(preview!({ pageId: 'pg', scope: 'single' })).rejects.toThrow(/E_INVARIANT/);
    await expect(preview!({ pageId: 'pg', scope: 'bogus' })).rejects.toThrow(/E_INVARIANT/);
  });

  it('collectSubtree：根 + 活后代先序', () => {
    const nodes: PageLite[] = [
      { id: 'r', parentId: null, title: 'R', pageType: 'page' },
      { id: 'a', parentId: 'r', title: 'A', pageType: 'page' },
      { id: 'a1', parentId: 'a', title: 'A1', pageType: 'page' },
      { id: 'b', parentId: 'r', title: 'B', pageType: 'page' },
    ];
    expect(collectSubtree('r', nodes).map((node) => node.id)).toEqual(['r', 'a', 'a1', 'b']);
    expect(collectSubtree('a', nodes).map((node) => node.id)).toEqual(['a', 'a1']);
    expect(collectSubtree('missing', nodes)).toEqual([]);
  });

  it('blockSpecOfRow：content 分流与 blocks.list 同一实现（table/toggle 结构化、image null）', () => {
    const row = { type: 'table', props_json: '{}', content_json: JSON.stringify({ rows: [['格A']], header: true }) };
    expect(blockSpecOfRow(row).content).toEqual({ rows: [['格A']], header: true });
    expect(
      blockSpecOfRow({ ...row, type: 'toggle', content_json: JSON.stringify({ title: 'T', body: ['b'] }) }).content,
    ).toEqual({ title: 'T', body: ['b'] });
    expect(blockSpecOfRow({ ...row, type: 'image', content_json: '{}' }).content).toBeNull();
    expect(blockSpecOfRow({ ...row, type: 'divider' }).content).toBeNull();
    expect(blockSpecOfRow({ ...row, type: 'code', content_json: 'const a = 1;' }).content).toBe('const a = 1;');
    expect(blockSpecOfRow({ ...row, type: 'paragraph', content_json: doc('正文') }).content).toEqual(JSON.parse(doc('正文')));
    // 损坏 JSON 仍降级为空段落，块本身不丢
    expect(blockSpecOfRow({ ...row, type: 'paragraph', content_json: '{坏了' }).content).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });
});

// ---------------------------------------------------------------------------
// 服务（真库 + tmp 附件夹具）
// ---------------------------------------------------------------------------

describeDb('page:export 服务', (ctor: SqliteConstructor) => {
  interface Fixture {
    executor: ReturnType<typeof coreExecutor>;
    attachmentsDir: string;
    attachmentHash: string;
    attachmentBytes: Uint8Array;
    dispose(): void;
  }

  async function fixture(): Promise<Fixture> {
    const db = makeTempDb('t79-export');
    const core = makeCore(ctor, db.path);
    await requestOk(core, { id: 'migrate', t: 'migrate' });
    const raw = core.activeDatabase();

    const insPage = raw.prepare(
      `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, 1, 1)`,
    );
    insPage.run('pg-root', WORKSPACE, '根页', null, 'A1');
    insPage.run('pg-child', WORKSPACE, '子页', 'pg-root', 'A2');
    insPage.run('pg-leaf', WORKSPACE, '孙页', 'pg-child', 'A3');
    insPage.run('pg-other', WORKSPACE, '别页', null, 'A4');

    const insBlock = raw.prepare(
      `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, 1)`,
    );

    const attachmentBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const attachmentHash = sha256(attachmentBytes);
    const attachmentsDir = tempDir('t79-att');
    writeFileSync(join(attachmentsDir, `${attachmentHash}.png`), attachmentBytes);

    insBlock.run('bk-p1', 'pg-root', WORKSPACE, 'paragraph', '{}', doc('根页正文'), 'A1', WORKSPACE);
    insBlock.run(
      'bk-img',
      'pg-root',
      WORKSPACE,
      'image',
      JSON.stringify({ file_id: attachmentHash, caption: '猫图' }),
      null,
      'A2',
      WORKSPACE,
    );
    insBlock.run(
      'bk-orphan',
      'pg-root',
      WORKSPACE,
      'image',
      JSON.stringify({ file_id: 'deadbeef', caption: '缺图' }),
      null,
      'A3',
      WORKSPACE,
    );
    insBlock.run('bk-c1', 'pg-child', WORKSPACE, 'code', JSON.stringify({ lang: 'ts' }), 'const a = 1;', 'A1', WORKSPACE);

    return {
      executor: coreExecutor(core),
      attachmentsDir,
      attachmentHash,
      attachmentBytes,
      dispose: () => {
        core.dispose();
        db.cleanup();
      },
    };
  }

  function serviceOf(fx: Fixture, pickDirectory: () => Promise<string | null>): ReturnType<typeof createPageExportService> {
    return createPageExportService({
      executor: fx.executor,
      attachmentsDir: fx.attachmentsDir,
      activeWorkspaceId: async () => WORKSPACE,
      pickDirectory,
    });
  }

  it('preview 只读：列页/文件/孤儿，零落盘', async () => {
    const fx = await fixture();
    const service = serviceOf(fx, async () => null);
    const preview = await service.preview({ pageId: 'pg-root', scope: 'subtree' });

    expect(preview.rootName).toBe('根页');
    expect(preview.pages.map((page) => page.relPath)).toEqual(['根页.md', '子页/子页.md', '子页/孙页/孙页.md']);
    expect(preview.counts).toMatchObject({ pages: 3, markdown: 3, assets: 1, orphans: 1 });
    expect(preview.files.some((file) => file.kind === 'asset' && file.relPath === `files/${fx.attachmentHash}.png`)).toBe(true);
    // 别页不在子树内
    expect(preview.pages.some((page) => page.pageId === 'pg-other')).toBe(false);
    fx.dispose();
  });

  it('confirm：写 md（内链改写成相对路径）+ 拷贝附件 + 孤儿占位注释', async () => {
    const fx = await fixture();
    const outDir = tempDir('t79-out');
    const service = serviceOf(fx, async () => outDir);
    const result = await service.confirm({ pageId: 'pg-root', scope: 'subtree' });
    if (result.canceled) {
      throw new Error('unexpected cancel');
    }

    const pkg = join(outDir, '根页');
    const rootMd = readFileSync(join(pkg, '根页.md'), 'utf8');
    expect(rootMd).toContain('根页正文');
    expect(rootMd).toContain(`![猫图](files/${fx.attachmentHash}.png)`);
    expect(rootMd).toContain('<!-- 附件缺失: asset://deadbeef -->');

    // 子页 md 在层级目录；附件链接按深度取相对前缀（此处无需附件，验层级文件在场）
    expect(existsSync(join(pkg, '子页', '子页.md'))).toBe(true);
    expect(existsSync(join(pkg, '子页', '孙页', '孙页.md'))).toBe(true);

    // 附件拷贝到场、内容一致
    const copied = join(pkg, 'files', `${fx.attachmentHash}.png`);
    expect(existsSync(copied)).toBe(true);
    expect([...readFileSync(copied)]).toEqual([...fx.attachmentBytes]);

    fx.dispose();
  });

  it('源媒体与库只读：导出后附件目录与 op_ledger 零变化', async () => {
    const fx = await fixture();
    const outDir = tempDir('t79-out-ro');
    const before = readdirSync(fx.attachmentsDir).sort();
    const service = serviceOf(fx, async () => outDir);
    await service.confirm({ pageId: 'pg-root', scope: 'single' });
    expect(readdirSync(fx.attachmentsDir).sort()).toEqual(before);

    const ledger = await fx.executor.all('opLedger.listAll', {});
    expect(ledger.rows).toHaveLength(0);
    fx.dispose();
  });

  it('目录选择取消 = 零落盘', async () => {
    const fx = await fixture();
    const outDir = tempDir('t79-cancel');
    const service = serviceOf(fx, async () => null);
    const result = await service.confirm({ pageId: 'pg-root', scope: 'single' });
    expect(result).toEqual({ canceled: true });
    expect(readdirSync(outDir)).toHaveLength(0);
    fx.dispose();
  });

  it('subtree 子页 md 的附件链接用 ../files 前缀', async () => {
    const fx = await fixture();
    const outDir = tempDir('t79-rel');
    // 在子页也放一张图，验深度 1 的相对前缀
    const raw = fx.executor;
    await raw.run('block.upsert', {
      id: 'bk-c-img',
      page_id: 'pg-child',
      workspace_id: WORKSPACE,
      type: 'image',
      props_json: JSON.stringify({ file_id: fx.attachmentHash, caption: '子图' }),
      content_json: null,
      sort_key: 'A2',
      alive: 1,
      version: 1,
      lamport_c: 2,
      lamport_d: 'aaaa0001',
      updated_at: 2,
    });
    const service = serviceOf(fx, async () => outDir);
    await service.confirm({ pageId: 'pg-root', scope: 'subtree' });
    const childMd = readFileSync(join(outDir, '根页', '子页', '子页.md'), 'utf8');
    expect(childMd).toContain(`![子图](../files/${fx.attachmentHash}.png)`);
    fx.dispose();
  });

  it('单页导出：仅本页，（无 dir 时）走 pickDirectory', async () => {
    const fx = await fixture();
    const outDir = tempDir('t79-single');
    const service = serviceOf(fx, async () => outDir);
    const result = await service.confirm({ pageId: 'pg-child', scope: 'single' });
    if (result.canceled) {
      throw new Error('unexpected cancel');
    }
    expect(result.pages.map((page) => page.pageId)).toEqual(['pg-child']);
    expect(existsSync(join(outDir, '子页', '子页.md'))).toBe(true);
    expect(existsSync(join(outDir, '子页', '子页', '孙页.md'))).toBe(false);
    fx.dispose();
  });

  it('导出：table 单元格文本进 md（缺陷 A 复现夹具 3×3，header 分隔行在场）', async () => {
    const fx = await fixture();
    await fx.executor.run('block.upsert', {
      id: 'bk-table',
      page_id: 'pg-root',
      workspace_id: WORKSPACE,
      type: 'table',
      props_json: '{}',
      content_json: JSON.stringify({ rows: [['格A', '', ''], ['', '', ''], ['', '', '']], header: true }),
      sort_key: 'A9',
      alive: 1,
      version: 1,
      lamport_c: 2,
      lamport_d: 'aaaa0001',
      updated_at: 2,
    });
    const outDir = tempDir('t79-table');
    const service = serviceOf(fx, async () => outDir);
    await service.confirm({ pageId: 'pg-root', scope: 'single' });
    const md = readFileSync(join(outDir, '根页', '根页.md'), 'utf8');
    expect(md).toContain('| 格A |  |  |');
    expect(md).toContain('| --- | --- | --- |');
    // 3×3：表头 + 分隔行 + 2 数据行
    expect(md.split('\n').filter((line) => line.startsWith('| ')).length).toBe(4);
    fx.dispose();
  });

  it('导出：toggle 的 title 与 body 都进 md', async () => {
    const fx = await fixture();
    await fx.executor.run('block.upsert', {
      id: 'bk-toggle',
      page_id: 'pg-root',
      workspace_id: WORKSPACE,
      type: 'toggle',
      props_json: '{}',
      content_json: JSON.stringify({ title: '折叠标题Q', body: ['正文行R'] }),
      sort_key: 'A10',
      alive: 1,
      version: 1,
      lamport_c: 3,
      lamport_d: 'aaaa0001',
      updated_at: 3,
    });
    const outDir = tempDir('t79-toggle');
    const service = serviceOf(fx, async () => outDir);
    await service.confirm({ pageId: 'pg-root', scope: 'single' });
    const md = readFileSync(join(outDir, '根页', '根页.md'), 'utf8');
    expect(md).toContain('> [!toggle] 折叠标题Q');
    expect(md).toContain('> 正文行R');
    fx.dispose();
  });

  it('reveal：目录不存在 → E_MALFORMED', async () => {
    const fx = await fixture();
    const service = serviceOf(fx, async () => null);
    await expect(service.reveal({ dir: join(fx.attachmentsDir, 'not-here') })).rejects.toMatchObject({
      code: 'E_MALFORMED',
    });
    fx.dispose();
  });

  it('页面不存在 → E_NOT_FOUND', async () => {
    const fx = await fixture();
    const service = serviceOf(fx, async () => null);
    await expect(service.preview({ pageId: 'pg-missing', scope: 'single' })).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    });
    fx.dispose();
  });
});
