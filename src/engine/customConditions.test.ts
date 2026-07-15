import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_CONDITION_LIBRARY_KEY,
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
});
