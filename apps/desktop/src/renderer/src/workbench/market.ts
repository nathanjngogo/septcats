/**
 * market.ts —— 工作台模板市场（TASK-T72-01）的纯模型与边界函数。
 *
 * 纯函数（可独立单测，不依赖 DOM）：
 * - `parseWorkbenchTemplateText`：导入 / 内置通用契约校验（坏 JSON / 缺字段 → {ok:false}）；
 *   order/hidden 与 `ALL_CARD_IDS` 取交集（未知丢弃 + 缺省补尾，复用 sanitizeCardsPersist 口径）。
 * - `normalizeLayout` / `applyTemplateToWorkbench`：把模板布局写回工作台（唯一真相源 =
 *   workbench/state.ts 的 `setCardOrder` / `setCardHidden`，卡片 Tab 开关同源共用）。
 * - `backupCurrentLayout` / `restoreLayoutBackup`：应用前的「一键备份」与「还原备份」。
 * - `captureCurrentLayout`：另存为模板时抓取当前工作台布局。
 * - `extractPlainText`：种子页正文抽取（blocks.commit 落盘前）。
 *
 * 边界函数（需 window.septcats，仅在运行期调用，不在单测里触发）：
 * - `applyTemplateSeeds`：建页 + blocks.commit 写纯文本正文（形状不合降级只建页）。
 *
 * 红线：零外联；模板 JSON 不内嵌 URL 请求；不新增 openExternal 通道。
 */
import { sortBetween, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import { blockContentTextLines } from '@septcats/editor';
import { EDITOR_ACTOR } from '@septcats/editor/react';
import type { SeptcatsApi } from '../../../types/window';
import {
  ALL_CARD_IDS,
  readCardsPersist,
  sanitizeCardsPersist,
  DEFAULT_CARD_ORDER,
  WORKBENCH_CARDS_PERSIST_VERSION,
  workbenchActions,
  workbenchStore,
  type WorkbenchCardId,
  type WorkbenchCardsPersist,
} from './state';

/** 种子页（纯文本正文）。 */
export interface SeedPage {
  title: string;
  body: string;
}

/** 工作台模板布局（与 workbench/state.ts 的 WorkbenchCardsPersist 同口径）。 */
export interface WorkbenchTemplateLayout {
  v: 2;
  order: string[];
  hidden: string[];
}

/** 工作台模板（内置 / 我的 共用形状）。 */
export interface WorkbenchTemplate {
  id: string;
  title: string;
  desc: string;
  layout: WorkbenchTemplateLayout;
  seedPages: SeedPage[];
}

export interface ValidationResult {
  ok: boolean;
  template?: WorkbenchTemplate;
  error?: string;
}

function typedApi(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload did not inject window.septcats');
  }
  return value;
}

/**
 * 校验并归一化一份工作台模板文本（导入 / 内置通用契约）。
 * - 坏 JSON → {ok:false, error}；
 * - 缺 title / layout 非 {v:2,order[],hidden[]} → {ok:false}；
 * - order/hidden 与 ALL_CARD_IDS 取交集（未知丢弃 + 缺省补尾，复用 sanitizeCardsPersist）。
 */
export function parseWorkbenchTemplateText(content: string, fallbackId: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: 'workbench.market.importJsonError' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'workbench.market.importNotObject' };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.title !== 'string' || record.title.length === 0) {
    return { ok: false, error: 'workbench.market.importTitleMissing' };
  }
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : fallbackId;
  const desc = typeof record.desc === 'string' ? record.desc : '';
  const layoutRaw = record.layout;
  if (typeof layoutRaw !== 'object' || layoutRaw === null || Array.isArray(layoutRaw)) {
    return { ok: false, error: 'workbench.market.importLayoutMissing' };
  }
  const lr = layoutRaw as Record<string, unknown>;
  if (lr.v !== 2 || !Array.isArray(lr.order) || !Array.isArray(lr.hidden)) {
    return { ok: false, error: 'workbench.market.importLayoutShape' };
  }
  const normalized = sanitizeCardsPersist({ v: 2, order: lr.order as unknown[], hidden: lr.hidden as unknown[] });
  if (normalized === null) {
    return { ok: false, error: 'workbench.market.importLayoutNormalize' };
  }
  const seedPagesRaw = Array.isArray(record.seedPages) ? record.seedPages : [];
  const seedPages: SeedPage[] = seedPagesRaw.map((entry) => {
    const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    return {
      title: typeof row.title === 'string' ? row.title : '',
      body: typeof row.body === 'string' ? row.body : '',
    };
  });
  return {
    ok: true,
    template: {
      id,
      title: record.title,
      desc,
      layout: { v: 2, order: normalized.order, hidden: normalized.hidden },
      seedPages,
    },
  };
}

/** 归一化布局（与 ALL_CARD_IDS 取交集；失败回默认序 + 全可见）。 */
export function normalizeLayout(layout: WorkbenchTemplateLayout): {
  order: WorkbenchCardId[];
  hidden: WorkbenchCardId[];
} {
  const persist = sanitizeCardsPersist({ v: 2, order: layout.order, hidden: layout.hidden });
  if (persist === null) {
    return { order: [...DEFAULT_CARD_ORDER], hidden: [] };
  }
  return { order: persist.order, hidden: persist.hidden };
}

/**
 * 把模板布局应用到当前工作台——唯一真相源 = workbenchActions（与卡片 Tab 开关同源）。
 * 先整序写入，再按 hidden 逐个隐藏。返回应用后的 {order, hidden}（供备份对照）。
 */
export function applyTemplateToWorkbench(template: WorkbenchTemplate): { order: WorkbenchCardId[]; hidden: WorkbenchCardId[] } {
  const { order, hidden } = normalizeLayout(template.layout);
  workbenchActions.setCardOrder(order);
  for (const id of hidden) {
    workbenchActions.setCardHidden(id, true);
  }
  return { order, hidden };
}

/** 抓取当前工作台布局（另存为模板用）。 */
export function captureCurrentLayout(): WorkbenchTemplateLayout {
  const { cardOrder, hiddenCards } = workbenchStore.getState();
  return { v: 2, order: [...cardOrder], hidden: [...hiddenCards] };
}

/** 一键备份当前布局到 septcats.wbcard.layoutBackup（返回原始 JSON 或 null）。
 * T72 PM 修：LS 无记录（全新安装未改卡）时兜底读 store 当前布局——否则备份永远 null、
 * 「还原备份」不可用（真机 M4-a 实锤）。 */
export function backupCurrentLayout(): string | null {
  const persist = readCardsPersist();
  if (persist !== null) {
    return JSON.stringify(persist);
  }
  // LS 无记录兜底 store 当前布局（显式注解打断 tsc 联合推导，修 T72 TS2589）
  const snap = workbenchStore.getState();
  const base: WorkbenchCardsPersist = { v: WORKBENCH_CARDS_PERSIST_VERSION, order: [...snap.cardOrder], hidden: [...snap.hiddenCards] };
  return JSON.stringify(base);
}

/** 布局备份落地键（§范围2：应用前把当前布局一键备份到这里）。 */
export const LAYOUT_BACKUP_KEY = 'septcats.wbcard.layoutBackup';

/** 写布局备份到 localStorage（null = 清除）。 */
export function writeLayoutBackup(json: string | null): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage === undefined) {
      return;
    }
    if (json === null) {
      storage.removeItem(LAYOUT_BACKUP_KEY);
    } else {
      storage.setItem(LAYOUT_BACKUP_KEY, json);
    }
  } catch {
    // 写失败（隐私模式）：仅会话内生效，不阻断应用
  }
}

/** 读布局备份（无 → null）。 */
export function readLayoutBackup(): string | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage === undefined) {
      return null;
    }
    return storage.getItem(LAYOUT_BACKUP_KEY);
  } catch {
    return null;
  }
}

/** 还原布局备份（用 setCardHidden 同源写回；坏 JSON → false）。 */
export function restoreLayoutBackup(json: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  const persist = sanitizeCardsPersist(parsed);
  if (persist === null) {
    return false;
  }
  workbenchActions.setCardOrder(persist.order);
  const currentHidden = new Set<WorkbenchCardId>(workbenchStore.getState().hiddenCards);
  const targetHidden = new Set<WorkbenchCardId>(persist.hidden);
  for (const id of ALL_CARD_IDS) {
    const target = targetHidden.has(id);
    const current = currentHidden.has(id);
    if (target !== current) {
      workbenchActions.setCardHidden(id, target);
    }
  }
  return true;
}

/**
 * 工作台卡片开关同源入口（T72 红线：卡片 Tab 开关 = 自定义模式 = 同一 setCardHidden）。
 * 市场页 / 自定义模式 / 本函数都只能经由它改隐藏态，绝不另建状态。
 */
export function toggleWorkbenchCard(id: WorkbenchCardId, hidden: boolean): void {
  workbenchActions.setCardHidden(id, hidden);
}

/**
 * 从块 content 抽取纯文本（种子页正文落盘前）。
 *
 * T82-02（H-07）：**不再自带 PM-doc-only 的复制实现**（原先只往下认两层
 * `content[].content[].text`，table 的 `{rows,header}` 与 toggle 的
 * `{title,body}` 结构化正文整片丢失）。改由 `@septcats/editor` 的
 * `blockContentTextLines` 单一实现分流（与「最近页摘抄」`firstTextOfBlock`、
 * main 的双链上下文片段 `textOfBlockContent` 同源），行以 `\n` 连接。
 */
export function extractPlainText(blocks: ReadonlyArray<{ content?: unknown }>): string {
  const lines: string[] = [];
  for (const block of blocks) {
    for (const line of blockContentTextLines(block.content)) {
      if (line.length > 0) {
        lines.push(line);
      }
    }
  }
  return lines.join('\n');
}

/**
 * 应用模板的种子页：建页（根层）+ 写纯文本正文（blocks.commit）。
 * 形状不合 / 写正文失败 → 降级只建页（不阻断模板应用；调用方用 toast 记 DEVIATION）。
 */
export async function applyTemplateSeeds(seedPages: readonly SeedPage[]): Promise<void> {
  const api = typedApi();
  for (const seed of seedPages) {
    let pageId: string;
    try {
      const created = await api.pages.create({ parentId: null });
      pageId = created.id;
      if (seed.title.length > 0) {
        await api.pages.rename({ id: pageId, title: seed.title });
      }
    } catch {
      continue; // 建页失败：跳过该种子（降级，不阻断）
    }
    if (seed.body.length === 0) {
      continue;
    }
    try {
      const blockId = ulid(Date.now());
      const op: Op = {
        op_id: ulid(Date.now()),
        lamport: { c: 1, d: EDITOR_ACTOR as ActorId },
        at: Date.now(),
        actor: EDITOR_ACTOR as ActorId,
        target: { table: 'block', id: blockId },
        kind: 'upsert',
        payload: {
          page_id: pageId,
          type: 'paragraph',
          props: {},
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: seed.body }] }],
          },
          parent_id: null,
          sort_key: sortBetween(null, null),
          alive: 1,
          last_edited: Date.now(),
        },
      };
      await api.blocks.commit({ ops: [op] });
    } catch {
      // 写正文失败：页已建，正文留空（降级，记 DEVIATION 由调用方 toast）
    }
  }
}
