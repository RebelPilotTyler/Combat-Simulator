import { describe, expect, it } from 'vitest';
import { estimateCreatureCR } from './cr';
import type { Creature } from './types';

function creature(update: Partial<Creature> = {}): Creature {
  return {
    id: 'test-creature',
    name: 'Test Creature',
    team: 'enemies',
    hp: 72,
    maxHp: 72,
    ac: 15,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 0, y: 0, z: 0 },
    conditions: [],
    actions: [
      {
        id: 'strike',
        name: 'Strike',
        kind: 'meleeAttack',
        type: 'meleeAttack',
        actionCost: 'action',
        tags: ['attack', 'melee'],
        range: 1,
        attackBonus: 5,
        damage: { dice: '1d8+3' },
        effects: []
      }
    ],
    ...update
  };
}

describe('estimateCreatureCR', () => {
  it('estimates defensive CR from HP with AC adjustment', () => {
    const estimate = estimateCreatureCR(creature({ maxHp: 72, hp: 72, ac: 15 }), { targetAc: 15, targetSaveBonus: 2 });

    expect(estimate.defensiveCr).toBe('2');
    expect(estimate.notes.some((note) => note.includes('effective HP'))).toBe(true);
  });

  it('estimates offensive CR from DPR and attack bonus adjustment', () => {
    const estimate = estimateCreatureCR(creature(), { targetAc: 15, targetSaveBonus: 2 });

    expect(estimate.estimatedDpr).toBe(4.1);
    expect(estimate.offensiveCr).toBe('1/2');
  });

  it('maps fractional DPR between table bands to the next valid offensive CR band', () => {
    const estimate = estimateCreatureCR(
      creature({
        maxHp: 10,
        hp: 10,
        ac: 12,
        actions: [
          {
            id: 'low-strike',
            name: 'Low Strike',
            kind: 'meleeAttack',
            type: 'meleeAttack',
            actionCost: 'action',
            tags: ['attack', 'melee'],
            range: 1,
            attackBonus: 3,
            damage: { dice: '1d6' },
            effects: []
          }
        ]
      }),
      { targetAc: 15, targetSaveBonus: 2 }
    );

    expect(estimate.estimatedDpr).toBe(1.6);
    expect(estimate.offensiveCr).toBe('1/8');
  });

  it('averages defensive and offensive CR for final CR', () => {
    const estimate = estimateCreatureCR(creature(), { targetAc: 15, targetSaveBonus: 2 });

    expect(estimate.finalCr).toBe('1');
    expect(estimate.proficiencyBonusSuggestion).toBe(2);
  });

  it('uses manual DPR and final CR overrides', () => {
    const estimate = estimateCreatureCR(creature(), {
      targetAc: 15,
      targetSaveBonus: 2,
      manualDpr: 40,
      manualFinalCr: '5'
    });

    expect(estimate.estimatedDpr).toBe(40);
    expect(estimate.finalCr).toBe('5');
    expect(estimate.proficiencyBonusSuggestion).toBe(3);
    expect(estimate.notes.some((note) => note.includes('Manual DPR override'))).toBe(true);
  });

  it('falls back gracefully when action damage is uncertain', () => {
    const estimate = estimateCreatureCR(
      creature({
        actions: [
          {
            id: 'mystery',
            name: 'Mystery Power',
            kind: 'custom',
            actionCost: 'action',
            tags: ['attack'],
            range: 1,
            attackBonus: 4,
            effects: []
          }
        ]
      }),
      { targetAc: 15, targetSaveBonus: 2 }
    );

    expect(estimate.estimatedDpr).toBe(0);
    expect(estimate.offensiveCr).toBe('0');
    expect(estimate.notes.some((note) => note.includes('no parseable damage dice') || note.includes('No reliable automated action damage'))).toBe(true);
  });

  it('uses save data from damage effects when estimating DPR', () => {
    const estimate = estimateCreatureCR(
      creature({
        actions: [
          {
            id: 'burning-burst',
            name: 'Burning Burst',
            kind: 'savingThrowEffect',
            type: 'savingThrowEffect',
            actionCost: 'action',
            tags: ['area'],
            range: 6,
            effects: [
              {
                id: 'burn',
                name: 'Burn',
                type: 'damage',
                damage: { dice: '4d6' },
                save: { ability: 'dex', dc: 15, halfDamageOnSuccess: true }
              }
            ]
          }
        ]
      }),
      { targetAc: 15, targetSaveBonus: 3 }
    );

    expect(estimate.estimatedDpr).toBe(10.9);
    expect(estimate.notes.some((note) => note.includes('save DC 15'))).toBe(true);
  });
});
