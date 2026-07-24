import type { ActionDefinition, ActionTargetMode, CombatState, Creature, GridPosition } from './types';
import { canCreatureTakeReaction, hasCondition } from './conditions';
import { getElevation, getTileHeight, isBlocked, position3DKey, samePosition, type GridLookup } from './shapes';
import { areHostile } from './teams';
import { measurePerformance } from '../performance/profiling';
import { isCombatQueryContextCurrent, type CombatQueryContext } from './queryContext';

export function getDistanceInSquares(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(getElevation(a) - getElevation(b)));
}

export function getDistanceFeet(a: GridPosition, b: GridPosition): number {
  return getDistanceInSquares(a, b) * 5;
}

export const getDistanceInFeet = getDistanceFeet;

export function getActionTargetMode(action: ActionDefinition): ActionTargetMode {
  if (action.targetMode) {
    return action.targetMode;
  }

  if (action.shape?.type === 'line' || action.shape?.type === 'cone') {
    return 'self';
  }

  if ((action.type ?? action.kind) === 'savingThrowEffect' && action.shape?.type === 'radius') {
    return 'point';
  }

  return 'creature';
}

export function isInActionRange(action: ActionDefinition, attacker: GridPosition, target: GridPosition): boolean {
  const distance = getDistanceFeet(attacker, target);

  if (action.type === 'meleeAttack' || action.kind === 'meleeAttack' || action.tags.includes('melee')) {
    return distance <= (action.reach ?? Math.min(getNormalRangeFeet(action), 5));
  }

  return distance <= getMaximumRangeFeet(action);
}

export function isBeyondNormalRange(action: ActionDefinition, attacker: GridPosition, target: GridPosition): boolean {
  if (action.type === 'meleeAttack' || action.kind === 'meleeAttack' || action.tags.includes('melee')) {
    return false;
  }

  return getDistanceFeet(attacker, target) > getNormalRangeFeet(action);
}

export function getNormalRangeFeet(action: ActionDefinition): number {
  return action.normalRange && action.normalRange > 0 ? action.normalRange : action.range * 5;
}

export function getMaximumRangeFeet(action: ActionDefinition): number {
  return action.longRange && action.longRange > 0 ? action.longRange : getNormalRangeFeet(action);
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

export function getHostileCreaturesWithinReach(
  state: CombatState,
  creature: Creature,
  query?: CombatQueryContext
): Creature[] {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  return state.creatures.filter(
    (candidate) =>
      candidate.id !== creature.id &&
      areHostile(candidate, creature, state, context?.teams) &&
      !hasCondition(candidate, 'incapacitated', context?.conditions) &&
      !hasCondition(candidate, 'stunned', context?.conditions) &&
      !hasCondition(candidate, 'unconscious', context?.conditions) &&
      !hasCondition(candidate, 'defeated', context?.conditions) &&
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
  toPosition: GridPosition,
  query?: CombatQueryContext
): Creature[] {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  return state.creatures.filter(
    (enemy) =>
      enemy.id !== mover.id &&
      areHostile(enemy, mover, state, context?.teams) &&
      enemy.hp > 0 &&
      !hasCondition(enemy, 'defeated', context?.conditions) &&
      !hasCondition(enemy, 'incapacitated', context?.conditions) &&
      !hasCondition(enemy, 'stunned', context?.conditions) &&
      !hasCondition(enemy, 'unconscious', context?.conditions) &&
      canCreatureTakeReaction(state, enemy, context?.conditions) &&
      !state.turnResources[enemy.id]?.reactionUsed &&
      wouldLeaveReach(mover, fromPosition, toPosition, enemy)
  );
}

export function hasLineOfSight(
  state: CombatState,
  from: GridPosition,
  to: GridPosition,
  query?: CombatQueryContext
): boolean {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  const cacheKey = `${position3DKey(from)}>${position3DKey(to)}`;
  const cached = context?.lineOfSight.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const visible = measurePerformance(
    'engine.targeting.line-of-sight',
    () =>
      getLineSquares(from, to)
        .filter((position) => !samePosition(position, from) && !samePosition(position, to))
        .every((position) => !isBlocked(position, state.grid, context?.grid) && !isLineBelowTileTop(state, position, context?.grid))
  );
  context?.lineOfSight.set(cacheKey, visible);
  return visible;
}

export function getLineSquares(from: GridPosition, to: GridPosition): GridPosition[] {
  const points: GridPosition[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = getElevation(to) - getElevation(from);
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));

  if (steps === 0) {
    return [{ ...from, z: getElevation(from) }];
  }

  const seen = new Set<string>();
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const point = {
      x: Math.round(from.x + dx * ratio),
      y: Math.round(from.y + dy * ratio),
      z: Math.round(getElevation(from) + dz * ratio)
    };
    const key = `${point.x},${point.y},${point.z}`;
    if (!seen.has(key)) {
      points.push(point);
      seen.add(key);
    }
  }

  return points;
}

function isLineBelowTileTop(state: CombatState, position: GridPosition, lookup?: GridLookup): boolean {
  return getTileHeight(position, state.grid, lookup) > getElevation(position);
}
