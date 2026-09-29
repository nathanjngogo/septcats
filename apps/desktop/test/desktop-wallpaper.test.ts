/**
 * desktop-wallpaper.test.ts —— T90-01B 壁纸衬底 main 侧纯函数（读注册表输出解析、
 * 类型收窄、体积上限、失败全 null）。纯 Node 直测（不 import electron；接线由
 * 真机探针 cdp-e2e-t90-01.mjs 覆盖）。
 */
import { describe, expect, it } from 'vitest';
import { parseWallpaperRegValue, wallpaperMime, wallpaperToDataUrl, WALLPAPER_MAX_BYTES } from '../src/main/desktopWallpaper';

describe('T90-01B parseWallpaperRegValue', () => {
  it('标准 reg 输出取 REG_SZ 值（含空格路径）', () => {
    expect(
      parseWallpaperRegValue('    WallpaperPath    REG_SZ    C:\\Users\\me\\Pictures\\wall paper.jpg\r\n'),
    ).toBe('C:\\Users\\me\\Pictures\\wall paper.jpg');
  });

  it('null / 无 REG_SZ / 空值 → null', () => {
    expect(parseWallpaperRegValue(null)).toBeNull();
    expect(parseWallpaperRegValue('ERROR')).toBeNull();
    expect(parseWallpaperRegValue('Wallpaper    REG_SZ    \r\n')).toBeNull();
  });
});

describe('T90-01B wallpaperMime', () => {
  it('常见壁纸扩展全支持（大小写不敏感）', () => {
    expect(wallpaperMime('C:\\a\\b.JPG')).toBe('image/jpeg');
    expect(wallpaperMime('x.png')).toBe('image/png');
    expect(wallpaperMime('x.bmp')).toBe('image/bmp');
    expect(wallpaperMime('x.jpeg')).toBe('image/jpeg');
    expect(wallpaperMime('x.webp')).toBe('image/webp');
  });

  it('无扩展/未知扩展 → null（不猜类型）', () => {
    expect(wallpaperMime('C:\\a\\wallpaper')).toBeNull();
    expect(wallpaperMime('x.tiff')).toBeNull();
  });
});

describe('T90-01B wallpaperToDataUrl', () => {
  const buf = Buffer.from('fake-image-bytes');
  const read = (_p: string): Buffer => buf;

  it('正常路径 → data URL（MIME 与 base64 内容正确）', () => {
    const url = wallpaperToDataUrl('C:\\wall.jpg', read, buf.length);
    expect(url).toBe(`data:image/jpeg;base64,${buf.toString('base64')}`);
  });

  it('0 字节 / 超上限 / 未知类型 → null', () => {
    expect(wallpaperToDataUrl('C:\\wall.jpg', read, 0)).toBeNull();
    expect(wallpaperToDataUrl('C:\\wall.jpg', read, WALLPAPER_MAX_BYTES + 1)).toBeNull();
    expect(wallpaperToDataUrl('C:\\wall.tiff', read, 10)).toBeNull();
  });

  it('读文件抛错 → null（绝不冒泡炸 IPC）', () => {
    expect(wallpaperToDataUrl('C:\\wall.jpg', () => {
      throw new Error('EPERM');
    }, 10)).toBeNull();
  });
});
