/**
 * manualContent.ts —— 说明书正文的构建期内联通道（TASK-T56-01 §1②）。
 *
 * 两份 Markdown 由 PM 定稿在 docs/manual/（内容零改动）。这里用 Vite `?raw` 把
 * 文件内容作为字符串打进 renderer bundle：**运行时零 fs 读取、零网络请求**，
 * 与「本地优先、永不上传」的隐私口径一致。
 *
 * 路径相对本文件（apps/desktop/src/renderer/src/manual → 仓库根 docs/manual）。
 */
import enRaw from '../../../../../../docs/manual/manual.en.md?raw';
import zhRaw from '../../../../../../docs/manual/manual.zh.md?raw';
import type { Locale } from '../i18n';

export const MANUAL_SOURCES: Record<Locale, string> = {
  'zh-CN': zhRaw,
  'en-US': enRaw,
};
