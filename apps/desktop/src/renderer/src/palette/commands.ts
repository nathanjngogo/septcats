/**
 * commands.ts —— 命令面板的静态命令清单（TASK-T8-01 §3）。
 *
 * 两层结构：
 * - `COMMAND_DEFS`：纯数据（id / label / hint / 拼音+英文 aliases），palette.test.ts 直测；
 * - `bindPaletteCommands(deps)`：App 装配时注入真实行为（pagesActions / 主题 / 通知），
 *   本模块不 import store / React —— 数据与行为解耦，测试零副作用。
 *
 * 别名口径与 editor slashMenu 一致：全拼 + 首字母缩写 + 英文。'sz' 只命中「打开设置」、
 * 'yin' 无命中（无打印类命令）—— 这是 §4 的两条断言基线，改别名前先看测试。
 *
 * T10 变更：label/hint 文案单一来源到 i18n（`t('commands.<id>')` / `t('commandHints.<id>')`）；
 * aliases 是搜索词（拼音/英文），非展示文案，仍在本地维护。
 */
import { t } from '../i18n';
import type { AiBlockAction } from '../../../shared/aiPrompts';
import { PALETTE_IDS, type PaletteId } from '../theme/paletteState';

export interface PaletteCommandDef {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly aliases: readonly string[];
}

export interface PaletteCommand extends PaletteCommandDef {
  readonly run: () => void;
}

/** 内置命令序（同分决胜依据；§4「空 query 默认命令序稳定」以此为准）。 */
export const COMMAND_DEFS: readonly PaletteCommandDef[] = [
  { id: 'page.new', label: t('commands.page.new'), hint: t('commandHints.page.new'), aliases: ['xinjianyemian', 'xinjian', 'xjym', 'xj', 'new page', 'new'] },
  { id: 'workspace.switch', label: t('commands.workspace.switch'), hint: t('commandHints.workspace.switch'), aliases: ['qiehuangongzuochu', 'qiehuan', 'qh gzc', 'switch workspace', 'workspace'] },
  { id: 'app.settings', label: t('commands.app.settings'), hint: t('commandHints.app.settings'), aliases: ['shezhi', 'sz', 'settings', 'setting', 'options'] },
  { id: 'theme.light', label: t('commands.theme.light'), hint: t('commandHints.theme.light'), aliases: ['qianse', 'ys qs', 'light theme', 'theme light'] },
  { id: 'theme.dark', label: t('commands.theme.dark'), hint: t('commandHints.theme.dark'), aliases: ['shense', 'ys ss', 'dark theme', 'theme dark'] },
  { id: 'theme.system', label: t('commands.theme.system'), hint: t('commandHints.theme.system'), aliases: ['gensuixitong', 'gs xt', 'system theme', 'theme system'] },
  { id: 'app.export', label: t('commands.app.export'), hint: t('commandHints.app.export'), aliases: ['daochu', 'dc', 'export'] },
  { id: 'app.trash', label: t('commands.app.trash'), hint: t('commandHints.app.trash'), aliases: ['huishouzhan', 'hsz', 'trash', 'bin'] },
  { id: 'app.sync', label: t('commands.app.sync'), hint: t('commandHints.app.sync'), aliases: ['tongbu', 'tbmianban', 'tb', 'sync'] },
  { id: 'app.import', label: t('commands.app.import'), hint: t('commandHints.app.import'), aliases: ['daoru', 'dr', 'import'] },
  { id: 'ai.continue', label: t('commands.ai.continue'), hint: t('commandHints.ai.continue'), aliases: ['aixuxie', 'xuxie', 'aixx', 'xx', 'ai continue'] },
  { id: 'ai.summarize', label: t('commands.ai.summarize'), hint: t('commandHints.ai.summarize'), aliases: ['aizhaiyao', 'zhaiyao', 'aizy', 'zy', 'ai summarize'] },
  { id: 'ai.rewrite', label: t('commands.ai.rewrite'), hint: t('commandHints.ai.rewrite'), aliases: ['aigaixie', 'gaixie', 'aigx', 'gx', 'ai rewrite'] },
  { id: 'ai.translate', label: t('commands.ai.translate'), hint: t('commandHints.ai.translate'), aliases: ['aifanyi', 'fanyi', 'aify', 'fy', 'ai translate'] },
];

/** 命令行为依赖（App 装配时注入；测试注入 spy）。 */
export interface CommandDeps {
  createPage(): void;
  switchToNextWorkspace(): void;
  openTrash(): void;
  openSettings(): void;
  /** M12 起接入导入向导；未注入时回退 notify（palette 测试的兼容口径）。 */
  openImport?(): void;
  /**
   * T18-03：块级 AI 动作（App 派发 septcats:ai-action 事件，PageView 监听）。
   * 测试注入里可缺省（缺省 = no-op，notify 基线计数断言不受影响）。
   */
  runAiAction?(action: AiBlockAction): void;
  /**
   * T23-02 §B：另存为模板（打开命名弹窗）。提供时命令面板**追加**该命令；
   * 未提供（= 当前无选中页，装配侧经 configurePaletteCommands 摘除）则命令不出现。
   */
  saveAsTemplate?(): void;
  /**
   * T24-01 §0.A：删除页面（开二次确认弹层，确认后软删进回收站）。条件命令，
   * 口径同 saveAsTemplate：无选中页经 configurePaletteCommands 摘除（不出现、不抛错）。
   */
  deletePage?(): void;
  /**
   * T38-01：AI 对话面板开合（App 恒注入 → 命令恒出现；测试 spy deps 不注入 → 不出现，
   * 静态清单/别名基线不受影响）。
   */
  openAiChat?(): void;
  /**
   * T39-01：切换布局预设（循环 notion→focus→workbench）。App 恒注入 → 命令恒出现；
   * 测试 spy deps 不注入 → 不出现（静态清单基线不受影响）。
   */
  cycleLayoutPreset?(): void;
  /**
   * T41-01：切换当前页「全宽 / 固定宽度」（每页独立记忆）。条件命令，口径同
   * deletePage：无选中页经 configurePaletteCommands 摘除（不出现、不抛错）。
   */
  toggleFullWidth?(): void;
  /**
   * T56-01：打开使用说明书阅读视图。App 恒注入 → 命令恒出现；测试 spy deps
   * 不注入 → 不出现（静态清单/别名基线不受影响）。
   */
  openManual?(): void;
  /**
   * T57-01：打开独立布局编辑器页（整页编辑预设与细项参数）。App 恒注入 →
   * 命令恒出现；测试 spy deps 不注入 → 不出现（静态清单/别名基线不受影响）。
   */
  openLayoutEditor?(): void;
  /**
   * T66-01 §1.2：打开个人工作台（home 视图）。App 恒注入 → 命令恒出现；
   * 测试 spy deps 不注入 → 不出现（静态清单/别名基线不受影响）。
   */
  openWorkbench?(): void;
  /**
   * T65-01 §1：打开主题画廊（六派系迷你预览弹框）。App 恒注入 → 命令恒出现；
   * 测试 spy deps 不注入 → 不出现（静态清单/别名基线不受影响）。
   */
  openThemeGallery?(): void;
  /**
   * T65-01 §1：切到指定配色派系（六条独立的「切到 X 派系」命令）。App 恒注入
   * → 命令恒出现；测试 spy deps 不注入 → 不出现（静态清单/别名基线不受影响）。
   */
  setThemePalette?(id: PaletteId): void;
   * T67-01-B2-01 范围4：加锁命令（仅当前选中且未锁页出现）。与 removeLock 互斥——
   * App 按 lockedIds 二选一注入（未注入 = 无选中页，configurePaletteCommands 摘除）。
   */
  addLock?(): void;
  /**
   * T67-01-B2-01 范围4：移除锁命令（仅当前选中且已锁页出现）。与 addLock 互斥。
   */
  removeLock?(): void;
  notify(message: string): void;
  setThemeMode(mode: 'light' | 'dark' | 'system'): void;
}

/**
 * T23-02 §B：「另存为模板」命令定义。**不在静态 COMMAND_DEFS 里**——它是
 * 条件命令（仅有选中页时出现），palette.test.ts 的静态清单/别名基线因此不受影响。
 */
export const SAVE_AS_TEMPLATE_DEF: PaletteCommandDef = {
  id: 'page.saveAsTemplate',
  label: t('commands.page.saveAsTemplate'),
  hint: t('commandHints.page.saveAsTemplate'),
  aliases: ['lingscunweimoban', 'lingcunmoban', 'lingcun', 'scmb', 'save as template', 'savetemplate', 'template'],
};

/**
 * T24-01 §0.A：「删除页面」命令定义。**不在静态 COMMAND_DEFS 里**——与「另存为模板」
 * 同为条件命令（仅有选中页时出现），palette.test.ts 的静态清单/别名基线因此不受影响。
 */
export const DELETE_PAGE_DEF: PaletteCommandDef = {
  id: 'page.delete',
  label: t('commands.page.delete'),
  hint: t('commandHints.page.delete'),
  aliases: ['shanchuyemian', 'shanchu', 'scym', 'sc', 'delete page', 'delete'],
};

/**
 * T38-01：「打开 / 关闭 AI 对话」命令定义。**不在静态 COMMAND_DEFS 里**——
 * 与 saveAsTemplate/deletePage 同走 deps 门（App 恒注入 openAiChat → 恒出现；
 * palette 基线测试的 spy deps 不注入 → 静态清单/别名基线不受影响）。
 */
export const AI_CHAT_DEF: PaletteCommandDef = {
  id: 'app.aiChat',
  label: t('commands.app.aiChat'),
  hint: t('commandHints.app.aiChat'),
  aliases: ['aiduihua', 'duihua', 'aichat', 'chat', 'ai chat'],
};

/**
 * T39-01：「切换布局预设」命令定义。**不在静态 COMMAND_DEFS 里**——同 openAiChat
 * 走 deps 门（App 恒注入 cycleLayoutPreset → 恒出现；palette 基线测试的 spy deps
 * 不注入 → 静态清单/别名基线不受影响）。
 */
export const LAYOUT_PRESET_DEF: PaletteCommandDef = {
  id: 'app.layoutPreset',
  label: t('commands.app.layoutPreset'),
  hint: t('commandHints.app.layoutPreset'),
  aliases: ['bujuyshezhi', 'bujuys', 'buju', 'qiehuanbuju', 'layout preset', 'layout', 'preset'],
};

/**
 * T41-01：「全宽 / 固定宽度」切换命令定义。**不在静态 COMMAND_DEFS 里**——
 * 与 deletePage 同为条件命令（仅有选中页时出现，configurePaletteCommands 摘除），
 * palette.test.ts 的静态清单/别名基线因此不受影响。
 */
export const TOGGLE_FULL_WIDTH_DEF: PaletteCommandDef = {
  id: 'page.toggleFullWidth',
  label: t('commands.page.toggleFullWidth'),
  hint: t('commandHints.page.toggleFullWidth'),
  aliases: ['quankuan', 'quan', 'qw', 'gudingkuandu', 'gdkd', 'full width', 'fullwidth', 'full'],
};

/**
 * T56-01：「使用说明书」命令定义。**不在静态 COMMAND_DEFS 里**——同 openAiChat
 * 走 deps 门（App 恒注入 openManual → 恒出现；palette 基线测试的 spy deps 不注入
 * → 静态清单/别名基线不受影响）。
 */
export const MANUAL_DEF: PaletteCommandDef = {
  id: 'app.manual',
  label: t('commands.app.manual'),
  hint: t('commandHints.app.manual'),
  aliases: ['shiyongshuomingshu', 'shuomingshu', 'sy sms', 'sms', 'help', 'manual', 'user manual'],
};

/**
 * T57-01：「布局编辑器」命令定义。**不在静态 COMMAND_DEFS 里**——同 openManual
 * 走 deps 门（App 恒注入 openLayoutEditor → 恒出现；palette 基线测试的 spy deps
 * 不注入 → 静态清单/别名基线不受影响）。
 */
export const LAYOUT_EDITOR_DEF: PaletteCommandDef = {
  id: 'app.layoutEditor',
  label: t('commands.app.layoutEditor'),
  hint: t('commandHints.app.layoutEditor'),
  aliases: ['bujubianjiqi', 'bujubjq', 'bianjibuju', 'layout editor', 'layout editor page', 'editor layout'],
};

/**
 * T66-01 §1.2：「工作台」命令定义。**不在静态 COMMAND_DEFS 里**——同 openManual
 * 走 deps 门（App 恒注入 openWorkbench → 恒出现；palette 基线测试的 spy deps
 * 不注入 → 静态清单/别名基线不受影响）。
 */
export const WORKBENCH_DEF: PaletteCommandDef = {
  id: 'app.workbench',
  label: t('commands.app.workbench'),
  hint: t('commandHints.app.workbench'),
  aliases: ['gongzuotai', 'gzt', 'home', 'go home', 'workbench'],
};

/**
 * T65-01 §1：主题画廊命令。**不在静态 COMMAND_DEFS 里**——同 openManual 走 deps 门
 * （App 恒注入 openThemeGallery → 恒出现；palette 基线测试的 spy deps 不注入 →
 * 静态清单/别名基线不受影响）。
 */
export const THEME_GALLERY_DEF: PaletteCommandDef = {
  id: 'theme.palette',
  label: t('commands.theme.palette'),
  hint: t('commandHints.theme.palette'),
  aliases: ['zhutiuhualang', 'zhutihualang', 'hualang', 'tzhl', 'theme gallery', 'gallery', 'palette'],
};

/**
 * T65-01 §1：六条「切到 X 派系」命令（可发现性优先，不合并成循环）。
 * 每条都按派系 id 动态生成 label/aliases（拼音 + 英文），不在静态 COMMAND_DEFS 里，
 * 走 deps 门（App 恒注入 setThemePalette → 恒出现）。
 */
const PALETTE_SWITCH_ALIASES: Record<PaletteId, readonly string[]> = {
  mono: ['danse', 'dansetiaose', 'mono', 'monochrome'],
  oled: ['chunhei', 'oled', 'pureblack', 'black'],
  contrast: ['gaoduibi', 'gaoduidibi', 'contrast', 'highcontrast'],
  paper: ['zhizhang', 'paper'],
  slate: ['shimo', 'shimoohui', 'slate', 'graphite'],
  moss: ['taiqing', 'moss'],
};

/** 派系 id → 命令 def（label/hint 在绑定时经 t() 现取，见 bindPaletteCommands）。 */
export function themeSwitchDef(id: PaletteId): PaletteCommandDef {
  return {
    id: `theme.switch.${id}`,
    label: t('commands.theme.switch'),
    hint: t('commandHints.theme.switch'),
    aliases: PALETTE_SWITCH_ALIASES[id],
  };
}

 * T67-01-B2-01 范围4：「添加页面密码锁」命令定义。**不在静态 COMMAND_DEFS 里**——
 * 与 page.delete / page.toggleFullWidth 同走 deps 门（仅选中页且未锁时出现；
 * configurePaletteCommands 在无选中页时摘除）。与 REMOVE_LOCK_DEF 互斥——App 按
 * lockedIds 二选一注入，绝不两条同现。
 */
export const ADD_LOCK_DEF: PaletteCommandDef = {
  id: 'page.addLock',
  label: t('commands.page.addLock'),
  hint: t('commandHints.page.addLock'),
  aliases: ['tianjiashangma', 'shangma', 'tjsm', 'suo', 'add lock', 'lock page', 'set password'],
};

/**
 * T67-01-B2-01 范围4：「移除页面密码锁」命令定义。**不在静态 COMMAND_DEFS 里**——
 * 与 ADD_LOCK_DEF 互斥（仅选中页且已锁时出现）。
 */
export const REMOVE_LOCK_DEF: PaletteCommandDef = {
  id: 'page.removeLock',
  label: t('commands.page.removeLock'),
  hint: t('commandHints.page.removeLock'),
  aliases: ['yichushangma', 'jiesuo', 'ycsm', 'unlock page', 'remove lock', 'remove password'],
};

/** id → 行为绑定（穷尽 switch：新增 def 必须补分支）。 */
export function bindPaletteCommands(deps: CommandDeps): PaletteCommand[] {
  // T25-01：label/hint 在绑定时经 t() 现取（COMMAND_DEFS 的静态值只作模块加载期
  // 快照；locale 切换后 App 重装配命令即可拿到新语言文案）
  const commands = COMMAND_DEFS.map((def) => {
    const localized: PaletteCommandDef = {
      ...def,
      label: t(`commands.${def.id}`),
      hint: t(`commandHints.${def.id}`),
    };
    const run = (): void => {
      switch (def.id) {
        case 'page.new':
          deps.createPage();
          return;
        case 'workspace.switch':
          deps.switchToNextWorkspace();
          return;
        case 'app.settings':
          deps.openSettings();
          return;
        case 'theme.light':
          deps.setThemeMode('light');
          return;
        case 'theme.dark':
          deps.setThemeMode('dark');
          return;
        case 'theme.system':
          deps.setThemeMode('system');
          return;
        case 'app.export':
          deps.notify(t('commands.app.exportLater'));
          return;
        case 'app.trash':
          deps.openTrash();
          return;
        case 'app.sync':
          deps.notify(t('commands.app.syncLater'));
          return;
        case 'app.import':
          if (deps.openImport !== undefined) {
            deps.openImport();
          } else {
            deps.notify(t('commands.app.importLater'));
          }
          return;
        case 'ai.continue':
        case 'ai.summarize':
        case 'ai.rewrite':
        case 'ai.translate': {
          const action = def.id.slice('ai.'.length) as AiBlockAction;
          if (deps.runAiAction !== undefined) {
            deps.runAiAction(action);
          }
          return;
        }
      }
    };
    return { ...localized, run };
  });
  if (deps.saveAsTemplate !== undefined) {
    commands.push({
      ...SAVE_AS_TEMPLATE_DEF,
      label: t('commands.page.saveAsTemplate'),
      hint: t('commandHints.page.saveAsTemplate'),
      run: deps.saveAsTemplate,
    });
  }
  if (deps.deletePage !== undefined) {
    commands.push({
      ...DELETE_PAGE_DEF,
      label: t('commands.page.delete'),
      hint: t('commandHints.page.delete'),
      run: deps.deletePage,
    });
  }
  if (deps.openAiChat !== undefined) {
    commands.push({
      ...AI_CHAT_DEF,
      label: t('commands.app.aiChat'),
      hint: t('commandHints.app.aiChat'),
      run: deps.openAiChat,
    });
  }
  if (deps.cycleLayoutPreset !== undefined) {
    commands.push({
      ...LAYOUT_PRESET_DEF,
      label: t('commands.app.layoutPreset'),
      hint: t('commandHints.app.layoutPreset'),
      run: deps.cycleLayoutPreset,
    });
  }
  if (deps.toggleFullWidth !== undefined) {
    commands.push({
      ...TOGGLE_FULL_WIDTH_DEF,
      label: t('commands.page.toggleFullWidth'),
      hint: t('commandHints.page.toggleFullWidth'),
      run: deps.toggleFullWidth,
    });
  }
  if (deps.openManual !== undefined) {
    commands.push({
      ...MANUAL_DEF,
      label: t('commands.app.manual'),
      hint: t('commandHints.app.manual'),
      run: deps.openManual,
    });
  }
  if (deps.openLayoutEditor !== undefined) {
    commands.push({
      ...LAYOUT_EDITOR_DEF,
      label: t('commands.app.layoutEditor'),
      hint: t('commandHints.app.layoutEditor'),
      run: deps.openLayoutEditor,
    });
  }
  if (deps.openWorkbench !== undefined) {
    commands.push({
      ...WORKBENCH_DEF,
      label: t('commands.app.workbench'),
      hint: t('commandHints.app.workbench'),
      run: deps.openWorkbench,
    });
  }
  // T65-01 §1：主题画廊 + 六条「切到 X 派系」命令（App 恒注入 → 恒出现）。
  if (deps.openThemeGallery !== undefined) {
    commands.push({
      ...THEME_GALLERY_DEF,
      label: t('commands.theme.palette'),
      hint: t('commandHints.theme.palette'),
      run: deps.openThemeGallery,
    });
  }
  if (deps.setThemePalette !== undefined) {
    for (const id of PALETTE_IDS) {
      const name = t(`settings.appearance.paletteNames.${id}`);
      commands.push({
        ...themeSwitchDef(id),
        label: t('commands.theme.switch').replace('{name}', name),
        hint: t('commandHints.theme.switch').replace('{name}', name),
        run: (): void => {
          deps.setThemePalette?.(id);
        },
      });
    }
  // T67-01-B2-01 范围4：加锁/移除锁命令（与 addLock/removeLock deps 同门；二选一由
  // App 按 lockedIds 决定注入哪条，无选中页时 configurePaletteCommands 整键摘除）。
  if (deps.addLock !== undefined) {
    commands.push({
      ...ADD_LOCK_DEF,
      label: t('commands.page.addLock'),
      hint: t('commandHints.page.addLock'),
      run: deps.addLock,
    });
  }
  if (deps.removeLock !== undefined) {
    commands.push({
      ...REMOVE_LOCK_DEF,
      label: t('commands.page.removeLock'),
      hint: t('commandHints.page.removeLock'),
      run: deps.removeLock,
    });
  }
  return commands;
}

/**
 * T23-02 §B 装配口径：无选中页 → 「另存为模板」**不出现**（不是置灰），
 * T24-01 §0.A 起「删除页面」同口径，T41-01 起「全宽 / 固定宽度」同口径
 * （页面级开关对无选中页无意义）；其余命令不受影响。App 在 selectedId 变化时重装配。
 */
export function configurePaletteCommands(deps: CommandDeps, hasSelection: boolean): PaletteCommand[] {
  if (hasSelection) {
    return bindPaletteCommands(deps);
  }
  const scoped = { ...deps };
  delete scoped.saveAsTemplate; // exactOptionalPropertyTypes：不能显式传 undefined，改整键删除
  delete scoped.deletePage;
  delete scoped.toggleFullWidth;
  delete scoped.addLock; // T67-01-B2-01：无选中页 → 加锁/移除锁命令不出现（不抛错）
  delete scoped.removeLock;
  return bindPaletteCommands(scoped);
}
