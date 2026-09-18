import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { hasStoredTheme, setGlobalThemeMode, ThemeProvider } from '@septcats/ui';
import '@septcats/ui/tokens.css';
import { App } from './App';

/**
 * 渲染器入口：先上 token（DESIGN.md 产物），再用 ThemeProvider 管双主题
 * （localStorage 记忆 + 跟随系统 + 120ms 交叉淡化），最后挂应用壳。
 *
 * 主题双源口径（TASK-T20-02 §0.C）：真相源 = localStorage（ThemeProvider 现行为）。
 * 仅当 localStorage 无 theme 时用 settings.theme 作一次性种子（setGlobalThemeMode →
 * Provider 的 setMode 管道 → 持久化到 localStorage），不做双向同步。
 * 判定必须在挂载前完成——Provider 挂载即写回默认 'system'，挂载后判定恒真。
 * 读取失败不拦路——退 localStorage/system。
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('渲染器挂载失败：找不到 #root 挂载点');
}

const shouldSeedTheme = !hasStoredTheme();

void window.septcats.settings
  .get()
  .then((s) => {
    if (shouldSeedTheme) {
      setGlobalThemeMode(s.theme);
    }
  })
  .catch(() => {
    /* settings 未就绪（DbServer/文件异常）：保持 localStorage/system 现状 */
  });

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
