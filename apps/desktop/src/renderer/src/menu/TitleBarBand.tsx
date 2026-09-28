/**
 * TitleBarBand —— T89-01：自绘窗口标题带（Windows frameless + titleBarOverlay）。
 *
 * 背景（老板 09-28 圈图 image_83fc8f.png：「这上面为什么没有跟着主题走？」）：
 * OS 原生标题栏只认「明暗」一轴（nativeTheme.themeSource），配色派系（paper/slate/
 * moss…）与质感两轴 OS 根本不理会 → 暖配色档下顶带永远死灰白，「整个软件随主题」
 * 破功。Windows 治本 = titleBarStyle:'hidden' 撤原生标题带，renderer 自绘品牌带
 * + -webkit-app-region: drag，窗口按钮交还 Electron titleBarOverlay（原生绘制，
 * 悬停红 X/键盘可达不破）。macOS 保留原生惯例，不挂本组件。
 *
 * 纪律：整条带只吃 var(--sc-*) token（三轴全联动）；双击 = 最大化/还原（原生肌肉
 * 记忆）；右侧预留 OS overlay 按钮区（138px 标准宽），双击/命中必须避开。
 * 主题→OS 桥：renderer CSS 够不着 OS 绘制层——本组件观察 documentElement 的
 * data-theme/data-palette/data-look 三属性（三轴唯一真相挂点，设置页任何入口最终
 * 都要落它们），变化即实测 canvas/ink token 推 main（theme:chrome）刷按钮区色。
 */

import { useEffect, useState } from 'react';
import { isWindowsShell } from './MenuBarBand';
import './TitleBarBand.css';

/** OS titleBarOverlay 标准预留宽（三按钮 ×46px，Electron 文档值）。 */
export const OVERLAY_ZONE_WIDTH = 138;

/** 主题三轴在 documentElement 上的属性挂点（theme/palette/look 唯一真相，设置任何入口最终都落它们）。 */
const THEME_ATTRS = ['data-theme', 'data-palette', 'data-look'] as const;

/** 实测 CSS 自定义属性并归一为 #rrggbb（computed 可能给 rgb()）。 */
export function readTokenHex(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (hex !== null && hex[1] !== undefined) {
    return `#${hex[1].toUpperCase()}`;
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(raw);
  if (rgb !== null && rgb[1] !== undefined && rgb[2] !== undefined && rgb[3] !== undefined) {
    const to2 = (v: string): string => Number(v).toString(16).padStart(2, '0').toUpperCase();
    return `#${to2(rgb[1])}${to2(rgb[2])}${to2(rgb[3])}`;
  }
  return '';
}

/** 把当前主题实测色推给 main（OS 按钮区 + 窗口预绘底色）。 */
export function pushChromeToOs(): void {
  void window.septcats.theme
    .pushChrome({
      canvas: readTokenHex('--sc-color-canvas'),
      ink: readTokenHex('--sc-color-ink'),
    })
    .catch(() => undefined);
}

export function TitleBarBand(): React.ReactElement | null {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindowsShell()) {
      return undefined;
    }
    void window.septcats.window.getState().then((state) => {
      setMaximized(state.maximized);
    });
    const offState = window.septcats.window.onState((state) => {
      setMaximized(state.maximized);
    });
    // 三轴属性变化 → 实测推 OS（MutationObserver 统一机制：设置页明暗/配色/质感
    // 所有入口最终都落 documentElement 属性，比逐 store 订阅少三处耦合）。
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      // 下一帧再读：属性刚挂上时覆写样式未必已进入 computed style
      raf = requestAnimationFrame(pushChromeToOs);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [...THEME_ATTRS],
    });
    // 首推（属性挂点可能早于本组件挂载，observer 不会回溯）
    pushChromeToOs();
    return () => {
      offState();
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // macOS/Linux 保留原生标题栏（OS 惯例 + nativeTheme 明暗联动；判定与 main
  // 建窗 titleBarOverlay 门、MenuBarBand 挂载门同口径 = UA 判 Windows）
  if (!isWindowsShell()) {
    return null;
  }

  // 双击最大化无需 JS：整条带是 -webkit-app-region: drag = OS 视其 HTCAPTION，
  // Windows 对 HTCAPTION 双击原生触发最大化/还原（事件到不了 DOM，故也不挂
  // onDoubleClick——挂了也收不到）。main 的 maximize/unmaximize 广播驱动图标态。
  return (
    <div className="titleb_band" data-testid="title-bar-band" data-maximized={maximized ? 'true' : 'false'}>
      <span className="titleb_brand" aria-hidden="true">🐈</span>
      <span className="titleb_name">Septcats</span>
      <span className="titleb_drag" aria-hidden="true" />
      <span className="titleb_overlayzone" style={{ width: OVERLAY_ZONE_WIDTH }} aria-hidden="true" />
    </div>
  );
}
