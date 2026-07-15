import { abilityModifier, rollDamageDice, rollDice, type RandomSource } from './dice';
import type {
  ActionDefinition,
  CardinalDirection,
  CombatHooks,
  CombatLogEntry,
  CombatState,
  Creature,
  GridPosition,
  AppliedCondition,
  ConditionDurationType,
  StackBehavior,
  Ability,
  Skill,
  RollMode,
  RollModifier,
  MultiattackStep,
  CombatRulesSettings
} from './types';
import { getElevation, getShapeSquares, getTilePosition, isBlocked, isInBounds, samePosition } from './shapes';
import { getMovementOption, getMovementOptionForPath, isOccupied } from './movement';
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
  runTurnRules
} from './rules';

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

export const DEFAULT_RULES_SETTINGS: CombatRulesSettings = {
  flanking: { enabled: false, benefit: 'advantage' }
};

export function createCombatState(
  creatures: Creature[],
  width = 10,
  height = 10,
  blocked: GridPosition[] = [],
  heights: GridPosition[] = []
): CombatState {
  const grid = normalizeGridDefinition({ width, height, blocked, heights });
  const normalizedCreatures = normalizeCreatures(creatures, grid);
  return {
    creatures: normalizedCreatures,
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
  hooks.onTurnEnd?.(next, endingCreature);
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
  hooks.onTurnStart?.(next, activeCreature);
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
  const target = findCreature(next, pending.targetId);
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
  addLog(next, 'action', `${reactor.name} uses a reaction for ${action.name} against ${target.name}.`);

  next.activeCreatureId = reactor.id;
  next.turnState = getResource(next, reactor.id);
  const resolved = performAttackAction(next, action.id, target.id, random, {}, { targetPositionOverride: pending.from });
  findCreature(resolved, reactor.id).actions.find((candidate) => candidate.id === action.id)!.actionCost = originalCost;
  resolved.activeCreatureId = originalActiveId;
  syncActiveTurnState(resolved);
  return resolved;
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
    target.hp = Math.min(target.maxHp, target.hp + delta);
    if (target.hp > 0) {
      removeConditionFromCreature(target, 'defeated');
    }
    addLog(next, 'damage', `${target.name} heals ${delta} HP.`);
    return next;
  }

  target.hp = Math.max(0, target.hp - delta);
  addLog(next, 'damage', `${target.name} takes ${delta} manual damage.`);
  if (target.hp === 0 && !hasCondition(target, 'defeated')) {
    applyConditionToCreature(target, createAppliedCondition('defeated'));
    addLog(next, 'defeat', `${target.name} is defeated.`);
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

  hooks.beforeAttackRoll?.(next, { attacker, target, action });
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

  hooks.afterAttackRoll?.(next, { attacker, target, action, attackTotal });
  runAfterAttackRollRules(next, { attacker, target, action, attackTotal, hit, critical });
  addLog(
    next,
    'attack',
    `${attacker.name} ${action.tags.includes('spell') || action.kind === 'spell' ? 'casts' : 'uses'} ${action.name} on ${target.name}: ${formatD20Roll(firstD20.total, secondD20?.total, rollMode)}${formatRollReasons(attackModifier.notes)} + ${attackBonus}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''} = ${attackTotal} vs AC ${targetAc}. ${critical ? 'Critical hit.' : hit ? 'Hit.' : naturalMiss ? 'Natural 1 miss.' : 'Miss.'}`
  );
  consumeHelpAfterAttack(next, attacker, target);

  if (hit && action.damage) {
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

  resolveSavingThrowDamageAction(next, source.id, action, validTargets.map((target) => target.id), random, hooks);

  return next;
}

export function getTargetsInShape(
  state: CombatState,
  actionId: string,
  origin: GridPosition,
  direction?: CardinalDirection
): Creature[] {
  const source = getActiveCreature(state);
  const action = findAction(source, actionId, state);
  return getTargetsInActionShape(state, action, source, origin, direction);
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
  direction?: CardinalDirection
): GridPosition[] {
  return getShapeSquares(action.shape ?? { type: 'single' }, origin, state.grid, direction);
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
  direction?: CardinalDirection
): Creature[] {
  return state.creatures.filter(
    (creature) =>
      creature.id !== source.id &&
      !isDefeated(creature) &&
      isPositionInActionShape(state, action, origin, creature.position, direction)
  );
}

function isPositionInActionShape(
  state: CombatState,
  action: ActionDefinition,
  origin: GridPosition,
  position: GridPosition,
  direction?: CardinalDirection
): boolean {
  const shape = action.shape ?? { type: 'single' as const };
  const normalizedOrigin = getTilePosition(origin, state.grid);
  const normalizedPosition = getTilePosition(position, state.grid);

  if (shape.type === 'radius') {
    const radius = shape.radius ?? 1;
    const dx = normalizedPosition.x - normalizedOrigin.x;
    const dy = normalizedPosition.y - normalizedOrigin.y;
    const dz = getElevation(normalizedPosition) - getElevation(normalizedOrigin);
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  return getActionShapeSquares(state, action, normalizedOrigin, direction).some((square) => samePosition(square, normalizedPosition));
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
      ally.team !== attacker.team ||
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
  modifiedAmount = Math.max(0, applyBeforeDamageRules(state, { source, target, action, amount: modifiedAmount, random }));
  hooks.beforeDamage?.(state, { source, target, action, amount: modifiedAmount });

  target.hp = Math.max(0, target.hp - modifiedAmount);

  runAfterDamageHooks(state, source, target, action, modifiedAmount);
  runAfterDamageRules(state, { source, target, action, amount: modifiedAmount });
  hooks.afterDamage?.(state, { source, target, action, amount: modifiedAmount });
  resolveConcentrationAfterDamage(state, source, target, action, modifiedAmount, random);
  if (target.hp === 0 && !hasCondition(target, 'defeated')) {
    applyConditionToCreature(target, createAppliedCondition('defeated'));
    hooks.onCreatureDefeated?.(state, target);
    addLog(state, 'defeat', `${target.name} is defeated.`);
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

  if (!success && removeConditionFromCreature(target, 'concentrating')) {
    addLog(state, 'condition', `${target.name} loses concentration on ${action.name}.`);
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
    const success = saveRollModifier.autoFail ? false : saveRollModifier.autoSuccess ? true : saveTotal >= save.dc;
    if (!success) {
      spendActionResources(state, source, action, 'failedSave');
    }
    const damageRoll = rollDice(damageDefinition.dice, random);
    const amount = success && save.halfDamageOnSuccess ? Math.floor(damageRoll.total / 2) : damageRoll.total;

    addLog(
      state,
      'save',
      `${target.name} rolls ${save.ability.toUpperCase()} save against ${action.name}: ${formatD20Roll(firstSaveRoll.total, secondSaveRoll?.total, rollMode)}${formatRollReasons(saveRollModifier.notes)} + ${saveModifier}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''} = ${saveTotal} vs DC ${save.dc}. ${success ? 'Success.' : 'Failure.'}`
    );
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
  consumptions.forEach((consumption) => addLog(state, 'action', consumption.message));
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
  if (helper && helper.team === attacker.team && helper.id !== attacker.id && removeConditionFromCreature(target, 'helpedTarget')) {
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
  path: GridPosition[]
): OpportunityAttackPathCandidate[] {
  if (hasCondition(mover, 'disengaged')) {
    return [];
  }

  const candidates: OpportunityAttackPathCandidate[] = [];
  const triggeredCreatureIds = new Set<string>();

  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    getOpportunityAttackCandidates(state, mover, from, to).forEach((creature) => {
      if (triggeredCreatureIds.has(creature.id)) {
        return;
      }

      triggeredCreatureIds.add(creature.id);
      candidates.push({ creature, from, to });
    });
  }

  return candidates;
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
  state.grid = {
    ...state.grid,
    blocked: state.grid.blocked ?? [],
    heights: state.grid.heights ?? []
  };
  state.creatures = normalizeCreatures(state.creatures, state.grid);
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
  if (!state.turnState) {
    state.turnState = createTurnState(state.activeCreatureId ? findCreature(state, state.activeCreatureId) : undefined, state);
  }
  syncActiveTurnState(state);

  return state;
}

function normalizeCreatures(creatures: Creature[], grid?: CombatState['grid']): Creature[] {
  return creatures.map((creature) => ({
    ...creature,
    position: grid ? clampGridPosition(getTilePosition(creature.position, grid), grid) : { ...creature.position, z: creature.position.z ?? 0 },
    conditions: normalizeConditions(creature.conditions),
    skillBonuses: creature.skillBonuses ?? {},
    actions: creature.actions.map(normalizeActionDefinition)
  }));
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
  return JSON.parse(JSON.stringify(state)) as CombatState;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
