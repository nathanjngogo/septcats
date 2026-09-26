/*
 * T83-01 · ensure-abi.mjs 加固测试（纯函数 + 临时夹具，不在测试里真跑 ABI 切换）。
 * 钉死四条硬不变量：①销毁前必先备份且回填字节一致 ②URL/路径推导确定性
 * ③electron 在位判定=标记+存在性（node 进程不验证 electron ABI） ④备份无残留不吞文件。
 */
import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupBinary,
  bs3Version,
  buildPrebuildUrl,
  findBs3Bin,
  restoreBackup,
} from '../scripts/ensure-abi.mjs';

function tempDir(prefix = 'abi-test-') { return mkdtempSync(join(tmpdir(), prefix)); }

describe('T83-01 备份/回填（硬不变量：重建失败后二进制绝不丢失）', () => {
  it('备份字节与原文件一致；回填后与原件逐字节相等', () => {
    const dir = tempDir();
    const bin = join(dir, 'better_sqlite3.node');
    const payload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]);
    writeFileSync(bin, payload);
    const bak = backupBinary(bin, join(dir, 'safe'));
    expect(bak).not.toBeNull();
    expect(readFileSync(bak)).toEqual(payload);
    // 模拟 pnpm rebuild 失败摧毁 build/Release：
    rmSync(bin);
    expect(existsSync(bin)).toBe(false);
    const restored = restoreBackup(bin, bak);
    expect(restored).toBe(true);
    expect(readFileSync(bin)).toEqual(payload); // 逐字节回填
    expect(existsSync(bak)).toBe(false); // 回填后不留孤儿备份
    rmSync(dir, { recursive: true, force: true });
  });

  it('备份发生在摧毁之前：rebuild 中途失败（原文件已没）仍能还原', () => {
    const dir = tempDir();
    const bin = join(dir, 'better_sqlite3.node');
    writeFileSync(bin, Buffer.from('ORIGINAL-ABI-BYTES'));
    const bak = backupBinary(bin, join(dir, 'safe'));
    rmSync(bin); // 摧毁发生
    expect(restoreBackup(bin, bak)).toBe(true);
    expect(readFileSync(bin, 'utf8')).toBe('ORIGINAL-ABI-BYTES');
    rmSync(dir, { recursive: true, force: true });
  });

  it('无文件=无需备份（backupBinary 返回 null），回填 null 为 false 且不动目标', () => {
    const dir = tempDir();
    const missing = join(dir, 'nope.node');
    expect(backupBinary(missing)).toBeNull();
    expect(restoreBackup(missing, null)).toBe(false);
    expect(existsSync(missing)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('备份不会被重建摧毁：build/Release 整体消失后备份仍在、能落回', () => {
    const dir = tempDir();
    const nested = join(dir, 'build', 'Release', 'better_sqlite3.node');
    mkdirSync(join(dir, 'build', 'Release'), { recursive: true });
    writeFileSync(nested, Buffer.from('NESTED'));
    const bak = backupBinary(nested, join(dir, 'safe')); // 备份放独立目录（=脚本里的 .abi-cache）
    rmSync(join(dir, 'build'), { recursive: true, force: true }); // 整个 build/ 没
    expect(existsSync(bak)).toBe(true); // 备份幸存
    expect(restoreBackup(nested, bak)).toBe(true);
    expect(readFileSync(nested, 'utf8')).toBe('NESTED');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('T83-01 URL/定位推导（确定性，不依赖网络）', () => {
  it('buildPrebuildUrl 与 09-25 实下载 URL 逐字一致', () => {
    expect(buildPrebuildUrl({ version: '12.11.1', nodeAbi: 127, platform: 'win32', arch: 'x64' }))
      .toBe('https://registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz');
  });

  it('bs3Version 从安装树读出真实版本；垃圾路径退到 fallback', () => {
    const found = findBs3Bin();
    expect(found).not.toBeNull();
    expect(bs3Version(found)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bs3Version(join(tmpdir(), 'ghost', 'build', 'Release', 'x.node'), '9.9.9')).toBe('9.9.9');
  });

  it('findBs3Bin 在本仓 pnpm 布局下能定位到 build/Release/better_sqlite3.node', () => {
    const found = findBs3Bin();
    expect(found).not.toBeNull();
    expect(found!.replaceAll('\\', '/')).toMatch(/better-sqlite3\/build\/Release\/better_sqlite3\.node$/);
    expect(existsSync(found!)).toBe(true);
  });
});
