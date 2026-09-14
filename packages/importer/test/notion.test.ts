import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseNotionZip, cleanNotionName, preprocessNotionMarkdown } from '../src/notion';
import { importPlanSchema } from '../src/types';
import type { ImportPlan, ImportSourceFs } from '../src/types';

// ---------------------------------------------------------------------------
// 内存 Map 版 ImportSourceFs（任务书 §0.1）+ 程序化夹具（§6：禁二进制大文件）
// ---------------------------------------------------------------------------

function memoryFs(entries: Record<string, string | Uint8Array>): ImportSourceFs {
  const map = new Map<string, string | Uint8Array>(Object.entries(entries));
  return {
    list: () => [...map.keys()],
    read: (path: string) => {
      const value = map.get(path);
      if (value === undefined) {
        throw new Error(`missing: ${path}`);
      }
      return value;
    },
  };
}

/** 确定性 32hex 页 id（夹具用，非真实 SPACE-ID 也满足命名契约）。 */
function hexId(n: number): string {
  return n.toString(16).padStart(32, '0');
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

/**
 * 合成 Notion「Markdown & CSV」导出包：
 * - 20 个 md 页面、3 层嵌套（工作区 → 5 个二级 → 各 2~4 个三级）；
 * - 2 个 database（任务库：类型推断全覆盖；联系人：relation 候选）；
 * - 1 个本地附件 + 1 个 http 外链图 + page-ref/公式/synced/toc/embed/@提及 各一处。
 */
function notionFixture(): { fs: ImportSourceFs } {
  const files: Record<string, string | Uint8Array> = {};

  // —— 页面树（20 页，3 层）——
  const L1 = { title: '工作区', id: 0, parent: '' };
  const L2 = [
    { title: '项目甲', id: 1 },
    { title: '项目乙', id: 2 },
    { title: '会议', id: 3 },
    { title: '归档', id: 4 },
    { title: '阅读', id: 5 },
  ];
  const L3: Array<{ title: string; id: number; parent: string }> = [
    { title: '剪贴板', id: 6, parent: '项目甲' },
    { title: '图片页', id: 7, parent: '项目甲' },
    { title: '灵感', id: 8, parent: '项目甲' },
    { title: '规划', id: 9, parent: '项目甲' },
    { title: '复盘', id: 10, parent: '项目乙' },
    { title: '周报', id: 11, parent: '项目乙' },
    { title: '随想', id: 12, parent: '项目乙' },
    { title: '面经', id: 13, parent: '项目乙' },
    { title: '站会', id: 14, parent: '会议' },
    { title: '周会', id: 15, parent: '会议' },
    { title: '清理', id: 16, parent: '归档' },
    { title: '旧笔记', id: 17, parent: '归档' },
    { title: '书单', id: 18, parent: '阅读' },
    { title: '待读', id: 19, parent: '阅读' },
  ];

  const dirOf = (title: string, id: number, parentDir: string): string =>
    parentDir.length > 0 ? `${parentDir}/${title} ${hexId(id)}` : `${title} ${hexId(id)}`;
  const mdOf = (dir: string, title: string, id: number): string => `${dir}/${title} ${hexId(id)}.md`;

  const rootDir = dirOf(L1.title, L1.id, '');
  const dirs = new Map<string, string>([[L1.title, rootDir]]);
  files[mdOf(rootDir, L1.title, L1.id)] = '# 工作区\n\n欢迎来到工作区。\n';

  for (const page of L2) {
    const dir = dirOf(page.title, page.id, rootDir);
    dirs.set(page.title, dir);
    files[mdOf(dir, page.title, page.id)] = `# ${page.title}\n\n二级页面 ${page.title} 的正文。\n`;
  }
  for (const page of L3) {
    const parentDir = dirs.get(page.parent) as string;
    const dir = dirOf(page.title, page.id, parentDir);
    let body = `# ${page.title}\n\n三级页面 ${page.title} 的正文。\n`;
    if (page.title === '规划') {
      body = [
        '# 规划',
        '',
        `详情见 [规划详情](#${hexId(88)})。`,
        '',
        '$$',
        'E = mc^2',
        '$$',
        '',
        '质能方程 $E = mc^2$ 内联。',
        '',
        '![远程](https://cdn.example.com/remote.png)',
        '',
      ].join('\n');
    }
    if (page.title === '图片页') {
      body = '# 图片页\n\n![小猫](assets/cat.png)\n';
      files[`${dir}/assets/cat.png`] = PNG_BYTES;
    }
    if (page.title === '周会') {
      body = '# 周会\n\n:::synced\n每周一同步进展。\n同步结束。\n:::\n\n今天 @张三 汇报。\n';
    }
    if (page.title === '待读') {
      body = '# 待读\n\n:::toc\n';
    }
    if (page.title === '旧笔记') {
      body = '# 旧笔记\n\n:::embed https://example.com/board\n';
    }
    files[mdOf(dir, page.title, page.id)] = body;
  }

  // —— database 1：任务库（工作区下，类型推断全覆盖）——
  const db1Dir = `${rootDir}/任务库 ${hexId(100)}`;
  files[`${db1Dir}/任务库 ${hexId(100)}.csv`] = [
    '名称,截止日期,预算,完成,标签,备注',
    '写周报,2024-01-02,100,true,"工作,紧急",',
    '买猫粮,2025-12-31T08:30:00Z,50.5,false,"生活",优先',
    '整理书架,,3,true,,N-02 混合',
    '',
  ].join('\n');

  // —— database 2：联系人（项目乙下，Name 列 + relation 候选）——
  const db2Dir = `${rootDir}/项目乙 ${hexId(2)}/联系人 ${hexId(101)}`;
  files[`${db2Dir}/联系人 ${hexId(101)}.csv`] = [
    'Name,邮箱,关联页面',
    '张三,z@x.com,规划',
    '李四,l@x.com,周会',
    '',
  ].join('\n');

  return { fs: memoryFs(files) };
}
// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------

function pagesOf(plan: ImportPlan) {
  return plan.items.filter((item) => item.op === 'page');
}
function collectionsOf(plan: ImportPlan) {
  return plan.items.filter((item) => item.op === 'collection');
}
function assetsOf(plan: ImportPlan) {
  return plan.items.filter((item) => item.op === 'asset');
}

describe('preprocessNotionMarkdown：§5 降级（围栏感知）', () => {
  it('page-ref → 纯文本；块公式/行内公式 → code；@提及保留；围栏内不触发', () => {
    const md = [
      '见 [甲](#000000000000000000000000000000ff) 与 [乙](#11111111-2222-3333-4444-555555555555)。',
      '$$',
      'x = 1',
      '$$',
      '值 $a+b$ 内联。',
      '```',
      '$$这里的 $x$ 不算$$',
      '```',
      '邮箱 foo@bar.com 不算提及。',
    ].join('\n');
    const { text, warnings } = preprocessNotionMarkdown('p.md', md);
    expect(text).toContain('见 甲 与 乙。');
    expect(text).not.toContain('](#');
    expect(text).toContain('```\nx = 1\n```');
    expect(text).toContain('`$a+b$`');
    expect(text).toContain('$$这里的 $x$ 不算$$'); // 围栏内原样
    expect(text).toContain('foo@bar.com');
    const whats = warnings.map((w) => w.what).sort();
    // warning 按文件聚合：2 处 page-ref 合并为 1 条（note 含计数）
    expect(whats).toEqual(['公式', '行内公式', '页面引用']);
    const pageRef = warnings.find((w) => w.what === '页面引用');
    expect(pageRef?.note).toContain('2 处');
    expect(warnings.every((w) => w.action === 'degraded' && w.path === 'p.md')).toBe(true);
  });

  it('synced 块 → quote 占位且内容保留；embed/toc → quote 占位；未闭合 synced 不静默', () => {
    const a = preprocessNotionMarkdown('a.md', ':::synced\n内容甲\n:::\n后文');
    expect(a.text).toContain('> 📎 此处原为 Synced block（原文 1 行）：内容甲');
    const b = preprocessNotionMarkdown('b.md', ':::toc\n:::embed https://x.y\n:::synced\n未闭合');
    const whats = b.warnings.map((w) => w.what).sort();
    expect(whats).toEqual(['Synced block', '嵌入视图', '目录（TOC）']);
    expect(b.text).toContain('https://x.y');
    expect(b.text).toContain('未闭合');
  });
});

describe('parseNotionZip：合成 20 页 3 层嵌套 + 2 db + 附件', () => {
  const { fs } = notionFixture();
  const plan: ImportPlan = parseNotionZip(fs, 'Notion 导出');

  it('plan 过 zod 契约；source 与 counts 汇总正确', () => {
    expect(() => importPlanSchema.parse(plan)).not.toThrow();
    expect(plan.source).toEqual({ kind: 'notion-zip', rootName: 'Notion 导出' });
    expect(plan.counts.pages).toBe(20);
    expect(plan.counts.collections).toBe(2);
    expect(plan.counts.records).toBe(5);
    expect(plan.counts.assets).toBe(1);
    // 降级不静默：9 处降级全部有 warning
    expect(plan.counts.degraded).toBe(9);
    const whats = plan.warnings.map((w) => w.what).sort();
    expect(whats).toEqual(
      [
        'Synced block',
        'relation 候选',
        '公式',
        '嵌入视图',
        '页面引用',
        '行内公式',
        '提及',
        '目录（TOC）',
        'http 外链图片',
      ].sort(),
    );
  });

  it('cleanNotionName：剥 32hex 后缀；无后缀原样', () => {
    expect(cleanNotionName('任务库 00000000000000000000000000000064')).toBe('任务库');
    expect(cleanNotionName('普通名')).toBe('普通名');
  });

  it('页面树：先序（父必在子前）、parentPath 链正确、20 页 1+5+14 分层', () => {
    const pages = pagesOf(plan);
    expect(pages).toHaveLength(20);
    const seen = new Set<string>();
    let level1 = 0;
    let level2 = 0;
    let level3 = 0;
    for (const page of pages) {
      if (page.op !== 'page') {
        throw new Error('unreachable');
      }
      if (page.parentPath === null) {
        level1 += 1;
        expect(page.title).toBe('工作区');
      } else {
        expect(seen.has(page.parentPath)).toBe(true); // 先序：父页已出现
        const depth = page.parentPath.split('/').length;
        if (depth === 1) {
          level2 += 1;
        } else if (depth === 2) {
          level3 += 1;
        }
      }
      seen.add(page.path);
    }
    expect(level1).toBe(1);
    expect(level2).toBe(5);
    expect(level3).toBe(14);
    // 抽查三层链
    const planning = pages.find((page) => page.op === 'page' && page.title === '规划');
    expect(planning).toMatchObject({
      path: '工作区/项目甲/规划',
      parentPath: '工作区/项目甲',
    });
  });

  it('正文走 A 阶段 markdown 路径：普通页 heading+paragraph；规划页降级块落位', () => {
    const pages = pagesOf(plan);
    const plain = pages.find((page) => page.op === 'page' && page.title === '灵感');
    if (plain?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(plain.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph']);

    const planning = pages.find((page) => page.op === 'page' && page.title === '规划');
    if (planning?.op !== 'page') {
      throw new Error('unreachable');
    }
    const types = planning.blocks.map((block) => block.type);
    expect(types).toEqual(['heading', 'paragraph', 'code', 'paragraph', 'image']);
    const code = planning.blocks[2];
    expect(code).toMatchObject({ type: 'code', props: { lang: '' }, content: 'E = mc^2' });
    const para = JSON.stringify(planning.blocks[1]);
    expect(para).toContain('详情见 规划详情。'); // page-ref 降级为纯文本
    expect(JSON.stringify(planning.blocks[3])).toContain('E = mc^2'); // 行内公式降级为行内 code 原文
    const remote = planning.blocks[4];
    expect(remote?.props['src']).toBe('https://cdn.example.com/remote.png'); // 外链保留
  });

  it('附件相对路径重写：sha256 asset item + image 块 asset://（复用 A 阶段逻辑）', () => {
    const hash = createHash('sha256').update(PNG_BYTES).digest('hex');
    const assets = assetsOf(plan);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset?.op === 'asset' && asset.hash).toBe(hash);
    expect(asset?.op === 'asset' && asset.ext).toBe('.png');

    const imagePage = pagesOf(plan).find((page) => page.op === 'page' && page.title === '图片页');
    if (imagePage?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(imagePage.blocks.map((block) => block.type)).toEqual(['heading', 'image']);
    const image = imagePage.blocks[1];
    expect(image).toEqual({ type: 'image', props: { src: `asset://${hash}.png`, name: '小猫' }, content: null });
  });

  it('synced/toc/embed 降级块落位：quote 占位写明原类型且内容不丢', () => {
    const pages = pagesOf(plan);
    const weekly = pages.find((page) => page.op === 'page' && page.title === '周会');
    if (weekly?.op !== 'page') {
      throw new Error('unreachable');
    }
    const quote = weekly.blocks[1];
    expect(quote?.type).toBe('quote');
    expect(JSON.stringify(quote?.content)).toContain('Synced block');
    expect(JSON.stringify(quote?.content)).toContain('每周一同步进展。');
    expect(JSON.stringify(quote?.content)).toContain('同步结束。');

    const todo = pages.find((page) => page.op === 'page' && page.title === '待读');
    if (todo?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(todo.blocks[1]?.type).toBe('quote');
    expect(JSON.stringify(todo.blocks[1]?.content)).toContain('TOC');
  });

  it('database 1（任务库）：类型推断 number/date/checkbox/multi_select/text + 空值 null', () => {
    const db = collectionsOf(plan).find((item) => item.op === 'collection' && item.title === '任务库');
    if (db?.op !== 'collection') {
      throw new Error('unreachable');
    }
    expect(db.parentPath).toBe('工作区');
    expect(db.path).toBe('工作区/任务库');
    expect(db.schema.title_pid).toBe('p1');
    const props = db.schema.properties;
    expect(props['p1']).toEqual({ name: '名称', type: 'text' });
    expect(props['p2']).toEqual({ name: '截止日期', type: 'date' });
    expect(props['p3']).toEqual({ name: '预算', type: 'number' });
    expect(props['p4']).toEqual({ name: '完成', type: 'checkbox' });
    expect(props['p5']).toEqual({
      name: '标签',
      type: 'multi_select',
      options: [
        { id: 'p5-o1', name: '工作' },
        { id: 'p5-o2', name: '紧急' },
        { id: 'p5-o3', name: '生活' },
      ],
    });
    expect(props['p6']).toEqual({ name: '备注', type: 'text' });

    expect(db.records[0]).toEqual({
      p1: '写周报',
      p2: { y: 2024, m: 1, d: 2 },
      p3: 100,
      p4: true,
      p5: ['p5-o1', 'p5-o2'],
      p6: null,
    });
    expect(db.records[1]).toEqual({
      p1: '买猫粮',
      p2: { y: 2025, m: 12, d: 31 },
      p3: 50.5,
      p4: false,
      p5: ['p5-o3'],
      p6: '优先',
    });
    expect(db.records[2]).toEqual({
      p1: '整理书架',
      p2: null,
      p3: 3,
      p4: true,
      p5: null,
      p6: 'N-02 混合',
    });
  });

  it('database 2（联系人）：Name 列 title + relation 候选降级 warning（不重建跨页 relation）', () => {
    const db = collectionsOf(plan).find((item) => item.op === 'collection' && item.title === '联系人');
    if (db?.op !== 'collection') {
      throw new Error('unreachable');
    }
    expect(db.parentPath).toBe('工作区/项目乙');
    expect(db.schema.title_pid).toBe('p1'); // Name 列
    expect(db.schema.properties['p2']).toEqual({ name: '邮箱', type: 'text' });
    expect(db.records[0]).toEqual({ p1: '张三', p2: 'z@x.com', p3: '规划' });

    const relation = plan.warnings.find((w) => w.what === 'relation 候选');
    expect(relation?.action).toBe('degraded');
    expect(relation?.note).toContain('关联页面');
    expect(relation?.note).toContain('2 个值');
  });
});

describe('parseNotionZip：散 CSV 兜底', () => {
  it('顶层散 CSV 与某页同名 → 归为该页 database；无名可归 → 挂根宿主空页 + warning（E：孤儿 collection 必须带宿主页，schema 层 page_id 非空）', () => {
    const files: Record<string, string> = {
      '会议 000000000000000000000000000000ab/会议 000000000000000000000000000000ab.md': '# 会议\n',
      // 顶层散 CSV：清理名「会议」与页面同名 → 该页的 database
      '会议 000000000000000000000000000000ab.csv': 'Name,备注\n甲,x\n',
      // 清理名与任何页面都不同名 → 挂根宿主空页 + warning
      '孤儿表 000000000000000000000000000000cd.csv': 'Name\nx\n',
    };
    const plan = parseNotionZip(memoryFs(files), '散件');
    expect(plan.counts.pages).toBe(2); // 会议页 + 孤儿宿主页
    expect(plan.counts.collections).toBe(2);
    const dbs = collectionsOf(plan);
    const attached = dbs.find((item) => item.op === 'collection' && item.title === '会议');
    expect(attached).toMatchObject({ parentPath: '会议', path: '会议/会议' });
    const orphan = dbs.find((item) => item.op === 'collection' && item.title === '孤儿表');
    expect(orphan).toMatchObject({ parentPath: '孤儿表', path: '孤儿表/孤儿表' });
    const host = plan.items.find(
      (it) => it.op === 'page' && it.title === '孤儿表' && it.blocks.length === 0,
    );
    expect(host).toMatchObject({ path: '孤儿表', parentPath: null });
    expect(plan.warnings.some((w) => w.what === 'CSV 数据库' && w.path.includes('孤儿表'))).toBe(true);
  });
});

describe('parseNotionZip：_all.csv 配对归并（D 阶段真包校准）', () => {
  it('_all+plain 配对（列不等）→ _all 优先建库、plain 跳过记 skipped-duplicate、relation 每库一次', () => {
    const rootDir = `工作区 ${hexId(0)}`;
    const dbDir = `${rootDir}/团队待办 ${hexId(100)}`;
    const files: Record<string, string> = {
      [`${rootDir}/工作区 ${hexId(0)}.md`]: '# 工作区\n',
      // plain（当前视图）：仅可见 2 列，行集 ⊂ _all
      [`${dbDir}/团队待办 ${hexId(100)}.csv`]: '名称,关联页面\n甲,工作区\n乙,工作区\n',
      // _all（全属性）：3 列（列不等）
      [`${dbDir}/团队待办 ${hexId(100)}_all.csv`]:
        '名称,状态,关联页面\n甲,doing,工作区\n乙,todo,工作区\n丙,done,工作区\n',
    };

    const plan = parseNotionZip(memoryFs(files), '配对');
    expect(plan.counts.collections).toBe(1);

    const db = collectionsOf(plan)[0];
    if (db?.op !== 'collection') {
      throw new Error('unreachable');
    }
    expect(db.title).toBe('团队待办'); // title 清理 _all 后缀（两源同库同名）
    expect(db.parentPath).toBe('工作区');
    expect(db.path).toBe('工作区/团队待办');
    // 建库源 = _all 那份：全属性 3 列 + 全行集
    expect(Object.values(db.schema.properties).map((property) => property.name)).toEqual([
      '名称',
      '状态',
      '关联页面',
    ]);
    expect(db.records).toHaveLength(3);

    // plain 跳过 + skipped-duplicate warning（note 写明替代关系）
    const skipped = plan.warnings.filter((w) => w.action === 'skipped-duplicate');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.path).toBe(`${dbDir}/团队待办 ${hexId(100)}.csv`);
    expect(skipped[0]?.note).toContain('当前视图 CSV 由 _all 全属性导出替代');

    // relation 候选每库只报一次（plain 与 _all 都有指向页面的列）
    expect(plan.warnings.filter((w) => w.what === 'relation 候选')).toHaveLength(1);
  });

  it('仅 plain（无 _all 配对）→ 照旧建库，无 skipped-duplicate', () => {
    const rootDir = `工作区 ${hexId(0)}`;
    const dbDir = `${rootDir}/任务库 ${hexId(100)}`;
    const files: Record<string, string> = {
      [`${rootDir}/工作区 ${hexId(0)}.md`]: '# 工作区\n',
      [`${dbDir}/任务库 ${hexId(100)}.csv`]: '名称,备注\n甲,x\n',
    };
    const plan = parseNotionZip(memoryFs(files), '仅plain');
    expect(plan.counts.collections).toBe(1);
    const db = collectionsOf(plan)[0];
    if (db?.op !== 'collection') {
      throw new Error('unreachable');
    }
    expect(db.title).toBe('任务库');
    expect(Object.values(db.schema.properties).map((property) => property.name)).toEqual(['名称', '备注']);
    expect(plan.warnings.filter((w) => w.action === 'skipped-duplicate')).toHaveLength(0);
  });

  it('仅 _all（无 plain）→ 以 _all 建库且 title 清理 _all 后缀，散 CSV 可挂到同名页', () => {
    const rootDir = `简报 ${hexId(0)}`;
    const files: Record<string, string> = {
      [`${rootDir}/简报 ${hexId(0)}.md`]: '# 简报\n',
      // 顶层散 CSV 的 _all 形态：清理名匹配同名页 → 挂为该页 database
      [`简报 ${hexId(0)}_all.csv`]: '名称,周次\n第 1 期,W1\n',
    };
    const plan = parseNotionZip(memoryFs(files), '仅all');
    expect(plan.counts.collections).toBe(1);
    const db = collectionsOf(plan)[0];
    if (db?.op !== 'collection') {
      throw new Error('unreachable');
    }
    expect(db.title).toBe('简报'); // _all 后缀被清理
    expect(db.parentPath).toBe('简报');
    expect(plan.warnings.some((w) => w.what === 'CSV 数据库')).toBe(false);
    expect(plan.warnings.filter((w) => w.action === 'skipped-duplicate')).toHaveLength(0);
  });

  it('同目录同名库（清理名同、32hex id 异）不误归并：各自与自己的 _all 配对', () => {
    const rootDir = `工作区 ${hexId(0)}`;
    // 真包形态：同一目录下多个「无标题」库，仅 id 不同
    const mk = (id: number, plain: string, all: string) => ({
      [`${rootDir}/无标题 ${hexId(id)}/无标题 ${hexId(id)}.csv`]: plain,
      [`${rootDir}/无标题 ${hexId(id)}/无标题 ${hexId(id)}_all.csv`]: all,
    });
    const files: Record<string, string> = {
      [`${rootDir}/工作区 ${hexId(0)}.md`]: '# 工作区\n',
      ...mk(100, '名称\n甲\n', '名称,状态\n甲,doing\n'),
      ...mk(101, '名称\n乙\n', '名称,优先级\n乙,P1\n'),
    };
    const plan = parseNotionZip(memoryFs(files), '同名库');
    expect(plan.counts.collections).toBe(2); // 不能把两个库并成 1 个
    expect(plan.warnings.filter((w) => w.action === 'skipped-duplicate')).toHaveLength(2);
    const schemas = collectionsOf(plan).map((item) =>
      item.op === 'collection' ? Object.values(item.schema.properties).map((property) => property.name) : [],
    );
    expect(schemas).toContainEqual(['名称', '状态']);
    expect(schemas).toContainEqual(['名称', '优先级']);
  });

  it('畸形 %zz 编码附件名：原样路径命中不炸；全 miss 回退原样记缺失', () => {
    const rootDir = `工作区 ${hexId(0)}`;
    const hitDir = `${rootDir}/命中 ${hexId(1)}`;
    const missDir = `${rootDir}/缺失 ${hexId(2)}`;
    const files: Record<string, string | Uint8Array> = {
      [`${rootDir}/工作区 ${hexId(0)}.md`]: '# 工作区\n',
      [`${hitDir}/命中 ${hexId(1)}.md`]: '# 命中\n\n![图](pic%zz.png)\n',
      [`${hitDir}/pic%zz.png`]: PNG_BYTES, // 源内就有字面 %zz 名 → 原样查找命中
      [`${missDir}/缺失 ${hexId(2)}.md`]: '# 缺失\n\n![ghost](no%zzpe.png)\n',
    };
    const plan = parseNotionZip(memoryFs(files), '畸形编码');
    expect(plan.counts.assets).toBe(1); // 字面 %zz 命中，解码异常不炸
    const missing = plan.warnings.filter((w) => w.what === '本地附件缺失');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.note).toContain('no%zzpe.png'); // 原样 src 保留
  });
});
