/**
 * shared/settings.ts —— settings/diag 的线上契约（TASK-T10-01 §1/§4）。
 *
 * 纯协议层：只描述形状，不 import electron / node / @septcats/platform。
 * main（zod 校验后的产出）、preload、renderer（设置页/诊断面板）三侧共用。
 * 类型与 @septcats/platform 的 `appSettingsSchema` 一一对应，由 main 侧
 * `settings:get/patch` 的返回类型在编译期保证不漂移。
 */

import type { AiProviderConfig } from './ai';

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
  /** 同步运行时开关（M8b · TASK-T13-01）：enabled/encrypt/gc，默认 true/false/false。 */
  sync: {
    enabled: boolean;
    encrypt: boolean;
    gc: boolean;
  };
  /**
   * AI（M11 · TASK-T18-01 §2.2）：enabled/cloudConsent 默认全关（云端调用需显式同意）；
   * API key 不在此处（存 CredentialStore），providers 数组整体替换语义。
   */
  ai: {
    /** 总开关（默认 false；关 = 所有 ai:* 通道拒绝）。 */
    enabled: boolean;
    /** 云端调用显式开关（默认 false；非本地端点无它一律拒绝且不发请求）。 */
    cloudConsent: boolean;
    /** 活动 provider（UI 选区；null = 未选）。 */
    activeProviderId: string | null;
    providers: AiProviderConfig[];
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
  sync?: Partial<AppSettings['sync']>;
  ai?: Partial<AppSettings['ai']>;
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
