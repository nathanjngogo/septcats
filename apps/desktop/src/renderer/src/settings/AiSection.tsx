/**
 * AiSection.tsx —— 设置页「AI 助手」区块（M11 · TASK-T18-02，纯 renderer）。
 *
 * 数据源唯一为 `ai.state()`：mount 拉取一次，此后每次 patch/密钥/添加/删除后重拉。
 * provider 编辑/删除只走 `settings.patch({ ai: { providers: … } })`（整体替换语义）；
 * 密钥走 `ai.setKey`/`ai.clearKey`；模型列表与测试连接走 `ai.listModels`（60s TTL，
 * 测试连接与手动刷新用 refresh:true 绕过）。禁用全局 saving，区块内自管 busy。
 * 网络门控：`ai.enabled === false` 时「测试连接」与模型下拉禁用（配置先行，增删改/密钥不禁用）。
 */
import { useEffect, useState } from 'react';
import { Button, Dialog, Switch } from '@septcats/ui';
import type { AiChatConfigSnapshot, AiProviderConfig, AiProviderKind, AiStateSnapshot } from '../../../shared/ai';
import {
  AI_CHAT_TIMEOUT_ADVISED_MAX_SEC,
  AI_CHAT_TIMEOUT_ADVISED_MIN_SEC,
  AI_CHAT_TIMEOUT_DEFAULT_SEC,
  AI_CHAT_TIMEOUT_MAX_SEC,
  AI_CHAT_TIMEOUT_MIN_SEC,
  AI_MAX_OUTPUT_TOKENS_MAX,
  AI_MAX_OUTPUT_TOKENS_MIN,
} from '../../../shared/ai';
import { t } from '../i18n';
import './AiSection.css';

/** 快照行 → patch 用的 provider 配置（剥掉 isLocal/hasKey 两个派生布尔）。 */
function toConfigs(snapshot: AiStateSnapshot): AiProviderConfig[] {
  return snapshot.providers.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
  }));
}

/** 错误 → 文案（Error.message 自带 `E_AI_*：` 前缀，照展示）。 */
function describeAiError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 本地小实现模板插值：{n}/{name}/{msg}（不改 SettingsPage 导出）。 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/** 客户端生成 provider id：base36，11~15 字符（满足 schema 正则）。 */
function newProviderId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

interface ProviderPreset {
  kind: AiProviderKind;
  name: string;
  baseUrl: string;
}

function providerPresets(): ProviderPreset[] {
  return [
    { kind: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234' },
    { kind: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434' },
    { kind: 'openai-compatible', name: '', baseUrl: '' },
  ];
}

function kindLabel(kind: AiProviderKind): string {
  switch (kind) {
    case 'lmstudio':
      return t('settings.ai.providerKindLmstudio');
    case 'ollama':
      return t('settings.ai.providerKindOllama');
    case 'openai-compatible':
      return t('settings.ai.providerKindCustom');
  }
}

interface ModelState {
  status: 'loading' | 'ok' | 'empty' | 'error';
  list: string[];
  error: string | null;
}

interface InlineResult {
  ok: boolean;
  text: string;
}

export function AiSection(): JSX.Element {
  const [aiState, setAiState] = useState<AiStateSnapshot | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  /** per-provider 行内动作 busy：`test:${id}` / `model:${id}` */
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  /** 行内反馈（测试连接/模型错误）：providerId → { ok, text } */
  const [result, setResult] = useState<Record<string, InlineResult>>({});
  /** 模型下拉四态：providerId → ModelState */
  const [models, setModels] = useState<Record<string, ModelState>>({});

  // TASK-T46-01：AI 请求参数（超时秒 / 最大输出 tokens）
  const [timeoutInput, setTimeoutInput] = useState('');
  const [maxTokensInput, setMaxTokensInput] = useState('');
  const [configFeedback, setConfigFeedback] = useState<InlineResult | null>(null);
  const [configSaving, setConfigSaving] = useState(false);

  // 添加/编辑弹窗（同壳复用：mode 区分）
  const [providerDialogMode, setProviderDialogMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [kindPreview, setKindPreview] = useState<AiProviderKind | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');

  // 密钥弹窗
  const [keyDialogId, setKeyDialogId] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [keyClearConfirmOpen, setKeyClearConfirmOpen] = useState(false);

  // 删除确认弹窗
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await window.septcats.ai.state();
        if (!cancelled) {
          setAiState(next);
        }
      } catch (cause) {
        if (!cancelled) {
          setAiError(describeAiError(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async (): Promise<void> => {
    setAiState(await window.septcats.ai.state());
  };

  const patchAi = async (patch: {
    enabled?: boolean;
    cloudConsent?: boolean;
    activeProviderId?: string | null;
    providers?: AiProviderConfig[];
  }): Promise<void> => {
    setAiError(null);
    try {
      await window.septcats.settings.patch({ ai: patch });
      await refresh();
    } catch (cause) {
      setAiError(describeAiError(cause));
    }
  };

  const setBusyKey = (key: string, on: boolean): void => {
    setBusy((prev) => ({ ...prev, [key]: on }));
  };

  // TASK-T46-01：输入框随快照回填（保存后经 setAiState 回填 main 夹紧后的实际值）
  useEffect(() => {
    if (aiState === null) {
      return;
    }
    setTimeoutInput(String(aiState.chatTimeoutSec));
    setMaxTokensInput(aiState.maxOutputTokens === null ? '' : String(aiState.maxOutputTokens));
  }, [aiState]);

  /** 整数解析 + 区间校验（不合规 → 行内报错并返回 null）。 */
  const parseConfigNumber = (raw: string, min: number, max: number): number | null => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      setConfigFeedback({
        ok: false,
        text: fillTemplate(t('settings.ai.configInvalidRange'), {
          min: String(min),
          max: String(max),
        }),
      });
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed < min || parsed > max) {
      setConfigFeedback({
        ok: false,
        text: fillTemplate(t('settings.ai.configInvalidRange'), {
          min: String(min),
          max: String(max),
        }),
      });
      return null;
    }
    return parsed;
  };

  /** 写 AI 请求参数：回包即生效值（main 侧夹紧），据此回填 + 行内反馈。 */
  const applyChatConfig = async (
    patch: { requestTimeoutSec?: number | null; maxOutputTokens?: number | null },
    describeSaved: (next: AiChatConfigSnapshot) => string,
  ): Promise<void> => {
    setConfigFeedback(null);
    setConfigSaving(true);
    try {
      const next = await window.septcats.ai.setChatConfig(patch);
      setAiState((prev) =>
        prev === null
          ? prev
          : { ...prev, chatTimeoutSec: next.chatTimeoutSec, maxOutputTokens: next.maxOutputTokens },
      );
      setConfigFeedback({ ok: true, text: describeSaved(next) });
    } catch (cause) {
      setConfigFeedback({
        ok: false,
        text: fillTemplate(t('settings.ai.configSaveFailed'), { msg: describeAiError(cause) }),
      });
    } finally {
      setConfigSaving(false);
    }
  };

  const saveTimeout = async (): Promise<void> => {
    const parsed = parseConfigNumber(
      timeoutInput,
      AI_CHAT_TIMEOUT_MIN_SEC,
      AI_CHAT_TIMEOUT_MAX_SEC,
    );
    if (parsed === null) {
      return;
    }
    await applyChatConfig({ requestTimeoutSec: parsed }, (next) =>
      fillTemplate(t('settings.ai.requestTimeoutSaved'), { n: String(next.chatTimeoutSec) }),
    );
  };

  /** 留空 = 清回未设置（请求不带 max_tokens），保持既有默认行为。 */
  const saveMaxTokens = async (): Promise<void> => {
    const raw = maxTokensInput.trim();
    if (raw.length === 0) {
      await applyChatConfig({ maxOutputTokens: null }, () => t('settings.ai.maxTokensCleared'));
      return;
    }
    const parsed = parseConfigNumber(raw, AI_MAX_OUTPUT_TOKENS_MIN, AI_MAX_OUTPUT_TOKENS_MAX);
    if (parsed === null) {
      return;
    }
    await applyChatConfig({ maxOutputTokens: parsed }, (next) =>
      fillTemplate(t('settings.ai.maxTokensSaved'), {
        n: String(next.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS_MIN),
      }),
    );
  };

  const loadModels = async (providerId: string, forceRefresh = false): Promise<void> => {
    setBusyKey(`model:${providerId}`, true);
    setModels((prev) => ({
      ...prev,
      [providerId]: { status: 'loading', list: prev[providerId]?.list ?? [], error: null },
    }));
    try {
      const next = await window.septcats.ai
        .listModels(forceRefresh ? { providerId, refresh: true } : { providerId });
      setModels((prev) => ({
        ...prev,
        [providerId]: {
          status: next.models.length === 0 ? 'empty' : 'ok',
          list: next.models,
          error: null,
        },
      }));
    } catch (cause) {
      setModels((prev) => ({
        ...prev,
        [providerId]: { status: 'error', list: [], error: describeAiError(cause) },
      }));
    } finally {
      setBusyKey(`model:${providerId}`, false);
    }
  };

  const ensureModels = (provider: { id: string; model: string | null }): void => {
    if (aiState?.enabled !== true) {
      return;
    }
    if (models[provider.id] === undefined && busy[`model:${provider.id}`] !== true) {
      void loadModels(provider.id);
    }
  };

  const handleModelChange = async (providerId: string, model: string): Promise<void> => {
    if (aiState === null) {
      return;
    }
    const providers = toConfigs(aiState).map((p) =>
      p.id === providerId ? { ...p, model: model === '' ? null : model } : p,
    );
    await patchAi({ providers });
  };

  const handleTest = async (providerId: string): Promise<void> => {
    setBusyKey(`test:${providerId}`, true);
    setResult((prev) => ({ ...prev, [providerId]: { ok: true, text: t('settings.ai.modelLoading') } }));
    try {
      const next = await window.septcats.ai.listModels({ providerId, refresh: true });
      setResult((prev) => ({
        ...prev,
        [providerId]: {
          ok: true,
          text: fillTemplate(t('settings.ai.testOk'), { n: String(next.models.length) }),
        },
      }));
      setModels((prev) => ({
        ...prev,
        [providerId]: {
          status: next.models.length === 0 ? 'empty' : 'ok',
          list: next.models,
          error: null,
        },
      }));
    } catch (cause) {
      setResult((prev) => ({
        ...prev,
        [providerId]: {
          ok: false,
          text: fillTemplate(t('settings.ai.testFail'), { msg: describeAiError(cause) }),
        },
      }));
    } finally {
      setBusyKey(`test:${providerId}`, false);
    }
  };

  const closeProviderDialog = (): void => {
    setProviderDialogMode(null);
    setEditId(null);
    setKindPreview(null);
    setNameInput('');
    setBaseUrlInput('');
  };

  const openAddDialog = (): void => {
    setProviderDialogMode('add');
    setEditId(null);
    setKindPreview(null);
    setNameInput('');
    setBaseUrlInput('');
  };

  const openEditDialog = (provider: { id: string; name: string; baseUrl: string }): void => {
    setProviderDialogMode('edit');
    setEditId(provider.id);
    setKindPreview(null);
    setNameInput(provider.name);
    setBaseUrlInput(provider.baseUrl);
  };

  const choosePreset = (preset: ProviderPreset): void => {
    setKindPreview(preset.kind);
    setNameInput(preset.name);
    setBaseUrlInput(preset.baseUrl);
  };

  const addDialogValid =
    kindPreview !== null &&
    nameInput.trim().length > 0 &&
    (kindPreview === 'openai-compatible'
      ? /^https?:\/\//.test(baseUrlInput.trim())
      : baseUrlInput.trim().length > 0);

  const submitProviderDialog = async (): Promise<void> => {
    if (aiState === null || providerDialogMode === null) {
      return;
    }
    if (providerDialogMode === 'add') {
      if (kindPreview === null || !addDialogValid) {
        return;
      }
      const providers = [
        ...toConfigs(aiState),
        {
          id: newProviderId(),
          kind: kindPreview,
          name: nameInput.trim(),
          baseUrl: baseUrlInput.trim(),
          model: null,
        },
      ];
      closeProviderDialog();
      await patchAi({ providers });
      return;
    }
    if (editId === null || nameInput.trim().length === 0) {
      return;
    }
    const target = editId;
    closeProviderDialog();
    await patchAi({
      providers: toConfigs(aiState).map((p) =>
        p.id === target ? { ...p, name: nameInput.trim(), baseUrl: baseUrlInput.trim() } : p,
      ),
    });
  };

  const closeKeyDialog = (): void => {
    setKeyDialogId(null);
    setKeyInput('');
    setKeySaving(false);
    setKeyFeedback(null);
    setKeyClearConfirmOpen(false);
  };

  const openKeyDialog = (providerId: string): void => {
    setKeyDialogId(providerId);
    setKeyInput('');
    setKeyFeedback(null);
    setKeyClearConfirmOpen(false);
  };

  const submitKey = async (): Promise<void> => {
    if (keyDialogId === null || keyInput.length === 0) {
      return;
    }
    setKeySaving(true);
    setKeyFeedback(null);
    try {
      await window.septcats.ai.setKey({ providerId: keyDialogId, key: keyInput });
      setKeyInput('');
      setKeyFeedback({ ok: true, text: t('settings.ai.keySaved') });
      await refresh();
    } catch (cause) {
      setKeyFeedback({ ok: false, text: describeAiError(cause) });
    } finally {
      setKeySaving(false);
    }
  };

  const confirmClearKey = async (): Promise<void> => {
    if (keyDialogId === null) {
      return;
    }
    setKeySaving(true);
    try {
      await window.septcats.ai.clearKey({ providerId: keyDialogId });
      setKeyFeedback({ ok: true, text: t('settings.ai.keyCleared') });
      setKeyClearConfirmOpen(false);
      await refresh();
    } catch (cause) {
      setKeyFeedback({ ok: false, text: describeAiError(cause) });
      setKeyClearConfirmOpen(false);
    } finally {
      setKeySaving(false);
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (removeConfirmId === null || aiState === null) {
      return;
    }
    const target = removeConfirmId;
    setRemoveConfirmId(null);
    // 密钥顺带清除（尽力而为，失败不阻断删除）
    await window.septcats.ai.clearKey({ providerId: target }).catch(() => {});
    const providers = toConfigs(aiState).filter((p) => p.id !== target);
    if (aiState.activeProviderId === target) {
      // 删掉的正是默认 provider：同一次 patch 里清空，避免 activeProviderId 悬空
      await patchAi({ providers, activeProviderId: null });
      return;
    }
    await patchAi({ providers });
  };

  const keyDialogProvider =
    keyDialogId === null || aiState === null
      ? null
      : (aiState.providers.find((p) => p.id === keyDialogId) ?? null);
  const removeConfirmProvider =
    removeConfirmId === null || aiState === null
      ? null
      : (aiState.providers.find((p) => p.id === removeConfirmId) ?? null);

  const enabled = aiState?.enabled ?? false;

  return (
    <>
      {aiError === null ? null : (
        <p className="settings-ai-inline-error" role="alert">
          {aiError}
        </p>
      )}

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.ai.enable')}</span>
          <span className="settings-lab-d">{t('settings.ai.enableDesc')}</span>
        </div>
        <div className="settings-ctl">
          <Switch
            checked={enabled}
            onCheckedChange={(on) => {
              void patchAi({ enabled: on });
            }}
            label={t('settings.ai.enable')}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.ai.cloud')}</span>
          <span className="settings-lab-d">{t('settings.ai.cloudDesc')}</span>
        </div>
        <div className="settings-ctl">
          <Switch
            checked={aiState?.cloudConsent ?? false}
            onCheckedChange={(on) => {
              void patchAi({ cloudConsent: on });
            }}
            disabled={!enabled}
            label={t('settings.ai.cloud')}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.ai.requestTimeout')}</span>
          <span className="settings-lab-d">
            {fillTemplate(t('settings.ai.requestTimeoutDesc'), {
              min: String(AI_CHAT_TIMEOUT_ADVISED_MIN_SEC),
              max: String(AI_CHAT_TIMEOUT_ADVISED_MAX_SEC),
              default: String(AI_CHAT_TIMEOUT_DEFAULT_SEC),
            })}
          </span>
        </div>
        <div className="settings-ctl">
          <div className="settings-ai-config-ctl">
            <input
              className="settings-ai-input settings-ai-input--num"
              type="number"
              inputMode="numeric"
              min={AI_CHAT_TIMEOUT_MIN_SEC}
              max={AI_CHAT_TIMEOUT_MAX_SEC}
              step={1}
              value={timeoutInput}
              aria-label={t('settings.ai.requestTimeout')}
              onChange={(event) => {
                setTimeoutInput(event.target.value);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={configSaving}
              disabled={aiState === null}
              onClick={() => {
                void saveTimeout();
              }}
            >
              {t('settings.ai.requestTimeoutSave')}
            </Button>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.ai.maxTokens')}</span>
          <span className="settings-lab-d">
            {fillTemplate(t('settings.ai.maxTokensDesc'), {
              min: String(AI_MAX_OUTPUT_TOKENS_MIN),
              max: String(AI_MAX_OUTPUT_TOKENS_MAX),
            })}
          </span>
        </div>
        <div className="settings-ctl">
          <div className="settings-ai-config-ctl">
            <input
              className="settings-ai-input settings-ai-input--num"
              type="number"
              inputMode="numeric"
              min={AI_MAX_OUTPUT_TOKENS_MIN}
              max={AI_MAX_OUTPUT_TOKENS_MAX}
              step={1}
              value={maxTokensInput}
              placeholder={t('settings.ai.maxTokensClear')}
              aria-label={t('settings.ai.maxTokens')}
              onChange={(event) => {
                setMaxTokensInput(event.target.value);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={configSaving}
              disabled={aiState === null}
              onClick={() => {
                void saveMaxTokens();
              }}
            >
              {t('settings.ai.maxTokensSave')}
            </Button>
          </div>
        </div>
      </div>

      {configFeedback === null ? null : (
        <p
          className={configFeedback.ok ? 'settings-ai-inline-ok' : 'settings-ai-inline-error'}
          role="alert"
        >
          {configFeedback.text}
        </p>
      )}

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.ai.providers')}</span>
        </div>
        <div className="settings-ctl">
          <Button variant="secondary" size="sm" disabled={aiState === null} onClick={openAddDialog}>
            {t('settings.ai.addProvider')}
          </Button>
        </div>
      </div>

      {aiState !== null && aiState.providers.length === 0 ? (
        <p className="settings-lab-d settings-ai-empty">{t('settings.ai.emptyProviders')}</p>
      ) : null}

      {(aiState?.providers ?? []).map((p) => {
        const state = models[p.id];
        const rowResult = result[p.id];
        const modelBusy = busy[`model:${p.id}`] === true;
        return (
          <div className="settings-ai-card" key={p.id}>
            <div className="settings-ai-card-head">
              <input
                type="radio"
                name="ai-active"
                aria-label={t('settings.ai.activeHint')}
                checked={aiState?.activeProviderId === p.id}
                onChange={() => {
                  void patchAi({ activeProviderId: p.id });
                }}
              />
              <span className="settings-ai-name">{p.name}</span>
              <span className={`settings-ai-badge settings-ai-badge--${p.kind}`}>{kindLabel(p.kind)}</span>
              {aiState?.activeProviderId === p.id ? (
                <span className="settings-ai-active-hint">{t('settings.ai.activeHint')}</span>
              ) : null}
            </div>
            <div className="settings-ai-mono settings-ai-baseurl" title={p.baseUrl}>
              {p.baseUrl}
            </div>
            <div className="settings-ai-card-mid">
              <select
                className="settings-ai-select"
                aria-label={t('settings.ai.modelLabel')}
                value={p.model ?? ''}
                disabled={!enabled || modelBusy}
                onClick={() => {
                  ensureModels(p);
                }}
                onFocus={() => {
                  ensureModels(p);
                }}
                onChange={(event) => {
                  void handleModelChange(p.id, event.target.value);
                }}
              >
                {state === undefined || state.status === 'loading' ? (
                  <option value="">{t('settings.ai.modelLoading')}</option>
                ) : null}
                {state?.status === 'empty' ? (
                  <option value="">{t('settings.ai.modelEmpty')}</option>
                ) : null}
                {state === undefined || state.status === 'loading' || state.status === 'empty' ? null : (
                  <option value="">{p.model === null ? t('settings.ai.modelNone') : p.model}</option>
                )}
                {state?.status === 'ok'
                  ? state.list
                      .filter((m) => m !== p.model)
                      .map((m) => (
                        <option value={m} key={m}>
                          {m}
                        </option>
                      ))
                  : null}
              </select>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('settings.ai.modelRefresh')}
                loading={modelBusy}
                disabled={!enabled}
                onClick={() => {
                  void loadModels(p.id, true);
                }}
              >
                {t('settings.ai.modelRefresh')}
              </Button>
              <span className={`settings-ai-badge settings-ai-badge--${p.isLocal ? 'local' : 'cloud'}`}>
                {p.isLocal ? t('settings.ai.localBadge') : t('settings.ai.cloudBadge')}
              </span>
              <span className="settings-ai-key-state">
                {t('settings.ai.keyState').replace(
                  '{state}',
                  p.hasKey ? t('settings.ai.keySet') : t('settings.ai.keyUnset'),
                )}
              </span>
            </div>
            {state?.status === 'error' ? (
              <p className="settings-ai-inline-error" role="alert">
                {state.error}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!enabled}
                  onClick={() => {
                    void loadModels(p.id, true);
                  }}
                >
                  {t('settings.ai.modelRefresh')}
                </Button>
              </p>
            ) : null}
            {rowResult === undefined ? null : (
              <p className={rowResult.ok ? 'settings-ai-inline-ok' : 'settings-ai-inline-error'} role="alert">
                {rowResult.text}
              </p>
            )}
            <div className="settings-ai-actions">
              <Button
                variant="ghost"
                size="sm"
                loading={busy[`test:${p.id}`] === true}
                disabled={!enabled}
                title={enabled ? undefined : t('settings.ai.enableFirstHint')}
                onClick={() => {
                  void handleTest(p.id);
                }}
              >
                {t('settings.ai.test')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  openKeyDialog(p.id);
                }}
              >
                {t('settings.ai.keyLabel')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  openEditDialog(p);
                }}
              >
                {t('settings.ai.editButton')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRemoveConfirmId(p.id);
                }}
              >
                {t('settings.ai.removeButton')}
              </Button>
            </div>
          </div>
        );
      })}

      <Dialog
        open={providerDialogMode !== null}
        onClose={closeProviderDialog}
        title={
          providerDialogMode === 'edit'
            ? t('settings.ai.providerDialogEditTitle')
            : t('settings.ai.providerDialogNewTitle')
        }
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeProviderDialog}>
              {t('settings.ai.providerCancel')}
            </Button>
            <Button
              size="sm"
              disabled={
                providerDialogMode === 'add'
                  ? !addDialogValid
                  : nameInput.trim().length === 0 || baseUrlInput.trim().length === 0
              }
              onClick={() => {
                void submitProviderDialog();
              }}
            >
              {t('settings.ai.providerSave')}
            </Button>
          </div>
        }
      >
        {providerDialogMode === 'add' ? (
          <div className="settings-ai-presets">
            {providerPresets().map((preset) => (
              <Button
                variant={kindPreview === preset.kind ? 'primary' : 'secondary'}
                size="sm"
                key={preset.kind}
                onClick={() => {
                  choosePreset(preset);
                }}
              >
                {kindLabel(preset.kind)}
              </Button>
            ))}
          </div>
        ) : null}
        <label className="settings-ai-field">
          <span className="settings-lab-b">{t('settings.ai.providerName')}</span>
          <input
            className="settings-ai-input"
            value={nameInput}
            placeholder={t('settings.ai.providerBaseUrlPlaceholder')}
            onChange={(event) => {
              setNameInput(event.target.value);
            }}
          />
        </label>
        <label className="settings-ai-field">
          <span className="settings-lab-b">{t('settings.ai.providerBaseUrl')}</span>
          <input
            className="settings-ai-input settings-ai-mono"
            value={baseUrlInput}
            placeholder={t('settings.ai.providerBaseUrlPlaceholder')}
            onChange={(event) => {
              setBaseUrlInput(event.target.value);
            }}
          />
        </label>
        {providerDialogMode === 'edit' && editId !== null && aiState !== null ? (
          (() => {
            const editing = aiState.providers.find((p) => p.id === editId);
            return editing === null || editing === undefined ? null : (
              <p className="settings-lab-d">{t('settings.ai.editKindLine').replace('{kind}', kindLabel(editing.kind))}</p>
            );
          })()
        ) : null}
      </Dialog>

      <Dialog
        open={keyDialogId !== null}
        onClose={closeKeyDialog}
        title={t('settings.ai.keyDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeKeyDialog}>
              {t('settings.ai.providerCancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={keyDialogProvider === null}
              onClick={() => {
                setKeyClearConfirmOpen(true);
              }}
            >
              {t('settings.ai.keyClear')}
            </Button>
            <Button
              size="sm"
              loading={keySaving}
              disabled={keyInput.length === 0}
              onClick={() => {
                void submitKey();
              }}
            >
              {t('settings.ai.keySave')}
            </Button>
          </div>
        }
      >
        <p className="settings-lab-d">{t('settings.ai.keyDialogBody')}</p>
        <p className="settings-ai-key-state">
          {t('settings.ai.keyState').replace(
            '{state}',
            keyDialogProvider?.hasKey === true ? t('settings.ai.keySet') : t('settings.ai.keyUnset'),
          )}
        </p>
        <input
          className="settings-ai-input"
          type="password"
          value={keyInput}
          placeholder={t('settings.ai.keyPlaceholder')}
          aria-label={t('settings.ai.keyPlaceholder')}
          onChange={(event) => {
            setKeyInput(event.target.value);
          }}
        />
        {keyFeedback === null ? null : (
          <p className={keyFeedback.ok ? 'settings-ai-inline-ok' : 'settings-ai-inline-error'} role="alert">
            {keyFeedback.text}
          </p>
        )}
      </Dialog>

      <Dialog
        open={keyClearConfirmOpen}
        onClose={() => {
          setKeyClearConfirmOpen(false);
        }}
        title={t('settings.ai.keyClearConfirmTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setKeyClearConfirmOpen(false);
              }}
            >
              {t('settings.ai.providerCancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={keySaving}
              onClick={() => {
                void confirmClearKey();
              }}
            >
              {t('settings.ai.removeConfirm')}
            </Button>
          </div>
        }
      >
        <p className="settings-lab-d">{t('settings.ai.keyClearConfirmBody')}</p>
      </Dialog>

      <Dialog
        open={removeConfirmId !== null}
        onClose={() => {
          setRemoveConfirmId(null);
        }}
        title={t('settings.ai.removeConfirmTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRemoveConfirmId(null);
              }}
            >
              {t('settings.ai.providerCancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void confirmRemove();
              }}
            >
              {t('settings.ai.removeConfirm')}
            </Button>
          </div>
        }
      >
        <p className="settings-lab-d">
          {fillTemplate(t('settings.ai.removeConfirmBody'), {
            name: removeConfirmProvider?.name ?? '',
          })}
        </p>
      </Dialog>
    </>
  );
}
