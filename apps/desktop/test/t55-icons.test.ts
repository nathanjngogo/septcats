/**
 * t55-icons.test.ts —— TASK-T55-02 图标接线单测（§1②③④⑤）。
 *
 * 两条线：
 * 1) **查找序列纯函数**（`src/main/iconAssets.ts`）：`icon-tray.png` 恒优先于 `icon.ico`、
 *    空/缺省基目录被跳过、全无回落 null；并用真实 `existsSync` 对 dev 盘做一次端到端解析
 *    （托盘 → `build/icon-tray.png`、窗口 → `build/icon.png`）。
 * 2) **icon.ico 五层回读**（`src/main/pixelIco.ts` 读 `apps/desktop/build/icon.ico`）：
 *    层数 = 5、尺寸序列 = [16, 24, 32, 48, 256]、每层 PNG 表项（8 字节签名 + IHDR 宽与
 *    目录声明一致）、256 层逐字节等于 `build/icon.png`（C 全细节）、16 层逐字节等于
 *    `build/icon-tray.png`（T 简化子型）——把 `scripts/build-pixel-ico.mjs` 的产出契约钉住。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  iconCandidatePaths,
  pickFirstExisting,
  TRAY_ICON_NAMES,
  WINDOW_ICON_NAMES,
} from '../src/main/iconAssets';
import { PNG_SIGNATURE, readIco, readPngIhdrWidth, type IcoDirEntry } from '../src/main/pixelIco';

const here = dirname(fileURLToPath(import.meta.url));
/** apps/desktop（dev 运行时 `app.getAppPath()` 的等价物）。 */
const APPDIR = join(here, '..');
const BUILD_DIR = join(APPDIR, 'build');
const toSlash = (path: string): string => path.split('\\').join('/');
/** 固定拼接器：断言候选数组字面形态，避免受平台分隔符影响。 */
const joinForTest = (left: string, right: string): string => `${left}/${right}`;

function layerOf(ico: { entries: IcoDirEntry[] }, width: number): IcoDirEntry {
  const hit = ico.entries.find((entry) => entry.width === width);
  if (hit === undefined) {
    throw new Error(`icon.ico 内无 ${String(width)}px 层（实际 ${ico.entries.map((e) => e.width).join('/')}）`);
  }
  return hit;
}

describe('T55-02 托盘/窗口图标查找序列（iconAssets 纯函数）', () => {
  it('名字优先于基目录：三个基目录的 icon-tray.png 候选全部排在 icon.ico 之前', () => {
    const candidates = iconCandidatePaths(
      TRAY_ICON_NAMES,
      ['RES', 'APP', 'DEV'],
      joinForTest,
    );
    expect(candidates).toEqual([
      'RES/build/icon-tray.png',
      'APP/build/icon-tray.png',
      'DEV/build/icon-tray.png',
      'RES/build/icon.ico',
      'APP/build/icon.ico',
      'DEV/build/icon.ico',
    ]);
  });

  it('空/缺省基目录被跳过：未打包态 resourcesPath 缺失不产生空串候选', () => {
    const candidates = iconCandidatePaths(TRAY_ICON_NAMES, [null, 'APP', ''], joinForTest);
    expect(candidates).toEqual([
      'APP/build/icon-tray.png',
      'APP/build/icon.ico',
    ]);
    expect(candidates.some((candidate) => candidate.includes('//') || candidate.startsWith('build/'))).toBe(false);
  });

  it('pickFirstExisting：命中首个存在项（新图优先，旧 ico 不作数）', () => {
    const candidates = ['A/build/icon-tray.png', 'B/build/icon-tray.png', 'A/build/icon.ico'];
    const seen: string[] = [];
    const hit = pickFirstExisting(candidates, (candidate) => {
      seen.push(candidate);
      return candidate === 'B/build/icon-tray.png' || candidate === 'A/build/icon.ico';
    });
    expect(hit).toBe('B/build/icon-tray.png');
    expect(seen).toEqual(['A/build/icon-tray.png', 'B/build/icon-tray.png']);
  });

  it('pickFirstExisting：全不存在 → null（调用方回落空图/默认图标，不抛错）', () => {
    expect(pickFirstExisting(['A/build/icon-tray.png'], () => false)).toBeNull();
    expect(pickFirstExisting([], () => true)).toBeNull();
  });

  it('名表口径：托盘首位 = icon-tray.png、窗口 = icon.png（换图硬约束）', () => {
    expect(TRAY_ICON_NAMES[0]).toBe('icon-tray.png');
    expect(TRAY_ICON_NAMES).toContain('icon.ico');
    expect(WINDOW_ICON_NAMES).toEqual(['icon.png']);
  });

  it('真机同款解析（真实 existsSync + dev 基目录）：托盘命中 icon-tray.png、窗口命中 icon.png', () => {
    const devDirs = [null, APPDIR, join(here, '..')];
    const trayPath = pickFirstExisting(iconCandidatePaths(TRAY_ICON_NAMES, devDirs, join), existsSync);
    const windowPath = pickFirstExisting(iconCandidatePaths(WINDOW_ICON_NAMES, devDirs, join), existsSync);
    expect(trayPath === null ? null : toSlash(trayPath).endsWith('/build/icon-tray.png')).toBe(true);
    expect(windowPath === null ? null : toSlash(windowPath).endsWith('/build/icon.png')).toBe(true);
  });
});

describe('T55-02 icon.ico 五层回读（build-pixel-ico.mjs 产出契约）', () => {
  const icoBuffer = readFileSync(join(BUILD_DIR, 'icon.ico'));
  const ico = readIco(icoBuffer);

  it('目录层数 = 5，尺寸序列 = [16, 24, 32, 48, 256]', () => {
    expect(ico.count).toBe(5);
    expect(ico.entries.map((entry) => entry.width)).toEqual([16, 24, 32, 48, 256]);
    expect(ico.entries.map((entry) => entry.height)).toEqual([16, 24, 32, 48, 256]);
    expect(ico.entries.every((entry) => entry.bitCount === 32)).toBe(true);
  });

  it('每层都是 PNG 表项：8 字节签名齐、IHDR 宽 = 目录声明宽', () => {
    expect(PNG_SIGNATURE).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(ico.entries.every((entry) => entry.isPng)).toBe(true);
    for (const entry of ico.entries) {
      expect(entry.ihdrWidth).toBe(entry.width);
      // IHDR 真宽独立复算一遍（不信目录表那一字节）
      expect(readPngIhdrWidth(icoBuffer, entry.byteOffset)).toBe(entry.width);
    }
  });

  it('层数据首尾相接且不越界：Σ byteLength + 表头 = 文件长度', () => {
    const tableBytes = 6 + 16 * ico.count;
    const dataBytes = ico.entries.reduce((sum, entry) => sum + entry.byteLength, 0);
    expect(tableBytes + dataBytes).toBe(icoBuffer.length);
    expect(ico.entries[0]?.byteOffset).toBe(tableBytes);
    for (let index = 1; index < ico.entries.length; index += 1) {
      const prev = ico.entries[index - 1];
      const current = ico.entries[index];
      expect(current?.byteOffset).toBe((prev?.byteOffset ?? 0) + (prev?.byteLength ?? 0));
    }
  });

  it('小尺寸层 = 托盘 T 子型、256 层 = C 全细节（与 build/ 同名 PNG 逐字节同源）', () => {
    const trayBytes = readFileSync(join(BUILD_DIR, 'icon-tray.png'));
    const tray2xBytes = readFileSync(join(BUILD_DIR, 'icon-tray@2x.png'));
    const windowBytes = readFileSync(join(BUILD_DIR, 'icon.png'));
    const layerBytes = (width: number): Buffer => {
      const entry = layerOf(ico, width);
      return icoBuffer.subarray(entry.byteOffset, entry.byteOffset + entry.byteLength);
    };
    expect(layerBytes(16).equals(trayBytes)).toBe(true);
    expect(layerBytes(32).equals(tray2xBytes)).toBe(true);
    expect(layerBytes(256).equals(windowBytes)).toBe(true);
    expect(layerBytes(16).equals(layerBytes(256))).toBe(false);
  });

  it('畸形输入抛错（解析器非空转）：截断头 / 类型非图标 / 层数据越界', () => {
    expect(() => readIco(Buffer.alloc(4))).toThrow(/ICO 解析失败/);
    const wrongType = Buffer.from(icoBuffer.subarray(0, 32));
    wrongType.writeUInt16LE(2, 2);
    expect(() => readIco(wrongType)).toThrow(/图像类型非 1/);
    const truncated = Buffer.from(icoBuffer.subarray(0, 6 + 16 * 5 + 3));
    expect(() => readIco(truncated)).toThrow(/越界/);
    expect(readPngIhdrWidth(Buffer.alloc(0), 0)).toBeNull();
  });
});
