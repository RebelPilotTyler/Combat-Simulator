import { describe, expect, it } from 'vitest';
import {
  applyCondition,
  createCombatState,
  endTurn,
  moveActiveCreature,
  performAttackAction,
  rollInitiative,
  runBotTurnMovementStep
} from './combat';
import { createAppliedCondition } from './conditions';
import type { ActionDefinition, CombatState, Creature } from './types';
import {
  configurePerformanceProfiling,
  getPerformanceSnapshot,
  resetPerformanceMetrics
} from '../performance/profiling';

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
  effects: [],
  resourceCosts: [{ resourceId: 'stamina', amount: 1, consumeOn: 'use' }]
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
    resources: [{ id: 'stamina', name: 'Stamina', current: 3, max: 3, resetOn: 'turnStart' }],
    ...overrides
  };
}

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

function expectOperationToPreserveInput(
  state: CombatState,
  operation: (input: CombatState) => CombatState
): CombatState {
  const before = JSON.stringify(state);
  const result = operation(state);

  expect(JSON.stringify(state)).toBe(before);
  expect(result).not.toBe(state);
  return result;
}

describe('combat state mutation parity', () => {
  it('keeps representative combat and bot entry points immutable', () => {
    const initial = createCombatState(
      [
        creature({ id: 'hero', name: 'Hero' }),
        creature({
          id: 'enemy',
          name: 'Enemy',
          team: 'enemies',
          controlMode: 'bot',
          botProfile: 'aggressiveMelee',
          position: { x: 2, y: 0 }
        })
      ],
      5,
      3,
      [{ x: 4, y: 2 }],
      [{ x: 3, y: 2, z: 5 }]
    );

    let state = expectOperationToPreserveInput(initial, (input) =>
      rollInitiative(input, sequence([0.9, 0.1]))
    );
    state = expectOperationToPreserveInput(state, (input) =>
      moveActiveCreature(input, { x: 1, y: 0 })
    );
    state = expectOperationToPreserveInput(state, (input) =>
      performAttackAction(input, 'strike', 'enemy', sequence([0.9, 0.5]))
    );
    state = expectOperationToPreserveInput(state, (input) =>
      applyCondition(input, 'enemy', 'marked', {
        sourceCreatureId: 'hero',
        durationType: 'rounds',
        remainingRounds: 2,
        metadata: { source: 'parity-test' }
      })
    );
    state = expectOperationToPreserveInput(state, endTurn);

    const botState = rollInitiative(
      createCombatState([
        creature({
          id: 'bot',
          name: 'Bot',
          team: 'enemies',
          controlMode: 'bot',
          botProfile: 'aggressiveMelee'
        }),
        creature({ id: 'target', name: 'Target', position: { x: 3, y: 0 } })
      ], 6, 3),
      sequence([0.9, 0.1])
    );

    expectOperationToPreserveInput(botState, runBotTurnMovementStep);
  });

  it('keeps mutable nested data isolated in both directions', () => {
    const initial = createCombatState(
      [
        creature({
          id: 'hero',
          name: 'Hero',
          conditions: [
            createAppliedCondition('focused', {
              metadata: { source: 'original' },
              tags: ['beneficial']
            })
          ]
        }),
        creature({ id: 'enemy', name: 'Enemy', team: 'enemies', position: { x: 1, y: 0 } })
      ],
      4,
      3,
      [{ x: 3, y: 2 }],
      [{ x: 2, y: 2, z: 5 }]
    );
    const state = rollInitiative(initial, sequence([0.9, 0.1]));
    const result = applyCondition(state, 'enemy', 'marked', {
      sourceCreatureId: 'hero',
      metadata: { source: 'result' }
    });
    const stateBeforeResultMutation = JSON.stringify(state);

    result.grid.blocked[0].x = 99;
    result.grid.heights![0].z = 99;
    result.teams[0].name = 'Changed team';
    result.creatures[0].abilityScores.str = 99;
    result.creatures[0].actions[0].damage!.dice = '99d99';
    result.creatures[0].resources![0].current = 0;
    result.creatures[0].conditions[0].metadata!.source = 'changed';
    result.turnResources.hero.remainingMovement = 0;
    result.initiative[0].roll = 0;
    result.log[0].message = 'Changed log';
    result.rulesSettings!.flanking!.enabled = true;

    expect(JSON.stringify(state)).toBe(stateBeforeResultMutation);

    const resultBeforeInputMutation = JSON.stringify(result);
    state.grid.blocked[0].y = 99;
    state.creatures[0].actions[0].tags.push('changed');
    state.creatures[0].resources![0].current = 1;
    state.turnResources.hero.remainingMovement = 5;
    state.log[0].message = 'Changed original log';

    expect(JSON.stringify(result)).toBe(resultBeforeInputMutation);
  });

  it('uses full normalization once, then the engine-state fast paths', () => {
    configurePerformanceProfiling(true);
    resetPerformanceMetrics();
    try {
      const initial = createCombatState([
        creature({
          id: 'hero',
          name: 'Hero',
          actions: [
            strike,
            {
              id: 'wait',
              name: 'Wait',
              kind: 'basicAction',
              actionCost: 'action',
              tags: [],
              range: 0,
              effects: []
            }
          ]
        }),
        creature({ id: 'enemy', name: 'Enemy', team: 'enemies', position: { x: 2, y: 0 } })
      ], 4, 3);
      const active = rollInitiative(initial, sequence([0.9, 0.1]));

      const moved = moveActiveCreature(active, { x: 1, y: 0 });

      expect(getPerformanceSnapshot().counters).toMatchObject({
        'engine.state.normalize-full': 1,
        'engine.state.normalize-fast-path': 1,
        'engine.state.ensure-turn-fast-path': 1
      });
      expect(Object.prototype.hasOwnProperty.call(moved.creatures[0].actions[1], 'type')).toBe(true);
      expect(moved.creatures[0].actions[1].type).toBeUndefined();
    } finally {
      configurePerformanceProfiling(false);
      resetPerformanceMetrics();
    }
  });

  it('fully normalizes the next operation after a mutable combat hook runs', () => {
    const active = rollInitiative(
      createCombatState([
        creature({ id: 'hero', name: 'Hero' }),
        creature({ id: 'enemy', name: 'Enemy', team: 'enemies', position: { x: 2, y: 0 } })
      ], 4, 3),
      sequence([0.9, 0.1])
    );
    const hookResult = endTurn(active, {
      onTurnEnd: (_state, endingCreature) => {
        endingCreature.team = ' Players ';
        endingCreature.actions[0].tags = undefined as unknown as string[];
      }
    });

    expect(hookResult.creatures[0].team).toBe(' Players ');
    expect(hookResult.creatures[0].actions[0].tags).toBeUndefined();

    const normalized = applyCondition(hookResult, 'hero', 'marked');

    expect(normalized.creatures[0].team).toBe('team-1');
    expect(normalized.creatures[0].actions[0].tags).toEqual([]);
  });
});
