/**
 * pixelIco.ts —— Windows `.ico` 目录表 / 逐层 PNG 表项回读（TASK-T55-02 §1⑤）。
 *
 * 只做**结构回读**：纯 `Buffer` 解析，不 import electron、不读文件、无副作用，
 * 所以能直接进 node 单测，把 `scripts/build-pixel-ico.mjs` 的产出契约钉成断言
 * （层数 / 尺寸序列 / 每层 PNG 签名 + IHDR 宽与目录声明一致）。
 * 产品运行时不调用它——本模块不参与任何启动/交互路径。
 *
 * ICO 约定：目录项宽高单字节，**0 表示 256**（本文件在回读时归一成 256，避免调用方各自记这条规矩）。
 */

/** PNG 文件头 8 字节（`\x89PNG\r\n\x1a\n`）。 */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** ICO 目录表一项（宽/高已按 ico 约定把 0 归一成 256）。 */
export interface IcoDirEntry {
  width: number;
  height: number;
  /** 位深（T55 资产 = 32）。 */
  bitCount: number;
  /** 该层图像数据字节数（PNG 表项 = 整段 PNG 文件长度）。 */
  byteLength: number;
  /** 该层图像数据在 .ico 文件内的起始偏移。 */
  byteOffset: number;
  /** 是否 PNG 表项（Vista+；T55 五层全为 PNG 表项，非 BMP 表项）。 */
  isPng: boolean;
  /** PNG 表项 IHDR 声明的宽（非 PNG 表项 → null）。 */
  ihdrWidth: number | null;
}

/** 一次回读的结果。 */
export interface IcoImage {
  /** 目录表声明的层数。 */
  count: number;
  entries: IcoDirEntry[];
}

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

function fail(reason: string): never {
  throw new Error(`ICO 解析失败：${reason}`);
}

function hasPngSignature(buf: Buffer, offset: number): boolean {
  if (offset < 0 || offset + PNG_SIGNATURE.length > buf.length) {
    return false;
  }
  return PNG_SIGNATURE.every((byte, index) => buf.readUInt8(offset + index) === byte);
}

/**
 * 读一段 PNG 表项的 IHDR 宽。签名不符 / 越界 / IHDR 缺失 → null（不抛：调用方按 null 自行判定）。
 * PNG 布局：8 字节签名 + 4 字节块长 + 4 字节 `IHDR` + 4 字节宽（大端）。
 */
export function readPngIhdrWidth(buf: Buffer, offset: number): number | null {
  const ihdrTagOffset = offset + PNG_SIGNATURE.length + 4;
  if (!hasPngSignature(buf, offset) || ihdrTagOffset + 4 + 4 > buf.length) {
    return null;
  }
  if (buf.toString('latin1', ihdrTagOffset, ihdrTagOffset + 4) !== 'IHDR') {
    return null;
  }
  return buf.readUInt32BE(ihdrTagOffset + 4);
}

/** 回读 `.ico`：校验头（保留位=0 / 类型=1 / 层数≥1）与每层偏移不越界，逐层判 PNG 表项取 IHDR 宽。 */
export function readIco(buf: Buffer): IcoImage {
  if (buf.length < ICO_HEADER_BYTES) {
    fail(`长度 ${String(buf.length)} < 头部 ${String(ICO_HEADER_BYTES)} 字节`);
  }
  if (buf.readUInt16LE(0) !== 0) {
    fail(`保留位非 0（${String(buf.readUInt16LE(0))}）`);
  }
  const type = buf.readUInt16LE(2);
  if (type !== 1) {
    fail(`图像类型非 1（图标）而是 ${String(type)}`);
  }
  const count = buf.readUInt16LE(4);
  if (count < 1) {
    fail(`层数 ${String(count)} < 1`);
  }
  if (buf.length < ICO_HEADER_BYTES + ICO_ENTRY_BYTES * count) {
    fail(`目录表声明 ${String(count)} 层但文件仅 ${String(buf.length)} 字节`);
  }
  const entries: IcoDirEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * index;
    const width = buf.readUInt8(at) === 0 ? 256 : buf.readUInt8(at);
    const height = buf.readUInt8(at + 1) === 0 ? 256 : buf.readUInt8(at + 1);
    const bitCount = buf.readUInt16LE(at + 6);
    const byteLength = buf.readUInt32LE(at + 8);
    const byteOffset = buf.readUInt32LE(at + 12);
    if (byteOffset + byteLength > buf.length) {
      fail(`第 ${String(index)} 层数据越界（offset=${String(byteOffset)} + len=${String(byteLength)} > ${String(buf.length)}）`);
    }
    const isPng = hasPngSignature(buf, byteOffset);
    entries.push({
      width,
      height,
      bitCount,
      byteLength,
      byteOffset,
      isPng,
      ihdrWidth: isPng ? readPngIhdrWidth(buf, byteOffset) : null,
    });
  }
  return { count, entries };
}
