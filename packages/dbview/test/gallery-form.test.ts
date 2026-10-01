/**
 * gallery-form.test.ts —— 画廊 / 表单视图的**引擎纯函数**（TASK-T99-02，飞书对标）。
 *
 * 为什么这些规则必须住在引擎而不是渲染层：画廊「显示哪几个字段 / 拿谁当封面」、
 * 表单「哪些字段 / 哪个必填 / 能不能提交」都是**可被单测钉死的语义**，
 * 渲染层只负责把结果画出来（与看板分组同一套路子）。
 */
import { describe, expect, it } from 'vitest';
import {
  GALLERY_FIELD_LIMIT,
  defaultView,
  formFieldPids,
  formRequiredPids,
  galleryFieldPids,
  missingRequiredPids,
  normalizeView,
  resolveCoverPid,
  type CollectionSchema,
  type DbView,
} from '../src';

const SCHEMA = {
  title_pid: 'p_title',
  properties: {
    p_title: { id: 'p_title', name: '书名', type: 'text' },
    p_cover: { id: 'p_cover', name: '封面', type: 'file' },
    p_score: { id: 'p_score', name: '评分', type: 'number' },
    p_date: { id: 'p_date', name: '读完于', type: 'date' },
    p_link: { id: 'p_link', name: '链接', type: 'url' },
    p_status: { id: 'p_status', name: '状态', type: 'select' },
  },
} as unknown as CollectionSchema;

function view(patch: Partial<DbView> = {}): DbView {
  return { ...defaultView('v1', '画廊'), type: 'gallery', ...patch };
}

describe('画廊：resolveCoverPid（封面字段）', () => {
  it('未指定 → 取可见字段里第一个 file/url（file 优先按声明顺序）', () => {
    expect(resolveCoverPid(SCHEMA, view())).toBe('p_cover');
  });

  it('指定的 coverPid 有效则用它（可把评分当色带）', () => {
    expect(resolveCoverPid(SCHEMA, view({ coverPid: 'p_score' }))).toBe('p_score');
  });

  it('指定了未知/已隐藏的 pid → 忽略，回退到默认封面', () => {
    expect(resolveCoverPid(SCHEMA, view({ coverPid: 'p_gone' }))).toBe('p_cover');
    expect(resolveCoverPid(SCHEMA, view({ coverPid: 'p_cover', hiddenPids: ['p_cover'] }))).toBe('p_link');
  });

  it('标题列永不当封面（标题已在卡片上单独占一行）', () => {
    expect(resolveCoverPid(SCHEMA, view({ coverPid: 'p_title' }))).toBe('p_cover');
  });

  it('没有任何 file/url 字段 → undefined（卡片不画色带）', () => {
    const noCover = {
      title_pid: 'p_title',
      properties: { p_title: { id: 'p_title', name: '书名', type: 'text' } },
    } as unknown as CollectionSchema;
    expect(resolveCoverPid(noCover, view())).toBeUndefined();
  });
});

describe('画廊：galleryFieldPids（卡片正文字段）', () => {
  it('缺省 = 可见的非标题字段，去掉封面，截到上限', () => {
    const pids = galleryFieldPids(SCHEMA, view());
    expect(pids).not.toContain('p_title');
    expect(pids).not.toContain('p_cover');
    expect(pids).toHaveLength(GALLERY_FIELD_LIMIT);
    expect(pids).toEqual(['p_score', 'p_date', 'p_link']);
  });

  it('cardPids 指定则按它的顺序（未知 pid 忽略、封面剔除）', () => {
    expect(galleryFieldPids(SCHEMA, view({ cardPids: ['p_status', 'p_gone', 'p_cover', 'p_title'] })))
      .toEqual(['p_status']);
  });

  it('隐藏列不进卡片', () => {
    const pids = galleryFieldPids(SCHEMA, view({ hiddenPids: ['p_score', 'p_date'] }));
    expect(pids).toEqual(['p_link', 'p_status']);
  });
});

describe('表单：formFieldPids（字段与顺序）', () => {
  it('标题列恒在首位，其余按 formPids 顺序', () => {
    expect(formFieldPids(SCHEMA, view({ formPids: ['p_status', 'p_score'] })))
      .toEqual(['p_title', 'p_status', 'p_score']);
  });

  it('缺省 = 标题列 + 全部可见非标题字段（保声明顺序）', () => {
    expect(formFieldPids(SCHEMA, view())).toEqual(['p_title', 'p_cover', 'p_score', 'p_date', 'p_link', 'p_status']);
  });

  it('formPids 里的未知 pid 与标题列重复项剔除；隐藏列不进表单', () => {
    expect(formFieldPids(SCHEMA, view({ formPids: ['p_gone', 'p_title', 'p_score'] })))
      .toEqual(['p_title', 'p_score']);
    expect(formFieldPids(SCHEMA, view({ formPids: ['p_score'], hiddenPids: ['p_score'] })))
      .toEqual(['p_title']);
  });
});

describe('表单：必填与提交校验', () => {
  it('formRequiredPids 只认表单里真实存在的字段', () => {
    expect(formRequiredPids(SCHEMA, view({ formPids: ['p_score'], formRequired: ['p_score', 'p_status', 'p_gone'] })))
      .toEqual(['p_score']);
  });

  it('缺失项按声明顺序返回；空串 / 空数组 / undefined 都算没填', () => {
    const v = view({ formRequired: ['p_title', 'p_score', 'p_status'] });
    expect(missingRequiredPids(SCHEMA, v, { p_title: '  ', p_score: 0, p_status: [] }))
      .toEqual(['p_title', 'p_status']);
    expect(missingRequiredPids(SCHEMA, v, { p_title: '书', p_score: 0, p_status: ['s1'] })).toEqual([]);
  });

  it('0 与 false 是「填了」（数字 0 / 复选框未勾都被当成有效值）', () => {
    const v = view({ formRequired: ['p_score'] });
    expect(missingRequiredPids(SCHEMA, v, { p_score: 0 })).toEqual([]);
    const box = { ...view({ formRequired: ['p_title'] }), type: 'form' as const };
    expect(missingRequiredPids(SCHEMA, box, { p_title: 'x' })).toEqual([]);
  });
});

describe('normalizeView：新配置透传（老数据零迁移）', () => {
  it('不传新键 → 结果里也不出现（老行为逐字不变）', () => {
    const out = normalizeView(defaultView('v1', '表格'));
    for (const key of ['coverPid', 'cardPids', 'formPids', 'formRequired', 'formTitle', 'formDesc']) {
      expect(Object.keys(out), `${key} 不该凭空出现`).not.toContain(key);
    }
  });

  it('传了 → 去重去空后透传；空数组视为未设置', () => {
    const out = normalizeView(view({
      coverPid: 'p_score',
      cardPids: ['p_score', 'p_score', '', 'p_date'],
      formPids: [],
      formRequired: ['p_title'],
      formTitle: '登记表',
      formDesc: '   ',
    }));
    expect(out.coverPid).toBe('p_score');
    expect(out.cardPids).toEqual(['p_score', 'p_date']);
    expect(out.formPids).toBeUndefined();
    expect(out.formRequired).toEqual(['p_title']);
    expect(out.formTitle).toBe('登记表');
    expect(out.formDesc, '全空白说明不落盘').toBeUndefined();
  });

  it('新的视图类型是合法枚举值', () => {
    expect(normalizeView(view({ type: 'gallery' })).type).toBe('gallery');
    expect(normalizeView(view({ type: 'form' })).type).toBe('form');
  });
});