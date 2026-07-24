import type { CardinalDirection, GridDefinition, GridPosition, ShapeDefinition } from './types';
import { measurePerformance } from '../performance/profiling';

export interface GridLookup {
  grid: GridDefinition;
  blockedKeys: Set<string>;
  heightByTile: Map<string, number>;
}

export interface ShapeQueryLookup {
  grid: GridLookup;
  shapeSquares: Map<string, GridPosition[]>;
}

export function createGridLookup(grid: GridDefinition): GridLookup {
  const heightByTile = new Map<string, number>();
  (grid.heights ?? []).forEach((height) => {
    const key = positionKey(height);
    if (!heightByTile.has(key)) {
      heightByTile.set(key, height.z ?? 0);
    }
  });
  return {
    grid,
    blockedKeys: new Set(grid.blocked.map(positionKey)),
    heightByTile
  };
}

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

export function isBlocked(position: GridPosition, grid: GridDefinition, lookup?: GridLookup): boolean {
  return lookup?.grid === grid
    ? lookup.blockedKeys.has(positionKey(position))
    : grid.blocked.some((blocked) => sameTilePosition(blocked, position));
}

export function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function position3DKey(position: GridPosition): string {
  return `${position.x},${position.y},${getElevation(position)}`;
}

export function getTileHeight(position: GridPosition, grid: GridDefinition, lookup?: GridLookup): number {
  return lookup?.grid === grid
    ? lookup.heightByTile.get(positionKey(position)) ?? 0
    : grid.heights?.find((height) => sameTilePosition(height, position))?.z ?? 0;
}

export function getTilePosition(position: GridPosition, grid: GridDefinition, lookup?: GridLookup): GridPosition {
  return {
    x: position.x,
    y: position.y,
    z: position.z ?? getTileHeight(position, grid, lookup)
  };
}

export function getShapeSquares(
  shape: ShapeDefinition,
  origin: GridPosition,
  grid: GridDefinition,
  direction: CardinalDirection = shape.direction ?? 'north',
  query?: ShapeQueryLookup
): GridPosition[] {
  const cacheKey = query?.grid.grid === grid ? getShapeCacheKey(shape, origin, direction) : undefined;
  const cached = cacheKey ? query?.shapeSquares.get(cacheKey) : undefined;
  if (cached) {
    return cached;
  }
  const squares = measurePerformance(
    'engine.targeting.shape-squares',
    () => getShapeSquaresInternal(shape, origin, grid, direction, query?.grid)
  );
  if (cacheKey) {
    query!.shapeSquares.set(cacheKey, squares);
  }
  return squares;
}

function getShapeSquaresInternal(
  shape: ShapeDefinition,
  origin: GridPosition,
  grid: GridDefinition,
  direction: CardinalDirection,
  lookup?: GridLookup
): GridPosition[] {
  const normalizedOrigin = getTilePosition(origin, grid, lookup);
  const rawSquares = buildRawShape(shape, normalizedOrigin, grid, direction, lookup);
  const seen = new Set<string>();

  return rawSquares.reduce<GridPosition[]>((squares, square) => {
    const positionedSquare = getTilePosition(square, grid, lookup);
    const key = position3DKey(positionedSquare);
    if (
      seen.has(key) ||
      !isInBounds(square, grid) ||
      isBlocked(square, grid, lookup) ||
      getTileHeight(positionedSquare, grid, lookup) > getElevation(positionedSquare) ||
      !hasLineOfEffect(normalizedOrigin, positionedSquare, grid, lookup)
    ) {
      return squares;
    }

    seen.add(key);
    squares.push(positionedSquare);
    return squares;
  }, []);
}

export function hasLineOfEffect(from: GridPosition, to: GridPosition, grid: GridDefinition, lookup?: GridLookup): boolean {
  const normalizedFrom = getTilePosition(from, grid, lookup);
  const normalizedTo = getTilePosition(to, grid, lookup);
  return getLineOfEffectSquares(normalizedFrom, normalizedTo)
    .filter((position) => !samePosition(position, normalizedFrom) && !samePosition(position, normalizedTo))
    .every((position) => {
      const tilePosition = getTilePosition(position, grid, lookup);
      return !isBlocked(tilePosition, grid, lookup) && getTileHeight(tilePosition, grid, lookup) <= getElevation(position);
    });
}

function getLineOfEffectSquares(from: GridPosition, to: GridPosition): GridPosition[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = getElevation(to) - getElevation(from);
  const horizontalSteps = Math.max(Math.abs(dx), Math.abs(dy));
  const verticalSteps = Math.abs(dz);
  const steps = Math.max(horizontalSteps, verticalSteps);

  if (steps === 0) {
    return [{ ...from, z: getElevation(from) }];
  }

  const horizontalSquares = getSupercoverLineSquares(from, to);
  const seen = new Set<string>();
  const points: GridPosition[] = [];

  horizontalSquares.forEach((square) => {
    const horizontalProgress = horizontalSteps === 0
      ? 0
      : Math.max(Math.abs(square.x - from.x), Math.abs(square.y - from.y)) / horizontalSteps;
    const z = Math.round(getElevation(from) + dz * horizontalProgress);
    const point = { ...square, z };
    const key = position3DKey(point);
    if (!seen.has(key)) {
      seen.add(key);
      points.push(point);
    }
  });

  if (verticalSteps > horizontalSteps) {
    const signZ = Math.sign(dz);
    for (let step = 1; step <= verticalSteps; step += 1) {
      const point = { x: from.x, y: from.y, z: getElevation(from) + signZ * step };
      const key = position3DKey(point);
      if (!seen.has(key)) {
        seen.add(key);
        points.push(point);
      }
    }
  }

  return points;
}

function getSupercoverLineSquares(from: GridPosition, to: GridPosition): GridPosition[] {
  const points: GridPosition[] = [{ x: from.x, y: from.y, z: getElevation(from) }];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let x = from.x;
  let y = from.y;
  let ix = 0;
  let iy = 0;

  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;

    if (decision === 0) {
      pushUnique2D(points, { x: x + stepX, y, z: getElevation(from) });
      pushUnique2D(points, { x, y: y + stepY, z: getElevation(from) });
      x += stepX;
      y += stepY;
      ix += 1;
      iy += 1;
    } else if (decision < 0) {
      x += stepX;
      ix += 1;
    } else {
      y += stepY;
      iy += 1;
    }

    pushUnique2D(points, { x, y, z: getElevation(from) });
  }

  return points;
}

function pushUnique2D(points: GridPosition[], position: GridPosition): void {
  if (!points.some((point) => point.x === position.x && point.y === position.y)) {
    points.push(position);
  }
}

function buildRawShape(
  shape: ShapeDefinition,
  origin: GridPosition,
  grid: GridDefinition,
  direction: CardinalDirection,
  lookup?: GridLookup
): GridPosition[] {
  if (shape.type === 'single') {
    return [origin];
  }

  if (shape.type === 'radius') {
    const radius = shape.radius ?? 1;
    const squares: GridPosition[] = [];

    for (let y = Math.max(0, origin.y - radius); y <= Math.min(grid.height - 1, origin.y + radius); y += 1) {
      for (let x = Math.max(0, origin.x - radius); x <= Math.min(grid.width - 1, origin.x + radius); x += 1) {
        const candidateElevations = uniqueNumbers([getTileHeight({ x, y }, grid, lookup), getElevation(origin)]);
        candidateElevations.forEach((z) => {
          const square = { x, y, z };
          const distance = Math.max(
            Math.abs(square.x - origin.x),
            Math.abs(square.y - origin.y),
            Math.abs(getElevation(square) - getElevation(origin))
          );
          if (distance <= radius) {
            squares.push(square);
          }
        });
      }
    }

    return squares;
  }

  if (shape.type === 'line') {
    const length = shape.length ?? 1;
    return Array.from({ length }, (_, index) =>
      projectShapeSquareHeight(origin, offsetInDirection(origin, direction, index + 1), grid, lookup)
    );
  }

  const length = shape.length ?? 1;
  const squares: GridPosition[] = [];

  for (let distance = 1; distance <= length; distance += 1) {
    const spread = distance - 1;
    for (let side = -spread; side <= spread; side += 1) {
      squares.push(projectShapeSquareHeight(origin, offsetCone(origin, direction, distance, side), grid, lookup));
    }
  }

  return squares;
}

function projectShapeSquareHeight(origin: GridPosition, square: GridPosition, grid: GridDefinition, lookup?: GridLookup): GridPosition {
  return {
    ...square,
    z: Math.max(getElevation(origin), getTileHeight(square, grid, lookup))
  };
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function getShapeCacheKey(shape: ShapeDefinition, origin: GridPosition, direction: CardinalDirection): string {
  return [
    shape.type,
    shape.radius ?? '',
    shape.length ?? '',
    shape.direction ?? '',
    direction,
    position3DKey(origin)
  ].join('|');
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
