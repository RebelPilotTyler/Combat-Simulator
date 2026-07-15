import type { CardinalDirection, GridDefinition, GridPosition, ShapeDefinition } from './types';

export function getElevation(position: GridPosition): number {
  return position.z ?? 0;
}

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y && getElevation(a) === getElevation(b);
}

export function sameTilePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isInBounds(position: GridPosition, grid: GridDefinition): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < grid.width && position.y < grid.height;
}

export function isBlocked(position: GridPosition, grid: GridDefinition): boolean {
  return grid.blocked.some((blocked) => sameTilePosition(blocked, position));
}

export function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function position3DKey(position: GridPosition): string {
  return `${position.x},${position.y},${getElevation(position)}`;
}

export function getTileHeight(position: GridPosition, grid: GridDefinition): number {
  return grid.heights?.find((height) => sameTilePosition(height, position))?.z ?? 0;
}

export function getTilePosition(position: GridPosition, grid: GridDefinition): GridPosition {
  return {
    x: position.x,
    y: position.y,
    z: position.z ?? getTileHeight(position, grid)
  };
}

export function getShapeSquares(
  shape: ShapeDefinition,
  origin: GridPosition,
  grid: GridDefinition,
  direction: CardinalDirection = shape.direction ?? 'north'
): GridPosition[] {
  const normalizedOrigin = getTilePosition(origin, grid);
  const rawSquares = buildRawShape(shape, normalizedOrigin, grid, direction);
  const seen = new Set<string>();

  return rawSquares.reduce<GridPosition[]>((squares, square) => {
    const positionedSquare = getTilePosition(square, grid);
    const key = position3DKey(positionedSquare);
    if (seen.has(key) || !isInBounds(square, grid) || isBlocked(square, grid)) {
      return squares;
    }

    seen.add(key);
    squares.push(positionedSquare);
    return squares;
  }, []);
}

function buildRawShape(
  shape: ShapeDefinition,
  origin: GridPosition,
  grid: GridDefinition,
  direction: CardinalDirection
): GridPosition[] {
  if (shape.type === 'single') {
    return [origin];
  }

  if (shape.type === 'radius') {
    const radius = shape.radius ?? 1;
    const squares: GridPosition[] = [];

    for (let y = Math.max(0, origin.y - radius); y <= Math.min(grid.height - 1, origin.y + radius); y += 1) {
      for (let x = Math.max(0, origin.x - radius); x <= Math.min(grid.width - 1, origin.x + radius); x += 1) {
        const square = getTilePosition({ x, y }, grid);
        const dx = square.x - origin.x;
        const dy = square.y - origin.y;
        const dz = getElevation(square) - getElevation(origin);
        if (dx * dx + dy * dy + dz * dz <= radius * radius) {
          squares.push(square);
        }
      }
    }

    return squares;
  }

  if (shape.type === 'line') {
    const length = shape.length ?? 1;
    return Array.from({ length }, (_, index) =>
      offsetInDirection(origin, direction, index + 1)
    );
  }

  const length = shape.length ?? 1;
  const squares: GridPosition[] = [];

  for (let distance = 1; distance <= length; distance += 1) {
    const spread = distance - 1;
    for (let side = -spread; side <= spread; side += 1) {
      squares.push(offsetCone(origin, direction, distance, side));
    }
  }

  return squares;
}

function offsetInDirection(
  origin: GridPosition,
  direction: CardinalDirection,
  distance: number
): GridPosition {
  switch (direction) {
    case 'north':
      return { x: origin.x, y: origin.y - distance };
    case 'east':
      return { x: origin.x + distance, y: origin.y };
    case 'south':
      return { x: origin.x, y: origin.y + distance };
    case 'west':
      return { x: origin.x - distance, y: origin.y };
  }
}

function offsetCone(
  origin: GridPosition,
  direction: CardinalDirection,
  distance: number,
  side: number
): GridPosition {
  switch (direction) {
    case 'north':
      return { x: origin.x + side, y: origin.y - distance };
    case 'east':
      return { x: origin.x + distance, y: origin.y + side };
    case 'south':
      return { x: origin.x + side, y: origin.y + distance };
    case 'west':
      return { x: origin.x - distance, y: origin.y + side };
  }
}
