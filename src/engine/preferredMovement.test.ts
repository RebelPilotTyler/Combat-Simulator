import { describe, expect, it } from 'vitest';
import {
  createCombatState,
  getOpportunityAttackCandidatesForMovementPath
} from './combat';
import {
  getMovementOptionsForDestination,
  getMovementOptionsForDestinations,
  getReachableMovementSquares,
  type MovementOption
} from './movement';
import { analyzePreferredMovementOptions } from './preferredMovement';
import { createCombatQueryContext } from './queryContext';
import { position3DKey } from './shapes';
import type { ActionDefinition, CombatState, Creature, GridPosition } from './types';

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

function positionLabel(position: GridPosition): string {
  return `${position.x},${position.y},${position.z ?? 0}`;
}

function selectLegacyPreferredOption(
  state: CombatState,
  mover: Creature,
  option: MovementOption
): MovementOption {
  const alternatives = getMovementOptionsForDestination(state, mover.id, option.position);
  if (alternatives.length === 0) {
    return option;
  }

  return alternatives.reduce((best, candidate) => {
    const bestRisk = getOpportunityAttackCandidatesForMovementPath(state, mover, best.path).length;
    const candidateRisk = getOpportunityAttackCandidatesForMovementPath(state, mover, candidate.path).length;
    if (candidateRisk !== bestRisk) {
      return candidateRisk < bestRisk ? candidate : best;
    }
    if (candidate.costFeet !== best.costFeet) {
      return candidate.costFeet < best.costFeet ? candidate : best;
    }
    return candidate.path.length < best.path.length ? candidate : best;
  }, alternatives[0]);
}

describe('preferred movement analysis', () => {
  it('returns the same capped candidate paths as independent destination searches', () => {
    const state = createCombatState(
      [
        creature({ id: 'mover', speed: 15, climbSpeed: 10, flySpeed: 15, position: { x: 0, y: 1 } }),
        creature({ id: 'ally', position: { x: 1, y: 2 } }),
        creature({ id: 'enemy', team: 'enemies', position: { x: 2, y: 2 } })
      ],
      5,
      4,
      [{ x: 1, y: 0 }],
      [{ x: 3, y: 1, z: 1 }]
    );
    const query = createCombatQueryContext(state);
    const destinations = getReachableMovementSquares(state, 'mover', query).map((option) => option.position);
    const batched = getMovementOptionsForDestinations(state, 'mover', destinations, 8, query);

    destinations.forEach((destination) => {
      expect(batched.get(position3DKey(destination))).toEqual(
        getMovementOptionsForDestination(state, 'mover', destination, 8, query)
      );
    });
  });

  it('preserves exact preferred paths and opportunity-attack candidates', () => {
    const state = createCombatState(
      [
        creature({ id: 'mover', speed: 15, position: { x: 0, y: 1 } }),
        creature({ id: 'guard-north', team: 'enemies', position: { x: 1, y: 0 } }),
        creature({ id: 'guard-east', team: 'enemies', position: { x: 2, y: 2 } }),
        creature({ id: 'ally', position: { x: 1, y: 2 } })
      ],
      5,
      4,
      [{ x: 2, y: 1 }]
    );
    const mover = state.creatures[0];
    const query = createCombatQueryContext(state);
    const baseOptions = getReachableMovementSquares(state, mover.id, query);
    const legacyOptions = new Map(
      baseOptions.map((option) => {
        const preferred = selectLegacyPreferredOption(state, mover, option);
        return [position3DKey(option.position), preferred];
      })
    );
    const analysis = analyzePreferredMovementOptions(state, mover, baseOptions, query);

    expect(analysis.optionByDestination).toEqual(legacyOptions);
    const snapshot = [...analysis.optionByDestination].map(([destination, option]) => ({
      destination,
      costFeet: option.costFeet,
      path: option.path.map(positionLabel),
      opportunityAttacks: (analysis.opportunityCandidatesByDestination.get(destination) ?? []).map((candidate) => ({
        creatureId: candidate.creature.id,
        from: positionLabel(candidate.from),
        to: positionLabel(candidate.to)
      }))
    }));
    expect(snapshot).toEqual([
      {
        destination: '0,0,0',
        costFeet: 5,
        path: ['0,1,0', '0,0,0'],
        opportunityAttacks: []
      },
      {
        destination: '1,1,0',
        costFeet: 5,
        path: ['0,1,0', '1,1,0'],
        opportunityAttacks: []
      },
      {
        destination: '0,2,0',
        costFeet: 5,
        path: ['0,1,0', '0,2,0'],
        opportunityAttacks: [{
          creatureId: 'guard-north',
          from: '0,1,0',
          to: '0,2,0'
        }]
      },
      {
        destination: '0,3,0',
        costFeet: 10,
        path: ['0,1,0', '0,2,0', '0,3,0'],
        opportunityAttacks: [{
          creatureId: 'guard-north',
          from: '0,1,0',
          to: '0,2,0'
        }]
      },
      {
        destination: '1,3,0',
        costFeet: 10,
        path: ['0,1,0', '0,2,0', '1,3,0'],
        opportunityAttacks: [{
          creatureId: 'guard-north',
          from: '0,1,0',
          to: '0,2,0'
        }]
      },
      {
        destination: '2,3,0',
        costFeet: 15,
        path: ['0,1,0', '1,2,0', '2,3,0'],
        opportunityAttacks: [{
          creatureId: 'guard-north',
          from: '0,1,0',
          to: '1,2,0'
        }]
      }
    ]);
  });
});
