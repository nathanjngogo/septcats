/**
 * main/lockIpc.ts —— 页面密码锁 IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）。
 *
 * 通道名单一来源 shared/ipc.ts 的 LOCK_CHANNELS；载荷形状 shared/lock.ts。
 * 与 search/dbview 同一纪律：本文件只做「边界校验 + 转发服务」，不涉及加密/DB 细节。
 * 服务抛出的 LockApiError 在此收敛为 `code: message` 形态（与 pages `fail` 同形），
 * 让渲染器能按稳定 error code 展示，绝不把异常栈透给 renderer。
 */

import {
  CHANNEL_LOCK_CHANGE_PASS,
  CHANNEL_LOCK_GET_STATUS,
  CHANNEL_LOCK_RECOVER,
  CHANNEL_LOCK_REMOVE,
  CHANNEL_LOCK_SET_PASS,
  CHANNEL_LOCK_VERIFY,
} from '../shared/ipc';
import { LockApiError, type LockService } from './lock';

/** 最小 IPC 注册面（`main/index.ts` 用 ipcMain 适配，与 dbViewRegistrar/search 同源）。 */
export interface LockIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LockApiError('E_LOCK_BADPASS', 'IPC 参数必须是对象');
  }
  return raw as Record<string, unknown>;
}

function readText(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new LockApiError('E_LOCK_BADPASS', `${key} 必须是非空字符串`);
  }
  return value;
}

/** 把服务抛出的 LockApiError 收敛为 `code: message`（其它错误原样上抛）。 */
function wrap(error: unknown): never {
  if (error instanceof LockApiError) {
    throw new Error(`${error.code}: ${error.message}`);
  }
  throw error;
}

/**
 * 注册 lock:* 六通道。`service === null`（DbServer 未就绪）时统一回 E_DB_UNAVAILABLE。
 * 边界再校验一次（不信任 renderer）。
 */
export function registerLockIpc(service: LockService | null, registrar: LockIpcRegistrar): void {
  registrar.handle(CHANNEL_LOCK_GET_STATUS, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    const input = asObject(raw);
    try {
      return await service.getStatus(readText(input, 'pageId'));
    } catch (error) {
      wrap(error);
    }
  });

  registrar.handle(CHANNEL_LOCK_SET_PASS, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    const input = asObject(raw);
    try {
      return await service.setPass(readText(input, 'pageId'), readText(input, 'pass'));
    } catch (error) {
      wrap(error);
    }
  });

  registrar.handle(CHANNEL_LOCK_VERIFY, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    const input = asObject(raw);
    try {
      return await service.verify(readText(input, 'pageId'), readText(input, 'pass'));
    } catch (error) {
      wrap(error);
    }
  });

  registrar.handle(CHANNEL_LOCK_RECOVER, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    const input = asObject(raw);
    try {
      return await service.recover(readText(input, 'pageId'), readText(input, 'code'), readText(input, 'newPass'));
    } catch (error) {
      wrap(error);
    }
  });

  registrar.handle(CHANNEL_LOCK_CHANGE_PASS, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    const input = asObject(raw);
    try {
      return await service.changePass(readText(input, 'pageId'), readText(input, 'oldPass'), readText(input, 'newPass'));
    } catch (error) {
      wrap(error);
    }
  });

  registrar.handle(CHANNEL_LOCK_REMOVE, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    const input = asObject(raw);
    try {
      return await service.remove(readText(input, 'pageId'), readText(input, 'pass'));
    } catch (error) {
      wrap(error);
    }
  });
}
