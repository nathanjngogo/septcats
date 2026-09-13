/**
 * @septcats/importer —— M12 导入器入口（纯逻辑零 IO）。
 *
 * 数据流：注入 ImportSourceFs → 解析器（markdown / 未来 notion-zip、csv、plan）
 * → ImportPlan（zod 契约见 types.ts）→ desktop main 执行落库（commitOps 同源）。
 */
export * from './types';
export * from './markdown';
