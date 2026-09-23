/**
 * workbenchTemplates.ts —— 主进程「工作台内置模板」只读服务（TASK-T72-01 §范围3）。
 *
 * 职责：把 renderer 的 `workbenchTemplates:list` 翻译成**随包资源目录**读取
 * （packaged = `<resourcesPath>/workbench-templates/*.json`；dev = 应用目录
 * `resources/workbench-templates/*.json`，照 main/tray.ts 的三元组兜底）。
 *
 * 与 templates.ts 同纪律：
 * - 零外联（T72 红线：模板 JSON 不得内嵌 URL 请求，本服务不拼接任何外链）；
 * - 坏 JSON 跳过不抛（§范围3「坏 JSON 跳过不抛，返回 {templates: [...]}」）；
 * - 不 import electron——目录解析用 `node:fs`/`node:path` + `process.resourcesPath`，
 *   vitest 纯 Node 端到端测试可注入 `resourcesDir`（test/workbenchTemplates.test.ts）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKBENCH_TEMPLATES_CHANNELS } from '../shared/ipc';
import { TemplatesApiError, toTemplatesError, type TemplatesIpcRegistrar } from './templates';

/** 内置工作台模板（与范围3 JSON 形状一一对应；order/hidden 为原始字符串，归一化交 renderer）。 */
export interface WorkbenchTemplate {
  id: string;
  title: string;
  desc: string;
  layout: {
    v: 2;
    order: string[];
    hidden: string[];
  };
  seedPages: Array<{ title: string; body: string }>;
}

/**
 * 纯函数：解析单个内置模板 JSON 文本 → WorkbenchTemplate | null。
 * - 坏 JSON / 非对象 / 缺 title / 布局非 {v:2,order[],hidden[]} → null（跳过不抛）；
 * - order/hidden/seedPages 仅做「是字符串数组」的兜底过滤（与 cards 注册表的交集校验
 *   即「未知 id 丢弃 + 补尾」由 renderer 侧 sanitizeCardsPersist 完成，本服务不持有
 *   ALL_CARD_IDS）。
 */
export function parseWorkbenchTemplateFile(content: string, fallbackId: string): WorkbenchTemplate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.title !== 'string' || record.title.length === 0) {
    return null;
  }
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : fallbackId;
  const desc = typeof record.desc === 'string' ? record.desc : '';
  const layoutRaw = record.layout;
  if (typeof layoutRaw !== 'object' || layoutRaw === null || Array.isArray(layoutRaw)) {
    return null;
  }
  const layout = layoutRaw as Record<string, unknown>;
  if (layout.v !== 2 || !Array.isArray(layout.order) || !Array.isArray(layout.hidden)) {
    return null;
  }
  const order = layout.order.filter((item): item is string => typeof item === 'string');
  const hidden = layout.hidden.filter((item): item is string => typeof item === 'string');
  const seedPagesRaw = Array.isArray(record.seedPages) ? record.seedPages : [];
  const seedPages = seedPagesRaw.map((entry) => {
    const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    return {
      title: typeof row.title === 'string' ? row.title : '',
      body: typeof row.body === 'string' ? row.body : '',
    };
  });
  return { id, title: record.title, desc, layout: { v: 2, order, hidden }, seedPages };
}

export interface WorkbenchTemplatesService {
  /** 内置模板清单（坏 JSON 跳过不抛）。 */
  list(): Promise<{ templates: WorkbenchTemplate[] }>;
}

export interface WorkbenchTemplatesServiceOptions {
  /** 显式资源根目录（测试注入 / 主进程按 tray 模式解析后传入）。 */
  resourcesDir?: string;
}

/** 资源根候选（顺序 = 优先级）：打包 resourcesPath → out/main 上溯两级（dev）。 */
function candidateDirs(): string[] {
  const dirs: string[] = [];
  if (typeof process !== 'undefined' && typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    dirs.push(process.resourcesPath);
  }
  try {
    // dev = 应用目录 `resources/workbench-templates`（与打包 `<resourcesPath>/workbench-templates` 对齐；
    // T72 真机首轮抓到 PM 修正：原少拼一层 resources/ 致 dev 态候选目录永不存在 → 内置模板空列表）
    dirs.push(join(__dirname, '..', '..', 'resources'));
    dirs.push(join(process.cwd(), 'resources'));
  } catch {
    // __dirname 不可用时忽略（仅打包态以 resourcesPath 为准）
  }
  return dirs;
}

export function createWorkbenchTemplatesService(
  options: WorkbenchTemplatesServiceOptions = {},
): WorkbenchTemplatesService {
  return {
    async list() {
      const baseDirs = options.resourcesDir !== undefined ? [options.resourcesDir] : candidateDirs();
      const templates: WorkbenchTemplate[] = [];
      for (const base of baseDirs) {
        const dir = join(base, 'workbench-templates');
        if (!existsSync(dir)) {
          continue;
        }
        let files: string[] = [];
        try {
          files = readdirSync(dir).filter((name) => name.endsWith('.json'));
        } catch {
          continue;
        }
        for (const file of files) {
          const fallbackId = file.replace(/\.json$/, '');
          let content: string;
          try {
            content = readFileSync(join(dir, file), 'utf8');
          } catch {
            continue;
          }
          const parsed = parseWorkbenchTemplateFile(content, fallbackId);
          if (parsed !== null) {
            templates.push(parsed);
          }
          // 坏 JSON 跳过不抛（T72 §范围3）
        }
        break; // 第一个存在的目录即命中，其余候选不再尝试
      }
      return { templates };
    },
  };
}

/**
 * 注册 workbenchTemplates:list（DI：不 import electron）。`service === null` 时统一回
 * `E_INVARIANT`（与 templates 降级一致）。坏 JSON 已在服务内消化（list 永不抛）。
 */
export function registerWorkbenchTemplatesIpc(
  service: WorkbenchTemplatesService | null,
  registrar: TemplatesIpcRegistrar,
): void {
  const requireService = (): WorkbenchTemplatesService => {
    if (service === null) {
      throw new TemplatesApiError('E_INVARIANT', '工作台模板服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const fail = (error: unknown): never => {
    const mapped = toTemplatesError(error);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  };

  registrar.handle(WORKBENCH_TEMPLATES_CHANNELS.list, async (): Promise<unknown> => {
    try {
      return await requireService().list();
    } catch (error) {
      return fail(error);
    }
  });
}
