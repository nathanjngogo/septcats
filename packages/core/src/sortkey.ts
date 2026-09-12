/**
 * LexoRank 风格的字符串排序键。
 *
 * 字符集 base62 且与 ASCII 单调一致：'0'-'9' < 'A'-'Z' < 'a'-'z'，
 * 因此任意两键的大小关系可直接用字符串比较（与排序键列的 SQLite 排序一致）。
 *
 * 设计目标：在 a 与 b 之间生成一个**严格位于两者之间**的短字符串，
 * 使得拖拽排序只需改写一个块、不必批量重排（见 PROJECT_PLAN §6.2）。
 */

export const SORTKEY_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 理论最小键（空集合的“最前”哨兵）。 */
export const SORTKEY_MIN = '0';
/** 理论最大键（用于“拖到末尾”的视觉哨兵）。 */
export const SORTKEY_MAX = 'z';
/** 空列表的首个块使用的初始键。 */
export const SORTKEY_INITIAL = 'A00000000';
/** 长度上限（超出视为退化，抛错以便早期发现）。 */
export const SORTKEY_MAX_LENGTH = 16;

/** 排序区间非法（等值、逆序、空区间或非 base62 字符）时抛出。 */
export class InvalidSortRange extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSortRange';
    Object.setPrototypeOf(this, InvalidSortRange.prototype);
  }
}

const RADIX = SORTKEY_CHARSET.length;
const MID_DIGIT = Math.floor(RADIX / 2);

const DIGIT_INDEX: ReadonlyMap<string, number> = new Map(
  Array.from(SORTKEY_CHARSET, (ch, index) => [ch, index] as const),
);

function digitOf(ch: string, label: string): number {
  const digit = DIGIT_INDEX.get(ch);
  if (digit === undefined) {
    throw new InvalidSortRange(`${label} 含非法字符 '${ch}'（仅允许 base62 0-9A-Za-z）`);
  }
  return digit;
}

function charOf(digit: number): string {
  const ch = SORTKEY_CHARSET.charAt(digit);
  if (ch === '') {
    throw new InvalidSortRange(`数字 ${digit} 超出 base62 范围 [0,${RADIX - 1}]`);
  }
  return ch;
}

function isValidKey(key: string): boolean {
  if (key.length === 0) {
    return false;
  }
  for (const ch of key) {
    if (!DIGIT_INDEX.has(ch)) {
      return false;
    }
  }
  return true;
}

/**
 * 生成严格位于 a 与 b 之间的键。
 * a === '' 表示负无穷（无下界），b === null 表示正无穷（无上界）。
 * 前置条件：b 非 null 时 a < b。
 *
 * 不变量：生成的键**不以最小数字 '0' 结尾**。字符串序下唯一“无空隙”的相邻对是
 * (X, X + '0')——两者之间不存在任何键；守住这条不变量即可保证任意相邻对永远可再插入。
 */
function mid(a: string, b: string | null): string {
  if (b === null) {
    if (a === '') {
      return charOf(MID_DIGIT);
    }
    const lead = digitOf(a.charAt(0), `排序键 '${a}'`);
    if (lead < RADIX - 1) {
      return charOf(Math.floor((lead + RADIX) / 2));
    }
    return charOf(lead) + mid(a.slice(1), null);
  }

  if (a >= b) {
    throw new InvalidSortRange(`排序区间非法：'${a}' >= '${b}'`);
  }

  // 先剥离公共前缀，把问题缩小到第一个不同的字符
  let n = 0;
  while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) {
    n += 1;
  }
  if (n > 0) {
    return a.slice(0, n) + mid(a.slice(n), b.slice(n));
  }

  const digitB = digitOf(b.charAt(0), `排序键 '${b}'`);

  if (a.length === 0) {
    // 下界已耗尽（下界是上界的前缀）：结果必须以 b 的首字符开头。
    if (digitB >= 2) {
      // 取 [1, digitB) 的中间值：既不落在下界的零扩展上，也严格小于上界
      return charOf(Math.floor(digitB / 2));
    }
    if (digitB === 1) {
      // '0' 打底再补一位中间数字，长度 >= 2，避免产出裸 '0'
      return charOf(0) + charOf(MID_DIGIT);
    }
    // digitB === 0：b 以最小数字开头，只能先吃掉这位再向低位递归
    if (b.length === 1) {
      throw new InvalidSortRange(`区间过窄：'${b}' 之前不存在可用排序键`);
    }
    return charOf(0) + mid('', b.slice(1));
  }

  const digitA = digitOf(a.charAt(0), `排序键 '${a}'`);
  if (digitB - digitA > 1) {
    // 本位可容纳一个中间数字：直接取中，结果最短
    return charOf(Math.floor((digitA + digitB) / 2));
  }
  // 本位数字相邻：沿用下界数字，向低位递归加长（结果必然小于上界）
  return charOf(digitA) + mid(a.slice(1), null);
}

/**
 * 在 a、b 之间生成排序键。
 * - (null, null) -> SORTKEY_INITIAL
 * - (null, b)    -> 位于 b 之前
 * - (a, null)    -> 位于 a 之后
 * - (a, b)       -> 严格介于两者之间
 * 非法区间（等值/逆序/无解/非法字符）throw InvalidSortRange。
 */
export function sortBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidKey(a)) {
    throw new InvalidSortRange(`下界 '${a}' 不是合法 base62 排序键`);
  }
  if (b !== null && !isValidKey(b)) {
    throw new InvalidSortRange(`上界 '${b}' 不是合法 base62 排序键`);
  }
  if (a !== null && b !== null && a >= b) {
    throw new InvalidSortRange(`排序区间非法：'${a}' >= '${b}'`);
  }

  let result: string;
  if (a === null && b === null) {
    result = SORTKEY_INITIAL;
  } else if (a === null) {
    // b 必非 null（上面已排除双 null）
    result = mid('', b);
  } else if (b === null) {
    result = mid(a, null);
  } else {
    result = mid(a, b);
  }

  const lowerLabel = a === null ? '-∞' : `'${a}'`;
  const upperLabel = b === null ? '+∞' : `'${b}'`;
  if (a !== null && result <= a) {
    throw new InvalidSortRange(`无法在 ${lowerLabel} 与 ${upperLabel} 之间生成排序键`);
  }
  if (b !== null && result >= b) {
    throw new InvalidSortRange(`无法在 ${lowerLabel} 与 ${upperLabel} 之间生成排序键`);
  }
  if (result.length > SORTKEY_MAX_LENGTH) {
    throw new InvalidSortRange(`生成的排序键 '${result}' 长度 ${result.length} 超出上限 ${SORTKEY_MAX_LENGTH}`);
  }
  return result;
}

const SEQUENCE_DIGITS = SORTKEY_INITIAL.length - 1;
const SEQUENCE_PREFIX = SORTKEY_INITIAL.charAt(0);

/** 把非负整数编码成定宽 base62 字符串（高位在前，字符集与排序键一致）。 */
function encodeBase62(value: number, width: number): string {
  let remaining = value;
  const chars = new Array<string>(width).fill(SORTKEY_CHARSET.charAt(0));
  for (let i = width - 1; i >= 0; i -= 1) {
    chars[i] = charOf(remaining % RADIX);
    remaining = Math.floor(remaining / RADIX);
  }
  if (remaining > 0) {
    throw new InvalidSortRange(`sortSequence：序号 ${value} 超出 ${width} 位 base62 表示范围`);
  }
  return chars.join('');
}

/**
 * 连续生成 n 个严格递增的排序键，长度恒为 |SORTKEY_INITIAL|（<= SORTKEY_MAX_LENGTH），
 * 第 0 个即 SORTKEY_INITIAL。用于批量初始化（导入、新块列表等）。
 */
export function sortSequence(n: number): string[] {
  const count = Math.max(0, Math.trunc(n));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(SEQUENCE_PREFIX + encodeBase62(i, SEQUENCE_DIGITS));
  }
  return out;
}
