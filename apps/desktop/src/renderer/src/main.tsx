import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setGlobalThemeMode, ThemeProvider } from '@septcats/ui';
import '@septcats/ui/tokens.css';
import { App } from './App';

/**
 * 渲染器入口：先上 token（DESIGN.md 产物），再用 ThemeProvider 管双主题
 * （localStorage 记忆 + 跟随系统 + 120ms 交叉淡化），最后挂应用壳。
 *
 * 主题真相 = main 侧 settings.json（跨设备/重装持久），localStorage 只是会话缓存：
 * 挂载前读 settings 并经事件桥播种 ThemeProvider（它的订阅走同一 setMode 管道）。
 * 读取失败不拦路——退 localStorage/system。
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('渲染器挂载失败：找不到 #root 挂载点');
}

void window.septcats.settings
  .get()
  .then((s) => {
    setGlobalThemeMode(s.theme);
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
