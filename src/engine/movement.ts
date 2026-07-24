import type { CombatState, Creature, GridPosition } from './types';
import { canCreatureMove, getMovementCostMultiplier, normalizeConditions } from './conditions';
import { getElevation, getTileHeight, getTilePosition, isBlocked, isInBounds, position3DKey, samePosition } from './shapes';
import { getEffectiveClimbSpeed, getEffectiveFlySpeed, getEffectiveMovementSpeed, getEffectiveSpeed } from './features';
import { areAllies, areHostile } from './teams';
import { incrementPerformanceCounter, measurePerformance } from '../performance/profiling';
import { getCombatQueryContext, isCombatQueryContextCurrent, type CombatQueryContext } from './queryContext';

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

interface TraversalStep {
  position: GridPosition;
  steps: number;
}

interface DestinationSearch {
  creature: Creature;
  modes: MovementModeDefinition[];
  startingPosition: GridPosition;
  costMultiplier: number;
  traversalSteps: Map<string, TraversalStep[]>;
}

export function getReachableMovementSquares(
  state: CombatState,
  creatureId: string,
  query?: CombatQueryContext
): MovementOption[] {
  const context = getCombatQueryContext(state, query);
  return measurePerformance('engine.movement.reachable', () => getReachableMovementSquaresInternal(state, creatureId, context));
}

function getReachableMovementSquaresInternal(state: CombatState, creatureId: string, query: CombatQueryContext): MovementOption[] {
  const creature = query.creatureById.get(creatureId);
  if (!creature) {
    throw new Error(`Creature not found: ${creatureId}`);
  }

  creature.conditions = normalizeConditions(creature.conditions);
  if (!canCreatureMove(state, creature, query.conditions)) {
    return [];
  }

  const maxFeet = state.turnState.creatureId === creatureId ? state.turnState.remainingMovement : getEffectiveMovementSpeed(creature, state);
  const costMultiplier = getMovementCostMultiplier(state, creature, query.conditions);
  const startingPosition = getTilePosition(creature.position, state.grid, query.grid);
  const visited = getAvailableMovementModes(state, creature, maxFeet).reduce(
    (combined, mode) => mergeVisitedCosts(combined, getReachableByMode(state, creature, mode, startingPosition, costMultiplier, query)),
    new Map<string, PathCost>()
  );
  incrementPerformanceCounter('engine.movement.reachable-destinations', visited.size);

  return [...visited.entries()]
    .filter(([key]) => key !== position3DKey(startingPosition))
    .map(([_key, pathCost]) => {
      const position = pathCost.path[pathCost.path.length - 1];
      return { position, costFeet: pathCost.steps * FEET_PER_SQUARE, path: pathCost.path };
    })
    .filter((option) => !isOccupied(state, option.position, creature.id, query))
    .sort((a, b) => a.costFeet - b.costFeet || a.position.y - b.position.y || a.position.x - b.position.x);
}

export function getMovementCost(
  state: CombatState,
  creatureId: string,
  destination: GridPosition,
  query?: CombatQueryContext
): number | undefined {
  return getMovementOption(state, creatureId, destination, query)?.costFeet;
}

export function getMovementOption(
  state: CombatState,
  creatureId: string,
  destination: GridPosition,
  query?: CombatQueryContext
): MovementOption | undefined {
  const context = getCombatQueryContext(state, query);
  const destinationPosition = getTilePosition(destination, state.grid, context.grid);
  return getReachableMovementSquares(state, creatureId, context).find((option) => samePosition(option.position, destinationPosition));
}

export function getMovementOptionsForDestination(
  state: CombatState,
  creatureId: string,
  destination: GridPosition,
  maxOptions = 8,
  query?: CombatQueryContext
): MovementOption[] {
  const context = getCombatQueryContext(state, query);
  return measurePerformance(
    'engine.movement.destination-options',
    () => getMovementOptionsForDestinationInternal(state, creatureId, destination, maxOptions, context)
  );
}

export function getMovementOptionsForDestinations(
  state: CombatState,
  creatureId: string,
  destinations: GridPosition[],
  maxOptions = 8,
  query?: CombatQueryContext
): Map<string, MovementOption[]> {
  const context = getCombatQueryContext(state, query);
  return measurePerformance('engine.movement.destination-options-batch', () => {
    const results = new Map<string, MovementOption[]>();
    const search = prepareDestinationSearch(state, creatureId, maxOptions, context);
    if (!search) {
      return results;
    }

    destinations.forEach((destination) => {
      const destinationPosition = getTilePosition(destination, state.grid, context.grid);
      const key = position3DKey(destinationPosition);
      if (!results.has(key)) {
        results.set(
          key,
          getMovementOptionsForPreparedDestination(state, destinationPosition, maxOptions, context, search)
        );
      }
    });
    incrementPerformanceCounter('engine.movement.preferred-destinations', results.size);
    return results;
  });
}

function getMovementOptionsForDestinationInternal(
  state: CombatState,
  creatureId: string,
  destination: GridPosition,
  maxOptions: number,
  query: CombatQueryContext
): MovementOption[] {
  const search = prepareDestinationSearch(state, creatureId, maxOptions, query);
  if (!search) {
    return [];
  }

  const destinationPosition = getTilePosition(destination, state.grid, query.grid);
  return getMovementOptionsForPreparedDestination(state, destinationPosition, maxOptions, query, search);
}

function prepareDestinationSearch(
  state: CombatState,
  creatureId: string,
  maxOptions: number,
  query: CombatQueryContext
): DestinationSearch | undefined {
  const creature = query.creatureById.get(creatureId);
  if (!creature || maxOptions <= 0) {
    return undefined;
  }

  creature.conditions = normalizeConditions(creature.conditions);
  if (!canCreatureMove(state, creature, query.conditions)) {
    return undefined;
  }

  const maxFeet = state.turnState.creatureId === creatureId
    ? state.turnState.remainingMovement
    : getEffectiveMovementSpeed(creature, state);
  return {
    creature,
    modes: getAvailableMovementModes(state, creature, maxFeet),
    startingPosition: getTilePosition(creature.position, state.grid, query.grid),
    costMultiplier: getMovementCostMultiplier(state, creature, query.conditions),
    traversalSteps: new Map()
  };
}

function getMovementOptionsForPreparedDestination(
  state: CombatState,
  destinationPosition: GridPosition,
  maxOptions: number,
  query: CombatQueryContext,
  search: DestinationSearch
): MovementOption[] {
  if (
    samePosition(search.startingPosition, destinationPosition) ||
    isOccupied(state, destinationPosition, search.creature.id, query)
  ) {
    return [];
  }

  const options = search.modes.flatMap((mode) =>
    getMovementOptionsForDestinationByMode(
      state,
      search.creature,
      mode,
      search.startingPosition,
      destinationPosition,
      search.costMultiplier,
      maxOptions,
      query,
      search.traversalSteps
    )
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

export function getMovementOptionForPath(
  state: CombatState,
  creatureId: string,
  path: GridPosition[],
  query?: CombatQueryContext
): MovementOption | undefined {
  const context = getCombatQueryContext(state, query);
  const creature = context.creatureById.get(creatureId);
  if (!creature || path.length === 0) {
    return undefined;
  }

  creature.conditions = normalizeConditions(creature.conditions);
  if (!canCreatureMove(state, creature, context.conditions)) {
    return undefined;
  }

  const startingPosition = getTilePosition(creature.position, state.grid, context.grid);
  const normalizedPath = samePosition(getTilePosition(path[0], state.grid, context.grid), startingPosition)
    ? path.map((position) => getTilePosition(position, state.grid, context.grid))
    : [startingPosition, ...path.map((position) => getTilePosition(position, state.grid, context.grid))];
  const destination = normalizedPath[normalizedPath.length - 1];
  if (normalizedPath.length < 2 || isOccupied(state, destination, creature.id, context)) {
    return undefined;
  }

  const maxFeet = state.turnState.creatureId === creatureId ? state.turnState.remainingMovement : getEffectiveMovementSpeed(creature, state);
  const costMultiplier = getMovementCostMultiplier(state, creature, context.conditions);
  const validOptions = getAvailableMovementModes(state, creature, maxFeet).flatMap((mode) => {
    let steps = 0;

    for (let index = 1; index < normalizedPath.length; index += 1) {
      const from = normalizedPath[index - 1];
      const to = normalizedPath[index];
      const isNeighbor = getNeighborPositions(state, from, mode.mode, context).some((candidate) => samePosition(candidate, to));
      if (
        !isNeighbor ||
        normalizedPath.slice(0, index).some((position) => samePosition(position, to)) ||
        !canEnterPosition(state, creature, to, context) ||
        !canTraverseDiagonal(state, creature, from, to, mode.mode, context) ||
        !canTraverseElevation(from, to, mode.mode)
      ) {
        return [];
      }

      steps += getStepCost(state, creature, from, to, costMultiplier, context);
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
  maxOptions: number,
  query: CombatQueryContext,
  traversalSteps: Map<string, TraversalStep[]>
): MovementOption[] {
  const maxSteps = Math.floor(mode.maxFeet / FEET_PER_SQUARE);
  const queue: PathCost[] = [{ path: [startingPosition], steps: 0 }];
  const options: MovementOption[] = [];
  let explored = 0;
  let queueIndex = 0;

  while (queueIndex < queue.length && explored < 5000) {
    explored += 1;
    const current = queue[queueIndex++];
    const currentPosition = current.path[current.path.length - 1];
    if (current.steps >= maxSteps) {
      continue;
    }

    for (const step of getTraversalSteps(state, creature, currentPosition, mode.mode, costMultiplier, query, traversalSteps)) {
      const next = step.position;
      if (current.path.some((position) => samePosition(position, next))) {
        continue;
      }

      const nextSteps = current.steps + step.steps;
      if (nextSteps > maxSteps) {
        continue;
      }

      const path = [...current.path, next];
      if (samePosition(next, destinationPosition)) {
        options.push({ position: next, costFeet: nextSteps * FEET_PER_SQUARE, path });
        if (options.length >= maxOptions) {
          incrementPerformanceCounter('engine.movement.destination-nodes-explored', explored);
          return options;
        }
        continue;
      }

      queue.push({ path, steps: nextSteps });
    }
  }

  incrementPerformanceCounter('engine.movement.destination-nodes-explored', explored);
  return options;
}

function getTraversalSteps(
  state: CombatState,
  creature: Creature,
  from: GridPosition,
  mode: MovementMode,
  costMultiplier: number,
  query: CombatQueryContext,
  cache: Map<string, TraversalStep[]>
): TraversalStep[] {
  const key = `${mode}|${position3DKey(from)}`;
  const cached = cache.get(key);
  if (cached) {
    incrementPerformanceCounter('engine.movement.transition-cache-hits');
    return cached;
  }

  const steps = getNeighborPositions(state, from, mode, query)
    .filter(
      (position) =>
        canEnterPosition(state, creature, position, query) &&
        canTraverseDiagonal(state, creature, from, position, mode, query) &&
        canTraverseElevation(from, position, mode)
    )
    .map((position) => ({
      position,
      steps: getStepCost(state, creature, from, position, costMultiplier, query)
    }));
  cache.set(key, steps);
  incrementPerformanceCounter('engine.movement.transition-cache-misses');
  return steps;
}

export function isOccupied(
  state: CombatState,
  position: GridPosition,
  ignoredCreatureId?: string,
  query?: CombatQueryContext
): boolean {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  const candidates = context
    ? context.creaturesByPosition.get(position3DKey(position)) ?? []
    : state.creatures;
  return candidates.some(
    (creature) =>
      creature.id !== ignoredCreatureId &&
      creature.hp > 0 &&
      !(context
        ? context.conditions.idsByCreatureId.get(creature.id)?.has('defeated')
        : normalizeConditions(creature.conditions).some((condition) => condition.id === 'defeated')) &&
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
  costMultiplier: number,
  query: CombatQueryContext
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

    for (const next of getNeighborPositions(state, currentPosition, mode.mode, query)) {
      if (
        !canEnterPosition(state, creature, next, query) ||
        !canTraverseDiagonal(state, creature, currentPosition, next, mode.mode, query) ||
        !canTraverseElevation(currentPosition, next, mode.mode)
      ) {
        continue;
      }

      const nextSteps = current.steps + getStepCost(state, creature, currentPosition, next, costMultiplier, query);
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

  incrementPerformanceCounter('engine.movement.reachable-nodes-visited', visited.size);
  return visited;
}

function getNeighborPositions(
  state: CombatState,
  position: GridPosition,
  mode: MovementMode,
  query: CombatQueryContext
): GridPosition[] {
  if (mode !== 'fly') {
    return neighbors(position).map((neighbor) => getTilePosition(neighbor, state.grid, query.grid));
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
    const terrainPosition = getTilePosition(neighbor, state.grid, query.grid);
    add(terrainPosition);

    const sameAltitudePosition = { ...terrainPosition, z: getElevation(position) };
    if (getElevation(sameAltitudePosition) >= getTileHeight(sameAltitudePosition, state.grid, query.grid)) {
      add(sameAltitudePosition);
    }
  });

  add({ ...position, z: getElevation(position) + 1 });
  if (getElevation(position) > getTileHeight(position, state.grid, query.grid)) {
    add({ ...position, z: getElevation(position) - 1 });
  }

  return positions;
}

function canEnterPosition(
  state: CombatState,
  creature: Creature,
  position: GridPosition,
  query: CombatQueryContext
): boolean {
  return (
    isInBounds(position, state.grid) &&
    !isBlocked(position, state.grid, query.grid) &&
    getElevation(position) >= getTileHeight(position, state.grid, query.grid) &&
    !isOccupiedByHostileCreature(state, creature, position, query)
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
  mode: MovementMode,
  query: CombatQueryContext
): boolean {
  if (Math.abs(to.x - from.x) !== 1 || Math.abs(to.y - from.y) !== 1) {
    return true;
  }

  return [
    { x: to.x, y: from.y, z: getElevation(to) },
    { x: from.x, y: to.y, z: getElevation(to) }
  ].some(
    (side) =>
      canEnterPosition(state, creature, side, query) &&
      !isOccupied(state, side, creature.id, query) &&
      canTraverseElevation(from, side, mode)
  );
}

function getStepCost(
  state: CombatState,
  creature: Creature,
  from: GridPosition,
  to: GridPosition,
  costMultiplier: number,
  query: CombatQueryContext
): number {
  const baseCost = Math.max(1, Math.abs(getElevation(to) - getElevation(from))) * costMultiplier;
  return isOccupiedByAlliedCreature(state, creature, to, query) ? baseCost + 1 : baseCost;
}

function isOccupiedByHostileCreature(
  state: CombatState,
  mover: Creature,
  position: GridPosition,
  query: CombatQueryContext
): boolean {
  const occupyingCreature = getOccupyingCreature(position, query, mover.id);
  return occupyingCreature !== undefined && areHostile(occupyingCreature, mover, state, query.teams);
}

function isOccupiedByAlliedCreature(
  state: CombatState,
  mover: Creature,
  position: GridPosition,
  query: CombatQueryContext
): boolean {
  const occupyingCreature = getOccupyingCreature(position, query, mover.id);
  return occupyingCreature !== undefined && areAllies(occupyingCreature, mover, state, query.teams);
}

function getOccupyingCreature(
  position: GridPosition,
  query: CombatQueryContext,
  ignoredCreatureId?: string
): Creature | undefined {
  return (query.creaturesByPosition.get(position3DKey(position)) ?? []).find(
    (creature) =>
      creature.id !== ignoredCreatureId &&
      creature.hp > 0 &&
      !query.conditions.idsByCreatureId.get(creature.id)?.has('defeated') &&
      samePosition(creature.position, position)
  );
}
