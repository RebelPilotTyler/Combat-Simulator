import { abilityModifier, rollDamageDice, rollDice, type RandomSource } from './dice';
import { getActionDamageType } from './damage';
import { areAllies, areHostile, normalizeTeamDefinitions, normalizeTeamId } from './teams';
import type {
  ActionDefinition,
  CardinalDirection,
  CombatHooks,
  CombatLogEntry,
  CombatState,
  Creature,
  EffectDefinition,
  GridPosition,
  AppliedCondition,
  ConditionDurationType,
  StackBehavior,
  Ability,
  Skill,
  RollMode,
  RollModifier,
  MultiattackStep,
  CombatRulesSettings,
  BotProfile,
  BotResourceStrategy,
  BotTargetPriority,
  TeamDefinition,
  PendingReaction
} from './types';
import { getElevation, getShapeSquares, getTilePosition, isBlocked, isInBounds, position3DKey, samePosition } from './shapes';
import { getMovementOption, getMovementOptionForPath, getReachableMovementSquares, isOccupied, type MovementOption } from './movement';
import { clampGridPosition, normalizeGridDefinition } from './grid';
import {
  applyConditionToCreature,
  applyBeforeDamageModifiers,
  canCreatureMove,
  canCreatureTakeAction,
  canCreatureTakeReaction,
  collectAbilityCheckModifiers,
  collectAttackRollModifiers,
  collectSavingThrowModifiers,
  createAppliedCondition,
  expireConditionsForTurn,
  getConditionDefinition,
  getConditionLabel,
  hasCondition,
  mergeRollModifiers,
  normalizeConditions,
  removeConditionFromCreature,
  resolveRollMode,
  runConditionTurnHooks,
  runAfterDamageHooks,
  tickRoundDurations
} from './conditions';
import {
  getDistanceFeet,
  getHostileCreaturesWithinReach,
  getOpportunityAttackCandidates,
  hasLineOfSight,
  isBeyondNormalRange,
  isInActionRange
} from './targeting';
import {
  consumeActionResources,
  getAvailableActions,
  getEffectiveAC,
  getEffectiveAttackBonus,
  getEffectiveMovementSpeed,
  getEffectiveSaveDc,
  getEffectiveSaveBonus,
  getEffectiveSpeed,
  getFeatureStatModifiers,
  getUnavailableActionReason,
  hasResourcesForAction,
  resetResources,
  type ResourceConsumption
} from './features';
import {
  applyBeforeDamageRules,
  collectBeforeAttackRollRuleModifiers,
  collectBeforeSavingThrowRuleModifiers,
  runActionUsedRules,
  runAfterAttackRollRules,
  runAfterDamageRules,
  runAfterSavingThrowRules,
  runConditionAppliedRules,
  runDefeatedRules,
  runTurnRules
} from './rules';
import { enqueueVisualEvent, pruneVisualEvents } from './visualEvents';
import { incrementPerformanceCounter, measurePerformance } from '../performance/profiling';
import { createCombatQueryContext, isCombatQueryContextCurrent, type CombatQueryContext } from './queryContext';
import { cloneJsonValue } from './jsonClone';

export const BASIC_ACTIONS = [
  'Attack',
  'Cast a Spell',
  'Dash',
  'Disengage',
  'Dodge',
  'Help',
  'Hide',
  'Ready',
  'Search',
  'Use an Object',
  'Grapple',
  'Shove',
  'Improvised Action'
] as const;

export type BasicActionName = (typeof BASIC_ACTIONS)[number];

export type HelpMode = 'ally' | 'enemy';

export type ShoveOutcome = 'prone' | 'push';

export type SearchMode = 'perception' | 'investigation';

export interface MultiattackTargetSelections {
  targetId?: string;
  stepTargets?: Record<string, string>;
}

export interface OpportunityAttackPathCandidate {
  creature: Creature;
  from: GridPosition;
  to: GridPosition;
}

export interface OpportunityAttackPathLookup {
  state: CombatState;
  moverId: string;
  candidatesBySegment: Map<string, Creature[]>;
}

export interface AttackDebugStats {
  trials: number;
  hits: number;
  misses: number;
  crits: number;
  hitPercentage: number;
  expectedHitPercentage: number;
  rollMode: RollMode;
  attackBonus: number;
  targetAc: number;
}

export interface BotTurnPreview {
  canRun: boolean;
  botId?: string;
  botName?: string;
  profile?: BotProfile;
  targetPriority?: BotTargetPriority;
  resourceStrategy?: BotResourceStrategy;
  order?: BotTurnOrder;
  summary: string;
  movement?: {
    from: GridPosition;
    to: GridPosition;
    costFeet: number;
    steps: number;
  };
  action?: {
    actionId: string;
    actionName: string;
    targetIds: string[];
    targetNames: string[];
    score: number;
    scoreDetails: BotActionScoreDetails;
  };
  bonusAction?: {
    actionId: string;
    actionName: string;
    targetIds: string[];
    targetNames: string[];
    score: number;
  };
  willDodgeOrWait: boolean;
  notes: string[];
}

export interface BotActionScoreDetails {
  total: number;
  expectedDamage: number;
  hitChance?: number;
  critChance?: number;
  saveFailureChance?: number;
  enemyTargets: number;
  allyTargets: number;
  profileBonus: number;
  targetPriorityBonus: number;
  memoryBonus: number;
  positioningAdjustment: number;
  resourcePenalty: number;
  friendlyFirePenalty: number;
  notes: string[];
}

export const DEFAULT_RULES_SETTINGS: CombatRulesSettings = {
  flanking: { enabled: false, benefit: 'advantage' }
};

const normalizedCombatStates = new WeakSet<CombatState>();

export function createCombatState(
  creatures: Creature[],
  width = 10,
  height = 10,
  blocked: GridPosition[] = [],
  heights: GridPosition[] = [],
  teams?: TeamDefinition[]
): CombatState {
  const grid = normalizeGridDefinition({ width, height, blocked, heights });
  const normalizedCreatures = normalizeCreatures(creatures, grid);
  return {
    creatures: normalizedCreatures,
    teams: normalizeTeamDefinitions(teams, normalizedCreatures),
    grid,
    initiative: [],
    round: 0,
    turnIndex: 0,
    activeCreatureId: undefined,
    turnState: createTurnState(undefined),
    turnResources: Object.fromEntries(normalizedCreatures.map((creature) => [creature.id, createTurnState(creature)])),
    pendingReactions: [],
    rulesSettings: cloneJson(DEFAULT_RULES_SETTINGS),
    ruleMemory: {},
    botMemory: {},
    log: []
  };
}

export function setFlankingEnabled(state: CombatState, enabled: boolean): CombatState {
  const next = normalizeState(cloneState(state));
  next.rulesSettings = {
    ...next.rulesSettings,
    flanking: {
      enabled,
      benefit: next.rulesSettings?.flanking?.benefit ?? 'advantage'
    }
  };
  addLog(next, 'system', `Flanking ${enabled ? 'enabled' : 'disabled'}.`);
  return next;
}

export function rollInitiative(state: CombatState, random: RandomSource = Math.random): CombatState {
  const next = normalizeState(cloneState(state));
  const initiative = next.creatures
    .filter((creature) => !isDefeated(creature))
    .map((creature) => {
    const modifier = abilityModifier(creature.abilityScores.dex);
      const roll = rollDice('1d20', random).total;
      return {
        creatureId: creature.id,
        roll,
        modifier,
        total: roll + modifier
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }

      const creatureA = findCreature(next, a.creatureId);
      const creatureB = findCreature(next, b.creatureId);
      return abilityModifier(creatureB.abilityScores.dex) - abilityModifier(creatureA.abilityScores.dex);
    });

  next.initiative = initiative;
  next.round = initiative.length > 0 ? 1 : 0;
  next.turnIndex = 0;
  next.activeCreatureId = initiative[0]?.creatureId;
  next.turnResources = Object.fromEntries(next.creatures.map((creature) => [creature.id, createTurnState(creature, next)]));
  next.turnState = next.activeCreatureId ? next.turnResources[next.activeCreatureId] : createTurnState(undefined, next);
  next.pendingReactions = [];

  initiative.forEach((entry) => {
    const creature = findCreature(next, entry.creatureId);
    addLog(
      next,
      'initiative',
      `${creature.name} rolls initiative: d20 ${entry.roll} + ${entry.modifier} = ${entry.total}.`
    );
  });

  if (next.activeCreatureId) {
    addLog(next, 'turn', `Round ${next.round} begins. ${findCreature(next, next.activeCreatureId).name} is active.`);
  }

  return next;
}

export function endTurn(state: CombatState, hooks: CombatHooks = {}): CombatState {
  const next = normalizeState(cloneState(state));
  if (next.initiative.length === 0 || !next.activeCreatureId) {
    addLog(next, 'system', 'No initiative order exists. Roll initiative first.');
    return next;
  }

  const endingCreature = findCreature(next, next.activeCreatureId);
  runConditionTurnHooks(next, endingCreature, 'end');
  runTurnRules(next, endingCreature, 'onTurnEnd');
  if (hooks.onTurnEnd) {
    normalizedCombatStates.delete(next);
    hooks.onTurnEnd(next, endingCreature);
  }
  logExpiredConditions(next, expireConditionsForTurn(next, endingCreature, 'end'));
  addLog(next, 'turn', `${endingCreature.name} ends their turn.`);

  const nextIndex = findNextLivingInitiativeIndex(next);
  if (nextIndex === -1) {
    next.activeCreatureId = undefined;
    addLog(next, 'system', 'Combat has no creatures able to act.');
    return next;
  }

  if (nextIndex <= next.turnIndex) {
    next.round += 1;
    logExpiredConditions(next, tickRoundDurations(next));
  }

  next.turnIndex = nextIndex;
  next.activeCreatureId = next.initiative[next.turnIndex].creatureId;

  const activeCreature = findCreature(next, next.activeCreatureId);
  resetResources(activeCreature, 'turnStart');
  logExpiredConditions(next, expireConditionsForTurn(next, activeCreature, 'start'));
  next.turnResources[activeCreature.id] = createTurnState(activeCreature, next);
  next.turnState = next.turnResources[activeCreature.id];
  runConditionTurnHooks(next, activeCreature, 'start');
  runTurnRules(next, activeCreature, 'onTurnStart');
  if (hooks.onTurnStart) {
    normalizedCombatStates.delete(next);
    hooks.onTurnStart(next, activeCreature);
  }
  addLog(next, 'turn', `Round ${next.round}: ${activeCreature.name} starts their turn.`);

  return next;
}

export function moveActiveCreature(state: CombatState, movement: GridPosition | GridPosition[]): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!canCreatureMove(next, creature)) {
    addLog(next, 'system', `${creature.name} cannot move because of a condition.`);
    return next;
  }

  const movementOption = Array.isArray(movement)
    ? getMovementOptionForPath(next, creature.id, movement)
    : getMovementOption(next, creature.id, movement);
  const destinationPosition = movementOption?.position ?? getTilePosition(Array.isArray(movement) ? movement[movement.length - 1] ?? creature.position : movement, next.grid);

  if (!movementOption) {
    addLog(next, 'system', `${creature.name} cannot move to ${formatPosition(destinationPosition)}.`);
    return next;
  }

  const from = { ...creature.position };
  const opportunityCandidates = getOpportunityAttackCandidatesForMovementPath(next, creature, movementOption.path);
  creature.position = destinationPosition;
  const resource = getResource(next, creature.id);
  resource.remainingMovement -= movementOption.costFeet;
  resource.movementRemaining = resource.remainingMovement;
  syncActiveTurnState(next);
  addLog(
    next,
    'movement',
    `${creature.name} moves from ${formatPosition(from)} to ${formatPosition(destinationPosition)} for ${movementOption.costFeet} feet. ${next.turnState.remainingMovement} feet remain.`
  );
  enqueueVisualEvent(next, {
    kind: 'movementComplete',
    creatureId: creature.id,
    from,
    to: destinationPosition,
    path: movementOption.path,
    label: `${movementOption.costFeet} ft`
  });
  opportunityCandidates.forEach((candidate) => {
    const action = findOpportunityAttackAction(candidate.creature);
    if (!action) {
      return;
    }

    const pending = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      trigger: 'opportunityAttack' as const,
      reactorId: candidate.creature.id,
      targetId: creature.id,
      actionId: action.id,
      from: candidate.from,
      to: candidate.to,
      description: `${candidate.creature.name} can make an opportunity attack against ${creature.name}.`
    };
    next.pendingReactions.push(pending);
    addLog(next, 'action', `Opportunity attack triggered: ${pending.description}`);
    enqueueVisualEvent(next, {
      kind: 'opportunityAttackTriggered',
      creatureId: creature.id,
      sourceCreatureId: candidate.creature.id,
      from: candidate.from,
      to: candidate.to,
      label: 'OA'
    });
  });

  return next;
}

export function performBasicAction(state: CombatState, actionName: BasicActionName): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);

  if (actionName === 'Attack') {
    addLog(next, 'system', 'Choose one of the creature attack actions below, then choose a target.');
    return next;
  }

  if (actionName === 'Disengage') {
    return performDisengageAction(next);
  }

  if (actionName === 'Dash') {
    if (!spendActionCost(next, creature, 'action')) {
      return next;
    }
    const resource = getResource(next, creature.id);
    resource.remainingMovement += getEffectiveSpeed(creature, next);
    resource.movementRemaining = resource.remainingMovement;
    syncActiveTurnState(next);
    addLog(
      next,
      'action',
      `${creature.name} takes the Dash action and gains ${getEffectiveSpeed(creature, next)} feet of movement. ${next.turnState.remainingMovement} feet remain.`
    );
    return next;
  }

  if (actionName === 'Dodge') {
    if (!spendActionCost(next, creature, 'action')) {
      return next;
    }
    const applied = createAppliedCondition('dodging', {
      sourceCreatureId: creature.id,
      durationType: 'untilStartOfTargetTurn'
    });
    const result = applyConditionToCreature(creature, applied);
    addLog(next, 'action', `${creature.name} takes the Dodge action until the start of their next turn.`);
    logConditionChange(next, creature, applied, result);
    return next;
  }

  if (!spendActionCost(next, creature, 'action')) {
    return next;
  }
  addLog(next, 'action', `${creature.name} takes ${actionName}. Placeholder action: no extra rules are implemented yet.`);
  return next;
}

export function performDisengageAction(state: CombatState): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!spendAction(next, creature)) {
    return next;
  }

  const condition = createAppliedCondition('disengaged', {
    sourceCreatureId: creature.id,
    durationType: 'untilEndOfTargetTurn'
  });
  const result = applyConditionToCreature(creature, condition);
  addLog(next, 'action', `${creature.name} disengages until the end of their turn.`);
  logConditionChange(next, creature, condition, result);
  return next;
}

export function performHelpAction(state: CombatState, targetId: string, mode: HelpMode): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const helper = getActiveCreature(next);
  const target = findCreature(next, targetId);
  if (!spendAction(next, helper)) {
    return next;
  }

  const condition = createAppliedCondition(mode === 'ally' ? 'helped' : 'helpedTarget', {
    sourceCreatureId: helper.id,
    durationType: 'untilStartOfSourceTurn',
    metadata: { mode }
  });
  const result = applyConditionToCreature(target, condition);
  addLog(
    next,
    'action',
    mode === 'ally'
      ? `${helper.name} helps ${target.name}. ${target.name}'s next attack or ability check has advantage.`
      : `${helper.name} distracts ${target.name}. The next allied attack against ${target.name} has advantage.`
  );
  logConditionChange(next, target, condition, result);
  return next;
}

export function performHideAction(state: CombatState, random: RandomSource = Math.random): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!spendAction(next, creature)) {
    return next;
  }

  const check = rollAbilityCheck(next, creature, 'dex', 'stealth', random);
  const condition = createAppliedCondition('hidden', {
    sourceCreatureId: creature.id,
    metadata: { stealthTotal: check.total }
  });
  const result = applyConditionToCreature(creature, condition);
  addLog(next, 'action', `${creature.name} hides: Stealth ${check.rollText} = ${check.total}.`);
  logConditionChange(next, creature, condition, result);
  consumeHelpedAbilityCheck(next, creature);
  return next;
}

export function performReadyAction(state: CombatState, actionId: string, trigger: string): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!spendAction(next, creature)) {
    return next;
  }

  const action = findAction(creature, actionId, next);
  creature.readiedAction = {
    actionId: action.id,
    actionName: action.name,
    trigger: trigger.trim() || 'No trigger specified'
  };
  addLog(next, 'action', `${creature.name} readies ${action.name}. Trigger: ${creature.readiedAction.trigger}.`);
  return next;
}

export function performSearchAction(
  state: CombatState,
  mode: SearchMode,
  random: RandomSource = Math.random
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!spendAction(next, creature)) {
    return next;
  }

  const check =
    mode === 'perception'
      ? rollAbilityCheck(next, creature, 'wis', 'perception', random)
      : rollAbilityCheck(next, creature, 'int', 'investigation', random);
  addLog(next, 'action', `${creature.name} searches with ${mode}: ${check.rollText} = ${check.total}.`);
  consumeHelpedAbilityCheck(next, creature);
  return next;
}

export function performUseObjectAction(state: CombatState, note: string): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!spendAction(next, creature)) {
    return next;
  }

  addLog(next, 'action', `${creature.name} uses an object. ${note.trim() || 'No note provided.'}`);
  return next;
}

export function performImprovisedAction(
  state: CombatState,
  note: string,
  ability?: Ability,
  random: RandomSource = Math.random
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  if (!spendAction(next, creature)) {
    return next;
  }

  if (ability) {
    const check = rollAbilityCheck(next, creature, ability, undefined, random);
    addLog(next, 'action', `${creature.name} improvises: ${note.trim() || 'No note provided.'} ${ability.toUpperCase()} ${check.rollText} = ${check.total}.`);
    consumeHelpedAbilityCheck(next, creature);
    return next;
  }

  addLog(next, 'action', `${creature.name} improvises. ${note.trim() || 'No note provided.'}`);
  return next;
}

export function performCreatureUtilityAction(state: CombatState, actionId: string): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const creature = getActiveCreature(next);
  const action = findAction(creature, actionId, next);
  const featureActionHandled = performFeatureGeneratedBasicAction(next, creature, action);
  if (featureActionHandled) {
    return next;
  }
  if (!spendActionCost(next, creature, action.actionCost)) {
    return next;
  }
  if (!spendActionResources(next, creature, action).ok) {
    rollbackActionCost(next, creature, action.actionCost);
    return next;
  }
  runActionUsedRules(next, creature, action);

  if (action.tags.includes('movement')) {
    const extraMovement = action.normalRange ?? 10;
    const resource = getResource(next, creature.id);
    resource.remainingMovement += extraMovement;
    resource.movementRemaining = resource.remainingMovement;
    syncActiveTurnState(next);
    addLog(next, 'action', `${creature.name} uses ${action.name} and gains ${extraMovement} feet of movement.`);
    return next;
  }

  addLog(next, 'action', `${creature.name} uses ${action.name}. ${action.description ?? 'No extra rules implemented.'}`);
  return next;
}

export function resolvePendingReaction(
  state: CombatState,
  pendingReactionId: string,
  useReaction: boolean,
  random: RandomSource = Math.random
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const pending = next.pendingReactions.find((candidate) => candidate.id === pendingReactionId);
  if (!pending) {
    return next;
  }

  next.pendingReactions = next.pendingReactions.filter((candidate) => candidate.id !== pendingReactionId);

  if (!useReaction) {
    addLog(next, 'action', `Reaction skipped: ${pending.description}`);
    return next;
  }

  const reactor = findCreature(next, pending.reactorId);
  if (getResource(next, reactor.id).reactionUsed || !canCreatureTakeReaction(next, reactor)) {
    addLog(next, 'system', `${reactor.name} cannot use a reaction.`);
    return next;
  }

  const originalActiveId = next.activeCreatureId;
  const action = findAction(reactor, pending.actionId, next);
  const originalCost = action.actionCost;
  action.actionCost = 'free';
  getResource(next, reactor.id).reactionUsed = true;
  syncActiveTurnState(next);
  const target = pending.targetId ? findCreature(next, pending.targetId) : undefined;
  addLog(next, 'action', `${reactor.name} uses a reaction for ${action.name}${target ? ` against ${target.name}` : ''}.`);

  next.activeCreatureId = reactor.id;
  next.turnState = getResource(next, reactor.id);
  const resolved = resolveReactionAction(next, action, pending, random);
  const resolvedAction = findCreature(resolved, reactor.id).actions.find((candidate) => candidate.id === action.id);
  if (resolvedAction) {
    resolvedAction.actionCost = originalCost;
  }
  resolved.activeCreatureId = originalActiveId;
  syncActiveTurnState(resolved);
  return resolved;
}

function resolveReactionAction(
  state: CombatState,
  action: ActionDefinition,
  pending: PendingReaction,
  random: RandomSource
): CombatState {
  const actionKind = getRulesKind(action);

  if (isAttackActionDefinition(action)) {
    if (!pending.targetId) {
      addLog(state, 'system', `${action.name} has no reaction target.`);
      return state;
    }
    return performAttackAction(state, action.id, pending.targetId, random, {}, { targetPositionOverride: pending.from });
  }

  if (actionKind === 'savingThrowEffect') {
    const targetIds = pending.targetId ? [pending.targetId] : [];
    return performSavingThrowAction(state, action.id, targetIds, random, {}, { origin: pending.to ?? pending.from });
  }

  return performCreatureUtilityAction(state, action.id);
}

export function performGrappleAction(
  state: CombatState,
  targetId: string,
  random: RandomSource = Math.random
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const attacker = getActiveCreature(next);
  const target = findCreature(next, targetId);
  if (!spendAction(next, attacker)) {
    return next;
  }

  if (!isWithinMelee(attacker, target)) {
    addLog(next, 'system', `${target.name} is out of melee range for grapple.`);
    next.turnState.actionUsed = false;
    return next;
  }

  const attackCheck = rollAbilityCheck(next, attacker, 'str', 'athletics', random);
  const defenderSkill = getSkillModifier(target, 'athletics', 'str') >= getSkillModifier(target, 'acrobatics', 'dex') ? 'athletics' : 'acrobatics';
  const defenseCheck = rollAbilityCheck(next, target, defenderSkill === 'athletics' ? 'str' : 'dex', defenderSkill, random);

  if (attackCheck.total > defenseCheck.total) {
    const condition = createAppliedCondition('grappled', { sourceCreatureId: attacker.id });
    const result = applyConditionToCreature(target, condition);
    addLog(next, 'action', `${attacker.name} grapples ${target.name}: ${attackCheck.total} vs ${defenseCheck.total}. Success.`);
    logConditionChange(next, target, condition, result);
  } else {
    addLog(next, 'action', `${attacker.name} tries to grapple ${target.name}: ${attackCheck.total} vs ${defenseCheck.total}. Failure.`);
  }

  consumeHelpedAbilityCheck(next, attacker);
  return next;
}

export function performShoveAction(
  state: CombatState,
  targetId: string,
  outcome: ShoveOutcome,
  random: RandomSource = Math.random
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const attacker = getActiveCreature(next);
  const target = findCreature(next, targetId);
  if (!spendAction(next, attacker)) {
    return next;
  }

  if (!isWithinMelee(attacker, target)) {
    addLog(next, 'system', `${target.name} is out of melee range for shove.`);
    next.turnState.actionUsed = false;
    return next;
  }

  const attackCheck = rollAbilityCheck(next, attacker, 'str', 'athletics', random);
  const defenderSkill = getSkillModifier(target, 'athletics', 'str') >= getSkillModifier(target, 'acrobatics', 'dex') ? 'athletics' : 'acrobatics';
  const defenseCheck = rollAbilityCheck(next, target, defenderSkill === 'athletics' ? 'str' : 'dex', defenderSkill, random);

  if (attackCheck.total <= defenseCheck.total) {
    addLog(next, 'action', `${attacker.name} tries to shove ${target.name}: ${attackCheck.total} vs ${defenseCheck.total}. Failure.`);
    consumeHelpedAbilityCheck(next, attacker);
    return next;
  }

  if (outcome === 'prone') {
    const condition = createAppliedCondition('prone', { sourceCreatureId: attacker.id });
    const result = applyConditionToCreature(target, condition);
    addLog(next, 'action', `${attacker.name} shoves ${target.name}: ${attackCheck.total} vs ${defenseCheck.total}. ${target.name} falls prone.`);
    logConditionChange(next, target, condition, result);
    consumeHelpedAbilityCheck(next, attacker);
    return next;
  }

  const destination = getTilePosition(getPushDestination(attacker.position, target.position), next.grid);
  if (isInBounds(destination, next.grid) && !isBlocked(destination, next.grid) && !isOccupied(next, destination, target.id)) {
    target.position = destination;
    addLog(
      next,
      'action',
      `${attacker.name} shoves ${target.name}: ${attackCheck.total} vs ${defenseCheck.total}. ${target.name} is pushed to ${formatPosition(destination)}.`
    );
  } else {
    addLog(next, 'action', `${attacker.name} shoves ${target.name}: ${attackCheck.total} vs ${defenseCheck.total}. Push blocked.`);
  }

  consumeHelpedAbilityCheck(next, attacker);
  return next;
}

export function applyHpChange(
  state: CombatState,
  targetId: string,
  amount: number,
  mode: 'damage' | 'heal'
): CombatState {
  const next = normalizeState(cloneState(state));
  const target = findCreature(next, targetId);
  const delta = Math.max(0, amount);

  if (mode === 'heal') {
    const beforeHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + delta);
    if (target.hp > 0) {
      if (removeConditionFromCreature(target, 'defeated')) {
        emitConditionRemoved(next, target, createAppliedCondition('defeated'));
      }
    }
    addLog(next, 'damage', `${target.name} heals ${delta} HP.`);
    enqueueVisualEvent(next, {
      kind: 'healingReceived',
      creatureId: target.id,
      amount: target.hp - beforeHp,
      label: `+${target.hp - beforeHp}`
    });
    return next;
  }

  const beforeHp = target.hp;
  target.hp = Math.max(0, target.hp - delta);
  addLog(next, 'damage', `${target.name} takes ${delta} manual damage.`);
  enqueueVisualEvent(next, {
    kind: 'damageDealt',
    creatureId: target.id,
    amount: beforeHp - target.hp,
    label: `-${beforeHp - target.hp}`
  });
  if (target.hp === 0 && !hasCondition(target, 'defeated')) {
    applyConditionToCreature(target, createAppliedCondition('defeated'));
    addLog(next, 'defeat', `${target.name} is defeated.`);
    enqueueVisualEvent(next, { kind: 'creatureDefeated', creatureId: target.id, label: 'Defeated' });
    runDefeatedRules(next, target);
  }

  return next;
}

export function performAttackAction(
  state: CombatState,
  actionId: string,
  targetId: string,
  random: RandomSource = Math.random,
  hooks: CombatHooks = {},
  options: { targetPositionOverride?: GridPosition } = {}
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const attacker = getActiveCreature(next);
  const target = findCreature(next, targetId);
  const action = findAction(attacker, actionId, next);
  const actionKind = getRulesKind(action);

  if (!isAttackActionDefinition(action)) {
    throw new Error(`${action.name} is not an attack action.`);
  }

  const targetPosition = options.targetPositionOverride ?? target.position;
  if (!isInActionRange(action, attacker.position, targetPosition)) {
    addLog(next, 'system', `${target.name} is out of range for ${action.name}.`);
    return next;
  }

  if ((actionKind === 'rangedAttack' || action.tags.includes('ranged')) && !hasLineOfSight(next, attacker.position, targetPosition)) {
    addLog(next, 'system', `${attacker.name} does not have line of sight to ${target.name}.`);
    return next;
  }

  if (!canCreatureTargetHarmfulEffect(attacker, target)) {
    addLog(next, 'system', `${attacker.name} cannot attack or harm ${target.name} while charmed by them.`);
    return next;
  }

  if (!usesDeferredActionCost(action)) {
    if (!spendActionCost(next, attacker, action.actionCost)) {
      return next;
    }
    if (!spendActionResources(next, attacker, action).ok) {
      rollbackActionCost(next, attacker, action.actionCost);
      return next;
    }
  } else {
    const actionCostError = getActionCostUnavailableReason(next, attacker, action.actionCost);
    if (actionCostError) {
      addLog(next, 'system', actionCostError);
      return next;
    }
    const resourceResult = spendActionResources(next, attacker, action);
    if (!resourceResult.ok) {
      return next;
    }
    if (shouldSpendDeferredActionCost(resourceResult.consumptions)) {
      spendActionCost(next, attacker, action.actionCost);
    }
  }

  runActionUsedRules(next, attacker, action, [target]);
  resolveAttackAction(next, attacker.id, action, target.id, random, hooks, { targetPositionOverride: options.targetPositionOverride });
  return next;
}

export function performMultiattackAction(
  state: CombatState,
  actionId: string,
  targetSelections: MultiattackTargetSelections,
  random: RandomSource = Math.random,
  hooks: CombatHooks = {}
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const attacker = getActiveCreature(next);
  const multiattack = findAction(attacker, actionId, next);

  if (multiattack.kind !== 'multiattack') {
    throw new Error(`${multiattack.name} is not a multiattack action.`);
  }

  if (!multiattack.multiattack?.steps.length) {
    addLog(next, 'system', `${multiattack.name} has no attack steps.`);
    return next;
  }

  if (!spendActionCost(next, attacker, multiattack.actionCost)) {
    return next;
  }

  if (!spendActionResources(next, attacker, multiattack).ok) {
    rollbackActionCost(next, attacker, multiattack.actionCost);
    return next;
  }

  addLog(next, 'action', `${attacker.name} uses ${multiattack.name}.`);
  runActionUsedRules(
    next,
    attacker,
    multiattack,
    Object.values(targetSelections.stepTargets ?? {})
      .concat(targetSelections.targetId ? [targetSelections.targetId] : [])
      .map((targetId) => findCreature(next, targetId))
  );

  for (const step of multiattack.multiattack.steps) {
    const activeAttacker = findCreature(next, attacker.id);
    if (isDefeated(activeAttacker)) {
      addLog(next, 'system', `${multiattack.name} stops because ${activeAttacker.name} is defeated.`);
      break;
    }

    const stepAction = getMultiattackStepAction(activeAttacker, step, next);
    if (!stepAction) {
      addLog(next, 'system', `${multiattack.name}: ${step.name} has no valid child attack.`);
      if (step.required) {
        continue;
      }
      continue;
    }

    const targetId = getMultiattackStepTarget(multiattack, step, targetSelections);
    if (!targetId) {
      addLog(next, 'system', `${multiattack.name}: ${step.name} has no target selected.`);
      if (step.required) {
        continue;
      }
      continue;
    }

    const target = next.creatures.find((candidate) => candidate.id === targetId);
    if (!target) {
      addLog(next, 'system', `${multiattack.name}: ${step.name} target ${targetId} was not found.`);
      continue;
    }

    if (isDefeated(target)) {
      addLog(next, 'system', `${multiattack.name}: ${step.name} skips ${target.name} because they are defeated.`);
      continue;
    }

    addLog(next, 'action', `${multiattack.name} step: ${step.name}.`);
    resolveAttackAction(next, activeAttacker.id, stepAction, target.id, random, hooks, {
      consumeHitResources: false
    });
  }

  return next;
}

function resolveAttackAction(
  next: CombatState,
  attackerId: string,
  action: ActionDefinition,
  targetId: string,
  random: RandomSource,
  hooks: CombatHooks,
  options: { consumeHitResources?: boolean; targetPositionOverride?: GridPosition } = {}
): void {
  const attacker = findCreature(next, attackerId);
  const target = findCreature(next, targetId);
  const actionKind = getRulesKind(action);

  if (isDefeated(target)) {
    addLog(next, 'system', `${action.name} skips ${target.name} because they are defeated.`);
    return;
  }

  if (!canCreatureTargetHarmfulEffect(attacker, target)) {
    addLog(next, 'system', `${attacker.name} cannot attack or harm ${target.name} while charmed by them.`);
    return;
  }

  const targetPosition = options.targetPositionOverride ?? target.position;
  if (!isInActionRange(action, attacker.position, targetPosition)) {
    addLog(next, 'system', `${target.name} is out of range for ${action.name}.`);
    return;
  }

  if ((actionKind === 'rangedAttack' || action.tags.includes('ranged')) && !hasLineOfSight(next, attacker.position, targetPosition)) {
    addLog(next, 'system', `${attacker.name} does not have line of sight to ${target.name}.`);
    return;
  }

  if (hooks.beforeAttackRoll) {
    normalizedCombatStates.delete(next);
    hooks.beforeAttackRoll(next, { attacker, target, action });
  }
  let attackModifier = collectAttackRollModifiers(
    next,
    attacker,
    target,
    action,
    getDistanceFeet(attacker.position, targetPosition)
  );
  attackModifier = mergeRollModifiers(attackModifier, collectBeforeAttackRollRuleModifiers(next, { attacker, target, action }));
  attackModifier = mergeRollModifiers(attackModifier, getFrightenedRollModifier(next, attacker));
  if (isFlankingAttack(next, attacker, target, action)) {
    attackModifier = mergeRollModifiers(attackModifier, {
      advantage: true,
      notes: ['flanking']
    });
  }
  if ((actionKind === 'rangedAttack' || action.tags.includes('ranged')) && getHostileCreaturesWithinReach(next, attacker).length > 0) {
    attackModifier = mergeRollModifiers(attackModifier, {
      disadvantage: true,
      notes: ['hostile creature within 5 ft']
    });
  }
  if (isBeyondNormalRange(action, attacker.position, targetPosition)) {
    attackModifier = mergeRollModifiers(attackModifier, {
      disadvantage: true,
      notes: ['long range']
    });
  }
  const rollMode = resolveRollMode(attackModifier);
  const firstD20 = rollDice('1d20', random);
  const secondD20 = rollMode === 'normal' ? undefined : rollDice('1d20', random);
  const d20Total = chooseD20(firstD20.total, secondD20?.total, rollMode);
  const naturalRoll = d20Total;
  const attackBonus = getEffectiveAttackBonus(action, attacker, next);
  const flatModifier = attackModifier.flatModifier ?? 0;
  const attackTotal = d20Total + attackBonus + flatModifier;
  const naturalCritical = naturalRoll === 20;
  const naturalMiss = naturalRoll === 1;
  const targetAc = getEffectiveAC(target, next);
  const hit = naturalMiss ? false : naturalCritical ? true : attackModifier.autoFail ? false : attackModifier.autoSuccess ? true : attackTotal >= targetAc;
  const critical = naturalCritical || (hit && isAutomaticMeleeCritical(attacker, target, targetPosition));

  if (hooks.afterAttackRoll) {
    normalizedCombatStates.delete(next);
    hooks.afterAttackRoll(next, { attacker, target, action, attackTotal });
  }
  runAfterAttackRollRules(next, { attacker, target, action, attackTotal, hit, critical });
  rememberAttackTarget(next, attacker.id, target.id);
  addLog(
    next,
    'attack',
    `${attacker.name} ${action.tags.includes('spell') || action.kind === 'spell' ? 'casts' : 'uses'} ${action.name} on ${target.name}: ${formatD20Roll(firstD20.total, secondD20?.total, rollMode)}${formatRollReasons(attackModifier.notes)} + ${attackBonus}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''} = ${attackTotal} vs AC ${targetAc}. ${critical ? 'Critical hit.' : hit ? 'Hit.' : naturalMiss ? 'Natural 1 miss.' : 'Miss.'}`
  );
  if (critical) {
    enqueueVisualEvent(next, { kind: 'criticalHit', creatureId: target.id, sourceCreatureId: attacker.id, label: 'Crit' });
  } else if (hit) {
    enqueueVisualEvent(next, { kind: 'attackHit', creatureId: target.id, sourceCreatureId: attacker.id, label: 'Hit' });
  } else {
    enqueueVisualEvent(next, { kind: 'attackMiss', creatureId: target.id, sourceCreatureId: attacker.id, label: 'Miss' });
  }
  consumeHelpAfterAttack(next, attacker, target);

  if (hit && action.damage) {
    enqueueVisualEvent(next, {
      kind: 'attackImpact',
      creatureId: target.id,
      sourceCreatureId: attacker.id,
      from: attacker.position,
      to: targetPosition,
      color: getVisualColorForAction(action),
      label: critical ? 'Crit' : 'Hit'
    });
    if (options.consumeHitResources ?? true) {
      spendActionResources(next, attacker, action, 'hit');
    }
    const damage = rollDamageDice(action.damage.dice, random, critical);
    const appliedDamage = applyDamage(next, attacker.id, target.id, action, damage.total, hooks, random);
    addLog(
      next,
      'damage',
      `${target.name} takes ${appliedDamage} ${action.damage.type ?? 'damage'}${critical ? ' (critical)' : ''} (${damage.rolls.join(', ')} + ${damage.modifier}).`
    );
  }
}

export function performSavingThrowAction(
  state: CombatState,
  actionId: string,
  targetIds: string[],
  random: RandomSource = Math.random,
  hooks: CombatHooks = {},
  options: { origin?: GridPosition; direction?: CardinalDirection } = {}
): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  const source = getActiveCreature(next);
  const action = findAction(source, actionId, next);
  const actionKind = getRulesKind(action);
  const effect = action.effects.find((candidate) => candidate.type === 'damage' && candidate.save);
  const save = action.save ?? effect?.save;
  const damageDefinition = action.damage ?? effect?.damage;

  if (actionKind !== 'savingThrowEffect' || !save || !damageDefinition) {
    throw new Error(`${action.name} is not a valid saving throw damage action.`);
  }

  const origin = getShapeOriginForAction(next, action, source.position, options.origin);
  if (!isInActionRange(action, source.position, origin)) {
    addLog(next, 'system', `${formatPosition(origin)} is out of range for ${action.name}.`);
    return next;
  }

  if ((action.tags.includes('spell') || action.kind === 'spell') && !hasLineOfSight(next, source.position, origin)) {
    addLog(next, 'system', `${source.name} does not have line of sight to ${formatPosition(origin)} for ${action.name}.`);
    return next;
  }

  const validTargets = getTargetsInActionShape(next, action, source, origin, options.direction)
    .filter((target) => targetIds.includes(target.id) && canCreatureTargetHarmfulEffect(source, target));

  if (validTargets.length === 0) {
    addLog(next, 'system', `${action.name} has no valid targets in its selected area.`);
    return next;
  }

  if (!spendActionCost(next, source, action.actionCost)) {
    return next;
  }
  if (!spendActionResources(next, source, action).ok) {
    rollbackActionCost(next, source, action.actionCost);
    return next;
  }
  runActionUsedRules(
    next,
    source,
    action,
    validTargets
  );
  if (action.tags.includes('spell') || action.kind === 'spell') {
    addLog(next, 'action', `${source.name} casts ${action.name}.`);
  }
  validTargets.forEach((target) => rememberAttackTarget(next, source.id, target.id));

  enqueueVisualEvent(next, {
    kind: 'shapeEffect',
    creatureId: source.id,
    sourceCreatureId: source.id,
    origin,
    direction: options.direction,
    shape: action.shape ?? { type: 'single' },
    targetIds: validTargets.map((target) => target.id),
    color: getVisualColorForAction(action, effect),
    label: action.name
  });
  resolveSavingThrowDamageAction(next, source.id, action, validTargets.map((target) => target.id), random, hooks);

  return next;
}

export function runBotTurn(state: CombatState, random: RandomSource = Math.random): CombatState {
  const prepared = ensureTurnState(normalizeState(cloneState(state)));
  if (!prepared.activeCreatureId) {
    addLog(prepared, 'system', 'No active creature for bot turn.');
    return prepared;
  }

  const bot = getActiveCreature(prepared);
  if (bot.controlMode !== 'bot') {
    addLog(prepared, 'system', `${bot.name} is not bot-controlled.`);
    return prepared;
  }

  let next = runBotTurnMovementStep(prepared);
  next = runBotTurnActionStep(next, random);
  next = runBotTurnBonusActionStep(next, random);
  next = runBotTurnPostMovementStep(next);
  return runBotTurnEndStep(next);
}

export function canRunBotTurn(state: CombatState): boolean {
  if (!state.activeCreatureId) {
    return false;
  }

  return findCreature(state, state.activeCreatureId).controlMode === 'bot';
}

export function getBotTurnPreview(state: CombatState): BotTurnPreview {
  return measurePerformance('engine.bot.preview', () => getBotTurnPreviewInternal(state));
}

function getBotTurnPreviewInternal(state: CombatState): BotTurnPreview {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  if (!next.activeCreatureId) {
    return {
      canRun: false,
      summary: 'No active creature.',
      willDodgeOrWait: false,
      notes: ['Roll initiative or select a valid active turn before running a bot.']
    };
  }

  const bot = getActiveCreature(next);
  if (bot.controlMode !== 'bot') {
    return {
      canRun: false,
      botId: bot.id,
      botName: bot.name,
      profile: bot.botProfile ?? 'passive',
      targetPriority: bot.botTargetPriority ?? 'balanced',
      resourceStrategy: bot.botResourceStrategy ?? 'normal',
      summary: `${bot.name} is manual-controlled.`,
      willDodgeOrWait: false,
      notes: ['Only bot-controlled creatures can produce a bot turn preview.']
    };
  }

  const profile = bot.botProfile ?? 'passive';
  if (profile === 'passive') {
    return {
      canRun: true,
      botId: bot.id,
      botName: bot.name,
      profile,
      targetPriority: bot.botTargetPriority ?? 'balanced',
      resourceStrategy: bot.botResourceStrategy ?? 'normal',
      summary: `${bot.name} will wait.`,
      willDodgeOrWait: true,
      notes: ['Passive/Test Dummy profile takes no actions.']
    };
  }

  const analysis = createBotAnalysisContext(next, bot);
  const plan = chooseBotTurnPlan(next, bot, profile, analysis);
  const movement = plan.preMovement;
  const previewPosition = movement?.position ?? bot.position;
  const actionState = movement ? { ...next, creatures: replaceBotPosition(next, bot.id, previewPosition) } : next;
  const previewBot = movement ? { ...bot, position: previewPosition } : bot;
  const actionAnalysis = movement ? createBotAnalysisContext(actionState, previewBot) : analysis;
  const decision = plan.mainAction && !movement
    ? plan.mainAction
    : chooseBotAction(actionState, previewBot, profile, actionAnalysis);
  const bonusDecision = decision
    ? chooseBotBonusAction(actionState, previewBot, profile, actionAnalysis)
    : undefined;
  const waitLabel = !next.turnState.actionUsed && canCreatureTakeAction(next, bot) ? 'Dodge' : 'wait';
  const summary = decision
    ? plan.order === 'move-then-action' && movement
      ? `${bot.name} plans to move ${movement.costFeet} ft, then use ${decision.action.name} on ${decision.targets.map((target) => target.name).join(', ')}.`
      : plan.order === 'action-then-move'
        ? `${bot.name} plans to use ${decision.action.name} on ${decision.targets.map((target) => target.name).join(', ')}, then reposition.`
        : `${bot.name} plans to use ${decision.action.name} on ${decision.targets.map((target) => target.name).join(', ')}.`
    : `${bot.name} plans to ${waitLabel}.`;

  return {
    canRun: true,
    botId: bot.id,
    botName: bot.name,
    profile,
    targetPriority: bot.botTargetPriority ?? 'balanced',
    resourceStrategy: bot.botResourceStrategy ?? 'normal',
    order: plan.order,
    summary,
    movement: movement
      ? {
          from: bot.position,
          to: movement.position,
          costFeet: movement.costFeet,
          steps: Math.max(0, movement.path.length - 1)
        }
      : undefined,
    action: decision
      ? {
          actionId: decision.action.id,
        actionName: decision.action.name,
        targetIds: decision.targets.map((target) => target.id),
        targetNames: decision.targets.map((target) => target.name),
        score: Math.round(decision.score * 10) / 10,
        scoreDetails: roundBotScoreDetails(decision.scoreDetails)
      }
    : undefined,
    bonusAction: bonusDecision
      ? {
          actionId: bonusDecision.action.id,
          actionName: bonusDecision.action.name,
          targetIds: bonusDecision.targets.map((target) => target.id),
          targetNames: bonusDecision.targets.map((target) => target.name),
          score: Math.round(bonusDecision.score * 10) / 10
        }
      : undefined,
    willDodgeOrWait: !decision,
    notes: getBotPreviewNotes(
      next,
      bot,
      profile,
      movement,
      decision,
      actionState,
      previewBot,
      plan,
      bonusDecision,
      analysis,
      actionAnalysis
    )
  };
}

export function runBotTurnMovementStep(state: CombatState): CombatState {
  let next = ensureTurnState(normalizeState(cloneState(state)));
  if (!next.activeCreatureId) {
    addLog(next, 'system', 'No active creature for bot turn.');
    return next;
  }

  const bot = getActiveCreature(next);
  const profile = bot.botProfile ?? 'passive';
  if (bot.controlMode !== 'bot') {
    addLog(next, 'system', `${bot.name} is not bot-controlled.`);
    return next;
  }

  if (profile === 'passive') {
    return next;
  }

  const analysis = createBotAnalysisContext(next, bot);
  const plan = chooseBotTurnPlan(next, bot, profile, analysis);
  if (plan.preMovement) {
    addLog(next, 'action', `${bot.name} bot plan: ${formatBotTurnOrder(plan.order)}. ${plan.reason}`);
    addLog(next, 'action', `${bot.name} bot moves toward a better ${formatBotProfile(profile)} position.`);
    next = moveActiveCreature(next, plan.preMovement.path);
  }

  return next;
}

export function runBotTurnActionStep(state: CombatState, random: RandomSource = Math.random): CombatState {
  let next = ensureTurnState(normalizeState(cloneState(state)));
  if (!next.activeCreatureId) {
    addLog(next, 'system', 'No active creature for bot turn.');
    return next;
  }

  const activeBot = getActiveCreature(next);
  const profile = activeBot.botProfile ?? 'passive';
  if (activeBot.controlMode !== 'bot') {
    addLog(next, 'system', `${activeBot.name} is not bot-controlled.`);
    return next;
  }

  if (profile === 'passive') {
    addLog(next, 'action', `${activeBot.name} bot waits. Passive/Test Dummy profile takes no action.`);
    return next;
  }

  const analysis = createBotAnalysisContext(next, activeBot);
  const plan = chooseBotTurnPlan(next, activeBot, profile, analysis);
  if (plan.order !== 'move-then-action') {
    addLog(next, 'action', `${activeBot.name} bot plan: ${formatBotTurnOrder(plan.order)}. ${plan.reason}`);
  }

  const decision = plan.mainAction ?? chooseBotAction(next, activeBot, profile, analysis);
  if (decision) {
    addLog(next, 'action', `${activeBot.name} bot chooses ${decision.action.name} against ${decision.targets.map((target) => target.name).join(', ')}.`);
    next = executeBotAction(next, decision, random);
  } else {
    const waited = performBotWait(next, activeBot);
    next = waited.state;
  }

  return next;
}

export function runBotTurnBonusActionStep(state: CombatState, random: RandomSource = Math.random): CombatState {
  let next = ensureTurnState(normalizeState(cloneState(state)));
  if (!next.activeCreatureId) {
    return next;
  }

  const bot = getActiveCreature(next);
  const profile = bot.botProfile ?? 'passive';
  if (bot.controlMode !== 'bot' || profile === 'passive') {
    return next;
  }

  const analysis = createBotAnalysisContext(next, bot);
  const decision = chooseBotBonusAction(next, bot, profile, analysis);
  if (!decision) {
    addLog(next, 'action', `${bot.name} bot skips bonus action: no useful bonus action found.`);
    return next;
  }

  addLog(
    next,
    'action',
    `${bot.name} bot uses bonus action ${decision.action.name}${decision.targets.length > 0 ? ` against ${decision.targets.map((target) => target.name).join(', ')}` : ''}.`
  );
  return executeBotAction(next, decision, random);
}

export function runBotTurnPostMovementStep(state: CombatState): CombatState {
  let next = ensureTurnState(normalizeState(cloneState(state)));
  if (!next.activeCreatureId) {
    return next;
  }

  const bot = getActiveCreature(next);
  const profile = bot.botProfile ?? 'passive';
  if (bot.controlMode !== 'bot' || profile === 'passive') {
    return next;
  }

  const analysis = createBotAnalysisContext(next, bot);
  const movement = chooseBotPostActionMovement(next, bot, profile, analysis);
  if (!movement) {
    return next;
  }

  addLog(
    next,
    'action',
    `${bot.name} bot repositions after acting because ${getBotPostMovementReason(next, bot, profile, analysis)}.`
  );
  next = moveActiveCreature(next, movement.path);
  return next;
}

export function runBotTurnEndStep(state: CombatState): CombatState {
  const next = ensureTurnState(normalizeState(cloneState(state)));
  if (!next.activeCreatureId) {
    return next;
  }

  if (getActiveCreature(next).controlMode !== 'bot') {
    return next;
  }

  return endTurn(next);
}

interface BotActionDecision {
  action: ActionDefinition;
  targets: Creature[];
  origin?: GridPosition;
  direction?: CardinalDirection;
  score: number;
  scoreDetails: BotActionScoreDetails;
}

interface BotPositionSimulation {
  state: CombatState;
  bot: Creature;
  query?: CombatQueryContext;
}

interface BotAnalysisContext {
  state: CombatState;
  botId: string;
  query: CombatQueryContext;
  livingEnemies?: Creature[];
  livingAllies?: Creature[];
  usableActions?: ActionDefinition[];
  reachableMovement?: MovementOption[];
  actionDecisions: Map<string, BotActionDecision[]>;
  positionSimulations: Map<string, BotPositionSimulation>;
  postActionMovement: Map<BotProfile, MovementOption | null>;
  attackOutcomes: Map<string, { hitChance: number; critChance: number }>;
  savingFailureChances: Map<string, number>;
  opportunityAttacks: OpportunityAttackPathLookup;
}

export type BotTurnOrder = 'move-then-action' | 'action-then-move' | 'action-only' | 'hold-position';

interface BotTurnPlan {
  order: BotTurnOrder;
  reason: string;
  preMovement?: MovementOption;
  mainAction?: BotActionDecision;
}

function createBotAnalysisContext(state: CombatState, bot: Creature): BotAnalysisContext {
  incrementPerformanceCounter('engine.bot.analysis-invocations');
  return {
    state,
    botId: bot.id,
    query: createCombatQueryContext(state),
    actionDecisions: new Map(),
    positionSimulations: new Map(),
    postActionMovement: new Map(),
    attackOutcomes: new Map(),
    savingFailureChances: new Map(),
    opportunityAttacks: createOpportunityAttackPathLookup(state, bot)
  };
}

function getCurrentBotAnalysis(
  analysis: BotAnalysisContext | undefined,
  state: CombatState,
  bot: Creature
): BotAnalysisContext | undefined {
  return analysis?.state === state && analysis.botId === bot.id ? analysis : undefined;
}

function recordBotAnalysisCache(hit: boolean, category: string): void {
  incrementPerformanceCounter(`engine.bot.analysis-cache-${hit ? 'hits' : 'misses'}`);
  incrementPerformanceCounter(`engine.bot.analysis-cache-${category}-${hit ? 'hits' : 'misses'}`);
}

function chooseBotTurnPlan(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): BotTurnPlan {
  const currentAction = chooseBotAction(state, bot, profile, analysis);
  const threatened = getMinimumDistanceToCreatures(bot.position, getLivingEnemies(state, bot, analysis)) <= 5;

  if (profile === 'rangedAttacker' && currentAction) {
    return {
      order: threatened ? 'action-then-move' : 'action-only',
      reason: threatened
        ? 'ranged bot has a valid shot now and is threatened, so it attacks before repositioning.'
        : 'ranged bot already has a valid target and holds position to attack.',
      mainAction: currentAction
    };
  }

  if (currentAction) {
    return {
      order: 'action-only',
      reason: isMeleeAttackActionDefinition(currentAction.action)
        ? 'bot already has a valid melee target, so it attacks before risking unnecessary movement.'
        : 'bot already has a valid action from its current position.',
      mainAction: currentAction
    };
  }

  const movement = chooseBotMovement(state, bot, profile, analysis);
  if (movement) {
    return {
      order: 'move-then-action',
      reason: 'bot needs a better position before it can make a useful action.',
      preMovement: movement
    };
  }

  return {
    order: 'hold-position',
    reason: 'bot found no useful action or reachable tactical movement.'
  };
}

function chooseBotMovement(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): MovementOption | undefined {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  const enemies = getLivingEnemies(state, bot, context);
  if (enemies.length === 0 || !canCreatureMove(state, bot)) {
    return undefined;
  }

  const reachable = getBotReachableMovement(state, bot, context);
  if (reachable.length === 0) {
    return undefined;
  }

  if (profile === 'cowardly') {
    const currentSafety = getMinimumDistanceToCreatures(bot.position, enemies);
    return reachable
      .filter((option) => getMinimumDistanceToCreatures(option.position, enemies) > currentSafety)
      .sort((a, b) => getMinimumDistanceToCreatures(b.position, enemies) - getMinimumDistanceToCreatures(a.position, enemies) || a.costFeet - b.costFeet)[0];
  }

  if (profile === 'rangedAttacker') {
    const rangedActions = getBotUsableActions(state, bot, context).filter(isRangedAttackActionDefinition);
    const currentDecision = chooseBestBotActionFromPosition(state, bot, profile, bot.position, rangedActions, context);
    const threatened = getMinimumDistanceToCreatures(bot.position, enemies) <= 5;
    if (currentDecision && !threatened) {
      return undefined;
    }

    return reachable
      .map((option) => ({
        option,
        decision: chooseBestBotActionFromPosition(state, bot, profile, option.position, rangedActions, context),
        safety: getMinimumDistanceToCreatures(option.position, enemies)
      }))
      .filter((candidate) => candidate.decision)
      .sort((a, b) => b.safety - a.safety || b.decision!.score - a.decision!.score || a.option.costFeet - b.option.costFeet)[0]?.option;
  }

  const meleeActions = getBotUsableActions(state, bot, context).filter(isMeleeAttackActionDefinition);
  if (chooseBestBotActionFromPosition(state, bot, profile, bot.position, meleeActions, context)) {
    return undefined;
  }

  const nearestEnemy = enemies.sort((a, b) => getDistanceFeet(bot.position, a.position) - getDistanceFeet(bot.position, b.position))[0];
  return reachable
    .map((option) => ({
      option,
      distance: getDistanceFeet(option.position, nearestEnemy.position),
      decision: chooseBestBotActionFromPosition(state, bot, profile, option.position, meleeActions, context)
    }))
    .sort((a, b) => {
      if (a.decision && !b.decision) {
        return -1;
      }
      if (!a.decision && b.decision) {
        return 1;
      }
      return a.distance - b.distance || a.option.costFeet - b.option.costFeet;
    })[0]?.option;
}

function chooseBotAction(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): BotActionDecision | undefined {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  const actions = getBotUsableActions(state, bot, context).filter(isBotMainActionCost);
  if (profile === 'support') {
    const supportDecision = chooseSupportBotAction(state, bot, actions, context);
    if (supportDecision) {
      return supportDecision;
    }
  }

  if (profile === 'cowardly' && getMinimumDistanceToCreatures(bot.position, getLivingEnemies(state, bot, context)) <= 10) {
    return undefined;
  }

  return chooseBestBotActionFromPosition(state, bot, profile, bot.position, actions, context);
}

function chooseBotBonusAction(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): BotActionDecision | undefined {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  const actions = getBotUsableActions(state, bot, context).filter((action) => action.actionCost === 'bonusAction');
  const offensiveDecision = chooseBestBotActionFromPosition(state, bot, profile, bot.position, actions, context);
  const utilityDecisions = actions.flatMap((action) => getBotBonusUtilityDecision(state, bot, profile, action, context));
  return [offensiveDecision, ...utilityDecisions]
    .filter(isDefined)
    .sort((a, b) => b.score - a.score)[0];
}

function getBotBonusUtilityDecision(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  action: ActionDefinition,
  analysis?: BotAnalysisContext
): BotActionDecision[] {
  if (isBotActionCandidate(action)) {
    return [];
  }

  const threatened = getMinimumDistanceToCreatures(bot.position, getLivingEnemies(state, bot, analysis)) <= 5;
  const postMovement = chooseBotPostActionMovement(state, bot, profile, analysis);
  const isDisengage = action.baseActionName === 'Disengage' || action.tags.includes('disengage');
  const isMobility = action.baseActionName === 'Dash' || action.tags.includes('movement');
  const score = isDisengage && threatened && postMovement
    ? 9
    : isMobility && postMovement
      ? 3
      : 0;

  if (score <= 0) {
    return [];
  }

  return [{
    action,
    targets: [],
    score,
    scoreDetails: createUtilityBotScoreDetails(score, isDisengage ? 'Bonus disengage supports a safe reposition.' : 'Bonus mobility supports a better position.')
  }];
}

function chooseBotPostActionMovement(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): MovementOption | undefined {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  if (context?.postActionMovement.has(profile)) {
    recordBotAnalysisCache(true, 'post-movement');
    return context.postActionMovement.get(profile) ?? undefined;
  }
  recordBotAnalysisCache(false, 'post-movement');
  if (profile !== 'rangedAttacker' || !canCreatureMove(state, bot)) {
    if (context) {
      context.postActionMovement.set(profile, null);
    }
    return undefined;
  }

  const enemies = getLivingEnemies(state, bot, context);
  if (enemies.length === 0 || getMinimumDistanceToCreatures(bot.position, enemies) > 5) {
    if (context) {
      context.postActionMovement.set(profile, null);
    }
    return undefined;
  }

  const reachable = getBotReachableMovement(state, bot, context);
  if (reachable.length === 0) {
    if (context) {
      context.postActionMovement.set(profile, null);
    }
    return undefined;
  }

  const currentDistance = getMinimumDistanceToCreatures(bot.position, enemies);
  const movement = reachable
    .map((option) => ({
      option,
      opportunityAttackCount: getOpportunityAttackCandidatesForMovementPath(
        state,
        bot,
        option.path,
        context?.query,
        context?.opportunityAttacks
      ).length,
      distance: getMinimumDistanceToCreatures(option.position, enemies)
    }))
    .filter((candidate) => candidate.distance > currentDistance)
    .sort((a, b) => a.opportunityAttackCount - b.opportunityAttackCount || b.distance - a.distance || a.option.costFeet - b.option.costFeet)[0]?.option;
  if (context) {
    context.postActionMovement.set(profile, movement ?? null);
  }
  return movement;
}

function getBotPostMovementReason(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): string {
  if (
    profile === 'rangedAttacker' &&
    getMinimumDistanceToCreatures(bot.position, getLivingEnemies(state, bot, analysis)) <= 5
  ) {
    return 'a hostile creature is too close for a ranged attacker';
  }

  return 'a better post-action position is available';
}

function createUtilityBotScoreDetails(score: number, note: string): BotActionScoreDetails {
  return {
    total: score,
    expectedDamage: 0,
    enemyTargets: 0,
    allyTargets: 0,
    profileBonus: 0,
    targetPriorityBonus: 0,
    memoryBonus: 0,
    positioningAdjustment: score,
    resourcePenalty: 0,
    friendlyFirePenalty: 0,
    notes: [note]
  };
}

function chooseBestBotActionFromPosition(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  position: GridPosition,
  actions: ActionDefinition[],
  analysis?: BotAnalysisContext
): BotActionDecision | undefined {
  const decisions = actions.flatMap((action) =>
    getBotActionDecisions(state, bot, profile, position, action, analysis)
  );
  return decisions.sort((a, b) => b.score - a.score)[0];
}

function getBotActionDecisions(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  position: GridPosition,
  action: ActionDefinition,
  analysis?: BotAnalysisContext
): BotActionDecision[] {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  const cacheKey = `${profile}|${position3DKey(position)}|${action.id}`;
  const cached = context?.actionDecisions.get(cacheKey);
  if (cached) {
    recordBotAnalysisCache(true, 'action-decisions');
    return [...cached];
  }
  recordBotAnalysisCache(false, 'action-decisions');
  const enemies = getLivingEnemies(state, bot, context);
  let decisions: BotActionDecision[] = [];
  if (isAttackActionDefinition(action)) {
    decisions = enemies
      .filter((target) => isBotAttackValidFromPosition(state, bot, action, position, target, context))
      .map((target) => {
        const scoreDetails = getBotAttackScoreDetails(state, bot, action, position, target, profile, context);
        return {
          action,
          targets: [target],
          score: scoreDetails.total,
          scoreDetails
        };
      });
  } else if (
    getRulesKind(action) === 'savingThrowEffect' &&
    action.save &&
    (action.damage || action.effects.some((effect) => effect.type === 'damage'))
  ) {
    const simulation = getBotPositionSimulation(state, bot, position, context);
    const simulationQuery = getBotSimulationQuery(simulation);
    decisions = enemies.flatMap((target) => {
      const origin = getBotShapeOrigin(action, position, target.position);
      const direction = getBotShapeDirection(position, target.position);
      if (!isInActionRange(action, position, origin)) {
        return [];
      }
      if (
        (action.tags.includes('spell') || action.kind === 'spell') &&
        !hasLineOfSight(simulation.state, position, origin, simulationQuery)
      ) {
        return [];
      }
      const targets = getTargetsInActionShape(
        simulation.state,
        action,
        simulation.bot,
        origin,
        direction,
        simulationQuery
      ).filter(
        (candidate) =>
          areHostile(candidate, bot, simulation.state, simulationQuery.teams) &&
          candidate.id !== bot.id
      );
      if (!targets.some((candidate) => candidate.id === target.id)) {
        return [];
      }

      const scoreDetails = getBotSavingThrowScoreDetails(
        simulation.state,
        simulation.bot,
        action,
        position,
        targets,
        profile,
        origin,
        direction,
        simulationQuery,
        context
      );
      return [{
        action,
        targets,
        origin,
        direction,
        score: scoreDetails.total,
        scoreDetails
      }];
    });
  }

  if (context) {
    context.actionDecisions.set(cacheKey, decisions);
  }
  return [...decisions];
}

function chooseSupportBotAction(
  state: CombatState,
  bot: Creature,
  actions: ActionDefinition[],
  analysis?: BotAnalysisContext
): BotActionDecision | undefined {
  const hurtAlly = getLivingAllies(state, bot, analysis)
    .filter((ally) => ally.hp < ally.maxHp / 2)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!hurtAlly) {
    return undefined;
  }

  const supportAction = actions.find((action) =>
    action.tags.some((tag) => tag.toLowerCase() === 'heal' || tag.toLowerCase() === 'healing' || tag.toLowerCase() === 'support' || tag.toLowerCase() === 'buff')
  );
  if (!supportAction || !isInActionRange(supportAction, bot.position, hurtAlly.position)) {
    return undefined;
  }

  return {
    action: supportAction,
    targets: [hurtAlly],
    score: 100,
    scoreDetails: {
      total: 100,
      expectedDamage: 0,
      enemyTargets: 0,
      allyTargets: 1,
      profileBonus: 100,
      targetPriorityBonus: 0,
      memoryBonus: 0,
      positioningAdjustment: 0,
      resourcePenalty: getActionResourcePenalty(bot, supportAction),
      friendlyFirePenalty: 0,
      notes: ['Support profile found an injured ally below half HP.']
    }
  };
}

function executeBotAction(state: CombatState, decision: BotActionDecision, random: RandomSource): CombatState {
  const actionKind = getRulesKind(decision.action);
  if (isAttackActionDefinition(decision.action)) {
    return performAttackAction(state, decision.action.id, decision.targets[0].id, random);
  }

  if (actionKind === 'savingThrowEffect') {
    return performSavingThrowAction(
      state,
      decision.action.id,
      decision.targets.map((target) => target.id),
      random,
      {},
      { origin: decision.origin, direction: decision.direction }
    );
  }

  return performCreatureUtilityAction(state, decision.action.id);
}

function performBotWait(state: CombatState, bot: Creature): { state: CombatState; waited: boolean } {
  if (!state.turnState.actionUsed && canCreatureTakeAction(state, bot)) {
    addLog(state, 'action', `${bot.name} bot found no good target and Dodges.`);
    return { state: performBasicAction(state, 'Dodge'), waited: true };
  }

  addLog(state, 'action', `${bot.name} bot found no valid action and waits.`);
  return { state, waited: true };
}

function rememberAttackTarget(state: CombatState, attackerId: string, targetId: string): void {
  state.botMemory = state.botMemory ?? {};
  state.botMemory[attackerId] = {
    ...state.botMemory[attackerId],
    lastTargetId: targetId,
    lastTargetRound: state.round
  };
  state.botMemory[targetId] = {
    ...state.botMemory[targetId],
    lastAttackerId: attackerId,
    lastAttackedRound: state.round
  };
}

function rememberDamage(state: CombatState, sourceId: string, targetId: string, amount: number): void {
  if (amount <= 0) {
    return;
  }

  state.botMemory = state.botMemory ?? {};
  state.botMemory[sourceId] = {
    ...state.botMemory[sourceId],
    lastTargetId: targetId,
    lastTargetRound: state.round
  };
  state.botMemory[targetId] = {
    ...state.botMemory[targetId],
    lastAttackerId: sourceId,
    lastAttackedRound: state.round,
    lastDamagedById: sourceId,
    lastDamagedRound: state.round
  };
}

function getBotPreviewNotes(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  movement: MovementOption | undefined,
  decision: BotActionDecision | undefined,
  actionState: CombatState,
  previewBot: Creature,
  plan: BotTurnPlan,
  bonusDecision: BotActionDecision | undefined,
  analysis?: BotAnalysisContext,
  actionAnalysis?: BotAnalysisContext
): string[] {
  const enemies = getLivingEnemies(state, bot, analysis);
  const notes = [
    `Profile: ${formatBotProfile(profile)}.`,
    `Tactics: ${formatBotTargetPriority(bot.botTargetPriority ?? 'balanced')}, ${formatBotResourceStrategy(bot.botResourceStrategy ?? 'normal')}.`,
    `Order: ${formatBotTurnOrder(plan.order)} because ${plan.reason}`
  ];
  notes.push(enemies.length > 0 ? `${enemies.length} living enemy target(s) considered.` : 'No living enemy targets found.');

  if (movement) {
    notes.push(`Movement: ${movement.costFeet} ft to (${movement.position.x}, ${movement.position.y}${getElevation(movement.position) ? `, z ${getElevation(movement.position)}` : ''}).`);
  } else if (!canCreatureMove(state, bot)) {
    notes.push('Movement skipped: movement is not currently allowed.');
  } else {
    notes.push('Movement skipped: current position is acceptable or no better reachable square was found.');
  }

  if (decision) {
    notes.push(`Action: ${decision.action.name} scored ${Math.round(decision.score * 10) / 10} against ${decision.targets.map((target) => target.name).join(', ')}.`);
    notes.push(...decision.scoreDetails.notes);
    if (bonusDecision) {
      notes.push(`Bonus action: ${bonusDecision.action.name} scored ${Math.round(bonusDecision.score * 10) / 10}.`);
    }
  } else if (!state.turnState.actionUsed && canCreatureTakeAction(state, bot)) {
    notes.push('Action fallback: no valid offensive/support action found, so the bot will Dodge.');
  } else {
    notes.push('Action fallback: no valid action remains, so the bot will wait.');
  }

  return [
    ...notes,
    ...getBotActionExplanationNotes(actionState, previewBot, profile, actionAnalysis)
  ].slice(0, 10);
}

function getBotActionExplanationNotes(
  state: CombatState,
  bot: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): string[] {
  const notes: string[] = [];
  const availableActions = getAvailableActions(bot, state);
  if (availableActions.length === 0) {
    return ['No actions are available on this creature.'];
  }

  availableActions.slice(0, 6).forEach((action) => {
    const unavailableReason = getUnavailableActionReason(bot, action);
    if (unavailableReason) {
      notes.push(`Rejected ${action.name}: ${unavailableReason}`);
      return;
    }

    if (!isBotActionCostAvailable(state, bot, action)) {
      notes.push(`Rejected ${action.name}: ${formatActionCost(action.actionCost)} already spent or blocked.`);
      return;
    }

    if (!hasResourcesForAction(bot, action)) {
      notes.push(`Rejected ${action.name}: required resource is unavailable.`);
      return;
    }

    const decisions = getBotActionDecisions(state, bot, profile, bot.position, action, analysis);
    if (decisions.length === 0 && isBotActionCandidate(action)) {
      notes.push(`Rejected ${action.name}: no enemy target in range or line of sight.`);
    }
  });

  return notes;
}

function isBotActionCandidate(action: ActionDefinition): boolean {
  return isAttackActionDefinition(action) || (getRulesKind(action) === 'savingThrowEffect' && Boolean(action.save));
}

function formatActionCost(actionCost: ActionDefinition['actionCost']): string {
  if (actionCost === 'bonusAction') {
    return 'bonus action';
  }
  return actionCost;
}

function getBotUsableActions(
  state: CombatState,
  bot: Creature,
  analysis?: BotAnalysisContext
): ActionDefinition[] {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  if (context?.usableActions) {
    recordBotAnalysisCache(true, 'usable-actions');
    return [...context.usableActions];
  }
  recordBotAnalysisCache(false, 'usable-actions');
  const actions = getAvailableActions(bot, state).filter(
    (action) => isBotActionCostAvailable(state, bot, action) && hasResourcesForAction(bot, action)
  );
  if (context) {
    context.usableActions = actions;
  }
  return [...actions];
}

function getBotReachableMovement(
  state: CombatState,
  bot: Creature,
  analysis?: BotAnalysisContext
): MovementOption[] {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  if (context?.reachableMovement) {
    recordBotAnalysisCache(true, 'reachable-movement');
    return [...context.reachableMovement];
  }
  recordBotAnalysisCache(false, 'reachable-movement');
  const reachable = getReachableMovementSquares(state, bot.id, context?.query);
  if (context) {
    context.reachableMovement = reachable;
  }
  return [...reachable];
}

function isBotMainActionCost(action: ActionDefinition): boolean {
  return action.actionCost === 'action' || action.actionCost === 'free';
}

function isBotActionCostAvailable(state: CombatState, bot: Creature, action: ActionDefinition): boolean {
  const resource = state.turnResources[bot.id] ?? state.turnState;
  if (action.actionCost === 'free') {
    return true;
  }
  if (action.actionCost === 'bonusAction') {
    return !resource.bonusActionUsed;
  }
  if (action.actionCost === 'reaction') {
    return !resource.reactionUsed && canCreatureTakeReaction(state, bot);
  }
  return !resource.actionUsed && canCreatureTakeAction(state, bot);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isBotAttackValidFromPosition(
  state: CombatState,
  bot: Creature,
  action: ActionDefinition,
  position: GridPosition,
  target: Creature,
  analysis?: BotAnalysisContext
): boolean {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  if (!areHostile(target, bot, state, context?.query.teams) || target.id === bot.id || isDefeated(target)) {
    return false;
  }
  if (!isInActionRange(action, position, target.position)) {
    return false;
  }
  if (getRulesKind(action) === 'rangedAttack' || action.tags.includes('ranged')) {
    const simulation = getBotPositionSimulation(state, bot, position, context);
    if (!hasLineOfSight(
      simulation.state,
      position,
      target.position,
      getBotSimulationQuery(simulation)
    )) {
      return false;
    }
  }
  return canCreatureTargetHarmfulEffect(bot, target);
}

function getBotAttackScoreDetails(
  state: CombatState,
  bot: Creature,
  action: ActionDefinition,
  position: GridPosition,
  target: Creature,
  profile: BotProfile,
  analysis?: BotAnalysisContext
): BotActionScoreDetails {
  const simulation = getBotPositionSimulation(state, bot, position, analysis);
  const simulatedState = simulation.state;
  const simulatedBot = simulation.bot;
  const actionKind = getRulesKind(action);
  const targetPosition = target.position;
  const attackModifier = getBotAttackRollModifier(simulatedState, simulatedBot, target, action, targetPosition);
  const rollMode = resolveRollMode(attackModifier);
  const attackBonus = getEffectiveAttackBonus(action, simulatedBot, simulatedState) + (attackModifier.flatModifier ?? 0);
  const targetAc = getEffectiveAC(target, simulatedState);
  const outcome = getAttackOutcomeChances(
    attackBonus,
    targetAc,
    rollMode,
    {
      autoFail: attackModifier.autoFail,
      autoSuccess: attackModifier.autoSuccess,
      automaticCritical: isAutomaticMeleeCritical(simulatedBot, target, targetPosition)
    },
    analysis
  );
  const damage = estimateDiceParts(action.damage?.dice ?? '');
  const expectedDamage = outcome.hitChance * damage.total + outcome.critChance * damage.dice;
  const profileBonus =
    profile === 'aggressiveMelee' && isMeleeAttackActionDefinition(action)
      ? 4
      : profile === 'rangedAttacker' && isRangedAttackActionDefinition(action)
        ? 4
        : 0;
  const targetPriorityBonus = getTargetPriorityBonus(simulatedState, simulatedBot, target, expectedDamage, outcome.hitChance);
  const memoryBonus = getBotMemoryTargetBonus(simulatedState, simulatedBot, target);
  const positioningAdjustment = -getDistanceFeet(position, target.position) * 0.03;
  const resourcePenalty = getActionResourcePenalty(bot, action);
  const total =
    expectedDamage +
    profileBonus +
    targetPriorityBonus +
    memoryBonus +
    positioningAdjustment -
    resourcePenalty;

  return {
    total,
    expectedDamage,
    hitChance: outcome.hitChance,
    critChance: outcome.critChance,
    enemyTargets: 1,
    allyTargets: 0,
    profileBonus,
    targetPriorityBonus,
    memoryBonus,
    positioningAdjustment,
    resourcePenalty,
    friendlyFirePenalty: 0,
    notes: [
      `${Math.round(outcome.hitChance * 100)}% hit chance vs AC ${targetAc}.`,
      `${formatBotNumber(expectedDamage)} expected damage${outcome.critChance > 0 ? `, ${Math.round(outcome.critChance * 100)}% crit chance` : ''}.`,
      `Target priority: ${formatBotTargetPriority(bot.botTargetPriority ?? 'balanced')}.`,
      ...(memoryBonus > 0 ? [`Memory: ${getBotMemoryReason(simulatedState, simulatedBot, target)}.`] : []),
      ...((attackModifier.notes ?? []).map((note) => `Attack modifier: ${note}.`))
    ]
  };
}

function getBotSavingThrowScoreDetails(
  state: CombatState,
  bot: Creature,
  action: ActionDefinition,
  position: GridPosition,
  enemyTargets: Creature[],
  profile: BotProfile,
  origin: GridPosition,
  direction: CardinalDirection,
  query?: CombatQueryContext,
  analysis?: BotAnalysisContext
): BotActionScoreDetails {
  const save = action.save ?? action.effects.find((effect) => effect.save)?.save;
  const damage = estimateDiceParts(action.damage?.dice ?? action.effects.find((effect) => effect.damage)?.damage?.dice ?? '');
  const allTargets = getTargetsInActionShape(state, action, bot, origin, direction, query)
    .filter((target) => target.id !== bot.id);
  const allyTargets = allTargets.filter((target) => areAllies(target, bot, state, query?.teams));
  const saveDc = save ? getEffectiveSaveDc(action, bot, state) ?? save.dc : undefined;
  const enemyExpectedDamage = save && saveDc
    ? enemyTargets.reduce((total, target) => {
        const failureChance = getSavingThrowFailureChance(
          state,
          bot,
          target,
          action,
          save.ability,
          saveDc,
          analysis
        );
        const successDamage = save.halfDamageOnSuccess ? damage.total * 0.5 : 0;
        return total + failureChance * damage.total + (1 - failureChance) * successDamage;
      }, 0)
    : damage.total * enemyTargets.length;
  const friendlyExpectedDamage = save && saveDc
    ? allyTargets.reduce((total, target) => {
        const failureChance = getSavingThrowFailureChance(
          state,
          bot,
          target,
          action,
          save.ability,
          saveDc,
          analysis
        );
        const successDamage = save.halfDamageOnSuccess ? damage.total * 0.5 : 0;
        return total + failureChance * damage.total + (1 - failureChance) * successDamage;
      }, 0)
    : damage.total * allyTargets.length;
  const representativeFailureChance = save && saveDc && enemyTargets.length > 0
    ? enemyTargets.reduce(
        (total, target) =>
          total + getSavingThrowFailureChance(
            state,
            bot,
            target,
            action,
            save.ability,
            saveDc,
            analysis
          ),
        0
      ) / enemyTargets.length
    : undefined;
  const profileBonus = profile === 'rangedAttacker' || profile === 'support' ? 1 : 0;
  const targetPriorityBonus = enemyTargets.reduce(
    (total, target) => total + getTargetPriorityBonus(state, bot, target, enemyExpectedDamage / Math.max(1, enemyTargets.length), representativeFailureChance),
    0
  );
  const memoryBonus = enemyTargets.reduce((total, target) => total + getBotMemoryTargetBonus(state, bot, target), 0);
  const positioningAdjustment = -getDistanceFeet(position, origin) * 0.01;
  const resourcePenalty = getActionResourcePenalty(bot, action);
  const friendlyFirePenalty = friendlyExpectedDamage * 1.5 + allyTargets.length * 3;
  const total = enemyExpectedDamage + enemyTargets.length * 2 + profileBonus + targetPriorityBonus + memoryBonus + positioningAdjustment - resourcePenalty - friendlyFirePenalty;

  return {
    total,
    expectedDamage: enemyExpectedDamage,
    saveFailureChance: representativeFailureChance,
    enemyTargets: enemyTargets.length,
    allyTargets: allyTargets.length,
    profileBonus,
    targetPriorityBonus,
    memoryBonus,
    positioningAdjustment,
    resourcePenalty,
    friendlyFirePenalty,
    notes: [
      `${enemyTargets.length} enemy target(s) in area${allyTargets.length > 0 ? `, ${allyTargets.length} ally target(s) also in shape` : ''}.`,
      saveDc ? `Average ${Math.round((representativeFailureChance ?? 0) * 100)}% failure chance vs DC ${saveDc}.` : 'No save DC available; using base damage estimate.',
      `${formatBotNumber(enemyExpectedDamage)} expected enemy damage.`,
      `Target priority: ${formatBotTargetPriority(bot.botTargetPriority ?? 'balanced')}.`,
      ...(memoryBonus > 0 ? ['Memory: one or more targets recently attacked or damaged this bot.'] : [])
    ]
  };
}

function getBotAttackRollModifier(
  state: CombatState,
  attacker: Creature,
  target: Creature,
  action: ActionDefinition,
  targetPosition: GridPosition
): RollModifier {
  const actionKind = getRulesKind(action);
  let attackModifier = collectAttackRollModifiers(
    state,
    attacker,
    target,
    action,
    getDistanceFeet(attacker.position, targetPosition)
  );
  attackModifier = mergeRollModifiers(attackModifier, collectBeforeAttackRollRuleModifiers(state, { attacker, target, action }));
  attackModifier = mergeRollModifiers(attackModifier, getFrightenedRollModifier(state, attacker));
  if (isFlankingAttack(state, attacker, target, action)) {
    attackModifier = mergeRollModifiers(attackModifier, { advantage: true, notes: ['flanking'] });
  }
  if ((actionKind === 'rangedAttack' || action.tags.includes('ranged')) && getHostileCreaturesWithinReach(state, attacker).length > 0) {
    attackModifier = mergeRollModifiers(attackModifier, { disadvantage: true, notes: ['hostile creature within 5 ft'] });
  }
  if (isBeyondNormalRange(action, attacker.position, targetPosition)) {
    attackModifier = mergeRollModifiers(attackModifier, { disadvantage: true, notes: ['long range'] });
  }
  return attackModifier;
}

function getAttackOutcomeChances(
  attackBonus: number,
  targetAc: number,
  rollMode: RollMode,
  options: { autoFail?: boolean; autoSuccess?: boolean; automaticCritical?: boolean },
  analysis?: BotAnalysisContext
): { hitChance: number; critChance: number } {
  const cacheKey = [
    attackBonus,
    targetAc,
    rollMode,
    options.autoFail ? 1 : 0,
    options.autoSuccess ? 1 : 0,
    options.automaticCritical ? 1 : 0
  ].join('|');
  const cached = analysis?.attackOutcomes.get(cacheKey);
  if (cached) {
    recordBotAnalysisCache(true, 'attack-outcomes');
    return cached;
  }
  recordBotAnalysisCache(false, 'attack-outcomes');
  const rolls = getD20OutcomeRolls(rollMode);
  const outcomes = rolls.map(([first, second]) => {
    const d20 = chooseD20(first, second, rollMode);
    const naturalCritical = d20 === 20;
    const naturalMiss = d20 === 1;
    const hit = naturalMiss ? false : naturalCritical ? true : options.autoFail ? false : options.autoSuccess ? true : d20 + attackBonus >= targetAc;
    const critical = naturalCritical || (hit && Boolean(options.automaticCritical));
    return { hit, critical };
  });
  const result = {
    hitChance: outcomes.filter((outcome) => outcome.hit).length / outcomes.length,
    critChance: outcomes.filter((outcome) => outcome.critical).length / outcomes.length
  };
  analysis?.attackOutcomes.set(cacheKey, result);
  return result;
}

function getSavingThrowFailureChance(
  state: CombatState,
  source: Creature,
  target: Creature,
  action: ActionDefinition,
  ability: Ability,
  saveDc: number,
  analysis?: BotAnalysisContext
): number {
  const cacheKey = [
    position3DKey(source.position),
    target.id,
    action.id,
    ability,
    saveDc
  ].join('|');
  const cached = analysis?.savingFailureChances.get(cacheKey);
  if (cached !== undefined) {
    recordBotAnalysisCache(true, 'saving-failure');
    return cached;
  }
  recordBotAnalysisCache(false, 'saving-failure');
  const saveRollModifier = mergeRollModifiers(
    collectSavingThrowModifiers(state, target, ability),
    collectBeforeSavingThrowRuleModifiers(state, { source, target, action, ability })
  );
  const rollMode = resolveRollMode(saveRollModifier);
  const saveBonus = getEffectiveSaveBonus(target, ability, state) + (saveRollModifier.flatModifier ?? 0);
  const rolls = getD20OutcomeRolls(rollMode);
  const failures = rolls.filter(([first, second]) => {
    const d20 = chooseD20(first, second, rollMode);
    const success = saveRollModifier.autoFail ? false : saveRollModifier.autoSuccess ? true : d20 + saveBonus >= saveDc;
    return !success;
  }).length;
  const failureChance = failures / rolls.length;
  analysis?.savingFailureChances.set(cacheKey, failureChance);
  return failureChance;
}

function getD20OutcomeRolls(rollMode: RollMode): Array<[number, number | undefined]> {
  const rolls: Array<[number, number | undefined]> = [];
  for (let first = 1; first <= 20; first += 1) {
    if (rollMode === 'normal') {
      rolls.push([first, undefined]);
    } else {
      for (let second = 1; second <= 20; second += 1) {
        rolls.push([first, second]);
      }
    }
  }
  return rolls;
}

function getTargetPriorityBonus(
  state: CombatState,
  bot: Creature,
  target: Creature,
  expectedDamage: number,
  successChance?: number
): number {
  const priority = bot.botTargetPriority ?? 'balanced';
  const missingHpRatio = target.maxHp > 0 ? 1 - target.hp / target.maxHp : 0;
  const finishingBonus = expectedDamage >= target.hp ? 5 : 0;

  if (priority === 'nearest') {
    return finishingBonus + Math.max(0, 8 - getDistanceFeet(bot.position, target.position) / 5) * 0.9;
  }

  if (priority === 'weakest') {
    return finishingBonus + Math.max(0, 20 - getEffectiveAC(target, state)) * 0.45;
  }

  if (priority === 'lowestHp') {
    return finishingBonus + Math.max(0, 30 - target.hp) * 0.18 + missingHpRatio * 4;
  }

  if (priority === 'easiestToHit') {
    return finishingBonus + (successChance ?? 0) * 6;
  }

  return finishingBonus + missingHpRatio * 3;
}

function getBotMemoryTargetBonus(state: CombatState, bot: Creature, target: Creature): number {
  const memory = state.botMemory?.[bot.id];
  if (!memory) {
    return 0;
  }

  let bonus = 0;
  if (memory.lastDamagedById === target.id) {
    bonus += 4 * getBotMemoryRecencyMultiplier(state.round, memory.lastDamagedRound);
  }
  if (memory.lastAttackerId === target.id) {
    bonus += 2 * getBotMemoryRecencyMultiplier(state.round, memory.lastAttackedRound);
  }
  if (memory.lastTargetId === target.id) {
    bonus += 1.5 * getBotMemoryRecencyMultiplier(state.round, memory.lastTargetRound);
  }
  return bonus;
}

function getBotMemoryReason(state: CombatState, bot: Creature, target: Creature): string {
  const memory = state.botMemory?.[bot.id];
  if (!memory) {
    return 'no relevant memory';
  }

  if (memory.lastDamagedById === target.id) {
    return `${target.name} recently damaged ${bot.name}`;
  }
  if (memory.lastAttackerId === target.id) {
    return `${target.name} recently attacked ${bot.name}`;
  }
  if (memory.lastTargetId === target.id) {
    return `${bot.name} was already focusing ${target.name}`;
  }
  return 'no relevant memory';
}

function getBotMemoryRecencyMultiplier(currentRound: number, memoryRound: number | undefined): number {
  if (typeof memoryRound !== 'number') {
    return 0.5;
  }

  const age = Math.max(0, currentRound - memoryRound);
  if (age <= 1) {
    return 1;
  }
  if (age === 2) {
    return 0.65;
  }
  if (age === 3) {
    return 0.35;
  }
  return 0.15;
}

function getActionResourcePenalty(creature: Creature, action: ActionDefinition): number {
  const basePenalty = (action.resourceCosts ?? []).reduce((total, cost) => {
    const resource = (creature.resources ?? []).find((candidate) => candidate.id === cost.resourceId);
    if (!resource || resource.max <= 0) {
      return total;
    }

    const scarcity = cost.amount / Math.max(1, resource.current);
    const resetMultiplier = resource.resetOn === 'turnStart' ? 0.25 : resource.resetOn === 'never' || resource.resetOn === 'manual' ? 1.25 : 0.8;
    const timingMultiplier = cost.consumeOn === 'use' ? 1 : 0.65;
    return total + scarcity * resetMultiplier * timingMultiplier * 3;
  }, 0);

  if (creature.botResourceStrategy === 'conserve') {
    return basePenalty * 2.25;
  }

  if (creature.botResourceStrategy === 'spendFreely') {
    return basePenalty * 0.25;
  }

  return basePenalty;
}

function roundBotScoreDetails(details: BotActionScoreDetails): BotActionScoreDetails {
  return {
    ...details,
    total: roundBotNumber(details.total),
    expectedDamage: roundBotNumber(details.expectedDamage),
    hitChance: details.hitChance === undefined ? undefined : roundBotNumber(details.hitChance),
    critChance: details.critChance === undefined ? undefined : roundBotNumber(details.critChance),
    saveFailureChance: details.saveFailureChance === undefined ? undefined : roundBotNumber(details.saveFailureChance),
    profileBonus: roundBotNumber(details.profileBonus),
    targetPriorityBonus: roundBotNumber(details.targetPriorityBonus),
    memoryBonus: roundBotNumber(details.memoryBonus),
    positioningAdjustment: roundBotNumber(details.positioningAdjustment),
    resourcePenalty: roundBotNumber(details.resourcePenalty),
    friendlyFirePenalty: roundBotNumber(details.friendlyFirePenalty)
  };
}

function roundBotNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatBotNumber(value: number): string {
  return roundBotNumber(value).toString();
}

function getEstimatedActionDamage(action: ActionDefinition): number {
  return estimateDiceAverage(action.damage?.dice ?? action.effects.find((effect) => effect.damage)?.damage?.dice ?? '');
}

function estimateDiceParts(dice: string): { dice: number; modifier: number; total: number } {
  const match = dice.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/i);
  if (!match) {
    return { dice: 0, modifier: 0, total: 0 };
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const sign = match[3] === '-' ? -1 : 1;
  const modifier = match[4] ? Number(match[4]) * sign : 0;
  const diceAverage = count * (sides + 1) / 2;
  return {
    dice: diceAverage,
    modifier,
    total: diceAverage + modifier
  };
}

function estimateDiceAverage(dice: string): number {
  return estimateDiceParts(dice).total;
}

function getLivingEnemies(
  state: CombatState,
  creature: Creature,
  analysis?: BotAnalysisContext
): Creature[] {
  const context = getCurrentBotAnalysis(analysis, state, creature);
  if (context?.livingEnemies) {
    recordBotAnalysisCache(true, 'living-enemies');
    return [...context.livingEnemies];
  }
  recordBotAnalysisCache(false, 'living-enemies');
  const enemies = state.creatures.filter(
    (candidate) =>
      candidate.id !== creature.id &&
      areHostile(candidate, creature, state, context?.query.teams) &&
      !isDefeated(candidate)
  );
  if (context) {
    context.livingEnemies = enemies;
  }
  return [...enemies];
}

function getLivingAllies(
  state: CombatState,
  creature: Creature,
  analysis?: BotAnalysisContext
): Creature[] {
  const context = getCurrentBotAnalysis(analysis, state, creature);
  if (context?.livingAllies) {
    recordBotAnalysisCache(true, 'living-allies');
    return [...context.livingAllies];
  }
  recordBotAnalysisCache(false, 'living-allies');
  const allies = state.creatures.filter(
    (candidate) => areAllies(candidate, creature, state, context?.query.teams) && !isDefeated(candidate)
  );
  if (context) {
    context.livingAllies = allies;
  }
  return [...allies];
}

function getMinimumDistanceToCreatures(position: GridPosition, creatures: Creature[]): number {
  return creatures.length > 0 ? Math.min(...creatures.map((creature) => getDistanceFeet(position, creature.position))) : Number.POSITIVE_INFINITY;
}

function getBotShapeOrigin(action: ActionDefinition, sourcePosition: GridPosition, targetPosition: GridPosition): GridPosition {
  if (action.shape?.type === 'line' || action.shape?.type === 'cone') {
    return sourcePosition;
  }

  return targetPosition;
}

function getBotShapeDirection(sourcePosition: GridPosition, targetPosition: GridPosition): CardinalDirection {
  const dx = targetPosition.x - sourcePosition.x;
  const dy = targetPosition.y - sourcePosition.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'east' : 'west';
  }
  return dy >= 0 ? 'south' : 'north';
}

function replaceBotPosition(state: CombatState, botId: string, position: GridPosition): Creature[] {
  return state.creatures.map((creature) => (creature.id === botId ? { ...creature, position } : creature));
}

function getBotPositionSimulation(
  state: CombatState,
  bot: Creature,
  position: GridPosition,
  analysis?: BotAnalysisContext
): BotPositionSimulation {
  const context = getCurrentBotAnalysis(analysis, state, bot);
  const key = position3DKey(position);
  const cached = context?.positionSimulations.get(key);
  if (cached) {
    recordBotAnalysisCache(true, 'position-simulations');
    return cached;
  }
  recordBotAnalysisCache(false, 'position-simulations');
  const simulatedBot = { ...bot, position };
  const simulatedState = {
    ...state,
    creatures: state.creatures.map((creature) =>
      creature.id === bot.id ? { ...creature, position } : creature
    )
  };
  const simulation = {
    state: simulatedState,
    bot: simulatedBot
  };
  context?.positionSimulations.set(key, simulation);
  return simulation;
}

function getBotSimulationQuery(simulation: BotPositionSimulation): CombatQueryContext {
  if (!simulation.query) {
    simulation.query = createCombatQueryContext(simulation.state);
  }
  return simulation.query;
}

function isMeleeAttackActionDefinition(action: ActionDefinition): boolean {
  const rulesKind = getRulesKind(action);
  return rulesKind === 'meleeAttack' || action.tags.includes('melee');
}

function isRangedAttackActionDefinition(action: ActionDefinition): boolean {
  const rulesKind = getRulesKind(action);
  return rulesKind === 'rangedAttack' || action.tags.includes('ranged');
}

function formatBotProfile(profile: BotProfile): string {
  switch (profile) {
    case 'aggressiveMelee':
      return 'Aggressive Melee';
    case 'rangedAttacker':
      return 'Ranged Attacker';
    case 'cowardly':
      return 'Cowardly';
    case 'support':
      return 'Support';
    case 'passive':
      return 'Passive/Test Dummy';
  }
}

function formatBotTargetPriority(priority: BotTargetPriority): string {
  switch (priority) {
    case 'nearest':
      return 'Nearest';
    case 'weakest':
      return 'Weakest AC';
    case 'lowestHp':
      return 'Lowest HP';
    case 'easiestToHit':
      return 'Easiest to Hit';
    case 'balanced':
      return 'Balanced';
  }
}

function formatBotResourceStrategy(strategy: BotResourceStrategy): string {
  switch (strategy) {
    case 'conserve':
      return 'Conserve Resources';
    case 'spendFreely':
      return 'Spend Freely';
    case 'normal':
      return 'Normal Resources';
  }
}

function formatBotTurnOrder(order: BotTurnOrder): string {
  switch (order) {
    case 'move-then-action':
      return 'move then action';
    case 'action-then-move':
      return 'action then move';
    case 'action-only':
      return 'action only';
    case 'hold-position':
      return 'hold position';
  }
}

export function getTargetsInShape(
  state: CombatState,
  actionId: string,
  origin: GridPosition,
  direction?: CardinalDirection,
  query?: CombatQueryContext
): Creature[] {
  const source = getActiveCreature(state);
  const action = findAction(source, actionId, state);
  return getTargetsInActionShape(state, action, source, origin, direction, query);
}

export function getAttackDebugStats(
  state: CombatState,
  actionId: string,
  targetId: string,
  trials = 1000,
  random: RandomSource = Math.random
): AttackDebugStats {
  const normalized = ensureTurnState(normalizeState(cloneState(state)));
  const attacker = getActiveCreature(normalized);
  const target = findCreature(normalized, targetId);
  const action = findAction(attacker, actionId, normalized);
  const attackModifier = mergeRollModifiers(
    collectAttackRollModifiers(
      normalized,
      attacker,
      target,
      action,
      getDistanceFeet(attacker.position, target.position)
    ),
    collectBeforeAttackRollRuleModifiers(normalized, { attacker, target, action }),
    getFrightenedRollModifier(normalized, attacker),
    isFlankingAttack(normalized, attacker, target, action) ? { advantage: true, notes: ['flanking'] } : undefined,
    isBeyondNormalRange(action, attacker.position, target.position) ? { disadvantage: true, notes: ['long range'] } : undefined
  );
  const rollMode = resolveRollMode(attackModifier);
  const attackBonus = getEffectiveAttackBonus(action, attacker, normalized) + (attackModifier.flatModifier ?? 0);
  const targetAc = getEffectiveAC(target, normalized);
  let hits = 0;
  let crits = 0;

  for (let index = 0; index < trials; index += 1) {
    const first = rollDice('1d20', random).total;
    const second = rollMode === 'normal' ? undefined : rollDice('1d20', random).total;
    const d20 = chooseD20(first, second, rollMode);
    const result = getAttackRollResult(d20, attackBonus, targetAc);
    if (result.hit) {
      hits += 1;
    }
    if (result.critical) {
      crits += 1;
    }
  }

  return {
    trials,
    hits,
    misses: trials - hits,
    crits,
    hitPercentage: trials > 0 ? (hits / trials) * 100 : 0,
    expectedHitPercentage: getExpectedHitChance(attackBonus, targetAc, rollMode) * 100,
    rollMode,
    attackBonus,
    targetAc
  };
}

export function getExpectedHitChance(attackBonus: number, targetAc: number, rollMode: RollMode = 'normal'): number {
  const rolls: Array<[number, number | undefined]> = [];

  for (let first = 1; first <= 20; first += 1) {
    if (rollMode === 'normal') {
      rolls.push([first, undefined]);
    } else {
      for (let second = 1; second <= 20; second += 1) {
        rolls.push([first, second]);
      }
    }
  }

  const hits = rolls.filter(([first, second]) => {
    const d20 = chooseD20(first, second, rollMode);
    return getAttackRollResult(d20, attackBonus, targetAc).hit;
  }).length;

  return hits / rolls.length;
}

export function getActionShapeSquares(
  state: CombatState,
  action: ActionDefinition,
  origin: GridPosition,
  direction?: CardinalDirection,
  query?: CombatQueryContext
): GridPosition[] {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  return getShapeSquares(action.shape ?? { type: 'single' }, origin, state.grid, direction, context);
}

function getShapeOriginForAction(
  state: CombatState,
  action: ActionDefinition,
  sourcePosition: GridPosition,
  selectedOrigin?: GridPosition
): GridPosition {
  if (action.shape?.type === 'line' || action.shape?.type === 'cone') {
    return getTilePosition(sourcePosition, state.grid);
  }

  return getTilePosition(selectedOrigin ?? sourcePosition, state.grid);
}

function getTargetsInActionShape(
  state: CombatState,
  action: ActionDefinition,
  source: Creature,
  origin: GridPosition,
  direction?: CardinalDirection,
  query?: CombatQueryContext
): Creature[] {
  return measurePerformance(
    'engine.targeting.action-shape-targets',
    () => getTargetsInActionShapeInternal(state, action, source, origin, direction, query)
  );
}

function getTargetsInActionShapeInternal(
  state: CombatState,
  action: ActionDefinition,
  source: Creature,
  origin: GridPosition,
  direction?: CardinalDirection,
  query?: CombatQueryContext
): Creature[] {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  const normalizedOrigin = getTilePosition(origin, state.grid, context?.grid);
  const squareKeys = new Set(
    getActionShapeSquares(state, action, normalizedOrigin, direction, context).map(position3DKey)
  );
  return state.creatures.filter(
    (creature) =>
      creature.id !== source.id &&
      !isDefeated(creature) &&
      squareKeys.has(position3DKey(getTilePosition(creature.position, state.grid, context?.grid)))
  );
}

function isAutomaticMeleeCritical(attacker: Creature, target: Creature, targetPosition: GridPosition): boolean {
  return getDistanceFeet(attacker.position, targetPosition) <= 5 && (hasCondition(target, 'paralyzed') || hasCondition(target, 'unconscious'));
}

function canCreatureTargetHarmfulEffect(source: Creature, target: Creature): boolean {
  return !normalizeConditions(source.conditions).some(
    (condition) => condition.id === 'charmed' && condition.sourceCreatureId === target.id
  );
}

function getFrightenedRollModifier(state: CombatState, creature: Creature): RollModifier | undefined {
  const relevantFrightened = normalizeConditions(creature.conditions).some((condition) => {
    if (condition.id !== 'frightened') {
      return false;
    }

    if (!condition.sourceCreatureId) {
      return false;
    }

    const source = state.creatures.find((candidate) => candidate.id === condition.sourceCreatureId);
    return source !== undefined && !isDefeated(source) && hasLineOfSight(state, creature.position, source.position);
  });

  return relevantFrightened ? { disadvantage: true, notes: ['Frightened'] } : undefined;
}

function isFlankingAttack(state: CombatState, attacker: Creature, target: Creature, action: ActionDefinition): boolean {
  if (!state.rulesSettings?.flanking?.enabled) {
    return false;
  }

  const actionKind = getRulesKind(action);
  if (actionKind !== 'meleeAttack' && !action.tags.includes('melee')) {
    return false;
  }

  if (!isInActionRange(action, attacker.position, target.position) || isBlocked(attacker.position, state.grid)) {
    return false;
  }

  const attackerVector = {
    x: Math.sign(attacker.position.x - target.position.x),
    y: Math.sign(attacker.position.y - target.position.y)
  };
  if (attackerVector.x === 0 && attackerVector.y === 0) {
    return false;
  }

  return state.creatures.some((ally) => {
    if (
      ally.id === attacker.id ||
      ally.id === target.id ||
      !areAllies(ally, attacker, state) ||
      isDefeated(ally) ||
      !canCreatureTakeReaction(state, ally) ||
      isBlocked(ally.position, state.grid)
    ) {
      return false;
    }

    const allyVector = {
      x: Math.sign(ally.position.x - target.position.x),
      y: Math.sign(ally.position.y - target.position.y)
    };
    return (
      allyVector.x === -attackerVector.x &&
      allyVector.y === -attackerVector.y &&
      getHostileCreaturesWithinReach(state, ally).some((hostile) => hostile.id === target.id)
    );
  });
}

export function getActiveCreature(state: CombatState): Creature {
  if (!state.activeCreatureId) {
    throw new Error('No active creature. Roll initiative first.');
  }

  return findCreature(state, state.activeCreatureId);
}

export function hasActionAvailable(state: CombatState): boolean {
  return !ensureTurnState(normalizeState(cloneState(state))).turnState.actionUsed;
}

export function applyCondition(
  state: CombatState,
  targetId: string,
  conditionId: string,
  options: {
    sourceCreatureId?: string;
    name?: string;
    description?: string;
    tags?: string[];
    durationType?: ConditionDurationType;
    remainingRounds?: number;
    stackBehavior?: StackBehavior;
    stackCount?: number;
    intensity?: number;
    metadata?: Record<string, string | number | boolean | undefined>;
    rules?: ActionDefinition['rules'];
  } = {}
): CombatState {
  const next = normalizeState(cloneState(state));
  const target = findCreature(next, targetId);
  const applied = createAppliedCondition(conditionId, options);
  stampConditionApplicationTiming(next, applied);
  const result = applyConditionToCreature(target, applied);
  logConditionChange(next, target, applied, result);
  return next;
}

export function removeCondition(state: CombatState, targetId: string, conditionId: string): CombatState {
  const next = normalizeState(cloneState(state));
  const target = findCreature(next, targetId);
  const existing = target.conditions.find((condition) => condition.id === conditionId);
  if (removeConditionFromCreature(target, conditionId)) {
    addLog(next, 'condition', `${existing?.name ?? getConditionDefinition(conditionId).name} removed from ${target.name}.`);
    emitConditionRemoved(next, target, existing ?? createAppliedCondition(conditionId));
  }

  return next;
}

export function resetAllResources(state: CombatState, resetOn: 'turnStart' | 'shortRest' | 'longRest' | 'dawn' | 'manual' | 'never'): CombatState {
  const next = normalizeState(cloneState(state));
  next.creatures.forEach((creature) => resetResources(creature, resetOn));
  addLog(next, 'system', `Resources reset: ${resetOn}.`);
  return next;
}

export function findCreature(state: CombatState, creatureId: string): Creature {
  const creature = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!creature) {
    throw new Error(`Creature not found: ${creatureId}`);
  }

  return creature;
}

export function isDefeated(creature: Creature): boolean {
  return creature.hp <= 0 || hasCondition(creature, 'defeated');
}

function applyDamage(
  state: CombatState,
  sourceId: string,
  targetId: string,
  action: ActionDefinition,
  amount: number,
  hooks: CombatHooks,
  random: RandomSource = Math.random
): number {
  const source = findCreature(state, sourceId);
  const target = findCreature(state, targetId);
  let modifiedAmount = Math.max(0, applyBeforeDamageModifiers(state, source, target, action, amount));
  modifiedAmount = Math.max(0, applyBeforeDamageRules(state, {
    source,
    target,
    action,
    amount: modifiedAmount,
    damageType: getActionDamageType(action),
    random
  }));
  if (hooks.beforeDamage) {
    normalizedCombatStates.delete(state);
    hooks.beforeDamage(state, { source, target, action, amount: modifiedAmount });
  }

  target.hp = Math.max(0, target.hp - modifiedAmount);
  if (modifiedAmount > 0) {
    rememberDamage(state, source.id, target.id, modifiedAmount);
    enqueueVisualEvent(state, {
      kind: 'damageDealt',
      creatureId: target.id,
      sourceCreatureId: source.id,
      amount: modifiedAmount,
      label: `-${modifiedAmount}`
    });
  }

  runAfterDamageHooks(state, source, target, action, modifiedAmount);
  runAfterDamageRules(state, { source, target, action, amount: modifiedAmount });
  if (hooks.afterDamage) {
    normalizedCombatStates.delete(state);
    hooks.afterDamage(state, { source, target, action, amount: modifiedAmount });
  }
  resolveConcentrationAfterDamage(state, source, target, action, modifiedAmount, random);
  if (target.hp === 0 && !hasCondition(target, 'defeated')) {
    applyConditionToCreature(target, createAppliedCondition('defeated'));
    if (hooks.onCreatureDefeated) {
      normalizedCombatStates.delete(state);
      hooks.onCreatureDefeated(state, target);
    }
    addLog(state, 'defeat', `${target.name} is defeated.`);
    enqueueVisualEvent(state, { kind: 'creatureDefeated', creatureId: target.id, sourceCreatureId: source.id, label: 'Defeated' });
    runDefeatedRules(state, target, source, action, random);
  }
  return modifiedAmount;
}

function resolveConcentrationAfterDamage(
  state: CombatState,
  source: Creature,
  target: Creature,
  action: ActionDefinition,
  amount: number,
  random: RandomSource
): void {
  if (amount <= 0 || !hasCondition(target, 'concentrating')) {
    return;
  }

  if (target.hp === 0) {
    if (removeConditionFromCreature(target, 'concentrating')) {
      addLog(state, 'condition', `${target.name} loses concentration because they are defeated.`);
      emitConditionRemoved(state, target, createAppliedCondition('concentrating'));
    }
    return;
  }

  const dc = Math.max(10, Math.floor(amount / 2));
  const saveRollModifier = mergeRollModifiers(
    collectSavingThrowModifiers(state, target, 'con'),
    collectBeforeSavingThrowRuleModifiers(state, { source, target, action, ability: 'con' })
  );
  const rollMode = resolveRollMode(saveRollModifier);
  const firstSaveRoll = rollDice('1d20', random);
  const secondSaveRoll = rollMode === 'normal' ? undefined : rollDice('1d20', random);
  const saveModifier = getEffectiveSaveBonus(target, 'con', state);
  const flatModifier = saveRollModifier.flatModifier ?? 0;
  const d20Total = chooseD20(firstSaveRoll.total, secondSaveRoll?.total, rollMode);
  const saveTotal = saveRollModifier.autoFail
    ? Number.NEGATIVE_INFINITY
    : saveRollModifier.autoSuccess
      ? Number.POSITIVE_INFINITY
      : d20Total + saveModifier + flatModifier;
  const success = saveTotal >= dc;

  addLog(
    state,
    'save',
    `${target.name} rolls concentration save after taking ${amount} damage: ${formatD20Roll(firstSaveRoll.total, secondSaveRoll?.total, rollMode)}${formatRollReasons(saveRollModifier.notes)} + ${saveModifier}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''} = ${saveTotal} vs DC ${dc}. ${success ? 'Success.' : 'Failure.'}`
  );
  enqueueVisualEvent(state, {
    kind: success ? 'savingThrowSuccess' : 'savingThrowFailure',
    creatureId: target.id,
    sourceCreatureId: source.id,
    label: success ? 'Save' : 'Fail'
  });

  if (!success && removeConditionFromCreature(target, 'concentrating')) {
    addLog(state, 'condition', `${target.name} loses concentration on ${action.name}.`);
    emitConditionRemoved(state, target, createAppliedCondition('concentrating'));
  }
}

function resolveSavingThrowDamageAction(
  state: CombatState,
  sourceId: string,
  action: ActionDefinition,
  targetIds: string[],
  random: RandomSource,
  hooks: CombatHooks
): void {
  const source = findCreature(state, sourceId);
  const effect = action.effects.find((candidate) => candidate.type === 'damage' && candidate.save);
  const save = action.save ?? effect?.save;
  const damageDefinition = action.damage ?? effect?.damage;

  if (!save || !damageDefinition) {
    addLog(state, 'system', `${action.name} has no automated saving throw damage.`);
    return;
  }

  targetIds.forEach((targetId) => {
    const target = findCreature(state, targetId);
    if (isDefeated(target)) {
      return;
    }

    const saveRollModifier = mergeRollModifiers(
      collectSavingThrowModifiers(state, target, save.ability),
      collectBeforeSavingThrowRuleModifiers(state, { source, target, action, ability: save.ability })
    );
    const rollMode = resolveRollMode(saveRollModifier);
    const firstSaveRoll = rollDice('1d20', random);
    const secondSaveRoll = rollMode === 'normal' ? undefined : rollDice('1d20', random);
    const saveModifier = getEffectiveSaveBonus(target, save.ability, state);
    const flatModifier = saveRollModifier.flatModifier ?? 0;
    const d20Total = chooseD20(firstSaveRoll.total, secondSaveRoll?.total, rollMode);
    const saveTotal = d20Total + saveModifier + flatModifier;
    const saveDc = getEffectiveSaveDc(action, source, state) ?? save.dc;
    const success = saveRollModifier.autoFail ? false : saveRollModifier.autoSuccess ? true : saveTotal >= saveDc;
    if (!success) {
      spendActionResources(state, source, action, 'failedSave');
    }
    const damageRoll = rollDice(damageDefinition.dice, random);
    const amount = success && save.halfDamageOnSuccess ? Math.floor(damageRoll.total / 2) : damageRoll.total;

    addLog(
      state,
      'save',
      `${target.name} rolls ${save.ability.toUpperCase()} save against ${action.name}: ${formatD20Roll(firstSaveRoll.total, secondSaveRoll?.total, rollMode)}${formatRollReasons(saveRollModifier.notes)} + ${saveModifier}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''} = ${saveTotal} vs DC ${saveDc}. ${success ? 'Success.' : 'Failure.'}`
    );
    enqueueVisualEvent(state, {
      kind: success ? 'savingThrowSuccess' : 'savingThrowFailure',
      creatureId: target.id,
      sourceCreatureId: source.id,
      label: success ? 'Save' : 'Fail'
    });
    runAfterSavingThrowRules(state, { source, target, action, ability: save.ability, total: saveTotal, success });

    const appliedDamage = applyDamage(state, source.id, target.id, action, amount, hooks, random);
    addLog(
      state,
      'damage',
      `${target.name} takes ${appliedDamage} ${damageDefinition.type ?? 'damage'} from ${action.name} (${damageRoll.rolls.join(', ')} + ${damageRoll.modifier}${success ? ', halved' : ''}).`
    );
  });
}

function findAction(creature: Creature, actionId: string, state?: CombatState): ActionDefinition {
  const actions = state ? getAvailableActions(creature, state) : creature.actions;
  const action = actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error(`${creature.name} does not have action ${actionId}.`);
  }

  return action;
}

function getMultiattackStepAction(creature: Creature, step: MultiattackStep, state: CombatState): ActionDefinition | undefined {
  const action = step.inlineAction ?? (step.actionId ? getAvailableActions(creature, state).find((candidate) => candidate.id === step.actionId) : undefined);
  if (!action) {
    return undefined;
  }

  if (!isAttackActionDefinition(action)) {
    return undefined;
  }

  return {
    ...action,
    actionCost: 'free',
    resourceCosts: []
  };
}

function getMultiattackStepTarget(action: ActionDefinition, step: MultiattackStep, selections: MultiattackTargetSelections): string | undefined {
  const targetMode = action.multiattack?.targetMode ?? 'sameTarget';
  if (targetMode === 'fixed') {
    return step.targetId ?? selections.stepTargets?.[step.id] ?? selections.targetId;
  }

  if (targetMode === 'chooseEach') {
    return selections.stepTargets?.[step.id] ?? selections.targetId;
  }

  return selections.stepTargets?.[step.id] ?? selections.targetId;
}

function getRulesKind(action: ActionDefinition) {
  return action.type ?? action.kind;
}

function isAttackActionDefinition(action: ActionDefinition): boolean {
  const rulesKind = getRulesKind(action);
  return rulesKind !== 'multiattack' && (rulesKind === 'meleeAttack' || rulesKind === 'rangedAttack' || action.tags.includes('attack'));
}

function spendAction(state: CombatState, creature: Creature): boolean {
  return spendActionCost(state, creature, 'action');
}

function usesDeferredActionCost(action: ActionDefinition): boolean {
  return action.actionCost === 'action' && (action.resourceCosts ?? []).some((cost) => cost.consumeOn === 'use' && cost.spendActionWhenDepleted);
}

function shouldSpendDeferredActionCost(consumptions: ResourceConsumption[]): boolean {
  return consumptions.some((consumption) => consumption.cost.spendActionWhenDepleted && consumption.after <= 0);
}

function getActionCostUnavailableReason(
  state: CombatState,
  creature: Creature,
  actionCost: ActionDefinition['actionCost']
): string | undefined {
  const resource = getResource(state, creature.id);

  if (actionCost === 'free') {
    return undefined;
  }

  if (actionCost === 'reaction') {
    if (resource.reactionUsed) {
      return `${creature.name} has already used their reaction.`;
    }

    if (!canCreatureTakeReaction(state, creature)) {
      return `${creature.name} cannot take reactions because of a condition.`;
    }

    return undefined;
  }

  if (!canCreatureTakeAction(state, creature)) {
    return `${creature.name} cannot take actions because of a condition.`;
  }

  if (actionCost === 'bonusAction') {
    return resource.bonusActionUsed ? `${creature.name} has already used their bonus action.` : undefined;
  }

  return resource.actionUsed ? `${creature.name} has already used their action this turn.` : undefined;
}

function spendActionCost(state: CombatState, creature: Creature, actionCost: ActionDefinition['actionCost']): boolean {
  const unavailableReason = getActionCostUnavailableReason(state, creature, actionCost);
  if (unavailableReason) {
    addLog(state, 'system', unavailableReason);
    return false;
  }

  const resource = getResource(state, creature.id);

  if (actionCost === 'free') {
    return true;
  }

  if (actionCost === 'reaction') {
    resource.reactionUsed = true;
    syncActiveTurnState(state);
    return true;
  }

  if (actionCost === 'bonusAction') {
    resource.bonusActionUsed = true;
    syncActiveTurnState(state);
    return true;
  }

  resource.actionUsed = true;
  syncActiveTurnState(state);
  return true;
}

function rollbackActionCost(state: CombatState, creature: Creature, actionCost: ActionDefinition['actionCost']): void {
  const resource = getResource(state, creature.id);
  if (actionCost === 'action') {
    resource.actionUsed = false;
  } else if (actionCost === 'bonusAction') {
    resource.bonusActionUsed = false;
  } else if (actionCost === 'reaction') {
    resource.reactionUsed = false;
  }
  syncActiveTurnState(state);
}

function spendActionResources(
  state: CombatState,
  creature: Creature,
  action: ActionDefinition,
  consumeOn: 'use' | 'hit' | 'failedSave' | 'manual' = 'use'
): { ok: boolean; consumptions: ResourceConsumption[] } {
  if (consumeOn === 'use' && !hasResourcesForAction(creature, action)) {
    addLog(state, 'system', `${creature.name} cannot use ${action.name}. ${getUnavailableActionReason(creature, action)}`);
    return { ok: false, consumptions: [] };
  }

  const consumptions = consumeActionResources(creature, action, consumeOn);
  consumptions.forEach((consumption) => {
    addLog(state, 'action', consumption.message);
    enqueueVisualEvent(state, {
      kind: 'resourceSpent',
      creatureId: creature.id,
      amount: consumption.cost.amount,
      resourceId: consumption.cost.resourceId,
      resourceName: consumption.resource.name,
      label: `-${consumption.cost.amount} ${consumption.resource.name}`
    });
  });
  return { ok: true, consumptions };
}

function performFeatureGeneratedBasicAction(state: CombatState, creature: Creature, action: ActionDefinition): boolean {
  if (!action.generatedByFeatureId) {
    return false;
  }

  if (!spendActionCost(state, creature, action.actionCost)) {
    return true;
  }

  if (!spendActionResources(state, creature, action).ok) {
    rollbackActionCost(state, creature, action.actionCost);
    return true;
  }
  runActionUsedRules(state, creature, action);

  if (action.baseActionName === 'Dash') {
    const resource = getResource(state, creature.id);
    resource.remainingMovement += getEffectiveSpeed(creature, state);
    resource.movementRemaining = resource.remainingMovement;
    syncActiveTurnState(state);
    addLog(state, 'action', `${creature.name} uses ${action.name} and gains ${getEffectiveSpeed(creature, state)} feet of movement.`);
    return true;
  }

  if (action.baseActionName === 'Disengage') {
    const condition = createAppliedCondition('disengaged', {
      sourceCreatureId: creature.id,
      durationType: 'untilEndOfTargetTurn'
    });
    const result = applyConditionToCreature(creature, condition);
    addLog(state, 'action', `${creature.name} uses ${action.name}.`);
    logConditionChange(state, creature, condition, result);
    return true;
  }

  if (action.baseActionName === 'Hide') {
    const check = rollAbilityCheck(state, creature, 'dex', 'stealth', Math.random);
    const condition = createAppliedCondition('hidden', {
      sourceCreatureId: creature.id,
      metadata: { stealthTotal: check.total }
    });
    const result = applyConditionToCreature(creature, condition);
    addLog(state, 'action', `${creature.name} uses ${action.name}: Stealth ${check.rollText} = ${check.total}.`);
    logConditionChange(state, creature, condition, result);
    consumeHelpedAbilityCheck(state, creature);
    return true;
  }

  addLog(state, 'action', `${creature.name} uses ${action.name}. ${action.description ?? ''}`);
  return true;
}

function rollAbilityCheck(
  state: CombatState,
  creature: Creature,
  ability: Ability,
  skill: Skill | undefined,
  random: RandomSource
) {
  const conditionModifier = mergeRollModifiers(
    collectAbilityCheckModifiers(state, creature, ability),
    getFrightenedRollModifier(state, creature)
  );
  const rollMode = resolveRollMode(conditionModifier);
  const first = rollDice('1d20', random);
  const second = rollMode === 'normal' ? undefined : rollDice('1d20', random);
  const d20 = chooseD20(first.total, second?.total, rollMode);
  const modifier = skill ? getSkillModifier(creature, skill, ability) : abilityModifier(creature.abilityScores[ability]);
  const flatModifier = conditionModifier.flatModifier ?? 0;
  const total = conditionModifier.autoFail
    ? Number.NEGATIVE_INFINITY
    : conditionModifier.autoSuccess
      ? Number.POSITIVE_INFINITY
      : d20 + modifier + flatModifier;

  return {
    total,
    rollText: `${formatD20Roll(first.total, second?.total, rollMode)} + ${modifier}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''}`
  };
}

function getSkillModifier(creature: Creature, skill: Skill, fallbackAbility: Ability): number {
  return creature.skillBonuses?.[skill] ?? abilityModifier(creature.abilityScores[fallbackAbility]);
}

function isWithinMelee(attacker: Creature, target: Creature): boolean {
  return getDistanceFeet(attacker.position, target.position) <= 5;
}

function getPushDestination(from: GridPosition, target: GridPosition): GridPosition {
  const dx = Math.sign(target.x - from.x);
  const dy = Math.sign(target.y - from.y);
  return {
    x: target.x + dx,
    y: target.y + dy
  };
}

function consumeHelpAfterAttack(state: CombatState, attacker: Creature, target: Creature): void {
  if (removeConditionFromCreature(attacker, 'helped')) {
    addLog(state, 'condition', `Help advantage consumed by ${attacker.name}.`);
  }

  const helpedTarget = target.conditions.find((condition) => condition.id === 'helpedTarget');
  if (!helpedTarget?.sourceCreatureId) {
    return;
  }

  const helper = state.creatures.find((creature) => creature.id === helpedTarget.sourceCreatureId);
  if (helper && areAllies(helper, attacker, state) && helper.id !== attacker.id && removeConditionFromCreature(target, 'helpedTarget')) {
    addLog(state, 'condition', `Help against ${target.name} consumed.`);
  }
}

function consumeHelpedAbilityCheck(state: CombatState, creature: Creature): void {
  if (removeConditionFromCreature(creature, 'helped')) {
    addLog(state, 'condition', `Help advantage consumed by ${creature.name}.`);
  }
}

function findNextLivingInitiativeIndex(state: CombatState): number {
  for (let step = 1; step <= state.initiative.length; step += 1) {
    const index = (state.turnIndex + step) % state.initiative.length;
    const entry = state.initiative[index];
    const creature = findCreature(state, entry.creatureId);
    if (!isDefeated(creature)) {
      return index;
    }
  }

  return -1;
}

function createTurnState(creature?: Creature, state?: CombatState) {
  const movement = creature
    ? state
      ? getEffectiveMovementSpeed(creature, state)
      : Math.max(0, creature.speed + (getFeatureStatModifiers(creature).speed ?? 0), creature.climbSpeed ?? 0, creature.flySpeed ?? 0)
    : 0;
  return {
    creatureId: creature?.id,
    remainingMovement: movement,
    movementRemaining: movement,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false
  };
}

function ensureTurnState(state: CombatState): CombatState {
  if (hasCompleteTurnResources(state)) {
    incrementPerformanceCounter('engine.state.ensure-turn-fast-path');
    if (!state.turnState) {
      const creature = state.activeCreatureId ? findCreature(state, state.activeCreatureId) : undefined;
      state.turnState = createTurnState(creature, state);
    }
    if (state.activeCreatureId) {
      syncActiveTurnState(state);
    }
    return state;
  }

  incrementPerformanceCounter('engine.state.ensure-turn-full');
  state.turnResources = state.turnResources ?? {};
  state.creatures.forEach((creature) => {
    const existing = state.turnResources[creature.id];
    state.turnResources[creature.id] = {
      ...createTurnState(creature, state),
      ...existing,
      movementRemaining: existing?.movementRemaining ?? existing?.remainingMovement ?? creature.speed,
      remainingMovement: existing?.remainingMovement ?? existing?.movementRemaining ?? creature.speed,
      bonusActionUsed: existing?.bonusActionUsed ?? false,
      reactionUsed: existing?.reactionUsed ?? false
    };
  });

  if (!state.turnState) {
    const creature = state.activeCreatureId ? findCreature(state, state.activeCreatureId) : undefined;
    state.turnState = createTurnState(creature, state);
  }

  if (state.activeCreatureId && state.turnState.creatureId !== state.activeCreatureId) {
    state.turnState = getResource(state, state.activeCreatureId);
  }

  return state;
}

function hasCompleteTurnResources(state: CombatState): boolean {
  if (!state.turnResources) {
    return false;
  }

  return state.creatures.every((creature) => {
    const resource = state.turnResources[creature.id];
    return Boolean(
      resource &&
      typeof resource.creatureId === 'string' &&
      typeof resource.remainingMovement === 'number' &&
      typeof resource.movementRemaining === 'number' &&
      typeof resource.actionUsed === 'boolean' &&
      typeof resource.bonusActionUsed === 'boolean' &&
      typeof resource.reactionUsed === 'boolean'
    );
  });
}

function getResource(state: CombatState, creatureId: string) {
  const creature = findCreature(state, creatureId);
  state.turnResources = state.turnResources ?? {};
  state.turnResources[creatureId] = state.turnResources[creatureId] ?? createTurnState(creature, state);
  return state.turnResources[creatureId];
}

function syncActiveTurnState(state: CombatState): void {
  if (state.activeCreatureId) {
    state.turnState = getResource(state, state.activeCreatureId);
  }
}

export function getOpportunityAttackCandidatesForMovementPath(
  state: CombatState,
  mover: Creature,
  path: GridPosition[],
  query?: CombatQueryContext,
  lookup?: OpportunityAttackPathLookup
): OpportunityAttackPathCandidate[] {
  const context = isCombatQueryContextCurrent(query, state) ? query : undefined;
  const pathLookup = lookup?.state === state && lookup.moverId === mover.id ? lookup : undefined;
  if (hasCondition(mover, 'disengaged', context?.conditions)) {
    return [];
  }

  const candidates: OpportunityAttackPathCandidate[] = [];
  const triggeredCreatureIds = new Set<string>();

  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const segmentKey = `${position3DKey(from)}>${position3DKey(to)}`;
    let segmentCandidates = pathLookup?.candidatesBySegment.get(segmentKey);
    if (segmentCandidates) {
      incrementPerformanceCounter('engine.movement.oa-segment-cache-hits');
    } else {
      segmentCandidates = getOpportunityAttackCandidates(state, mover, from, to, context);
      pathLookup?.candidatesBySegment.set(segmentKey, segmentCandidates);
      incrementPerformanceCounter('engine.movement.oa-segment-cache-misses');
    }
    segmentCandidates.forEach((creature) => {
      if (triggeredCreatureIds.has(creature.id)) {
        return;
      }

      triggeredCreatureIds.add(creature.id);
      candidates.push({ creature, from, to });
    });
  }

  return candidates;
}

export function createOpportunityAttackPathLookup(
  state: CombatState,
  mover: Creature
): OpportunityAttackPathLookup {
  return {
    state,
    moverId: mover.id,
    candidatesBySegment: new Map()
  };
}

function findOpportunityAttackAction(creature: Creature): ActionDefinition | undefined {
  return (
    creature.actions.find((action) => action.tags.includes('opportunity')) ??
    creature.actions.find((action) => action.tags.includes('melee') || action.type === 'meleeAttack' || action.kind === 'meleeAttack')
  );
}

function formatD20Roll(first: number, second?: number, mode: 'normal' | 'advantage' | 'disadvantage' = 'normal'): string {
  if (second === undefined) {
    return `d20 ${first}`;
  }

  const kept = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
  return `d20 ${first}/${second} ${mode}, kept ${kept}`;
}

function formatRollReasons(notes: string[] | undefined): string {
  return notes && notes.length > 0 ? ` (${notes.join(', ')})` : '';
}

function getAttackRollResult(d20: number, attackBonus: number, targetAc: number): { total: number; hit: boolean; critical: boolean } {
  const total = d20 + attackBonus;
  const critical = d20 === 20;
  const naturalMiss = d20 === 1;
  return {
    total,
    critical,
    hit: naturalMiss ? false : critical ? true : total >= targetAc
  };
}

function chooseD20(first: number, second: number | undefined, mode: 'normal' | 'advantage' | 'disadvantage'): number {
  if (second === undefined || mode === 'normal') {
    return first;
  }

  return mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
}

function formatSigned(value: number): string {
  return value >= 0 ? `+ ${value}` : `- ${Math.abs(value)}`;
}

function formatPosition(position: GridPosition): string {
  return `${position.x},${position.y},${position.z ?? 0}`;
}

function normalizeState(state: CombatState): CombatState {
  return measurePerformance('engine.state.normalize', () => {
    if (normalizedCombatStates.has(state)) {
      incrementPerformanceCounter('engine.state.normalize-fast-path');
      restoreNormalizedActionShape(state.creatures);
      if (state.visualEvents) {
        state.visualEvents = pruneVisualEvents(state.visualEvents);
      }
      syncActiveTurnState(state);
      return state;
    }

    incrementPerformanceCounter('engine.state.normalize-full');
    const normalized = normalizeStateInternal(state);
    normalizedCombatStates.add(normalized);
    return normalized;
  });
}

function restoreNormalizedActionShape(creatures: Creature[]): void {
  creatures.forEach((creature) => {
    creature.actions.forEach((action) => {
      if (!Object.prototype.hasOwnProperty.call(action, 'type')) {
        action.type = action.kind === 'multiattack' || action.kind === 'basicAction'
          ? undefined
          : isRulesActionKind(action.kind)
            ? action.kind
            : undefined;
      }
    });
  });
}

function normalizeStateInternal(state: CombatState): CombatState {
  state.grid = {
    ...state.grid,
    blocked: state.grid.blocked ?? [],
    heights: state.grid.heights ?? []
  };
  state.creatures = normalizeCreatures(state.creatures, state.grid);
  state.teams = normalizeTeamDefinitions(state.teams, state.creatures);
  state.turnResources = state.turnResources ?? {};
  state.creatures.forEach((creature) => {
    const existing = state.turnResources[creature.id];
    state.turnResources[creature.id] = {
      ...createTurnState(creature, state),
      ...existing,
      remainingMovement: existing?.remainingMovement ?? existing?.movementRemaining ?? state.turnState?.remainingMovement ?? creature.speed,
      movementRemaining: existing?.movementRemaining ?? existing?.remainingMovement ?? state.turnState?.remainingMovement ?? creature.speed,
      actionUsed: existing?.actionUsed ?? (state.turnState?.creatureId === creature.id ? state.turnState.actionUsed : false),
      bonusActionUsed: existing?.bonusActionUsed ?? false,
      reactionUsed: existing?.reactionUsed ?? false
    };
  });
  state.pendingReactions = state.pendingReactions ?? [];
  state.rulesSettings = normalizeRulesSettings(state.rulesSettings);
  state.ruleMemory = state.ruleMemory ?? {};
  state.botMemory = normalizeBotMemory(state);
  if (state.visualEvents) {
    state.visualEvents = pruneVisualEvents(state.visualEvents);
  }
  if (!state.turnState) {
    state.turnState = createTurnState(state.activeCreatureId ? findCreature(state, state.activeCreatureId) : undefined, state);
  }
  syncActiveTurnState(state);

  return state;
}

function normalizeCreatures(creatures: Creature[], grid?: CombatState['grid']): Creature[] {
  return creatures.map((creature) => ({
    ...creature,
    team: normalizeTeamId(creature.team),
    controlMode: creature.controlMode === 'bot' ? 'bot' : 'manual',
    botProfile: normalizeBotProfile(creature.botProfile),
    botTargetPriority: normalizeBotTargetPriority(creature.botTargetPriority),
    botResourceStrategy: normalizeBotResourceStrategy(creature.botResourceStrategy),
    position: grid ? clampGridPosition(getTilePosition(creature.position, grid), grid) : { ...creature.position, z: creature.position.z ?? 0 },
    conditions: normalizeConditions(creature.conditions),
    skillBonuses: creature.skillBonuses ?? {},
    actions: creature.actions.map(normalizeActionDefinition)
  }));
}

function normalizeBotProfile(profile: Creature['botProfile']): BotProfile {
  return profile === 'aggressiveMelee' || profile === 'rangedAttacker' || profile === 'cowardly' || profile === 'support' || profile === 'passive'
    ? profile
    : 'passive';
}

function normalizeBotTargetPriority(priority: Creature['botTargetPriority']): BotTargetPriority {
  return priority === 'nearest' || priority === 'weakest' || priority === 'lowestHp' || priority === 'easiestToHit' || priority === 'balanced'
    ? priority
    : 'balanced';
}

function normalizeBotResourceStrategy(strategy: Creature['botResourceStrategy']): BotResourceStrategy {
  return strategy === 'conserve' || strategy === 'spendFreely' || strategy === 'normal' ? strategy : 'normal';
}

function normalizeBotMemory(state: CombatState): NonNullable<CombatState['botMemory']> {
  const creatureIds = new Set(state.creatures.map((creature) => creature.id));
  return Object.fromEntries(
    Object.entries(state.botMemory ?? {})
      .filter(([creatureId]) => creatureIds.has(creatureId))
      .map(([creatureId, memory]) => [creatureId, normalizeBotMemoryEntry(memory, creatureIds)])
  );
}

function normalizeBotMemoryEntry(memory: NonNullable<CombatState['botMemory']>[string], creatureIds: Set<string>) {
  const normalized: NonNullable<CombatState['botMemory']>[string] = {};
  if (memory.lastTargetId && creatureIds.has(memory.lastTargetId)) {
    normalized.lastTargetId = memory.lastTargetId;
    if (typeof memory.lastTargetRound === 'number') {
      normalized.lastTargetRound = memory.lastTargetRound;
    }
  }
  if (memory.lastAttackerId && creatureIds.has(memory.lastAttackerId)) {
    normalized.lastAttackerId = memory.lastAttackerId;
    if (typeof memory.lastAttackedRound === 'number') {
      normalized.lastAttackedRound = memory.lastAttackedRound;
    }
  }
  if (memory.lastDamagedById && creatureIds.has(memory.lastDamagedById)) {
    normalized.lastDamagedById = memory.lastDamagedById;
    if (typeof memory.lastDamagedRound === 'number') {
      normalized.lastDamagedRound = memory.lastDamagedRound;
    }
  }
  return normalized;
}

function normalizeRulesSettings(settings: CombatRulesSettings | undefined): CombatRulesSettings {
  return {
    ...cloneJson(DEFAULT_RULES_SETTINGS),
    ...(settings ?? {}),
    flanking: {
      ...DEFAULT_RULES_SETTINGS.flanking!,
      ...(settings?.flanking ?? {})
    }
  };
}

function getVisualColorForAction(action: ActionDefinition, effect?: EffectDefinition): string {
  const explicitColor = action.visual?.color ?? effect?.visual?.color;
  if (explicitColor) {
    return explicitColor;
  }

  const damageType = action.damage?.type ?? effect?.damage?.type;
  if (damageType) {
    return getVisualColorForDamageType(damageType);
  }

  const tagColor = action.tags.map(getVisualColorForDamageType).find((color) => color !== DEFAULT_VISUAL_EFFECT_COLOR);
  return tagColor ?? DEFAULT_VISUAL_EFFECT_COLOR;
}

const DEFAULT_VISUAL_EFFECT_COLOR = '#7ca7e4';

function getVisualColorForDamageType(type: string): string {
  switch (type.toLowerCase()) {
    case 'acid':
    case 'poison':
      return '#45b36b';
    case 'cold':
    case 'ice':
      return '#73d2ff';
    case 'fire':
      return '#ff7a1a';
    case 'force':
      return '#9b7cff';
    case 'lightning':
    case 'thunder':
      return '#f6d84a';
    case 'necrotic':
      return '#7f4aa3';
    case 'psychic':
      return '#d65ad1';
    case 'radiant':
      return '#ffe58a';
    case 'healing':
      return '#37b26c';
    default:
      return DEFAULT_VISUAL_EFFECT_COLOR;
  }
}

function normalizeActionDefinition(action: ActionDefinition): ActionDefinition {
  const kind = action.kind ?? action.type ?? 'custom';
  const type = kind === 'multiattack' || kind === 'basicAction' ? undefined : action.type ?? (isRulesActionKind(kind) ? kind : undefined);
  return {
    ...action,
    kind,
    type,
    actionCost: action.actionCost ?? 'action',
    tags: action.tags ?? [],
    effects: action.effects ?? []
  };
}

function isRulesActionKind(kind: ActionDefinition['kind']): kind is NonNullable<ActionDefinition['type']> {
  return kind === 'meleeAttack' || kind === 'rangedAttack' || kind === 'savingThrowEffect';
}

function logConditionChange(
  state: CombatState,
  creature: Creature,
  condition: AppliedCondition,
  result: 'applied' | 'refreshed' | 'stacked'
): void {
  const label = getConditionLabel(condition);
  const verb = result === 'applied' ? 'applied to' : result === 'refreshed' ? 'refreshed on' : 'stacked on';
  addLog(state, 'condition', `${label} ${verb} ${creature.name}.`);
  enqueueVisualEvent(state, {
    kind: 'conditionApplied',
    creatureId: creature.id,
    sourceCreatureId: condition.sourceCreatureId,
    conditionId: condition.id,
    conditionName: label,
    label
  });
  runConditionAppliedRules(
    state,
    creature,
    condition,
    condition.sourceCreatureId ? state.creatures.find((source) => source.id === condition.sourceCreatureId) : undefined
  );
}

function stampConditionApplicationTiming(state: CombatState, condition: AppliedCondition): void {
  if (condition.durationType !== 'rounds') {
    return;
  }

  condition.metadata = {
    ...condition.metadata,
    appliedRound: state.round,
    appliedTurnIndex: state.turnIndex
  };
}

function logExpiredConditions(state: CombatState, conditions: AppliedCondition[]): void {
  conditions.forEach((condition) => {
    addLog(state, 'condition', `${getConditionLabel(condition)} expired.`);
  });
}

function emitConditionRemoved(state: CombatState, creature: Creature, condition: AppliedCondition): void {
  const label = getConditionLabel(condition);
  enqueueVisualEvent(state, {
    kind: 'conditionRemoved',
    creatureId: creature.id,
    sourceCreatureId: condition.sourceCreatureId,
    conditionId: condition.id,
    conditionName: label,
    label
  });
}

function addLog(state: CombatState, type: CombatLogEntry['type'], message: string): void {
  state.log.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    round: state.round,
    turn: state.turnIndex,
    type,
    message,
    timestamp: new Date().toISOString()
  });
}

function cloneState(state: CombatState): CombatState {
  const cloned = measurePerformance(
    'engine.state.clone',
    () => cloneJsonValue(state)
  );
  if (normalizedCombatStates.has(state)) {
    normalizedCombatStates.add(cloned);
  }
  return cloned;
}

function cloneJson<T>(value: T): T {
  return cloneJsonValue(value);
}
