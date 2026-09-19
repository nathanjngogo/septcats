/**
 * @septcats/editor —— 5a 入口（模型与数据链路）。
 *
 * 纪律：**本入口不 import react / 不 import @tiptap/react**，纯函数层可在纯
 * Node（或 jsdom）下单独测试；React 视图走子路径出口 `@septcats/editor/react`。
 * 数据链路：M3 块模型是真相，PM 文档是投影；每次编辑轮次经 diff 生成 Op，
 * 由注入的 commit(ops) 外发（编辑器永不写 fs/db）。
 */

export * from './model';
// 显式命名导出优先于 star：model 的三参 pmDocToBlocks 不受影响（M12 导入器用纯版）
export { pmDocToBlocks as pmDocToBlockSpecs, type BlockSpec } from './blocks';
export * from './diff';
export * from './tree';
export * from './history';
export * from './seq';
export * from './marks';
export * from './types';
export * from './rules/inputRules';
export * from './rules/slashMenu';
export * from './rules/markdownPaste';
export * from './rules/wikilink';
export * from './yjs';
