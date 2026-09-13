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

export interface SeptcatsSettings {
  /** 用户自定义数据根（绝对路径）。 */
  rootPath?: string;
  /** 设置 schema 版本，当前恒为 1。 */
  schema: 1;
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

/** 读设置；文件缺失/损坏一律退化为默认值，永不抛。 */
export function readSettings(userDataDir: string): SeptcatsSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsFilePath(userDataDir), 'utf8'));
    if (parsed === null || typeof parsed !== 'object') {
      return { schema: 1 };
    }
    const rootPath = (parsed as { rootPath?: unknown }).rootPath;
    if (typeof rootPath === 'string' && rootPath.length > 0) {
      return { schema: 1, rootPath };
    }
    return { schema: 1 };
  } catch {
    return { schema: 1 };
  }
}

/** 原子写设置：写 tmp → rename（同目录 rename 保证不出现半截文件）。 */
export function writeSettings(userDataDir: string, s: { rootPath?: string }): void {
  const rootPath = s.rootPath;
  const payload: SeptcatsSettings =
    rootPath !== undefined && rootPath.length > 0 ? { schema: 1, rootPath } : { schema: 1 };
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
