import { describe, expect, it } from 'vitest';
import { clampGridPosition, MAX_GRID_SIZE, normalizeGridDefinition } from './grid';

describe('normalizeGridDefinition', () => {
  it('caps imported and edited maps at the supported size', () => {
    const grid = normalizeGridDefinition({
      width: 80,
      height: 75,
      blocked: [{ x: 49, y: 49 }, { x: 50, y: 50 }],
      heights: [{ x: 48, y: 48, z: 2 }, { x: 60, y: 1, z: 4 }]
    });

    expect(grid.width).toBe(MAX_GRID_SIZE);
    expect(grid.height).toBe(MAX_GRID_SIZE);
    expect(grid.blocked).toEqual([{ x: 49, y: 49 }]);
    expect(grid.heights).toEqual([{ x: 48, y: 48, z: 2 }]);
  });

  it('clamps creature positions into the supported grid', () => {
    const grid = normalizeGridDefinition({
      width: 80,
      height: 80,
      heights: [{ x: 49, y: 49, z: 3 }]
    });

    expect(clampGridPosition({ x: 99, y: 99 }, grid)).toEqual({ x: 49, y: 49, z: 3 });
  });
});
