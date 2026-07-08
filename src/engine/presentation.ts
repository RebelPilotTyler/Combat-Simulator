import type { AppliedCondition, Creature } from './types';

export const CONDITION_TAGS: Record<string, string> = {
  blinded: 'BLD',
  charmed: 'CHM',
  deafened: 'DEF',
  frightened: 'FRI',
  grappled: 'GRP',
  hidden: 'HID',
  incapacitated: 'INC',
  invisible: 'INV',
  paralyzed: 'PAR',
  poisoned: 'PSN',
  prone: 'PRN',
  restrained: 'RST',
  stunned: 'STN',
  unconscious: 'UNC',
  dodging: 'DOD',
  disengaged: 'DIS',
  helped: 'HLP',
  helpedTarget: 'HPT',
  defeated: 'KO'
};

export function getHpPercent(creature: Pick<Creature, 'hp' | 'maxHp'>): number {
  if (creature.maxHp <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((creature.hp / creature.maxHp) * 100)));
}

export function getConditionTag(condition: AppliedCondition): string {
  return CONDITION_TAGS[condition.id] ?? condition.id.slice(0, 3).toUpperCase();
}

export function getConditionTags(conditions: AppliedCondition[]): string[] {
  return conditions.map(getConditionTag);
}

export function formatBaseEffectiveNumber(base: number, effective: number): string {
  return base === effective ? `${base}` : `${base} / effective ${effective}`;
}

export function formatBaseEffectiveBonus(base: number, effective: number): string {
  return base === effective ? formatSignedBonus(base) : `${formatSignedBonus(base)} / effective ${formatSignedBonus(effective)}`;
}

function formatSignedBonus(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}
