/**
 * @septcats/core —— Septcats 纯领域核心。
 *
 * 约束（任务书 §1）：零运行时依赖（zod 除外），不 import electron，
 * 核心逻辑可在纯 Node 下跑测试。真相层的正确性地基（事件/时钟/排序键/
 * 分段编解码/重放/收敛性）全部收口在这里。
 */

export * from './op';
export * from './clock';
export * from './sortkey';
export * from './segment';
export * from './projection';
export * from './replay';
export * from './snapshot';
export * from './util/ulid';
