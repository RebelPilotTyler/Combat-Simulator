import { describe, expect, it } from 'vitest';
import { createCombatState } from './combat';
import {
  getMovementSafetyAssessments,
  getAreaTargetOptionsForAction,
  getSafeMovementOptions,
  getTargetableCreaturesForAction,
  getTargetablePositionsForAction,
  getTacticalActionOptions,
  getTacticalActionUnavailableReason,
  getThreateningCreatures,
  isPositionThreatened
} from './tactics';
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
  damage: { dice: '1d6+2' },
  shape: { type: 'single' },
  effects: []
};

const bow: ActionDefinition = {
  id: 'bow',
  name: 'Bow',
  kind: 'rangedAttack',
  type: 'rangedAttack',
  actionCost: 'action',
  tags: ['attack', 'ranged'],
  range: 4,
  normalRange: 20,
  attackBonus: 4,
  damage: { dice: '1d8' },
  shape: { type: 'single' },
  effects: []
};

const fireBolt: ActionDefinition = {
  id: 'fire-bolt',
  name: 'Fire Bolt',
  kind: 'spell',
  type: 'rangedAttack',
  actionCost: 'action',
  tags: ['attack', 'ranged', 'spell'],
  range: 4,
  normalRange: 20,
  attackBonus: 4,
  damage: { dice: '1d10' },
  shape: { type: 'single' },
  effects: [],
  resourceCosts: [{ resourceId: 'slots', amount: 1, consumeOn: 'use' }]
};

const burst: ActionDefinition = {
  id: 'burst',
  name: 'Burst',
  kind: 'savingThrowEffect',
  type: 'savingThrowEffect',
  actionCost: 'action',
  tags: ['area'],
  range: 2,
  damage: { dice: '2d6' },
  save: { ability: 'dex', dc: 12, halfDamageOnSuccess: true },
  shape: { type: 'radius', radius: 1 },
  effects: [
    {
      id: 'burst-damage',
      name: 'Burst Damage',
      type: 'damage',
      damage: { dice: '2d6' },
      save: { ability: 'dex', dc: 12, halfDamageOnSuccess: true }
    }
  ]
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
  actions: [strike, bow, fireBolt, burst],
  resources: [{ id: 'slots', name: 'Slots', current: 0, max: 1, resetOn: 'longRest' }]
};

function creature(overrides: Partial<Creature>): Creature {
  return {
    ...baseCreature,
    ...overrides,
    abilityScores: overrides.abilityScores ?? baseCreature.abilityScores,
    conditions: overrides.conditions ?? [],
    actions: overrides.actions ?? baseCreature.actions,
    resources: overrides.resources ?? baseCreature.resources
  };
}

describe('tactics helpers', () => {
  it('reports hostile melee threats and can require an available reaction', () => {
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
    ]);
    state.turnResources.b.reactionUsed = true;

    expect(isPositionThreatened(state, state.creatures[0])).toBe(true);
    expect(getThreateningCreatures(state, state.creatures[0], state.creatures[0].position, { requireReaction: true })).toEqual([]);
  });

  it('scores movement paths that provoke opportunity attacks', () => {
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
    ], 4, 4);

    const assessment = getMovementSafetyAssessments(state, 'a').find(
      (candidate) => candidate.option.position.x === 0 && candidate.option.position.y === 2
    );

    expect(assessment?.opportunityAttackers.map((attacker) => attacker.id)).toEqual(['b']);
    expect(assessment?.isSafe).toBe(false);
    expect(getSafeMovementOptions(state, 'a').some((option) => option.position.x === 0 && option.position.y === 2)).toBe(false);
  });

  it('returns targetable hostile creatures while respecting resources, charm, and line of sight', () => {
    const state = createCombatState([
      creature({
        id: 'a',
        name: 'Alpha',
        position: { x: 0, y: 0 },
        conditions: [{ id: 'charmed', sourceCreatureId: 'b', durationType: 'permanentUntilRemoved', stackBehavior: 'none', stackCount: 1, intensity: 1 }]
      }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 2, y: 0 } }),
      creature({ id: 'c', name: 'Charlie', team: 'enemies', position: { x: 0, y: 2 } }),
      creature({ id: 'd', name: 'Delta', team: 'players', position: { x: 1, y: 1 } }),
      creature({ id: 'e', name: 'Echo', team: 'enemies', position: { x: 5, y: 0 } })
    ], 6, 3, [{ x: 0, y: 1 }]);
    const attacker = state.creatures[0];

    expect(getTargetableCreaturesForAction(state, attacker, fireBolt)).toEqual([]);
    expect(getTargetableCreaturesForAction(state, attacker, bow).map((target) => target.id)).toEqual([]);
    expect(getTargetableCreaturesForAction(state, attacker, bow, { requireLineOfSight: false }).map((target) => target.id)).toEqual(['c']);
  });

  it('returns targetable grid positions for ranged and spell origins', () => {
    const state = createCombatState([creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } })], 4, 1);
    const attacker = state.creatures[0];

    expect(getTargetablePositionsForAction(state, attacker, bow).map((position) => `${position.x},${position.y}`)).toEqual([
      '0,0',
      '1,0',
      '2,0',
      '3,0'
    ]);
  });

  it('summarizes area target options for saving throw actions', () => {
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 2, y: 0 } }),
      creature({ id: 'c', name: 'Charlie', team: 'enemies', position: { x: 3, y: 0 } }),
      creature({ id: 'd', name: 'Delta', team: 'players', position: { x: 1, y: 0 } })
    ], 5, 1);
    const attacker = state.creatures[0];

    const areaOptions = getAreaTargetOptionsForAction(state, attacker, burst);
    const bestOption = areaOptions.find((option) => option.origin.x === 2 && option.origin.y === 0);

    expect(bestOption?.targets.map((target) => target.id)).toEqual(['b', 'c']);
    expect(areaOptions.some((option) => option.targets.some((target) => target.id === 'd'))).toBe(false);
  });

  it('reports action availability and target summaries for future creature behavior', () => {
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
    ], 3, 1);
    const attacker = state.creatures[0];

    expect(getTacticalActionUnavailableReason(state, attacker, fireBolt)).toBe('Needs 1 Slots.');

    const options = getTacticalActionOptions(state, 'a', { includeEmptyTargets: false });
    const strikeOption = options.find((option) => option.action.id === 'strike');
    const fireBoltOption = options.find((option) => option.action.id === 'fire-bolt');
    const burstOption = options.find((option) => option.action.id === 'burst');

    expect(strikeOption?.category).toBe('attack');
    expect(strikeOption?.isUsable).toBe(true);
    expect(strikeOption?.targetableCreatures.map((target) => target.id)).toEqual(['b']);
    expect(fireBoltOption?.isUsable).toBe(false);
    expect(fireBoltOption?.unavailableReason).toBe('Needs 1 Slots.');
    expect(burstOption?.category).toBe('savingThrow');
    expect(burstOption?.areaOptions.length).toBeGreaterThan(0);
  });

  it('marks action-cost availability from the current turn resources', () => {
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
      creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
    ], 3, 1);
    state.turnResources.a.actionUsed = true;

    const strikeOption = getTacticalActionOptions(state, 'a').find((option) => option.action.id === 'strike');

    expect(strikeOption?.isUsable).toBe(false);
    expect(strikeOption?.unavailableReason).toBe('Alpha has already used their action this turn.');
  });
});
