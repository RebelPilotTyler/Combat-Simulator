import { parseDiceExpression } from './dice';
import type { ActionDefinition, Creature, Resource } from './types';

export interface CrEstimateOptions {
  targetAc: number;
  targetSaveBonus: number;
  manualDpr?: number;
  manualFinalCr?: string;
}

export interface CrEstimate {
  defensiveCr: string;
  offensiveCr: string;
  finalCr: string;
  proficiencyBonusSuggestion: number;
  effectiveHp: number;
  estimatedDpr: number;
  notes: string[];
}

export interface CrRow {
  label: string;
  value: number;
  minHp: number;
  maxHp: number;
  ac: number;
  minDpr: number;
  maxDpr: number;
  attackBonus: number;
  saveDc: number;
  xp: number;
}

const crXpByLabel: Record<string, number> = {
  '0': 10,
  '1/8': 25,
  '1/4': 50,
  '1/2': 100,
  '1': 200,
  '2': 450,
  '3': 700,
  '4': 1100,
  '5': 1800,
  '6': 2300,
  '7': 2900,
  '8': 3900,
  '9': 5000,
  '10': 5900,
  '11': 7200,
  '12': 8400,
  '13': 10000,
  '14': 11500,
  '15': 13000,
  '16': 15000,
  '17': 18000,
  '18': 20000,
  '19': 22000,
  '20': 25000,
  '21': 33000,
  '22': 41000,
  '23': 50000,
  '24': 62000,
  '25': 75000,
  '26': 90000,
  '27': 105000,
  '28': 120000,
  '29': 135000,
  '30': 155000
};

const crRows: CrRow[] = [
  { label: '0', value: 0, minHp: 1, maxHp: 6, ac: 13, minDpr: 0, maxDpr: 1, attackBonus: 3, saveDc: 13, xp: crXpByLabel['0'] },
  { label: '1/8', value: 0.125, minHp: 7, maxHp: 35, ac: 13, minDpr: 2, maxDpr: 3, attackBonus: 3, saveDc: 13, xp: crXpByLabel['1/8'] },
  { label: '1/4', value: 0.25, minHp: 36, maxHp: 49, ac: 13, minDpr: 4, maxDpr: 5, attackBonus: 3, saveDc: 13, xp: crXpByLabel['1/4'] },
  { label: '1/2', value: 0.5, minHp: 50, maxHp: 70, ac: 13, minDpr: 6, maxDpr: 8, attackBonus: 3, saveDc: 13, xp: crXpByLabel['1/2'] },
  ...Array.from({ length: 30 }, (_, index) => {
    const cr = index + 1;
    const label = String(cr);
    const hpMin = cr < 20 ? 71 + index * 15 : 356 + (cr - 20) * 45;
    const hpMax = cr < 20 ? 85 + index * 15 : 400 + (cr - 20) * 45;
    const dprMin = cr < 20 ? 9 + index * 6 : 123 + (cr - 20) * 18;
    const dprMax = cr < 20 ? 14 + index * 6 : 140 + (cr - 20) * 18;
    return {
      label,
      value: cr,
      minHp: hpMin,
      maxHp: hpMax,
      ac: cr < 4 ? 13 : cr < 5 ? 14 : cr < 8 ? 15 : cr < 11 ? 16 : cr < 16 ? 17 : cr < 20 ? 18 : cr < 21 ? 19 : cr < 24 ? 20 : cr < 27 ? 21 : cr < 30 ? 22 : 23,
      minDpr: dprMin,
      maxDpr: dprMax,
      attackBonus: cr < 3 ? 3 : cr < 4 ? 4 : cr < 5 ? 5 : cr < 8 ? 6 : cr < 11 ? 7 : cr < 16 ? 8 : cr < 17 ? 9 : cr < 20 ? 10 : cr < 23 ? 11 : cr < 27 ? 12 : cr < 30 ? 13 : 14,
      saveDc: cr < 4 ? 13 : cr < 5 ? 14 : cr < 8 ? 15 : cr < 11 ? 16 : cr < 16 ? 17 : cr < 20 ? 18 : cr < 21 ? 19 : cr < 24 ? 20 : cr < 27 ? 21 : cr < 30 ? 22 : 23,
      xp: crXpByLabel[label]
    };
  })
];

export const crCalculationTable: readonly CrRow[] = crRows;

export function getCrXp(label: string): number {
  return crXpByLabel[label] ?? 0;
}

export function estimateCreatureCR(creature: Creature, options: CrEstimateOptions): CrEstimate {
  const notes: string[] = ['Approximate 5e-style CR estimate; review manually before publishing.'];
  const resistanceMultiplier = getResistanceHpMultiplier(creature, notes);
  const effectiveHp = Math.round(creature.maxHp * resistanceMultiplier);
  const defensiveBase = findRowByHp(effectiveHp);
  const defensiveCr = adjustRow(defensiveBase, Math.trunc((creature.ac - defensiveBase.ac) / 2));
  notes.push(`Defensive base from ${effectiveHp} effective HP; AC ${creature.ac} compared with expected AC ${defensiveBase.ac}.`);

  const autoDpr = estimateDpr(creature, options, notes);
  const estimatedDpr = options.manualDpr !== undefined && Number.isFinite(options.manualDpr)
    ? Math.max(0, options.manualDpr)
    : autoDpr;
  if (options.manualDpr !== undefined && Number.isFinite(options.manualDpr)) {
    notes.push(`Manual DPR override used: ${estimatedDpr}.`);
  }

  const offensiveBase = findRowByDpr(estimatedDpr);
  const attackOrDcAdjustment = getOffenseAdjustment(creature, options, offensiveBase, notes);
  const offensiveCr = adjustRow(offensiveBase, attackOrDcAdjustment);
  const averagedCr = nearestCrByValue((defensiveCr.value + offensiveCr.value) / 2);
  const finalCr = options.manualFinalCr?.trim()
    ? (crRows.find((row) => row.label === options.manualFinalCr?.trim()) ?? averagedCr)
    : averagedCr;

  if (options.manualFinalCr?.trim()) {
    notes.push(`Manual final CR override used: ${finalCr.label}.`);
  } else {
    notes.push(`Final CR averages defensive CR ${defensiveCr.label} and offensive CR ${offensiveCr.label}.`);
  }

  return {
    defensiveCr: defensiveCr.label,
    offensiveCr: offensiveCr.label,
    finalCr: finalCr.label,
    proficiencyBonusSuggestion: getProficiencyForCr(finalCr.value),
    effectiveHp,
    estimatedDpr: roundOne(estimatedDpr),
    notes
  };
}

function estimateDpr(creature: Creature, options: CrEstimateOptions, notes: string[]): number {
  const resources = new Map((creature.resources ?? []).map((resource) => [resource.id, resource]));
  const actionEstimates = creature.actions
    .map((action) => estimateActionDamage(action, creature.actions, resources, options, notes))
    .filter((value): value is { damage: number; uses: number } => value !== 0 && value.damage > 0 && value.uses > 0);

  if (actionEstimates.length === 0) {
    notes.push('No reliable automated action damage found; DPR is 0 until manually overridden.');
    return 0;
  }

  const threeRoundDamage = actionEstimates
    .flatMap(({ damage, uses }) => Array.from({ length: uses }, () => damage))
    .sort((a, b) => b - a)
    .slice(0, 3);

  while (threeRoundDamage.length < 3) {
    threeRoundDamage.push(0);
  }

  return threeRoundDamage.reduce((sum, damage) => sum + damage, 0) / 3;
}

function estimateActionDamage(
  action: ActionDefinition,
  allActions: ActionDefinition[],
  resources: Map<string, Resource>,
  options: CrEstimateOptions,
  notes: string[]
): { damage: number; uses: number } | 0 {
  if (action.kind === 'multiattack' && action.multiattack?.steps.length) {
    const damage = action.multiattack.steps.reduce((sum, step) => {
      const stepAction = step.inlineAction ?? allActions.find((candidate) => candidate.id === step.actionId);
      const estimate = stepAction ? estimateActionDamage(stepAction, allActions, resources, options, notes) : 0;
      return sum + (estimate ? estimate.damage : 0);
    }, 0);
    return damage > 0 ? { damage, uses: getActionUsesInFirstThreeRounds(action, resources, notes) } : 0;
  }

  const damageEffect = action.effects.find((effect) => effect.type === 'damage');
  const damage = action.damage ?? damageEffect?.damage;
  const save = action.save ?? damageEffect?.save;
  if (!damage?.dice) {
    if (action.tags.includes('attack') || save) {
      notes.push(`${action.name} has attack/save data but no parseable damage dice.`);
    }
    return 0;
  }

  const averageDamage = averageDice(damage.dice);
  if (averageDamage === undefined) {
    notes.push(`${action.name} damage "${damage.dice}" could not be parsed; use manual DPR if it matters.`);
    return 0;
  }

  if (save?.dc) {
    const failChance = getSaveFailureChance(save.dc, options.targetSaveBonus);
    const successDamage = save.halfDamageOnSuccess ? averageDamage / 2 : 0;
    return {
      damage: failChance * averageDamage + (1 - failChance) * successDamage,
      uses: getActionUsesInFirstThreeRounds(action, resources, notes)
    };
  }

  const hitChance = getHitChance(action.attackBonus ?? 0, options.targetAc);
  return {
    damage: hitChance * averageDamage,
    uses: getActionUsesInFirstThreeRounds(action, resources, notes)
  };
}

function getActionUsesInFirstThreeRounds(action: ActionDefinition, resources: Map<string, Resource>, notes: string[]): number {
  const useCosts = (action.resourceCosts ?? []).filter((cost) => cost.consumeOn === 'use');
  if (useCosts.length === 0) {
    return 3;
  }

  const uses = Math.min(
    3,
    ...useCosts.map((cost) => Math.floor((resources.get(cost.resourceId)?.current ?? 0) / Math.max(1, cost.amount)))
  );
  if (uses > 0) {
    notes.push(`${action.name} is limited-use and counted for ${uses} of the first 3 round(s).`);
  } else {
    notes.push(`${action.name} is limited-use but has no available uses for the first 3 rounds.`);
  }
  return uses;
}

function getOffenseAdjustment(creature: Creature, options: CrEstimateOptions, offensiveBase: CrRow, notes: string[]): number {
  const attackBonuses = creature.actions.map((action) => action.attackBonus).filter((bonus): bonus is number => typeof bonus === 'number');
  const saveDcs = creature.actions.map(getActionSaveDc).filter((dc): dc is number => typeof dc === 'number');
  const attackBonus = attackBonuses.length > 0 ? Math.max(...attackBonuses) : undefined;
  const saveDc = saveDcs.length > 0 ? Math.max(...saveDcs) : undefined;

  if (attackBonus === undefined && saveDc === undefined) {
    notes.push('No attack bonus or save DC found for offensive CR adjustment.');
    return 0;
  }

  if (saveDc !== undefined && (attackBonus === undefined || saveDc - offensiveBase.saveDc > attackBonus - offensiveBase.attackBonus)) {
    notes.push(`Offensive adjustment uses save DC ${saveDc} vs expected DC ${offensiveBase.saveDc}.`);
    return Math.trunc((saveDc - offensiveBase.saveDc) / 2);
  }

  notes.push(`Offensive adjustment uses attack bonus ${attackBonus} vs expected attack bonus ${offensiveBase.attackBonus}; target AC assumption is ${options.targetAc}.`);
  return Math.trunc(((attackBonus ?? offensiveBase.attackBonus) - offensiveBase.attackBonus) / 2);
}

function getResistanceHpMultiplier(creature: Creature, notes: string[]): number {
  const data = creature as unknown as {
    damageResistances?: string[];
    damageImmunities?: string[];
    damageVulnerabilities?: string[];
    resistances?: string[];
    immunities?: string[];
    vulnerabilities?: string[];
  };
  const resistances = [...(data.damageResistances ?? []), ...(data.resistances ?? [])];
  const immunities = [...(data.damageImmunities ?? []), ...(data.immunities ?? [])];
  const vulnerabilities = [...(data.damageVulnerabilities ?? []), ...(data.vulnerabilities ?? [])];
  let multiplier = 1;
  if (resistances.length > 0) {
    multiplier *= 1.5;
    notes.push(`Resistance data found (${resistances.join(', ')}); effective HP increased.`);
  }
  if (immunities.length > 0) {
    multiplier *= 2;
    notes.push(`Immunity data found (${immunities.join(', ')}); effective HP increased.`);
  }
  if (vulnerabilities.length > 0) {
    multiplier *= 0.75;
    notes.push(`Vulnerability data found (${vulnerabilities.join(', ')}); effective HP reduced.`);
  }
  if (multiplier === 1) {
    notes.push('No resistance, immunity, or vulnerability fields found.');
  }
  return multiplier;
}

function getActionSaveDc(action: ActionDefinition): number | undefined {
  return action.save?.dc ?? action.effects.find((effect) => effect.type === 'damage' && effect.save)?.save?.dc;
}

function averageDice(expression: string): number | undefined {
  try {
    const parsed = parseDiceExpression(expression);
    return parsed.count * ((parsed.sides + 1) / 2) + parsed.modifier;
  } catch {
    return undefined;
  }
}

function getHitChance(attackBonus: number, targetAc: number): number {
  return clamp((21 - (targetAc - attackBonus)) / 20, 0.05, 0.95);
}

function getSaveFailureChance(saveDc: number, targetSaveBonus: number): number {
  return clamp((saveDc - targetSaveBonus - 1) / 20, 0, 1);
}

function findRowByHp(hp: number): CrRow {
  if (hp <= 0) {
    return crRows[0];
  }
  return crRows.find((row) => hp <= row.maxHp) ?? crRows[crRows.length - 1];
}

function findRowByDpr(dpr: number): CrRow {
  if (dpr <= 0) {
    return crRows[0];
  }
  return crRows.find((row) => dpr <= row.maxDpr) ?? crRows[crRows.length - 1];
}

function adjustRow(row: CrRow, adjustment: number): CrRow {
  const index = crRows.indexOf(row);
  return crRows[clamp(index + adjustment, 0, crRows.length - 1)];
}

function nearestCrByValue(value: number): CrRow {
  return crRows.reduce((best, row) => (Math.abs(row.value - value) < Math.abs(best.value - value) ? row : best), crRows[0]);
}

function getProficiencyForCr(cr: number): number {
  if (cr >= 29) return 9;
  if (cr >= 25) return 8;
  if (cr >= 21) return 7;
  if (cr >= 17) return 6;
  if (cr >= 13) return 5;
  if (cr >= 9) return 4;
  if (cr >= 5) return 3;
  return 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
