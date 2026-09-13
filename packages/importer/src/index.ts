/**
 * @septcats/importer —— M12 导入器入口（纯逻辑零 IO）。
 *
 * 数据流：注入 ImportSourceFs → 解析器（markdown / notion / csvInfer）→ 计划器（plan）
 * → ImportPlan（zod 契约见 types.ts）→ desktop main 执行落库（commitOps 同源）。
 *
 * 命名说明：types.buildPlan(source, items, warnings) 是解析器内部用的纯组装函数；
 * 包根导出的 `buildPlan(source, files, existingLookup)` 是三源统一计划器（plan.ts）——
 * 此处以显式 re-export 消解两个同名 star-export 的歧义。
 */
export * from './types';
export * from './markdown';
export * from './csvInfer';
export * from './notion';
export { buildPlan, contentHashOf, finalizePlan, MAX_PLAN_ITEMS, PlanTooLargeError } from './plan';
export type { ExistingLookup, PlanSource } from './plan';
