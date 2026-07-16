import { describe, expect, it } from 'vitest';
import {
  createCombatState,
  findCreature,
  getBotTurnPreview,
  rollInitiative,
  runBotTurn,
  runBotTurnActionStep,
  runBotTurnEndStep,
  runBotTurnMovementStep
} from './combat';
import { parseCombatStateJson, serializeCombatState } from './serialization';
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

const offhandStrike: ActionDefinition = {
  ...meleeStrike,
  id: 'offhand',
  name: 'Offhand Strike',
  actionCost: 'bonusAction',
  damage: { dice: '1d4+1', type: 'slashing' }
};

const burningBurst: ActionDefinition = {
  id: 'burning-burst',
  name: 'Burning Burst',
  kind: 'savingThrowEffect',
  type: 'savingThrowEffect',
  actionCost: 'action',
  tags: ['spell'],
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

  it('lets a threatened ranged bot attack before repositioning', () => {
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', { actions: [bowShot], position: { x: 1, y: 1 }, speed: 15 }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 30, position: { x: 4, y: 1 } }),
        creature({ id: 'threat', name: 'Threat', team: 'players', hp: 30, position: { x: 1, y: 2 } })
      ], 6, 5),
      sequence([0.9, 0.1, 0.2])
    );

    const result = runBotTurn(state, sequence([0.7, 0, 0.7, 0]));
    const chronological = [...result.log].reverse().map((entry) => entry.message);
    const attackIndex = chronological.findIndex((message) => message.includes('uses Bow'));
    const moveIndex = chronological.findIndex((message) => message.includes('moves from'));

    expect(attackIndex).toBeGreaterThanOrEqual(0);
    expect(moveIndex).toBeGreaterThan(attackIndex);
    expect(findCreature(result, 'bot').position).not.toEqual({ x: 1, y: 1, z: 0 });
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

  it('keeps an adjacent melee bot in place and attacks before risking movement', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 }, speed: 30 }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 30, position: { x: 1, y: 0 } }),
        creature({ id: 'other', name: 'Other Target', team: 'players', hp: 30, position: { x: 3, y: 0 } })
      ], 5, 3),
      sequence([0.9, 0.1, 0.2])
    );

    const result = runBotTurn(state, sequence([0.7, 0]));

    expect(findCreature(result, 'bot').position).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.pendingReactions).toHaveLength(0);
    expect(result.log.some((entry) => entry.message.includes('bot plan: action only'))).toBe(true);
  });

  it('uses a useful bonus action attack after its main action', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { actions: [meleeStrike, offhandStrike], position: { x: 0, y: 0 } }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 40, position: { x: 1, y: 0 } })
      ], 4, 4),
      sequence([0.9, 0.1])
    );

    const result = runBotTurn(state, sequence([0.7, 0, 0.7, 0]));

    expect(result.turnResources.bot.bonusActionUsed).toBe(true);
    expect(findCreature(result, 'target').hp).toBeLessThan(40);
    expect(result.log.some((entry) => entry.message.includes('bot uses bonus action Offhand Strike'))).toBe(true);
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

  it('previews bot movement, action, and decision notes without running the turn', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 }, speed: 15 }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 3, y: 0 } })
      ], 6, 3),
      sequence([0.9, 0.1])
    );

    const preview = getBotTurnPreview(state);

    expect(preview.canRun).toBe(true);
    expect(preview.summary).toContain('use Strike on Target');
    expect(preview.movement).toMatchObject({ costFeet: 10, to: { x: 2, y: 0, z: 0 } });
    expect(preview.action).toMatchObject({ actionId: 'strike', targetIds: ['target'] });
    expect(preview.notes.some((note) => note.includes('Profile: Aggressive Melee'))).toBe(true);
    expect(findCreature(state, 'bot').position).toEqual({ x: 0, y: 0, z: 0 });
    expect(findCreature(state, 'target').hp).toBe(20);
  });

  it('uses hit chance scoring to prefer a target it can hit more reliably', () => {
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', { actions: [bowShot], position: { x: 0, y: 0 } }),
        creature({ id: 'hard', name: 'Hard Target', team: 'players', ac: 22, position: { x: 3, y: 0 } }),
        creature({ id: 'soft', name: 'Soft Target', team: 'players', ac: 10, position: { x: 0, y: 3 } })
      ], 5, 5),
      sequence([0.9, 0.1, 0.2])
    );

    const preview = getBotTurnPreview(state);

    expect(preview.action?.targetIds).toEqual(['soft']);
    expect(preview.action?.scoreDetails.hitChance).toBeGreaterThan(0.5);
    expect(preview.action?.scoreDetails.expectedDamage).toBeGreaterThan(0);
  });

  it('can prioritize the lowest HP target over the easiest target', () => {
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', { actions: [bowShot], botTargetPriority: 'lowestHp', position: { x: 0, y: 0 } }),
        creature({ id: 'healthy', name: 'Healthy Target', team: 'players', hp: 20, maxHp: 20, ac: 10, position: { x: 3, y: 0 } }),
        creature({ id: 'wounded', name: 'Wounded Target', team: 'players', hp: 3, maxHp: 20, ac: 22, position: { x: 0, y: 3 } })
      ], 5, 5),
      sequence([0.9, 0.1, 0.2])
    );

    const preview = getBotTurnPreview(state);

    expect(preview.action?.targetIds).toEqual(['wounded']);
    expect(preview.notes.some((note) => note.includes('Lowest HP'))).toBe(true);
  });

  it('reports resource conservation penalties in action score details', () => {
    const limitedShot: ActionDefinition = {
      ...bowShot,
      id: 'limited-shot',
      name: 'Limited Shot',
      resourceCosts: [{ resourceId: 'charge', amount: 1, consumeOn: 'use' }]
    };
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', {
          actions: [limitedShot],
          position: { x: 0, y: 0 },
          resources: [{ id: 'charge', name: 'Charge', current: 1, max: 3, resetOn: 'manual' }]
        }),
        creature({ id: 'target', name: 'Target', team: 'players', ac: 10, position: { x: 3, y: 0 } })
      ], 5, 5),
      sequence([0.9, 0.1])
    );

    const preview = getBotTurnPreview(state);

    expect(preview.action?.actionId).toBe('limited-shot');
    expect(preview.action?.scoreDetails.resourcePenalty).toBeGreaterThan(0);
  });

  it('uses resource strategy to conserve or spend limited actions', () => {
    const steadyShot: ActionDefinition = {
      ...bowShot,
      id: 'steady-shot',
      name: 'Steady Shot',
      damage: { dice: '1d6+2', type: 'piercing' }
    };
    const limitedShot: ActionDefinition = {
      ...bowShot,
      id: 'limited-shot',
      name: 'Limited Shot',
      damage: { dice: '1d10+3', type: 'piercing' },
      resourceCosts: [{ resourceId: 'charge', amount: 1, consumeOn: 'use' }]
    };
    const baseCreatures = [
      creature({ id: 'target', name: 'Target', team: 'players', ac: 10, position: { x: 3, y: 0 } })
    ];
    const conservative = rollInitiative(
      createCombatState([
        bot('rangedAttacker', {
          actions: [steadyShot, limitedShot],
          botResourceStrategy: 'conserve',
          position: { x: 0, y: 0 },
          resources: [{ id: 'charge', name: 'Charge', current: 1, max: 3, resetOn: 'manual' }]
        }),
        ...baseCreatures
      ], 5, 5),
      sequence([0.9, 0.1])
    );
    const spender = rollInitiative(
      createCombatState([
        bot('rangedAttacker', {
          actions: [steadyShot, limitedShot],
          botResourceStrategy: 'spendFreely',
          position: { x: 0, y: 0 },
          resources: [{ id: 'charge', name: 'Charge', current: 1, max: 3, resetOn: 'manual' }]
        }),
        ...baseCreatures
      ], 5, 5),
      sequence([0.9, 0.1])
    );

    expect(getBotTurnPreview(conservative).action?.actionId).toBe('steady-shot');
    expect(getBotTurnPreview(spender).action?.actionId).toBe('limited-shot');
  });

  it('scores saving throw areas by enemy targets in the chosen shape', () => {
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', { actions: [burningBurst], position: { x: 0, y: 0 } }),
        creature({ id: 'target-a', name: 'Target A', team: 'players', position: { x: 3, y: 0 } }),
        creature({ id: 'target-b', name: 'Target B', team: 'players', position: { x: 3, y: 1 } })
      ], 6, 4),
      sequence([0.9, 0.1, 0.2])
    );

    const preview = getBotTurnPreview(state);

    expect(preview.action?.actionId).toBe('burning-burst');
    expect(preview.action?.scoreDetails.enemyTargets).toBe(2);
    expect(preview.action?.scoreDetails.saveFailureChance).toBeGreaterThan(0);
  });

  it('records bot memory for targets and damage during real bot actions', () => {
    const state = rollInitiative(
      createCombatState([
        bot('aggressiveMelee', { position: { x: 0, y: 0 } }),
        creature({ id: 'target', name: 'Target', team: 'players', hp: 20, position: { x: 1, y: 0 } })
      ], 4, 4),
      sequence([0.9, 0.1])
    );

    const result = runBotTurn(state, sequence([0.7, 0]));

    expect(result.botMemory?.bot).toMatchObject({ lastTargetId: 'target', lastTargetRound: result.round });
    expect(result.botMemory?.target).toMatchObject({ lastAttackerId: 'bot', lastDamagedById: 'bot' });
  });

  it('uses bot memory as a small target scoring nudge', () => {
    const state = rollInitiative(
      createCombatState([
        bot('rangedAttacker', {
          actions: [bowShot],
          position: { x: 0, y: 0 }
        }),
        creature({ id: 'easy', name: 'Easy Target', team: 'players', ac: 10, position: { x: 3, y: 0 } }),
        creature({ id: 'revenge', name: 'Recent Attacker', team: 'players', ac: 13, position: { x: 0, y: 3 } })
      ], 5, 5),
      sequence([0.9, 0.1, 0.2])
    );
    const remembered = {
      ...state,
      botMemory: {
        bot: {
          lastAttackerId: 'revenge',
          lastAttackedRound: state.round,
          lastDamagedById: 'revenge',
          lastDamagedRound: state.round
        }
      }
    };

    const preview = getBotTurnPreview(remembered);

    expect(preview.action?.targetIds).toEqual(['revenge']);
    expect(preview.action?.scoreDetails.memoryBonus).toBeGreaterThan(0);
    expect(preview.notes.some((note) => note.includes('recently damaged'))).toBe(true);
  });

  it('serializes bot memory and prunes stale memory ids on import', () => {
    const state = createCombatState([
      bot('passive'),
      creature({ id: 'target', name: 'Target', team: 'players' })
    ]);
    const exported = serializeCombatState({
      ...state,
      botMemory: {
        bot: { lastTargetId: 'target', lastTargetRound: 2, lastDamagedById: 'missing', lastDamagedRound: 2 },
        missing: { lastTargetId: 'bot', lastTargetRound: 2 }
      }
    });

    const parsed = parseCombatStateJson(exported);

    expect(parsed.ok).toBe(true);
    expect(parsed.state?.botMemory).toEqual({
      bot: { lastTargetId: 'target', lastTargetRound: 2 }
    });
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
