/**
 * 自写 ULID（Crockford base32，26 字符），不引第三方依赖。
 *
 * 布局：前 10 字符 = 48 位毫秒时间戳，后 16 字符 = 80 位随机数。
 * 同一毫秒内（或系统时钟回拨时）随机部分按 base32 +1，保证**严格单调递增**，
 * 且固定长度下字符串字典序 == 数值序（Crockford 字符集与 ASCII 单调一致）。
 *
 * 随机源优先使用 Web Crypto（Node 19+ / 浏览器均内建 globalThis.crypto），
 * 不可用时降级 Math.random —— 因此本模块**不 import node:crypto**，可纯内存运行。
 */

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_INDEX: ReadonlyMap<string, number> = new Map(
  Array.from(CROCKFORD_ALPHABET, (ch, index) => [ch, index] as const),
);

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const RADIX = 32;
const MAX_TIME = 0xffffffffffff; // 48 位

/** ULID 固定长度。 */
export const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS;

let lastTime = -1;
let lastRandom: number[] = [];

interface WebCryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/** 取出 Web Crypto（不直接依赖 Crypto 全局类型，避免 DOM / @types/node 类型冲突）。 */
function getWebCrypto(): WebCryptoLike | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto;
  if (candidate === undefined || candidate === null) {
    return null;
  }
  const getRandomValues = (candidate as { getRandomValues?: unknown }).getRandomValues;
  if (typeof getRandomValues !== 'function') {
    return null;
  }
  return candidate as WebCryptoLike;
}

function fillRandomBytes(bytes: Uint8Array): Uint8Array {
  const webCrypto = getWebCrypto();
  if (webCrypto !== null) {
    return webCrypto.getRandomValues(bytes);
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function freshRandomDigits(): number[] {
  const bytes = fillRandomBytes(new Uint8Array(10)); // 80 bit
  let accumulator = 0n;
  for (const byte of bytes) {
    accumulator = (accumulator << 8n) | BigInt(byte);
  }
  const digits = new Array<number>(RANDOM_CHARS).fill(0);
  for (let i = RANDOM_CHARS - 1; i >= 0; i -= 1) {
    digits[i] = Number(accumulator & 31n);
    accumulator >>= 5n;
  }
  return digits;
}

/** base32 +1；全部为 31 时返回 true（表示溢出）。 */
function incrementRandom(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const current = digits[i];
    if (current === undefined) {
      return true;
    }
    if (current < RADIX - 1) {
      digits[i] = current + 1;
      return false;
    }
    digits[i] = 0;
  }
  return true;
}

function clampTime(value: number): number {
  if (!Number.isFinite(value)) {
    return Date.now();
  }
  const truncated = Math.trunc(value);
  if (truncated < 0) {
    return 0;
  }
  return Math.min(truncated, MAX_TIME);
}

function encodeTime(time: number): string {
  let remaining = time;
  const chars = new Array<string>(TIME_CHARS).fill('0');
  for (let i = TIME_CHARS - 1; i >= 0; i -= 1) {
    chars[i] = CROCKFORD_ALPHABET.charAt(remaining % RADIX);
    remaining = Math.floor(remaining / RADIX);
  }
  if (remaining > 0) {
    throw new RangeError('ulid：时间戳超出 48 位可表示范围');
  }
  return chars.join('');
}

function encodeDigits(digits: readonly number[]): string {
  let out = '';
  for (const digit of digits) {
    out += CROCKFORD_ALPHABET.charAt(digit);
  }
  return out;
}

/**
 * 生成一个 ULID。
 * @param now 毫秒时间戳；省略时取当前时间。传入固定值可测“同毫秒内单调”。
 */
export function ulid(now: number = Date.now()): string {
  const requested = clampTime(now);
  if (lastTime < 0 || requested > lastTime) {
    lastTime = requested;
    lastRandom = freshRandomDigits();
  } else if (incrementRandom(lastRandom)) {
    // 80 位随机位溢出（概率可忽略）：把时间推进 1ms 并换一组随机
    lastTime = Math.min(lastTime + 1, MAX_TIME);
    lastRandom = freshRandomDigits();
  }
  return encodeTime(lastTime) + encodeDigits(lastRandom);
}

/** 判断字符串是否是合法 ULID（长度 26 + Crockford 字符集）。 */
export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) {
    return false;
  }
  for (const ch of value) {
    if (!CROCKFORD_INDEX.has(ch)) {
      return false;
    }
  }
  return true;
}

/** 解析 ULID 前 10 字符回毫秒时间戳。非法输入 throw TypeError。 */
export function ulidTimestamp(value: string): number {
  if (!isUlid(value)) {
    throw new TypeError(`不是合法 ULID：'${value}'`);
  }
  let accumulator = 0;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    const digit = CROCKFORD_INDEX.get(value.charAt(i));
    if (digit === undefined) {
      throw new TypeError(`不是合法 ULID：'${value}'`);
    }
    accumulator = accumulator * RADIX + digit;
  }
  return accumulator;
}
