/**
 * stats.ts —— 页面写作洞察（纯函数，创意项 IDEA-B）。
 *
 * 口径（写死在注释里，测试钉死）：
 *  - **CJK 逐字**（中日韩统一表意 + 假名 + 全角标点族）：中文阅读速度按「字/分钟」；
 *  - **拉丁词按空白分词**（数字串也算一词）：英文按「词/分钟」；
 *  - 统一折算 `words`：CJK 字符数 + 拉丁词数；
 *  - 阅读分钟 = words / 300 向上取整、**最少 1**（300 字/分钟是中文通读速度保守值；
 *    拉丁词更快，混合文本用 300 偏保守可接受——这是"预计"，不是计时器）；
 *  - 空文本 → null（没有内容就没有洞察，不显示「0 字 · 读 1 分钟」的蠢话）。
 */

/** CJK 字符：统一表意文字（含扩展 A 区与兼容区）+ 假名 + 全角标点/汉字符。 */
function isCjk(code: number): boolean {
  return (
    (code >= 0x3041 && code <= 0x30ff) // 平假名 + 片假名
    || (code >= 0x3400 && code <= 0x4dbf) // 扩展 A
    || (code >= 0x4e00 && code <= 0x9fff) // 统一表意基本区
    || (code >= 0xf900 && code <= 0xfaff) // 兼容表意
    || (code >= 0x3000 && code <= 0x303f) // CJK 符号与标点（。、「」等）
    || (code >= 0xff00 && code <= 0xffef) // 全角形式（！？（）等）
    || (code >= 0x2e80 && code <= 0x2eff) // CJK 部首补充
  );
}

export interface WritingStats {
  /** 折算字数（CJK 逐字 + 拉丁词）。 */
  words: number;
  /** 原始字符数（含空白，与系统其它"长度"口径一致，用于悬浮说明）。 */
  chars: number;
  /** 预计阅读分钟（最少 1）。 */
  minutes: number;
  /** 首个非空白片段（≤12 字符，悬浮卡头显示"这篇在写什么"）。 */
  peek: string;
}

/**
 * 统计一篇文档文本。`text` 用 ProseMirror `doc.textBetween(0, size, '\n')` 取
 * （块边界是换行，天然切断拉丁词——不会把两个段的首尾词粘成一个）。
 */
export function writingStats(text: string): WritingStats | null {
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjk(code)) {
      cjk += 1;
    }
  }
  // 拉丁词：非 CJK 片段按空白/标点切分；数字串算词
  const latinWords = text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/gu, ' ')
    .split(/[^0-9A-Za-z\u00c0-\u024f]+/u)
    .filter((token) => token.length > 0).length;
  const words = cjk + latinWords;
  const chars = [...text].length;
  if (words === 0) {
    return null;
  }
  const minutes = Math.max(1, Math.ceil(words / 300));
  const first = text.trimStart().slice(0, 12);
  return { words, chars, minutes, peek: first };
}
