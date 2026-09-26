#!/usr/bin/env node
/**
 * feed-sign.mjs —— feed 自签发布工具（M10-B · TASK-T12-01B §0.3）。
 *
 * 对 latest.yml 原文字节做 Ed25519 签名，产出 latest.yml.sig（base64 单行），
 * 与 yml 同目录发布。零第三方依赖（Node stdlib crypto）。
 *
 * 子命令：
 *   node scripts/feed-sign.mjs keygen [--out <dir>]     生成密钥对（默认 tmp/feed-keys，永不入库）
 *       产出 <dir>/septcats-feed.key（PKCS8 私钥，0600）与 <dir>/septcats-feed.pub（SPKI 公钥）
 *   node scripts/feed-sign.mjs sign --feed <dir|latest.yml> [--key <私钥路径>]
 *       对 <dir>/latest.yml 签名 → 写 <dir>/latest.yml.sig
 *       私钥路径优先取环境变量 SEPTCATS_FEED_KEY，其次 --key 参数
 *   node scripts/feed-sign.mjs verify --feed <dir|latest.yml> [--pub <公钥路径>]
 *       本地验签（发布前自检；更新器内的验签在 src/main/updater.ts）
 *
 * 私钥纪律：私钥永不入库（.gitignore 已含 *.feed.key 与 feed-keys/）；
 * 正式发布密钥由老板/PM 在离线环境自行 keygen，公钥替换进 src/main/updater.ts 常量。
 */

import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PRIVATE_FILE = 'septcats-feed.key';
const PUBLIC_FILE = 'septcats-feed.pub';
const SIG_FILE = 'latest.yml.sig';
const YML_FILE = 'latest.yml';

/**
 * 生成 Ed25519 feed 密钥对。返回 PEM 字符串（pkcs8 私钥 / spki 公钥）；
 * 传入 outDir 时落盘：私钥 0600，公钥 0644。测试直接调本函数拿内存密钥。
 */
export function generateFeedKeyPair(outDir = null) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  if (outDir !== null) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, PRIVATE_FILE), privatePem, { mode: 0o600 });
    writeFileSync(join(outDir, PUBLIC_FILE), publicPem, { mode: 0o644 });
  }
  return { privatePem, publicPem };
}

/** 对 yml 原文字节签名，返回 base64 单行（即 latest.yml.sig 的文件内容）。 */
export function signFeedBytes(ymlBytes, privatePem) {
  return cryptoSign(null, ymlBytes, createPrivateKey(privatePem)).toString('base64');
}

/** 验签（发布侧自检；更新器侧独立实现在 src/main/updater.ts，算法一致）。 */
export function verifyFeedBytes(ymlBytes, sigBase64, publicPem) {
  return cryptoVerify(null, ymlBytes, createPublicKey(publicPem), Buffer.from(sigBase64, 'base64'));
}

function resolveFeedDir(feedPath) {
  const abs = isAbsolute(feedPath) ? feedPath : resolve(process.cwd(), feedPath);
  // 传到 latest.yml 文件本身时取其目录
  if (abs.endsWith(YML_FILE)) {
    return dirname(abs);
  }
  return abs;
}

function readPrivateKeyPem(argv) {
  const fromEnv = process.env['SEPTCATS_FEED_KEY'];
  // 私钥路径优先取环境变量，其次 `--key <路径>`（与 cmdVerify 的 `--pub` 同款数组解析；
  // 0925 修：此处原按对象取 options['key']，而调用方传的是 argv 数组 → 该参数永远无效）
  const keyIndex = argv.indexOf('--key');
  const cliKey = keyIndex >= 0 ? argv[keyIndex + 1] : undefined;
  const keyPath = fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : cliKey;
  if (keyPath === undefined || keyPath.length === 0) {
    fail('sign 需要 --key <私钥路径> 或环境变量 SEPTCATS_FEED_KEY');
  }
  if (!existsSync(keyPath)) {
    fail(`私钥文件不存在：${keyPath}`);
  }
  return readFileSync(keyPath, 'utf8');
}

function fail(message) {
  console.error(`feed-sign: ${message}`);
  process.exit(1);
}

function cmdKeygen(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : join('tmp', 'feed-keys');
  if (out === undefined) {
    fail('--out 缺少目录参数');
  }
  generateFeedKeyPair(out);
  console.log(`keygen ok: ${join(out, PRIVATE_FILE)}（私钥，0600，永不入库）`);
  console.log(`           ${join(out, PUBLIC_FILE)}（公钥，硬编码进 src/main/updater.ts）`);
}

function cmdSign(argv) {
  const feedIndex = argv.indexOf('--feed');
  if (feedIndex < 0 || argv[feedIndex + 1] === undefined) {
    fail('sign 需要 --feed <latest.yml 所在目录或文件路径>');
  }
  const dir = resolveFeedDir(argv[feedIndex + 1]);
  const ymlPath = join(dir, YML_FILE);
  if (!existsSync(ymlPath)) {
    fail(`找不到 ${ymlPath}（先跑 electron-builder 产出）`);
  }
  const privatePem = readPrivateKeyPem(argv);
  const sig = signFeedBytes(readFileSync(ymlPath), privatePem);
  writeFileSync(join(dir, SIG_FILE), `${sig}\n`, 'utf8');
  console.log(`sign ok: ${join(dir, SIG_FILE)}（base64 单行，与 yml 同目录发布）`);
}

function cmdVerify(argv) {
  const feedIndex = argv.indexOf('--feed');
  if (feedIndex < 0 || argv[feedIndex + 1] === undefined) {
    fail('verify 需要 --feed <latest.yml 所在目录或文件路径>');
  }
  const dir = resolveFeedDir(argv[feedIndex + 1]);
  const pubIndex = argv.indexOf('--pub');
  const pubArg = pubIndex >= 0 ? argv[pubIndex + 1] : undefined;
  if (pubIndex >= 0 && pubArg === undefined) {
    fail('verify 的 --pub 缺少路径参数');
  }
  const pubPath = pubArg ?? join(dir, PUBLIC_FILE);
  if (!existsSync(pubPath)) {
    fail(`缺少公钥文件 ${pubPath}（用 --pub <路径> 指定，或把 ${PUBLIC_FILE} 与 latest.yml 同目录发布）`);
  }
  const publicPem = readFileSync(pubPath, 'utf8');
  const sigPath = join(dir, SIG_FILE);
  if (!existsSync(sigPath)) {
    fail(`缺少签名文件 ${sigPath}（拒绝发布）`);
  }
  const ok = verifyFeedBytes(readFileSync(join(dir, YML_FILE)), readFileSync(sigPath, 'utf8').trim(), publicPem);
  if (!ok) {
    fail('验签失败（yml 与 sig 不匹配或密钥不符）');
  }
  console.log('verify ok: latest.yml 与 latest.yml.sig 匹配');
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'keygen') {
    cmdKeygen(rest);
    return;
  }
  if (command === 'sign') {
    cmdSign(rest);
    return;
  }
  if (command === 'verify') {
    cmdVerify(rest);
    return;
  }
  fail('用法：feed-sign.mjs keygen [--out <dir>] | sign --feed <dir> [--key <pem>] | verify --feed <dir> [--pub <pem>]');
}

// CLI 入口（被 import 时——如测试——不执行）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main(process.argv.slice(2));
}
