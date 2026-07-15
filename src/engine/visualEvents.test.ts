import { describe, expect, it } from 'vitest';
import {
  applyCondition,
  applyHpChange,
  createCombatState,
  moveActiveCreature,
  performAttackAction,
  performSavingThrowAction,
  removeCondition,
  rollInitiative
} from './combat';
import { createAppliedCondition } from './conditions';
import { serializeCombatState } from './serialization';
import { createVisualEvent, getActiveVisualEvents, pruneVisualEvents } from './visualEvents';
import type { ActionDefinition, Creature, VisualEventKind } from './types';

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

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

const burst: ActionDefinition = {
  id: 'burst',
  name: 'Burst',
  kind: 'savingThrowEffect',
  type: 'savingThrowEffect',
  actionCost: 'action',
  tags: ['area'],
  range: 4,
  damage: { dice: '2d6' },
  save: { ability: 'dex', dc: 12, halfDamageOnSuccess: true },
  shape: { type: 'radius', radius: 1 },
  effects: []
};

function creature(overrides: Partial<Creature>): Creature {
  return {
    id: 'a',
    name: 'Alpha',
    team: 'players',
    hp: 20,
    maxHp: 20,
    ac: 12,
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 0, y: 0 },
    ...overrides,
    abilityScores: overrides.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    conditions: overrides.conditions ?? [],
    actions: overrides.actions ?? [strike, burst]
  };
}

function eventKinds(state: { visualEvents?: Array<{ kind: VisualEventKind }> }): VisualEventKind[] {
  return (state.visualEvents ?? []).map((event) => event.kind);
}

describe('visual events', () => {
  it('creates and prunes temporary visual events', () => {
    const event = createVisualEvent({ kind: 'attackHit', creatureId: 'b' }, 1000);

    expect(event).toMatchObject({
      kind: 'attackHit',
      creatureId: 'b',
      createdAt: 1000,
      durationMs: 650
    });
    expect(getActiveVisualEvents([event], 1200)).toHaveLength(1);
    expect(pruneVisualEvents([event], 1700)).toHaveLength(0);
  });

  it('emits attack, damage, healing, and condition visual events without exporting them', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const hit = performAttackAction(state, 'strike', 'b', sequence([0.7, 0]));
    expect(eventKinds(hit)).toEqual(expect.arrayContaining(['attackHit', 'attackImpact', 'damageDealt']));

    const healed = applyHpChange(hit, 'b', 3, 'heal');
    expect(eventKinds(healed)).toContain('healingReceived');

    const conditioned = applyCondition(healed, 'b', 'poisoned');
    expect(eventKinds(conditioned)).toContain('conditionApplied');

    const removed = removeCondition(conditioned, 'b', 'poisoned');
    expect(eventKinds(removed)).toContain('conditionRemoved');
    expect(JSON.parse(serializeCombatState(removed))).not.toHaveProperty('visualEvents');
  });

  it('emits miss, critical, saving throw, movement, opportunity, defeated, and resource events', () => {
    const resourceStrike: ActionDefinition = {
      ...strike,
      id: 'resource-strike',
      resourceCosts: [{ resourceId: 'focus', amount: 1, consumeOn: 'use' }]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [resourceStrike, burst],
          resources: [{ id: 'focus', name: 'Focus', current: 2, max: 2, resetOn: 'manual' }],
          position: { x: 0, y: 0 }
        }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const miss = performAttackAction(state, 'resource-strike', 'b', sequence([0]));
    expect(eventKinds(miss)).toEqual(expect.arrayContaining(['resourceSpent', 'attackMiss']));

    const criticalReady = {
      ...state,
      turnState: { ...state.turnState, actionUsed: false },
      turnResources: { ...state.turnResources, a: { ...state.turnResources.a, actionUsed: false } }
    };
    const critical = performAttackAction(criticalReady, 'resource-strike', 'b', sequence([0.999, 0.999, 0.999]));
    expect(eventKinds(critical)).toEqual(expect.arrayContaining(['criticalHit', 'damageDealt']));

    const save = performSavingThrowAction(state, 'burst', ['b'], sequence([0.9, 0, 0]));
    expect(eventKinds(save)).toContain('savingThrowSuccess');

    const failedSave = performSavingThrowAction(state, 'burst', ['b'], sequence([0, 0, 0]));
    expect(eventKinds(failedSave)).toContain('savingThrowFailure');

    const movementState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
      ], 5, 5),
      sequence([0.9, 0.1])
    );
    const moved = moveActiveCreature(movementState, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
    expect(eventKinds(moved)).toEqual(expect.arrayContaining(['movementComplete', 'opportunityAttackTriggered']));

    const defeatedState = createCombatState([
      creature({ id: 'a', name: 'Alpha', hp: 1, conditions: [createAppliedCondition('poisoned')] })
    ]);
    const defeated = applyHpChange(defeatedState, 'a', 5, 'damage');
    expect(eventKinds(defeated)).toContain('creatureDefeated');
  });

  it('emits colored attack impact and shape effect events from action visual styles', () => {
    const emberStrike: ActionDefinition = {
      ...strike,
      id: 'ember-strike',
      damage: { dice: '1d6+2', type: 'fire' },
      visual: { color: '#ff5500' }
    };
    const greenBurst: ActionDefinition = {
      ...burst,
      id: 'green-burst',
      visual: { color: 'green' }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [emberStrike, greenBurst], position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const hit = performAttackAction(state, 'ember-strike', 'b', sequence([0.7, 0]));
    expect(hit.visualEvents?.find((event) => event.kind === 'attackImpact')).toMatchObject({
      color: '#ff5500',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 0 }
    });

    const freshTurn = {
      ...state,
      turnState: { ...state.turnState, actionUsed: false },
      turnResources: { ...state.turnResources, a: { ...state.turnResources.a, actionUsed: false } }
    };
    const shaped = performSavingThrowAction(freshTurn, 'green-burst', ['b'], sequence([0, 0, 0]), {}, { origin: { x: 1, y: 0 } });
    expect(shaped.visualEvents?.find((event) => event.kind === 'shapeEffect')).toMatchObject({
      color: 'green',
      origin: { x: 1, y: 0, z: 0 },
      shape: { type: 'radius', radius: 1 },
      targetIds: ['b']
    });
  });
});
