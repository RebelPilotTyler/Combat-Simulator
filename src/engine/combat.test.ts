import { describe, expect, it } from 'vitest';
import {
  createCombatState,
  endTurn,
  applyCondition,
  getAttackDebugStats,
  getExpectedHitChance,
  getOpportunityAttackCandidatesForMovementPath,
  moveActiveCreature,
  performDisengageAction,
  performCreatureUtilityAction,
  performGrappleAction,
  performHelpAction,
  performHideAction,
  performAttackAction,
  performBasicAction,
  performMultiattackAction,
  performReadyAction,
  performSavingThrowAction,
  performShoveAction,
  resetAllResources,
  resolvePendingReaction,
  removeCondition,
  rollInitiative,
  setFlankingEnabled
} from './combat';
import { collectAbilityCheckModifiers, createAppliedCondition, getConditionLabel, hasCondition, resolveRollMode } from './conditions';
import { createAppliedConditionFromTemplate, normalizeCustomConditionTemplate } from './customConditions';
import { getAvailableActions, getEffectiveAC, getEffectiveSpeed, getUnavailableActionReason } from './features';
import { getMovementOption, getReachableMovementSquares } from './movement';
import { formatBaseEffectiveNumber, getConditionTag, getHpPercent } from './presentation';
import { parseCombatStateJson, serializeCombatState, validateCombatStateShape } from './serialization';
import { getOpportunityAttackCandidates } from './targeting';
import type { ActionDefinition, Creature } from './types';

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

function countingRandom(values: number[]) {
  let index = 0;
  return {
    get count() {
      return index;
    },
    random: () => values[index++] ?? 0
  };
}

function cyclingD20Source() {
  let index = 0;
  return () => {
    const value = ((index % 20) + 0.5) / 20;
    index += 1;
    return value;
  };
}

const baseCreature: Creature = {
  id: 'a',
  name: 'Alpha',
  team: 'players',
  hp: 10,
  maxHp: 10,
  ac: 10,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  speed: 30,
  position: { x: 0, y: 0 },
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
      attackBonus: 4,
      damage: { dice: '1d6+2' },
      shape: { type: 'single' },
      effects: [],
      description: 'Test melee attack.'
    },
    {
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
      effects: [
        {
          id: 'burst-damage',
          name: 'Burst Damage',
          type: 'damage',
          damage: { dice: '2d6' },
          save: { ability: 'dex', dc: 12, halfDamageOnSuccess: true }
        }
      ],
      description: 'Test area burst.'
    }
  ]
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

function findCreatureForTest(state: { creatures: Creature[] }, creatureId: string): Creature {
  const found = state.creatures.find((candidate) => candidate.id === creatureId);
  if (!found) {
    throw new Error(`Missing test creature: ${creatureId}`);
  }
  return found;
}

describe('combat engine', () => {
  it('rolls initiative and tracks the active creature', () => {
    const state = createCombatState([
      creature({ id: 'a', name: 'Alpha', abilityScores: { ...baseCreature.abilityScores, dex: 10 } }),
      creature({ id: 'b', name: 'Bravo', abilityScores: { ...baseCreature.abilityScores, dex: 14 } })
    ]);

    const result = rollInitiative(state, sequence([0.2, 0.1]));

    expect(result.initiative.map((entry) => entry.creatureId)).toEqual(['b', 'a']);
    expect(result.round).toBe(1);
    expect(result.activeCreatureId).toBe('b');
    expect(result.turnState).toMatchObject({
      creatureId: 'b',
      remainingMovement: 30,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false
    });
    expect(result.log.some((entry) => entry.type === 'initiative')).toBe(true);
  });

  it('ends turns and skips defeated creatures', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', hp: 10 }),
        creature({ id: 'b', name: 'Bravo', hp: 0, conditions: [createAppliedCondition('defeated')] }),
        creature({ id: 'c', name: 'Charlie', hp: 10 })
      ]),
      sequence([0.9, 0.8, 0.7])
    );

    const result = endTurn(state);

    expect(result.activeCreatureId).toBe('c');
    expect(result.turnState).toMatchObject({
      creatureId: 'c',
      remainingMovement: 30,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false
    });
  });

  it('highlights reachable movement and excludes occupied destinations', () => {
    const state = rollInitiative(
      createCombatState(
        [
          creature({ id: 'a', name: 'Alpha', speed: 15, position: { x: 0, y: 0 } }),
          creature({ id: 'b', name: 'Bravo', position: { x: 0, y: 1 } })
        ],
        5,
        5,
        [{ x: 1, y: 0 }]
      ),
      sequence([0.9, 0.1])
    );

    const reachable = getReachableMovementSquares(state, 'a').map((option) => `${option.position.x},${option.position.y}`);

    expect(reachable).not.toContain('1,0');
    expect(reachable).not.toContain('0,1');
    expect(reachable).toContain('0,2');
  });

  it('moves active creatures, spends movement, and rejects unreachable squares', () => {
    const state = rollInitiative(
      createCombatState(
        [
          creature({ id: 'a', name: 'Alpha', speed: 15, position: { x: 0, y: 0 } }),
          creature({ id: 'b', name: 'Bravo', position: { x: 4, y: 4 } })
        ],
        5,
        5,
        [{ x: 1, y: 0 }]
      ),
      sequence([0.9, 0.1])
    );

    const moved = moveActiveCreature(state, { x: 0, y: 2 });
    const active = moved.creatures.find((candidate) => candidate.id === 'a');

    expect(active?.position).toEqual({ x: 0, y: 2, z: 0 });
    expect(moved.turnState.remainingMovement).toBe(5);
    expect(moved.log[0].type).toBe('movement');

    const rejected = moveActiveCreature(moved, { x: 2, y: 0 });
    expect(rejected.creatures.find((candidate) => candidate.id === 'a')?.position).toEqual({ x: 0, y: 2, z: 0 });
  });

  it('performs attack actions and applies damage on hit', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12 })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'strike', 'b', sequence([0.7, 0.49]));
    const target = result.creatures.find((candidate) => candidate.id === 'b');

    expect(target?.hp).toBe(5);
    expect(result.turnState.actionUsed).toBe(true);
    expect(result.log.some((entry) => entry.message.includes('Hit'))).toBe(true);
  });

  it('hits when attack total equals or exceeds AC and misses below AC', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const equal = performAttackAction(state, 'strike', 'b', sequence([0.35, 0]));
    expect(equal.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(7);
    expect(equal.log.some((entry) => entry.message.includes('Hit'))).toBe(true);

    const below = performAttackAction(state, 'strike', 'b', sequence([0.3]));
    expect(below.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(below.log.some((entry) => entry.message.includes('Miss'))).toBe(true);
  });

  it('natural 1 misses and natural 20 hits as a critical', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [{ ...baseCreature.actions[0], attackBonus: 99 }] }),
        creature({ id: 'b', name: 'Bravo', hp: 30, ac: 5, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const natOne = performAttackAction(state, 'strike', 'b', sequence([0]));
    expect(natOne.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(30);
    expect(natOne.log.some((entry) => entry.message.includes('Natural 1 miss'))).toBe(true);

    const hardTarget = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 30, ac: 99, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );
    const natTwenty = performAttackAction(hardTarget, 'strike', 'b', sequence([0.999, 0, 0.999]));
    expect(natTwenty.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(21);
    expect(natTwenty.log.some((entry) => entry.message.includes('Critical hit'))).toBe(true);
    expect(natTwenty.log.some((entry) => entry.message.includes('(critical)'))).toBe(true);
  });

  it('uses one d20 normally, two with advantage or disadvantage, and one when both cancel', () => {
    const baseState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 99, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );
    const normalCounter = countingRandom([0.1, 0.1, 0.1]);
    performAttackAction(baseState, 'strike', 'b', normalCounter.random);
    expect(normalCounter.count).toBe(1);

    const advantageState = applyCondition(baseState, 'a', 'helped');
    const advantageCounter = countingRandom([0.1, 0.2, 0.1]);
    const advantage = performAttackAction(advantageState, 'strike', 'b', advantageCounter.random);
    expect(advantageCounter.count).toBe(2);
    expect(advantage.log.some((entry) => entry.message.includes('advantage'))).toBe(true);
    expect(advantage.log.some((entry) => entry.message.includes('Helped'))).toBe(true);

    const disadvantageState = applyCondition(baseState, 'b', 'dodging');
    const disadvantageCounter = countingRandom([0.1, 0.2, 0.1]);
    const disadvantage = performAttackAction(disadvantageState, 'strike', 'b', disadvantageCounter.random);
    expect(disadvantageCounter.count).toBe(2);
    expect(disadvantage.log.some((entry) => entry.message.includes('disadvantage'))).toBe(true);

    const cancelState = applyCondition(disadvantageState, 'a', 'helped');
    const cancelCounter = countingRandom([0.1, 0.2, 0.1]);
    const cancel = performAttackAction(cancelState, 'strike', 'b', cancelCounter.random);
    const cancelAttackLog = cancel.log.find((entry) => entry.type === 'attack')?.message ?? '';
    expect(cancelCounter.count).toBe(1);
    expect(cancelAttackLog.includes('advantage')).toBe(false);
    expect(cancelAttackLog.includes('disadvantage')).toBe(false);
  });

  it('calculates expected hit chance and long-run debug stats', () => {
    expect(getExpectedHitChance(4, 12, 'normal')).toBeCloseTo(0.65);

    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );
    const stats = getAttackDebugStats(state, 'strike', 'b', 1000, cyclingD20Source());

    expect(stats.hits).toBe(650);
    expect(stats.misses).toBe(350);
    expect(stats.crits).toBe(50);
    expect(stats.hitPercentage).toBeCloseTo(stats.expectedHitPercentage);
  });

  it('prevents using more than one action in a turn', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12 })
      ]),
      sequence([0.9, 0.1])
    );

    const afterDash = performBasicAction(state, 'Dash');
    const afterAttack = performAttackAction(afterDash, 'strike', 'b', sequence([0.99, 0.99]));

    expect(afterDash.turnState.remainingMovement).toBe(60);
    expect(afterDash.turnState.actionUsed).toBe(true);
    expect(afterAttack.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(afterAttack.log[0].message).toContain('already used');
  });

  it('performs saving throw effects with half damage on success', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, abilityScores: { ...baseCreature.abilityScores, dex: 14 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performSavingThrowAction(state, 'burst', ['b'], sequence([0.9, 0.49, 0.49]));
    const target = result.creatures.find((candidate) => candidate.id === 'b');

    expect(target?.hp).toBe(7);
    expect(result.turnState.actionUsed).toBe(true);
    expect(result.log.some((entry) => entry.type === 'save')).toBe(true);
  });

  it('validates saving throw area origin against action range before spending the action', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 5, y: 0 }, abilityScores: { ...baseCreature.abilityScores, dex: 8 } })
      ]),
      sequence([0.9, 0.1])
    );

    const invalid = performSavingThrowAction(state, 'burst', ['b'], sequence([0.1]), {}, { origin: { x: 5, y: 0 } });
    expect(findCreatureForTest(invalid, 'b').hp).toBe(10);
    expect(invalid.turnState.actionUsed).toBe(false);
    expect(invalid.log[0].message).toContain('out of range');

    const valid = performSavingThrowAction(state, 'burst', ['b'], sequence([0.1, 0.49, 0.49]), {}, { origin: { x: 4, y: 0 } });
    expect(findCreatureForTest(valid, 'b').hp).toBe(4);
    expect(valid.turnState.actionUsed).toBe(true);
  });

  it('includes aerial creatures in 3D radius saving throw effects', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0, z: 2 } }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 1, y: 0, z: 2 }, abilityScores: { ...baseCreature.abilityScores, dex: 8 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performSavingThrowAction(state, 'burst', ['b'], sequence([0.1, 0.49, 0.49]), {}, { origin: { x: 0, y: 0, z: 2 } });

    expect(findCreatureForTest(result, 'b').hp).toBe(4);
    expect(result.turnState.actionUsed).toBe(true);
  });

  it('applies Dodge until the start of the creature turn', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo' })
      ]),
      sequence([0.9, 0.1])
    );

    const afterDodge = performBasicAction(state, 'Dodge');
    expect(hasCondition(afterDodge.creatures.find((candidate) => candidate.id === 'a')!, 'dodging')).toBe(true);

    const backToA = endTurn(endTurn(afterDodge));
    expect(backToA.activeCreatureId).toBe('a');
    expect(hasCondition(backToA.creatures.find((candidate) => candidate.id === 'a')!, 'dodging')).toBe(false);
  });

  it('gives disadvantage to attacks against dodging creatures', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 10, conditions: [createAppliedCondition('dodging')] })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'strike', 'b', sequence([0.7, 0.05, 0.99]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('disadvantage'))).toBe(true);
  });

  it('gives dodging creatures advantage on Dexterity saving throws', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({
          id: 'b',
          name: 'Bravo',
          hp: 10,
          abilityScores: { ...baseCreature.abilityScores, dex: 10 },
          conditions: [createAppliedCondition('dodging')]
        })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performSavingThrowAction(state, 'burst', ['b'], sequence([0, 0.99, 0.99, 0.99]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(4);
    expect(result.log.some((entry) => entry.message.includes('advantage'))).toBe(true);
  });

  it('rolls concentration saves after damage and removes concentration on failure', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', hp: 20, maxHp: 20, position: { x: 1, y: 0 }, conditions: [createAppliedCondition('concentrating')] })
      ]),
      sequence([0.9, 0.1])
    );

    const failed = performAttackAction(state, 'strike', 'b', sequence([0.5, 0, 0]));

    expect(hasCondition(findCreatureForTest(failed, 'b'), 'concentrating')).toBe(false);
    expect(failed.log.some((entry) => entry.message.includes('concentration save'))).toBe(true);
    expect(failed.log.some((entry) => entry.message.includes('loses concentration'))).toBe(true);

    const succeeded = performAttackAction(state, 'strike', 'b', sequence([0.5, 0, 0.99]));

    expect(hasCondition(findCreatureForTest(succeeded, 'b'), 'concentrating')).toBe(true);
    expect(succeeded.log.some((entry) => entry.message.includes('concentration save'))).toBe(true);
  });

  it('applies and removes conditions with log entries', () => {
    const state = createCombatState([creature({ id: 'a', name: 'Alpha' })]);

    const applied = applyCondition(state, 'a', 'poisoned');
    expect(hasCondition(applied.creatures[0], 'poisoned')).toBe(true);
    expect(applied.log[0].message).toContain('applied');

    const removed = removeCondition(applied, 'a', 'poisoned');
    expect(hasCondition(removed.creatures[0], 'poisoned')).toBe(false);
    expect(removed.log[0].message).toContain('removed');
  });

  it('labels concentrating conditions with the tracked effect name', () => {
    const condition = createAppliedCondition('concentrating', {
      metadata: { concentrationName: 'Bless' }
    });

    expect(getConditionLabel(condition)).toBe('Concentrating: Bless');
  });

  it('expires target-start and round-duration conditions', () => {
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          conditions: [createAppliedCondition('dodging', { durationType: 'untilStartOfTargetTurn' })]
        }),
        creature({
          id: 'b',
          name: 'Bravo',
          conditions: [createAppliedCondition('poisoned', { durationType: 'rounds', remainingRounds: 1 })]
        })
      ]),
      sequence([0.9, 0.1])
    );

    const backToA = endTurn(endTurn(state));

    expect(hasCondition(backToA.creatures.find((candidate) => candidate.id === 'a')!, 'dodging')).toBe(false);
    expect(hasCondition(backToA.creatures.find((candidate) => candidate.id === 'b')!, 'poisoned')).toBe(false);
    expect(backToA.log.some((entry) => entry.message.includes('expired'))).toBe(true);
  });

  it('poisoned causes disadvantage on attacks', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', conditions: [createAppliedCondition('poisoned')] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'strike', 'b', sequence([0.99, 0, 0.99]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('disadvantage'))).toBe(true);
  });

  it('poisoned causes disadvantage on ability checks through the condition hook system', () => {
    const state = createCombatState([creature({ id: 'a', name: 'Alpha', conditions: [createAppliedCondition('poisoned')] })]);
    const modifier = collectAbilityCheckModifiers(state, state.creatures[0], 'str');

    expect(resolveRollMode(modifier)).toBe('disadvantage');
  });

  it('charmed prevents attacking or harmful save effects against the charmer', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', conditions: [createAppliedCondition('charmed', { sourceCreatureId: 'b' })] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const attack = performAttackAction(state, 'strike', 'b', sequence([0.99, 0]));

    expect(findCreatureForTest(attack, 'b').hp).toBe(10);
    expect(attack.turnState.actionUsed).toBe(false);
    expect(attack.log[0].message).toContain('charmed');

    const area = performSavingThrowAction(state, 'burst', ['b'], sequence([0.1]), {}, { origin: { x: 1, y: 0 } });

    expect(findCreatureForTest(area, 'b').hp).toBe(10);
    expect(area.turnState.actionUsed).toBe(false);
    expect(area.log[0].message).toContain('no valid targets');
  });

  it('frightened only penalizes attacks while the fear source is visible', () => {
    const visibleSourceState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, conditions: [createAppliedCondition('frightened', { sourceCreatureId: 'b' })] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 2, y: 0 } }),
        creature({ id: 'c', name: 'Charlie', team: 'enemies', hp: 10, ac: 12, position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const frightened = performAttackAction(visibleSourceState, 'strike', 'c', sequence([0.99, 0]));
    expect(findCreatureForTest(frightened, 'c').hp).toBe(10);
    expect(frightened.log.some((entry) => entry.message.includes('Frightened'))).toBe(true);

    const blockedSourceState = rollInitiative(
      createCombatState(
        [
          creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, conditions: [createAppliedCondition('frightened', { sourceCreatureId: 'b' })] }),
          creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 2, y: 0 } }),
          creature({ id: 'c', name: 'Charlie', team: 'enemies', hp: 10, ac: 12, position: { x: 0, y: 1 } })
        ],
        3,
        2,
        [{ x: 1, y: 0 }]
      ),
      sequence([0.9, 0.1, 0.2])
    );

    const blocked = performAttackAction(blockedSourceState, 'strike', 'c', sequence([0.5, 0]));
    expect(findCreatureForTest(blocked, 'c').hp).toBe(7);
    expect(blocked.log.some((entry) => entry.message.includes('Frightened'))).toBe(false);
  });

  it('prone grants melee advantage and ranged disadvantage against the target', () => {
    const rangedOnly = [
      {
        ...baseCreature.actions[0],
        id: 'shot',
        name: 'Shot',
        kind: 'rangedAttack' as const,
        type: 'rangedAttack' as const,
        tags: ['attack' as const, 'ranged' as const],
        range: 6
      }
    ];
    const meleeState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 18, position: { x: 1, y: 0 }, conditions: [createAppliedCondition('prone')] })
      ]),
      sequence([0.9, 0.1])
    );

    const melee = performAttackAction(meleeState, 'strike', 'b', sequence([0, 0.8, 0.49]));
    expect(melee.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(5);
    expect(melee.log.some((entry) => entry.message.includes('advantage'))).toBe(true);

    const rangedState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: rangedOnly }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12, position: { x: 3, y: 0 }, conditions: [createAppliedCondition('prone')] })
      ]),
      sequence([0.9, 0.1])
    );

    const ranged = performAttackAction(rangedState, 'shot', 'b', sequence([0.99, 0, 0.99]));
    expect(ranged.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(ranged.log.some((entry) => entry.message.includes('disadvantage'))).toBe(true);
  });

  it('stunned and incapacitated prevent actions', () => {
    const stunned = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', conditions: [createAppliedCondition('stunned')] }),
        creature({ id: 'b', name: 'Bravo', position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const stunnedResult = performAttackAction(stunned, 'strike', 'b', sequence([0.99]));
    expect(stunnedResult.log[0].message).toContain('cannot take actions');

    const incapacitated = applyCondition(createCombatState([creature({ id: 'a', name: 'Alpha' })]), 'a', 'incapacitated');
    const withTurn = rollInitiative(incapacitated, sequence([0.9]));
    const result = performBasicAction(withTurn, 'Dash');
    expect(result.turnState.actionUsed).toBe(false);
    expect(result.log[0].message).toContain('cannot take actions');
  });

  it('restrained prevents movement and gives disadvantage on Dex saves', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({
          id: 'b',
          name: 'Bravo',
          hp: 10,
          abilityScores: { ...baseCreature.abilityScores, dex: 16 },
          conditions: [createAppliedCondition('restrained')]
        })
      ]),
      sequence([0.9, 0.1])
    );

    expect(getReachableMovementSquares(state, 'b')).toEqual([]);

    const result = performSavingThrowAction(state, 'burst', ['b'], sequence([0.99, 0, 0.99, 0.99]));
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(0);
    expect(result.log.some((entry) => entry.message.includes('disadvantage'))).toBe(true);
  });

  it('stunned creatures auto-fail Dexterity saving throws', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({
          id: 'b',
          name: 'Bravo',
          hp: 10,
          abilityScores: { ...baseCreature.abilityScores, dex: 20 },
          conditions: [createAppliedCondition('stunned')]
        })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performSavingThrowAction(state, 'burst', ['b'], sequence([0.99, 0.49, 0.49]));
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(4);
    expect(result.log.some((entry) => entry.message.includes('Stunned'))).toBe(true);
  });

  it('melee hits against paralyzed or unconscious targets are critical hits within 5 feet', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 10, position: { x: 1, y: 0 }, conditions: [createAppliedCondition('paralyzed')] })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'strike', 'b', sequence([0.5, 0, 0]));
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(6);
    expect(result.log.some((entry) => entry.message.includes('Critical hit'))).toBe(true);
  });

  it('blocks melee attacks outside 5 feet and ranged attacks through obstacles', () => {
    const meleeState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', position: { x: 2, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const melee = performAttackAction(meleeState, 'strike', 'b', sequence([0.99]));
    expect(melee.log[0].message).toContain('out of range');

    const rangedAction = [
      {
        ...baseCreature.actions[0],
        id: 'shot',
        name: 'Shot',
        kind: 'rangedAttack' as const,
        type: 'rangedAttack' as const,
        tags: ['attack' as const, 'ranged' as const],
        range: 6
      }
    ];
    const rangedState = rollInitiative(
      createCombatState(
        [
          creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: rangedAction }),
          creature({ id: 'b', name: 'Bravo', position: { x: 3, y: 0 } })
        ],
        5,
        5,
        [{ x: 1, y: 0 }]
      ),
      sequence([0.9, 0.1])
    );

    const ranged = performAttackAction(rangedState, 'shot', 'b', sequence([0.99]));
    expect(ranged.log[0].message).toContain('line of sight');
  });

  it('allows long-range attacks with disadvantage but rejects beyond long range', () => {
    const shot: ActionDefinition = {
      ...baseCreature.actions[0],
      id: 'longbow',
      name: 'Longbow',
      kind: 'rangedAttack',
      type: 'rangedAttack',
      tags: ['attack', 'ranged'],
      range: 2,
      normalRange: 10,
      longRange: 30
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: [shot] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 10, position: { x: 4, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const longRange = performAttackAction(state, 'longbow', 'b', sequence([0.99, 0.05]));
    expect(findCreatureForTest(longRange, 'b').hp).toBe(10);
    expect(longRange.log.some((entry) => entry.message.includes('long range'))).toBe(true);

    const tooFar = performAttackAction(
      rollInitiative(
        createCombatState([
          creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: [shot] }),
          creature({ id: 'b', name: 'Bravo', hp: 10, ac: 10, position: { x: 7, y: 0 } })
        ]),
        sequence([0.9, 0.1])
      ),
      'longbow',
      'b',
      sequence([0.99])
    );
    expect(tooFar.log[0].message).toContain('out of range');
  });

  it('grapple contested roll applies Grappled on success', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, skillBonuses: { athletics: 5 } }),
        creature({ id: 'b', name: 'Bravo', position: { x: 1, y: 0 }, skillBonuses: { acrobatics: 2, athletics: 1 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performGrappleAction(state, 'b', sequence([0.9, 0.1]));

    expect(hasCondition(result.creatures.find((candidate) => candidate.id === 'b')!, 'grappled')).toBe(true);
    expect(result.log.some((entry) => entry.message.includes('grapples'))).toBe(true);
  });

  it('shove contested roll can apply Prone or push target', () => {
    const proneState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, skillBonuses: { athletics: 5 } }),
        creature({ id: 'b', name: 'Bravo', position: { x: 1, y: 0 }, skillBonuses: { acrobatics: 1 } })
      ]),
      sequence([0.9, 0.1])
    );

    const prone = performShoveAction(proneState, 'b', 'prone', sequence([0.9, 0.1]));
    expect(hasCondition(prone.creatures.find((candidate) => candidate.id === 'b')!, 'prone')).toBe(true);

    const pushState = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, skillBonuses: { athletics: 5 } }),
        creature({ id: 'b', name: 'Bravo', position: { x: 1, y: 0 }, skillBonuses: { acrobatics: 1 } })
      ]),
      sequence([0.9, 0.1])
    );

    const pushed = performShoveAction(pushState, 'b', 'push', sequence([0.9, 0.1]));
    expect(pushed.creatures.find((candidate) => candidate.id === 'b')?.position).toEqual({ x: 2, y: 0, z: 0 });
  });

  it('help grants advantage once to an ally attack', () => {
    const helped = performHelpAction(
      rollInitiative(
        createCombatState([
          creature({ id: 'a', name: 'Alpha', team: 'players' }),
          creature({ id: 'c', name: 'Charlie', team: 'players', position: { x: 0, y: 0 } }),
          creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 18, position: { x: 1, y: 0 } })
        ]),
        sequence([0.9, 0.1, 0.2])
      ),
      'c',
      'ally'
    );

    const charlieTurn = {
      ...helped,
      activeCreatureId: 'c',
      turnState: { creatureId: 'c', remainingMovement: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false },
      turnResources: {
        ...helped.turnResources,
        c: { creatureId: 'c', remainingMovement: 30, movementRemaining: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false }
      }
    };
    const result = performAttackAction(charlieTurn, 'strike', 'b', sequence([0, 0.8, 0.49]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(5);
    expect(hasCondition(result.creatures.find((candidate) => candidate.id === 'c')!, 'helped')).toBe(false);
    expect(result.log.some((entry) => entry.message.includes('advantage'))).toBe(true);
  });

  it('hide stores a stealth roll on Hidden', () => {
    const state = rollInitiative(
      createCombatState([creature({ id: 'a', name: 'Alpha', skillBonuses: { stealth: 6 } })]),
      sequence([0.9])
    );

    const result = performHideAction(state, sequence([0.49]));
    const hidden = result.creatures[0].conditions.find((condition) => condition.id === 'hidden');

    expect(hidden?.metadata?.stealthTotal).toBe(16);
  });

  it('ready stores a trigger and readied action', () => {
    const state = rollInitiative(createCombatState([creature({ id: 'a', name: 'Alpha' })]), sequence([0.9]));

    const result = performReadyAction(state, 'strike', 'when an enemy approaches');

    expect(result.creatures[0].readiedAction).toEqual({
      actionId: 'strike',
      actionName: 'Strike',
      trigger: 'when an enemy approaches'
    });
  });

  it('disengage applies a temporary marker', () => {
    const state = rollInitiative(createCombatState([creature({ id: 'a', name: 'Alpha' })]), sequence([0.9]));

    const result = performDisengageAction(state);

    expect(hasCondition(result.creatures[0], 'disengaged')).toBe(true);
    expect(result.creatures[0].conditions.find((condition) => condition.id === 'disengaged')?.durationType).toBe('untilEndOfTargetTurn');
  });

  it('formats HP bar percentage and condition tags', () => {
    expect(getHpPercent({ hp: 7, maxHp: 20 })).toBe(35);
    expect(getHpPercent({ hp: -1, maxHp: 20 })).toBe(0);
    expect(getConditionTag(createAppliedCondition('prone'))).toBe('PRN');
    expect(getConditionTag(createAppliedCondition('customSlow'))).toBe('CUS');
  });

  it('reaction resource resets at the start of the creature turn', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({ id: 'b', name: 'Bravo' })
      ]),
      sequence([0.9, 0.1])
    );
    state.turnResources.b.reactionUsed = true;

    const result = endTurn(state);

    expect(result.activeCreatureId).toBe('b');
    expect(result.turnResources.b.reactionUsed).toBe(false);
  });

  it('moving out of reach creates an opportunity attack candidate and pending prompt', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 1, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );
    const candidates = getOpportunityAttackCandidates(state, state.creatures[0], { x: 1, y: 0 }, { x: 3, y: 0 });
    const moved = moveActiveCreature(state, { x: 3, y: 0 });

    expect(candidates.map((candidate) => candidate.id)).toEqual(['b']);
    expect(moved.pendingReactions).toHaveLength(1);
    expect(moved.log.some((entry) => entry.message.includes('Opportunity attack triggered'))).toBe(true);
  });

  it('checks opportunity attacks along the selected movement path', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1])
    );
    const option = getMovementOption(state, 'a', { x: 2, y: 0 });
    if (!option) {
      throw new Error('Expected routed movement option');
    }

    const moved = moveActiveCreature(state, option.path);

    expect(option.path.map((position) => `${position.x},${position.y}`)).toEqual(['0,0', '1,0', '2,0']);
    expect(moved.pendingReactions).toHaveLength(1);
    expect(moved.pendingReactions[0]).toMatchObject({
      reactorId: 'b',
      from: { x: 1, y: 0, z: 0 },
      to: { x: 2, y: 0, z: 0 }
    });
  });

  it('previews opportunity attack candidates for a selected movement path', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1])
    );
    const option = getMovementOption(state, 'a', { x: 2, y: 0 });
    if (!option) {
      throw new Error('Expected routed movement option');
    }

    const candidates = getOpportunityAttackCandidatesForMovementPath(state, state.creatures[0], option.path);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      creature: { id: 'b' },
      from: { x: 1, y: 0, z: 0 },
      to: { x: 2, y: 0, z: 0 }
    });

    const disengaged = applyCondition(state, 'a', 'disengaged');
    expect(getOpportunityAttackCandidatesForMovementPath(disengaged, disengaged.creatures[0], option.path)).toHaveLength(0);
  });

  it('does not trigger opportunity attacks while moving through spaces that remain within reach', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 1 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 1 } })
      ]),
      sequence([0.9, 0.1])
    );
    const moved = moveActiveCreature(state, [
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ]);

    expect(moved.creatures.find((candidate) => candidate.id === 'a')?.position).toEqual({ x: 2, y: 0, z: 0 });
    expect(moved.pendingReactions).toHaveLength(0);
  });

  it('resolves opportunity attacks without repositioning the moving target', () => {
    const moved = moveActiveCreature(
      rollInitiative(
        createCombatState([
          creature({ id: 'a', name: 'Alpha', hp: 20, maxHp: 20, position: { x: 1, y: 0 } }),
          creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 0 } })
        ]),
        sequence([0.9, 0.1])
      ),
      { x: 3, y: 0 }
    );

    const resolved = resolvePendingReaction(moved, moved.pendingReactions[0].id, true, sequence([0.9, 0.49]));

    expect(resolved.creatures.find((candidate) => candidate.id === 'a')?.position).toEqual({ x: 3, y: 0, z: 0 });
    expect(resolved.creatures.find((candidate) => candidate.id === 'a')?.hp).toBe(15);
    expect(resolved.log.some((entry) => entry.type === 'attack' && entry.message.includes('Strike'))).toBe(true);
  });

  it('Disengage and incapacitated enemies prevent opportunity attacks', () => {
    const disengaged = applyCondition(
      rollInitiative(
        createCombatState([
          creature({ id: 'a', name: 'Alpha', position: { x: 1, y: 0 } }),
          creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 0 } })
        ]),
        sequence([0.9, 0.1])
      ),
      'a',
      'disengaged'
    );

    expect(moveActiveCreature(disengaged, { x: 3, y: 0 }).pendingReactions).toHaveLength(0);

    const incapacitated = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 1, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 0 }, conditions: [createAppliedCondition('incapacitated')] })
      ]),
      sequence([0.9, 0.1])
    );

    expect(moveActiveCreature(incapacitated, { x: 3, y: 0 }).pendingReactions).toHaveLength(0);
  });

  it('creature cannot use two reactions before reset', () => {
    const moved = moveActiveCreature(
      rollInitiative(
        createCombatState([
          creature({ id: 'a', name: 'Alpha', position: { x: 1, y: 0 } }),
          creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 0, y: 0 } })
        ]),
        sequence([0.9, 0.1])
      ),
      { x: 3, y: 0 }
    );
    const used = resolvePendingReaction(moved, moved.pendingReactions[0].id, true, sequence([0.1]));

    expect(used.turnResources.b.reactionUsed).toBe(true);
    const candidates = getOpportunityAttackCandidates(used, used.creatures[0], { x: 1, y: 0 }, { x: 3, y: 0 });
    expect(candidates).toHaveLength(0);
  });

  it('forced movement from shove does not create opportunity attack prompts', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, skillBonuses: { athletics: 5 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 }, skillBonuses: { acrobatics: 1 } }),
        creature({ id: 'c', name: 'Charlie', team: 'players', position: { x: 1, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const shoved = performShoveAction(state, 'b', 'push', sequence([0.9, 0.1]));

    expect(shoved.creatures.find((candidate) => candidate.id === 'b')?.position).toEqual({ x: 2, y: 0, z: 0 });
    expect(shoved.pendingReactions).toHaveLength(0);
  });

  it('custom conditions keep metadata, tags, duration, and rule effects through serialization', () => {
    const state = applyCondition(createCombatState([creature({ id: 'a', name: 'Alpha' }), creature({ id: 'b', name: 'Bravo', position: { x: 1, y: 0 } })]), 'a', 'moon-sick', {
      name: 'Moon Sick',
      description: 'Homebrew lunar fever.',
      tags: ['moon', 'curse'],
      durationType: 'rounds',
      remainingRounds: 2,
      rules: [
        {
          id: 'moon-sick-attacks',
          name: 'Moon Sick Attacks',
          trigger: 'beforeAttackRoll',
          selectors: [{ type: 'self' }],
          effects: [{ type: 'grantDisadvantage', note: 'Moon Sick' }]
        }
      ]
    });
    const parsed = parseCombatStateJson(serializeCombatState(state));
    if (!parsed.state) {
      throw new Error('Expected parsed combat state');
    }
    const condition = parsed.state.creatures[0].conditions[0];

    expect(getConditionLabel(condition)).toBe('Moon Sick (2 rounds)');
    expect(getConditionTag(condition)).toBe('MOO');
    expect(condition.description).toBe('Homebrew lunar fever.');
    expect(condition.rules).toHaveLength(1);

    const withTurn = rollInitiative(parsed.state, sequence([0.9, 0.1]));
    const result = performAttackAction(withTurn, 'strike', 'b', sequence([0.99, 0, 0.99]));
    expect(result.log.some((entry) => entry.message.includes('Moon Sick'))).toBe(true);
  });

  it('applies and removes a template-created custom condition in combat', () => {
    const template = normalizeCustomConditionTemplate({
      id: 'ash-bound',
      name: 'Ash Bound',
      description: 'Ash clings to the target.',
      defaultDurationType: 'rounds',
      defaultRemainingRounds: 3,
      tags: ['homebrew', 'terrain'],
      notes: 'Manual reminder: speed may be restricted by terrain.'
    });
    const appliedCondition = createAppliedConditionFromTemplate(template, 'a');
    const state = createCombatState([creature({ id: 'a', name: 'Alpha' }), creature({ id: 'b', name: 'Bravo' })]);

    const applied = applyCondition(state, 'b', appliedCondition.id, {
      sourceCreatureId: appliedCondition.sourceCreatureId,
      name: appliedCondition.name,
      description: appliedCondition.description,
      tags: appliedCondition.tags,
      durationType: appliedCondition.durationType,
      remainingRounds: appliedCondition.remainingRounds,
      stackBehavior: appliedCondition.stackBehavior,
      metadata: appliedCondition.metadata,
      rules: appliedCondition.rules
    });

    const target = applied.creatures.find((candidate) => candidate.id === 'b')!;
    expect(getConditionLabel(target.conditions[0])).toBe('Ash Bound (3 rounds)');
    expect(target.conditions[0].metadata?.notes).toContain('speed may be restricted');

    const removed = removeCondition(applied, 'b', 'ash-bound');
    expect(hasCondition(removed.creatures.find((candidate) => candidate.id === 'b')!, 'ash-bound')).toBe(false);
  });

  it('flanking is optional and grants melee advantage from opposite sides', () => {
    const base = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', team: 'players', position: { x: 0, y: 1 } }),
        creature({ id: 'c', name: 'Charlie', team: 'players', position: { x: 2, y: 1 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 18, position: { x: 1, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const inactive = performAttackAction(base, 'strike', 'b', sequence([0, 0.49]));
    expect(inactive.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(inactive.log.some((entry) => entry.message.includes('flanking'))).toBe(false);

    const active = performAttackAction(setFlankingEnabled(base, true), 'strike', 'b', sequence([0, 0.8, 0.49]));
    expect(active.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(5);
    expect(active.log.some((entry) => entry.message.includes('flanking'))).toBe(true);
  });

  it('flanking requires allied opposite positioning and ignores blocked flankers', () => {
    const wrongTeam = setFlankingEnabled(
      rollInitiative(
        createCombatState([
          creature({ id: 'a', name: 'Alpha', team: 'players', position: { x: 0, y: 1 } }),
          creature({ id: 'c', name: 'Charlie', team: 'enemies', position: { x: 2, y: 1 } }),
          creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 18, position: { x: 1, y: 1 } })
        ]),
        sequence([0.9, 0.1, 0.2])
      ),
      true
    );
    const sameTeamResult = performAttackAction(wrongTeam, 'strike', 'b', sequence([0, 0.8, 0.49]));
    expect(sameTeamResult.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);

    const blocked = setFlankingEnabled(
      rollInitiative(
        createCombatState(
          [
            creature({ id: 'a', name: 'Alpha', team: 'players', position: { x: 0, y: 1 } }),
            creature({ id: 'c', name: 'Charlie', team: 'players', position: { x: 2, y: 1 } }),
            creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 18, position: { x: 1, y: 1 } })
          ],
          4,
          3,
          [{ x: 2, y: 1 }]
        ),
        sequence([0.9, 0.1, 0.2])
      ),
      true
    );
    const blockedResult = performAttackAction(blocked, 'strike', 'b', sequence([0, 0.8, 0.49]));
    expect(blockedResult.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
  });

  it('flanking ignores allies that cannot threaten the target', () => {
    const base = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', team: 'players', position: { x: 0, y: 1 } }),
        creature({ id: 'c', name: 'Charlie', team: 'players', position: { x: 2, y: 1 }, conditions: [createAppliedCondition('incapacitated')] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 18, position: { x: 1, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performAttackAction(setFlankingEnabled(base, true), 'strike', 'b', sequence([0, 0.8, 0.49]));
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('flanking'))).toBe(false);
  });

  it('ranged attacks have disadvantage when threatened but not by unconscious enemies', () => {
    const rangedAction = {
      ...baseCreature.actions[0],
      id: 'shot',
      name: 'Shot',
      kind: 'rangedAttack' as const,
      type: 'rangedAttack' as const,
      tags: ['attack' as const, 'ranged' as const],
      range: 6
    };
    const threatened = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: [rangedAction] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 12, position: { x: 3, y: 0 } }),
        creature({ id: 'c', name: 'Close Enemy', team: 'enemies', position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performAttackAction(threatened, 'shot', 'b', sequence([0.99, 0]));
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('hostile creature within 5 ft'))).toBe(true);

    const unconscious = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: [rangedAction] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 12, position: { x: 3, y: 0 } }),
        creature({ id: 'c', name: 'Close Enemy', team: 'enemies', position: { x: 0, y: 1 }, conditions: [createAppliedCondition('unconscious')] })
      ]),
      sequence([0.9, 0.1, 0.2])
    );
    const unthreatened = performAttackAction(unconscious, 'shot', 'b', sequence([0.99, 0]));
    const attackLog = unthreatened.log.find((entry) => entry.type === 'attack')?.message ?? '';
    expect(attackLog).not.toContain('hostile creature within 5 ft');
  });

  it('bonus action can be used once and is tracked separately from action', () => {
    const quickStep = {
      id: 'quick-step',
      name: 'Quick Step',
      kind: 'custom' as const,
      actionCost: 'bonusAction' as const,
      tags: ['movement' as const, 'bonus' as const],
      range: 0,
      normalRange: 10,
      effects: []
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, quickStep] }),
        creature({ id: 'b', name: 'Bravo', position: { x: 1, y: 0 }, hp: 10 })
      ]),
      sequence([0.9, 0.1])
    );

    const attacked = performAttackAction(state, 'strike', 'b', sequence([0.99, 0]));
    expect(attacked.turnState.actionUsed).toBe(true);
    expect(attacked.turnState.bonusActionUsed).toBe(false);

    const stepped = performCreatureUtilityAction(attacked, 'quick-step');
    expect(stepped.turnState.actionUsed).toBe(true);
    expect(stepped.turnState.bonusActionUsed).toBe(true);
    expect(stepped.turnState.remainingMovement).toBe(40);

    const secondStep = performCreatureUtilityAction(stepped, 'quick-step');
    expect(secondStep.turnState.remainingMovement).toBe(40);
    expect(secondStep.log[0].message).toContain('already used their bonus action');
  });

  it('bonus action attacks can be used after an action is spent', () => {
    const offhand = {
      ...baseCreature.actions[0],
      id: 'offhand',
      name: 'Offhand',
      actionCost: 'bonusAction' as const,
      tags: ['attack' as const, 'melee' as const, 'bonus' as const],
      damage: { dice: '1d4' }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, offhand] }),
        creature({ id: 'b', name: 'Bravo', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const actionUsed = performAttackAction(state, 'strike', 'b', sequence([0.5, 0]));
    const bonusUsed = performAttackAction(actionUsed, 'offhand', 'b', sequence([0.5, 0]));

    expect(bonusUsed.turnState.actionUsed).toBe(true);
    expect(bonusUsed.turnState.bonusActionUsed).toBe(true);
    expect(bonusUsed.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(16);
  });

  it('multiattack consumes one action and same-target steps damage separately', () => {
    const multiattack: ActionDefinition = {
      id: 'double-strike',
      name: 'Double Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: {
        targetMode: 'sameTarget',
        steps: [
          { id: 'first', name: 'Strike 1', actionId: 'strike' },
          { id: 'second', name: 'Strike 2', actionId: 'strike' }
        ]
      }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'double-strike', { targetId: 'b' }, sequence([0.5, 0, 0.5, 0]));

    expect(result.turnState.actionUsed).toBe(true);
    expect(result.turnState.bonusActionUsed).toBe(false);
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(14);
    expect(result.log.filter((entry) => entry.type === 'attack')).toHaveLength(2);
  });

  it('cannot multiattack if action is already used', () => {
    const multiattack: ActionDefinition = {
      id: 'double-strike',
      name: 'Double Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: { steps: [{ id: 'first', name: 'Strike 1', actionId: 'strike' }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );
    const actionUsed = performAttackAction(state, 'strike', 'b', sequence([0.5, 0]));
    const blocked = performMultiattackAction(actionUsed, 'double-strike', { targetId: 'b' }, sequence([0.5, 0]));

    expect(blocked.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(17);
    expect(blocked.log[0].message).toContain('already used their action');
  });

  it('choose-each-target multiattack works', () => {
    const multiattack: ActionDefinition = {
      id: 'split-strike',
      name: 'Split Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: {
        targetMode: 'chooseEach',
        steps: [
          { id: 'left', name: 'Left Strike', actionId: 'strike' },
          { id: 'right', name: 'Right Strike', actionId: 'strike' }
        ]
      }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 1, y: 0 } }),
        creature({ id: 'c', name: 'Charlie', team: 'enemies', hp: 10, position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performMultiattackAction(
      state,
      'split-strike',
      { stepTargets: { left: 'b', right: 'c' } },
      sequence([0.5, 0, 0.5, 0])
    );

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(7);
    expect(result.creatures.find((candidate) => candidate.id === 'c')?.hp).toBe(7);
  });

  it('same-target multiattack can split targets when step targets are provided', () => {
    const multiattack: ActionDefinition = {
      id: 'flex-strike',
      name: 'Flexible Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: {
        targetMode: 'sameTarget',
        steps: [
          { id: 'left', name: 'Left Strike', actionId: 'strike' },
          { id: 'right', name: 'Right Strike', actionId: 'strike' }
        ]
      }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 1, y: 0 } }),
        creature({ id: 'c', name: 'Charlie', team: 'enemies', hp: 10, position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performMultiattackAction(
      state,
      'flex-strike',
      { targetId: 'b', stepTargets: { left: 'b', right: 'c' } },
      sequence([0.5, 0, 0.5, 0])
    );

    expect(result.turnState.actionUsed).toBe(true);
    expect(result.turnState.bonusActionUsed).toBe(false);
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(7);
    expect(result.creatures.find((candidate) => candidate.id === 'c')?.hp).toBe(7);
  });

  it('normalizes template-created multiattacks that still have stale attack type metadata', () => {
    const multiattack: ActionDefinition = {
      id: 'templated-routine',
      name: 'Templated Routine',
      kind: 'multiattack',
      type: 'meleeAttack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: {
        steps: [
          { id: 'left', name: 'Left Strike', actionId: 'strike' },
          { id: 'right', name: 'Right Strike', actionId: 'strike' }
        ]
      }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 1, y: 0 } }),
        creature({ id: 'c', name: 'Charlie', team: 'enemies', hp: 10, position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performMultiattackAction(
      state,
      'templated-routine',
      { stepTargets: { left: 'b', right: 'c' } },
      sequence([0.5, 0, 0.5, 0])
    );

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(7);
    expect(result.creatures.find((candidate) => candidate.id === 'c')?.hp).toBe(7);
  });

  it('effective AC is used for each multiattack step', () => {
    const multiattack: ActionDefinition = {
      id: 'double-strike',
      name: 'Double Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: { steps: [{ id: 'first', name: 'Strike 1', actionId: 'strike' }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({
          id: 'b',
          name: 'Bravo',
          hp: 10,
          ac: 10,
          position: { x: 1, y: 0 },
          features: [{ id: 'armor', name: 'Armor', description: '+5 AC', enabled: true, source: 'test', modifiers: { ac: 5 } }]
        })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'double-strike', { targetId: 'b' }, sequence([0.25]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('vs AC 15'))).toBe(true);
  });

  it('advantage applies inside multiattack steps', () => {
    const multiattack: ActionDefinition = {
      id: 'single-routine',
      name: 'Single Routine',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: { steps: [{ id: 'first', name: 'Strike 1', actionId: 'strike' }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, ac: 12, position: { x: 1, y: 0 }, conditions: [createAppliedCondition('restrained')] })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'single-routine', { targetId: 'b' }, sequence([0, 0.5, 0]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(7);
    expect(result.log.some((entry) => entry.message.includes('advantage'))).toBe(true);
  });

  it('invalid multiattack child step logs clearly and skips safely', () => {
    const multiattack: ActionDefinition = {
      id: 'broken-routine',
      name: 'Broken Routine',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: { steps: [{ id: 'missing', name: 'Missing Strike', actionId: 'not-real' }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'broken-routine', { targetId: 'b' }, sequence([0.5, 0]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('Broken Routine: Missing Strike has no valid child attack'))).toBe(true);
  });

  it('out-of-range multiattack step logs and skips without crashing', () => {
    const shortStrike = { ...baseCreature.actions[0], range: 1 };
    const multiattack: ActionDefinition = {
      id: 'double-strike',
      name: 'Double Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: { steps: [{ id: 'first', name: 'Strike 1', inlineAction: shortStrike }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 5, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'double-strike', { targetId: 'b' }, sequence([0.5, 0]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('out of range'))).toBe(true);
  });

  it('defeated target mid-multiattack does not crash', () => {
    const heavyStrike = { ...baseCreature.actions[0], damage: { dice: '1d6+10' } };
    const multiattack: ActionDefinition = {
      id: 'double-strike',
      name: 'Double Strike',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: {
        steps: [
          { id: 'first', name: 'Strike 1', inlineAction: heavyStrike },
          { id: 'second', name: 'Strike 2', inlineAction: heavyStrike }
        ]
      }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 5, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'double-strike', { targetId: 'b' }, sequence([0.5, 0]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(0);
    expect(result.log.some((entry) => entry.message.includes('skips Bravo because they are defeated'))).toBe(true);
  });

  it('crits still work inside multiattack', () => {
    const multiattack: ActionDefinition = {
      id: 'single-routine',
      name: 'Single Routine',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      multiattack: { steps: [{ id: 'crit', name: 'Critical Strike', actionId: 'strike' }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [...baseCreature.actions, multiattack] }),
        creature({ id: 'b', name: 'Bravo', hp: 20, ac: 30, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'single-routine', { targetId: 'b' }, sequence([0.999, 0, 0]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(16);
    expect(result.log.some((entry) => entry.message.includes('Critical hit'))).toBe(true);
  });

  it('ranged-in-melee disadvantage applies inside multiattack', () => {
    const shot: ActionDefinition = {
      id: 'shot',
      name: 'Shot',
      kind: 'rangedAttack',
      type: 'rangedAttack',
      actionCost: 'action',
      tags: ['attack', 'ranged'],
      range: 6,
      attackBonus: 4,
      damage: { dice: '1d6+2' },
      shape: { type: 'single' },
      effects: []
    };
    const multiattack: ActionDefinition = {
      id: 'shot-routine',
      name: 'Shot Routine',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 6,
      effects: [],
      multiattack: { steps: [{ id: 'shot-step', name: 'Shot', actionId: 'shot' }] }
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 0, y: 0 }, actions: [shot, multiattack] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 10, ac: 12, position: { x: 3, y: 0 } }),
        creature({ id: 'c', name: 'Close Enemy', team: 'enemies', position: { x: 0, y: 1 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performMultiattackAction(state, 'shot-routine', { targetId: 'b' }, sequence([0.99, 0]));

    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
    expect(result.log.some((entry) => entry.message.includes('hostile creature within 5 ft'))).toBe(true);
  });

  it('resources on parent multiattack are consumed once and child costs are ignored', () => {
    const costlyStrike = {
      ...baseCreature.actions[0],
      id: 'costly-strike',
      name: 'Costly Strike',
      resourceCosts: [{ resourceId: 'child-power', amount: 1, consumeOn: 'use' as const }]
    };
    const multiattack: ActionDefinition = {
      id: 'powered-routine',
      name: 'Powered Routine',
      kind: 'multiattack',
      actionCost: 'action',
      tags: ['attack'],
      range: 1,
      effects: [],
      resourceCosts: [{ resourceId: 'routine-use', amount: 1, consumeOn: 'use' }],
      multiattack: {
        steps: [
          { id: 'first', name: 'Costly 1', actionId: 'costly-strike' },
          { id: 'second', name: 'Costly 2', actionId: 'costly-strike' }
        ]
      }
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [costlyStrike, multiattack],
          resources: [
            { id: 'routine-use', name: 'Routine Use', current: 1, max: 1, resetOn: 'longRest' },
            { id: 'child-power', name: 'Child Power', current: 1, max: 1, resetOn: 'longRest' }
          ]
        }),
        creature({ id: 'b', name: 'Bravo', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performMultiattackAction(state, 'powered-routine', { targetId: 'b' }, sequence([0.5, 0, 0.5, 0]));

    expect(result.creatures[0].resources?.find((resource) => resource.id === 'routine-use')?.current).toBe(0);
    expect(result.creatures[0].resources?.find((resource) => resource.id === 'child-power')?.current).toBe(1);
  });

  it('resources are consumed on action use and unavailable resources prevent actions', () => {
    const costlyStrike = {
      ...baseCreature.actions[0],
      id: 'costly-strike',
      name: 'Costly Strike',
      resourceCosts: [{ resourceId: 'power', amount: 1, consumeOn: 'use' as const }]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [costlyStrike],
          resources: [{ id: 'power', name: 'Power', current: 1, max: 1, resetOn: 'longRest' }]
        }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const used = performAttackAction(state, 'costly-strike', 'b', sequence([0.99, 0]));
    expect(used.creatures[0].resources?.[0].current).toBe(0);

    const blocked = {
      ...used,
      turnState: { ...used.turnState, actionUsed: false },
      turnResources: {
        ...used.turnResources,
        a: { ...used.turnResources.a, actionUsed: false }
      }
    };
    const result = performAttackAction(blocked, 'costly-strike', 'b', sequence([0.99]));
    expect(result.log[0].message).toContain('Needs 1 Power');
    expect(getUnavailableActionReason(result.creatures[0], costlyStrike)).toBe('Needs 1 Power.');
  });

  it('can defer spending the action until a turn-start attack resource is depleted', () => {
    const routineStrike: ActionDefinition = {
      ...baseCreature.actions[0],
      id: 'routine-strike',
      name: 'Routine Strike',
      resourceCosts: [{ resourceId: 'routine', amount: 1, consumeOn: 'use', spendActionWhenDepleted: true }]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [routineStrike],
          resources: [{ id: 'routine', name: 'Routine', current: 2, max: 2, resetOn: 'turnStart' }]
        }),
        creature({ id: 'b', name: 'Bravo', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const first = performAttackAction(state, 'routine-strike', 'b', sequence([0.5, 0]));
    expect(first.turnState.actionUsed).toBe(false);
    expect(first.creatures[0].resources?.find((resource) => resource.id === 'routine')?.current).toBe(1);

    const second = performAttackAction(first, 'routine-strike', 'b', sequence([0.5, 0]));
    expect(second.turnState.actionUsed).toBe(true);
    expect(second.creatures[0].resources?.find((resource) => resource.id === 'routine')?.current).toBe(0);
    expect(second.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(14);

    const nextRound = endTurn(endTurn(second));
    expect(nextRound.activeCreatureId).toBe('a');
    expect(nextRound.creatures[0].resources?.find((resource) => resource.id === 'routine')?.current).toBe(2);
  });

  it('runs Sneak Attack-style bonus damage once per turn', () => {
    const routineStrike: ActionDefinition = {
      ...baseCreature.actions[0],
      id: 'routine-strike',
      name: 'Routine Strike',
      resourceCosts: [{ resourceId: 'routine', amount: 1, consumeOn: 'use', spendActionWhenDepleted: true }]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [routineStrike],
          resources: [{ id: 'routine', name: 'Routine Attacks', current: 2, max: 2, resetOn: 'turnStart' }],
          features: [
            {
              id: 'sneak-attack',
              name: 'Sneak Attack',
              description: 'Once per turn bonus damage.',
              enabled: true,
              source: 'test',
              rules: [
                {
                  id: 'sneak-damage',
                  trigger: 'beforeDamage',
                  selectors: [{ type: 'self' }],
                  filters: [{ type: 'actionHasTag', tag: 'attack' }, { type: 'oncePerTurn' }],
                  effects: [{ type: 'addDamageDice', dice: '1d6' }]
                }
              ]
            }
          ]
        }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 20, maxHp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const first = performAttackAction(state, 'routine-strike', 'b', sequence([0.5, 0, 0]));
    const second = performAttackAction(first, 'routine-strike', 'b', sequence([0.5, 0]));

    expect(findCreatureForTest(first, 'b').hp).toBe(16);
    expect(findCreatureForTest(second, 'b').hp).toBe(13);
  });

  it('runs Rage-style damage reduction before HP changes', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha' }),
        creature({
          id: 'b',
          name: 'Bravo',
          team: 'enemies',
          position: { x: 1, y: 0 },
          conditions: [
            {
              id: 'raging',
              durationType: 'permanentUntilRemoved',
              stackBehavior: 'refresh',
              stackCount: 1,
              intensity: 1,
              rules: [
                {
                  id: 'rage-reduction',
                  trigger: 'beforeDamage',
                  selectors: [{ type: 'self' }],
                  effects: [{ type: 'reduceDamage', amount: 2 }]
                }
              ]
            }
          ]
        })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'strike', 'b', sequence([0.5, 0]));

    expect(findCreatureForTest(result, 'b').hp).toBe(9);
    expect(result.log[0].message).toContain('takes 1 damage');
  });

  it('runs Aura-style flat modifiers for nearby allies', () => {
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', position: { x: 1, y: 0 } }),
        creature({
          id: 'c',
          name: 'Charlie',
          position: { x: 0, y: 0 },
          features: [
            {
              id: 'aura',
              name: 'Aura of Accuracy',
              description: 'Nearby allies gain a roll modifier.',
              enabled: true,
              source: 'test',
              rules: [
                {
                  id: 'aura-attack',
                  trigger: 'beforeAttackRoll',
                  selectors: [{ type: 'alliesWithinRange', range: 10 }],
                  effects: [{ type: 'addFlatModifier', amount: 2 }]
                }
              ]
            }
          ]
        }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', ac: 16, hp: 10, maxHp: 10, position: { x: 2, y: 0 } })
      ]),
      sequence([0.9, 0.1, 0.2])
    );

    const result = performAttackAction(state, 'strike', 'b', sequence([0.45, 0]));

    expect(findCreatureForTest(result, 'b').hp).toBe(7);
    expect(result.log.some((entry) => entry.message.includes('+ 4 + 2 = 16 vs AC 16. Hit.'))).toBe(true);
  });

  it('can apply a condition from an on-hit damage rule', () => {
    const trippingStrike: ActionDefinition = {
      ...baseCreature.actions[0],
      id: 'trip-strike',
      name: 'Tripping Strike',
      rules: [
        {
          id: 'trip-on-hit',
          trigger: 'afterDamage',
          selectors: [{ type: 'actionTarget' }],
          effects: [{ type: 'applyCondition', conditionId: 'prone' }]
        }
      ]
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [trippingStrike] }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'trip-strike', 'b', sequence([0.5, 0]));

    expect(hasCondition(findCreatureForTest(result, 'b'), 'prone')).toBe(true);
  });

  it('preserves embedded custom condition mechanics when rule effects apply conditions', () => {
    const bindingStrike: ActionDefinition = {
      ...baseCreature.actions[0],
      id: 'binding-strike',
      name: 'Binding Strike',
      rules: [
        {
          id: 'bind-on-hit',
          trigger: 'afterDamage',
          selectors: [{ type: 'actionTarget' }],
          effects: [
            {
              type: 'applyCondition',
              conditionId: 'ash-bound',
              name: 'Ash Bound',
              description: 'Ash makes attacks unreliable.',
              tags: ['ash'],
              durationType: 'rounds',
              remainingRounds: 2,
              rules: [
                {
                  id: 'ash-attack',
                  trigger: 'beforeAttackRoll',
                  selectors: [{ type: 'self' }],
                  effects: [{ type: 'grantDisadvantage', note: 'Ash Bound' }]
                }
              ]
            }
          ]
        }
      ]
    };
    const state = rollInitiative(
      createCombatState([
        creature({ id: 'a', name: 'Alpha', actions: [bindingStrike], position: { x: 0, y: 0 } }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 20, maxHp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const bound = performAttackAction(state, 'binding-strike', 'b', sequence([0.5, 0]));
    const condition = findCreatureForTest(bound, 'b').conditions.find((candidate) => candidate.id === 'ash-bound');

    expect(condition?.name).toBe('Ash Bound');
    expect(condition?.rules).toHaveLength(1);

    const bravoTurn = {
      ...bound,
      activeCreatureId: 'b',
      turnState: { creatureId: 'b', remainingMovement: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false },
      turnResources: {
        ...bound.turnResources,
        b: { creatureId: 'b', remainingMovement: 30, movementRemaining: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false }
      }
    };
    const disadvantaged = performAttackAction(bravoTurn, 'strike', 'a', sequence([0.99, 0.05]));
    expect(disadvantaged.log.some((entry) => entry.message.includes('Ash Bound'))).toBe(true);
  });

  it('lets resource-spending rule effects prevent repeated use', () => {
    const focusStrike: ActionDefinition = {
      ...baseCreature.actions[0],
      id: 'focus-strike',
      name: 'Focus Strike',
      actionCost: 'free',
      resourceCosts: [{ resourceId: 'focus', amount: 1, consumeOn: 'use' }],
      rules: [
        {
          id: 'extra-focus-cost',
          trigger: 'onActionUsed',
          selectors: [{ type: 'self' }],
          effects: [{ type: 'spendResource', resourceId: 'focus', amount: 1 }]
        }
      ]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [focusStrike],
          resources: [{ id: 'focus', name: 'Focus', current: 2, max: 2, resetOn: 'manual' }]
        }),
        creature({ id: 'b', name: 'Bravo', team: 'enemies', hp: 20, maxHp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const first = performAttackAction(state, 'focus-strike', 'b', sequence([0.5, 0]));
    const second = performAttackAction(first, 'focus-strike', 'b', sequence([0.5, 0]));

    expect(findCreatureForTest(second, 'a').resources?.find((resource) => resource.id === 'focus')?.current).toBe(0);
    expect(findCreatureForTest(second, 'b').hp).toBe(17);
    expect(second.log.some((entry) => entry.message.includes('Needs 1 Focus'))).toBe(true);
  });

  it('spell-like creature actions use normal resource costs and attack resolution', () => {
    const spark: ActionDefinition = {
      id: 'spark',
      name: 'Spark',
      kind: 'spell',
      type: 'rangedAttack',
      actionCost: 'action',
      tags: ['spell', 'attack', 'ranged'],
      range: 6,
      attackBonus: 5,
      damage: { dice: '1d6', type: 'lightning' },
      shape: { type: 'single' },
      effects: [],
      resourceCosts: [{ resourceId: 'charge', amount: 1, consumeOn: 'use' }]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [spark],
          resources: [{ id: 'charge', name: 'Charge', current: 1, max: 1, resetOn: 'longRest' }]
        }),
        creature({ id: 'b', name: 'Bravo', hp: 10, position: { x: 2, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const result = performAttackAction(state, 'spark', 'b', sequence([0.5, 0]));

    expect(result.creatures[0].resources?.[0].current).toBe(0);
    expect(result.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(9);
    expect(result.log.some((entry) => entry.message.includes('Alpha casts Spark on Bravo'))).toBe(true);
  });

  it('resource reset behavior restores matching resources', () => {
    const state = createCombatState([
      creature({
        id: 'a',
        name: 'Alpha',
        resources: [
          { id: 'arcane', name: 'Arcane Charges', current: 0, max: 2, resetOn: 'longRest' },
          { id: 'ki', name: 'Ki', current: 0, max: 3, resetOn: 'shortRest' }
        ]
      })
    ]);

    const shortRest = resetAllResources(state, 'shortRest');
    expect(shortRest.creatures[0].resources?.find((resource) => resource.id === 'ki')?.current).toBe(3);
    expect(shortRest.creatures[0].resources?.find((resource) => resource.id === 'arcane')?.current).toBe(0);

    const longRest = resetAllResources(shortRest, 'longRest');
    expect(longRest.creatures[0].resources?.find((resource) => resource.id === 'arcane')?.current).toBe(2);
  });

  it('Cunning Action adds bonus Dash, Disengage, and Hide without removing original basic actions', () => {
    const state = createCombatState([
      creature({
        id: 'a',
        name: 'Alpha',
        features: [
          {
            id: 'cunning-action',
            name: 'Cunning Action',
            description: 'Dash, Disengage, and Hide as bonus actions.',
            enabled: true,
            source: 'test',
            alternateActions: [
              { id: 'ca-dash', name: 'Cunning Action: Dash', baseActionName: 'Dash', actionCost: 'bonusAction', tags: ['movement', 'bonus'] },
              { id: 'ca-disengage', name: 'Cunning Action: Disengage', baseActionName: 'Disengage', actionCost: 'bonusAction', tags: ['bonus'] },
              { id: 'ca-hide', name: 'Cunning Action: Hide', baseActionName: 'Hide', actionCost: 'bonusAction', tags: ['bonus'] }
            ]
          }
        ]
      })
    ]);

    const actions = getAvailableActions(state.creatures[0], state);
    expect(actions.map((action) => action.name)).toEqual(
      expect.arrayContaining(['Cunning Action: Dash', 'Cunning Action: Disengage', 'Cunning Action: Hide'])
    );
    expect(actions.every((action) => action.actionCost === 'bonusAction' || !action.generatedByFeatureId)).toBe(true);
  });

  it('feature speed and AC modifiers affect movement range and attack resolution', () => {
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          speed: 30,
          position: { x: 0, y: 0 },
          features: [{ id: 'fast', name: 'Fast', description: '+10 speed', enabled: true, source: 'test', modifiers: { speed: 10 } }]
        }),
        creature({
          id: 'b',
          name: 'Bravo',
          hp: 10,
          ac: 10,
          position: { x: 1, y: 0 },
          features: [{ id: 'armor', name: 'Armor', description: '+5 AC', enabled: true, source: 'test', modifiers: { ac: 5 } }]
        })
      ]),
      sequence([0.9, 0.1])
    );

    expect(getEffectiveSpeed(state.creatures[0], state)).toBe(40);
    expect(getReachableMovementSquares(state, 'a').some((option) => option.costFeet === 40)).toBe(true);
    expect(getEffectiveAC(state.creatures[1], state)).toBe(15);

    const miss = performAttackAction(state, 'strike', 'b', sequence([0.25]));
    expect(miss.creatures.find((candidate) => candidate.id === 'b')?.hp).toBe(10);
  });

  it('effective AC affects attack debug stats', () => {
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          features: [{ id: 'accurate', name: 'Accurate', description: '+2 attack', enabled: true, source: 'test', modifiers: { attackBonus: 2 } }]
        }),
        creature({
          id: 'b',
          name: 'Bravo',
          ac: 10,
          position: { x: 1, y: 0 },
          features: [{ id: 'armor', name: 'Armor', description: '+3 AC', enabled: true, source: 'test', modifiers: { ac: 3 } }]
        })
      ]),
      sequence([0.9, 0.1])
    );

    const stats = getAttackDebugStats(state, 'strike', 'b', 0);

    expect(stats.attackBonus).toBe(6);
    expect(stats.targetAc).toBe(13);
    expect(stats.expectedHitPercentage).toBeCloseTo(70);
  });

  it('effective speed initializes turn movement', () => {
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          speed: 30,
          features: [{ id: 'fleet', name: 'Fleet', description: '+5 speed', enabled: true, source: 'test', modifiers: { speed: 5 } }]
        })
      ]),
      sequence([0.9])
    );

    expect(state.turnState.remainingMovement).toBe(35);
    expect(state.turnResources.a.remainingMovement).toBe(35);
  });

  it('feature AC modifier display includes base and effective values', () => {
    expect(formatBaseEffectiveNumber(16, 17)).toBe('16 / effective 17');
    expect(formatBaseEffectiveNumber(14, 14)).toBe('14');
  });

  it('feature-derived bonus action consumes bonus action resource', () => {
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          features: [
            {
              id: 'cunning-action',
              name: 'Cunning Action',
              description: 'Dash as bonus action.',
              enabled: true,
              source: 'test',
              alternateActions: [
                { id: 'ca-dash', name: 'Cunning Action: Dash', baseActionName: 'Dash', actionCost: 'bonusAction', tags: ['movement', 'bonus'] }
              ]
            }
          ]
        })
      ]),
      sequence([0.9])
    );

    const result = performCreatureUtilityAction(state, 'ca-dash');
    expect(result.turnState.bonusActionUsed).toBe(true);
    expect(result.turnState.actionUsed).toBe(false);
    expect(result.turnState.remainingMovement).toBe(60);
  });

  it('limited-use feature action cannot be used after resource reaches zero', () => {
    const limited = {
      ...baseCreature.actions[0],
      id: 'limited',
      name: 'Limited Strike',
      resourceCosts: [{ resourceId: 'limited-use', amount: 1, consumeOn: 'use' as const }]
    };
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          actions: [limited],
          resources: [{ id: 'limited-use', name: 'Limited Use', current: 1, max: 1, resetOn: 'longRest' }]
        }),
        creature({ id: 'b', name: 'Bravo', hp: 20, position: { x: 1, y: 0 } })
      ]),
      sequence([0.9, 0.1])
    );

    const used = performAttackAction(state, 'limited', 'b', sequence([0.99, 0]));
    const retried = {
      ...used,
      turnState: { ...used.turnState, actionUsed: false },
      turnResources: {
        ...used.turnResources,
        a: { ...used.turnResources.a, actionUsed: false }
      }
    };
    const blocked = performAttackAction(retried, 'limited', 'b', sequence([0.99]));

    expect(blocked.creatures[0].resources?.[0].current).toBe(0);
    expect(blocked.log[0].message).toContain('Needs 1 Limited Use');
  });

  it('pasted JSON import/export round trips CombatState', () => {
    const state = rollInitiative(createCombatState([creature({ id: 'a', name: 'Alpha' })]), sequence([0.9]));
    const exported = serializeCombatState(state);
    const parsed = parseCombatStateJson(exported);

    expect(parsed.ok).toBe(true);
    expect(parsed.state).toEqual(state);
  });

  it('bad JSON returns a friendly validation error', () => {
    expect(parseCombatStateJson('{ nope').error).toContain('Invalid JSON');
    expect(parseCombatStateJson(JSON.stringify({ creatures: [] })).error).toContain('missing grid object');
  });

  it('normalizes imported resources and turn resource rows from older saves', () => {
    const state = rollInitiative(
      createCombatState([
        creature({
          id: 'a',
          name: 'Alpha',
          resources: [{ id: 'focus', name: 'Focus', current: 5, max: 2, resetOn: 'invalid' as never }]
        }),
        creature({ id: 'b', name: 'Bravo' })
      ]),
      sequence([0.9, 0.1])
    );
    const imported = {
      ...state,
      turnResources: {
        a: { creatureId: 'a', remainingMovement: 12, actionUsed: true }
      }
    };

    const parsed = parseCombatStateJson(JSON.stringify(imported));

    expect(parsed.ok).toBe(true);
    expect(parsed.state?.creatures[0].resources?.[0]).toMatchObject({
      current: 2,
      max: 2,
      resetOn: 'longRest',
      display: { showOnCreaturePanel: true, mode: 'pips' }
    });
    expect(parsed.state?.turnResources.a).toMatchObject({
      creatureId: 'a',
      remainingMovement: 12,
      movementRemaining: 12,
      actionUsed: true,
      bonusActionUsed: false,
      reactionUsed: false
    });
    expect(parsed.state?.turnResources.b).toMatchObject({
      creatureId: 'b',
      remainingMovement: 30,
      movementRemaining: 30
    });
    expect(parsed.state?.turnState).toEqual(parsed.state?.turnResources.a);
  });

  it('exported JSON shape validates as CombatState', () => {
    const state = createCombatState([creature({ id: 'a', name: 'Alpha' })]);
    const exported = serializeCombatState(state);
    const parsed = JSON.parse(exported) as unknown;

    expect(validateCombatStateShape(parsed)).toBeUndefined();
  });
});
