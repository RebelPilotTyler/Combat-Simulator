import { describe, expect, it } from 'vitest';
import { createBattlefield3DProjection } from './battlefield3dProjection';

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

describe('3D battlefield projection', () => {
  it('preserves projected point, depth, elevation, and tile-corner geometry', () => {
    const projection = createBattlefield3DProjection({
      gridWidth: 10,
      gridHeight: 8,
      svgWidth: 900,
      svgHeight: 600,
      cellSize: 40,
      cameraYaw: -35,
      cameraPitch: 58,
      cameraZoom: 1.25,
      cameraPanX: 12,
      cameraPanY: -7
    });
    const point = projection.projectPoint(3.5, 6.5, 2);
    const corners = projection.projectTileCorners(3, 6, 2);

    expect({
      point: {
        x: rounded(point.x),
        y: rounded(point.y),
        depth: rounded(point.depth)
      },
      depth: rounded(projection.getProjectedDepth(3.5, 6.5)),
      corners: Object.fromEntries(
        Object.entries(corners).map(([key, corner]) => [
          key,
          { x: rounded(corner.x), y: rounded(corner.y), depth: rounded(corner.depth) }
        ])
      )
    }).toEqual({
      point: { x: 473.902, y: 352.527, depth: 3.608 },
      depth: 2.908,
      corners: {
        northWest: { x: 437.148, y: 347.031, depth: 3.497 },
        northEast: { x: 480.383, y: 321.358, depth: 2.975 },
        southEast: { x: 510.656, y: 358.023, depth: 3.72 },
        southWest: { x: 467.422, y: 383.696, depth: 4.242 }
      }
    });
  });
});
