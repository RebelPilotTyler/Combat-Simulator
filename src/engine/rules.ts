import { rollDamageDice, type RandomSource } from './dice';
import {
  applyConditionToCreature,
  createAppliedCondition,
  getConditionDefinition,
  hasCondition,
  mergeRollModifiers,
  removeConditionFromCreature
} from './conditions';
import { getEnabledFeatures, getResource } from './features';
import { getDistanceFeet } from './targeting';
import type {
  Ability,
  ActionDefinition,
  AppliedCondition,
  CombatLogEntry,
  CombatState,
  Creature,
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
    random: context.random
  }, context.amount);
}

export function runAfterDamageRules(state: CombatState, context: Omit<DamageRuleContext, 'random'>): void {
  runRules(state, {
    trigger: 'afterDamage',
    source: context.source,
    actionTarget: context.target,
    damageTarget: context.target,
    action: context.action
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
      }
    });

    if (used) {
      markLimitedRuleUsed(state, entry, event);
    }
  });

  return amount;
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
}

function applyRuleEffect(
  state: CombatState,
  entry: RuleSource,
  event: RuleEventContext,
  selected: Creature[],
  effect: RuleEffectOperation
): boolean {
  if (effect.type === 'applyCondition') {
    selected.forEach((creature) => {
      const condition = createAppliedCondition(effect.conditionId, {
        sourceCreatureId: event.source?.id ?? entry.owner.id,
        durationType: effect.durationType,
        remainingRounds: effect.remainingRounds,
        stackBehavior: effect.stackBehavior,
        stackCount: effect.stackCount,
        intensity: effect.intensity
      });
      const result = applyConditionToCreature(creature, condition);
      logRuleMessage(state, `${getConditionDefinition(effect.conditionId).name} ${result === 'applied' ? 'applied to' : result === 'refreshed' ? 'refreshed on' : 'stacked on'} ${creature.name}.`);
      runConditionAppliedRules(state, creature, condition, event.source ?? entry.owner);
    });
    return selected.length > 0;
  }

  if (effect.type === 'removeCondition') {
    const changed = selected.filter((creature) => removeConditionFromCreature(creature, effect.conditionId));
    changed.forEach((creature) => logRuleMessage(state, `${getConditionDefinition(effect.conditionId).name} removed from ${creature.name}.`));
    return changed.length > 0;
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

function getTriggeredRules(state: CombatState, event: RuleEventContext): RuleSource[] {
  const entries: RuleSource[] = [];

  state.creatures.forEach((creature) => {
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
          entries.push({ owner: creature, rule, label: definition.name });
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

      const range = selector.range ?? 0;
      return state.creatures.filter((creature) => {
        if (creature.id === owner.id || creature.hp <= 0 || hasCondition(creature, 'defeated')) {
          return false;
        }
        const inRange = getDistanceFeet(owner.position, creature.position) <= range;
        const teamMatches = selector.type === 'alliesWithinRange' ? creature.team === owner.team : creature.team !== owner.team;
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

function formatRuleMessage(message: string, entry: RuleSource, event: RuleEventContext): string {
  return message
    .replace(/\{self\}/g, entry.owner.name)
    .replace(/\{source\}/g, event.source?.name ?? '')
    .replace(/\{target\}/g, event.actionTarget?.name ?? '')
    .replace(/\{action\}/g, event.action?.name ?? '');
}
