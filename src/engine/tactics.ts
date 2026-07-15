import { canCreatureTakeAction, canCreatureTakeReaction, hasCondition } from './conditions';
import { getAvailableActions, getUnavailableActionReason } from './features';
import { getActionShapeSquares, getOpportunityAttackCandidatesForMovementPath } from './combat';
import { getReachableMovementSquares, type MovementOption } from './movement';
import { getTilePosition, samePosition } from './shapes';
import { getDistanceFeet, getMeleeReach, hasLineOfSight, isInActionRange } from './targeting';
import type { ActionDefinition, CardinalDirection, CombatState, Creature, GridPosition } from './types';

const CARDINAL_DIRECTIONS: CardinalDirection[] = ['north', 'east', 'south', 'west'];

export interface ThreatQueryOptions {
  requireReaction?: boolean;
}

export interface MovementSafetyAssessment {
  option: MovementOption;
  opportunityAttackers: Creature[];
  destinationThreats: Creature[];
  isSafe: boolean;
}

export interface SafeMovementOptions {
  avoidOpportunityAttacks?: boolean;
  avoidThreatenedDestinations?: boolean;
  maxOptions?: number;
}

export interface TargetQueryOptions {
  includeAllies?: boolean;
  includeDefeated?: boolean;
  requireAvailableAction?: boolean;
  requireLineOfSight?: boolean;
}

export type TacticalActionCategory = 'attack' | 'savingThrow' | 'multiattack' | 'utility';

export interface AreaTargetOption {
  origin: GridPosition;
  direction?: CardinalDirection;
  targets: Creature[];
}

export interface TacticalActionOption {
  action: ActionDefinition;
  category: TacticalActionCategory;
  unavailableReason?: string;
  targetableCreatures: Creature[];
  targetablePositions: GridPosition[];
  areaOptions: AreaTargetOption[];
  isUsable: boolean;
  hasTargets: boolean;
}

export interface TacticalActionQueryOptions extends TargetQueryOptions {
  includeUnavailable?: boolean;
  includeEmptyTargets?: boolean;
}

export function getThreateningCreatures(
  state: CombatState,
  creature: Creature,
  position: GridPosition = creature.position,
  options: ThreatQueryOptions = {}
): Creature[] {
  const normalizedPosition = getTilePosition(position, state.grid);

  return state.creatures.filter(
    (candidate) =>
      candidate.id !== creature.id &&
      candidate.team !== creature.team &&
      canThreatenPosition(state, candidate, normalizedPosition, options)
  );
}

export function isPositionThreatened(
  state: CombatState,
  creature: Creature,
  position: GridPosition = creature.position,
  options: ThreatQueryOptions = {}
): boolean {
  return getThreateningCreatures(state, creature, position, options).length > 0;
}

export function getMovementSafetyAssessments(state: CombatState, creatureId: string): MovementSafetyAssessment[] {
  const creature = findCreatureForTactics(state, creatureId);

  return getReachableMovementSquares(state, creatureId).map((option) => scoreMovementOptionSafety(state, creature, option));
}

export function scoreMovementOptionSafety(
  state: CombatState,
  creature: Creature,
  option: MovementOption
): MovementSafetyAssessment {
  const opportunityAttackers = getOpportunityAttackCandidatesForMovementPath(state, creature, option.path).map(
    (candidate) => candidate.creature
  );
  const destinationThreats = getThreateningCreatures(state, creature, option.position);

  return {
    option,
    opportunityAttackers,
    destinationThreats,
    isSafe: opportunityAttackers.length === 0 && destinationThreats.length === 0
  };
}

export function getSafeMovementOptions(
  state: CombatState,
  creatureId: string,
  options: SafeMovementOptions = {}
): MovementOption[] {
  const avoidOpportunityAttacks = options.avoidOpportunityAttacks ?? true;
  const avoidThreatenedDestinations = options.avoidThreatenedDestinations ?? true;
  const safeOptions = getMovementSafetyAssessments(state, creatureId)
    .filter(
      (assessment) =>
        (!avoidOpportunityAttacks || assessment.opportunityAttackers.length === 0) &&
        (!avoidThreatenedDestinations || assessment.destinationThreats.length === 0)
    )
    .map((assessment) => assessment.option);

  return options.maxOptions === undefined ? safeOptions : safeOptions.slice(0, Math.max(0, options.maxOptions));
}

export function getTargetableCreaturesForAction(
  state: CombatState,
  attacker: Creature,
  action: ActionDefinition,
  options: TargetQueryOptions = {}
): Creature[] {
  if ((options.requireAvailableAction ?? true) && getUnavailableActionReason(attacker, action)) {
    return [];
  }

  return state.creatures.filter((target) => {
    if (target.id === attacker.id || (!options.includeAllies && target.team === attacker.team)) {
      return false;
    }

    if (!options.includeDefeated && isDefeatedForTactics(target)) {
      return false;
    }

    if (!isInActionRange(action, attacker.position, target.position)) {
      return false;
    }

    if (!canTargetHarmfulEffect(attacker, target)) {
      return false;
    }

    return shouldRequireLineOfSight(action, options) ? hasLineOfSight(state, attacker.position, target.position) : true;
  });
}

export function getTargetablePositionsForAction(
  state: CombatState,
  attacker: Creature,
  action: ActionDefinition,
  options: TargetQueryOptions = {}
): GridPosition[] {
  if ((options.requireAvailableAction ?? true) && getUnavailableActionReason(attacker, action)) {
    return [];
  }

  const positions: GridPosition[] = [];
  for (let y = 0; y < state.grid.height; y += 1) {
    for (let x = 0; x < state.grid.width; x += 1) {
      const position = getTilePosition({ x, y }, state.grid);
      if (!isInActionRange(action, attacker.position, position)) {
        continue;
      }

      if (shouldRequireLineOfSight(action, options) && !hasLineOfSight(state, attacker.position, position)) {
        continue;
      }

      positions.push(position);
    }
  }

  return positions;
}

export function getAreaTargetOptionsForAction(
  state: CombatState,
  source: Creature,
  action: ActionDefinition,
  options: TargetQueryOptions = {}
): AreaTargetOption[] {
  if ((options.requireAvailableAction ?? true) && getTacticalActionUnavailableReason(state, source, action)) {
    return [];
  }

  const origins = getAreaOriginsForAction(state, source, action, options);
  const directions = action.shape?.type === 'line' || action.shape?.type === 'cone'
    ? CARDINAL_DIRECTIONS
    : [action.shape?.direction] as Array<CardinalDirection | undefined>;

  return origins.flatMap((origin) =>
    directions
      .map((direction) => ({
        origin,
        direction,
        targets: getCreaturesInActionArea(state, source, action, origin, direction, options)
      }))
      .filter((areaOption) => areaOption.targets.length > 0)
  );
}

export function getTacticalActionOptions(
  state: CombatState,
  creatureId: string,
  options: TacticalActionQueryOptions = {}
): TacticalActionOption[] {
  const creature = findCreatureForTactics(state, creatureId);

  return getAvailableActions(creature, state)
    .map((action) => {
      const category = getTacticalActionCategory(action);
      const unavailableReason = getTacticalActionUnavailableReason(state, creature, action);
      const targetOptions = { ...options, requireAvailableAction: false };
      const targetableCreatures =
        category === 'attack' ? getTargetableCreaturesForAction(state, creature, action, targetOptions) : [];
      const targetablePositions =
        category === 'attack' || category === 'savingThrow' ? getTargetablePositionsForAction(state, creature, action, targetOptions) : [];
      const areaOptions =
        category === 'savingThrow' ? getAreaTargetOptionsForAction(state, creature, action, targetOptions) : [];
      const hasTargets = category === 'attack'
        ? targetableCreatures.length > 0
        : category === 'savingThrow'
          ? areaOptions.length > 0
          : true;

      return {
        action,
        category,
        unavailableReason,
        targetableCreatures,
        targetablePositions,
        areaOptions,
        isUsable: unavailableReason === undefined && hasTargets,
        hasTargets
      };
    })
    .filter((option) => (options.includeUnavailable ?? true) || option.unavailableReason === undefined)
    .filter((option) => (options.includeEmptyTargets ?? true) || option.hasTargets);
}

export function getTacticalActionUnavailableReason(
  state: CombatState,
  creature: Creature,
  action: ActionDefinition
): string | undefined {
  const resourceReason = getUnavailableActionReason(creature, action);
  if (resourceReason) {
    return resourceReason;
  }

  const turnResource = state.turnResources[creature.id];
  if (action.actionCost === 'free') {
    return undefined;
  }

  if (action.actionCost === 'reaction') {
    if (turnResource?.reactionUsed) {
      return `${creature.name} has already used their reaction.`;
    }

    return canCreatureTakeReaction(state, creature) ? undefined : `${creature.name} cannot take reactions because of a condition.`;
  }

  if (!canCreatureTakeAction(state, creature)) {
    return `${creature.name} cannot take actions because of a condition.`;
  }

  if (action.actionCost === 'bonusAction') {
    return turnResource?.bonusActionUsed ? `${creature.name} has already used their bonus action.` : undefined;
  }

  return turnResource?.actionUsed ? `${creature.name} has already used their action this turn.` : undefined;
}

function canThreatenPosition(
  state: CombatState,
  candidate: Creature,
  position: GridPosition,
  options: ThreatQueryOptions
): boolean {
  if (isDefeatedForTactics(candidate) || hasCondition(candidate, 'incapacitated') || hasCondition(candidate, 'stunned') || hasCondition(candidate, 'unconscious')) {
    return false;
  }

  if (
    options.requireReaction &&
    (!canCreatureTakeReaction(state, candidate) || state.turnResources[candidate.id]?.reactionUsed)
  ) {
    return false;
  }

  return getDistanceFeet(candidate.position, position) <= getMeleeReach(candidate);
}

function shouldRequireLineOfSight(action: ActionDefinition, options: TargetQueryOptions): boolean {
  return (
    options.requireLineOfSight ??
    (action.kind === 'rangedAttack' || action.kind === 'spell' || action.tags.includes('ranged') || action.tags.includes('spell'))
  );
}

function getAreaOriginsForAction(
  state: CombatState,
  source: Creature,
  action: ActionDefinition,
  options: TargetQueryOptions
): GridPosition[] {
  if (action.shape?.type === 'line' || action.shape?.type === 'cone') {
    return [getTilePosition(source.position, state.grid)];
  }

  return getTargetablePositionsForAction(state, source, action, { ...options, requireAvailableAction: false });
}

function getCreaturesInActionArea(
  state: CombatState,
  source: Creature,
  action: ActionDefinition,
  origin: GridPosition,
  direction: CardinalDirection | undefined,
  options: TargetQueryOptions
): Creature[] {
  const affectedSquares = getActionShapeSquares(state, action, origin, direction);

  return state.creatures.filter((target) => {
    if (target.id === source.id || (!options.includeAllies && target.team === source.team)) {
      return false;
    }

    if (!options.includeDefeated && isDefeatedForTactics(target)) {
      return false;
    }

    if (!canTargetHarmfulEffect(source, target)) {
      return false;
    }

    return affectedSquares.some((position) => samePosition(position, getTilePosition(target.position, state.grid)));
  });
}

function getTacticalActionCategory(action: ActionDefinition): TacticalActionCategory {
  const rulesKind = action.type ?? action.kind;
  if (rulesKind === 'meleeAttack' || rulesKind === 'rangedAttack' || action.tags.includes('attack')) {
    return 'attack';
  }

  if (rulesKind === 'savingThrowEffect') {
    return 'savingThrow';
  }

  return action.kind === 'multiattack' ? 'multiattack' : 'utility';
}

function canTargetHarmfulEffect(source: Creature, target: Creature): boolean {
  return !source.conditions.some((condition) => condition.id === 'charmed' && condition.sourceCreatureId === target.id);
}

function findCreatureForTactics(state: CombatState, creatureId: string): Creature {
  const creature = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!creature) {
    throw new Error(`Creature not found: ${creatureId}`);
  }

  return creature;
}

function isDefeatedForTactics(creature: Creature): boolean {
  return creature.hp <= 0 || hasCondition(creature, 'defeated');
}
