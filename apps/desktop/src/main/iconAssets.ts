/**
 * iconAssets.ts —— 品牌图标「多目录 × 多文件名查找序列」纯逻辑（TASK-T55-02 §1②③）。
 *
 * 图标有两份来源，落点不同：
 * - **打包**：`electron-builder.yml` 的 `extraResources` 把 `build/icon*.png|ico` 复制到
 *   `<resourcesPath>/build/`（`directories.buildResources` 只服务 builder 生成 exe 图标与
 *   安装器素材，**不会**进包——0.3.0 产物实测 `resources/build/` 与 `app.asar` 内均无 `build/`）。
 * - **dev**：直接读仓库内 `apps/desktop/build/`（`app.getAppPath()`，与 `out/main/../../build`
 *   这一等价上溯位）。
 *
 * 查找顺序口径 = **文件名优先于基目录**：`icon-tray.png` 在全部基目录都探完才轮到
 * `icon.ico` 兜底。这样「换图」与「在哪个目录」解耦——dev 与打包两条路径不会出现
 * 「一个目录命中新图、另一个目录命中旧 .ico」的分叉。
 *
 * 本模块**刻意不 import electron**（也没有 fs 副作用）：解析与挑选是纯函数，
 * 直接进 node 单测覆盖；真实目录探测由调用方注入 `existsSync`。
 */

/** 托盘图标文件名（首位 = T55-02 像素简化子型 T；`.ico` 保留为旧包兜底）。 */
export const TRAY_ICON_NAMES = ['icon-tray.png', 'icon.ico'] as const;

/** 窗口图标文件名（`BrowserWindow.icon`：任务栏 / Alt-Tab 图像，与托盘子型区分）。 */
export const WINDOW_ICON_NAMES = ['icon.png'] as const;

/** 图标基目录（顺序 = 优先级）；`null` / 空串 = 该位本次不可用（如未打包时的 resourcesPath），跳过。 */
export type IconBaseDir = string | null;

/**
 * 展开候选路径（名字外层、基目录内层——同一次解析内新图恒优先于旧 .ico）。
 *
 * @param names    图标文件名（按优先级）
 * @param baseDirs 基目录（按优先级）；每项下探 `build/<name>`
 * @param joinFn   路径拼接（注入以便纯函数测试；运行时传 `node:path` 的 `join`）
 */
export function iconCandidatePaths(
  names: readonly string[],
  baseDirs: readonly IconBaseDir[],
  joinFn: (left: string, right: string) => string,
): string[] {
  const candidates: string[] = [];
  for (const name of names) {
    for (const base of baseDirs) {
      if (base === null || base.length === 0) {
        continue;
      }
      candidates.push(joinFn(joinFn(base, 'build'), name));
    }
  }
  return candidates;
}

/** 首个存在的候选；全不存在 → `null`（调用方各自决定回落：托盘空图 / 窗口用默认图标）。 */
export function pickFirstExisting(
  candidates: readonly string[],
  exists: (path: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}
