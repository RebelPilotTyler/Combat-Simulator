import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_CONDITION_LIBRARY_KEY,
  EXAMPLE_CUSTOM_CONDITION_TEMPLATES,
  REFERENCE_CONDITION_TEMPLATES,
  createAppliedConditionFromTemplate,
  createBlankCustomConditionTemplate,
  deleteCustomConditionTemplate,
  duplicateCustomConditionTemplate,
  filterCustomConditionTemplates,
  getCustomConditionTemplateWarnings,
  hasMechanicalCustomConditionEffects,
  loadCustomConditionLibrary,
  normalizeCustomConditionTemplate,
  parseCustomConditionTemplates,
  saveCustomConditionLibrary,
  upsertCustomConditionTemplate
} from './customConditions';
import { createCombatState } from './combat';
import { getMovementCost } from './movement';
import { collectBeforeAttackRollRuleModifiers, runTurnRules } from './rules';
import type { ActionDefinition, Creature } from './types';

const strike: ActionDefinition = {
  id: 'strike',
  name: 'Strike',
  kind: 'meleeAttack',
  type: 'meleeAttack',
  actionCost: 'action',
  tags: ['attack', 'melee'],
  range: 1,
  attackBonus: 4,
  damage: { dice: '1d6' },
  shape: { type: 'single' },
  effects: []
};

const baseCreature: Creature = {
  id: 'a',
  name: 'Alpha',
  team: 'players',
  hp: 10,
  maxHp: 10,
  ac: 12,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  speed: 30,
  position: { x: 0, y: 0 },
  conditions: [],
  actions: [strike]
};

function creature(overrides: Partial<Creature>): Creature {
  return {
    ...baseCreature,
    ...overrides,
    abilityScores: overrides.abilityScores ?? baseCreature.abilityScores,
    conditions: overrides.conditions ?? [],
    actions: overrides.actions ?? baseCreature.actions
  };
}

describe('custom condition templates', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        }
      }
    });
    window.localStorage.removeItem(CUSTOM_CONDITION_LIBRARY_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates, edits, duplicates, filters, saves, and deletes custom condition templates', () => {
    const blank = createBlankCustomConditionTemplate();
    const edited = normalizeCustomConditionTemplate({
      ...blank,
      id: 'moon-sick',
      name: 'Moon Sick',
      description: 'The creature reels under lunar magic.',
      tags: ['curse', 'lunar'],
      notes: 'Manual disadvantage on Wisdom checks.'
    });

    const library = upsertCustomConditionTemplate([], edited);
    expect(library).toHaveLength(1);
    expect(filterCustomConditionTemplates(library, 'lunar').map((template) => template.id)).toEqual(['moon-sick']);

    const duplicate = duplicateCustomConditionTemplate(edited);
    expect(duplicate.id).not.toBe(edited.id);
    expect(duplicate.name).toBe('Moon Sick Copy');

    const deleted = deleteCustomConditionTemplate([edited, duplicate], edited.id);
    expect(deleted).toEqual([duplicate]);
  });

  it('builds an applied combat condition while preserving rules text and mechanical hooks', () => {
    const template = normalizeCustomConditionTemplate({
      id: 'moon-sick',
      name: 'Moon Sick',
      description: 'Lunar magic muddles reactions.',
      defaultDurationType: 'rounds',
      defaultRemainingRounds: 2,
      stackBehavior: 'refresh',
      tags: ['curse'],
      notes: 'The target glows faintly.',
      rules: [
        {
          id: 'moon-sick-disadvantage',
          trigger: 'beforeAttackRoll',
          selectors: [{ type: 'source' }],
          effects: [{ type: 'grantDisadvantage', note: 'Moon Sick' }]
        }
      ]
    });

    const applied = createAppliedConditionFromTemplate(template, 'caster');

    expect(applied.id).toBe('moon-sick');
    expect(applied.name).toBe('Moon Sick');
    expect(applied.remainingRounds).toBe(2);
    expect(applied.metadata?.notes).toBe('The target glows faintly.');
    expect(applied.rules).toHaveLength(1);
    expect(hasMechanicalCustomConditionEffects(template)).toBe(true);
  });

  it('persists custom condition templates through localStorage and JSON import/export', () => {
    const template = normalizeCustomConditionTemplate({
      id: 'ash-bound',
      name: 'Ash Bound',
      description: 'Movement is restricted by ash.',
      tags: ['terrain']
    });

    saveCustomConditionLibrary([template]);
    expect(loadCustomConditionLibrary()).toEqual([template]);

    const parsed = parseCustomConditionTemplates(JSON.stringify({ customConditions: [template] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.templates[0].id).toBe('ash-bound');
    }
  });

  it('keeps rules text only templates valid and flags missing mechanical hooks', () => {
    const template = normalizeCustomConditionTemplate({
      id: 'story-marked',
      name: 'Story Marked',
      description: 'This condition is tracked manually.',
      notes: 'The DM decides how the mark behaves.'
    });

    expect(hasMechanicalCustomConditionEffects(template)).toBe(false);
    expect(getCustomConditionTemplateWarnings(template)).toContain('Rules text only; no mechanical hooks configured.');
  });

  it('gracefully drops incomplete mechanical effects and warns about empty hooks', () => {
    const parsed = parseCustomConditionTemplates(
      JSON.stringify({
        id: 'broken-hook',
        name: 'Broken Hook',
        rules: [
          {
            id: 'missing-amount',
            trigger: 'beforeAttackRoll',
            effects: [{ type: 'addFlatModifier' }]
          }
        ]
      })
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.templates[0].rules[0].effects).toEqual([]);
      expect(getCustomConditionTemplateWarnings(parsed.templates[0])).toContain('missing-amount has no valid mechanical effects.');
    }
  });

  it('includes read-only reference and example templates for the builder', () => {
    expect(REFERENCE_CONDITION_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining(['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'])
    );
    expect(EXAMPLE_CUSTOM_CONDITION_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining(['burning-example', 'slowed-example', 'marked-example', 'weakened-example'])
    );
  });

  it('burning example deals damage at the start of the bearer turn', () => {
    const burning = EXAMPLE_CUSTOM_CONDITION_TEMPLATES.find((template) => template.id === 'burning-example')!;
    const state = createCombatState([
      creature({
        id: 'a',
        conditions: [createAppliedConditionFromTemplate(burning)]
      })
    ]);

    runTurnRules(state, state.creatures[0], 'onTurnStart');

    expect(state.creatures[0].hp).toBeLessThan(10);
    expect(state.log.some((entry) => entry.message.includes('fire'))).toBe(true);
  });

  it('slowed example doubles movement cost while active', () => {
    const slowed = EXAMPLE_CUSTOM_CONDITION_TEMPLATES.find((template) => template.id === 'slowed-example')!;
    const state = createCombatState([
      creature({
        id: 'a',
        conditions: [createAppliedConditionFromTemplate(slowed)]
      })
    ], 2, 1);

    expect(getMovementCost(state, 'a', { x: 1, y: 0 })).toBe(10);
  });

  it('marked example grants attack bonus against the marked target', () => {
    const marked = EXAMPLE_CUSTOM_CONDITION_TEMPLATES.find((template) => template.id === 'marked-example')!;
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
      creature({
        id: 'b',
        name: 'Bravo',
        team: 'enemies',
        position: { x: 1, y: 0 },
        conditions: [createAppliedConditionFromTemplate(marked)]
      })
    ]);

    const modifier = collectBeforeAttackRollRuleModifiers(state, {
      attacker: state.creatures[0],
      target: state.creatures[1],
      action: strike
    });

    expect(modifier.flatModifier).toBe(2);
    expect(modifier.notes).toContain('Marked');
  });

  it('blinded reference template demonstrates attack disadvantage and incoming attack advantage', () => {
    const blinded = REFERENCE_CONDITION_TEMPLATES.find((template) => template.id === 'blinded')!;
    const state = createCombatState([
      creature({
        id: 'a',
        name: 'Alpha',
        position: { x: 0, y: 0 },
        conditions: [createAppliedConditionFromTemplate(blinded)]
      }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
    ]);

    expect(collectBeforeAttackRollRuleModifiers(state, { attacker: state.creatures[0], target: state.creatures[1], action: strike }).disadvantage).toBe(true);
    expect(collectBeforeAttackRollRuleModifiers(state, { attacker: state.creatures[1], target: state.creatures[0], action: strike }).advantage).toBe(true);
  });
});
