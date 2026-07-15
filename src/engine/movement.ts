import type { CombatState, Creature, GridPosition } from './types';
import { canCreatureMove, getMovementCostMultiplier, normalizeConditions } from './conditions';
import { getElevation, getTilePosition, isBlocked, isInBounds, position3DKey, samePosition } from './shapes';
import { getEffectiveClimbSpeed, getEffectiveFlySpeed, getEffectiveMovementSpeed, getEffectiveSpeed } from './features';

export const FEET_PER_SQUARE = 5;

export interface MovementOption {
  position: GridPosition;
  costFeet: number;
  path: GridPosition[];
}

type MovementMode = 'walk' | 'climb' | 'fly';

interface MovementModeDefinition {
  mode: MovementMode;
  maxFeet: number;
}

interface PathCost {
  steps: number;
  path: GridPosition[];
}

export function getReachableMovementSquares(state: CombatState, creatureId: string): MovementOption[] {
  const creature = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!creature) {
    throw new Error(`Creature not found: ${creatureId}`);
  }

  creature.conditions = normalizeConditions(creature.conditions);
  if (!canCreatureMove(state, creature)) {
    return [];
  }

  const maxFeet = state.turnState.creatureId === creatureId ? state.turnState.remainingMovement : getEffectiveMovementSpeed(creature, state);
  const costMultiplier = getMovementCostMultiplier(state, creature);
  const startingPosition = getTilePosition(creature.position, state.grid);
  const visited = getAvailableMovementModes(state, creature, maxFeet).reduce(
    (combined, mode) => mergeVisitedCosts(combined, getReachableByMode(state, mode, startingPosition, costMultiplier)),
    new Map<string, PathCost>()
  );

  return [...visited.entries()]
    .filter(([key]) => key !== position3DKey(startingPosition))
    .map(([_key, pathCost]) => {
      const position = pathCost.path[pathCost.path.length - 1];
      return { position, costFeet: pathCost.steps * FEET_PER_SQUARE, path: pathCost.path };
    })
    .filter((option) => !isOccupied(state, option.position, creature.id))
    .sort((a, b) => a.costFeet - b.costFeet || a.position.y - b.position.y || a.position.x - b.position.x);
}

export function getMovementCost(state: CombatState, creatureId: string, destination: GridPosition): number | undefined {
  return getMovementOption(state, creatureId, destination)?.costFeet;
}

export function getMovementOption(state: CombatState, creatureId: string, destination: GridPosition): MovementOption | undefined {
  const destinationPosition = getTilePosition(destination, state.grid);
  return getReachableMovementSquares(state, creatureId).find((option) => samePosition(option.position, destinationPosition));
}

export function getMovementOptionForPath(state: CombatState, creatureId: string, path: GridPosition[]): MovementOption | undefined {
  const creature = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!creature || path.length === 0) {
    return undefined;
  }

  const startingPosition = getTilePosition(creature.position, state.grid);
  const normalizedPath = samePosition(getTilePosition(path[0], state.grid), startingPosition)
    ? path.map((position) => getTilePosition(position, state.grid))
    : [startingPosition, ...path.map((position) => getTilePosition(position, state.grid))];

  return getReachableMovementSquares(state, creatureId).find((option) => samePath(option.path, normalizedPath));
}

export function isOccupied(state: CombatState, position: GridPosition, ignoredCreatureId?: string): boolean {
  return state.creatures.some(
    (creature) =>
      creature.id !== ignoredCreatureId &&
      creature.hp > 0 &&
      !normalizeConditions(creature.conditions).some((condition) => condition.id === 'defeated') &&
      samePosition(creature.position, position)
  );
}

function neighbors(position: GridPosition): GridPosition[] {
  return [
    { x: position.x, y: position.y - 1 },
    { x: position.x + 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x - 1, y: position.y }
  ];
}

function getAvailableMovementModes(state: CombatState, creature: Creature, maxFeet: number): MovementModeDefinition[] {
  const modes: MovementModeDefinition[] = [
    { mode: 'walk', maxFeet: Math.min(maxFeet, getEffectiveSpeed(creature, state)) }
  ];
  const climbSpeed = getEffectiveClimbSpeed(creature, state);
  const flySpeed = getEffectiveFlySpeed(creature, state);

  if (climbSpeed > 0) {
    modes.push({ mode: 'climb', maxFeet: Math.min(maxFeet, climbSpeed) });
  }

  if (flySpeed > 0) {
    modes.push({ mode: 'fly', maxFeet: Math.min(maxFeet, flySpeed) });
  }

  return modes.filter((mode) => mode.maxFeet >= FEET_PER_SQUARE);
}

function getReachableByMode(
  state: CombatState,
  mode: MovementModeDefinition,
  startingPosition: GridPosition,
  costMultiplier: number
): Map<string, PathCost> {
  const maxSteps = Math.floor(mode.maxFeet / FEET_PER_SQUARE);
  const visited = new Map<string, PathCost>();
  const queue: Array<PathCost> = [{ path: [startingPosition], steps: 0 }];
  visited.set(position3DKey(startingPosition), { path: [startingPosition], steps: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentPosition = current.path[current.path.length - 1];
    if (current.steps >= maxSteps) {
      continue;
    }

    for (const neighbor of neighbors(currentPosition)) {
      const next = getTilePosition(neighbor, state.grid);
      if (!isInBounds(next, state.grid) || isBlocked(next, state.grid) || !canTraverseElevation(currentPosition, next, mode.mode)) {
        continue;
      }

      const nextSteps = current.steps + getStepCost(currentPosition, next, costMultiplier);
      if (nextSteps > maxSteps) {
        continue;
      }

      const key = position3DKey(next);
      const previous = visited.get(key);
      if (previous !== undefined && previous.steps <= nextSteps) {
        continue;
      }

      const pathCost = { path: [...current.path, next], steps: nextSteps };
      visited.set(key, pathCost);
      queue.push(pathCost);
    }
  }

  return visited;
}

function mergeVisitedCosts(current: Map<string, PathCost>, next: Map<string, PathCost>): Map<string, PathCost> {
  next.forEach((pathCost, key) => {
    const existing = current.get(key);
    if (existing === undefined || pathCost.steps < existing.steps) {
      current.set(key, pathCost);
    }
  });
  return current;
}

function canTraverseElevation(from: GridPosition, to: GridPosition, mode: MovementMode): boolean {
  if (mode === 'climb' || mode === 'fly') {
    return true;
  }

  return getElevation(to) - getElevation(from) <= 1;
}

function getStepCost(from: GridPosition, to: GridPosition, costMultiplier: number): number {
  return Math.max(1, Math.abs(getElevation(to) - getElevation(from))) * costMultiplier;
}

function samePath(a: GridPosition[], b: GridPosition[]): boolean {
  return a.length === b.length && a.every((position, index) => samePosition(position, b[index]));
}
