/**
 * @septcats/dbview —— 数据层入口（T7 · 纯逻辑）。
 *
 * 纪律：**本入口不 import react**，可在纯 Node 下跑「视图引擎 / 值编解码 / CSV」
 * 的全部测试；React 视图走子路径出口 `@septcats/dbview/react`。
 * 数据链路：collection/record 是 Op 实体（真相层），本包只做形状、值语义、
 * 视图计算与表格渲染；写路径一律由 apps 层造 Op 后 `commitOps` 落库，
 * 本包**永不**写 SQL / 不 import electron。
 */

export * from './types';
export * from './values';
export * from './view';
export * from './csv';
