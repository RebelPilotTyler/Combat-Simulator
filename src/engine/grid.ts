import type { GridDefinition, GridPosition } from './types';

export const MAX_GRID_SIZE = 50;

export function clampGridDimension(value: unknown, fallback = 10): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return clamp(Math.round(numeric), 1, MAX_GRID_SIZE);
}

export function normalizeGridDefinition(grid: Partial<GridDefinition>): GridDefinition {
  const width = clampGridDimension(grid.width);
  const height = clampGridDimension(grid.height);
  return {
    width,
    height,
    blocked: normalizeGridPositions(grid.blocked ?? [], width, height, false),
    heights: normalizeGridPositions(grid.heights ?? [], width, height, true)
      .filter((cell) => (cell.z ?? 0) !== 0)
  };
}

export function clampGridPosition(position: GridPosition, grid: GridDefinition): GridPosition {
  const x = clamp(Math.round(position.x), 0, Math.max(0, grid.width - 1));
  const y = clamp(Math.round(position.y), 0, Math.max(0, grid.height - 1));
  return {
    x,
    y,
    z: position.z ?? grid.heights?.find((height) => height.x === x && height.y === y)?.z ?? 0
  };
}

function normalizeGridPositions(positions: GridPosition[], width: number, height: number, includeZ: boolean): GridPosition[] {
  return positions
    .filter((position) => Number.isFinite(position.x) && Number.isFinite(position.y))
    .map((position) => ({
      x: Math.round(position.x),
      y: Math.round(position.y),
      z: includeZ ? Math.round(position.z ?? 0) : undefined
    }))
    .filter((position) => position.x >= 0 && position.x < width && position.y >= 0 && position.y < height)
    .map((position) => includeZ ? position : { x: position.x, y: position.y });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
