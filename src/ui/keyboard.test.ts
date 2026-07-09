import { describe, expect, it } from 'vitest';
import { getActionCostForNumberHotkey, getActionForNumberHotkey, getNumberHotkeyIndex, isTypingShortcutTarget, moveGridCursor } from './keyboard';

describe('keyboard shortcut helpers', () => {
  it('maps number hotkeys to zero-based action indexes', () => {
    expect(getNumberHotkeyIndex('1')).toBe(0);
    expect(getNumberHotkeyIndex('9')).toBe(8);
    expect(getNumberHotkeyIndex('0')).toBeUndefined();
    expect(getNumberHotkeyIndex('a')).toBeUndefined();
  });

  it('maps number modifiers to action cost groups', () => {
    expect(getActionCostForNumberHotkey({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe('action');
    expect(getActionCostForNumberHotkey({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe('bonusAction');
    expect(getActionCostForNumberHotkey({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('reaction');
    expect(getActionCostForNumberHotkey({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe('reaction');
  });

  it('selects action and bonus action lists with number modifiers', () => {
    const actions = [
      { id: 'strike', actionCost: 'action' as const },
      { id: 'dash', actionCost: 'action' as const },
      { id: 'offhand', actionCost: 'bonusAction' as const },
      { id: 'quick-step', actionCost: 'bonusAction' as const },
      { id: 'riposte', actionCost: 'reaction' as const },
      { id: 'free-note', actionCost: 'free' as const }
    ];

    expect(getActionForNumberHotkey(actions, '2', { shiftKey: false, ctrlKey: false, metaKey: false })?.id).toBe('dash');
    expect(getActionForNumberHotkey(actions, '2', { shiftKey: true, ctrlKey: false, metaKey: false })?.id).toBe('quick-step');
    expect(getActionForNumberHotkey(actions, '1', { shiftKey: false, ctrlKey: true, metaKey: false })?.id).toBe('riposte');
  });

  it('falls back to free actions for ctrl/cmd number when no matching reaction exists', () => {
    const actions = [
      { id: 'strike', actionCost: 'action' as const },
      { id: 'free-note', actionCost: 'free' as const }
    ];

    expect(getActionForNumberHotkey(actions, '1', { shiftKey: false, ctrlKey: true, metaKey: false })?.id).toBe('free-note');
  });

  it('detects editable targets so shortcuts do not interrupt typing', () => {
    expect(isTypingShortcutTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingShortcutTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingShortcutTarget({ tagName: 'select' })).toBe(true);
    expect(isTypingShortcutTarget({ tagName: 'div', isContentEditable: true })).toBe(true);
    expect(isTypingShortcutTarget({ tagName: 'button' })).toBe(false);
  });

  it('moves and clamps the grid cursor inside board bounds', () => {
    expect(moveGridCursor({ x: 1, y: 1 }, 'ArrowUp', 3, 3)).toEqual({ x: 1, y: 0 });
    expect(moveGridCursor({ x: 1, y: 1 }, 'ArrowRight', 3, 3)).toEqual({ x: 2, y: 1 });
    expect(moveGridCursor({ x: 0, y: 0 }, 'ArrowLeft', 3, 3)).toEqual({ x: 0, y: 0 });
    expect(moveGridCursor({ x: 2, y: 2 }, 'ArrowDown', 3, 3)).toEqual({ x: 2, y: 2 });
  });
});
