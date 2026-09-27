/*
 * check-dist.mjs —— dist 产物存在性 / 更新元数据一致性 / 体积观测护栏（TASK-T12-01 §1 `dist:check`）。
 *
 * 检查项：
 *   1. dist/ 存在 NSIS 安装器（Septcats Setup *.exe）与**渠道对应**的更新元数据 yml；
 *   2. 该 yml 声明的 version 必须等于 package.json 当前版本——防「上一版残留的
 *      latest.yml 被 publish.sh 归一化+签名上传」这类静默错发（feed 指向旧版本）；
 *   3. yml 声明的 size 必须能在 dist/ 找到同样大小的安装器（引用对账）；
 *   4. ~~安装器体积 ≤ 150 MB~~（09-26 老板裁决：体积不设闸，只如实并报——思源黑体
 *      自托管优先；改判前该护栏拦过 maximum 压缩救不回的场景，现仅作观测）。
 *
 * 渠道规则（electron-builder 契约，2026-09-27 实证）：正式版写 `latest.yml`，
 *   prerelease（版本号含 `-`，如 0.6.1-rc.1）写 `rc.yml`；mac 平台加 `-mac` 后缀
 *   （与 src/main/updater.ts feedYmlName 的读取口径一致）。
 * 用法：pnpm -C apps/desktop dist:check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const pkgDir = join(import.meta.dirname, '..');
const distDir = join(pkgDir, 'dist');
// 09-26 老板裁决取消体积预算（99999=观测哨兵，永不触发；恢复护栏时改回 150 即可）
const BUDGET_MB = 99999;

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const ver = String(pkg.version);
const chan = ver.includes('-') ? 'rc' : 'latest';
const expectedYml = `${chan}${process.platform === 'darwin' ? '-mac' : ''}.yml`;
const YML_RE = /^(latest|rc|beta|alpha)(-mac|-linux)?\.yml$/;

let entries;
try {
  entries = readdirSync(distDir);
} catch {
  console.error('dist:check FAILED — dist/ 不存在，先跑 pnpm -C apps/desktop dist');
  process.exit(1);
}

const exes = entries.filter((f) => f.endsWith('.exe'));
const ymls = entries.filter((f) => YML_RE.test(f));

if (exes.length === 0) {
  console.error('dist:check FAILED — dist/ 内无 .exe 安装器');
  process.exit(1);
}
if (!ymls.includes(expectedYml)) {
  console.error(
    `dist:check FAILED — 缺本版（${ver}）渠道对应更新元数据 ${expectedYml}` +
      `（dist/ 现有 yml: ${ymls.join(', ') === '' ? '无' : ymls.join(', ')}；正式版写 latest.yml、prerelease 写 rc.yml）`,
  );
  process.exit(1);
}

let failed = false;
for (const y of ymls) {
  const txt = readFileSync(join(distDir, y), 'utf8');
  const mv = /^version: (.+)$/m.exec(txt);
  const ms = /^size: (\d+)$/m.exec(txt);
  const ymlVer = mv === null ? '' : mv[1].trim();
  if (ymlVer !== ver) {
    console.error(
      `dist:check FAILED — ${y} 声明 version=${ymlVer === '' ? '?' : ymlVer}，当前包 ${ver}` +
        '（上一版残留：删除该 yml 后重跑构建；残留被归一化上传会让 feed 指向旧版本）',
    );
    failed = true;
  }
  if (ms !== null && !exes.some((f) => statSync(join(distDir, f)).size === Number(ms[1]))) {
    console.error(`dist:check FAILED — ${y} 声明 size=${ms[1]}，dist/ 内无同尺寸安装器`);
    failed = true;
  }
}

const listed = entries.filter((f) => f.endsWith('.exe') || f.endsWith('.blockmap') || YML_RE.test(f));
for (const f of listed) {
  const mb = statSync(join(distDir, f)).size / (1024 * 1024);
  const over = f.endsWith('.exe') && mb > BUDGET_MB;
  if (over) failed = true;
  console.log(`  ${f}  ${mb.toFixed(2)} MB${over ? `  > ${BUDGET_MB} MB 预算，超限!` : ''}`);
}

if (failed) {
  console.error(`dist:check FAILED — 见上（元数据一致性 / 体积哨兵 ${BUDGET_MB} MB）`);
  process.exit(1);
}
console.log(`dist:check ok（${ver} / ${expectedYml} 声明一致）`);
