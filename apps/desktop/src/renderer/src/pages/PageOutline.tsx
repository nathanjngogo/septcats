/**
 * PageOutline.tsx —— 页内大纲（创意项 IDEA-C，v1）。
 *
 * 位置：标题行下方一条可折叠「目录 · N」；展开 = 缩进列表（level 1..3 左缩进分档），
 * 点击条目 → 宿主执行与 AI 面板跳转**同一条** jumpToBlockId 通道（滚动定位复用）。
 * 少于 2 个标题**整条不渲染**（一页一标题的短笔记不该多一行噪音）；
 * 数据来自引擎纯函数 collectHeadings（packages/editor/headings.ts，口径可单测），
 * 本组件只画表——跳转语义留在 PageView（锚定位逻辑单一出处）。
 */
import { useState, type ReactNode } from 'react';
import type { HeadingEntry } from '@septcats/editor';
import { t } from '../i18n';
import './PageOutline.css';

interface PageOutlineProps {
  headings: readonly HeadingEntry[];
  onJump: (blockId: string) => void;
}

/** 显示用截断（大纲窄栏，长标题掐尾；CJK 按码点切，不劈半个 emoji）。 */
function clip(text: string): string {
  const chars = [...text];
  return chars.length <= 32 ? text : `${chars.slice(0, 31).join('')}…`;
}

export function PageOutline({ headings, onJump }: PageOutlineProps): ReactNode {
  const [open, setOpen] = useState(false);
  if (headings.length < 2) {
    return null;
  }
  return (
    <div className="pv-outline" data-testid="pv-outline">
      <button
        type="button"
        className="pv-outline-toggle"
        data-testid="pv-outline-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {`${t('editor.outline')} · ${String(headings.length)}`}
      </button>
      {open ? (
        <nav className="pv-outline-list" aria-label={t('editor.outline')} data-testid="pv-outline-list">
          {headings.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`pv-outline-item pv-outline-item--l${String(h.level)}`}
              data-testid={`pv-outline-item-${h.id}`}
              title={h.text}
              onClick={() => {
                onJump(h.id);
              }}
            >
              {clip(h.text)}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
