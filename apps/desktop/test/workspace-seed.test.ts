/**
 * workspace-seed.test.ts —— 默认工作区名按「创建时 locale」种子（TASK-T27-01 §0.A）。
 *
 * 建库（首次自动建工作区）在 main 侧 `requireActiveWorkspace`，种子名经
 * `PagesServiceOptions.defaultWorkspaceName` 注入（main/index.ts 以 app.getLocale()
 * 派生）。本组断言：
 * 1) 注入 en-US 口径 → 种子 = Personal Workspace；
 * 2) 注入 zh-CN 口径 → 种子 = 个人工作区；
 * 3) 不注入 → 缺省回落 = 个人工作区（既有语义不变，pages.test.ts 同口径）；
 * 4) defaultWorkspaceNameForLocale 映射（zh* → 中文，其余/空 → 英文）；
 * 5) main 侧映射与 renderer i18n `workspace.defaultName` 两词典值一致（单一口径互锁）。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  createPagesService,
  defaultWorkspaceNameForLocale,
  type PagesService,
  type StatementExecutor,
} from '../src/main/pages';
import { enUS } from '../src/renderer/src/i18n/en-US';
import { zhCN } from '../src/renderer/src/i18n/zh-CN';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa2701';
const AT = 1_700_000_000_000;

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `ws-seed-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

describeDb('默认工作区种子名（T27-01 §0.A）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let clock: number;

  beforeEach(async () => {
    temp = makeTempDb('septcats-ws-seed');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    clock = AT;
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  function makeService(defaultWorkspaceName?: string): PagesService {
    return createPagesService({
      executor: coreExecutor(core),
      actor: ACTOR,
      now: () => {
        clock += 1;
        return clock;
      },
      userKey: 'device-user-1',
      ...(defaultWorkspaceName === undefined ? {} : { defaultWorkspaceName }),
    });
  }

  it('英文 locale 口径注入 → 首次建工作区种子 = Personal Workspace', async () => {
    const service = makeService(defaultWorkspaceNameForLocale('en-US'));
    const result = await service.listWorkspaces();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Personal Workspace');
    expect(result.activeId).toBe(result.items[0]?.id);

    // 幂等：再读不新建、不改名
    const again = await service.listWorkspaces();
    expect(again.items).toHaveLength(1);
    expect(again.items[0]?.name).toBe('Personal Workspace');
  });

  it('中文 locale 口径注入 → 首次建工作区种子 = 个人工作区', async () => {
    const service = makeService(defaultWorkspaceNameForLocale('zh-CN'));
    const result = await service.listWorkspaces();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('个人工作区');
  });

  it('未注入 → 缺省回落个人工作区（既有调用方语义不变）', async () => {
    const service = makeService();
    const result = await service.listWorkspaces();
    expect(result.items[0]?.name).toBe('个人工作区');
  });

  it('defaultWorkspaceNameForLocale：zh* → 中文，其余/空串 → 英文', () => {
    expect(defaultWorkspaceNameForLocale('zh-CN')).toBe('个人工作区');
    expect(defaultWorkspaceNameForLocale('zh-TW')).toBe('个人工作区');
    expect(defaultWorkspaceNameForLocale('en-US')).toBe('Personal Workspace');
    expect(defaultWorkspaceNameForLocale('fr-FR')).toBe('Personal Workspace');
    expect(defaultWorkspaceNameForLocale('')).toBe('Personal Workspace');
  });

  it('main 侧映射与 renderer i18n workspace.defaultName 两词典同口径', () => {
    expect(zhCN.workspace.defaultName).toBe(defaultWorkspaceNameForLocale('zh-CN'));
    expect(enUS.workspace.defaultName).toBe(defaultWorkspaceNameForLocale('en-US'));
    expect(zhCN.workspace.defaultName).toBe('个人工作区');
    expect(enUS.workspace.defaultName).toBe('Personal Workspace');
  });
});
