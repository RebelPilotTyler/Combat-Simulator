import { describe, expect, it } from 'vitest';
import { getShapeSquares } from './shapes';
import type { GridDefinition } from './types';

const grid: GridDefinition = {
  width: 10,
  height: 10,
  blocked: [{ x: 5, y: 5 }]
};

describe('getShapeSquares', () => {
  it('returns one square for a single target', () => {
    expect(getShapeSquares({ type: 'single' }, { x: 2, y: 3 }, grid)).toEqual([{ x: 2, y: 3 }]);
  });

  it('builds a cardinal line and omits blocked squares', () => {
    expect(getShapeSquares({ type: 'line', length: 4 }, { x: 3, y: 5 }, grid, 'east')).toEqual([
      { x: 4, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 }
    ]);
  });

  it('builds a simple radius around a point', () => {
    expect(getShapeSquares({ type: 'radius', radius: 1 }, { x: 2, y: 2 }, grid)).toEqual([
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 }
    ]);
  });

  it('builds a readable cardinal cone', () => {
    expect(getShapeSquares({ type: 'cone', length: 2 }, { x: 4, y: 4 }, grid, 'north')).toEqual([
      { x: 4, y: 3 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 }
    ]);
  });
});
