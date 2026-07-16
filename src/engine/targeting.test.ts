import { describe, expect, it } from 'vitest';
import { createCombatState } from './combat';
import { getActionTargetMode, getDistanceFeet, getLineSquares, hasLineOfSight, isInActionRange } from './targeting';
import type { ActionDefinition, Creature } from './types';

const bow: ActionDefinition = {
  id: 'bow',
  name: 'Bow',
  kind: 'rangedAttack',
  type: 'rangedAttack',
  actionCost: 'action',
  tags: ['attack', 'ranged'],
  range: 6,
  normalRange: 30,
  attackBonus: 4,
  damage: { dice: '1d8' },
  shape: { type: 'single' },
  effects: []
};

const scout: Creature = {
  id: 'scout',
  name: 'Scout',
  team: 'players',
  hp: 10,
  maxHp: 10,
  ac: 12,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  speed: 30,
  position: { x: 0, y: 0, z: 0 },
  conditions: [],
  actions: [bow]
};

describe('3D targeting', () => {
  it('distinguishes point-centered areas from creature and self targeting', () => {
    expect(getActionTargetMode({ ...bow, targetMode: 'point', shape: { type: 'radius', radius: 4 } })).toBe('point');
    expect(getActionTargetMode({ ...bow, shape: { type: 'single' } })).toBe('creature');
    expect(getActionTargetMode({ ...bow, shape: { type: 'cone', length: 3 } })).toBe('self');
  });

  it('counts elevation when measuring grid distance', () => {
    expect(getDistanceFeet({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(5);
    expect(getDistanceFeet({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(15);
    expect(getDistanceFeet({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })).toBe(15);
    expect(getDistanceFeet({ x: 0, y: 0, z: 0 }, { x: 4, y: 1, z: 2 })).toBe(20);
  });

  it('checks action range in 3D space', () => {
    expect(isInActionRange(bow, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 })).toBe(true);
    expect(isInActionRange(bow, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7 })).toBe(false);
  });

  it('includes elevation changes in line squares', () => {
    expect(getLineSquares({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 })).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 }
    ]);
  });

  it('blocks line of sight through elevated tiles but allows sight across the top', () => {
    const state = createCombatState([scout], 3, 1, [], [{ x: 1, y: 0, z: 1 }]);

    expect(hasLineOfSight(state, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBe(false);
    expect(hasLineOfSight(state, { x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 })).toBe(true);
    expect(hasLineOfSight(state, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 })).toBe(true);
  });
});
