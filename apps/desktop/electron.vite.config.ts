import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * electron-vite 三进程配置：main / preload / renderer。
 *
 * 说明：
 * - main/preload 默认 externalize 依赖；把 workspace 内部包排除在 externalize 之外，
 *   让 Vite 把 @septcats/core 的 TS 源一并打包进产物（否则运行时 require 到 .ts 会失败）；
 * - renderer 的 root 指向 src/renderer，入口是其下 index.html；
 * - 本阶段 build = electron-vite build（不产安装包，electron-builder 配置留 M10）。
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@septcats/core', '@septcats/schema'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@septcats/core', '@septcats/schema'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
