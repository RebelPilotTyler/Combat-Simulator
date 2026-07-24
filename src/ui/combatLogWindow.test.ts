import { describe, expect, it } from 'vitest';
import {
  EXPANDED_COMBAT_LOG_WINDOW_SIZE,
  EXPANDED_COMBAT_LOG_WINDOW_THRESHOLD,
  getCombatLogAnchorStart,
  getCombatLogWindow
} from './combatLogWindow';

describe('combat log window', () => {
  it('keeps the existing five-entry recent view', () => {
    expect(getCombatLogWindow(50, false)).toEqual({
      start: 0,
      end: 5,
      hasNewer: false,
      hasOlder: false,
      windowed: false
    });
  });

  it('keeps full-history rendering unchanged below the threshold', () => {
    expect(getCombatLogWindow(EXPANDED_COMBAT_LOG_WINDOW_THRESHOLD, true)).toEqual({
      start: 0,
      end: EXPANDED_COMBAT_LOG_WINDOW_THRESHOLD,
      hasNewer: false,
      hasOlder: false,
      windowed: false
    });
  });

  it('returns bounded newest, middle, and oldest windows for long logs', () => {
    const total = EXPANDED_COMBAT_LOG_WINDOW_THRESHOLD + 125;

    expect(getCombatLogWindow(total, true)).toEqual({
      start: 0,
      end: EXPANDED_COMBAT_LOG_WINDOW_SIZE,
      hasNewer: false,
      hasOlder: true,
      windowed: true
    });
    expect(getCombatLogWindow(total, true, EXPANDED_COMBAT_LOG_WINDOW_SIZE)).toEqual({
      start: EXPANDED_COMBAT_LOG_WINDOW_SIZE,
      end: EXPANDED_COMBAT_LOG_WINDOW_SIZE * 2,
      hasNewer: true,
      hasOlder: true,
      windowed: true
    });
    expect(getCombatLogWindow(total, true, total - 25)).toEqual({
      start: total - 25,
      end: total,
      hasNewer: true,
      hasOlder: false,
      windowed: true
    });
  });

  it('tracks a visible anchor when newer entries are prepended', () => {
    const entries = Array.from({ length: 400 }, (_, index) => ({ id: `entry-${index}` }));
    const anchorId = entries[100].id;
    const withNewEntries = [
      { id: 'new-1' },
      { id: 'new-2' },
      ...entries
    ];

    expect(getCombatLogAnchorStart(entries, anchorId)).toBe(100);
    expect(getCombatLogAnchorStart(withNewEntries, anchorId)).toBe(102);
    expect(getCombatLogAnchorStart(withNewEntries, 'missing')).toBe(0);
  });
});
