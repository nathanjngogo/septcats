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
import { t } from '../i18n';
import './TitleBarBand.css';

/** OS titleBarOverlay 标准预留宽（历史：overlay 三按钮宽；C 轮自绘按钮组仍用同宽）。 */
export const OVERLAY_ZONE_WIDTH = 138;

/** Windows 惯例窗口控件（C 轮全自绘：min/还原或最大化/关闭）。SVG stroke 吃 currentColor。 */
function WindowGlyph({ kind, maximized }: { kind: 'min' | 'max' | 'close'; maximized: boolean }): React.ReactElement {
  if (kind === 'min') {
    return <svg viewBox="0 0 10 10" aria-hidden="true"><line x1="1" y1="8" x2="9" y2="8" /></svg>;
  }
  if (kind === 'close') {
    return <svg viewBox="0 0 10 10" aria-hidden="true"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" /><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" /></svg>;
  }
  return maximized ? (
    // 还原：两个错位方框（Windows 惯例）
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="3" width="6" height="6" />
      <polyline points="3,3 3,1 9,1 9,7 7,7" />
    </svg>
  ) : (
    <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" /></svg>
  );
}

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

/**
 * 把当前主题实测色 + 质感档推给 main（C 轮后 OS 按钮区已撤，本通道只刷窗口
 * 预绘底色=恒实心 canvas；保留 ink/look 入参供探针断言与明暗态回退计算）。
 */
export function pushChromeToOs(): void {
  void window.septcats.theme
    .pushChrome({
      canvas: readTokenHex('--sc-color-canvas'),
      ink: readTokenHex('--sc-color-ink'),
      look: document.documentElement.dataset.look ?? 'pixel',
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
  // C 轮（老板拍板全自绘按钮）：min/最大化-还原/close 由本组接管——close 走
  // main 的 win.close() = T54-01 closeGuard 同链路（冲刷/托盘询问零旁路）。
  const ctrl = (fn: () => Promise<unknown>): void => {
    void fn().catch(() => undefined);
  };
  return (
    <div className="titleb_band" data-testid="title-bar-band" data-maximized={maximized ? 'true' : 'false'}>
      <span className="titleb_brand" aria-hidden="true">🐈</span>
      <span className="titleb_name">Septcats</span>
      <span className="titleb_drag" aria-hidden="true" />
      <div className="titleb_controls" role="group" aria-label={t("window.controls")}>
        <button type="button" className="titleb_btn" data-testid="titleb-min" aria-label={t("window.minimize")} onClick={() => ctrl(window.septcats.window.minimize)}>
          <WindowGlyph kind="min" maximized={maximized} />
        </button>
        <button type="button" className="titleb_btn" data-testid="titleb-max" aria-label={maximized ? t('window.restore') : t('window.maximize')} onClick={() => ctrl(window.septcats.window.maximizeToggle)}>
          <WindowGlyph kind="max" maximized={maximized} />
        </button>
        <button type="button" className="titleb_btn titleb_btn_close" data-testid="titleb-close" aria-label={t('window.close')} onClick={() => ctrl(window.septcats.window.close)}>
          <WindowGlyph kind="close" maximized={maximized} />
        </button>
      </div>
    </div>
  );
}
