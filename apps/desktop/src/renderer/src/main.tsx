import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { hasStoredTheme, setGlobalThemeMode, ThemeProvider } from '@septcats/ui';
// 自托管思源黑体（T50-01）：@font-face 必须最先注册，后面的 tokens.css 才引用得到族名。
import './styles/fonts.css';
import '@septcats/ui/tokens.css';
// T65-01 §1.2：配色派系层（下游覆写，必须跟在 tokens.css 之后；具体派系块见 themes.css 文件头纪律）
import '@septcats/ui/themes.css';
import { App } from './App';
import { initLocale } from './i18n';
import { syncAllCollab } from './collab/collabClient';
import { installFlushBridge, registerFlushTask } from './state/flushRegistry';

/**
 * 渲染器入口：先上 token（DESIGN.md 产物），再用 ThemeProvider 管双主题
 * （localStorage 记忆 + 跟随系统 + 120ms 交叉淡化），最后挂应用壳。
 *
 * 主题双源口径（TASK-T20-02 §0.C）：真相源 = localStorage（ThemeProvider 现行为）。
 * 仅当 localStorage 无 theme 时用 settings.theme 作一次性种子（setGlobalThemeMode →
 * Provider 的 setMode 管道 → 持久化到 localStorage），不做双向同步。
 * 判定必须在挂载前完成——Provider 挂载即写回默认 'system'，挂载后判定恒真。
 * 读取失败不拦路——退 localStorage/system。
 *
 * locale 种子（TASK-T25-01 §0.A；T43-01-1）：localePref 标记显式为 'system' → 系统
 * 语言；无标记或标记为显式 locale → settings.locale（显式选择重启后经 settings 恢复）。
 * settings 未就绪（catch）→ 系统语言兜底。
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('Renderer mount failed: #root not found');
}

const shouldSeedTheme = !hasStoredTheme();

/**
 * T54-01 §1①：装关窗冲刷桥（挂载前装好——main 的 editor:flush 可能来得比 React 挂载早，
 * 此时无注册任务 → 立即 ack（task 数 0），绝不因未装而让 main 走 2s 超时）。
 */
installFlushBridge();
// 协作层上行防抖尾（打开的每页 Y.Doc）也须在关窗前冲掉（T54-01 §1①）
registerFlushTask(syncAllCollab);

void window.septcats.settings
  .get()
  .then((s) => {
    if (shouldSeedTheme) {
      setGlobalThemeMode(s.theme);
    }
    initLocale(s.locale);
  })
  .catch(() => {
    /* settings 未就绪（DbServer/文件异常）：主题保持 localStorage/system，语言按系统 */
    initLocale(undefined);
  });

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
