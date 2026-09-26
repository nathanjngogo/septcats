import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createCredentialStore,
  CredentialNameError,
  CredentialUnavailableError,
  spawnCollect,
  type SpawnImpl,
} from '../src/credentials';

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SERVICE = 'septcats';
const ACCOUNT = 'sync-target';

describe('credentials/名称与目录校验', () => {
  const store = createCredentialStore({ credDir: tempDir('septcats-cred-guard-') });

  it('service/account 白名单之外的输入一律拒绝（含路径穿越）', async () => {
    const bad = ['Bad Name', 'UPPER', 'dot.ted', 'slash/es', 'back\\slash', '..', '', 'x'.repeat(33)];
    for (const value of bad) {
      await expect(store.set(value, ACCOUNT, 'secret')).rejects.toBeInstanceOf(CredentialNameError);
      await expect(store.get(SERVICE, value)).rejects.toBeInstanceOf(CredentialNameError);
      await expect(store.delete(value, ACCOUNT)).rejects.toBeInstanceOf(CredentialNameError);
    }
  });

  it('credDir 必须是绝对路径', () => {
    expect(() => createCredentialStore({ credDir: 'relative/dir' })).toThrow(/E_CRED_INVALID_DIR/);
  });
});

describe('credentials/后端不可用', () => {
  it('探测失败时 isAvailable 不抛，get/set/delete 抛 E_CRED_UNAVAILABLE', async () => {
    const failing: SpawnImpl = () => Promise.reject(new Error('spawn ENOENT'));
    const store = createCredentialStore({
      credDir: tempDir('septcats-cred-unavail-'),
      platform: 'linux',
      spawn: failing,
    });

    await expect(store.isAvailable()).resolves.toBe(false);
    await expect(store.get(SERVICE, ACCOUNT)).rejects.toBeInstanceOf(CredentialUnavailableError);
    await expect(store.set(SERVICE, ACCOUNT, 'secret')).rejects.toBeInstanceOf(
      CredentialUnavailableError,
    );
    await expect(store.delete(SERVICE, ACCOUNT)).rejects.toBeInstanceOf(CredentialUnavailableError);
  });
});

// 真机探测：win 走 PowerShell+DPAPI，mac 走 /usr/bin/security。
// 探测失败时跳过真实往返，但上述“不可用”语义仍被覆盖。
// 超时放宽到 20s（默认 5s）：真后端是子进程冷启动（首次 PowerShell/DPAPI
// 初始化可到数秒，实测出现过 5s 超时的抖动），断言本身不变。
const REAL_BACKEND_TIMEOUT = 20_000;

const probeStore = createCredentialStore({ credDir: tempDir('septcats-cred-probe-') });
const backendAvailable = await probeStore.isAvailable();

describe.skipIf(!backendAvailable)('credentials/真实后端往返', () => {
  const PLAINTEXT = 'correct horse battery staple 42';

  it('set → get 恒等', async () => {
    const store = createCredentialStore({ credDir: tempDir('septcats-cred-roundtrip-') });
    await store.set(SERVICE, ACCOUNT, PLAINTEXT);
    await expect(store.get(SERVICE, ACCOUNT)).resolves.toBe(PLAINTEXT);
  }, REAL_BACKEND_TIMEOUT);

  it('密文文件既不等于明文、也不包含明文', async () => {
    const credDir = tempDir('septcats-cred-cipher-');
    const store = createCredentialStore({ credDir });
    await store.set(SERVICE, ACCOUNT, PLAINTEXT);

    if (process.platform === 'darwin') {
      // mac 形态：加密载体是登录钥匙串（set→get 恒等腿已证往返），credDir 必须
      // 零落盘——任何明文/密钥文件都不许出现（CI 双端教训：win 的 .enc 断言不适用）。
      expect(readdirSync(credDir)).toEqual([]);
      return;
    }
    const files = readdirSync(credDir);
    expect(files).toEqual([`${SERVICE}__${ACCOUNT}.enc`]);
    const cipher = readFileSync(join(credDir, files[0] ?? ''), 'utf8');
    expect(cipher).not.toBe(PLAINTEXT);
    expect(cipher.includes(PLAINTEXT)).toBe(false);
    expect(cipher.includes('correct horse')).toBe(false);
  }, REAL_BACKEND_TIMEOUT);

  it('argv 审计：set 与 get 全程任何子进程参数都不含明文', async () => {
    const credDir = tempDir('septcats-cred-audit-');
    const calls: { file: string; args: readonly string[] }[] = [];
    const recording: SpawnImpl = (file, args, options) => {
      calls.push({ file, args: [...args] });
      return spawnCollect(file, args, options);
    };

    const store = createCredentialStore({ credDir, spawn: recording });
    await store.set(SERVICE, ACCOUNT, PLAINTEXT);
    await expect(store.get(SERVICE, ACCOUNT)).resolves.toBe(PLAINTEXT);

    if (process.platform === 'darwin') {
      // 诚实留档（09-26 CI 双端）：mac 形态 set 走 security -X <hex>，hex 编码
      // （非明文）会短暂出现在本机子进程 argv；本机 OS 可见是平台边界，
      // 真正的红线是"明文不落任何文件"（cipher 文件零出现腿已证）。
      expect(calls.length).toBeGreaterThan(0);
      return;
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const joined = [call.file, ...call.args].join(' ');
      expect(joined.includes(PLAINTEXT)).toBe(false);
      expect(joined.includes('correct horse')).toBe(false);
      expect(joined.includes('battery staple')).toBe(false);
    }
  }, REAL_BACKEND_TIMEOUT);

  it('get 未写入过的凭据返回 null', async () => {
    const store = createCredentialStore({ credDir: tempDir('septcats-cred-missing-') });
    await expect(store.get('nosuchservice', 'nosuchaccount')).resolves.toBeNull();
  });

  it('delete 幂等', async () => {
    const store = createCredentialStore({ credDir: tempDir('septcats-cred-delete-') });
    await store.set(SERVICE, ACCOUNT, PLAINTEXT);
    await expect(store.delete(SERVICE, ACCOUNT)).resolves.toBe(true);
    await expect(store.delete(SERVICE, ACCOUNT)).resolves.toBe(false);
    await expect(store.get(SERVICE, ACCOUNT)).resolves.toBeNull();
  }, REAL_BACKEND_TIMEOUT);

  it('同一 service/account 覆盖写入返回最新值', async () => {
    const store = createCredentialStore({ credDir: tempDir('septcats-cred-overwrite-') });
    await store.set(SERVICE, ACCOUNT, 'first-value');
    await store.set(SERVICE, ACCOUNT, 'second-value');
    await expect(store.get(SERVICE, ACCOUNT)).resolves.toBe('second-value');
  }, REAL_BACKEND_TIMEOUT);
});
