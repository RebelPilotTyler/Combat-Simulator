import type { CombatState, Creature } from './types';
import { createConditionLookup, type ConditionLookup } from './conditions';
import { createGridLookup, position3DKey, positionKey, type ShapeQueryLookup } from './shapes';
import { createTeamLookup, type TeamLookup } from './teams';

export interface CombatQueryContext extends ShapeQueryLookup {
  state: CombatState;
  creatures: CombatState['creatures'];
  creatureById: Map<string, Creature>;
  creaturesByPosition: Map<string, Creature[]>;
  creaturesByTile: Map<string, Creature[]>;
  conditions: ConditionLookup;
  teams: TeamLookup;
  lineOfSight: Map<string, boolean>;
}

export function createCombatQueryContext(state: CombatState): CombatQueryContext {
  const grid = createGridLookup(state.grid);
  return {
    state,
    creatures: state.creatures,
    grid,
    creatureById: new Map(state.creatures.map((creature) => [creature.id, creature])),
    creaturesByPosition: groupCreatures(state.creatures, position3DKey),
    creaturesByTile: groupCreatures(state.creatures, positionKey),
    conditions: createConditionLookup(state.creatures),
    teams: createTeamLookup(state),
    shapeSquares: new Map(),
    lineOfSight: new Map()
  };
}

export function isCombatQueryContextCurrent(context: CombatQueryContext | undefined, state: CombatState): context is CombatQueryContext {
  return (
    context?.state === state &&
    context.creatures === state.creatures &&
    context.grid.grid === state.grid &&
    context.teams.teams === state.teams
  );
}

export function getCombatQueryContext(state: CombatState, context?: CombatQueryContext): CombatQueryContext {
  return isCombatQueryContextCurrent(context, state) ? context : createCombatQueryContext(state);
}

function groupCreatures(
  creatures: Creature[],
  getKey: (creature: Creature['position']) => string
): Map<string, Creature[]> {
  const groups = new Map<string, Creature[]>();
  creatures.forEach((creature) => {
    const key = getKey(creature.position);
    const group = groups.get(key) ?? [];
    group.push(creature);
    groups.set(key, group);
  });
  return groups;
}
