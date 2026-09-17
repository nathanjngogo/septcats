import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor as TiptapEditor, type JSONContent } from '@tiptap/core';
import {
  encodeOp,
  replay,
  type ActorId,
  type CrdtUpdateEntry,
  type CrdtUpdatePayload,
} from '@septcats/core';
import * as Y from 'yjs';
import { redoCommand, undoCommand } from 'y-prosemirror';
import { editorExtensions } from '../src/types';
import { YjsEditor, fragmentNameOf, type YjsAttachOptions, type YjsEditorOptions } from '../src/yjs';

/**
 * T19-03：YjsEditor 单元 + 集成 + 回归。
 *
 * 冷启动约定（集成用例遵循）：种子客户端先 attach（本地内容上行 Y），其余客户端
 * 必须先经构造注入 crdtUpdates（core 回放）再 attach —— Y 侧已有内容时 attach
 * 只做 Y→PM 投影，不做本地种子，避免双端各自种子导致内容重复。
 * T19-05-1 补充：无法预注入回放的「迟到种子端」（账本已有该页 crdt 历史但 attach
 * 时才知道）用 attach({ seed:false }) 显式关种子（desktop collabClient 接线）。
 *
 * 撤销/重做走 y-prosemirror 的 undoCommand/redoCommand（Yjs UndoManager 承载，
 * 只撤本地）；Tiptap 未注册 History 命令，commands.undo/redo 不存在。
 */

const PAGE = 'p00000001';
const DEBOUNCE_MS = 10;
const FLUSH_WAIT_MS = 60;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function par(text?: string): JSONContent {
  const paragraph: JSONContent = { type: 'paragraph' };
  if (text !== undefined && text.length > 0) {
    paragraph.content = [{ type: 'text', text }];
  }
  return { type: 'doc', content: [paragraph] };
}

interface Client {
  editor: TiptapEditor;
  yjs: YjsEditor;
}

const teardowns: Array<() => void> = [];

afterEach(() => {
  while (teardowns.length > 0) {
    teardowns.pop()?.();
  }
});

function makeClient(pageId: string, options: { crdtUpdates?: CrdtUpdateEntry[]; onOp?: (p: CrdtUpdatePayload) => void; content?: JSONContent; attachOptions?: YjsAttachOptions } = {}): Client {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new TiptapEditor({
    element: host,
    extensions: editorExtensions(),
    content: options.content ?? par(''),
  });
  // exactOptionalPropertyTypes：可选字段仅在显式传入时赋值
  const yjsOptions: YjsEditorOptions = { debounceMs: DEBOUNCE_MS };
  if (options.crdtUpdates !== undefined) {
    yjsOptions.crdtUpdates = options.crdtUpdates;
  }
  if (options.onOp !== undefined) {
    yjsOptions.onOp = options.onOp;
  }
  const yjs = new YjsEditor(pageId, yjsOptions);
  yjs.attach(editor, options.attachOptions);
  teardowns.push(() => {
    yjs.destroy();
    editor.destroy();
    host.remove();
  });
  return { editor, yjs };
}

function makeEntry(pageId: string, payload: CrdtUpdatePayload, opId = 'op-t19-03-01'): CrdtUpdateEntry {
  return {
    opId,
    target: { table: 'page', id: pageId },
    pageId,
    updateB64: payload.updateB64,
  };
}

function localYEdit(yjs: YjsEditor, text: string): void {
  yjs.doc.transact(() => {
    yjs.fragment.insert(0, [new Y.XmlText(text)]);
  });
}

// ---------------------------------------------------------------------------
// 单元：上行 op 生成（Y 增量 → payload）
// ---------------------------------------------------------------------------

describe('YjsEditor 单元：上行 op 生成', () => {
  it('本地 Y 增量 → sync() 产出 crdt_update payload；再 sync 无增量返回 null', () => {
    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS });
    teardowns.push(() => yjs.destroy());

    expect(yjs.sync()).toBeNull();
    localYEdit(yjs, 'hello');

    const payload = yjs.sync();
    expect(payload).not.toBeNull();
    expect(payload?.pageId).toBe(PAGE);
    expect(typeof payload?.updateB64).toBe('string');
    expect((payload?.updateB64.length ?? 0)).toBeGreaterThan(0);
    expect(typeof payload?.svFromB64).toBe('string');

    // payload 落到全新 Y.Doc 后内容一致（base64 语义正确）
    const mirror = new Y.Doc();
    teardowns.push(() => mirror.destroy());
    Y.applyUpdate(mirror, Buffer.from(payload!.updateB64, 'base64'));
    expect(mirror.getXmlFragment(fragmentNameOf(PAGE)).toString()).toContain('hello');

    expect(yjs.sync()).toBeNull();
    expect(yjs.pendingOpCount).toBe(0);
  });

  it('防抖窗口内连续本地增量合并为单 op', async () => {
    const onOp = vi.fn();
    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS, onOp });
    teardowns.push(() => yjs.destroy());

    localYEdit(yjs, 'a');
    localYEdit(yjs, 'b');
    localYEdit(yjs, 'c');
    expect(onOp).not.toHaveBeenCalled(); // 窗口内不产出

    await sleep(FLUSH_WAIT_MS);
    expect(onOp).toHaveBeenCalledTimes(1); // 防抖合并
    const payload = onOp.mock.calls[0]?.[0] as CrdtUpdatePayload;
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, Buffer.from(payload.updateB64, 'base64'));
    expect(mirror.getXmlFragment(fragmentNameOf(PAGE)).toString()).toContain('a');
    expect(mirror.getXmlFragment(fragmentNameOf(PAGE)).toString()).toContain('b');
    expect(mirror.getXmlFragment(fragmentNameOf(PAGE)).toString()).toContain('c');
    mirror.destroy();
  });

  it('payload 可直接通过 core encodeOp/decodeOp/replay 链路收集（T19-02 契约）', () => {
    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS });
    teardowns.push(() => yjs.destroy());
    localYEdit(yjs, 'ledger');
    const payload = yjs.sync();
    expect(payload).not.toBeNull();

    const op = encodeOp({
      op_id: 'op-t19-03-ledger',
      lamport: { c: 1, d: 'editor0001' },
      at: 1,
      actor: 'editor0001' as ActorId,
      target: { table: 'page', id: PAGE },
      kind: 'crdt_update',
      payload: payload!,
      merge_policy: 'crdt',
    });
    const report = replay([JSON.parse(op) as Parameters<typeof replay>[0][number]]).report;
    expect(report.crdtUpdates).toHaveLength(1);
    expect(report.crdtUpdates[0]?.updateB64).toBe(payload!.updateB64);
    expect(report.crdtUpdates[0]?.pageId).toBe(PAGE);
  });
});

// ---------------------------------------------------------------------------
// 单元：下行（applyCrdtUpdate）与防御
// ---------------------------------------------------------------------------

describe('YjsEditor 单元：下行与防御', () => {
  it('远端增量不回灌生成 op（防回环）', () => {
    const seed = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS });
    teardowns.push(() => seed.destroy());
    localYEdit(seed, 'remote-text');
    const payload = seed.sync();
    expect(payload).not.toBeNull();

    const onOp = vi.fn();
    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS, onOp });
    teardowns.push(() => yjs.destroy());
    expect(yjs.applyCrdtUpdate(makeEntry(PAGE, payload!))).toBe(true);
    expect(yjs.fragment.toString()).toContain('remote-text');
    expect(yjs.sync()).toBeNull(); // 远端 apply 不生成 op
    expect(yjs.pendingOpCount).toBe(0);
  });

  it('pageId 分区：跨页增量被忽略', () => {
    const seed = new YjsEditor('other-page', { debounceMs: DEBOUNCE_MS });
    teardowns.push(() => seed.destroy());
    localYEdit(seed, 'other');
    const payload = seed.sync();
    expect(payload).not.toBeNull();

    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS });
    teardowns.push(() => yjs.destroy());
    expect(yjs.applyCrdtUpdate(makeEntry('other-page', payload!))).toBe(false);
    expect(yjs.fragment.length).toBe(0); // 本页 Y 不受影响
  });

  it('坏 base64 / 非法增量只记录不抛（编辑器功能不受影响）', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS });
    teardowns.push(() => yjs.destroy());
    expect(yjs.applyCrdtUpdate(makeEntry(PAGE, { pageId: PAGE, updateB64: '!!!not-base64!!!' }))).toBe(false);
    consoleSpy.mockRestore();
    // 编辑器侧（Y.Doc）仍可正常工作
    localYEdit(yjs, 'still-alive');
    expect(yjs.sync()).not.toBeNull();
  });

  it('destroy 后：sync 为 null、apply 拒绝、幂等', () => {
    const yjs = new YjsEditor(PAGE, { debounceMs: DEBOUNCE_MS });
    yjs.destroy();
    expect(yjs.sync()).toBeNull();
    expect(yjs.applyCrdtUpdate(makeEntry(PAGE, { pageId: PAGE, updateB64: Buffer.from([1, 2]).toString('base64') }))).toBe(false);
    expect(() => yjs.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 集成：双客户端同 page 编辑（真 Tiptap 编辑器 + ySyncPlugin 绑定）
// ---------------------------------------------------------------------------

describe('YjsEditor 集成：双客户端同 page 协作', () => {
  it('本地编辑 → op → 对端 applyCrdtUpdate → 对端编辑器内容更新（双向）', async () => {
    let applyToB: ((p: CrdtUpdatePayload) => void) | null = null;
    let applyToA: ((p: CrdtUpdatePayload) => void) | null = null;
    // 冷启动（见文件头约定）：A 是种子客户端（attach 时初始内容上行 Y，显式 sync 收集），
    // B 经构造注入 A 的种子回放后 attach，避免双端各自种子导致内容重复。
    const a = makeClient(PAGE, { content: par('base'), onOp: (p) => applyToB?.(p) });
    const seedEntry = makeEntry(PAGE, a.yjs.sync()!, 'op-seed-00');
    const b = makeClient(PAGE, { crdtUpdates: [seedEntry], onOp: (p) => applyToA?.(p) });
    applyToB = (p) => b.yjs.applyCrdtUpdate(p);
    applyToA = (p) => a.yjs.applyCrdtUpdate(p);
    teardowns.push(() => {
      applyToB = null;
      applyToA = null;
    });
    expect(b.editor.state.doc.textContent).toBe('base'); // 注入回放投影

    // A 输入 → 防抖 flush → op → B
    a.editor.commands.insertContentAt(1, 'A-');
    await sleep(FLUSH_WAIT_MS);
    expect(b.editor.state.doc.textContent).toContain('A-base');

    // B 输入 → op → A
    b.editor.commands.insertContentAt(b.editor.state.doc.content.size - 1, '-B');
    await sleep(FLUSH_WAIT_MS);
    expect(a.editor.state.doc.textContent).toContain('A-base-B');
    expect(a.editor.state.doc.textContent).toBe(b.editor.state.doc.textContent);
  });

  it('并发编辑：双端各改一处，互换来 op 后 CRDT 收敛、内容一致（无冲突分裂）', async () => {
    // 冷启动：A 种子 → op → 双端均经构造注入回放后 attach（避免双端各自种子）
    const seedClient = makeClient(PAGE, { content: par('x') });
    const seedPayload = seedClient.yjs.sync();
    expect(seedPayload).not.toBeNull();
    const seedEntry = makeEntry(PAGE, seedPayload!, 'op-seed-01');

    const opsAB: CrdtUpdatePayload[] = [];
    const opsBA: CrdtUpdatePayload[] = [];
    const a = makeClient(PAGE, {
      crdtUpdates: [seedEntry],
      onOp: (p) => opsAB.push(p),
    });
    const b = makeClient(PAGE, {
      crdtUpdates: [seedEntry],
      onOp: (p) => opsBA.push(p),
    });
    // B 的 PM 投影来自 Y（注入回放），内容与 A 一致
    expect(b.editor.state.doc.textContent).toBe('x');

    // 并发：A 在开头插 L，B 在结尾插 R（互不知道对方）
    a.editor.commands.insertContentAt(1, 'L');
    b.editor.commands.insertContentAt(b.editor.state.doc.content.size - 1, 'R');
    await sleep(FLUSH_WAIT_MS);

    // 互换来 op（模拟事件账同步）
    for (const p of opsAB) {
      b.yjs.applyCrdtUpdate(p);
    }
    for (const p of opsBA) {
      a.yjs.applyCrdtUpdate(p);
    }
    await sleep(FLUSH_WAIT_MS);

    const textA = a.editor.state.doc.textContent;
    const textB = b.editor.state.doc.textContent;
    expect(textA).toBe(textB); // 双端收敛一致
    expect(textA).toContain('L');
    expect(textA).toContain('R');
    expect(textA.replace(/[^x]/g, '')).toBe('x'); // 原 'x' 恰好一份（无重复种子）
  });

  it('构造注入 ReplayReport.crdtUpdates 冷启动：attach 即 Y→PM 投影', async () => {
    const seedClient = makeClient(PAGE, { content: par('seeded-content') });
    const payload = seedClient.yjs.sync(); // attach 种子（同步入 pending，显式收集）
    expect(payload).not.toBeNull();
    seedClient.yjs.destroy();
    seedClient.editor.destroy();

    const b = makeClient(PAGE, { crdtUpdates: [makeEntry(PAGE, payload!, 'op-seed-02')] });
    expect(b.editor.state.doc.textContent).toBe('seeded-content');
    // 注入回放是远端语义，不应产生上行 op
    await sleep(FLUSH_WAIT_MS);
    expect(b.yjs.sync()).toBeNull();
  });

  it('attach({ seed:false })：迟到种子端不上行初始种子（T19-05-1）；下行增量照常应用投影', async () => {
    // 对端种子（正常 PM 路径产出，含合法段落结构，可直接下行投影）
    const seedClient = makeClient(PAGE, { content: par('远端文本') });
    const remotePayload = seedClient.yjs.sync();
    expect(remotePayload).not.toBeNull();
    seedClient.yjs.destroy();
    seedClient.editor.destroy();

    // 迟到种子端：PM 带初始内容 + Y 侧为空 → 默认 attach 会种子（重复文本的根源），
    // seed:false 关掉该分支
    const ups: CrdtUpdatePayload[] = [];
    const late = makeClient(PAGE, {
      content: par('本地初始内容'),
      onOp: (p) => ups.push(p),
      attachOptions: { seed: false },
    });

    // Y 仍为空 → ySyncPlugin 首渲染把 PM 对齐为空文档（初始内容不进 Y、不产生 op）
    expect(late.editor.state.doc.textContent).not.toContain('本地初始内容');
    expect(late.yjs.fragment.length).toBe(0);
    expect(late.yjs.sync()).toBeNull(); // 显式收集也无种子 payload（不重复上行种子的钉）
    await sleep(FLUSH_WAIT_MS);
    expect(ups).toHaveLength(0);

    // seed 只关初始种子：本地编辑（PM 事务路径）照常走上行通道
    late.editor.commands.setContent('本地增量');
    expect(late.yjs.sync()).not.toBeNull();

    // 下行增量照常：对端内容经 Y→PM 投影可见（空 Y.Doc attach 后由下行补齐）
    late.yjs.applyCrdtUpdate(makeEntry(PAGE, remotePayload!, 'op-late-01'));
    expect(late.editor.state.doc.textContent).toContain('远端文本');
  });

  it('B 端本地编辑不被 A 端远端增量回滚（优先本地）', async () => {
    const seedClient = makeClient(PAGE, { content: par('x') });
    const seedPayload = seedClient.yjs.sync();
    seedClient.yjs.destroy();
    seedClient.editor.destroy();

    // 冷启动（见文件头约定）：a/b 都经构造注入同一种子回放后 attach，
    // 避免双端各自种子导致内容重复；a 的 op 回流 B（applyToB 后置赋值）。
    let applyToB: ((p: CrdtUpdatePayload) => void) | null = null;
    const a = makeClient(PAGE, {
      crdtUpdates: [makeEntry(PAGE, seedPayload!, 'op-seed-03')],
      onOp: (p) => applyToB?.(p),
    });
    const b = makeClient(PAGE, {
      crdtUpdates: [makeEntry(PAGE, seedPayload!, 'op-seed-03')],
      onOp: (p) => a.yjs.applyCrdtUpdate(p),
    });
    applyToB = (p) => b.yjs.applyCrdtUpdate(p);
    teardowns.push(() => {
      applyToB = null;
    });

    // B 本地输入（未 flush 前不与 A 交换任何 op）
    b.editor.commands.insertContentAt(1, 'B1');
    const aPayload = a.yjs.sync(); // A 无编辑 → 无新增上行 op
    expect(aPayload).toBeNull();
    // A 编辑并即时推送
    a.editor.commands.insertContentAt(1, 'A1');
    await sleep(FLUSH_WAIT_MS);
    // B 本地内容仍在（CRDT 合并而非覆盖）
    expect(b.editor.state.doc.textContent).toContain('B1');
    expect(b.editor.state.doc.textContent).toContain('A1');
    expect(a.editor.state.doc.textContent).toBe(b.editor.state.doc.textContent);
  });
});

// ---------------------------------------------------------------------------
// 回归：编辑器基础功能（撤销/重做）在 Yjs 绑定下不受影响
// ---------------------------------------------------------------------------

describe('YjsEditor 回归：编辑器基础功能', () => {
  it('撤销/重做正常，撤销/重做的变更也走上行 op 通道', async () => {
    const onOp = vi.fn();
    const c = makeClient(PAGE, { content: par('hello'), onOp });
    await sleep(FLUSH_WAIT_MS); // attach 种子上行
    const opsAfterAttach = onOp.mock.calls.length;

    // 追加到文本末尾：PM 位置 = doc.content.size - 1（'hello' 文本末尾是位置 6）
    c.editor.commands.insertContentAt(c.editor.state.doc.content.size - 1, ' world');
    expect(c.editor.state.doc.textContent).toBe('hello world');

    // 撤销/重做由 Yjs UndoManager 承载（yUndoPlugin + undoCommand/redoCommand）
    expect(undoCommand(c.editor.state, c.editor.view.dispatch)).toBe(true);
    expect(c.editor.state.doc.textContent).toBe('hello');

    expect(redoCommand(c.editor.state, c.editor.view.dispatch)).toBe(true);
    expect(c.editor.state.doc.textContent).toBe('hello world');

    await sleep(FLUSH_WAIT_MS);
    expect(onOp.mock.calls.length).toBeGreaterThan(opsAfterAttach); // 本地事务都产出了 op
  });

  it('光标/选区事务（docChanged=false）不产生上行 op', async () => {
    const onOp = vi.fn();
    const c = makeClient(PAGE, { content: par('static'), onOp });
    await sleep(FLUSH_WAIT_MS);
    const baseline = onOp.mock.calls.length;

    c.editor.commands.focus('start', { scrollIntoView: false }); // 仅选区变化（jsdom 无布局，禁滚动）
    c.editor.commands.setTextSelection(3);
    await sleep(FLUSH_WAIT_MS);
    expect(onOp.mock.calls.length).toBe(baseline);
  });
});
