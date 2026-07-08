import type { CombatState, Creature, GridPosition } from './types';
import { canCreatureMove, getMovementCostMultiplier, normalizeConditions } from './conditions';
import { isBlocked, isInBounds, positionKey, samePosition } from './shapes';

export const FEET_PER_SQUARE = 5;

export interface MovementOption {
  position: GridPosition;
  costFeet: number;
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

  const maxFeet = state.turnState.creatureId === creatureId ? state.turnState.remainingMovement : creature.speed;
  const costMultiplier = getMovementCostMultiplier(state, creature);
  const maxSteps = Math.floor(maxFeet / FEET_PER_SQUARE);
  const visited = new Map<string, number>();
  const queue: Array<{ position: GridPosition; steps: number }> = [{ position: creature.position, steps: 0 }];
  visited.set(positionKey(creature.position), 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.steps >= maxSteps) {
      continue;
    }

    for (const next of neighbors(current.position)) {
      if (!isInBounds(next, state.grid) || isBlocked(next, state.grid)) {
        continue;
      }

      const nextSteps = current.steps + costMultiplier;
      const key = positionKey(next);
      const previous = visited.get(key);
      if (previous !== undefined && previous <= nextSteps) {
        continue;
      }

      visited.set(key, nextSteps);
      queue.push({ position: next, steps: nextSteps });
    }
  }

  return [...visited.entries()]
    .filter(([key]) => key !== positionKey(creature.position))
    .map(([key, steps]) => {
      const [x, y] = key.split(',').map(Number);
      return { position: { x, y }, costFeet: steps * FEET_PER_SQUARE };
    })
    .filter((option) => !isOccupied(state, option.position, creature.id))
    .sort((a, b) => a.costFeet - b.costFeet || a.position.y - b.position.y || a.position.x - b.position.x);
}

export function getMovementCost(state: CombatState, creatureId: string, destination: GridPosition): number | undefined {
  return getReachableMovementSquares(state, creatureId).find((option) => samePosition(option.position, destination))?.costFeet;
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
