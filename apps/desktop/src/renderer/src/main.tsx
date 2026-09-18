import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { hasStoredTheme, setGlobalThemeMode, ThemeProvider } from '@septcats/ui';
import '@septcats/ui/tokens.css';
import { App } from './App';
import { initLocale } from './i18n';

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
 * locale 种子（TASK-T25-01 §0.A）：回落顺序 settings.locale → 系统语言 → zh-CN；
 * 「跟随系统」以 renderer localStorage 标记表达（见 i18n/index.ts），标记存在时
 * 直接按 navigator.language 解析。settings 未就绪（catch）→ 系统语言兜底。
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('Renderer mount failed: #root not found');
}

const shouldSeedTheme = !hasStoredTheme();

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
