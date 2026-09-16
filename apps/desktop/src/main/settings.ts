/**
 * main/settings.ts —— settings:get / settings:patch 的服务实现（TASK-T10-01 §1）。
 *
 * 纯 Node（不 import electron / ipcMain）：把 @septcats/platform 的 zod 校验结果
 * 转成 shared/settings.ts 的线上契约类型，供 main/index.ts 注册的 handler 直接调用，
 * 也供 test/settings.test.ts 在纯 Node 环境直测。
 *
 * 隐私约定：渲染器只拿到 AppSettings（theme/locale/privacy/editor/data），
 * 其中 `data.note` 由 main 用「同步目录绝对路径」覆盖——路径展示但不可改（改路径归 M8b）。
 */

import { mergeSettingsPatch, readSettings, writeSettings } from '@septcats/platform';
import type { AppSettings } from '../shared/settings';

/** 读设置 → 渲染器面 AppSettings（data.note = 同步目录绝对路径；sync 段透传）。 */
export function readAppSettings(userDataDir: string, syncDir: string): AppSettings {
  const settings = readSettings(userDataDir);
  return {
    theme: settings.theme,
    locale: settings.locale,
    privacy: settings.privacy,
    editor: settings.editor,
    data: { note: syncDir },
    sync: settings.sync,
    ai: settings.ai,
  };
}

/**
 * 合并 partial patch → 严格 schema 校验 → 原子落盘 → 回整份 AppSettings。
 * 非法值（如 theme:'neon'）抛 `E_SETTINGS_INVALID`；`data.note` 一律被 main 覆盖为同步目录。
 */
export function patchAppSettings(
  userDataDir: string,
  syncDir: string,
  patch: unknown,
): AppSettings {
  const current = readSettings(userDataDir);
  const merged = mergeSettingsPatch(current, patch);
  writeSettings(userDataDir, merged);
  return {
    theme: merged.theme,
    locale: merged.locale,
    privacy: merged.privacy,
    editor: merged.editor,
    data: { note: syncDir },
    sync: merged.sync,
    ai: merged.ai,
  };
}
