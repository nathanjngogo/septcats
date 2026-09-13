import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom 下每个用例后卸载组件（避免 DOM 泄漏）。
 * 另补两个 jsdom 未实现的浏览器 API 空实现：Tiptap/PM 在布局路径上会探他们，
 * 缺失会以「不是一个函数」中断渲染，而不是给出有意义的失败。
 */
afterEach(() => {
  cleanup();
});

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
