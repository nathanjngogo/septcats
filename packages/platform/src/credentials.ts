import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

/**
 * 凭据存储（任务书 §3）。
 *
 * 安全红线：
 * 1. **密钥明文绝不出现在任何子进程的 argv、任何日志、任何错误消息中**。
 *    Windows：PowerShell + DPAPI（CurrentUser 域），明文只走 stdin(base64)，
 *    密文只走 stdout(base64)，Node 侧负责落盘（写 tmp → rename）。
 *    macOS：`/usr/bin/security`，写密码按任务书用 `-X <hex>`（hex 而非明文进 argv）。
 * 2. `isAvailable()` 只探测、永不抛；后端不可用时 get/set/delete 抛稳定错误
 *    `E_CRED_UNAVAILABLE`。
 * 3. service/account 名白名单 `[a-z0-9_-]{1,32}`，文件名校验拒绝路径穿越。
 */

export interface CredentialStore {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}

export interface SpawnRequest {
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 可注入的子进程执行器（测试用 argv 审计包装真实实现）。 */
export type SpawnImpl = (file: string, args: readonly string[], options: SpawnRequest) => Promise<SpawnResult>;

export interface CredentialStoreOptions {
  /** 密文目录（生产：`<layout.root>/credentials`；测试：tmpdir）。必须绝对路径。 */
  credDir: string;
  /** 子进程环境；省略时用 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** 目标平台；省略时用 process.platform（测试可注入）。 */
  platform?: NodeJS.Platform;
  /** 子进程执行器；省略时用 spawnCollect（测试可注入审计包装）。 */
  spawn?: SpawnImpl;
}

/** 凭据名/文件名非法。 */
export class CredentialNameError extends Error {
  readonly code = 'E_CRED_INVALID_NAME';

  constructor(detail: string) {
    super(`E_CRED_INVALID_NAME：${detail}`);
    this.name = 'CredentialNameError';
  }
}

/** 凭据后端不可用（无 DPAPI / 无 security / 探测失败）。 */
export class CredentialUnavailableError extends Error {
  readonly code = 'E_CRED_UNAVAILABLE';

  constructor(backend: string) {
    super(`E_CRED_UNAVAILABLE：凭据后端不可用（${backend}）`);
    this.name = 'CredentialUnavailableError';
  }
}

const SEGMENT_PATTERN = /^[a-z0-9_-]{1,32}$/;
const POWERSHELL_EXE = 'powershell.exe';
const SECURITY_EXE = '/usr/bin/security';
const POWERSHELL_FLAGS: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
];

/**
 * DPAPI 加密脚本：stdin = base64(明文) → stdout = base64(密文)。
 * 全程 ASCII，规避控制台编码问题；argv 里只有脚本常量，无明文、无路径。
 */
const WIN_PROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  '$plain=[Convert]::FromBase64String($b64)',
  '$protected=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($protected))',
].join('; ');

/** DPAPI 解密脚本：stdin = base64(密文) → stdout = base64(明文)。 */
const WIN_UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  '$protected=[Convert]::FromBase64String($b64)',
  '$plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('; ');

/** 探测用固定明文（加密后必须不等于它本身，证明 DPAPI 真的生效）。 */
const PROBE_PLAINTEXT = 'septcats-credential-probe';

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function assertSegment(kind: 'service' | 'account', value: string): void {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new CredentialNameError(`${kind} 必须是 [a-z0-9_-]{1,32}：'${value}'`);
  }
}

/** 组装密文文件名并做穿越校验（白名单已排除分隔符，这里是双保险）。 */
function resolveSecretFile(credDir: string, service: string, account: string): string {
  const name = `${service}__${account}.enc`;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new CredentialNameError(`非法密文文件名：'${name}'`);
  }
  const target = join(credDir, name);
  const rel = relative(credDir, target);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    throw new CredentialNameError(`密文路径越出 credDir：'${target}'`);
  }
  return target;
}

/** 默认执行器：收集 stdout/stderr，stdin 以 UTF-8 写入后关闭。 */
export const spawnCollect: SpawnImpl = (file, args, options) => {
  return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(file, [...args], {
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // 子进程提前退出时 stdin 会 EPIPE，忽略即可
    child.stdin?.on('error', () => undefined);
    child.on('error', (error: Error) => {
      rejectPromise(error);
    });
    child.on('close', (code: number | null) => {
      resolvePromise({ code, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin?.write(options.input, 'utf8');
    }
    child.stdin?.end();
  });
};

/**
 * 创建凭据存储。service/account 只做校验，明文只经 stdin 传输。
 */
export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  const credDir = options.credDir;
  if (!isAbsolute(credDir)) {
    throw new Error(`E_CRED_INVALID_DIR：credDir 必须是绝对路径：'${credDir}'`);
  }

  const platform = options.platform ?? process.platform;
  const run = options.spawn ?? spawnCollect;
  const backend =
    platform === 'win32'
      ? 'windows-dpapi'
      : platform === 'darwin'
        ? 'macos-keychain'
        : `unsupported:${platform}`;
  let availability: boolean | null = null;

  async function isAvailable(): Promise<boolean> {
    if (availability !== null) {
      return availability;
    }
    if (platform !== 'win32' && platform !== 'darwin') {
      availability = false;
      return false;
    }
    let probe: SpawnResult;
    try {
      probe =
        platform === 'win32'
          ? await run(POWERSHELL_EXE, [...POWERSHELL_FLAGS, WIN_PROTECT_SCRIPT], {
              input: toBase64(PROBE_PLAINTEXT),
            })
          : await run(SECURITY_EXE, ['help'], {});
    } catch {
      availability = false;
      return false;
    }
    const cipher = probe.stdout.trim();
    availability =
      platform === 'win32'
        ? probe.code === 0 && cipher.length > 0 && cipher !== toBase64(PROBE_PLAINTEXT)
        : probe.code !== null;
    return availability;
  }

  async function assertAvailable(): Promise<void> {
    if (!(await isAvailable())) {
      throw new CredentialUnavailableError(backend);
    }
  }

  return {
    async get(service: string, account: string): Promise<string | null> {
      assertSegment('service', service);
      assertSegment('account', account);
      await assertAvailable();
      const file = resolveSecretFile(credDir, service, account);

      if (platform === 'win32') {
        let cipher: string;
        try {
          cipher = (await fs.readFile(file, 'utf8')).trim();
        } catch (error) {
          if (isNotFound(error)) {
            return null;
          }
          throw error;
        }
        if (cipher.length === 0) {
          return null;
        }
        const result = await run(POWERSHELL_EXE, [...POWERSHELL_FLAGS, WIN_UNPROTECT_SCRIPT], {
          input: cipher,
        });
        if (result.code !== 0 || result.stdout.trim().length === 0) {
          throw new Error(`E_CRED_READ_FAILED：无法解出凭据（${service}/${account}）`);
        }
        return Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
      }

      const result = await run(
        SECURITY_EXE,
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        {},
      );
      if (result.code === 0) {
        return result.stdout.replace(/\r?\n$/, '');
      }
      // 44 = errSecItemNotFound
      if (result.code === 44 || /could not be found/i.test(result.stderr)) {
        return null;
      }
      return null;
    },

    async set(service: string, account: string, secret: string): Promise<void> {
      assertSegment('service', service);
      assertSegment('account', account);
      await assertAvailable();
      const file = resolveSecretFile(credDir, service, account);

      if (platform === 'win32') {
        const result = await run(POWERSHELL_EXE, [...POWERSHELL_FLAGS, WIN_PROTECT_SCRIPT], {
          input: toBase64(secret),
        });
        const cipher = result.stdout.trim();
        if (result.code !== 0 || cipher.length === 0) {
          throw new Error(`E_CRED_WRITE_FAILED：无法加密凭据（${service}/${account}）`);
        }
        await fs.mkdir(credDir, { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, cipher, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tmp, file);
        return;
      }

      const hex = Buffer.from(secret, 'utf8').toString('hex');
      const result = await run(
        SECURITY_EXE,
        ['add-generic-password', '-s', service, '-a', account, '-U', '-X', hex],
        {},
      );
      if (result.code !== 0) {
        throw new Error(`E_CRED_WRITE_FAILED：无法写入钥匙串（${service}/${account}）`);
      }
    },

    async delete(service: string, account: string): Promise<boolean> {
      assertSegment('service', service);
      assertSegment('account', account);
      await assertAvailable();
      const file = resolveSecretFile(credDir, service, account);

      if (platform === 'win32') {
        try {
          await fs.unlink(file);
          return true;
        } catch (error) {
          if (isNotFound(error)) {
            return false;
          }
          throw error;
        }
      }

      const result = await run(
        SECURITY_EXE,
        ['delete-generic-password', '-s', service, '-a', account],
        {},
      );
      return result.code === 0;
    },

    isAvailable,
  };
}
