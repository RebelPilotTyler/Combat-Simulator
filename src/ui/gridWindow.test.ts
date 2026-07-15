import { describe, expect, it } from 'vitest';
import { getVisibleGridCells, getVisibleGridWindow } from './gridWindow';

describe('getVisibleGridWindow', () => {
  it('returns a padded viewport window inside the grid bounds', () => {
    const window = getVisibleGridWindow({
      width: 50,
      height: 50,
      cellSize: 40,
      gap: 2,
      scrollLeft: 420,
      scrollTop: 840,
      viewportWidth: 420,
      viewportHeight: 420,
      overscan: 2
    });

    expect(window).toEqual({ startX: 8, endX: 22, startY: 18, endY: 32 });
    expect(getVisibleGridCells(window)).toHaveLength(225);
  });

  it('clamps at the far edge instead of exceeding map dimensions', () => {
    const window = getVisibleGridWindow({
      width: 30,
      height: 30,
      cellSize: 48,
      gap: 2,
      scrollLeft: 1400,
      scrollTop: 1400,
      viewportWidth: 500,
      viewportHeight: 500,
      overscan: 3
    });

    expect(window.endX).toBe(29);
    expect(window.endY).toBe(29);
  });
});
