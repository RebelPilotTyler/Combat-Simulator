import { describe, expect, it } from 'vitest';
import { SPELLS } from '../data/spells';
import { createCombatState, getAttackDebugStats, performSpellCast, rollInitiative } from './combat';
import { hasCondition } from './conditions';
import {
  consumeSpellSlot,
  getAvailableSpells,
  getSpellDefinition,
  getSpellSlotCost,
  hasSpellSlot
} from './spells';
import type { Creature } from './types';

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

const caster: Creature = {
  id: 'caster',
  name: 'Caster',
  team: 'players',
  hp: 20,
  maxHp: 20,
  ac: 12,
  abilityScores: { str: 8, dex: 12, con: 12, int: 16, wis: 16, cha: 10 },
  proficiencyBonus: 2,
  speed: 30,
  position: { x: 0, y: 0 },
  conditions: [],
  actions: [],
  resources: [{ id: 'spell-slot-1', name: 'Spell Slots L1', current: 2, max: 2, resetOn: 'longRest' }],
  spellcasting: {
    ability: 'wis',
    saveDc: 13,
    attackBonus: 5,
    knownSpells: ['fire-bolt', 'sacred-flame', 'cure-wounds', 'shield', 'bless', 'magic-missile']
  }
};

const target: Creature = {
  id: 'target',
  name: 'Target',
  team: 'enemies',
  hp: 20,
  maxHp: 20,
  ac: 10,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  speed: 30,
  position: { x: 1, y: 0 },
  conditions: [],
  actions: []
};

function activeState(extraCaster: Partial<Creature> = {}, extraTarget: Partial<Creature> = {}) {
  return rollInitiative(
    createCombatState([
      { ...caster, ...extraCaster },
      { ...target, ...extraTarget }
    ]),
    sequence([0.9, 0.1])
  );
}

describe('spell engine', () => {
  it('loads the starter spell data', () => {
    expect(SPELLS.map((spell) => spell.id)).toEqual(
      expect.arrayContaining(['fire-bolt', 'sacred-flame', 'cure-wounds', 'healing-word', 'magic-missile', 'shield'])
    );
    expect(getSpellDefinition('guiding-bolt')?.automationLevel).toBe('partial');
  });

  it('filters available spells by creature known and prepared ids', () => {
    const creature = {
      ...caster,
      spellcasting: {
        ability: 'wis' as const,
        knownSpells: ['fire-bolt', 'missing-spell'],
        preparedSpells: ['bless']
      }
    };

    expect(getAvailableSpells(creature).map((spell) => spell.id)).toEqual(['fire-bolt', 'bless']);
  });

  it('checks and consumes spell slots', () => {
    const creature = {
      ...caster,
      resources: [{ id: 'spell-slot-1', name: 'Spell Slots L1', current: 1, max: 1, resetOn: 'longRest' as const }]
    };
    const spell = getSpellDefinition('cure-wounds')!;

    expect(getSpellSlotCost(spell)).toMatchObject({ resourceId: 'spell-slot-1', amount: 1, level: 1 });
    expect(hasSpellSlot(creature, spell)).toBe(true);
    expect(consumeSpellSlot(creature, spell)[0]).toContain('spends 1 Spell Slots L1');
    expect(creature.resources[0].current).toBe(0);
    expect(hasSpellSlot(creature, spell)).toBe(false);
  });

  it('resolves a spell attack roll spell', () => {
    const state = activeState({}, { position: { x: 2, y: 0 } });
    const result = performSpellCast(state, { spellId: 'fire-bolt', targetId: 'target' }, sequence([0.5, 0]));

    expect(result.creatures.find((creature) => creature.id === 'target')?.hp).toBe(19);
    expect(result.log.some((entry) => entry.message.includes('casts Fire Bolt on Target'))).toBe(true);
  });

  it('calculates attack debug stats for generated spell actions', () => {
    const state = activeState({}, { position: { x: 2, y: 0 } });
    const stats = getAttackDebugStats(state, 'spell:fire-bolt', 'target', 0);

    expect(stats.attackBonus).toBe(5);
    expect(stats.targetAc).toBe(10);
  });

  it('resolves a saving throw spell', () => {
    const state = activeState();
    const result = performSpellCast(state, { spellId: 'sacred-flame', targetId: 'target' }, sequence([0, 0]));

    expect(result.creatures.find((creature) => creature.id === 'target')?.hp).toBe(19);
    expect(result.log.some((entry) => entry.message.includes('DEX save against Sacred Flame'))).toBe(true);
  });

  it('resolves a healing spell', () => {
    const state = activeState({}, { team: 'players', hp: 10 });
    const result = performSpellCast(state, { spellId: 'cure-wounds', targetId: 'target' }, sequence([0]));

    expect(result.creatures.find((creature) => creature.id === 'target')?.hp).toBe(14);
    expect(result.creatures.find((creature) => creature.id === 'caster')?.resources?.[0].current).toBe(1);
    expect(result.log.some((entry) => entry.message.includes('regains 4 HP from Cure Wounds'))).toBe(true);
  });

  it('upcasts healing spells with higher level slots', () => {
    const state = activeState(
      {
        resources: [
          { id: 'spell-slot-1', name: 'Spell Slots L1', current: 2, max: 2, resetOn: 'longRest' },
          { id: 'spell-slot-2', name: 'Spell Slots L2', current: 1, max: 1, resetOn: 'longRest' }
        ]
      },
      { team: 'players', hp: 10 }
    );

    const result = performSpellCast(state, { spellId: 'cure-wounds', targetId: 'target', castAtLevel: 2 }, sequence([0, 0]));

    expect(result.creatures.find((creature) => creature.id === 'target')?.hp).toBe(15);
    expect(result.creatures.find((creature) => creature.id === 'caster')?.resources?.find((resource) => resource.id === 'spell-slot-1')?.current).toBe(2);
    expect(result.creatures.find((creature) => creature.id === 'caster')?.resources?.find((resource) => resource.id === 'spell-slot-2')?.current).toBe(0);
  });

  it('logs manual spells without crashing', () => {
    const state = activeState();
    const result = performSpellCast(state, { spellId: 'shield' });

    expect(result.turnState.reactionUsed).toBe(true);
    expect(result.creatures.find((creature) => creature.id === 'caster')?.resources?.[0].current).toBe(1);
    expect(result.log.some((entry) => entry.message.includes('Shield automation is manual'))).toBe(true);
  });

  it('marks concentration spells and logs manual concentration handling', () => {
    const state = activeState();
    const result = performSpellCast(state, { spellId: 'bless' });
    const resultCaster = result.creatures.find((creature) => creature.id === 'caster')!;

    expect(hasCondition(resultCaster, 'concentrating')).toBe(true);
    expect(result.log.some((entry) => entry.message.includes('concentrating on Bless'))).toBe(true);
  });

  it('partially automated spells log manual remainders and still resolve supported effects', () => {
    const state = activeState();
    const result = performSpellCast(state, { spellId: 'magic-missile', targetId: 'target' }, sequence([0, 0, 0]));

    expect(result.creatures.find((creature) => creature.id === 'target')?.hp).toBe(14);
    expect(result.log.some((entry) => entry.message.includes('Magic Missile automation is partial'))).toBe(true);
  });

  it('upcasts partially automated damage spells with higher level slots', () => {
    const state = activeState(
      {
        resources: [
          { id: 'spell-slot-1', name: 'Spell Slots L1', current: 2, max: 2, resetOn: 'longRest' },
          { id: 'spell-slot-2', name: 'Spell Slots L2', current: 1, max: 1, resetOn: 'longRest' }
        ]
      },
      { hp: 20 }
    );

    const result = performSpellCast(state, { spellId: 'magic-missile', targetId: 'target', castAtLevel: 2 }, sequence([0, 0, 0, 0]));

    expect(result.creatures.find((creature) => creature.id === 'target')?.hp).toBe(12);
    expect(result.creatures.find((creature) => creature.id === 'caster')?.resources?.find((resource) => resource.id === 'spell-slot-2')?.current).toBe(0);
  });
});
