import type { ActionDefinition, CombatState, Creature, GridPosition } from './types';
import { canCreatureTakeReaction, hasCondition } from './conditions';
import { isBlocked, samePosition } from './shapes';

export function getDistanceInSquares(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function getDistanceFeet(a: GridPosition, b: GridPosition): number {
  return getDistanceInSquares(a, b) * 5;
}

export const getDistanceInFeet = getDistanceFeet;

export function isInActionRange(action: ActionDefinition, attacker: GridPosition, target: GridPosition): boolean {
  const distance = getDistanceFeet(attacker, target);
  const rangeFeet = action.normalRange ?? action.range * 5;

  if (action.type === 'meleeAttack' || action.kind === 'meleeAttack' || action.tags.includes('melee')) {
    return distance <= (action.reach ?? Math.min(rangeFeet, 5));
  }

  return distance <= rangeFeet;
}

export function getMeleeReach(creature: Creature): number {
  const reaches = creature.actions
    .filter((action) => action.tags.includes('melee') || action.type === 'meleeAttack' || action.kind === 'meleeAttack')
    .map((action) => action.reach ?? 5);

  return reaches.length > 0 ? Math.max(...reaches) : 5;
}

export function isWithinReach(attacker: Creature, target: Creature, targetPosition: GridPosition = target.position): boolean {
  return getDistanceFeet(attacker.position, targetPosition) <= getMeleeReach(attacker);
}

export function getHostileCreaturesWithinReach(state: CombatState, creature: Creature): Creature[] {
  return state.creatures.filter(
    (candidate) =>
      candidate.id !== creature.id &&
      candidate.team !== creature.team &&
      !hasCondition(candidate, 'incapacitated') &&
      !hasCondition(candidate, 'stunned') &&
      !hasCondition(candidate, 'unconscious') &&
      !hasCondition(candidate, 'defeated') &&
      candidate.hp > 0 &&
      isWithinReach(candidate, creature)
  );
}

export function wouldLeaveReach(
  mover: Creature,
  fromPosition: GridPosition,
  toPosition: GridPosition,
  enemy: Creature
): boolean {
  const reach = getMeleeReach(enemy);
  return getDistanceFeet(enemy.position, fromPosition) <= reach && getDistanceFeet(enemy.position, toPosition) > reach;
}

export function getOpportunityAttackCandidates(
  state: CombatState,
  mover: Creature,
  fromPosition: GridPosition,
  toPosition: GridPosition
): Creature[] {
  return state.creatures.filter(
    (enemy) =>
      enemy.id !== mover.id &&
      enemy.team !== mover.team &&
      enemy.hp > 0 &&
      !hasCondition(enemy, 'defeated') &&
      !hasCondition(enemy, 'incapacitated') &&
      !hasCondition(enemy, 'stunned') &&
      !hasCondition(enemy, 'unconscious') &&
      canCreatureTakeReaction(state, enemy) &&
      !state.turnResources[enemy.id]?.reactionUsed &&
      wouldLeaveReach(mover, fromPosition, toPosition, enemy)
  );
}

export function hasLineOfSight(state: CombatState, from: GridPosition, to: GridPosition): boolean {
  return getLineSquares(from, to)
    .filter((position) => !samePosition(position, from) && !samePosition(position, to))
    .every((position) => !isBlocked(position, state.grid));
}

export function getLineSquares(from: GridPosition, to: GridPosition): GridPosition[] {
  const points: GridPosition[] = [];
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let error = dx - dy;
  let x = from.x;
  let y = from.y;

  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) {
      break;
    }

    const doubledError = error * 2;
    if (doubledError > -dy) {
      error -= dy;
      x += sx;
    }

    if (doubledError < dx) {
      error += dx;
      y += sy;
    }
  }

  return points;
}
