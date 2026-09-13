import { join } from 'node:path';
import { app } from 'electron';
import {
  bootstrapPaths,
  createCredentialStore,
  createLogger,
  type CredentialStore,
  type Logger,
  type PathLayout,
} from '@septcats/platform';

/**
 * desktop 侧的平台薄封装（任务书 TASK-T3-01 §6）。
 *
 * 这里是 `apps/desktop/src` 里**唯一**允许接触 Electron 路径 API 的地方：
 * 把 `app.getPath(...)` 注入给纯 Node 的 `@septcats/platform`，
 * 之后所有路径/凭据/日志能力都从返回的上下文取用，其他文件不得自拼家目录或 `~`。
 */

export interface PlatformContext {
  layout: PathLayout;
  logger: Logger;
  credentials: CredentialStore;
  /** Electron `app.getPath('userData')`（settings.json 所在）。 */
  userDataDir: string;
  /** Electron `app.getPath('home')`（诊断包路径脱敏用）。 */
  homeDir: string;
}

export async function initPlatform(): Promise<PlatformContext> {
  const userDataDir = app.getPath('userData');
  const homeDir = app.getPath('home');
  const layout = await bootstrapPaths({
    appName: 'septcats',
    electronUserData: userDataDir,
    homeDir,
    platform: process.platform,
  });

  const logger = createLogger(layout);
  const credentials = createCredentialStore({ credDir: join(layout.root, 'credentials') });

  return { layout, logger, credentials, userDataDir, homeDir };
}
