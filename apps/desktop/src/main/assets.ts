/**
 * assets.ts —— asset:// / attachment:// 自定义协议解析（TASK-T11-01 §C-3）。
 *
 * 裁决（最小方案）：**main 侧注册自定义协议**，渲染器不需要逐图重写 URL——
 * 任何 `<img src="asset://<hash><ext>">` 直接命中这里的 handler，从
 * `layout.attachments/<hash><ext>` 读文件返回（导入执行器的 sha256 内容寻址落盘
 * 与此一一对应）；`attachment://<hash>` 是编辑器 ImageNode 既有渲染口径
 * （packages/editor/src/types/image.ts，file_id = 纯 hash），按 hash 前缀匹配
 * attachments 目录里的唯一文件。两个 scheme 共用同一 attachments 根。
 *
 * 安全：host 一律先过 ^[0-9a-f]{64}(\.[A-Za-z0-9]+)?$ 正则再 join，路径穿越
 * （..、绝对路径、URL 编码）天然被拒；命中失败回 404，不暴露目录列表。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ASSET_SCHEME = 'asset';
export const ATTACHMENT_SCHEME = 'attachment';

/** asset://<hash><ext> 的 host 形态（执行器落盘文件名 = <hash><ext>）。 */
const ASSET_HOST = /^([0-9a-f]{64})(\.[A-Za-z0-9]+)?$/;
/** attachment://<hash> 的 host 形态（编辑器 file_id）。 */
const ATTACHMENT_HOST = /^([0-9a-f]{64})$/;

/** Electron 需在 app ready 前声明特权 scheme（standard+secure 让 <img> 可直接加载）。 */
export function assetSchemePrivileges(): Electron.CustomScheme[] {
  return [
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ];
}

/** 常见附件扩展名 → MIME（未知扩展回 octet-stream，图片渲染不受影响）。 */
function mimeOf(ext: string): string {
  const normalized = ext.toLowerCase();
  const table: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
  };
  return table[normalized] ?? 'application/octet-stream';
}

function notFound(url: string): Response {
  return new Response(`not found: ${url}`, { status: 404 });
}

/** 从目录里找 `<hash>` 或 `<hash>.<ext>` 文件（内容寻址命名约定）。 */
function findHashFile(attachmentsDir: string, hash: string): string | null {
  const exact = join(attachmentsDir, hash);
  if (existsSync(exact)) {
    return exact;
  }
  const entries = readdirSync(attachmentsDir);
  const hit = entries.find((name) => name.startsWith(`${hash}.`));
  return hit === undefined ? null : join(attachmentsDir, hit);
}

/** 构造协议 handler（Electron protocol.handle 的 (Request) => Response 面）。 */
export function createAssetRequestHandler(attachmentsDir: string): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const host = url.host.toLowerCase();

    if (url.protocol === `${ASSET_SCHEME}:`) {
      const match = ASSET_HOST.exec(host);
      if (match === null) {
        return notFound(request.url);
      }
      const file = join(attachmentsDir, `${match[1] ?? ''}${match[2] ?? ''}`);
      if (!existsSync(file)) {
        return notFound(request.url);
      }
      return new Response(new Uint8Array(readFileSync(file)), {
        headers: { 'Content-Type': mimeOf(match[2] ?? '') },
      });
    }

    // attachment://<hash>（编辑器 file_id）
    const match = ATTACHMENT_HOST.exec(host);
    if (match === null) {
      return notFound(request.url);
    }
    const file = findHashFile(attachmentsDir, match[1] ?? '');
    if (file === null) {
      return notFound(request.url);
    }
    return new Response(new Uint8Array(readFileSync(file)), {
      headers: { 'Content-Type': mimeOf(file.slice(file.lastIndexOf('.'))) },
    });
  };
}
