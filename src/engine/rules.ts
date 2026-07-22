import { rollDamageDice, rollDice, type RandomSource } from './dice';
import {
  applyBeforeDamageModifiers,
  applyConditionToCreature,
  canCreatureTakeReaction,
  collectSavingThrowModifiers,
  createAppliedCondition,
  getConditionDefinition,
  hasCondition,
  mergeRollModifiers,
  removeConditionFromCreature,
  resolveRollMode,
  runAfterDamageHooks
} from './conditions';
import { applyDamageTraits, damageTypeMatches, getActionDamageType, getNativeDamageTraits } from './damage';
import { getAvailableActions, getEffectiveSaveBonus, getEnabledFeatures, getResource } from './features';
import { isOccupied } from './movement';
import { getTilePosition, isBlocked, isInBounds } from './shapes';
import { getDistanceFeet } from './targeting';
import { areAllies, areHostile } from './teams';
import { enqueueVisualEvent } from './visualEvents';
import type {
  Ability,
  ActionDefinition,
  AppliedCondition,
  CombatLogEntry,
  CombatState,
  Creature,
  GridPosition,
  PendingReaction,
  ReactionTriggerDefinition,
  RollModifier,
  RuleDefinition,
  RuleEffectOperation,
  RuleFilter,
  RuleTargetSelector,
  RuleTriggerPoint
} from './types';

interface RuleSource {
  owner: Creature;
  rule: RuleDefinition;
  label: string;
}

interface RuleEventContext {
  trigger: RuleTriggerPoint;
  source?: Creature;
  actionTarget?: Creature;
  action?: ActionDefinition;
  areaTargets?: Creature[];
  condition?: AppliedCondition;
  rollCreature?: Creature;
  damageTarget?: Creature;
  savingThrowAbility?: Ability;
  hit?: boolean;
  critical?: boolean;
  success?: boolean;
  random?: RandomSource;
  damageType?: string;
  damageAmount?: number;
}

export interface AttackRollRuleContext {
  attacker: Creature;
  target: Creature;
  action: ActionDefinition;
}

export interface AttackRollResultRuleContext extends AttackRollRuleContext {
  attackTotal: number;
  hit: boolean;
  critical: boolean;
}

export interface DamageRuleContext {
  source: Creature;
  target: Creature;
  action: ActionDefinition;
  amount: number;
  damageType?: string;
  random: RandomSource;
}

export interface SavingThrowRuleContext {
  source: Creature;
  target: Creature;
  action: ActionDefinition;
  ability: Ability;
}

export interface SavingThrowResultRuleContext extends SavingThrowRuleContext {
  total: number;
  success: boolean;
}

export function collectBeforeAttackRollRuleModifiers(
  state: CombatState,
  context: AttackRollRuleContext
): RollModifier {
  return runRollModifierRules(state, {
    trigger: 'beforeAttackRoll',
    source: context.attacker,
    actionTarget: context.target,
    action: context.action,
    rollCreature: context.attacker
  });
}

export function runAfterAttackRollRules(state: CombatState, context: AttackRollResultRuleContext): void {
  runRules(state, {
    trigger: 'afterAttackRoll',
    source: context.attacker,
    actionTarget: context.target,
    action: context.action,
    rollCreature: context.attacker,
    hit: context.hit,
    critical: context.critical
  });
}

export function applyBeforeDamageRules(state: CombatState, context: DamageRuleContext): number {
  return runDamageRules(state, {
    trigger: 'beforeDamage',
    source: context.source,
    actionTarget: context.target,
    damageTarget: context.target,
    action: context.action,
    damageType: context.damageType ?? getActionDamageType(context.action),
    damageAmount: context.amount,
    random: context.random
  }, context.amount);
}

export function runAfterDamageRules(state: CombatState, context: Omit<DamageRuleContext, 'random'>): void {
  runRules(state, {
    trigger: 'afterDamage',
    source: context.source,
    actionTarget: context.target,
    damageTarget: context.target,
    action: context.action,
    damageType: context.damageType ?? getActionDamageType(context.action),
    damageAmount: context.amount
  });
}

export function collectBeforeSavingThrowRuleModifiers(
  state: CombatState,
  context: SavingThrowRuleContext
): RollModifier {
  return runRollModifierRules(state, {
    trigger: 'beforeSavingThrow',
    source: context.source,
    actionTarget: context.target,
    action: context.action,
    rollCreature: context.target,
    savingThrowAbility: context.ability
  });
}

export function runAfterSavingThrowRules(state: CombatState, context: SavingThrowResultRuleContext): void {
  runRules(state, {
    trigger: 'afterSavingThrow',
    source: context.source,
    actionTarget: context.target,
    action: context.action,
    rollCreature: context.target,
    savingThrowAbility: context.ability,
    success: context.success
  });
}

export function runActionUsedRules(
  state: CombatState,
  source: Creature,
  action: ActionDefinition,
  targets: Creature[] = []
): void {
  runRules(state, {
    trigger: 'onActionUsed',
    source,
    actionTarget: targets[0],
    areaTargets: targets,
    action
  });
}

export function runTurnRules(state: CombatState, creature: Creature, trigger: 'onTurnStart' | 'onTurnEnd'): void {
  runRules(state, { trigger, source: creature, actionTarget: creature });
}

export function runConditionAppliedRules(
  state: CombatState,
  target: Creature,
  condition: AppliedCondition,
  source?: Creature
): void {
  runRules(state, {
    trigger: 'onConditionApplied',
    source,
    actionTarget: target,
    condition
  });
}

export function runDefeatedRules(
  state: CombatState,
  defeated: Creature,
  defeatedBy?: Creature,
  action?: ActionDefinition,
  random?: RandomSource
): void {
  runRules(state, {
    trigger: 'onDefeated',
    source: defeated,
    actionTarget: defeated,
    action,
    rollCreature: defeatedBy,
    random
  });
}

function runRollModifierRules(state: CombatState, event: RuleEventContext): RollModifier {
  let modifier: RollModifier = {};

  getTriggeredRules(state, event).forEach((entry) => {
    const selected = resolveTargetsForRule(state, entry, event);
    const rollCreature = event.rollCreature;
    if (!rollCreature || !selected.some((creature) => creature.id === rollCreature.id) || !passesFilters(state, entry, event)) {
      return;
    }

    let used = false;
    entry.rule.effects.forEach((effect) => {
      if (effect.type === 'addFlatModifier') {
        modifier = mergeRollModifiers(modifier, {
          flatModifier: effect.amount,
          notes: [effect.note ?? entry.rule.name ?? entry.label]
        });
        used = true;
      } else if (effect.type === 'grantAdvantage') {
        modifier = mergeRollModifiers(modifier, {
          advantage: true,
          notes: [effect.note ?? entry.rule.name ?? entry.label]
        });
        used = true;
      } else if (effect.type === 'grantDisadvantage') {
        modifier = mergeRollModifiers(modifier, {
          disadvantage: true,
          notes: [effect.note ?? entry.rule.name ?? entry.label]
        });
        used = true;
      }
    });

    if (used) {
      markLimitedRuleUsed(state, entry, event);
    }
  });

  return modifier;
}

function runDamageRules(state: CombatState, event: RuleEventContext, baseAmount: number): number {
  let amount = baseAmount;
  const damageType = event.damageType ?? (event.action ? getActionDamageType(event.action) : undefined);
  const nativeTraits = event.damageTarget
    ? getNativeDamageTraits(event.damageTarget, damageType)
    : { resistant: false, immune: false, vulnerable: false };
  const traits = { ...nativeTraits };

  getTriggeredRules(state, event).forEach((entry) => {
    const selected = resolveTargetsForRule(state, entry, event);
    const sourceSelected = event.source ? selected.some((creature) => creature.id === event.source?.id) : false;
    const targetSelected = event.damageTarget ? selected.some((creature) => creature.id === event.damageTarget?.id) : false;
    if (!passesFilters(state, entry, event)) {
      return;
    }

    let used = false;
    entry.rule.effects.forEach((effect) => {
      if (effect.type === 'addDamageDice' && sourceSelected) {
        const roll = rollDamageDice(effect.dice, event.random ?? Math.random);
        amount += roll.total;
        used = true;
      } else if (effect.type === 'multiplyDamage' && targetSelected) {
        amount = Math.floor(amount * effect.factor);
        used = true;
      } else if (effect.type === 'reduceDamage' && targetSelected) {
        amount = Math.max(0, amount - effect.amount);
        used = true;
      } else if (effect.type === 'setDamageMinimum' && sourceSelected) {
        amount = Math.max(amount, effect.amount);
        used = true;
      } else if (effect.type === 'grantDamageResistance' && targetSelected && damageTypeMatches(effect.damageType, damageType)) {
        traits.resistant = true;
        used = true;
      } else if (effect.type === 'grantDamageImmunity' && targetSelected && damageTypeMatches(effect.damageType, damageType)) {
        traits.immune = true;
        used = true;
      } else if (effect.type === 'grantDamageVulnerability' && targetSelected && damageTypeMatches(effect.damageType, damageType)) {
        traits.vulnerable = true;
        used = true;
      }
    });

    if (used) {
      markLimitedRuleUsed(state, entry, event);
    }
  });

  return applyDamageTraits(amount, traits);
}

function runRules(state: CombatState, event: RuleEventContext): void {
  getTriggeredRules(state, event).forEach((entry) => {
    const selected = resolveTargetsForRule(state, entry, event);
    if (!passesFilters(state, entry, event)) {
      return;
    }

    let used = false;
    entry.rule.effects.forEach((effect) => {
      used = applyRuleEffect(state, entry, event, selected, effect) || used;
    });

    if (used) {
      markLimitedRuleUsed(state, entry, event);
    }
  });

  queueTriggeredReactions(state, event);
}

function applyRuleEffect(
  state: CombatState,
  entry: RuleSource,
  event: RuleEventContext,
  selected: Creature[],
  effect: RuleEffectOperation
): boolean {
  if (effect.type === 'applyCondition' || effect.type === 'applyConditionOnFailedSave') {
    if (effect.type === 'applyConditionOnFailedSave' && (event.trigger !== 'afterSavingThrow' || event.success !== false)) {
      return false;
    }

    selected.forEach((creature) => {
      const condition = createAppliedCondition(effect.conditionId, {
        sourceCreatureId: event.source?.id ?? entry.owner.id,
        name: effect.name,
        description: effect.description,
        tags: effect.tags,
        durationType: effect.durationType,
        remainingRounds: effect.remainingRounds,
        stackBehavior: effect.stackBehavior,
        stackCount: effect.stackCount,
        intensity: effect.intensity,
        metadata: effect.metadata,
        rules: effect.rules
      });
      stampConditionApplicationTiming(state, condition);
      const result = applyConditionToCreature(creature, condition);
      logRuleMessage(state, `${getConditionDefinition(effect.conditionId).name} ${result === 'applied' ? 'applied to' : result === 'refreshed' ? 'refreshed on' : 'stacked on'} ${creature.name}.`);
      enqueueVisualEvent(state, {
        kind: 'conditionApplied',
        creatureId: creature.id,
        sourceCreatureId: condition.sourceCreatureId,
        conditionId: condition.id,
        conditionName: condition.name ?? getConditionDefinition(effect.conditionId).name,
        label: condition.name ?? getConditionDefinition(effect.conditionId).name
      });
      runConditionAppliedRules(state, creature, condition, event.source ?? entry.owner);
    });
    return selected.length > 0;
  }

  if (effect.type === 'removeCondition') {
    const changed = selected.filter((creature) => removeConditionFromCreature(creature, effect.conditionId));
    changed.forEach((creature) => {
      const label = getConditionDefinition(effect.conditionId).name;
      logRuleMessage(state, `${label} removed from ${creature.name}.`);
      enqueueVisualEvent(state, {
        kind: 'conditionRemoved',
        creatureId: creature.id,
        sourceCreatureId: event.source?.id ?? entry.owner.id,
        conditionId: effect.conditionId,
        conditionName: label,
        label
      });
    });
    return changed.length > 0;
  }

  if (effect.type === 'pushCreature' || effect.type === 'pullCreature') {
    const source = event.source ?? entry.owner;
    const requestedSteps = Math.floor(Math.max(0, effect.distanceFeet) / 5);
    let changed = false;

    selected.forEach((creature) => {
      const from = { ...creature.position };
      const path = [from];

      for (let step = 0; step < requestedSteps; step += 1) {
        const dx = Math.sign(
          effect.type === 'pushCreature'
            ? creature.position.x - source.position.x
            : source.position.x - creature.position.x
        );
        const dy = Math.sign(
          effect.type === 'pushCreature'
            ? creature.position.y - source.position.y
            : source.position.y - creature.position.y
        );
        if (dx === 0 && dy === 0) {
          break;
        }

        const destination = getTilePosition({ x: creature.position.x + dx, y: creature.position.y + dy }, state.grid);
        if (!isInBounds(destination, state.grid) || isBlocked(destination, state.grid) || isOccupied(state, destination, creature.id)) {
          break;
        }

        creature.position = destination;
        path.push(destination);
      }

      const distanceMoved = (path.length - 1) * 5;
      const baseVerb = effect.type === 'pushCreature' ? 'push' : 'pull';
      const verb = effect.type === 'pushCreature' ? 'pushes' : 'pulls';
      const direction = effect.type === 'pushCreature' ? 'away' : 'closer';
      if (distanceMoved === 0) {
        logRuleMessage(state, `${source.name} cannot ${baseVerb} ${creature.name} ${direction}; the path is blocked.`);
        return;
      }

      changed = true;
      const partial = distanceMoved < effect.distanceFeet ? ` The remaining movement is blocked.` : '';
      logRuleMessage(
        state,
        `${source.name} ${verb} ${creature.name} ${distanceMoved} feet ${direction} to ${formatPosition(creature.position)}.${partial}`
      );
      enqueueVisualEvent(state, {
        kind: 'movementComplete',
        creatureId: creature.id,
        sourceCreatureId: source.id,
        label: effect.type === 'pushCreature' ? `Pushed ${distanceMoved} ft` : `Pulled ${distanceMoved} ft`,
        from,
        to: creature.position,
        path
      });
    });

    return changed;
  }

  if (effect.type === 'dealDamage') {
    let affected = false;
    selected.forEach((creature) => {
      if (creature.hp <= 0 || hasCondition(creature, 'defeated')) {
        return;
      }
      const damage = rollDamageDice(effect.dice, event.random ?? Math.random);
      const source = event.source ?? entry.owner;
      const damageAction = createRuleDamageAction(entry, effect);
      let appliedAmount = Math.max(0, applyBeforeDamageModifiers(state, source, creature, damageAction, damage.total));
      appliedAmount = Math.max(0, runDamageRules(state, {
        trigger: 'beforeDamage',
        source,
        actionTarget: creature,
        damageTarget: creature,
        action: damageAction,
        damageType: effect.damageType,
        damageAmount: appliedAmount,
        random: event.random
      }, appliedAmount));
      const before = creature.hp;
      creature.hp = Math.max(0, creature.hp - appliedAmount);
      affected = true;
      if (creature.hp !== before) {
        enqueueVisualEvent(state, {
          kind: 'damageDealt',
          creatureId: creature.id,
          sourceCreatureId: event.source?.id ?? entry.owner.id,
          amount: before - creature.hp,
          label: `-${before - creature.hp}`
        });
        logRuleMessage(
          state,
          `${creature.name} takes ${appliedAmount} ${effect.damageType ?? 'damage'} from ${effect.note ?? entry.rule.name ?? entry.label}.`
        );
      } else {
        logRuleMessage(
          state,
          `${creature.name} takes 0 ${effect.damageType ?? 'damage'} from ${effect.note ?? entry.rule.name ?? entry.label}.`
        );
      }
      runAfterDamageHooks(state, source, creature, damageAction, appliedAmount);
      if (creature.hp === 0 && !hasCondition(creature, 'defeated')) {
        applyConditionToCreature(creature, createAppliedCondition('defeated'));
        logRuleMessage(state, `${creature.name} is defeated.`);
        enqueueVisualEvent(state, {
          kind: 'creatureDefeated',
          creatureId: creature.id,
          sourceCreatureId: event.source?.id ?? entry.owner.id,
          label: 'Defeated'
        });
        runDefeatedRules(state, creature, source, damageAction, event.random);
      }
    });
    return affected;
  }

  if (effect.type === 'savingThrowDamage') {
    let affected = false;
    selected.forEach((creature) => {
      if (creature.hp <= 0 || hasCondition(creature, 'defeated')) {
        return;
      }

      const source = entry.owner;
      const damageAction = createRuleSavingThrowDamageAction(entry, effect);
      const saveRollModifier = mergeRollModifiers(
        collectSavingThrowModifiers(state, creature, effect.ability),
        collectBeforeSavingThrowRuleModifiers(state, { source, target: creature, action: damageAction, ability: effect.ability })
      );
      const rollMode = resolveRollMode(saveRollModifier);
      const firstSaveRoll = rollDice('1d20', event.random ?? Math.random);
      const secondSaveRoll = rollMode === 'normal' ? undefined : rollDice('1d20', event.random ?? Math.random);
      const saveModifier = getEffectiveSaveBonus(creature, effect.ability, state);
      const flatModifier = saveRollModifier.flatModifier ?? 0;
      const d20Total = chooseD20(firstSaveRoll.total, secondSaveRoll?.total, rollMode);
      const saveTotal = d20Total + saveModifier + flatModifier;
      const success = saveRollModifier.autoFail ? false : saveRollModifier.autoSuccess ? true : saveTotal >= effect.dc;
      const damageRoll = rollDice(effect.dice, event.random ?? Math.random);
      const baseAmount = success ? (effect.halfDamageOnSuccess ? Math.floor(damageRoll.total / 2) : 0) : damageRoll.total;

      logRuleMessage(
        state,
        `${creature.name} rolls ${effect.ability.toUpperCase()} save against ${effect.note ?? entry.rule.name ?? entry.label}: ${formatD20Roll(firstSaveRoll.total, secondSaveRoll?.total, rollMode)}${formatRollReasons(saveRollModifier.notes)} + ${saveModifier}${flatModifier ? ` ${formatSigned(flatModifier)}` : ''} = ${saveTotal} vs DC ${effect.dc}. ${success ? 'Success.' : 'Failure.'}`
      );
      enqueueVisualEvent(state, {
        kind: success ? 'savingThrowSuccess' : 'savingThrowFailure',
        creatureId: creature.id,
        sourceCreatureId: source.id,
        label: success ? 'Save' : 'Fail'
      });
      runAfterSavingThrowRules(state, { source, target: creature, action: damageAction, ability: effect.ability, total: saveTotal, success });

      let appliedAmount = Math.max(0, applyBeforeDamageModifiers(state, source, creature, damageAction, baseAmount));
      appliedAmount = Math.max(0, runDamageRules(state, {
        trigger: 'beforeDamage',
        source,
        actionTarget: creature,
        damageTarget: creature,
        action: damageAction,
        damageType: effect.damageType,
        damageAmount: appliedAmount,
        random: event.random
      }, appliedAmount));
      const before = creature.hp;
      creature.hp = Math.max(0, creature.hp - appliedAmount);
      affected = true;
      if (creature.hp !== before) {
        enqueueVisualEvent(state, {
          kind: 'damageDealt',
          creatureId: creature.id,
          sourceCreatureId: source.id,
          amount: before - creature.hp,
          label: `-${before - creature.hp}`
        });
      }
      logRuleMessage(
        state,
        `${creature.name} takes ${before - creature.hp} ${effect.damageType ?? 'damage'} from ${effect.note ?? entry.rule.name ?? entry.label} (${damageRoll.rolls.join(', ')} + ${damageRoll.modifier}${success && effect.halfDamageOnSuccess ? ', halved' : ''}).`
      );
      runAfterDamageHooks(state, source, creature, damageAction, appliedAmount);
      if (creature.hp === 0 && !hasCondition(creature, 'defeated')) {
        applyConditionToCreature(creature, createAppliedCondition('defeated'));
        logRuleMessage(state, `${creature.name} is defeated.`);
        enqueueVisualEvent(state, {
          kind: 'creatureDefeated',
          creatureId: creature.id,
          sourceCreatureId: source.id,
          label: 'Defeated'
        });
        runDefeatedRules(state, creature, source, damageAction, event.random);
      }
    });
    return affected;
  }

  if (effect.type === 'spendResource' || effect.type === 'restoreResource') {
    let changed = false;
    selected.forEach((creature) => {
      const resource = getResource(creature, effect.resourceId);
      if (!resource) {
        return;
      }
      const before = resource.current;
      resource.current =
        effect.type === 'spendResource'
          ? Math.max(0, resource.current - effect.amount)
          : Math.min(resource.max, resource.current + effect.amount);
      if (resource.current !== before) {
        changed = true;
        logRuleMessage(state, `${creature.name} ${effect.type === 'spendResource' ? 'spends' : 'restores'} ${effect.amount} ${resource.name} (${resource.current}/${resource.max}).`);
      }
    });
    return changed;
  }

  if (effect.type === 'addTag' && event.action) {
    if (!event.action.tags.includes(effect.tag)) {
      event.action.tags.push(effect.tag);
      return true;
    }
    return false;
  }

  if (effect.type === 'removeTag' && event.action) {
    const before = event.action.tags.length;
    event.action.tags = event.action.tags.filter((tag) => tag !== effect.tag);
    return event.action.tags.length !== before;
  }

  if (effect.type === 'logMessage') {
    logRuleMessage(state, formatRuleMessage(effect.message, entry, event));
    return true;
  }

  return false;
}

function queueTriggeredReactions(state: CombatState, event: RuleEventContext): void {
  if (event.action?.actionCost === 'reaction') {
    return;
  }

  state.pendingReactions = state.pendingReactions ?? [];
  state.creatures.forEach((reactor) => {
    if (reactor.hp <= 0 || hasCondition(reactor, 'defeated') || state.turnResources[reactor.id]?.reactionUsed || !canCreatureTakeReaction(state, reactor)) {
      return;
    }

    getAvailableActions(reactor, state)
      .filter((action) => action.actionCost === 'reaction')
      .forEach((action) => {
        (action.reactionTriggers ?? []).forEach((listener) => {
          if (!reactionListenerMatches(state, reactor, listener, event)) {
            return;
          }

          const target = getReactionTarget(state, reactor, listener, event);
          if (target && (target.hp <= 0 || hasCondition(target, 'defeated'))) {
            return;
          }
          if (target && !isReactionTargetInRange(action, reactor, target)) {
            return;
          }

          const pending = createPendingReaction(state, reactor, action, listener, event, target);
          if (!state.pendingReactions.some((candidate) => candidate.id === pending.id)) {
            state.pendingReactions.push(pending);
            logRuleMessage(state, `Reaction available: ${pending.description}`);
          }
        });
      });
  });
}

function reactionListenerMatches(
  state: CombatState,
  reactor: Creature,
  listener: ReactionTriggerDefinition,
  event: RuleEventContext
): boolean {
  if (listener.enabled === false || listener.trigger !== event.trigger) {
    return false;
  }

  const selected = resolveSelectors(state, reactor, event, listener.selectors ?? eventSelectorDefaults(event));
  const entry = { owner: reactor, rule: { id: listener.id, trigger: listener.trigger, filters: listener.filters, effects: [] }, label: listener.name ?? listener.id };
  if (listener.reactorMustBeSelected === false) {
    return selected.length > 0 && passesFilters(state, entry, event);
  }

  return selected.some((creature) => creature.id === reactor.id) && passesFilters(state, entry, event);
}

function getReactionTarget(
  state: CombatState,
  reactor: Creature,
  listener: ReactionTriggerDefinition,
  event: RuleEventContext
): Creature | undefined {
  const target = getReferencedCreature(
    { owner: reactor, rule: { id: listener.id, trigger: listener.trigger, effects: [] }, label: listener.name ?? listener.id },
    event,
    listener.target ?? getDefaultReactionTarget(event)
  );
  if (target) {
    return target;
  }

  const selected = resolveSelectors(state, reactor, event, listener.selectors ?? eventSelectorDefaults(event));
  return selected.find((creature) => creature.id !== reactor.id) ?? selected[0];
}

function getDefaultReactionTarget(event: RuleEventContext): 'self' | 'source' | 'actionTarget' {
  if (event.trigger === 'onActionUsed' || event.trigger === 'onTurnStart' || event.trigger === 'onTurnEnd' || event.trigger === 'onDefeated') {
    return 'source';
  }
  return 'actionTarget';
}

function isReactionTargetInRange(action: ActionDefinition, reactor: Creature, target: Creature): boolean {
  if (action.targetMode === 'self') {
    return true;
  }
  return getDistanceFeet(reactor.position, target.position) <= Math.max(action.reach ?? 0, action.normalRange ?? action.longRange ?? action.range * 5);
}

function createPendingReaction(
  state: CombatState,
  reactor: Creature,
  action: ActionDefinition,
  listener: ReactionTriggerDefinition,
  event: RuleEventContext,
  target?: Creature
): PendingReaction {
  const triggerLabel = listener.name ?? listener.description ?? listener.trigger;
  return {
    id: `${state.round}:${state.turnIndex}:${listener.trigger}:${reactor.id}:${action.id}:${target?.id ?? 'none'}:${event.source?.id ?? 'none'}:${event.actionTarget?.id ?? 'none'}:${state.pendingReactions.length}`,
    trigger: listener.trigger,
    reactorId: reactor.id,
    targetId: target?.id,
    actionId: action.id,
    from: event.source?.position,
    to: event.actionTarget?.position,
    description: `${reactor.name} can use ${action.name}${target ? ` on ${target.name}` : ''} (${triggerLabel}).`
  };
}

function createRuleDamageAction(
  entry: RuleSource,
  effect: Extract<RuleEffectOperation, { type: 'dealDamage' }>
): ActionDefinition {
  return {
    id: `${entry.rule.id}-damage`,
    name: effect.note ?? entry.rule.name ?? entry.label,
    kind: 'custom',
    actionCost: 'free',
    targetMode: 'creature',
    tags: ['condition', 'damage', ...(effect.damageType ? [effect.damageType.toLowerCase()] : [])],
    range: 0,
    damage: { dice: effect.dice, type: effect.damageType },
    shape: { type: 'single' },
    effects: []
  };
}

function createRuleSavingThrowDamageAction(
  entry: RuleSource,
  effect: Extract<RuleEffectOperation, { type: 'savingThrowDamage' }>
): ActionDefinition {
  return {
    id: `${entry.rule.id}-save-damage`,
    name: effect.note ?? entry.rule.name ?? entry.label,
    kind: 'savingThrowEffect',
    type: 'savingThrowEffect',
    actionCost: 'free',
    targetMode: 'creature',
    tags: ['condition', 'damage', 'save', ...(effect.damageType ? [effect.damageType.toLowerCase()] : [])],
    range: 0,
    damage: { dice: effect.dice, type: effect.damageType },
    save: { ability: effect.ability, dc: effect.dc, halfDamageOnSuccess: effect.halfDamageOnSuccess },
    shape: { type: 'single' },
    effects: []
  };
}

function getTriggeredRules(state: CombatState, event: RuleEventContext): RuleSource[] {
  const entries: RuleSource[] = [];

  state.creatures.forEach((creature) => {
    if (event.trigger === 'onDefeated' && creature.id !== event.source?.id) {
      return;
    }

    getEnabledFeatures(creature).forEach((feature) => {
      (feature.rules ?? []).forEach((rule) => {
        if (rule.trigger === event.trigger && rule.enabled !== false) {
          entries.push({ owner: creature, rule, label: feature.name });
        }
      });
    });

    creature.conditions.forEach((condition) => {
      const definition = getConditionDefinition(condition.id);
      [...(definition.rules ?? []), ...(condition.rules ?? [])].forEach((rule) => {
        if (rule.trigger === event.trigger && rule.enabled !== false) {
          entries.push({ owner: creature, rule, label: condition.name ?? definition.name });
        }
      });
    });
  });

  if (event.action && event.source) {
    (event.action.rules ?? []).forEach((rule) => {
      if (rule.trigger === event.trigger && rule.enabled !== false) {
        entries.push({ owner: event.source!, rule, label: event.action!.name });
      }
    });
  }

  return entries;
}

function eventSelectorDefaults(event: RuleEventContext): RuleTargetSelector[] {
  if (event.trigger === 'beforeDamage' || event.trigger === 'afterDamage') {
    return [{ type: 'actionTarget' }];
  }
  if (event.trigger === 'beforeAttackRoll' || event.trigger === 'beforeSavingThrow') {
    return [{ type: 'source' }];
  }
  if (event.trigger === 'afterAttackRoll' || event.trigger === 'afterSavingThrow' || event.trigger === 'onActionUsed') {
    return [{ type: 'source' }];
  }
  if (event.trigger === 'onDefeated') {
    return [{ type: 'self' }];
  }
  if (event.trigger === 'onTurnStart' || event.trigger === 'onTurnEnd') {
    return [{ type: 'source' }];
  }
  return [{ type: 'self' }];
}

function resolveSelectors(
  state: CombatState,
  owner: Creature,
  event: RuleEventContext,
  selectors: RuleTargetSelector[]
): Creature[] {
  return uniqueCreatures(
    selectors.flatMap((selector) => {
      if (selector.type === 'self') {
        return [owner];
      }
      if (selector.type === 'source') {
        return event.source ? [event.source] : [];
      }
      if (selector.type === 'actionTarget') {
        return event.actionTarget ? [event.actionTarget] : [];
      }
      if (selector.type === 'creaturesInArea') {
        return event.areaTargets ?? [];
      }
      if (selector.type === 'sourceWithinRange') {
        if (!event.source || event.source.id === owner.id || event.source.hp <= 0 || hasCondition(event.source, 'defeated')) {
          return [];
        }
        return getDistanceFeet(owner.position, event.source.position) <= (selector.range ?? 0) ? [event.source] : [];
      }

      const range = selector.range ?? 0;
      return state.creatures.filter((creature) => {
        if (creature.id === owner.id || creature.hp <= 0 || hasCondition(creature, 'defeated')) {
          return false;
        }
        const inRange = getDistanceFeet(owner.position, creature.position) <= range;
        const teamMatches =
          selector.type === 'creaturesWithinRange'
            ? true
            : selector.type === 'alliesWithinRange'
              ? areAllies(creature, owner, state)
              : areHostile(creature, owner, state);
        return inRange && teamMatches;
      });
    })
  );
}

function resolveTargetsForRule(state: CombatState, entry: RuleSource, event: RuleEventContext): Creature[] {
  return resolveSelectors(state, entry.owner, event, entry.rule.selectors ?? eventSelectorDefaults(event));
}

function passesFilters(state: CombatState, entry: RuleSource, event: RuleEventContext): boolean {
  return (entry.rule.filters ?? []).every((filter) => passesFilter(state, entry, event, filter));
}

function passesFilter(state: CombatState, entry: RuleSource, event: RuleEventContext, filter: RuleFilter): boolean {
  if (filter.type === 'actionHasTag') {
    return event.action?.tags.includes(filter.tag) ?? false;
  }
  if (filter.type === 'targetHasCondition') {
    return event.actionTarget ? hasCondition(event.actionTarget, filter.conditionId) : false;
  }
  if (filter.type === 'sourceHasCondition') {
    return event.source ? hasCondition(event.source, filter.conditionId) : false;
  }
  if (filter.type === 'hpBelowHalf') {
    const creature = getReferencedCreature(entry, event, filter.target ?? 'actionTarget');
    return creature ? creature.hp < creature.maxHp / 2 : false;
  }
  if (filter.type === 'resourceAvailable') {
    const creature = getReferencedCreature(entry, event, filter.target ?? 'source');
    const resource = creature ? getResource(creature, filter.resourceId) : undefined;
    return (resource?.current ?? 0) >= (filter.amount ?? 1);
  }
  if (filter.type === 'damageTaken') {
    return (event.damageAmount ?? 0) >= (filter.minimum ?? 1);
  }
  if (filter.type === 'damageType') {
    return damageTypeMatches(filter.damageType, event.damageType);
  }
  if (filter.type === 'oncePerTurn') {
    const memory = state.ruleMemory?.[getMemoryKey(entry, filter.key)];
    return memory?.turnKey !== getTurnKey(state);
  }
  if (filter.type === 'oncePerRound') {
    const memory = state.ruleMemory?.[getMemoryKey(entry, filter.key)];
    return memory?.round !== state.round;
  }

  return true;
}

function markLimitedRuleUsed(state: CombatState, entry: RuleSource, event: RuleEventContext): void {
  (entry.rule.filters ?? []).forEach((filter) => {
    if (filter.type !== 'oncePerTurn' && filter.type !== 'oncePerRound') {
      return;
    }

    state.ruleMemory = state.ruleMemory ?? {};
    const key = getMemoryKey(entry, filter.key);
    state.ruleMemory[key] = {
      ...state.ruleMemory[key],
      turnKey: filter.type === 'oncePerTurn' ? getTurnKey(state) : state.ruleMemory[key]?.turnKey,
      round: filter.type === 'oncePerRound' ? state.round : state.ruleMemory[key]?.round
    };
  });
}

function getReferencedCreature(entry: RuleSource, event: RuleEventContext, target: 'self' | 'source' | 'actionTarget'): Creature | undefined {
  if (target === 'self') {
    return entry.owner;
  }
  if (target === 'source') {
    return event.source;
  }
  return event.actionTarget;
}

function getMemoryKey(entry: RuleSource, filterKey?: string): string {
  return `${entry.owner.id}:${entry.rule.id}:${filterKey ?? 'default'}`;
}

function getTurnKey(state: CombatState): string {
  return `${state.round}:${state.activeCreatureId ?? state.turnIndex}`;
}

function uniqueCreatures(creatures: Creature[]): Creature[] {
  const seen = new Set<string>();
  return creatures.filter((creature) => {
    if (seen.has(creature.id)) {
      return false;
    }
    seen.add(creature.id);
    return true;
  });
}

function logRuleMessage(state: CombatState, message: string): void {
  state.log.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    round: state.round,
    turn: state.turnIndex,
    type: 'system',
    message,
    timestamp: new Date().toISOString()
  } satisfies CombatLogEntry);
}

function chooseD20(first: number, second: number | undefined, mode: 'normal' | 'advantage' | 'disadvantage'): number {
  if (mode === 'advantage') {
    return Math.max(first, second ?? first);
  }
  if (mode === 'disadvantage') {
    return Math.min(first, second ?? first);
  }
  return first;
}

function formatD20Roll(first: number, second?: number, mode: 'normal' | 'advantage' | 'disadvantage' = 'normal'): string {
  if (mode === 'advantage') {
    return `d20 ${first}/${second ?? first} adv`;
  }
  if (mode === 'disadvantage') {
    return `d20 ${first}/${second ?? first} dis`;
  }
  return `d20 ${first}`;
}

function formatRollReasons(notes: string[] | undefined): string {
  return notes?.length ? ` (${notes.join(', ')})` : '';
}

function formatSigned(value: number): string {
  return value >= 0 ? `+ ${value}` : `- ${Math.abs(value)}`;
}

function formatPosition(position: GridPosition): string {
  return `(${position.x}, ${position.y}${position.z ? `, z ${position.z}` : ''})`;
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

function formatRuleMessage(message: string, entry: RuleSource, event: RuleEventContext): string {
  return message
    .replace(/\{self\}/g, entry.owner.name)
    .replace(/\{source\}/g, event.source?.name ?? '')
    .replace(/\{target\}/g, event.actionTarget?.name ?? '')
    .replace(/\{action\}/g, event.action?.name ?? '');
}
