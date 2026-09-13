import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@septcats/ui';
import '@septcats/ui/tokens.css';
import { App } from './App';

/**
 * 渲染器入口：先上 token（DESIGN.md 产物），再用 ThemeProvider 管双主题
 * （localStorage 记忆 + 跟随系统 + 120ms 交叉淡化），最后挂应用壳。
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('渲染器挂载失败：找不到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
