import { abilityModifier } from './dice';
import { getConditionDefinition, hasCondition, normalizeConditions } from './conditions';
import { getDistanceFeet } from './targeting';
import { areAllies, areHostile } from './teams';
import type {
  Ability,
  ActionDefinition,
  ActionTag,
  CombatState,
  Creature,
  FeatureAlternateAction,
  Resource,
  ResourceCost,
  ResourceReset,
  StatModifiers,
  RuleDefinition,
  RuleEffectOperation,
  RuleFilter,
  RuleTargetSelector
} from './types';

export function getEnabledFeatures(creature: Creature) {
  return (creature.features ?? []).filter((feature) => feature.enabled);
}

export function getFeatureStatModifiers(creature: Creature): StatModifiers {
  return getEnabledFeatures(creature).reduce<StatModifiers>((total, feature) => {
    const modifiers = feature.modifiers ?? {};
    return {
      speed: (total.speed ?? 0) + (modifiers.speed ?? 0),
      climbSpeed: (total.climbSpeed ?? 0) + (modifiers.climbSpeed ?? 0),
      flySpeed: (total.flySpeed ?? 0) + (modifiers.flySpeed ?? 0),
      ac: (total.ac ?? 0) + (modifiers.ac ?? 0),
      attackBonus: (total.attackBonus ?? 0) + (modifiers.attackBonus ?? 0),
      saveDc: (total.saveDc ?? 0) + (modifiers.saveDc ?? 0),
      maxHp: (total.maxHp ?? 0) + (modifiers.maxHp ?? 0),
      saveBonus: mergeAbilityModifiers(total.saveBonus, modifiers.saveBonus),
      abilityScoreBonus: mergeAbilityModifiers(total.abilityScoreBonus, modifiers.abilityScoreBonus)
    };
  }, {});
}

export function getEffectiveSpeed(creature: Creature, state: CombatState): number {
  return Math.max(0, creature.speed + (getEffectiveStatModifiers(creature, state).speed ?? 0));
}

export function getEffectiveClimbSpeed(creature: Creature, state: CombatState): number {
  return Math.max(0, (creature.climbSpeed ?? 0) + (getEffectiveStatModifiers(creature, state).climbSpeed ?? 0));
}

export function getEffectiveFlySpeed(creature: Creature, state: CombatState): number {
  return Math.max(0, (creature.flySpeed ?? 0) + (getEffectiveStatModifiers(creature, state).flySpeed ?? 0));
}

export function getEffectiveMovementSpeed(creature: Creature, state: CombatState): number {
  return Math.max(getEffectiveSpeed(creature, state), getEffectiveClimbSpeed(creature, state), getEffectiveFlySpeed(creature, state));
}

export function getEffectiveAC(creature: Creature, state: CombatState): number {
  return creature.ac + (getEffectiveStatModifiers(creature, state).ac ?? 0);
}

export function getEffectiveAbilityScore(creature: Creature, ability: Ability, state: CombatState): number {
  return Math.max(1, creature.abilityScores[ability] + (getEffectiveStatModifiers(creature, state).abilityScoreBonus?.[ability] ?? 0));
}

export function getEffectiveAttackBonus(action: ActionDefinition, creature: Creature, state: CombatState): number {
  return (action.attackBonus ?? 0) + (getEffectiveStatModifiers(creature, state).attackBonus ?? 0);
}

export function getEffectiveSaveBonus(creature: Creature, ability: Ability, state: CombatState): number {
  return abilityModifier(getEffectiveAbilityScore(creature, ability, state)) + (getEffectiveStatModifiers(creature, state).saveBonus?.[ability] ?? 0);
}

export function getEffectiveSaveDc(action: ActionDefinition, creature: Creature, state: CombatState): number | undefined {
  return action.save ? action.save.dc + (getEffectiveStatModifiers(creature, state).saveDc ?? 0) : undefined;
}

export function getAvailableActions(creature: Creature, state: CombatState): ActionDefinition[] {
  return [...creature.actions, ...getFeatureGeneratedActions(creature, state)];
}

export function getFeatureGeneratedActions(creature: Creature, _state: CombatState): ActionDefinition[] {
  return getEnabledFeatures(creature).flatMap((feature) =>
    (feature.alternateActions ?? []).map((alternate) => createAlternateAction(alternate, feature.id, feature.name))
  );
}

export function getResource(creature: Creature, resourceId: string): Resource | undefined {
  return (creature.resources ?? []).find((resource) => resource.id === resourceId);
}

export function hasResourcesForAction(creature: Creature, action: ActionDefinition): boolean {
  return (action.resourceCosts ?? [])
    .filter((cost) => cost.consumeOn === 'use')
    .every((cost) => (getResource(creature, cost.resourceId)?.current ?? 0) >= cost.amount);
}

export interface ResourceConsumption {
  cost: ResourceCost;
  resource: Resource;
  before: number;
  after: number;
  message: string;
}

export function consumeActionResources(
  creature: Creature,
  action: ActionDefinition,
  consumeOn: ResourceCost['consumeOn'] = 'use'
): ResourceConsumption[] {
  const consumptions: ResourceConsumption[] = [];

  (action.resourceCosts ?? [])
    .filter((cost) => cost.consumeOn === consumeOn)
    .forEach((cost) => {
      const resource = getResource(creature, cost.resourceId);
      if (!resource) {
        return;
      }

      const before = resource.current;
      resource.current = Math.max(0, resource.current - cost.amount);
      consumptions.push({
        cost,
        resource,
        before,
        after: resource.current,
        message: `${creature.name} spends ${cost.amount} ${resource.name} (${resource.current}/${resource.max}).`
      });
    });

  return consumptions;
}

export function resetResources(creature: Creature, resetOn: ResourceReset): void {
  (creature.resources ?? []).forEach((resource) => {
    if (resource.resetOn === resetOn) {
      resource.current = resource.max;
    }
  });
}

export function getUnavailableActionReason(creature: Creature, action: ActionDefinition): string | undefined {
  const unavailable = (action.resourceCosts ?? []).find((cost) => cost.consumeOn === 'use' && (getResource(creature, cost.resourceId)?.current ?? 0) < cost.amount);
  if (!unavailable) {
    return undefined;
  }

  const resourceName = getResource(creature, unavailable.resourceId)?.name ?? unavailable.resourceId;
  return `Needs ${unavailable.amount} ${resourceName}.`;
}

function createAlternateAction(alternate: FeatureAlternateAction, featureId: string, featureName: string): ActionDefinition {
  return {
    id: alternate.id,
    name: alternate.name,
    kind: 'custom',
    actionCost: alternate.actionCost,
    tags: alternate.tags,
    range: 0,
    effects: [],
    description: alternate.description ?? `${featureName} feature action.`,
    resourceCosts: alternate.resourceCosts,
    generatedByFeatureId: featureId,
    baseActionName: alternate.baseActionName
  };
}

function mergeAbilityModifiers(
  left: Partial<Record<Ability, number>> | undefined,
  right: Partial<Record<Ability, number>> | undefined
): Partial<Record<Ability, number>> | undefined {
  if (!left && !right) {
    return undefined;
  }

  return {
    str: (left?.str ?? 0) + (right?.str ?? 0),
    dex: (left?.dex ?? 0) + (right?.dex ?? 0),
    con: (left?.con ?? 0) + (right?.con ?? 0),
    int: (left?.int ?? 0) + (right?.int ?? 0),
    wis: (left?.wis ?? 0) + (right?.wis ?? 0),
    cha: (left?.cha ?? 0) + (right?.cha ?? 0)
  };
}

function getEffectiveStatModifiers(creature: Creature, state: CombatState): StatModifiers {
  return mergeStatModifiers(getFeatureStatModifiers(creature), getPassiveRuleStatModifiers(creature, state));
}

function getPassiveRuleStatModifiers(target: Creature, state: CombatState): StatModifiers {
  return state.creatures.reduce<StatModifiers>((total, owner) => {
    const rules = getPassiveRulesForCreature(owner);
    return rules.reduce((nextTotal, rule) => {
      if (!passiveRuleTargetsCreature(state, owner, target, rule) || !passesPassiveFilters(owner, target, rule.filters ?? [])) {
        return nextTotal;
      }

      return rule.effects.reduce((effectTotal, effect) => mergeStatModifiers(effectTotal, getStatModifierFromRuleEffect(effect)), nextTotal);
    }, total);
  }, {});
}

function getPassiveRulesForCreature(creature: Creature): RuleDefinition[] {
  const featureRules = getEnabledFeatures(creature).flatMap((feature) => feature.rules ?? []);
  const conditionRules = normalizeConditions(creature.conditions).flatMap((condition) => {
    const definition = getConditionDefinition(condition.id);
    return [...(definition.rules ?? []), ...(condition.rules ?? [])];
  });
  return [...featureRules, ...conditionRules].filter((rule) => rule.enabled !== false && rule.trigger === 'whileActive');
}

function passiveRuleTargetsCreature(state: CombatState, owner: Creature, target: Creature, rule: RuleDefinition): boolean {
  const selectors = rule.selectors?.length ? rule.selectors : [{ type: 'self' as const }];
  return selectors.some((selector) => passiveSelectorTargetsCreature(state, owner, target, selector));
}

function passiveSelectorTargetsCreature(
  state: CombatState,
  owner: Creature,
  target: Creature,
  selector: RuleTargetSelector
): boolean {
  if (selector.type === 'self' || selector.type === 'source') {
    return owner.id === target.id;
  }
  if (selector.type === 'alliesWithinRange' || selector.type === 'enemiesWithinRange' || selector.type === 'creaturesWithinRange') {
    if (owner.id === target.id || target.hp <= 0 || hasCondition(target, 'defeated')) {
      return false;
    }
    const teamMatches =
      selector.type === 'creaturesWithinRange'
        ? true
        : selector.type === 'alliesWithinRange'
          ? areAllies(target, owner, state)
          : areHostile(target, owner, state);
    return teamMatches && getDistanceFeet(owner.position, target.position) <= (selector.range ?? 0);
  }
  return false;
}

function passesPassiveFilters(owner: Creature, target: Creature, filters: RuleFilter[]): boolean {
  return filters.every((filter) => {
    if (filter.type === 'targetHasCondition') {
      return hasCondition(target, filter.conditionId);
    }
    if (filter.type === 'sourceHasCondition') {
      return hasCondition(owner, filter.conditionId);
    }
    if (filter.type === 'hpBelowHalf') {
      const creature = filter.target === 'source' || filter.target === 'self' ? owner : target;
      return creature.hp < creature.maxHp / 2;
    }
    if (filter.type === 'resourceAvailable') {
      const creature = filter.target === 'actionTarget' ? target : owner;
      return (getResource(creature, filter.resourceId)?.current ?? 0) >= (filter.amount ?? 1);
    }
    return filter.type === 'actionHasTag' || filter.type === 'damageTaken' || filter.type === 'damageType' ? false : true;
  });
}

function getStatModifierFromRuleEffect(effect: RuleEffectOperation): StatModifiers {
  if (effect.type === 'modifyArmorClass') {
    return { ac: effect.amount };
  }
  if (effect.type === 'modifySpeed') {
    return { speed: effect.amount };
  }
  if (effect.type === 'modifyAttackBonus') {
    return { attackBonus: effect.amount };
  }
  if (effect.type === 'modifySaveDc') {
    return { saveDc: effect.amount };
  }
  if (effect.type === 'modifySavingThrowBonus') {
    const abilities: Ability[] = effect.ability ? [effect.ability] : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    return { saveBonus: Object.fromEntries(abilities.map((ability) => [ability, effect.amount])) };
  }
  return {};
}

function mergeStatModifiers(left: StatModifiers, right: StatModifiers): StatModifiers {
  return {
    speed: (left.speed ?? 0) + (right.speed ?? 0),
    climbSpeed: (left.climbSpeed ?? 0) + (right.climbSpeed ?? 0),
    flySpeed: (left.flySpeed ?? 0) + (right.flySpeed ?? 0),
    ac: (left.ac ?? 0) + (right.ac ?? 0),
    attackBonus: (left.attackBonus ?? 0) + (right.attackBonus ?? 0),
    saveDc: (left.saveDc ?? 0) + (right.saveDc ?? 0),
    maxHp: (left.maxHp ?? 0) + (right.maxHp ?? 0),
    saveBonus: mergeAbilityModifiers(left.saveBonus, right.saveBonus),
    abilityScoreBonus: mergeAbilityModifiers(left.abilityScoreBonus, right.abilityScoreBonus)
  };
}
