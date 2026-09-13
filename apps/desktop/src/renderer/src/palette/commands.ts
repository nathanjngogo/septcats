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
 */

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
  { id: 'page.new', label: '新建页面', hint: '在根层创建空白页', aliases: ['xinjianyemian', 'xinjian', 'xjym', 'xj', 'new page', 'new'] },
  { id: 'workspace.switch', label: '切换工作区', hint: '切换到下一个工作区', aliases: ['qiehuangongzuochu', 'qiehuan', 'qh gzc', 'switch workspace', 'workspace'] },
  { id: 'app.settings', label: '打开设置', hint: '偏好与应用设置', aliases: ['shezhi', 'sz', 'settings', 'setting', 'options'] },
  { id: 'theme.light', label: '切换主题：浅色', hint: '界面主题', aliases: ['qianse', 'ys qs', 'light theme', 'theme light'] },
  { id: 'theme.dark', label: '切换主题：深色', hint: '界面主题', aliases: ['shense', 'ys ss', 'dark theme', 'theme dark'] },
  { id: 'theme.system', label: '切换主题：跟随系统', hint: '界面主题', aliases: ['gensuixitong', 'gs xt', 'system theme', 'theme system'] },
  { id: 'app.export', label: '导出', hint: '导出当前工作区快照', aliases: ['daochu', 'dc', 'export'] },
  { id: 'app.trash', label: '回收站', hint: '查看已删除页面', aliases: ['huishouzhan', 'hsz', 'trash', 'bin'] },
  { id: 'app.sync', label: '同步面板', hint: '查看同步状态', aliases: ['tongbu', 'tbmianban', 'tb', 'sync'] },
  { id: 'app.import', label: '导入', hint: '导入快照文件', aliases: ['daoru', 'dr', 'import'] },
];

/** 命令行为依赖（App 装配时注入；测试注入 spy）。 */
export interface CommandDeps {
  createPage(): void;
  switchToNextWorkspace(): void;
  openTrash(): void;
  notify(message: string): void;
  setThemeMode(mode: 'light' | 'dark' | 'system'): void;
}

/** id → 行为绑定（穷尽 switch：新增 def 必须补分支）。 */
export function bindPaletteCommands(deps: CommandDeps): PaletteCommand[] {
  return COMMAND_DEFS.map((def) => {
    const run = (): void => {
      switch (def.id) {
        case 'page.new':
          deps.createPage();
          return;
        case 'workspace.switch':
          deps.switchToNextWorkspace();
          return;
        case 'app.settings':
          deps.notify('设置面板将在后续里程碑提供');
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
          deps.notify('导出将在后续里程碑提供');
          return;
        case 'app.trash':
          deps.openTrash();
          return;
        case 'app.sync':
          deps.notify('同步面板将在后续里程碑提供');
          return;
        case 'app.import':
          deps.notify('导入将在后续里程碑提供');
          return;
      }
    };
    return { ...def, run };
  });
}
