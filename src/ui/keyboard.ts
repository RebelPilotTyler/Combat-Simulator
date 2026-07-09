import type { ActionCost, GridPosition } from '../engine/types';

export interface HotkeyActionLike {
  actionCost: ActionCost;
}

export interface KeyboardTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

export function isTypingShortcutTarget(target: KeyboardTargetLike | null | undefined): boolean {
  const tagName = target?.tagName?.toLowerCase();
  return Boolean(target?.isContentEditable || tagName === 'input' || tagName === 'select' || tagName === 'textarea');
}

export function getNumberHotkeyIndex(key: string): number | undefined {
  if (!/^[1-9]$/.test(key)) {
    return undefined;
  }

  return Number(key) - 1;
}

export function getActionCostForNumberHotkey(event: Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): ActionCost {
  if (event.shiftKey) {
    return 'bonusAction';
  }

  if (event.ctrlKey || event.metaKey) {
    return 'reaction';
  }

  return 'action';
}

export function getActionsForHotkeyCost<Action extends HotkeyActionLike>(actions: Action[], actionCost: ActionCost): Action[] {
  return actions.filter((action) => action.actionCost === actionCost).slice(0, 9);
}

export function getActionForNumberHotkey<Action extends HotkeyActionLike>(
  actions: Action[],
  key: string,
  event: Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>
): Action | undefined {
  const index = getNumberHotkeyIndex(key);
  if (index === undefined) {
    return undefined;
  }

  const cost = getActionCostForNumberHotkey(event);
  return getActionsForHotkeyCost(actions, cost)[index] ?? ((event.ctrlKey || event.metaKey) ? getActionsForHotkeyCost(actions, 'free')[index] : undefined);
}

export function moveGridCursor(
  cursor: GridPosition,
  key: string,
  width: number,
  height: number
): GridPosition {
  const next = { ...cursor };

  if (key === 'ArrowUp') {
    next.y -= 1;
  } else if (key === 'ArrowDown') {
    next.y += 1;
  } else if (key === 'ArrowLeft') {
    next.x -= 1;
  } else if (key === 'ArrowRight') {
    next.x += 1;
  }

  return {
    x: Math.max(0, Math.min(width - 1, next.x)),
    y: Math.max(0, Math.min(height - 1, next.y))
  };
}
