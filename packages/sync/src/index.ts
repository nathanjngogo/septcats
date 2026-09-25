/**
 * @septcats/sync —— 同步引擎核心（M8a，纯逻辑零 IO 副作用）。
 *
 * 唯一 IO 面 = SyncFs（fs.ts）：测试用 MemoryFs 注入故障，真机由 runtime 注入 NodeFs。
 * A 阶段交付：错误码/报告骨架、SyncFs、段命名、攒段写入。
 * 合并/快照/GC（manifest/merger/snapshot/gc/dedupe/quarantine）于 B/C 阶段补齐。
 */

export * from './errors';
export * from './fs';
export * from './naming';
export * from './provider';
export * from './manifest';
export * from './merger';
export * from './writer';
export * from './snapshot';
export * from './gc';
export * from './dedupe';
export * from './quarantine';
export * from './portableZip';
export * from './portableImport';
