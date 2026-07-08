import { abilityModifier } from './dice';
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
  StatModifiers
} from './types';

export function getEnabledFeatures(creature: Creature) {
  return (creature.features ?? []).filter((feature) => feature.enabled);
}

export function getFeatureStatModifiers(creature: Creature): StatModifiers {
  return getEnabledFeatures(creature).reduce<StatModifiers>((total, feature) => {
    const modifiers = feature.modifiers ?? {};
    return {
      speed: (total.speed ?? 0) + (modifiers.speed ?? 0),
      ac: (total.ac ?? 0) + (modifiers.ac ?? 0),
      attackBonus: (total.attackBonus ?? 0) + (modifiers.attackBonus ?? 0),
      maxHp: (total.maxHp ?? 0) + (modifiers.maxHp ?? 0),
      saveBonus: mergeAbilityModifiers(total.saveBonus, modifiers.saveBonus),
      abilityScoreBonus: mergeAbilityModifiers(total.abilityScoreBonus, modifiers.abilityScoreBonus)
    };
  }, {});
}

export function getEffectiveSpeed(creature: Creature, _state: CombatState): number {
  return Math.max(0, creature.speed + (getFeatureStatModifiers(creature).speed ?? 0));
}

export function getEffectiveAC(creature: Creature, _state: CombatState): number {
  return creature.ac + (getFeatureStatModifiers(creature).ac ?? 0);
}

export function getEffectiveAbilityScore(creature: Creature, ability: Ability, _state: CombatState): number {
  return Math.max(1, creature.abilityScores[ability] + (getFeatureStatModifiers(creature).abilityScoreBonus?.[ability] ?? 0));
}

export function getEffectiveAttackBonus(action: ActionDefinition, creature: Creature, _state: CombatState): number {
  return (action.attackBonus ?? 0) + (getFeatureStatModifiers(creature).attackBonus ?? 0);
}

export function getEffectiveSaveBonus(creature: Creature, ability: Ability, state: CombatState): number {
  return abilityModifier(getEffectiveAbilityScore(creature, ability, state)) + (getFeatureStatModifiers(creature).saveBonus?.[ability] ?? 0);
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

export function consumeActionResources(creature: Creature, action: ActionDefinition, consumeOn: ResourceCost['consumeOn'] = 'use'): string[] {
  const messages: string[] = [];

  (action.resourceCosts ?? [])
    .filter((cost) => cost.consumeOn === consumeOn)
    .forEach((cost) => {
      const resource = getResource(creature, cost.resourceId);
      if (!resource) {
        return;
      }

      resource.current = Math.max(0, resource.current - cost.amount);
      messages.push(`${creature.name} spends ${cost.amount} ${resource.name} (${resource.current}/${resource.max}).`);
    });

  return messages;
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
