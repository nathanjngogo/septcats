import { promises as fs } from 'node:fs';
import { join, normalize } from 'node:path';

/**
 * 路径布局（任务书 §2）。
 *
 * 一切“数据根 / 数据库 / 附件 / 日志 / 临时 / 崩溃转储”的位置都在这里一次算清；
 * 调用方只拿结果，不再自己拼路径（desktop/src 里也不允许再自拼 `~` 或读家目录环境变量）。
 * 输出的全部是 `path.normalize` 后的**平台原生路径**（Windows 反斜杠 / POSIX 斜杠），
 * 需要跨进程传输时由调用方自行转换成 POSIX 风格，本模块不混用。
 */

export interface PathLayout {
  /** 数据根目录（默认 `<home>/.septcats`，可被用户设置覆盖）。 */
  root: string;
  /** SQLite 主库文件。 */
  db: string;
  /** 附件目录。 */
  attachments: string;
  /** 分模块日志目录。 */
  logs: string;
  /** 临时目录。 */
  tmp: string;
  /** 崩溃转储目录。 */
  crashDumps: string;
}

export interface ResolveLayoutOptions {
  /** 应用名；默认根目录取 `.${appName.toLowerCase()}`。 */
  appName: string;
  /** 用户自定义数据根（必须绝对路径）；存在时直接作为 root。 */
  overrideRoot?: string;
  /** 家目录（由 Electron 的 app.getPath('home') 注入，本包不自取）。 */
  homeDir: string;
  /** 目标平台，用于绝对路径判定（Windows 允许盘符/UNC）。 */
  platform: NodeJS.Platform;
}

/** 按平台判定绝对路径：win32 认盘符或 UNC，其余只认前导 `/`。 */
export function isAbsolutePath(target: string, platform: NodeJS.Platform): boolean {
  if (target.length === 0) {
    return false;
  }
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\');
  }
  return target.startsWith('/');
}

/** 由数据根推导出完整布局；`resolveLayout` 与迁移逻辑共用，保证只有一处拼接规则。 */
export function layoutFromRoot(root: string): PathLayout {
  const normalizedRoot = normalize(root);
  return {
    root: normalizedRoot,
    db: normalize(join(normalizedRoot, 'septcats.db')),
    attachments: normalize(join(normalizedRoot, 'attachments')),
    logs: normalize(join(normalizedRoot, 'logs')),
    tmp: normalize(join(normalizedRoot, 'tmp')),
    crashDumps: normalize(join(normalizedRoot, 'crashDumps')),
  };
}

/**
 * 解析数据根并派生出完整布局。
 * - 默认 `root = join(homeDir, '.' + appName.toLowerCase())`
 * - `overrideRoot` 存在时 `root = overrideRoot`（非绝对路径直接 throw）
 */
export function resolveLayout(opts: ResolveLayoutOptions): PathLayout {
  const { appName, overrideRoot, homeDir, platform } = opts;

  if (appName.length === 0) {
    throw new Error('E_LAYOUT_APP_NAME：appName 不能为空');
  }

  if (overrideRoot !== undefined) {
    if (!isAbsolutePath(overrideRoot, platform)) {
      throw new Error(`E_LAYOUT_ROOT_NOT_ABSOLUTE：overrideRoot 必须是绝对路径：'${overrideRoot}'`);
    }
    return layoutFromRoot(overrideRoot);
  }

  if (!isAbsolutePath(homeDir, platform)) {
    throw new Error(`E_LAYOUT_HOME_NOT_ABSOLUTE：homeDir 必须是绝对路径：'${homeDir}'`);
  }
  return layoutFromRoot(join(homeDir, `.${appName.toLowerCase()}`));
}

/** 幂等递归建目录：root / attachments / logs / tmp / crashDumps（db 是文件，父目录即 root）。 */
export async function ensureDirs(layout: PathLayout): Promise<void> {
  const dirs = new Set<string>([
    layout.root,
    layout.attachments,
    layout.logs,
    layout.tmp,
    layout.crashDumps,
  ]);
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * 粗略估算目录所在卷的可用字节数（跨平台：node:fs.promises.statfs，Node 18.15+/22 可用）。
 * 不做精确配额，只用于“磁盘快满”提示。
 */
export async function estimateFreeBytes(dirPath: string): Promise<number> {
  const stats = await fs.statfs(dirPath);
  return stats.bavail * stats.bsize;
}
