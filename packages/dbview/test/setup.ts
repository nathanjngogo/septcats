import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * dbview 的 jsdom 用例收尾：每个用例后卸载组件（避免 DOM 泄漏）。
 * 本包不挂 ProseMirror，故不需要 editor 那两个浏览器 API 的空实现。
 */
afterEach(() => {
  cleanup();
});
