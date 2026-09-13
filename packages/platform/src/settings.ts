import {
  promises as fs,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import {
  ensureDirs,
  isAbsolutePath,
  layoutFromRoot,
  resolveLayout,
  type PathLayout,
} from './layout';

/**
 * 数据根设置与迁移（任务书 §5）。
 *
 * - 设置文件固定在 Electron userData 下的 `septcats.settings.json`；
 * - `bootstrapPaths` 读设置 → 解析布局 → 建目录；
 * - `migrateRootPath` 换数据根：复制 db + attachments/** + settings.json，
 *   写 `.septcats-root` marker，最后更新设置；中途失败回滚已复制的新文件，
 *   settings 不更新，旧目录保守不删。
 */

// ---------------------------------------------------------------------------
// 应用配置（TASK-T10-01 §1：在既有 settings.json 上扩展，单一读写口）
// ---------------------------------------------------------------------------

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof LOCALES)[number];

export const EDIT_MODES = ['rich', 'markdown'] as const;
export type EditMode = (typeof EDIT_MODES)[number];

/**
 * 应用配置的严格校验 schema（desktop main 的 `settings:patch` 用它全量再校验，
 * 不信任 renderer）。theme/locale/defaultEditMode 用 enum 收口；`privacy.telemetry`
 * 用 literal(false) 表达「一期恒 false、占位承诺」；`data.note` 为同步文件夹路径
 * （仅展示不可改，改路径归 M8b）。
 */
export const appSettingsSchema = z.object({
  theme: z.enum(THEME_MODES),
  locale: z.enum(LOCALES),
  privacy: z.object({
    telemetry: z.literal(false),
    linkPreviewOnType: z.boolean(),
  }),
  editor: z.object({
    defaultEditMode: z.enum(EDIT_MODES),
    spellcheck: z.boolean(),
  }),
  data: z.object({
    note: z.string(),
  }),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

/** 应用配置默认值（读缺失/损坏、写合并时共用；深拷贝后再返回，避免共享引用）。 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  data: { note: '' },
};

export interface SeptcatsSettings extends AppSettings {
  /** 用户自定义数据根（绝对路径）。 */
  rootPath?: string;
  /** 设置 schema 版本，当前恒为 1。 */
  schema: 1;
}

/** 写入口接受的局部配置：rootPath 与 app settings 均可缺省（缺省 = 保持现状/清除 rootPath）。 */
export type SeptcatsSettingsPatch = Partial<AppSettings> & { rootPath?: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneDefaultAppSettings(): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    privacy: { ...DEFAULT_APP_SETTINGS.privacy },
    editor: { ...DEFAULT_APP_SETTINGS.editor },
    data: { ...DEFAULT_APP_SETTINGS.data },
  };
}

/** 组装 SeptcatsSettings（exactOptionalPropertyTypes 下 rootPath 只在有值时出现）。 */
function composeSettings(rootPath: string | undefined, app: AppSettings): SeptcatsSettings {
  return rootPath === undefined ? { schema: 1, ...app } : { schema: 1, rootPath, ...app };
}

function warnSettingsCorrupted(): void {
  console.warn('[septcats] settings.json 损坏或含非法值，已回退默认设置');
}

/** 合并局部 patch 并用严格 schema 校验；非法值抛 E_SETTINGS_INVALID。 */
export function mergeSettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  const src = isPlainObject(patch) ? patch : {};
  const merged: Record<string, unknown> = {
    theme: src['theme'] ?? current.theme,
    locale: src['locale'] ?? current.locale,
    privacy: isPlainObject(src['privacy'])
      ? { ...current.privacy, ...src['privacy'] }
      : { ...current.privacy },
    editor: isPlainObject(src['editor'])
      ? { ...current.editor, ...src['editor'] }
      : { ...current.editor },
    data: isPlainObject(src['data']) ? { ...current.data, ...src['data'] } : { ...current.data },
  };
  const result = appSettingsSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`E_SETTINGS_INVALID：${issues}`);
  }
  return result.data;
}

export interface BootstrapPathsOptions {
  appName: string;
  /** Electron `app.getPath('userData')`。 */
  electronUserData: string;
  /** Electron `app.getPath('home')`。 */
  homeDir: string;
  platform: NodeJS.Platform;
}

export interface MigrateOptions {
  /** 可注入的单文件复制实现（测试用：按次数注入失败）。 */
  copyFile?: (from: string, to: string) => Promise<void>;
  /** Electron userData 目录；提供时才更新设置、并快照 settings.json 到新根。 */
  userDataDir?: string;
}

const SETTINGS_FILE_NAME = 'septcats.settings.json';
const ROOT_MARKER_FILE = '.septcats-root';

function settingsFilePath(userDataDir: string): string {
  return join(userDataDir, SETTINGS_FILE_NAME);
}

/** 读设置；文件缺失静默退默认值，损坏/非法值回退默认值并 console.warn，永不抛。 */
export function readSettings(userDataDir: string): SeptcatsSettings {
  let raw: string;
  try {
    raw = readFileSync(settingsFilePath(userDataDir), 'utf8');
  } catch {
    return composeSettings(undefined, cloneDefaultAppSettings());
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnSettingsCorrupted();
    return composeSettings(undefined, cloneDefaultAppSettings());
  }

  if (!isPlainObject(parsed)) {
    warnSettingsCorrupted();
    return composeSettings(undefined, cloneDefaultAppSettings());
  }

  const rootPath =
    typeof parsed['rootPath'] === 'string' && parsed['rootPath'].length > 0
      ? parsed['rootPath']
      : undefined;

  const app = parseAppSettings(parsed);
  if (app === null) {
    warnSettingsCorrupted();
    return composeSettings(rootPath, cloneDefaultAppSettings());
  }

  return composeSettings(rootPath, app);
}

/** 解析 app settings：缺失字段填默认，非法值（如 theme:'neon'）整体判 null（回退默认）。 */
function parseAppSettings(raw: Record<string, unknown>): AppSettings | null {
  const merged: Record<string, unknown> = {
    theme: raw['theme'] ?? DEFAULT_APP_SETTINGS.theme,
    locale: raw['locale'] ?? DEFAULT_APP_SETTINGS.locale,
    privacy: isPlainObject(raw['privacy'])
      ? { ...DEFAULT_APP_SETTINGS.privacy, ...raw['privacy'] }
      : { ...DEFAULT_APP_SETTINGS.privacy },
    editor: isPlainObject(raw['editor'])
      ? { ...DEFAULT_APP_SETTINGS.editor, ...raw['editor'] }
      : { ...DEFAULT_APP_SETTINGS.editor },
    data: isPlainObject(raw['data'])
      ? { ...DEFAULT_APP_SETTINGS.data, ...raw['data'] }
      : { ...DEFAULT_APP_SETTINGS.data },
  };
  const result = appSettingsSchema.safeParse(merged);
  return result.success ? result.data : null;
}

/**
 * 原子写设置：写 tmp → rename（同目录 rename 保证不出现半截文件）。
 * rootPath 为 replace 语义（undefined/'' = 清除）；app settings 为 merge 语义（缺省保持现状）。
 * 合并结果经严格 schema 校验，非法值抛 E_SETTINGS_INVALID。
 */
export function writeSettings(userDataDir: string, patch: SeptcatsSettingsPatch): void {
  const current = readSettings(userDataDir);

  const rootPath =
    patch.rootPath !== undefined && patch.rootPath.length > 0 ? patch.rootPath : undefined;

  const merged = mergeSettingsPatch(
    { ...current, privacy: current.privacy, editor: current.editor, data: current.data },
    patch,
  );

  const payload = composeSettings(rootPath, merged);
  const target = settingsFilePath(userDataDir);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, target);
}

/** 读取设置里的数据根（仅当它是合法绝对路径时采用），再解析布局并建目录。 */
export async function bootstrapPaths(opts: BootstrapPathsOptions): Promise<PathLayout> {
  const settings = readSettings(opts.electronUserData);
  const overrideRoot = settings.rootPath;
  const layout =
    overrideRoot !== undefined && isAbsolutePath(overrideRoot, opts.platform)
      ? resolveLayout({
          appName: opts.appName,
          overrideRoot,
          homeDir: opts.homeDir,
          platform: opts.platform,
        })
      : resolveLayout({ appName: opts.appName, homeDir: opts.homeDir, platform: opts.platform });
  await ensureDirs(layout);
  return layout;
}

/** 单文件复制：读 → 写 tmp → fsync → rename（先落盘再改名，避免半截文件）。 */
export async function copyFileAtomic(from: string, to: string): Promise<void> {
  const data = await fs.readFile(from);
  await fs.mkdir(dirname(to), { recursive: true });
  const tmp = `${to}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.write(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, to);
}

async function writeFileAtomic(target: string, content: string): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, target);
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of sorted) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

interface CopyEntry {
  from: string;
  to: string;
}

/** 复制清单：db → attachments/**（字典序）→ settings.json 快照。 */
async function planCopies(
  layout: PathLayout,
  newLayout: PathLayout,
  userDataDir?: string,
): Promise<CopyEntry[]> {
  const entries: CopyEntry[] = [];
  if (existsSync(layout.db)) {
    entries.push({ from: layout.db, to: newLayout.db });
  }
  for (const file of await listFilesRecursive(layout.attachments)) {
    entries.push({ from: file, to: join(newLayout.attachments, relative(layout.attachments, file)) });
  }
  if (userDataDir !== undefined) {
    const settingsFile = settingsFilePath(userDataDir);
    if (existsSync(settingsFile)) {
      entries.push({ from: settingsFile, to: join(newLayout.root, SETTINGS_FILE_NAME) });
    }
  }
  return entries;
}

/**
 * 迁移数据根到 `toDir`。
 * 1) 校验 toDir 绝对且是已存在目录；2) 复制 db + attachments/** + settings.json；
 * 3) 新布局 ensureDirs；4) 写 `.septcats-root` marker；5) 更新 userDataDir 设置；
 * 6) 旧目录不删。中途失败：删除本次新建的目标文件，settings 保持原样。
 */
export async function migrateRootPath(
  layout: PathLayout,
  toDir: string,
  opts: MigrateOptions = {},
): Promise<PathLayout> {
  if (!isAbsolute(toDir)) {
    throw new Error(`E_MIGRATE_TARGET_NOT_ABSOLUTE：toDir 必须是绝对路径：'${toDir}'`);
  }
  const targetStats = await fs.stat(toDir);
  if (!targetStats.isDirectory()) {
    throw new Error(`E_MIGRATE_TARGET_NOT_DIR：toDir 不是目录：'${toDir}'`);
  }

  const newLayout = layoutFromRoot(toDir);
  const copy = opts.copyFile ?? copyFileAtomic;
  const entries = await planCopies(layout, newLayout, opts.userDataDir);
  const created: string[] = [];

  try {
    for (const entry of entries) {
      const preexisting = existsSync(entry.to);
      await copy(entry.from, entry.to);
      if (!preexisting) {
        created.push(entry.to);
      }
    }

    await ensureDirs(newLayout);
    const markerPath = join(newLayout.root, ROOT_MARKER_FILE);
    const markerPreexisting = existsSync(markerPath);
    const marker = { migratedAt: new Date().toISOString(), from: layout.root };
    await writeFileAtomic(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    if (!markerPreexisting) {
      created.push(markerPath);
    }

    if (opts.userDataDir !== undefined) {
      writeSettings(opts.userDataDir, { rootPath: newLayout.root });
    }
    return newLayout;
  } catch (error) {
    for (const file of created.reverse()) {
      try {
        await fs.unlink(file);
      } catch {
        // 回滚尽力而为，不掩盖原始错误
      }
    }
    throw error;
  }
}
