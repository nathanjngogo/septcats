import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 以「@septcats/ui 的 package.json」为锚，解析包内文件路径。
 *
 * 为什么不用 cwd 相对路径：本包测试既被 `pnpm -C packages/ui test`
 * （cwd=包根）拉起，也被根 vitest.config.ts 的 projects 聚合拉起
 * （cwd=仓库根），cwd 相对路径在后者下会 ENOENT。
 * 为什么不用 import.meta.url：vitest jsdom 环境下 import.meta.url 不是
 * file:// scheme（fileURLToPath 直接抛 "The URL must be of scheme file"）。
 *
 * 查找顺序：从 cwd 起，① 自身是包根则用之；② 自身是 workspace 根
 * （含 pnpm-workspace.yaml）则下钻 packages/ui；否则继续向上。
 */
function isUiPkgRoot(dir: string): boolean {
  const pkgJson = join(dir, 'package.json');
  if (!existsSync(pkgJson)) return false;
  try {
    return (JSON.parse(readFileSync(pkgJson, 'utf8')) as { name?: string }).name === '@septcats/ui';
  } catch {
    return false;
  }
}

function isWorkspaceRoot(dir: string): boolean {
  return existsSync(join(dir, 'pnpm-workspace.yaml'));
}

export function resolvePkgFile(relPath: string): string {
  let dir = process.cwd();
  for (;;) {
    if (isUiPkgRoot(dir)) return join(dir, relPath);
    const nested = join(dir, 'packages', 'ui');
    if (isWorkspaceRoot(dir) && isUiPkgRoot(nested)) return join(nested, relPath);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底：找不到锚点时保持旧行为（cwd 相对），让报错信息可读
  return resolve(process.cwd(), relPath);
}
