/**
 * @septcats/platform —— OS 差异适配层（任务书 TASK-T3-01）。
 *
 * 收口红线：路径 / 凭据 / 日志 / 数据根迁移全部只在这里出现，
 * 本包是纯 Node 实现（不 import electron）；Electron 相关的薄封装
 * 留在 `apps/desktop/src/main/platform.ts`。
 */

export * from './layout';
export * from './credentials';
export * from './logger';
export * from './settings';
