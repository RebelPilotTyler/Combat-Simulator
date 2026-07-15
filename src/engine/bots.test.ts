import { describe, expect, it } from 'vitest';
import {
  createCombatState,
  findCreature,
  rollInitiative,
  runBotTurn,
  runBotTurnActionStep,
  runBotTurnEndStep,
  runBotTurnMovementStep
} from './combat';
import type { ActionDefinition, BotProfile, Creature } from './types';

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

const meleeStrike: ActionDefinition = {
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

const bowShot: ActionDefinition = {
  id: 'bow',
  name: 'Bow',
  kind: 'rangedAttack',
  type: 'rangedAttack',
  actionCost: 'action',
  tags: ['attack', 'ranged'],
  range: 6,
  normalRange: 30,
  longRange: 60,
  attackBonus: 5,
  damage: { dice: '1d8+2', type: 'piercing' },
  shape: { type: 'single' },
  effects: []
};

function creature(overrides: Partial<Creature>): Creature {
  return {
    id: 'creature',
    name: 'Creature',
    team: 'players',
    controlMode: 'manual',
    botProfile: 'passive',
    hp: 20,
    maxHp: 20,
    ac: 12,
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 0, y: 0 },
    ...overrides,
    abilityScores: overrides.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    conditions: overrides.conditions ?? [],
    actions: overrides.actions ?? [meleeStrike]
  };
}

function bot(profile: BotProfile, overrides: Partial<Creature> = {}): Creature {
  return creature({
    id: 'bot',
    name: 'Bot',
    team: 'enemies',
    controlMode: 'bot',
    botProfile: profile,
    ...overrides
  });
}

describe('bot turns', () => {
  it('moves an aggressive melee bot toward and attacks the nearest enemy', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 }, speed: 15 }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 3, y: 0 } })
      ], 6, 3),
      sequence([0.9, 0.1])
    );

    const result = runBotTurn(state, sequence([0.7, 0]));

    expect(findCreature(result, 'bot').position).toEqual({ x: 2, y: 0, z: 0 });
    expect(findCreature(result, 'target').hp).toBeLessThan(20);
    expect(result.log.some((entry) => entry.message.includes('bot chooses Strike'))).toBe(true);
  });

  it('lets a ranged bot attack from range when possible', () => {
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', { actions: [bowShot], position: { x: 0, y: 0 } }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 4, y: 0 } })
      ], 8, 3),
      sequence([0.9, 0.1])
    );

    const result = runBotTurn(state, sequence([0.7, 0]));

    expect(findCreature(result, 'bot').position).toEqual({ x: 0, y: 0, z: 0 });
    expect(findCreature(result, 'target').hp).toBeLessThan(20);
  });

  it('does not attack allies', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 } }),
        creature({ id: 'ally', name: 'Ally', team: 'enemies', hp: 20, position: { x: 1, y: 0 } })
      ], 4, 4),
      sequence([0.9, 0.1])
    );

    const result = runBotTurn(state, sequence([0.9, 0.9]));

    expect(findCreature(result, 'ally').hp).toBe(20);
    expect(result.log.some((entry) => entry.message.includes('found no good target') || entry.message.includes('waits'))).toBe(true);
  });

  it('safely ends when no valid target exists', () => {
    const state = rollInitiative(createCombatState([bot('passive')]), sequence([0.9]));

    const result = runBotTurn(state, sequence([0.9]));

    expect(findCreature(result, 'bot').hp).toBe(20);
    expect(result.log.some((entry) => entry.message.includes('bot waits'))).toBe(true);
  });

  it('respects spent action availability and does not attack after its action is spent', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 } }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 1, y: 0 } })
      ], 4, 4),
      sequence([0.9, 0.1])
    );
    const spent = {
      ...state,
      turnState: { ...state.turnState, actionUsed: true },
      turnResources: { ...state.turnResources, bot: { ...state.turnResources.bot, actionUsed: true } }
    };

    const result = runBotTurn(spent, sequence([0.9, 0.9]));

    expect(findCreature(result, 'target').hp).toBe(20);
  });

  it('does not bypass blocked or occupied movement spaces', () => {
    const state = rollInitiative(
      createCombatState(
        [
          bot('aggressiveMelee', { position: { x: 0, y: 0 }, speed: 5 }),
          creature({ id: 'ally', name: 'Ally', team: 'enemies', position: { x: 0, y: 1 } }),
          creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 2, y: 0 } })
        ],
        3,
        3,
        [{ x: 1, y: 0 }]
      ),
      sequence([0.9, 0.1, 0.05])
    );

    const result = runBotTurn(state, sequence([0.9, 0.9]));
    const botPosition = findCreature(result, 'bot').position;

    expect(botPosition).not.toEqual({ x: 1, y: 0, z: 0 });
    expect(botPosition).not.toEqual({ x: 0, y: 1, z: 0 });
    expect(findCreature(result, 'target').hp).toBe(20);
  });

  it('can run a bot turn as visible movement, action, and end steps', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 }, speed: 15 }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 3, y: 0 } })
      ], 6, 3),
      sequence([0.9, 0.1])
    );

    const moved = runBotTurnMovementStep(state);
    const acted = runBotTurnActionStep(moved, sequence([0.7, 0]));
    const ended = runBotTurnEndStep(acted);

    expect(findCreature(moved, 'bot').position).toEqual({ x: 2, y: 0, z: 0 });
    expect(findCreature(acted, 'target').hp).toBeLessThan(20);
    expect(ended.activeCreatureId).toBe('target');
  });

  it('ends safely through bot steps when no valid action exists', () => {
    const state = rollInitiative(createCombatState([bot('passive')]), sequence([0.9]));

    const moved = runBotTurnMovementStep(state);
    const acted = runBotTurnActionStep(moved, sequence([0.9]));
    const ended = runBotTurnEndStep(acted);

    expect(findCreature(ended, 'bot').hp).toBe(20);
    expect(ended.log.some((entry) => entry.message.includes('bot waits'))).toBe(true);
  });
});
