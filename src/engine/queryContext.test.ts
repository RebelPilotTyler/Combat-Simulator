import { describe, expect, it } from 'vitest';
import {
  createCombatState,
  getOpportunityAttackCandidatesForMovementPath,
  getTargetsInShape,
  rollInitiative
} from './combat';
import { hasCondition } from './conditions';
import { getReachableMovementSquares } from './movement';
import { createCombatQueryContext } from './queryContext';
import { getShapeSquares, getTileHeight, isBlocked, position3DKey, positionKey } from './shapes';
import { hasLineOfSight } from './targeting';
import { areHostile, getTeamLabel } from './teams';
import type { ActionDefinition, Creature } from './types';

const abilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

const strike: ActionDefinition = {
  id: 'strike',
  name: 'Strike',
  kind: 'meleeAttack',
  type: 'meleeAttack',
  actionCost: 'action',
  tags: ['attack', 'melee'],
  range: 1,
  reach: 5,
  attackBonus: 5,
  damage: { dice: '1d6+2', type: 'slashing' },
  shape: { type: 'single' },
  effects: []
};

const burst: ActionDefinition = {
  id: 'burst',
  name: 'Burst',
  kind: 'savingThrowEffect',
  type: 'savingThrowEffect',
  actionCost: 'action',
  tags: ['spell', 'area'],
  range: 6,
  damage: { dice: '2d6', type: 'fire' },
  save: { ability: 'dex', dc: 13, halfDamageOnSuccess: true },
  shape: { type: 'radius', radius: 1 },
  effects: []
};

function creature(overrides: Partial<Creature>): Creature {
  return {
    id: 'creature',
    name: 'Creature',
    team: 'players',
    controlMode: 'manual',
    hp: 20,
    maxHp: 20,
    ac: 12,
    abilityScores,
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 0, y: 0 },
    conditions: [],
    actions: [strike],
    ...overrides
  };
}

describe('combat query context', () => {
  it('indexes terrain, creatures, teams, and normalized conditions without changing lookup results', () => {
    const mover = creature({
      id: 'mover',
      conditions: [{
        id: 'prone',
        durationType: 'permanentUntilRemoved',
        stackBehavior: 'none',
        stackCount: 1,
        intensity: 1
      }],
      position: { x: 1, y: 1, z: 2 }
    });
    const enemy = creature({ id: 'enemy', team: 'enemies', position: { x: 1, y: 1, z: 2 } });
    const state = createCombatState(
      [mover, enemy],
      4,
      4,
      [{ x: 2, y: 1 }],
      [{ x: 1, y: 1, z: 2 }]
    );
    state.grid.heights = [
      { x: 1, y: 1, z: 2 },
      { x: 1, y: 1, z: 3 }
    ];
    const query = createCombatQueryContext(state);

    expect(query.creatureById.get('mover')).toBe(state.creatures[0]);
    expect(query.creaturesByPosition.get(position3DKey(state.creatures[0].position))).toEqual(state.creatures);
    expect(query.creaturesByTile.get(positionKey(state.creatures[0].position))).toEqual(state.creatures);
    expect(isBlocked({ x: 2, y: 1 }, state.grid, query.grid)).toBe(isBlocked({ x: 2, y: 1 }, state.grid));
    expect(getTileHeight({ x: 1, y: 1 }, state.grid, query.grid)).toBe(getTileHeight({ x: 1, y: 1 }, state.grid));
    expect(getTileHeight({ x: 1, y: 1 }, state.grid, query.grid)).toBe(2);
    expect(hasCondition(state.creatures[0], 'prone', query.conditions)).toBe(hasCondition(state.creatures[0], 'prone'));
    expect(getTeamLabel(state, state.creatures[1].team, query.teams)).toBe(getTeamLabel(state, state.creatures[1].team));
    expect(areHostile(state.creatures[0], state.creatures[1], state, query.teams)).toBe(
      areHostile(state.creatures[0], state.creatures[1], state)
    );
  });

  it('reuses shape and line-of-sight results only within the owning combat snapshot', () => {
    const state = createCombatState(
      [creature({ id: 'caster' })],
      5,
      5,
      [{ x: 2, y: 0 }]
    );
    const query = createCombatQueryContext(state);
    const shape = { type: 'radius' as const, radius: 2 };
    const firstShape = getShapeSquares(shape, { x: 1, y: 1 }, state.grid, 'north', query);
    const secondShape = getShapeSquares(shape, { x: 1, y: 1 }, state.grid, 'north', query);

    expect(secondShape).toBe(firstShape);
    expect(firstShape).toEqual(getShapeSquares(shape, { x: 1, y: 1 }, state.grid, 'north'));
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 4, y: 0 }, query)).toBe(false);
    expect(query.lineOfSight.size).toBe(1);
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 4, y: 0 }, query)).toBe(false);
    expect(query.lineOfSight.size).toBe(1);

    const clearState = createCombatState([creature({ id: 'caster' })], 5, 5);
    expect(hasLineOfSight(clearState, { x: 0, y: 0 }, { x: 4, y: 0 }, query)).toBe(true);
    expect(query.lineOfSight.size).toBe(1);
  });

  it('keeps movement paths, opportunity candidates, and shape targets identical with indexed queries', () => {
    const mover = creature({ id: 'mover', speed: 15, actions: [burst, strike], position: { x: 0, y: 0 } });
    const enemy = creature({ id: 'enemy', team: 'enemies', position: { x: 1, y: 0 } });
    const caster = creature({ id: 'caster', actions: [burst], position: { x: 0, y: 2 } });
    const state = rollInitiative(
      createCombatState([mover, enemy, caster], 5, 4, [{ x: 1, y: 1 }]),
      () => 0.5
    );
    const query = createCombatQueryContext(state);
    const plainMovement = getReachableMovementSquares(state, mover.id);
    const indexedMovement = getReachableMovementSquares(state, mover.id, query);
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 }
    ];

    expect(indexedMovement).toEqual(plainMovement);
    expect(getOpportunityAttackCandidatesForMovementPath(state, mover, path, query)).toEqual(
      getOpportunityAttackCandidatesForMovementPath(state, mover, path)
    );
    expect(getTargetsInShape(state, burst.id, { x: 2, y: 2 }, 'north', query)).toEqual(
      getTargetsInShape(state, burst.id, { x: 2, y: 2 }, 'north')
    );
  });
});
