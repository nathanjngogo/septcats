/**
 * shared/settings.ts —— settings/diag 的线上契约（TASK-T10-01 §1/§4）。
 *
 * 纯协议层：只描述形状，不 import electron / node / @septcats/platform。
 * main（zod 校验后的产出）、preload、renderer（设置页/诊断面板）三侧共用。
 * 类型与 @septcats/platform 的 `appSettingsSchema` 一一对应，由 main 侧
 * `settings:get/patch` 的返回类型在编译期保证不漂移。
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export type Locale = 'zh-CN' | 'en-US';

export type EditMode = 'rich' | 'markdown';

export interface AppSettings {
  theme: ThemeMode;
  locale: Locale;
  privacy: {
    /** 一期恒 false（无遥测），占位表达承诺。 */
    telemetry: false;
    /** 打字时禁外链预览。 */
    linkPreviewOnType: boolean;
  };
  editor: {
    defaultEditMode: EditMode;
    spellcheck: boolean;
  };
  data: {
    /** 同步文件夹路径（仅展示不可改，改路径归 M8b）。 */
    note: string;
  };
}

/**
 * settings:patch 的入参（深 partial：顶层与 privacy/editor/data 均可缺省）。
 * `privacy.telemetry` 类型为 false（renderer 无法在类型层面发 true，main 侧 zod 再兜底）。
 */
export type AppSettingsPatch = {
  theme?: ThemeMode;
  locale?: Locale;
  privacy?: Partial<AppSettings['privacy']>;
  editor?: Partial<AppSettings['editor']>;
  data?: Partial<AppSettings['data']>;
};

/** diag:export 的返回：最终落盘路径 + 脱敏预览文本（JSON 字符串）。 */
export interface DiagExportResult {
  path: string;
  preview: string;
}

/** diag:confirm 的返回：实际写入的文件路径。 */
export interface DiagConfirmResult {
  path: string;
}
