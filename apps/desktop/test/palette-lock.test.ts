/**
 * palette-lock.test.ts —— 范围4 命令面板加锁/移除锁条件项（TASK-T67-01-B2-01）。
 *
 * 纯函数直测（不依赖 React / store）：
 * - ADD_LOCK_DEF / REMOVE_LOCK_DEF 在静态清单之外（不影响 COMMAND_DEFS 基线）；
 * - bindPaletteCommands 按注入的 addLock/removeLock deps 仅挂对应命令（二选一）；
 * - configurePaletteCommands 在无选中页时整键摘除两条（不抛错、不出现）。
 */
import { describe, expect, it } from 'vitest';
import {
  ADD_LOCK_DEF,
  REMOVE_LOCK_DEF,
  COMMAND_DEFS,
  bindPaletteCommands,
  configurePaletteCommands,
  type CommandDeps,
} from '../src/renderer/src/palette/commands';

function baseDeps(): CommandDeps {
  return {
    createPage: () => undefined,
    switchToNextWorkspace: () => undefined,
    openTrash: () => undefined,
    openSettings: () => undefined,
    notify: () => undefined,
    setThemeMode: () => undefined,
  };
}

function ids(commands: readonly { id: string }[]): string[] {
  return commands.map((command) => command.id);
}

describe('范围4 加锁/移除锁命令定义', () => {
  it('ADD_LOCK_DEF / REMOVE_LOCK_DEF 不在静态 COMMAND_DEFS 里（不扰动别名基线）', () => {
    const staticIds = COMMAND_DEFS.map((def) => def.id);
    expect(staticIds).not.toContain(ADD_LOCK_DEF.id);
    expect(staticIds).not.toContain(REMOVE_LOCK_DEF.id);
    expect(ADD_LOCK_DEF.id).toBe('page.addLock');
    expect(REMOVE_LOCK_DEF.id).toBe('page.removeLock');
  });

  it('注入 addLock → 仅出现 page.addLock；注入 removeLock → 仅出现 page.removeLock', () => {
    const withAdd = bindPaletteCommands({ ...baseDeps(), addLock: () => undefined });
    expect(ids(withAdd)).toContain('page.addLock');
    expect(ids(withAdd)).not.toContain('page.removeLock');

    const withRemove = bindPaletteCommands({ ...baseDeps(), removeLock: () => undefined });
    expect(ids(withRemove)).toContain('page.removeLock');
    expect(ids(withRemove)).not.toContain('page.addLock');
  });

  it('两条互斥：同时注入 addLock 与 removeLock 时两者都出现（由 App 二选一保证不并存）', () => {
    const both = bindPaletteCommands({
      ...baseDeps(),
      addLock: () => undefined,
      removeLock: () => undefined,
    });
    expect(ids(both)).toContain('page.addLock');
    expect(ids(both)).toContain('page.removeLock');
  });

  it('无选中页：configurePaletteCommands 摘除两条（不抛错）', () => {
    const configured = configurePaletteCommands(
      { ...baseDeps(), addLock: () => undefined, removeLock: () => undefined },
      false,
    );
    expect(ids(configured)).not.toContain('page.addLock');
    expect(ids(configured)).not.toContain('page.removeLock');
  });

  it('有选中页：按注入的 deps 出现对应一条', () => {
    const addOnly = configurePaletteCommands({ ...baseDeps(), addLock: () => undefined }, true);
    expect(ids(addOnly)).toContain('page.addLock');
    expect(ids(addOnly)).not.toContain('page.removeLock');

    const removeOnly = configurePaletteCommands({ ...baseDeps(), removeLock: () => undefined }, true);
    expect(ids(removeOnly)).toContain('page.removeLock');
    expect(ids(removeOnly)).not.toContain('page.addLock');
  });
});
