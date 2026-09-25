// @vitest-environment jsdom
/**
 * settings-react.test.tsx —— 设置页 UI（TASK-T10-01 §5）。
 *
 * 覆盖：三区块渲染（外观/数据与隐私/诊断）、主题切换派发主题事件（setGlobalThemeMode）、
 * 诊断包导出预览流程。window.septcats 用 vi.stubGlobal 假桥替换；不 import electron。
 * T17-01：同步密钥三件套（导出勾选门控 / 导入校验反馈 / 轮换确认）。
 * T18-02：AI 助手区块（渲染/开关/添加预设/模型下拉/测试连接/密钥/云端禁用门控）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';
import { SettingsPage } from '../src/renderer/src/pages/SettingsPage';
import { pagesStore } from '../src/renderer/src/state/pages';

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    trayClose: 'ask',
    data: { note: '~/.septcats' },
    sync: { enabled: true, encrypt: false, gc: false },
    ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
  };
}

function installBridge(overrides: Partial<SeptcatsApi> = {}): {
  patch: ReturnType<typeof vi.fn>;
  exportDiag: ReturnType<typeof vi.fn>;
  exportRecovery: ReturnType<typeof vi.fn>;
  importRecovery: ReturnType<typeof vi.fn>;
  rotateKey: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  setKey: ReturnType<typeof vi.fn>;
  dbgcPreview: ReturnType<typeof vi.fn>;
  dbgcRun: ReturnType<typeof vi.fn>;
} {
  const patch = vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p }));
  const exportDiag = vi.fn(async () => ({
    path: '/diagnostics/diag-1.json',
    preview: '{"meta":{"generatedAt":"2026-09-13T00:00:00.000Z"}}',
  }));
  // T17-01 D5：同步密钥三件套 mock（既有用例不触达，仅防桥缺失 + 供新用例断言）
  const exportRecovery = vi.fn(async () => ({
    code: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ',
  }));
  const importRecovery = vi.fn(async () => ({ ok: true as const, keyId: 'a1b2c3d4' }));
  const rotateKey = vi.fn(async () => ({ startedAt: 1 }));
  // T18-02：AI 子桥（enabled:false 为隐私默认；需要启用态的用例经 overrides 覆盖）
  const aiState = vi.fn(async () => ({
    enabled: false,
    cloudConsent: false,
    activeProviderId: null,
    // TASK-T46-01：AI 请求参数（夹具仅补新增字段，既有断言不变）
    chatTimeoutSec: 120,
    maxOutputTokens: null,
    providers: [
      {
        id: 'plocal1',
        kind: 'lmstudio' as const,
        name: 'LM Studio',
        baseUrl: 'http://127.0.0.1:1234',
        isLocal: true,
        hasKey: false,
        model: null,
      },
    ],
  }));
  const listModels = vi.fn(async () => ({ models: ['qwen-7b', 'deepseek-v3'], cached: false, fetchedAt: 1 }));
  const setKey = vi.fn(async () => ({ ok: true as const }));
  // T81-01：DB 面墓碑 GC 桥（preview 只读条数 / run 确认执行）
  const dbgcPreview = vi.fn(async () => ({
    candidates: 39,
    deletable: 35,
    held: 4,
    heldByReason: { unreachable: 0, retention: 1, locked: 1, 'has-children': 2 },
    estimatedBlocks: 69,
    estimatedBytes: 4096,
    retentionDays: 30,
  }));
  const dbgcRun = vi.fn(async () => ({
    deletedPages: 35,
    deletedBlocks: 69,
    bytesFreed: 4096,
    batches: 1,
    held: 4,
    heldByReason: { unreachable: 0, retention: 1, locked: 1, 'has-children': 2 },
  }));
  const bridge = {
    ping: vi.fn(),
    appMeta: vi.fn(async () => ({
      name: 'Septcats',
      version: '0.0.0',
      schemaVersion: 1,
      layoutRoot: '.septcats',
    })),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      patch,
    },
    diag: {
      export: exportDiag,
      confirm: vi.fn(async () => ({ path: '/diagnostics/diag-1.json' })),
    },
    // M10-B：更新桥（本文件用例不触达，仅防 SettingsPage 订阅 onState 时桥缺失）
    update: {
      check: vi.fn(async () => ({ status: 'idle' }) as const),
      download: vi.fn(async () => ({ status: 'idle' }) as const),
      install: vi.fn(async () => ({ ok: true }) as const),
      rollbackHint: vi.fn(async () => ({ state: { status: 'idle' } as const, hint: '' })),
      onState: vi.fn(() => () => {}),
    },
    // T17-01：同步桥（status 等四件为完备性占位，SettingsPage 不触达）
    sync: {
      status: vi.fn(async () => ({
        state: 'idle' as const,
        enabled: false,
        lastSyncAt: null,
        devices: [],
        pendingOps: 0,
        pendingSegs: 0,
        conflicts: 0,
        errors: [],
      })),
      setEnabled: vi.fn(),
      now: vi.fn(),
      onState: vi.fn(() => () => {}),
      exportRecovery,
      importRecovery,
      rotateKey,
    },
    // T18-02：AI 桥（chat/clearKey 为完备性占位，用例断言走 setKey/clearKey 引用）
    ai: {
      state: aiState,
      listModels,
      chat: vi.fn(async () => ({ text: 'ok', model: 'qwen-7b' })),
      setKey,
      clearKey: vi.fn(async () => ({ ok: true as const })),
    },
    // T81-01：DB 面墓碑 GC 桥
    dbgc: { preview: dbgcPreview, run: dbgcRun },
    ...overrides,
  };
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  return { patch, exportDiag, exportRecovery, importRecovery, rotateKey, listModels, setKey, dbgcPreview, dbgcRun };
}

beforeEach(() => {
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsPage（三区块 + 无障碍）', () => {
  it('渲染三区块：外观 / 数据与隐私 / 诊断，且主题为 radiogroup', async () => {
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    expect(screen.getByText('外观')).toBeDefined();
    expect(screen.getByText('数据与隐私')).toBeDefined();
    expect(screen.getByText('诊断')).toBeDefined();

    // T39-01：设置页新增「布局」区块后存在两个「主题」radiogroup（外观/布局同名词），
    // DOM 序外观在前 → 取第一组；断言语义不变（主题组的 3 个选项）
    const groups = await screen.findAllByRole('radiogroup', { name: '主题' });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const group = groups[0];
    if (group === undefined) {
      throw new Error('appearance theme radiogroup not found');
    }
    expect(group).toBeDefined();
    // 作用域收窄到主题组内：AI 助手区块（T18-02）加载后会追加自己的 radio，
    // 全局计数会随异步时序漂移（flaky）——这里只断言主题组的 3 个选项。
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
  });

  it('主题切换派发 septcats:theme-mode（setGlobalThemeMode）并 patch', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { patch } = installBridge();

    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    // T39-01：布局区块也有「主题」radiogroup → 收窄到外观主题组（DOM 序第一）内点「深色」
    const themeGroup = (await screen.findAllByRole('radiogroup', { name: '主题' }))[0];
    if (themeGroup === undefined) {
      throw new Error('appearance theme radiogroup not found');
    }
    fireEvent.click(within(themeGroup).getByText('深色'));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'septcats:theme-mode' }),
      );
    });
    const call = dispatchSpy.mock.calls.find(([event]) => {
      return (event as CustomEvent).type === 'septcats:theme-mode';
    });
    expect((call?.[0] as CustomEvent).detail).toEqual({ mode: 'dark' });

    await waitFor(() => expect(patch).toHaveBeenCalledWith({ theme: 'dark' }));
    dispatchSpy.mockRestore();
  });

  it('T81-01：同步区「自动清理」开关 patch sync.gc；「清理已删除内容」预览 → 确认执行 → 结果行', async () => {
    const { patch, dbgcPreview, dbgcRun } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    // 开关：patch({sync:{gc:true}})
    fireEvent.click(screen.getByLabelText('自动清理'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ sync: { gc: true } }));

    // dry-run 预览：只读条数（页面/块/预计释放 + 保留天数说明）
    fireEvent.click(screen.getByTestId('settings-dbgc-preview'));
    const meta = await screen.findByTestId('settings-dbgc-meta');
    expect(dbgcPreview).toHaveBeenCalledTimes(1);
    expect(meta.textContent).toContain('页面 35 个');
    expect(screen.getByTestId('settings-dbgc-retention').textContent).toContain('30');

    // 确认执行：run 被调 + 结果行
    fireEvent.click(screen.getByTestId('settings-dbgc-confirm'));
    const done = await screen.findByTestId('settings-dbgc-done');
    expect(dbgcRun).toHaveBeenCalledTimes(1);
    expect(done.textContent).toContain('35');
  });

  it('诊断包导出：点导出 → 显示脱敏预览 + 确认/取消', async () => {    const { exportDiag } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导出诊断包' }));
    await waitFor(() => expect(exportDiag).toHaveBeenCalled());

    expect(await screen.findByText('诊断包预览（已脱敏）')).toBeDefined();
    expect(screen.getByRole('button', { name: '确认保存' })).toBeDefined();
    expect(screen.getByRole('button', { name: '取消' })).toBeDefined();
    // 预览文本在只读 <pre> 里
    expect(screen.getByLabelText('诊断包预览（已脱敏）').textContent).toContain('generatedAt');
  });
});

describe('设置页 · 同步密钥三件套（T17-01）', () => {
  it('导出：勾选门控——完成按钮初始 disabled，勾选后可点并关窗', async () => {
    const { exportRecovery } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导出恢复码' }));
    await waitFor(() => expect(exportRecovery).toHaveBeenCalled());

    expect(await screen.findByText('恢复码（仅显示这一次）')).toBeDefined();
    expect(screen.getByTestId('recovery-code').textContent).toContain('AAAAA-BBBBB');

    const done = screen.getByRole('button', { name: '完成' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('我已安全保存恢复码'));
    await waitFor(() => expect(done.disabled).toBe(false));

    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByText('恢复码（仅显示这一次）')).toBeNull());
  });

  it('导出-失败态：role=alert 含凭据存储不可用', async () => {
    const { exportRecovery } = installBridge();
    exportRecovery.mockRejectedValueOnce(new Error('E_INVARIANT：凭据存储不可用'));
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导出恢复码' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('凭据存储不可用');
  });

  it('导入：先错（长度非法）后对（key_id 反馈）', async () => {
    const { importRecovery } = installBridge();
    importRecovery.mockRejectedValueOnce(
      new Error('E_MALFORMED：恢复码长度非法：期望 52 字符（去横杠后），实际 10'),
    );
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '导入恢复码' }));
    const textarea = screen.getByRole('textbox', { name: '导入恢复码' }) as HTMLTextAreaElement;
    await screen.findByText('导入并追平');

    fireEvent.change(textarea, { target: { value: 'AAAAA-BBBBB' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并追平' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('恢复码长度非法');

    fireEvent.change(textarea, { target: { value: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH-IIIII-JJJJJ' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并追平' }));
    const ok = await screen.findByTestId('recovery-import-ok');
    expect(ok.textContent).toContain('a1b2c3d4');
    await waitFor(() => expect(importRecovery).toHaveBeenCalledTimes(2));
  });

  it('轮换：确认弹窗 → rotateKey 被调 → 反馈行出现', async () => {
    const { rotateKey } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '轮换密钥' }));
    expect(await screen.findByText('轮换会生成新钥匙并重加密同步目录中的历史段，旧恢复码立即作废。请轮换完成后重新导出并保存新的恢复码。')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '确认轮换' }));
    await waitFor(() => expect(rotateKey).toHaveBeenCalled());

    const note = await screen.findByTestId('settings-rotate-note');
    expect(note.textContent).toBe('已开始后台重加密，进度见顶栏同步状态');
  });
});

/** T18-02：enabled:true 态的 AI 桥（网络门控用例前置；listModels 可 mockRejectedValueOnce）。 */
function installEnabledAiBridge(): { patch: Mock; listModels: Mock } {
  const listModels = vi.fn(async () => ({ models: ['qwen-7b', 'deepseek-v3'], cached: false, fetchedAt: 1 }));
  const { patch } = installBridge({
    ai: {
      state: vi.fn(async () => ({
        enabled: true,
        cloudConsent: false,
        activeProviderId: 'plocal1',
        // TASK-T46-01：AI 请求参数（夹具仅补新增字段，既有断言不变）
        chatTimeoutSec: 120,
        maxOutputTokens: null,
        providers: [
          {
            id: 'plocal1',
            kind: 'lmstudio' as const,
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234',
            isLocal: true,
            hasKey: false,
            model: null,
          },
        ],
      })),
      listModels,
      chat: vi.fn(),
      setKey: vi.fn(),
      clearKey: vi.fn(),
      // TASK-T46-01：请求参数通道（夹具仅补新增字段，既有断言不变）
      setChatConfig: vi.fn(async () => ({ chatTimeoutSec: 120, maxOutputTokens: null })),
    },
  } as Partial<SeptcatsApi>);
  return { patch: patch as Mock, listModels: listModels as Mock };
}

function patchCallsWithProviders(patch: Mock): Array<Record<string, unknown>> {
  const call = patch.mock.calls.find((args: unknown[]) => {
    const input = args[0] as { ai?: { providers?: unknown } };
    return Array.isArray(input.ai?.providers);
  }) as unknown as [{ ai: { providers: Array<Record<string, unknown>> } }] | undefined;
  return call === undefined ? [] : call[0].ai.providers;
}

describe('设置页 · AI 请求参数（TASK-T46-01 §1.1）', () => {
  it('渲染并回填：超时输入 = 生效秒数（120）；max_tokens 未设置 → 空', async () => {
    installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    const timeout = (await screen.findByLabelText('请求超时（秒）')) as HTMLInputElement;
    expect(timeout.value).toBe('120');
    const tokens = screen.getByLabelText('最大输出 tokens（可选）') as HTMLInputElement;
    expect(tokens.value).toBe('');
  });

  it('保存超时 300 → setChatConfig({requestTimeoutSec:300}) → 反馈用 main 回包生效值', async () => {
    installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    const setChatConfig = window.septcats.ai.setChatConfig as unknown as Mock;
    setChatConfig.mockResolvedValueOnce({ chatTimeoutSec: 300, maxOutputTokens: null });

    fireEvent.change(await screen.findByLabelText('请求超时（秒）'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: '保存超时' }));

    await waitFor(() =>
      expect(setChatConfig).toHaveBeenCalledWith({ requestTimeoutSec: 300 }),
    );
    expect(await screen.findByText('请求超时已设为 300 秒')).toBeDefined();
  });

  it('越界输入 9999 → 行内报错「请输入 5–600 之间的整数」且不发 setChatConfig；非法文本同办', async () => {
    installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    const setChatConfig = window.septcats.ai.setChatConfig as unknown as Mock;
    const timeout = await screen.findByLabelText('请求超时（秒）');

    fireEvent.change(timeout, { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: '保存超时' }));
    expect(await screen.findByText('请输入 5–600 之间的整数')).toBeDefined();
    expect(setChatConfig).not.toHaveBeenCalled();

    fireEvent.change(timeout, { target: { value: '12秒' } });
    fireEvent.click(screen.getByRole('button', { name: '保存超时' }));
    expect(await screen.findByText('请输入 5–600 之间的整数')).toBeDefined();
    expect(setChatConfig).not.toHaveBeenCalled();
  });

  it('max_tokens：填 2048 → 保存带上；留空 → 显式清回未设置（null）', async () => {
    installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    const setChatConfig = window.septcats.ai.setChatConfig as unknown as Mock;
    const tokens = (await screen.findByLabelText('最大输出 tokens（可选）')) as HTMLInputElement;
    setChatConfig.mockResolvedValueOnce({ chatTimeoutSec: 120, maxOutputTokens: 2_048 });

    fireEvent.change(tokens, { target: { value: '2048' } });
    fireEvent.click(screen.getByRole('button', { name: '保存上限' }));
    await waitFor(() => expect(setChatConfig).toHaveBeenCalledWith({ maxOutputTokens: 2_048 }));
    expect(await screen.findByText('最大输出 tokens 已设为 2048')).toBeDefined();

    setChatConfig.mockResolvedValueOnce({ chatTimeoutSec: 120, maxOutputTokens: null });
    fireEvent.change(tokens, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存上限' }));
    await waitFor(() => expect(setChatConfig).toHaveBeenCalledWith({ maxOutputTokens: null }));
    expect(await screen.findByText('最大输出 tokens 已留空（请求不带 max_tokens）')).toBeDefined();
  });

  it('保存失败 → 行内「保存失败：…」（不静默吞错）', async () => {
    installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    const setChatConfig = window.septcats.ai.setChatConfig as unknown as Mock;
    setChatConfig.mockRejectedValueOnce(new Error('E_MALFORMED：requestTimeoutSec 必须是有限数字或 null'));

    fireEvent.change(await screen.findByLabelText('请求超时（秒）'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: '保存超时' }));

    expect(await screen.findByText('保存失败：E_MALFORMED：requestTimeoutSec 必须是有限数字或 null')).toBeDefined();
  });
});

describe('设置页 · AI 助手（T18-02）', () => {
  it('渲染：AI 助手区块出现，启用开关反映 ai.enabled（默认 false）', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('AI 助手')).toBeDefined();

    const enable = screen.getByRole('switch', { name: '启用 AI' });
    expect(enable.getAttribute('aria-checked')).toBe('false');
  });

  it('启用开关点击 → settings.patch 收到 {ai:{enabled:true}} 且 ai.state 被重拉', async () => {
    const { patch } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');
    const stateMock = window.septcats.ai.state as unknown as Mock;
    expect(stateMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('switch', { name: '启用 AI' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith({ ai: { enabled: true } }));
    await waitFor(() => expect(stateMock).toHaveBeenCalledTimes(2));
  });

  it('添加 LM Studio 预设：弹窗选预设 → 保存 → patch 的 providers 含新项', async () => {
    const { patch } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '添加模型服务' }));
    fireEvent.click(await screen.findByRole('button', { name: 'LM Studio（本地）' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const providers = patchCallsWithProviders(patch as Mock);
    expect(providers).toHaveLength(2);
    const added = providers[1];
    if (added === undefined) {
      throw new Error('patch 未携带新增 provider');
    }
    expect(added.kind).toBe('lmstudio');
    expect(added.baseUrl).toBe('http://127.0.0.1:1234');
    expect(String(added.id)).toMatch(/^p[a-z0-9]{6,}$/);
    expect(added.id).not.toBe('plocal1');
  });

  it('模型下拉：点开触发 listModels（含 providerId）→ 选项出现 → 选中写 model', async () => {
    const { patch, listModels } = installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    const select = screen.getByRole('combobox', { name: '模型' });
    fireEvent.click(select);

    await waitFor(() => expect(listModels).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'plocal1' })));
    expect(await screen.findByRole('option', { name: 'qwen-7b' })).toBeDefined();

    fireEvent.change(select, { target: { value: 'qwen-7b' } });
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const providers = patchCallsWithProviders(patch);
    const first = providers[0];
    if (first === undefined) {
      throw new Error('patch 未携带 providers');
    }
    expect(first.model).toBe('qwen-7b');
  });

  it('测试连接：成功 inline「已连接，2 个模型」；失败 inline「连接失败」含 E_AI_* 码', async () => {
    const { listModels } = installEnabledAiBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('已连接，2 个模型')).toBeDefined();

    listModels.mockRejectedValueOnce(new Error('E_AI_UNREACHABLE：端点不可达：fetch failed'));
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    const fail = await screen.findByText((_, element) => {
      return element?.textContent === '连接失败：E_AI_UNREACHABLE：端点不可达：fetch failed';
    });
    expect(fail).toBeDefined();
  });

  it('密钥：弹窗显示未设置 → 保存调 setKey → 反馈；清除走确认弹窗调 clearKey', async () => {
    const { setKey } = installBridge();
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '密钥' }));
    const keyDialog = await screen.findByRole('dialog', { name: 'API 密钥' });
    expect(within(keyDialog).getByText('密钥：未设置')).toBeDefined();

    fireEvent.change(screen.getByLabelText('输入 API 密钥'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(setKey).toHaveBeenCalledWith({ providerId: 'plocal1', key: 'sk-test' }));
    expect(await within(keyDialog).findByText('密钥已保存')).toBeDefined();

    fireEvent.click(within(keyDialog).getByRole('button', { name: '清除密钥' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(window.septcats.ai.clearKey as unknown as Mock).toHaveBeenCalledWith({ providerId: 'plocal1' });
    });
    expect(await within(keyDialog).findByText('密钥已清除')).toBeDefined();
  });

  it('云端开关在 enabled:false 时 disabled（隐私默认）', async () => {
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    const cloud = screen.getByRole('switch', { name: '允许云端模型' }) as HTMLButtonElement;
    expect(cloud.disabled).toBe(true);
  });

  // T82-02（H-01）：clearKey 失败不得吞错——danger toast + 该项保留（可重删）。
  it('T82-02 H-01：clearKey reject → danger toast「密钥未能从凭据库删除」且项未移除', async () => {
    const { patch } = installBridge({
      ai: {
        state: vi.fn(async () => ({
          enabled: false,
          cloudConsent: false,
          activeProviderId: null,
          chatTimeoutSec: 120,
          maxOutputTokens: null,
          providers: [
            {
              id: 'plocal1',
              kind: 'lmstudio' as const,
              name: 'LM Studio',
              baseUrl: 'http://127.0.0.1:1234',
              isLocal: true,
              hasKey: true,
              model: null,
            },
          ],
        })),
        listModels: vi.fn(),
        chat: vi.fn(),
        setKey: vi.fn(),
        clearKey: vi.fn(async () => {
          throw new Error('E_CRED_UNAVAILABLE：凭据后端不可用（windows-dpapi）');
        }),
      } as unknown as SeptcatsApi['ai'],
    });
    // SettingsPage 自身不挂 ToastViewport（全局视口在 App 根层）——按 store 断言 toast 载荷
    pagesStore.setState((state) => ({ ...state, toasts: [] }));
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    // 失败显性：danger toast 含重试指引与稳定码
    await waitFor(() => {
      const toasts = pagesStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.tone).toBe('danger');
      expect(toasts[0]?.message).toContain('密钥未能从凭据库删除，请重试');
      expect(toasts[0]?.message).toContain('E_CRED_UNAVAILABLE');
    });

    // 项保留在列表（未被摘掉），并带 error 态可重删
    const card = screen.getByTestId('settings-ai-card-plocal1');
    expect(card.className).toContain('settings-ai-card--error');
    expect(screen.getByTestId('settings-ai-key-clear-failed-plocal1')).toBeDefined();

    // 关键：绝不写 providers patch（避免「UI 没了密钥还在」的不一致态）
    const wroteProviders = (patch as Mock).mock.calls.some((args: unknown[]) => {
      const input = args[0] as { ai?: { providers?: unknown } };
      return Array.isArray(input.ai?.providers);
    });
    expect(wroteProviders).toBe(false);
  });

  it('T82-02 H-01：clearKey resolve → 项移除且无失败提示（成功路径行为不变）', async () => {
    const { patch } = installBridge();
    pagesStore.setState((state) => ({ ...state, toasts: [] }));
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const providers = patchCallsWithProviders(patch as Mock);
    expect(providers).toEqual([]); // 唯一 provider 被移除
    expect(screen.queryByTestId('settings-ai-key-clear-failed-plocal1')).toBeNull();
    expect(pagesStore.getState().toasts).toEqual([]);
  });
});

describe('设置页 · 关于块第三方许可（TASK-T75-01 §1）', () => {
  it('第三方许可行渲染，文案指向随包路径 licenses/OFL-NotoSansSC.txt', async () => {
    render(<SettingsPage />);
    await screen.findByTestId('settings-page');

    // 一行级文案行（无新按钮/浮层）：标题 + 右侧随包路径文本，均走 t()
    const row = screen.getByText('第三方许可').closest('.settings-row');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Noto Sans SC（SIL OFL 1.1）');
    expect(row?.textContent).toContain('licenses/OFL-NotoSansSC.txt');
  });
});
