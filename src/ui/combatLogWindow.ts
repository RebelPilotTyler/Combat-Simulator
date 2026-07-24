export const RECENT_COMBAT_LOG_ENTRY_COUNT = 5;
export const EXPANDED_COMBAT_LOG_WINDOW_SIZE = 100;
export const EXPANDED_COMBAT_LOG_WINDOW_THRESHOLD = 250;

export interface CombatLogWindow {
  start: number;
  end: number;
  hasNewer: boolean;
  hasOlder: boolean;
  windowed: boolean;
}

export function getCombatLogWindow(
  entryCount: number,
  expanded: boolean,
  requestedStart = 0
): CombatLogWindow {
  const total = Math.max(0, Math.floor(entryCount));
  if (!expanded) {
    return {
      start: 0,
      end: Math.min(total, RECENT_COMBAT_LOG_ENTRY_COUNT),
      hasNewer: false,
      hasOlder: false,
      windowed: false
    };
  }

  if (total <= EXPANDED_COMBAT_LOG_WINDOW_THRESHOLD) {
    return {
      start: 0,
      end: total,
      hasNewer: false,
      hasOlder: false,
      windowed: false
    };
  }

  const start = Math.min(
    Math.max(0, Math.floor(requestedStart)),
    Math.max(0, total - 1)
  );
  const end = Math.min(total, start + EXPANDED_COMBAT_LOG_WINDOW_SIZE);
  return {
    start,
    end,
    hasNewer: start > 0,
    hasOlder: end < total,
    windowed: true
  };
}

export function getCombatLogAnchorStart(
  entries: readonly { id: string }[],
  anchorEntryId: string | undefined
): number {
  if (!anchorEntryId) {
    return 0;
  }

  const index = entries.findIndex((entry) => entry.id === anchorEntryId);
  return index >= 0 ? index : 0;
}
