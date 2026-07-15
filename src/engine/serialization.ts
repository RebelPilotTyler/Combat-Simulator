import { normalizeConditions } from './conditions';
import { DEFAULT_RULES_SETTINGS } from './combat';
import { getEffectiveMovementSpeed } from './features';
import { clampGridPosition, normalizeGridDefinition } from './grid';
import { getTilePosition } from './shapes';
import type { ActionDefinition, BotProfile, CombatState, Creature, Resource, ResourceReset, TurnResourceState } from './types';

const RESOURCE_RESET_OPTIONS: ResourceReset[] = ['turnStart', 'shortRest', 'longRest', 'dawn', 'manual', 'never'];

export interface CombatStateParseResult {
  ok: boolean;
  state?: CombatState;
  error?: string;
}

export function serializeCombatState(state: CombatState): string {
  const { visualEvents: _visualEvents, ...serializableState } = state;
  return JSON.stringify(serializableState, null, 2);
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
  const grid = normalizeGridDefinition(state.grid);
  const creatures = state.creatures.map((creature) => normalizeImportedCreature(creature, grid));
  const turnResources = normalizeTurnResources(state, creatures);
  const activeTurnResource = state.activeCreatureId ? turnResources[state.activeCreatureId] : undefined;

  return {
    ...state,
    creatures,
    grid,
    initiative: state.initiative ?? [],
    round: state.round ?? 0,
    turnIndex: state.turnIndex ?? 0,
    turnState: activeTurnResource ?? {
      ...state.turnState,
      creatureId: state.turnState?.creatureId ?? state.activeCreatureId,
      remainingMovement: numberOr(state.turnState?.remainingMovement, 0),
      movementRemaining: numberOr((state.turnState as Partial<TurnResourceState> | undefined)?.movementRemaining, state.turnState?.remainingMovement ?? 0),
      actionUsed: state.turnState?.actionUsed ?? false,
      bonusActionUsed: state.turnState?.bonusActionUsed ?? false,
      reactionUsed: state.turnState?.reactionUsed ?? false
    },
    turnResources,
    pendingReactions: state.pendingReactions ?? [],
    rulesSettings: {
      ...DEFAULT_RULES_SETTINGS,
      ...(state.rulesSettings ?? {}),
      flanking: {
        ...DEFAULT_RULES_SETTINGS.flanking!,
        ...(state.rulesSettings?.flanking ?? {})
      }
    },
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

function normalizeImportedCreature(creature: Creature, grid: CombatState['grid']): Creature {
  return {
    ...creature,
    controlMode: creature.controlMode === 'bot' ? 'bot' : 'manual',
    botProfile: normalizeBotProfile(creature.botProfile),
    position: clampGridPosition(getTilePosition(creature.position, grid), grid),
    conditions: normalizeConditions(creature.conditions),
    actions: creature.actions.map(normalizeImportedAction),
    ...(creature.resources ? { resources: creature.resources.map(normalizeImportedResource) } : {}),
    ...(creature.features
      ? {
          features: creature.features.map((feature) => ({
            ...feature,
            enabled: feature.enabled !== false,
            alternateActions: feature.alternateActions ?? [],
            rules: feature.rules ?? []
          }))
        }
      : {})
  };
}

function normalizeBotProfile(profile: Creature['botProfile']): BotProfile {
  return profile === 'aggressiveMelee' || profile === 'rangedAttacker' || profile === 'cowardly' || profile === 'support' || profile === 'passive'
    ? profile
    : 'passive';
}

function normalizeImportedAction(action: ActionDefinition): ActionDefinition {
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
    effects: action.effects ?? [],
    ...(action.resourceCosts ? { resourceCosts: action.resourceCosts } : {}),
    ...(action.rules ? { rules: action.rules } : {})
  };
}

function normalizeImportedResource(resource: Resource): Resource {
  const max = Math.max(0, numberOr(resource.max, 0));
  return {
    ...resource,
    current: clamp(numberOr(resource.current, max), 0, max),
    max,
    resetOn: RESOURCE_RESET_OPTIONS.includes(resource.resetOn) ? resource.resetOn : 'longRest',
    display: resource.display ?? { showOnCreaturePanel: true, mode: 'pips' }
  };
}

function normalizeTurnResources(state: CombatState, creatures: Creature[]): Record<string, TurnResourceState> {
  return Object.fromEntries(
    creatures.map((creature) => {
      const existing = state.turnResources?.[creature.id] as Partial<TurnResourceState> | undefined;
      const fallbackMovement = getEffectiveMovementSpeed(creature, state);
      const remainingMovement = numberOr(existing?.remainingMovement, numberOr(existing?.movementRemaining, fallbackMovement));
      const movementRemaining = numberOr(existing?.movementRemaining, remainingMovement);
      return [
        creature.id,
        {
          creatureId: creature.id,
          remainingMovement,
          movementRemaining,
          actionUsed: existing?.actionUsed ?? false,
          bonusActionUsed: existing?.bonusActionUsed ?? false,
          reactionUsed: existing?.reactionUsed ?? false
        }
      ];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number): number {
  return isNumber(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
