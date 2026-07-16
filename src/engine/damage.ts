import type { ActionDefinition, Creature } from './types';

export interface DamageTraits {
  resistant: boolean;
  immune: boolean;
  vulnerable: boolean;
}

export function normalizeDamageType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeDamageTypes(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeDamageType).filter((value): value is string => Boolean(value)))];
}

export function damageTypeMatches(configuredType: string, incomingType: string | undefined): boolean {
  const configured = normalizeDamageType(configuredType);
  const incoming = normalizeDamageType(incomingType);
  return configured === 'all' || configured === '*' || Boolean(configured && incoming && configured === incoming);
}

export function getActionDamageType(action: ActionDefinition): string | undefined {
  return normalizeDamageType(
    action.damage?.type ?? action.effects.find((effect) => effect.type === 'damage' && effect.damage)?.damage?.type
  );
}

export function getNativeDamageTraits(creature: Creature, damageType: string | undefined): DamageTraits {
  return {
    resistant: (creature.damageResistances ?? []).some((type) => damageTypeMatches(type, damageType)),
    immune: (creature.damageImmunities ?? []).some((type) => damageTypeMatches(type, damageType)),
    vulnerable: (creature.damageVulnerabilities ?? []).some((type) => damageTypeMatches(type, damageType))
  };
}

export function applyDamageTraits(amount: number, traits: DamageTraits): number {
  const normalizedAmount = Math.max(0, amount);
  if (traits.immune) {
    return 0;
  }

  const multiplier = (traits.resistant ? 0.5 : 1) * (traits.vulnerable ? 2 : 1);
  return Math.floor(normalizedAmount * multiplier);
}
