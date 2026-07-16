import { describe, expect, it } from 'vitest';
import { createCombatState, moveActiveCreature, rollInitiative } from './combat';
import { getMovementOption, getMovementOptionsForDestination, getReachableMovementSquares } from './movement';
import type { Creature } from './types';

const creature: Creature = {
  id: 'climber',
  name: 'Climber',
  team: 'players',
  hp: 10,
  maxHp: 10,
  ac: 12,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  speed: 30,
  position: { x: 0, y: 0, z: 0 },
  conditions: [],
  actions: []
};

function reachableKeys(state: ReturnType<typeof createCombatState>): string[] {
  return getReachableMovementSquares(state, 'climber').map((option) => `${option.position.x},${option.position.y},${option.position.z ?? 0}`);
}

describe('3D movement', () => {
  it('returns actual traversable paths and costs around blocked cells', () => {
    const state = createCombatState([creature], 3, 2, [{ x: 1, y: 0 }]);
    const option = getMovementOption(state, 'climber', { x: 2, y: 0 });

    expect(option?.costFeet).toBe(10);
    expect(option?.path.map((position) => `${position.x},${position.y},${position.z ?? 0}`)).toEqual([
      '0,0,0',
      '1,1,0',
      '2,0,0'
    ]);
  });

  it('moves one diagonal square for 5 feet', () => {
    const state = createCombatState([creature], 3, 3);
    const option = getMovementOption(state, 'climber', { x: 1, y: 1 });

    expect(option?.costFeet).toBe(5);
    expect(option?.path).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 }
    ]);
  });

  it('does not squeeze diagonally through two impassable side squares', () => {
    const state = createCombatState([creature], 2, 2, [{ x: 1, y: 0 }, { x: 0, y: 1 }]);

    expect(getMovementOption(state, 'climber', { x: 1, y: 1 })).toBeUndefined();
  });

  it('does not return destinations when no legal path exists', () => {
    const state = createCombatState([creature], 3, 1, [{ x: 1, y: 0 }]);

    expect(getMovementOption(state, 'climber', { x: 2, y: 0 })).toBeUndefined();
  });

  it('spends movement based on the selected path cost', () => {
    const state = rollInitiative(createCombatState([creature], 3, 2, [{ x: 1, y: 0 }]), () => 0.9);
    const option = getMovementOption(state, 'climber', { x: 2, y: 0 });
    if (!option) {
      throw new Error('Expected routed movement option');
    }

    const moved = moveActiveCreature(state, option.path);

    expect(moved.creatures[0].position).toEqual({ x: 2, y: 0, z: 0 });
    expect(moved.turnState.remainingMovement).toBe(20);
  });

  it('returns alternate legal paths to the same destination', () => {
    const state = createCombatState([creature], 4, 3);
    const options = getMovementOptionsForDestination(state, 'climber', { x: 3, y: 1 });

    expect(options.length).toBeGreaterThan(1);
    expect(options[0].costFeet).toBe(15);
    expect(options.every((option) => option.path[0].x === 0 && option.path[0].y === 0)).toBe(true);
    expect(options.every((option) => option.position.x === 3 && option.position.y === 1)).toBe(true);
  });

  it('lets walkers step up 5 feet but not climb higher vertical terrain', () => {
    const state = createCombatState(
      [creature],
      3,
      1,
      [],
      [
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 3 }
      ]
    );

    const reachable = reachableKeys(state);

    expect(reachable).toContain('1,0,1');
    expect(reachable).not.toContain('2,0,3');
  });

  it('allows climbing speed to reach taller adjacent terrain within the climb budget', () => {
    const state = createCombatState(
      [{ ...creature, climbSpeed: 15 }],
      2,
      1,
      [],
      [{ x: 1, y: 0, z: 3 }]
    );

    expect(reachableKeys(state)).toContain('1,0,3');
  });

  it('allows flying speed to handle vertical terrain without climb speed', () => {
    const state = createCombatState(
      [{ ...creature, flySpeed: 20 }],
      2,
      1,
      [],
      [{ x: 1, y: 0, z: 4 }]
    );

    expect(reachableKeys(state)).toContain('1,0,4');
  });

  it('allows flyers to spend movement changing altitude in open air', () => {
    const state = rollInitiative(createCombatState([{ ...creature, flySpeed: 30 }]), () => 0.9);
    const option = getMovementOption(state, 'climber', { x: 0, y: 0, z: 2 });

    expect(option?.costFeet).toBe(10);

    const moved = moveActiveCreature(state, option!.path);

    expect(moved.creatures[0].position).toEqual({ x: 0, y: 0, z: 2 });
    expect(moved.turnState.remainingMovement).toBe(20);
  });

  it('lets flyers move horizontally while holding altitude above lower terrain', () => {
    const state = createCombatState([{ ...creature, flySpeed: 30, position: { x: 0, y: 0, z: 2 } }], 2, 1);
    const option = getMovementOption(state, 'climber', { x: 1, y: 0, z: 2 });

    expect(option?.path.map((position) => `${position.x},${position.y},${position.z ?? 0}`)).toEqual([
      '0,0,2',
      '1,0,2'
    ]);
  });

  it('blocks routes through hostile spaces but allows allied spaces as extra-cost transit', () => {
    const hostileBlocker: Creature = { ...creature, id: 'enemy', name: 'Enemy', team: 'enemies', position: { x: 1, y: 0 } };
    const allyBlocker: Creature = { ...creature, id: 'ally', name: 'Ally', team: 'players', position: { x: 1, y: 0 } };

    const hostileState = createCombatState([creature, hostileBlocker], 3, 1);
    expect(getMovementOption(hostileState, 'climber', { x: 2, y: 0 })).toBeUndefined();

    const alliedState = createCombatState([creature, allyBlocker], 3, 1);
    const option = getMovementOption(alliedState, 'climber', { x: 2, y: 0 });

    expect(option?.costFeet).toBe(15);
    expect(option?.path.map((position) => `${position.x},${position.y},${position.z ?? 0}`)).toEqual([
      '0,0,0',
      '1,0,0',
      '2,0,0'
    ]);
  });

  it('uses fly speed for the active turn movement budget when it is the fastest mode', () => {
    const state = rollInitiative(createCombatState([{ ...creature, speed: 10, flySpeed: 40 }]), () => 0.9);

    expect(state.turnState.remainingMovement).toBe(40);
    expect(getReachableMovementSquares(state, 'climber').some((option) => option.costFeet > 10)).toBe(true);
  });
});
