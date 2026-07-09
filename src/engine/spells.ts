import { SPELLS, SPELLS_BY_ID } from '../data/spells';
import { abilityModifier, parseDiceExpression } from './dice';
import type {
  ActionCost,
  ActionDefinition,
  Creature,
  Resource,
  SpellActionCost,
  SpellDamageDefinition,
  SpellDefinition,
  SpellScalingDefinition
} from './types';

export interface SpellSlotCost {
  resourceId: string;
  amount: number;
  level: number;
}

export function getSpellDefinition(spellId: string): SpellDefinition | undefined {
  return SPELLS_BY_ID[spellId];
}

export function requireSpellDefinition(spellId: string): SpellDefinition {
  const spell = getSpellDefinition(spellId);
  if (!spell) {
    throw new Error(`Spell not found: ${spellId}`);
  }

  return spell;
}

export function getAvailableSpells(creature: Creature, spellbook: SpellDefinition[] = SPELLS): SpellDefinition[] {
  const spellIds = getCreatureSpellIds(creature);
  return spellbook.filter((spell) => spellIds.has(spell.id));
}

export function getAvailableSpellActions(creature: Creature, spellbook: SpellDefinition[] = SPELLS): ActionDefinition[] {
  return getAvailableSpells(creature, spellbook).map((spell) => spellToActionDefinition(spell, creature));
}

export function getCreatureSpellIds(creature: Creature): Set<string> {
  return new Set([...(creature.spellcasting?.knownSpells ?? []), ...(creature.spellcasting?.preparedSpells ?? [])]);
}

export function canCreatureCastSpell(creature: Creature, spell: SpellDefinition): boolean {
  return getCreatureSpellIds(creature).has(spell.id);
}

export function getSpellSlotResourceId(level: number): string {
  return `spell-slot-${level}`;
}

export function getSpellSlotCost(spell: SpellDefinition, castAtLevel = spell.level): SpellSlotCost | undefined {
  if (spell.level === 0) {
    return undefined;
  }

  const level = Math.max(spell.level, castAtLevel);
  return {
    resourceId: getSpellSlotResourceId(level),
    amount: 1,
    level
  };
}

export function getSpellSlotResource(creature: Creature, spell: SpellDefinition, castAtLevel = spell.level): Resource | undefined {
  const cost = getSpellSlotCost(spell, castAtLevel);
  return cost ? (creature.resources ?? []).find((resource) => resource.id === cost.resourceId) : undefined;
}

export function hasSpellSlot(creature: Creature, spell: SpellDefinition, castAtLevel = spell.level): boolean {
  const cost = getSpellSlotCost(spell, castAtLevel);
  if (!cost) {
    return true;
  }

  return (getSpellSlotResource(creature, spell, castAtLevel)?.current ?? 0) >= cost.amount;
}

export function getSpellUnavailableReason(creature: Creature, spell: SpellDefinition, castAtLevel = spell.level): string | undefined {
  if (!canCreatureCastSpell(creature, spell)) {
    return `${creature.name} does not know or have ${spell.name} prepared.`;
  }

  const cost = getSpellSlotCost(spell, castAtLevel);
  if (!cost || hasSpellSlot(creature, spell, castAtLevel)) {
    return undefined;
  }

  const resourceName = getSpellSlotResource(creature, spell, castAtLevel)?.name ?? `Spell Slot L${cost.level}`;
  return `Needs ${cost.amount} ${resourceName}.`;
}

export function consumeSpellSlot(creature: Creature, spell: SpellDefinition, castAtLevel = spell.level): string[] {
  const cost = getSpellSlotCost(spell, castAtLevel);
  if (!cost) {
    return [];
  }

  const resource = getSpellSlotResource(creature, spell, castAtLevel);
  if (!resource) {
    return [];
  }

  resource.current = Math.max(0, resource.current - cost.amount);
  return [`${creature.name} spends ${cost.amount} ${resource.name} (${resource.current}/${resource.max}).`];
}

export function mapSpellActionCost(actionCost: SpellActionCost): ActionCost {
  return actionCost === 'bonus' ? 'bonusAction' : actionCost;
}

export function getSpellAttackBonus(creature: Creature): number {
  const spellcasting = creature.spellcasting;
  if (!spellcasting) {
    return creature.proficiencyBonus;
  }

  return spellcasting.attackBonus ?? creature.proficiencyBonus + abilityModifier(creature.abilityScores[spellcasting.ability]);
}

export function getSpellSaveDc(creature: Creature): number {
  const spellcasting = creature.spellcasting;
  if (!spellcasting) {
    return 8 + creature.proficiencyBonus;
  }

  return spellcasting.saveDc ?? 8 + creature.proficiencyBonus + abilityModifier(creature.abilityScores[spellcasting.ability]);
}

export function getSpellcastingAbilityModifier(creature: Creature): number {
  const ability = creature.spellcasting?.ability;
  return ability ? abilityModifier(creature.abilityScores[ability]) : 0;
}

export function getScaledSpellDamage(spell: SpellDefinition, castAtLevel = spell.level): SpellDamageDefinition | undefined {
  if (!spell.damage) {
    return undefined;
  }

  return {
    ...spell.damage,
    dice: scaleDiceExpression(spell.damage.dice, spell.damage.scaling, spell.level, castAtLevel)
  };
}

export function getScaledSpellHealingDice(spell: SpellDefinition, castAtLevel = spell.level): string | undefined {
  if (!spell.healing) {
    return undefined;
  }

  return scaleDiceExpression(spell.healing.dice, spell.healing.scaling, spell.level, castAtLevel);
}

export function spellToActionDefinition(spell: SpellDefinition, creature: Creature, castAtLevel = spell.level): ActionDefinition {
  const attackType = spell.attackType;
  const isAttack = attackType === 'meleeSpellAttack' || attackType === 'rangedSpellAttack';
  const isSave = attackType === 'save';
  const range = spellRangeToSquares(spell);
  const resourceCost = getSpellSlotCost(spell, castAtLevel);
  const damage = getScaledSpellDamage(spell, castAtLevel);

  return {
    id: `spell:${spell.id}`,
    name: spell.name,
    kind: 'spell',
    type: isAttack ? (attackType === 'meleeSpellAttack' ? 'meleeAttack' : 'rangedAttack') : isSave ? 'savingThrowEffect' : undefined,
    actionCost: mapSpellActionCost(spell.actionCost),
    tags: [
      'spell',
      ...(isAttack ? (attackType === 'meleeSpellAttack' ? ['attack', 'melee'] : ['attack', 'ranged']) : []),
      ...(isSave || spell.targetType === 'area' ? ['area'] : []),
      ...(spell.actionCost === 'bonus' ? ['bonus'] : []),
      ...(spell.actionCost === 'reaction' ? ['reaction'] : [])
    ] as ActionDefinition['tags'],
    range,
    normalRange: spell.range.feet,
    attackBonus: isAttack ? getSpellAttackBonus(creature) : undefined,
    damage: damage ? { dice: damage.dice, type: damage.type } : undefined,
    save: isSave && spell.saveAbility ? { ability: spell.saveAbility, dc: getSpellSaveDc(creature), halfDamageOnSuccess: true } : undefined,
    shape: spellToActionShape(spell),
    effects:
      isSave && damage && spell.saveAbility
        ? [
            {
              id: `${spell.id}-damage`,
              name: `${spell.name} Damage`,
              type: 'damage',
              damage: { dice: damage.dice, type: damage.type },
              save: { ability: spell.saveAbility, dc: getSpellSaveDc(creature), halfDamageOnSuccess: true }
            }
          ]
        : [],
    description: spell.descriptionSummary,
    resourceCosts: resourceCost ? [{ resourceId: resourceCost.resourceId, amount: resourceCost.amount, consumeOn: 'use' }] : undefined,
    spellId: spell.id
  };
}

function scaleDiceExpression(
  baseDice: string,
  scaling: SpellScalingDefinition | undefined,
  spellLevel: number,
  castAtLevel: number
): string {
  if (!scaling || scaling.mode !== 'perSlotLevelAboveBase' || !scaling.dicePerStep || castAtLevel <= spellLevel) {
    return baseDice;
  }

  const extraSteps = castAtLevel - spellLevel;
  try {
    const base = parseDiceExpression(baseDice);
    const step = parseDiceExpression(scaling.dicePerStep);
    if (base.sides !== step.sides) {
      return baseDice;
    }

    const count = base.count + step.count * extraSteps;
    const modifier = base.modifier + step.modifier * extraSteps;
    return `${count}d${base.sides}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`;
  } catch {
    return baseDice;
  }
}

export function spellRangeToSquares(spell: SpellDefinition): number {
  if (spell.range.type === 'self') {
    return 0;
  }

  return Math.max(0, Math.ceil((spell.range.feet ?? 0) / 5));
}

function spellToActionShape(spell: SpellDefinition): ActionDefinition['shape'] {
  if (!spell.area) {
    return { type: 'single' };
  }

  if (spell.area.shape === 'cone') {
    return { type: 'cone', length: Math.max(1, Math.ceil(spell.area.size / 5)) };
  }

  if (spell.area.shape === 'line') {
    return { type: 'line', length: Math.max(1, Math.ceil(spell.area.size / 5)) };
  }

  if (spell.area.shape === 'radius' || spell.area.shape === 'sphere') {
    return { type: 'radius', radius: Math.max(1, Math.ceil(spell.area.size / 5)) };
  }

  return undefined;
}
