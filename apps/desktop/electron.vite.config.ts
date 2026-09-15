import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * main/preload 需要「随包编译」的 workspace 包（TS 源直接打进产物）。
 * 新增 workspace 包时**只改这一处**——两处列表各写一份必然漂移
 * （缺陷账 #13/#22：漏 editor 崩过一次，这次漏 importer 又崩）。
 */
const BUNDLED_WORKSPACE_PACKAGES = [
  '@septcats/core',
  '@septcats/schema',
  '@septcats/platform',
  '@septcats/editor',
  '@septcats/dbview',
  '@septcats/importer',
  '@septcats/sync',
];

/**
 * electron-vite 三进程配置：main / preload / renderer。
 *
 * 说明：
 * - main/preload 默认 externalize 依赖；把 workspace 内部包排除在 externalize 之外，
 *   让 Vite 把 @septcats/core / @septcats/schema / @septcats/platform 的 TS 源一并打包进产物
 *   （否则运行时 require 到 .ts 会失败）；
 *   better-sqlite3 是原生模块，保持 external（运行时按 Electron ABI 的 node_modules 加载）；
 * - main 有两个入口：index（主进程）与 dbServer（utilityProcess 数据库服务，见 src/db/client.ts）；
 * - renderer 的 root 指向 src/renderer，入口是其下 index.html；
 *   @septcats/ui 是 workspace 内的 TS 源（含 .css），直接由 Vite 打包；
 *   resolve.dedupe 锁 react/react-dom 单实例（ui 侧是 peer）；optimizeDeps.include 预打包图标族；
 * - 本阶段 build = electron-vite build（不产安装包，electron-builder 配置留 M10）。
 */
export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_PACKAGES }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          dbServer: resolve(__dirname, 'src/db/server.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_PACKAGES }),
    ],
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
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      // pnpm 严格隔离下 phosphor/clsx 装在 @septcats/ui 的 node_modules，
      // 用 Vite 的 `parent > child` 语法显式预打包嵌套依赖，避免 desktop 侧解析不到。
      include: ['@septcats/ui > @phosphor-icons/react', '@septcats/ui > clsx'],
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
