/**
 * T90-01B 桌面壁纸衬底（main 侧，TASK-T90-01B）。
 *
 * 老板红线：「毛玻璃的通透性也没有，没有跟着背景变色」——要的是透出桌面壁纸。
 * DWM acrylic 路线在本机实测不可达（任务栏材质取色正常，Electron 窗 acrylic/mica
 * × transparent 真假 × Electron 37/38 全死灰；DwmGetUnmetMatchRequirements=0 系统
 * 自评合格，判定为企业版会话/虚拟显示驱动下 Chromium DirectComposition 拿不到
 * 壁纸共享——不再赌 OS 层）。换纯渲染器路线：main 只读壁纸文件交 renderer 铺底，
 * 玻璃面板的半透明 + backdrop-filter 模糊的就是真壁纸像素，任何机器都成立，
 * capturePage/系统截图双通道可客观验收。
 *
 * 隐私红线：壁纸路径与内容一律不落日志、不写盘、不出网；只在 renderer 拉取时
 * 读一次转 data URL。
 */

/** 壁纸上限 8MB：超大原图转 base64 会撑爆 IPC（base64 膨胀 4/3），超限放弃衬底。 */
export const WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * reg.exe 输出解码：先按 UTF-8 解——调用方一律经 `cmd /c chcp 65001` 切码页
 * （09-29 发版前审核 B-1 实证：默认 GBK 码页下 latin1 解码中文壁纸路径会 mojibake
 * → existsSync 必败 → 中文路径用户永远实心，衬底整体失效；chcp 65001 + utf8 解码
 * 对 ASCII/中文路径均无损）。老系统/异常输出回 latin1 兜底（ASCII 无损、绝不抛错）。
 */
export function decodeRegOutput(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

/**
 * 解析 `reg query ... /v WallpaperPath`（或 Wallpaper）输出为路径字符串。
 * reg 输出格式固定 `<name>    REG_SZ    <value>`；解析不了返回 null。
 */
export function parseWallpaperRegValue(regOutput: string | null): string | null {
  if (regOutput === null) {
    return null;
  }
  const m = /REG_SZ\s+(.+?)\s*$/m.exec(regOutput);
  if (m === null) {
    return null;
  }
  const value = (m[1] ?? '').trim();
  return value === '' ? null : value;
}

/** 扩展名 → MIME；未知扩展返回 null（不猜类型，宁可不衬底）。 */
export function wallpaperMime(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) {
    return null;
  }
  return MIME_BY_EXT[path.slice(dot).toLowerCase()] ?? null;
}

/**
 * 壁纸文件 → data URL。注入 readFile/size 以保可测性（main 侧用 fs 实现）。
 * 失败路径（读不了/超限/未知类型）一律返回 null，renderer 保持实心 fallback。
 */
export function wallpaperToDataUrl(
  path: string,
  readFile: (p: string) => Buffer,
  byteLength: number,
): string | null {
  const mime = wallpaperMime(path);
  if (mime === null || byteLength === 0 || byteLength > WALLPAPER_MAX_BYTES) {
    return null;
  }
  try {
    return `data:${mime};base64,${readFile(path).toString('base64')}`;
  } catch {
    return null;
  }
}
