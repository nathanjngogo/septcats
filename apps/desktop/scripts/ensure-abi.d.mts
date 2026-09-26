/**
 * ensure-abi.mjs 的类型声明（T83-01 测试从 ESM .mjs 导入纯函数用）。
 * CLI 本体见 scripts/ensure-abi.mjs。
 */

export declare function findBs3Bin(cwdPkgDir?: string): string | null;

export declare function bs3Version(binPath: string, fallback?: string): string;

export declare function buildPrebuildUrl(opts: {
  version: string;
  nodeAbi: number;
  platform?: string;
  arch?: string;
}): string;

export declare function backupBinary(binPath: string | null, bakDir?: string): string | null;

export declare function restoreBackup(binPath: string, bak: string | null): boolean;

export declare function inPlace(target: 'node' | 'electron', binPath: string | null): boolean;

export declare function main(target: 'node' | 'electron'): Promise<number>;
