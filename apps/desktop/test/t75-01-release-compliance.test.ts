/**
 * t75-01-release-compliance.test.ts —— 发布合规面（TASK-T75-01）静态钉。
 *
 * 覆盖三条 DoD 的「配置/资产」侧（UI 侧见 settings-react.test.tsx）：
 *  ① electron-builder.yml 增 licenses extraResources（from: resources/licenses → to: licenses）；
 *  ② electron-builder.yml 顶层 compression: maximum（schema 证实非 nsis 段）；
 *  ③ 根与 apps/desktop 两份 package.json 声明 license: UNLICENSED；
 *  ④ OFL 正本（PM 落盘，禁改）字节指纹钉：4388 B / sha256 固定 / 无 BOM / 纯 LF。
 */
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname; // apps/desktop/test
const desktopRoot = join(here, '..');
const repoRoot = join(desktopRoot, '..', '..');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('发布合规配置（TASK-T75-01）', () => {
  it('electron-builder.yml：licenses extraResources 段（映射到 resources/ 外置位）', () => {
    const yml = read(join(desktopRoot, 'electron-builder.yml'));
    expect(yml).toContain('from: resources/licenses');
    expect(yml).toContain('to: licenses');
  });

  it('electron-builder.yml：compression: maximum 落顶层（NsisOptions 无此键）', () => {
    const yml = read(join(desktopRoot, 'electron-builder.yml'));
    expect(yml).toMatch(/^compression:\s*maximum\s*$/m);
  });

  it('两份 package.json 均声明 license: UNLICENSED（私仓诚实声明）', () => {
    const root = JSON.parse(read(join(repoRoot, 'package.json'))) as { license?: string };
    const desktop = JSON.parse(read(join(desktopRoot, 'package.json'))) as { license?: string };
    expect(root.license).toBe('UNLICENSED');
    expect(desktop.license).toBe('UNLICENSED');
  });

  it('OFL 正本字节指纹：4388 B / sha256 固定 / 无 BOM / 纯 LF（禁改）', () => {
    const path = join(desktopRoot, 'resources', 'licenses', 'OFL-NotoSansSC.txt');
    const bytes = readFileSync(path);
    expect(statSync(path).size).toBe(4388);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9',
    );
    expect(bytes[0]).not.toBe(0xef); // 无 UTF-8 BOM（首字节为 'C'）
    expect(bytes.includes(0x0d)).toBe(false); // 无 CR（纯 LF）
    expect(bytes.toString('utf8')).toContain('SIL OPEN FONT LICENSE');
  });
});
