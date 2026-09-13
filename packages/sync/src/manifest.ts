import { SCHEMA_VERSION, stableStringify, type ActorId } from '@septcats/core';

/**
 * manifest.json 读写（任务书 §4）：设备表 / 水位 / 快照号 / retention。
 *
 * - `decodeManifest` 非法一律返回 null（不抛），由调用方决定降级；
 * - `mergeManifest` 语义：设备表并集、水位取 max、schema_ver 取 min（保守），冲突不丢设备；
 * - 版本协商：schema_ver 高于本端可理解版本（> SCHEMA_VERSION）视为「未来」，拒绝解码。
 */

/** 单台设备在 manifest 里的水位与版本信息。 */
export interface ManifestDevice {
  /** 该设备已知的最大 Lamport 计数。 */
  last_lamport: number;
  /** 该设备最近一次被观测到的墙上时间（ms）。 */
  last_seen_at: number;
  client_ver: string;
}

export interface Manifest {
  schema_ver: number;
  created_at: number;
  updated_at: number;
  devices: Record<ActorId, ManifestDevice>;
  /** covers_through = 已折叠进快照的最大 lamport。 */
  snapshot: { seq: number; lamport: number; covers_through: number };
  retention_days: number;
  /** 本目录已见最大 lamport。 */
  segment_watermark: number;
}

/** ActorId：8-32 位 [a-z0-9]（与 core.actorIdSchema 同源，避免在本包引入 zod 直连）。 */
const ACTOR_ID_RE = /^[a-z0-9]{8,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPosInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function parseDeviceEntry(value: unknown): ManifestDevice | null {
  if (!isRecord(value)) {
    return null;
  }
  const last_lamport = value['last_lamport'];
  const last_seen_at = value['last_seen_at'];
  const client_ver = value['client_ver'];
  if (!isNonNegInt(last_lamport) || !isNonNegInt(last_seen_at) || typeof client_ver !== 'string') {
    return null;
  }
  return { last_lamport, last_seen_at, client_ver };
}

/** 稳定键序序列化（复用 core.stableStringify，保证「同内容同字节」）。 */
export function encodeManifest(manifest: Manifest): string {
  return stableStringify(manifest);
}

/** 解码 manifest.json；非法（坏 JSON / 缺字段 / 类型错 / 未来 schema_ver）一律返回 null，不抛。 */
export function decodeManifest(text: string): Manifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) {
    return null;
  }

  const schema_ver = raw['schema_ver'];
  if (!isPosInt(schema_ver)) {
    return null;
  }
  // 版本协商：未来版本（本端不理解的 manifest 格式）拒绝解码。
  if (schema_ver > SCHEMA_VERSION) {
    return null;
  }

  const created_at = raw['created_at'];
  const updated_at = raw['updated_at'];
  const retention_days = raw['retention_days'];
  const segment_watermark = raw['segment_watermark'];
  if (
    !isNonNegInt(created_at) ||
    !isNonNegInt(updated_at) ||
    !isNonNegInt(retention_days) ||
    !isNonNegInt(segment_watermark)
  ) {
    return null;
  }

  const devicesRaw = raw['devices'];
  if (!isRecord(devicesRaw)) {
    return null;
  }
  const devices: Record<string, ManifestDevice> = {};
  for (const [key, value] of Object.entries(devicesRaw)) {
    if (!ACTOR_ID_RE.test(key)) {
      return null;
    }
    const entry = parseDeviceEntry(value);
    if (entry === null) {
      return null;
    }
    devices[key] = entry;
  }

  const snapshotRaw = raw['snapshot'];
  if (!isRecord(snapshotRaw)) {
    return null;
  }
  const seq = snapshotRaw['seq'];
  const lamport = snapshotRaw['lamport'];
  const covers_through = snapshotRaw['covers_through'];
  if (!isNonNegInt(seq) || !isNonNegInt(lamport) || !isNonNegInt(covers_through)) {
    return null;
  }

  return {
    schema_ver,
    created_at,
    updated_at,
    devices,
    snapshot: { seq, lamport, covers_through },
    retention_days,
    segment_watermark,
  };
}

/**
 * 合并两份 manifest：
 * - 设备表并集，重叠设备 last_lamport / last_seen_at 取 max，client_ver 取最近活跃一侧；
 * - schema_ver 取 min（保守，确保双端都能读懂）；
 * - 快照水位 / segment_watermark / retention_days 均取 max（水位不倒退、保留窗口不缩短）；
 * - 冲突不丢设备：任何一侧出现的设备键都不会被丢弃。
 */
export function mergeManifest(local: Manifest, remote: Manifest): Manifest {
  const keys = new Set([...Object.keys(local.devices), ...Object.keys(remote.devices)]);
  const devices: Record<string, ManifestDevice> = {};
  for (const key of keys) {
    const l = local.devices[key];
    const r = remote.devices[key];
    if (l !== undefined && r !== undefined) {
      const newer = r.last_seen_at >= l.last_seen_at ? r : l;
      devices[key] = {
        last_lamport: Math.max(l.last_lamport, r.last_lamport),
        last_seen_at: Math.max(l.last_seen_at, r.last_seen_at),
        client_ver: newer.client_ver,
      };
    } else if (r !== undefined) {
      devices[key] = { last_lamport: r.last_lamport, last_seen_at: r.last_seen_at, client_ver: r.client_ver };
    } else if (l !== undefined) {
      devices[key] = { last_lamport: l.last_lamport, last_seen_at: l.last_seen_at, client_ver: l.client_ver };
    }
  }

  return {
    schema_ver: Math.min(local.schema_ver, remote.schema_ver),
    created_at: Math.min(local.created_at, remote.created_at),
    updated_at: Math.max(local.updated_at, remote.updated_at),
    devices,
    snapshot: {
      seq: Math.max(local.snapshot.seq, remote.snapshot.seq),
      lamport: Math.max(local.snapshot.lamport, remote.snapshot.lamport),
      covers_through: Math.max(local.snapshot.covers_through, remote.snapshot.covers_through),
    },
    retention_days: Math.max(local.retention_days, remote.retention_days),
    segment_watermark: Math.max(local.segment_watermark, remote.segment_watermark),
  };
}
