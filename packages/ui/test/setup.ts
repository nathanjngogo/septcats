import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/** jsdom 下每个用例后卸载组件，避免 DOM 泄漏影响后续断言。 */
afterEach(() => {
  cleanup();
});
