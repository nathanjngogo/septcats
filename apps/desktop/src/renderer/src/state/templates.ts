/**
 * state/templates.ts —— 模板 slice（TASK-T23-02 §E）。
 *
 * - 单一 store（`store.ts` 的零依赖 Zustand 同形实现，与 state/pages.ts 同口径）；
 * - **所有模板 IPC 调用集中在此**（window.septcats.templates.*），UI 组件只订阅
 *   store / 调 actions —— 命令面板分组、侧栏「新建页面 ▾」子菜单、设置「模板」
 *   区块三处消费同一份 `templates` 数组，新建/重命名/删除后 loadTemplates 统一刷新；
 * - 「另存为模板」的弹窗可见性也在本 slice（saveDialogOpen）：命令面板命令触发，
 *   弹窗本体由 App 级 TemplateSaveDialog 渲染（面板执行命令后自身关闭）；
 * - §0.A：saveFromPage 只传 title（icon 继承源页），icon 在 UI 仅作展示。
 */
import type { SeptcatsApi } from '../../../types/window';
import type { TemplateKind, TemplateMeta } from '../../../main/templates';
import { errorText, t } from '../i18n';
import { pagesActions, pagesStore, pushToast } from './pages';
import { createStore, useStore } from './store';

export type { TemplateKind, TemplateMeta };

export type TemplatesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TemplatesState {
  status: TemplatesStatus;
  error: string | null;
  /** 模板列表（服务端按 updated_at 倒序返回；这里原样保存）。 */
  templates: TemplateMeta[];
  /** 「另存为模板」命名弹窗可见（§B）。 */
  saveDialogOpen: boolean;
}

const initialState: TemplatesState = {
  status: 'idle',
  error: null,
  templates: [],
  saveDialogOpen: false,
};

export const templatesStore = createStore<TemplatesState>(initialState);

/** 选择器订阅（选择器请返回引用稳定的切片）。 */
export function useTemplates<T>(selector: (state: TemplatesState) => T): T {
  return useStore(templatesStore, selector);
}

// ---------------------------------------------------------------------------
// 桥 / 错误
// ---------------------------------------------------------------------------

function bridge(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload did not inject window.septcats');
  }
  return value;
}

/**
 * 用户可见错误统一走 errorText（T25-01 §0.B：错误码 → t() 键映射表，见 i18n/index.ts）。
 */
export function describeTemplateError(error: unknown): string {
  return errorText(error);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

export const templatesActions = {
  /** 拉取模板列表（面板打开 / 侧栏子菜单展开 / 设置区块挂载 / 写操作后共用）。 */
  async loadTemplates(): Promise<void> {
    templatesStore.setState((state) => ({ ...state, status: 'loading', error: null }));
    try {
      const { templates } = await bridge().templates.list({});
      templatesStore.setState((state) => ({
        ...state,
        status: 'ready',
        error: null,
        templates: [...templates],
      }));
    } catch (error) {
      // 读失败不打断 UI（三处入口回落空态/既有内容），错误留在 slice 内
      templatesStore.setState((state) => ({
        ...state,
        status: 'error',
        error: describeTemplateError(error),
      }));
    }
  },

  /** §B：「另存为模板」入口（无选中页时静默不开启——命令不得抛错）。 */
  beginSaveFromPage(): void {
    if (pagesStore.getState().selectedId === null) {
      return;
    }
    templatesStore.setState((state) => ({ ...state, saveDialogOpen: true }));
  },

  cancelSaveFromPage(): void {
    templatesStore.setState((state) => ({ ...state, saveDialogOpen: false }));
  },

  /** §B：另存为模板（只传 title，icon 继承源页 §0.A）。成功 → 轻提示 + 刷新列表。 */
  async saveFromPage(pageId: string, title: string): Promise<boolean> {
    try {
      await bridge().templates.saveFromPage({ pageId, title });
      pushToast(t('templates.toastSaved'), 'success');
      await templatesActions.loadTemplates();
      return true;
    } catch (error) {
      pushToast(describeTemplateError(error), 'danger');
      return false;
    }
  },

  /** §C：从模板新建页（根层）→ 对账页面树 → 选中新页。返回新页 id（失败 null）。 */
  async createFromTemplate(templateId: string): Promise<string | null> {
    try {
      const { pageId } = await bridge().templates.createPage({ templateId, parentId: null });
      await pagesActions.refresh();
      pagesActions.selectPage(pageId);
      return pageId;
    } catch (error) {
      pushToast(describeTemplateError(error), 'danger');
      return null;
    }
  },

  /** §D：重命名模板（icon 不传 = 保持不变）。成功 → 轻提示 + 刷新列表。 */
  async renameTemplate(id: string, title: string): Promise<boolean> {
    try {
      await bridge().templates.rename({ id, title });
      pushToast(t('templates.toastRenamed'), 'success');
      await templatesActions.loadTemplates();
      return true;
    } catch (error) {
      pushToast(describeTemplateError(error), 'danger');
      return false;
    }
  },

  /** §D：删除模板（软删）。成功 → 轻提示 + 刷新列表。 */
  async deleteTemplate(id: string): Promise<boolean> {
    try {
      await bridge().templates.remove({ id });
      pushToast(t('templates.toastDeleted'), 'success');
      await templatesActions.loadTemplates();
      return true;
    } catch (error) {
      pushToast(describeTemplateError(error), 'danger');
      return false;
    }
  },

  /** §范围4：另存为工作台模板（kind='workbench'；layout+seedPages 落 templates 数据根）。
   * 成功 → 轻提示 + 刷新列表（「我的模板」随即出现）。 */
  async saveWorkbench(input: {
    title: string;
    layout: { v: 2; order: string[]; hidden: string[] };
    seedPages: Array<{ title: string; body: string }>;
  }): Promise<boolean> {
    try {
      await bridge().templates.saveWorkbench(input);
      pushToast(t('workbench.templateSaved'), 'success');
      await templatesActions.loadTemplates();
      return true;
    } catch (error) {
      pushToast(describeTemplateError(error), 'danger');
      return false;
    }
  },
};
