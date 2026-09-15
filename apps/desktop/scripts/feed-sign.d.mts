/**
 * feed-sign.mjs 的类型声明（测试从 ESM .mjs 导入 keygen/sign 函数用）。
 * CLI 本体见 scripts/feed-sign.mjs。
 */

export declare function generateFeedKeyPair(
  outDir?: string | null,
): { privatePem: string; publicPem: string };

export declare function signFeedBytes(ymlBytes: Buffer | Uint8Array, privatePem: string): string;

export declare function verifyFeedBytes(
  ymlBytes: Buffer | Uint8Array,
  sigBase64: string,
  publicPem: string,
): boolean;
