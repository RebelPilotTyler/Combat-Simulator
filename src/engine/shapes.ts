import type { CardinalDirection, GridDefinition, GridPosition, ShapeDefinition } from './types';

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isInBounds(position: GridPosition, grid: GridDefinition): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < grid.width && position.y < grid.height;
}

export function isBlocked(position: GridPosition, grid: GridDefinition): boolean {
  return grid.blocked.some((blocked) => samePosition(blocked, position));
}

export function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function getShapeSquares(
  shape: ShapeDefinition,
  origin: GridPosition,
  grid: GridDefinition,
  direction: CardinalDirection = shape.direction ?? 'north'
): GridPosition[] {
  const rawSquares = buildRawShape(shape, origin, direction);
  const seen = new Set<string>();

  return rawSquares.filter((square) => {
    const key = positionKey(square);
    if (seen.has(key) || !isInBounds(square, grid) || isBlocked(square, grid)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildRawShape(
  shape: ShapeDefinition,
  origin: GridPosition,
  direction: CardinalDirection
): GridPosition[] {
  if (shape.type === 'single') {
    return [origin];
  }

  if (shape.type === 'radius') {
    const radius = shape.radius ?? 1;
    const squares: GridPosition[] = [];

    for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
      for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
        const dx = x - origin.x;
        const dy = y - origin.y;
        if (dx * dx + dy * dy <= radius * radius) {
          squares.push({ x, y });
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
