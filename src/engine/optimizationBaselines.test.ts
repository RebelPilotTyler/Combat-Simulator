import { describe, expect, it } from 'vitest';
import {
  createCombatState,
  getBotTurnPreview,
  getOpportunityAttackCandidatesForMovementPath,
  getTargetsInShape,
  rollInitiative
} from './combat';
import { getReachableMovementSquares } from './movement';
import type { ActionDefinition, Creature, GridPosition } from './types';

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

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

function positionLabel(position: GridPosition): string {
  return `${position.x},${position.y},${position.z ?? 0}`;
}

describe('optimization semantic baselines', () => {
  it('preserves exact reachable costs and paths around blocking terrain', () => {
    const mover = creature({ id: 'mover', name: 'Mover', speed: 10 });
    const state = createCombatState([mover], 3, 2, [{ x: 1, y: 0 }]);

    const snapshot = getReachableMovementSquares(state, mover.id).map((option) => ({
      destination: positionLabel(option.position),
      costFeet: option.costFeet,
      path: option.path.map(positionLabel)
    }));

    expect(snapshot).toEqual([
      { destination: '0,1,0', costFeet: 5, path: ['0,0,0', '0,1,0'] },
      { destination: '1,1,0', costFeet: 5, path: ['0,0,0', '1,1,0'] },
      { destination: '2,0,0', costFeet: 10, path: ['0,0,0', '1,1,0', '2,0,0'] },
      { destination: '2,1,0', costFeet: 10, path: ['0,0,0', '1,1,0', '2,1,0'] }
    ]);
  });

  it('preserves the exact opportunity attacker and triggering path segment', () => {
    const mover = creature({ id: 'mover', name: 'Mover', position: { x: 0, y: 0 } });
    const enemy = creature({ id: 'enemy', name: 'Enemy', team: 'enemies', position: { x: 1, y: 0 } });
    const state = createCombatState([mover, enemy], 4, 4);
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 }
    ];

    const snapshot = getOpportunityAttackCandidatesForMovementPath(state, state.creatures[0], path).map((candidate) => ({
      creatureId: candidate.creature.id,
      from: positionLabel(candidate.from),
      to: positionLabel(candidate.to)
    }));

    expect(snapshot).toEqual([
      { creatureId: 'enemy', from: '0,1,0', to: '0,2,0' }
    ]);
  });

  it('preserves area target membership across teams, blocked cells, and defeated creatures', () => {
    const caster = creature({ id: 'caster', name: 'Caster', actions: [burst], position: { x: 0, y: 1 } });
    const state = rollInitiative(
      createCombatState(
        [
          caster,
          creature({ id: 'enemy-center', name: 'Enemy Center', team: 'enemies', position: { x: 2, y: 1 } }),
          creature({ id: 'enemy-east', name: 'Enemy East', team: 'enemies', position: { x: 3, y: 1 } }),
          creature({ id: 'ally-south', name: 'Ally South', position: { x: 2, y: 2 } }),
          creature({
            id: 'defeated-west',
            name: 'Defeated West',
            team: 'enemies',
            hp: 0,
            position: { x: 1, y: 1 },
            conditions: [{
              id: 'defeated',
              durationType: 'permanentUntilRemoved',
              stackBehavior: 'none',
              stackCount: 1,
              intensity: 1
            }]
          }),
          creature({ id: 'blocked-southeast', name: 'Blocked Southeast', team: 'enemies', position: { x: 3, y: 2 } })
        ],
        5,
        4,
        [{ x: 3, y: 2 }]
      ),
      sequence([0.9, 0.1, 0.1, 0.1, 0.1, 0.1])
    );

    expect(getTargetsInShape(state, burst.id, { x: 2, y: 1 }).map((target) => target.id)).toEqual([
      'enemy-center',
      'enemy-east',
      'ally-south'
    ]);
  });

  it('preserves deterministic bot intent before execution', () => {
    const bot = creature({
      id: 'bot',
      name: 'Bot',
      team: 'enemies',
      controlMode: 'bot',
      botProfile: 'aggressiveMelee',
      speed: 15,
      position: { x: 0, y: 0 }
    });
    const target = creature({ id: 'target', name: 'Target', position: { x: 3, y: 0 } });
    const state = rollInitiative(createCombatState([bot, target], 6, 3), sequence([0.9, 0.1]));

    const preview = getBotTurnPreview(state);

    expect({
      order: preview.order,
      movement: preview.movement,
      action: preview.action
        ? {
            actionId: preview.action.actionId,
            targetIds: preview.action.targetIds
          }
        : undefined,
      willDodgeOrWait: preview.willDodgeOrWait
    }).toEqual({
      order: 'move-then-action',
      movement: {
        from: { x: 0, y: 0, z: 0 },
        to: { x: 2, y: 0, z: 0 },
        costFeet: 10,
        steps: 2
      },
      action: {
        actionId: 'strike',
        targetIds: ['target']
      },
      willDodgeOrWait: false
    });
  });
});
