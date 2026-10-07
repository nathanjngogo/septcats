/*
 * overlayHost.tsx —— 浮层宿主（T106-01，老板 10-07 报障修复）。
 *
 * 缺的是「浮层不能被任何面板的面裁掉」这一条结构约束：
 *   - 毛玻璃档给 `.sc-shell__sidebar` / `.sc-shell__topbar` 上了 `backdrop-filter`（looks.css）——
 *     按规范这会把这些面变成 **fixed 后代的包含块**，于是挂在侧栏里的 `position: fixed` 菜单
 *     被侧栏边界硬裁（真机像素证据：切线正好压在侧栏↔主区分界线上、无菜单边框与阴影溢出）。
 *     极简 / 夜航仪表档没有 backdrop-filter，所以同一份代码只在毛玻璃下露馅。
 *   - 正解：把浮层挂到 **shell 级宿主**（`.app-overlay-host`，在侧栏祖先链之外），几何仍走
 *     `position: fixed` + **视口坐标**（菜单的 left/top 本来就取自 getBoundingClientRect）——
 *     三档观感一致，且宿主零尺寸、不吃指针事件，不改变任何既有 z 轴语义。
 *
 * 纪律：**侧栏 / 顶栏（会被 look 上材质的两个面）之内一律不再挂 fixed 浮层**，新增浮层走
 * `<FloatingLayer>`；宿主缺失时回退为就地渲染（组件单测里没挂 App 外壳也不会炸）。
 */
import { createContext, useContext, type CSSProperties, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';

const OverlayHostContext = createContext<HTMLElement | null>(null);

/** 宿主 Provider（App 根挂一次；值 = `.app-overlay-host` 的 DOM 节点）。 */
export const OverlayHostProvider = OverlayHostContext.Provider;

/** 取当前浮层宿主；未挂外壳时为 null（调用方回退就地渲染）。 */
export function useOverlayHost(): HTMLElement | null {
  return useContext(OverlayHostContext);
}

/**
 * 浮层容器：等价于原来的 `<span style={{ position:'fixed', left, top, zIndex }}>`，
 * 但优先渲染到 shell 级宿主（门户），从而不受侧栏/顶栏材质的包含块与 overflow 影响。
 */
export function FloatingLayer({
  style,
  children,
  hostRef,
  testId,
}: {
  style: CSSProperties;
  children: ReactNode;
  /** 原就地 ref（如行菜单的 clamp 用 layout effect 依赖它）——门户不影响 ref 语义。 */
  hostRef?: Ref<HTMLSpanElement> | undefined;
  testId?: string | undefined;
}): ReactNode {
  const host = useOverlayHost();
  const node = (
    <span ref={hostRef} style={style} {...(testId === undefined ? {} : { 'data-testid': testId })}>
      {children}
    </span>
  );
  return host === null ? node : createPortal(node, host);
}