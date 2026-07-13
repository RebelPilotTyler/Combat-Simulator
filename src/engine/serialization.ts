import { normalizeConditions } from './conditions';
import type { CombatState, Creature } from './types';

export interface CombatStateParseResult {
  ok: boolean;
  state?: CombatState;
  error?: string;
}

export function serializeCombatState(state: CombatState): string {
  return JSON.stringify(state, null, 2);
}

export function parseCombatStateJson(text: string): CombatStateParseResult {
  try {
    const parsed = JSON.parse(text) as unknown;
    const validationError = validateCombatStateShape(parsed);

    if (validationError) {
      return { ok: false, error: validationError };
    }

    return { ok: true, state: normalizeImportedCombatState(parsed as CombatState) };
  } catch {
    return { ok: false, error: 'Invalid JSON. Check for a missing comma, quote, or bracket.' };
  }
}

export function validateCombatStateShape(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return 'Invalid combat JSON: expected a CombatState object.';
  }

  if (!Array.isArray(value.creatures)) {
    return 'Invalid combat JSON: missing creatures array.';
  }

  if (!isRecord(value.grid)) {
    return 'Invalid combat JSON: missing grid object.';
  }

  if (!isNumber(value.grid.width) || !isNumber(value.grid.height) || !Array.isArray(value.grid.blocked)) {
    return 'Invalid combat JSON: grid must include width, height, and blocked cells.';
  }

  const requiredArrays = ['initiative', 'pendingReactions', 'log'] as const;
  for (const field of requiredArrays) {
    if (!Array.isArray(value[field])) {
      return `Invalid combat JSON: missing ${field} array.`;
    }
  }

  if (!isNumber(value.round)) {
    return 'Invalid combat JSON: missing round number.';
  }

  if (!isNumber(value.turnIndex)) {
    return 'Invalid combat JSON: missing turnIndex number.';
  }

  if (!isRecord(value.turnState)) {
    return 'Invalid combat JSON: missing turnState object.';
  }

  if (!isRecord(value.turnResources)) {
    return 'Invalid combat JSON: missing turnResources object.';
  }

  for (const creature of value.creatures) {
    const creatureError = validateCreatureShape(creature);
    if (creatureError) {
      return creatureError;
    }
  }

  return undefined;
}

export function normalizeImportedCombatState(state: CombatState): CombatState {
  const creatures = state.creatures.map(normalizeImportedCreature);

  return {
    ...state,
    creatures,
    grid: {
      ...state.grid,
      blocked: state.grid.blocked ?? []
    },
    initiative: state.initiative ?? [],
    round: state.round ?? 0,
    turnIndex: state.turnIndex ?? 0,
    turnState: {
      ...state.turnState,
      creatureId: state.turnState?.creatureId ?? state.activeCreatureId,
      remainingMovement: state.turnState?.remainingMovement ?? 0,
      actionUsed: state.turnState?.actionUsed ?? false,
      bonusActionUsed: state.turnState?.bonusActionUsed ?? false,
      reactionUsed: state.turnState?.reactionUsed ?? false
    },
    turnResources: state.turnResources ?? {},
    pendingReactions: state.pendingReactions ?? [],
    ruleMemory: state.ruleMemory ?? {},
    log: state.log ?? []
  };
}

function validateCreatureShape(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return 'Invalid combat JSON: every creature must be an object.';
  }

  const name = typeof value.name === 'string' ? value.name : 'A creature';
  const requiredStrings = ['id', 'name', 'team'] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== 'string') {
      return `Invalid combat JSON: ${name} is missing ${field}.`;
    }
  }

  const requiredNumbers = ['hp', 'maxHp', 'ac', 'proficiencyBonus', 'speed'] as const;
  for (const field of requiredNumbers) {
    if (!isNumber(value[field])) {
      return `Invalid combat JSON: ${name} is missing numeric ${field}.`;
    }
  }

  if (!isRecord(value.abilityScores)) {
    return `Invalid combat JSON: ${name} is missing abilityScores.`;
  }

  if (!isRecord(value.position) || !isNumber(value.position.x) || !isNumber(value.position.y)) {
    return `Invalid combat JSON: ${name} is missing grid position.`;
  }

  if (!Array.isArray(value.conditions)) {
    return `Invalid combat JSON: ${name} is missing conditions array.`;
  }

  if (!Array.isArray(value.actions)) {
    return `Invalid combat JSON: ${name} is missing actions array.`;
  }

  return undefined;
}

function normalizeImportedCreature(creature: Creature): Creature {
  return {
    ...creature,
    conditions: normalizeConditions(creature.conditions),
    actions: creature.actions.map((action) => {
      const kind = action.kind ?? action.type ?? 'custom';
      const type = kind === 'multiattack' || kind === 'basicAction'
        ? undefined
        : action.type ?? (kind === 'meleeAttack' || kind === 'rangedAttack' || kind === 'savingThrowEffect' ? kind : undefined);
      return {
        ...action,
        kind,
        type,
        actionCost: action.actionCost ?? 'action',
        tags: action.tags ?? [],
        effects: action.effects ?? []
      };
    })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
