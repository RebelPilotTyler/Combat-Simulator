import type { CombatState, Creature, GridPosition } from './types';
import { canCreatureMove, getMovementCostMultiplier, normalizeConditions } from './conditions';
import { getElevation, getTileHeight, getTilePosition, isBlocked, isInBounds, position3DKey, samePosition } from './shapes';
import { getEffectiveClimbSpeed, getEffectiveFlySpeed, getEffectiveMovementSpeed, getEffectiveSpeed } from './features';
import { areAllies, areHostile } from './teams';

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
    (combined, mode) => mergeVisitedCosts(combined, getReachableByMode(state, creature, mode, startingPosition, costMultiplier)),
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

export function getMovementOptionsForDestination(
  state: CombatState,
  creatureId: string,
  destination: GridPosition,
  maxOptions = 8
): MovementOption[] {
  const creature = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!creature || maxOptions <= 0) {
    return [];
  }

  creature.conditions = normalizeConditions(creature.conditions);
  if (!canCreatureMove(state, creature)) {
    return [];
  }

  const maxFeet = state.turnState.creatureId === creatureId ? state.turnState.remainingMovement : getEffectiveMovementSpeed(creature, state);
  const costMultiplier = getMovementCostMultiplier(state, creature);
  const startingPosition = getTilePosition(creature.position, state.grid);
  const destinationPosition = getTilePosition(destination, state.grid);
  if (samePosition(startingPosition, destinationPosition) || isOccupied(state, destinationPosition, creature.id)) {
    return [];
  }

  const options = getAvailableMovementModes(state, creature, maxFeet).flatMap((mode) =>
    getMovementOptionsForDestinationByMode(state, creature, mode, startingPosition, destinationPosition, costMultiplier, maxOptions)
  );
  const seen = new Set<string>();
  return options
    .filter((option) => {
      const key = option.path.map(position3DKey).join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.costFeet - b.costFeet || a.path.length - b.path.length)
    .slice(0, maxOptions);
}

export function getMovementOptionForPath(state: CombatState, creatureId: string, path: GridPosition[]): MovementOption | undefined {
  const creature = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!creature || path.length === 0) {
    return undefined;
  }

  creature.conditions = normalizeConditions(creature.conditions);
  if (!canCreatureMove(state, creature)) {
    return undefined;
  }

  const startingPosition = getTilePosition(creature.position, state.grid);
  const normalizedPath = samePosition(getTilePosition(path[0], state.grid), startingPosition)
    ? path.map((position) => getTilePosition(position, state.grid))
    : [startingPosition, ...path.map((position) => getTilePosition(position, state.grid))];
  const destination = normalizedPath[normalizedPath.length - 1];
  if (normalizedPath.length < 2 || isOccupied(state, destination, creature.id)) {
    return undefined;
  }

  const maxFeet = state.turnState.creatureId === creatureId ? state.turnState.remainingMovement : getEffectiveMovementSpeed(creature, state);
  const costMultiplier = getMovementCostMultiplier(state, creature);
  const validOptions = getAvailableMovementModes(state, creature, maxFeet).flatMap((mode) => {
    let steps = 0;

    for (let index = 1; index < normalizedPath.length; index += 1) {
      const from = normalizedPath[index - 1];
      const to = normalizedPath[index];
      const isNeighbor = getNeighborPositions(state, from, mode.mode).some((candidate) => samePosition(candidate, to));
      if (
        !isNeighbor ||
        normalizedPath.slice(0, index).some((position) => samePosition(position, to)) ||
        !canEnterPosition(state, creature, to) ||
        !canTraverseDiagonal(state, creature, from, to, mode.mode) ||
        !canTraverseElevation(from, to, mode.mode)
      ) {
        return [];
      }

      steps += getStepCost(state, creature, from, to, costMultiplier);
    }

    return steps * FEET_PER_SQUARE <= mode.maxFeet
      ? [{ position: destination, costFeet: steps * FEET_PER_SQUARE, path: normalizedPath }]
      : [];
  });

  return validOptions.sort((a, b) => a.costFeet - b.costFeet)[0];
}

function getMovementOptionsForDestinationByMode(
  state: CombatState,
  creature: Creature,
  mode: MovementModeDefinition,
  startingPosition: GridPosition,
  destinationPosition: GridPosition,
  costMultiplier: number,
  maxOptions: number
): MovementOption[] {
  const maxSteps = Math.floor(mode.maxFeet / FEET_PER_SQUARE);
  const queue: PathCost[] = [{ path: [startingPosition], steps: 0 }];
  const options: MovementOption[] = [];
  let explored = 0;

  while (queue.length > 0 && explored < 5000) {
    explored += 1;
    const current = queue.shift()!;
    const currentPosition = current.path[current.path.length - 1];
    if (current.steps >= maxSteps) {
      continue;
    }

    for (const next of getNeighborPositions(state, currentPosition, mode.mode)) {
      if (
        current.path.some((position) => samePosition(position, next)) ||
        !canEnterPosition(state, creature, next) ||
        !canTraverseDiagonal(state, creature, currentPosition, next, mode.mode) ||
        !canTraverseElevation(currentPosition, next, mode.mode)
      ) {
        continue;
      }

      const nextSteps = current.steps + getStepCost(state, creature, currentPosition, next, costMultiplier);
      if (nextSteps > maxSteps) {
        continue;
      }

      const path = [...current.path, next];
      if (samePosition(next, destinationPosition)) {
        options.push({ position: next, costFeet: nextSteps * FEET_PER_SQUARE, path });
        if (options.length >= maxOptions) {
          return options;
        }
        continue;
      }

      queue.push({ path, steps: nextSteps });
    }
  }

  return options;
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
    { x: position.x + 1, y: position.y - 1 },
    { x: position.x + 1, y: position.y },
    { x: position.x + 1, y: position.y + 1 },
    { x: position.x, y: position.y + 1 },
    { x: position.x - 1, y: position.y + 1 },
    { x: position.x - 1, y: position.y },
    { x: position.x - 1, y: position.y - 1 }
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
  creature: Creature,
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

    for (const next of getNeighborPositions(state, currentPosition, mode.mode)) {
      if (
        !canEnterPosition(state, creature, next) ||
        !canTraverseDiagonal(state, creature, currentPosition, next, mode.mode) ||
        !canTraverseElevation(currentPosition, next, mode.mode)
      ) {
        continue;
      }

      const nextSteps = current.steps + getStepCost(state, creature, currentPosition, next, costMultiplier);
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

function getNeighborPositions(state: CombatState, position: GridPosition, mode: MovementMode): GridPosition[] {
  if (mode !== 'fly') {
    return neighbors(position).map((neighbor) => getTilePosition(neighbor, state.grid));
  }

  const seen = new Set<string>();
  const positions: GridPosition[] = [];
  const add = (candidate: GridPosition) => {
    const key = position3DKey(candidate);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    positions.push(candidate);
  };

  neighbors(position).forEach((neighbor) => {
    const terrainPosition = getTilePosition(neighbor, state.grid);
    add(terrainPosition);

    const sameAltitudePosition = { ...terrainPosition, z: getElevation(position) };
    if (getElevation(sameAltitudePosition) >= getTileHeight(sameAltitudePosition, state.grid)) {
      add(sameAltitudePosition);
    }
  });

  add({ ...position, z: getElevation(position) + 1 });
  if (getElevation(position) > getTileHeight(position, state.grid)) {
    add({ ...position, z: getElevation(position) - 1 });
  }

  return positions;
}

function canEnterPosition(state: CombatState, creature: Creature, position: GridPosition): boolean {
  return (
    isInBounds(position, state.grid) &&
    !isBlocked(position, state.grid) &&
    getElevation(position) >= getTileHeight(position, state.grid) &&
    !isOccupiedByHostileCreature(state, creature, position)
  );
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

function canTraverseDiagonal(
  state: CombatState,
  creature: Creature,
  from: GridPosition,
  to: GridPosition,
  mode: MovementMode
): boolean {
  if (Math.abs(to.x - from.x) !== 1 || Math.abs(to.y - from.y) !== 1) {
    return true;
  }

  return [
    { x: to.x, y: from.y, z: getElevation(to) },
    { x: from.x, y: to.y, z: getElevation(to) }
  ].some(
    (side) =>
      canEnterPosition(state, creature, side) &&
      !isOccupied(state, side, creature.id) &&
      canTraverseElevation(from, side, mode)
  );
}

function getStepCost(state: CombatState, creature: Creature, from: GridPosition, to: GridPosition, costMultiplier: number): number {
  const baseCost = Math.max(1, Math.abs(getElevation(to) - getElevation(from))) * costMultiplier;
  return isOccupiedByAlliedCreature(state, creature, to) ? baseCost + 1 : baseCost;
}

function isOccupiedByHostileCreature(state: CombatState, mover: Creature, position: GridPosition): boolean {
  const occupyingCreature = getOccupyingCreature(state, position, mover.id);
  return occupyingCreature !== undefined && areHostile(occupyingCreature, mover, state);
}

function isOccupiedByAlliedCreature(state: CombatState, mover: Creature, position: GridPosition): boolean {
  const occupyingCreature = getOccupyingCreature(state, position, mover.id);
  return occupyingCreature !== undefined && areAllies(occupyingCreature, mover, state);
}

function getOccupyingCreature(state: CombatState, position: GridPosition, ignoredCreatureId?: string): Creature | undefined {
  return state.creatures.find(
    (creature) =>
      creature.id !== ignoredCreatureId &&
      creature.hp > 0 &&
      !normalizeConditions(creature.conditions).some((condition) => condition.id === 'defeated') &&
      samePosition(creature.position, position)
  );
}
