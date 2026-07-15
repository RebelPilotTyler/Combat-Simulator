import { describe, expect, it } from 'vitest';
import { createCombatState, moveActiveCreature, rollInitiative } from './combat';
import { getMovementOption, getReachableMovementSquares } from './movement';
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

    expect(option?.costFeet).toBe(20);
    expect(option?.path.map((position) => `${position.x},${position.y},${position.z ?? 0}`)).toEqual([
      '0,0,0',
      '0,1,0',
      '1,1,0',
      '2,1,0',
      '2,0,0'
    ]);
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
    expect(moved.turnState.remainingMovement).toBe(10);
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

  it('uses fly speed for the active turn movement budget when it is the fastest mode', () => {
    const state = rollInitiative(createCombatState([{ ...creature, speed: 10, flySpeed: 40 }]), () => 0.9);

    expect(state.turnState.remainingMovement).toBe(40);
    expect(getReachableMovementSquares(state, 'climber').some((option) => option.costFeet > 10)).toBe(true);
  });
});
