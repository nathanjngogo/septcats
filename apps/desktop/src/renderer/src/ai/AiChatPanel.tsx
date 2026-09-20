/**
 * AiChatPanel.tsx —— 右侧可收起 AI 对话面板（TASK-T38-01 §0.1/§0.2/§0.3）。
 *
 * 组成：标题栏（Sparkle + 清空历史 + 关闭）+ 消息列表（用户/AI 气泡，assistant
 * 回复里的 ⟦#N⟧ 标记渲染为可点击「页名 › 块锚点」chip）+ 输入区（Enter 发送 /
 * Shift+Enter 换行 / 生成中可停止 / 「附带选中内容」开关）。
 *
 * 复用既有口径：
 * - 门控与错误：ai.state() 三态门控（未启用/无 provider → 引导 + 打开设置），
 *   E_AI_* 经 errorText() 呈现（T25 既有错误口径），role="alert"；
 * - 停止 = 渲染层 runId 作废（照 PageView aiRunIdRef 先例）：非流式请求的迟到
 *   结果直接丢弃，不落历史；
 * - 上下文与引用：chatBridge（PageView 注册）→ chatContext 装配/解析；
 * - 历史与面板状态：chatState（localStorage 持久化，不进账本）。
 * - TASK-T46-01：空正文/纯推理（可折叠）/length 截断都要有可读提示（不渲染空白气泡）；
 *   超时（E_AI_TIMEOUT）给出「等待超过 N 秒已中止」+ 调大「请求超时」的指引；
 *   设置里配了「最大输出 tokens」时面板请求带上 max_tokens。
 * 隐私：本组件不接触密钥、不打消息日志；云端门禁在 main 侧 assertAiUrlAllowed
 * （无 consent 时 fetch 零调用，测试锁死）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, Checkbox, Icon, IconButton, Sparkle, Spinner, Trash, X } from '@septcats/ui';
import { t } from '../i18n';
import { usePages } from '../state/pages';
import {
  aiChatActions,
  aiChatStore,
  makeChatMsg,
  useAiChat,
  type ChatMsg,
  type ChatRef,
  type ChatMsgExtra,
} from './chatState';
import {
  clampReasoningForStorage,
  lengthNoticeText,
  panelErrorText,
  reasoningOf,
  replyNoticeText,
} from './chatReply';
import { getEditorChatProvider, requestBlockJump } from './chatBridge';
import {
  assembleChatMessages,
  buildBlockIndex,
  buildContextText,
  parseCitations,
  resolveCitations,
} from './chatContext';
import './AiChatPanel.css';

/** 引用 chip 标签：「页名 › 块N」。 */
export function chatRefLabel(ref: ChatRef): string {
  return `${ref.pageTitle} › ${t('aiChat.blockAnchor').replace('{n}', String(ref.n))}`;
}

export function AiChatPanel() {
  const messages = useAiChat((state) => state.messages);
  // 历史按 workspace 隔离：ws 切换/就绪 → 装载对应历史（chatState.setWorkspace）
  const workspaceId = usePages((state) => state.workspaceId);
  useEffect(() => {
    aiChatActions.setWorkspace(workspaceId);
  }, [workspaceId]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeSelection, setIncludeSelection] = useState(true);
  const runIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 面板挂载 = 展开：聚焦输入框（键盘可达）
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 新消息 → 列表滚到底部（面板内滚动，不产生窗口滚动）
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, busy]);

  const send = useCallback(async (): Promise<void> => {
    const question = draft.trim();
    if (question.length === 0 || busy) {
      return;
    }
    setError(null);
    setGateMessage(null);
    // 门控三态（照 PageView runAiAction 口径）：未启用/无 provider → 引导，不发请求
    let snapshot: Awaited<ReturnType<typeof window.septcats.ai.state>>;
    try {
      snapshot = await window.septcats.ai.state();
    } catch (caught: unknown) {
      setError(panelErrorText(caught, null));
      return;
    }
    if (!snapshot.enabled) {
      setGateMessage(t('ai.needEnable'));
      return;
    }
    if (snapshot.providers.length === 0) {
      setGateMessage(t('ai.needProvider'));
      return;
    }
    const providerId = snapshot.activeProviderId ?? snapshot.providers[0]?.id;
    if (providerId === undefined) {
      setGateMessage(t('ai.needProvider'));
      return;
    }

    // 上下文 = 当前页（编辑器桥未注册/数据库页 → 无上下文，仍可对话）
    const editorProvider = getEditorChatProvider();
    const ctx = editorProvider?.getPageContext() ?? null;
    const blockIndex = buildBlockIndex(ctx);
    const contextText =
      ctx === null ? null : buildContextText(ctx, blockIndex, { includeSelection });

    const history = aiChatStore.getState().messages;
    const runId = ++runIdRef.current;
    aiChatActions.appendMessages([makeChatMsg('user', question, Date.now())]);
    setDraft('');
    setBusy(true);
    // TASK-T46-01 §1.4：设置里配了「最大输出 tokens」才带该字段（未设置 = 现状，不带）
    const request: {
      providerId: string;
      messages: ReturnType<typeof assembleChatMessages>;
      maxTokens?: number;
    } = {
      providerId,
      messages: assembleChatMessages({ history, contextText, question }),
    };
    const configuredTokens = snapshot.maxOutputTokens;
    if (typeof configuredTokens === 'number' && configuredTokens > 0) {
      request.maxTokens = configuredTokens;
    }
    try {
      const res = await window.septcats.ai.chat(request);
      if (runId !== runIdRef.current) {
        return; // 已停止/已关闭：迟到结果丢弃
      }
      const refs =
        ctx !== null ? resolveCitations(res.text, blockIndex, ctx.pageId, ctx.pageTitle) : [];
      // §1.2：推理正文/length 一并落历史（气泡据此给提示 + 可折叠区）
      const extra: ChatMsgExtra = {};
      const reasoning = clampReasoningForStorage(res.reasoningContent);
      if (reasoning !== undefined) {
        extra.reasoning = reasoning;
      }
      if (typeof res.finishReason === 'string') {
        extra.finishReason = res.finishReason;
      }
      aiChatActions.appendMessages([
        makeChatMsg('assistant', res.text, Date.now(), refs, extra),
      ]);
    } catch (caught: unknown) {
      if (runId === runIdRef.current) {
        // §1.3：超时 → 「等待超过 N 秒已中止」+ 调大「请求超时」指引
        setError(panelErrorText(caught, snapshot.chatTimeoutSec ?? null));
      }
    } finally {
      if (runId === runIdRef.current) {
        setBusy(false);
      }
    }
  }, [draft, busy, includeSelection]);

  const stop = useCallback((): void => {
    runIdRef.current += 1; // 作废在途请求（迟到结果丢弃）
    setBusy(false);
  }, []);

  const clearHistory = useCallback((): void => {
    if (window.confirm(t('aiChat.clearConfirm'))) {
      aiChatActions.clearMessages();
    }
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      aiChatActions.setOpen(false);
    }
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 侧栏容器承载 Esc 收起
    <aside className="ai-chat" aria-label={t('aiChat.title')} onKeyDown={onKeyDown}>
      <div className="ai-chat__head">
        <span className="ai-chat__head-icon" aria-hidden="true">
          <Icon icon={Sparkle} size="sm" />
        </span>
        <span className="ai-chat__head-title">{t('aiChat.title')}</span>
        <span className="ai-chat__head-spacer" />
        <IconButton icon={Trash} label={t('aiChat.clear')} onClick={clearHistory} />
        <IconButton
          icon={X}
          label={t('aiChat.close')}
          onClick={() => {
            aiChatActions.setOpen(false);
          }}
        />
      </div>

      <div className="ai-chat__list" ref={listRef}>
        {messages.length === 0 ? <div className="ai-chat__empty">{t('aiChat.emptyHistory')}</div> : null}
        {messages.map((msg) => (
          <ChatBubble key={msg.id} msg={msg} />
        ))}
        {busy ? (
          <div className="ai-chat__busy-row">
            <Spinner size="sm" />
            <span className="ai-chat__busy-text">{t('ai.busy')}</span>
            <Button variant="secondary" size="sm" onClick={stop}>
              {t('aiChat.stop')}
            </Button>
          </div>
        ) : null}
        {gateMessage !== null ? (
          <div className="ai-chat__gate" role="alert">
            <p className="ai-chat__gate-text">{gateMessage}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('septcats:open-settings'));
              }}
            >
              {t('ai.openSettings')}
            </Button>
          </div>
        ) : null}
        {error !== null ? (
          <div className="ai-chat__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="ai-chat__composer">
        <Checkbox
          className="ai-chat__selection-toggle"
          label={t('aiChat.includeSelection')}
          checked={includeSelection}
          onChange={(event) => {
            setIncludeSelection(event.target.checked);
          }}
        />
        <textarea
          ref={textareaRef}
          className="ai-chat__input"
          placeholder={t('aiChat.inputPlaceholder')}
          value={draft}
          rows={3}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="ai-chat__composer-actions">
          <span />
          {busy ? (
            <Button variant="secondary" size="sm" onClick={stop} aria-label={t('aiChat.stopBusy')}>
              {t('aiChat.stop')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={draft.trim().length === 0} onClick={() => void send()}>
              {t('aiChat.send')}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="ai-chat__msg ai-chat__msg--user">
        <div className="ai-chat__bubble ai-chat__bubble--user">{msg.content}</div>
      </div>
    );
  }
  const segments = parseCitations(msg.content);
  const refByN = new Map((msg.refs ?? []).map((ref) => [ref.n, ref]));
  // TASK-T46-01 §1.2：空正文必给提示（绝不渲染空白气泡）；length 单独提示；推理正文可折叠
  const notice = replyNoticeText(msg);
  const lengthNotice = lengthNoticeText(msg.finishReason);
  const reasoning = reasoningOf(msg);
  return (
    <div className="ai-chat__msg ai-chat__msg--assistant">
      <div className="ai-chat__bubble ai-chat__bubble--assistant">
        {msg.stopped ? <div className="ai-chat__stopped">{t('aiChat.stoppedNote')}</div> : null}
        {segments.map((segment, i) =>
          segment.kind === 'text' ? (
            <span key={i} className="ai-chat__bubble-text">
              {segment.value}
            </span>
          ) : (
            (() => {
              const ref = refByN.get(segment.n);
              if (ref === undefined) {
                return (
                  <span key={i} className="ai-chat__bubble-text">{`⟦#${String(segment.n)}⟧`}</span>
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  className="ai-chat__ref"
                  title={t('aiChat.refAria')}
                  onClick={() => {
                    requestBlockJump(ref.pageId, ref.blockId);
                  }}
                >
                  {chatRefLabel(ref)}
                </button>
              );
            })()
          ),
        )}
        {notice === null ? null : (
          <div className="ai-chat__reply-notice" role="note">
            {notice}
          </div>
        )}
        {lengthNotice === null ? null : (
          <div className="ai-chat__reply-notice" role="note">
            {lengthNotice}
          </div>
        )}
        {reasoning === null ? null : <ReasoningDisclosure text={reasoning} />}
      </div>
    </div>
  );
}

/** 推理正文折叠区（默认收起；按钮 aria-expanded 暴露展开态，键盘可达）。 */
function ReasoningDisclosure({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-chat__reasoning">
      <button
        type="button"
        className="ai-chat__reasoning-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        {open
          ? t('aiChat.reasoningHide')
          : t('aiChat.reasoningShow').replace('{n}', String(text.length))}
      </button>
      {open ? <pre className="ai-chat__reasoning-body">{text}</pre> : null}
    </div>
  );
}

// pagesStore 订阅由宿主（App）负责；本组件只读 chat store。
