import type {
  Ability,
  AppliedCondition,
  ActionDefinition,
  AttackRollModifierContext,
  CombatState,
  ConditionDefinition,
  ConditionDurationType,
  Creature,
  RollModifier,
  RuleDefinition,
  SavingThrowModifierContext,
  StackBehavior
} from './types';

export const CORE_CONDITION_IDS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'dodging'
] as const;

export type CoreConditionId = (typeof CORE_CONDITION_IDS)[number];

export const UTILITY_CONDITION_IDS = ['hidden', 'disengaged', 'helped', 'helpedTarget', 'defeated', 'concentrating'] as const;

export type UtilityConditionId = (typeof UTILITY_CONDITION_IDS)[number];

export const ALL_CONDITION_IDS = [...CORE_CONDITION_IDS, ...UTILITY_CONDITION_IDS] as const;

function disadvantageOnOwnAttacks(context: AttackRollModifierContext): RollModifier | undefined {
  return context.conditionBearer.id === context.attacker.id ? { disadvantage: true } : undefined;
}

function advantageAgainstBearer(context: AttackRollModifierContext): RollModifier | undefined {
  return context.conditionBearer.id === context.target.id ? { advantage: true } : undefined;
}

function disadvantageAgainstBearer(context: AttackRollModifierContext): RollModifier | undefined {
  return context.conditionBearer.id === context.target.id ? { disadvantage: true } : undefined;
}

function noMove(): boolean {
  return false;
}

function noAction(): boolean {
  return false;
}

function autoFailStrengthAndDexteritySaves(context: SavingThrowModifierContext): RollModifier | undefined {
  return context.ability === 'str' || context.ability === 'dex' ? { autoFail: true } : undefined;
}

export const CORE_CONDITIONS: Record<CoreConditionId, ConditionDefinition> = {
  blinded: {
    id: 'blinded',
    name: 'Blinded',
    description: 'Cannot see. Attacks by the creature have disadvantage; attacks against it have advantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      beforeAttackRoll: (context) =>
        mergeRollModifiers(disadvantageOnOwnAttacks(context), advantageAgainstBearer(context))
    }
  },
  charmed: {
    id: 'charmed',
    name: 'Charmed',
    description: 'Cannot attack or target the charmer with harmful effects. Social checks by the charmer may have advantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {}
  },
  deafened: {
    id: 'deafened',
    name: 'Deafened',
    description: 'Cannot hear.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {}
  },
  frightened: {
    id: 'frightened',
    name: 'Frightened',
    description: 'Disadvantage on attacks and checks while the source of fear is visible.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      beforeAttackRoll: (context) =>
        !context.condition.sourceCreatureId && context.conditionBearer.id === context.attacker.id ? { disadvantage: true } : undefined,
      beforeAbilityCheck: (context) => (!context.condition.sourceCreatureId ? { disadvantage: true } : undefined)
    }
  },
  grappled: {
    id: 'grappled',
    name: 'Grappled',
    description: 'Speed becomes 0.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      canMove: noMove
    }
  },
  incapacitated: {
    id: 'incapacitated',
    name: 'Incapacitated',
    description: 'Cannot take actions or reactions.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      canTakeAction: noAction,
      canTakeReaction: noAction
    }
  },
  invisible: {
    id: 'invisible',
    name: 'Invisible',
    description: 'Attacks by the creature have advantage; attacks against it have disadvantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      beforeAttackRoll: (context) =>
        mergeRollModifiers(
          context.conditionBearer.id === context.attacker.id ? { advantage: true } : undefined,
          context.conditionBearer.id === context.target.id ? { disadvantage: true } : undefined
        )
    }
  },
  paralyzed: {
    id: 'paralyzed',
    name: 'Paralyzed',
    description: 'Cannot move, act, or react. Attacks against the creature have advantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      canMove: noMove,
      canTakeAction: noAction,
      canTakeReaction: noAction,
      beforeAttackRoll: advantageAgainstBearer,
      beforeSavingThrow: autoFailStrengthAndDexteritySaves
    }
  },
  poisoned: {
    id: 'poisoned',
    name: 'Poisoned',
    description: 'Disadvantage on attack rolls and ability checks.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      beforeAttackRoll: disadvantageOnOwnAttacks,
      beforeAbilityCheck: () => ({ disadvantage: true })
    }
  },
  prone: {
    id: 'prone',
    name: 'Prone',
    description: 'Attacks by the creature have disadvantage. Melee attacks against it have advantage; ranged attacks have disadvantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      beforeAttackRoll: (context) => {
        if (context.conditionBearer.id === context.attacker.id) {
          return { disadvantage: true };
        }

        if (context.conditionBearer.id !== context.target.id) {
          return undefined;
        }

        return context.distanceFeet <= 5 ? { advantage: true } : { disadvantage: true };
      },
      movementCostModifier: () => 2
    }
  },
  restrained: {
    id: 'restrained',
    name: 'Restrained',
    description: 'Speed becomes 0. Attacks by the creature have disadvantage; attacks against it have advantage. Dex saves have disadvantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      canMove: noMove,
      beforeAttackRoll: (context) =>
        mergeRollModifiers(disadvantageOnOwnAttacks(context), advantageAgainstBearer(context)),
      beforeSavingThrow: (context) => (context.ability === 'dex' ? { disadvantage: true } : undefined)
    }
  },
  stunned: {
    id: 'stunned',
    name: 'Stunned',
    description: 'Cannot move, act, or react. Attacks against the creature have advantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      canMove: noMove,
      canTakeAction: noAction,
      canTakeReaction: noAction,
      beforeAttackRoll: advantageAgainstBearer,
      beforeSavingThrow: autoFailStrengthAndDexteritySaves
    }
  },
  unconscious: {
    id: 'unconscious',
    name: 'Unconscious',
    description: 'Cannot move, act, or react. Attacks against the creature have advantage.',
    defaultDurationType: 'permanentUntilRemoved',
    defaultStackBehavior: 'refresh',
    hooks: {
      canMove: noMove,
      canTakeAction: noAction,
      canTakeReaction: noAction,
      beforeAttackRoll: advantageAgainstBearer,
      beforeSavingThrow: autoFailStrengthAndDexteritySaves
    }
  },
  dodging: {
    id: 'dodging',
    name: 'Dodging',
    description: 'Attacks against the creature have disadvantage if it can see the attacker; Dexterity saves have advantage.',
    defaultDurationType: 'untilStartOfTargetTurn',
    defaultStackBehavior: 'refresh',
    hooks: {
      beforeAttackRoll: disadvantageAgainstBearer,
      beforeSavingThrow: (context) => (context.ability === 'dex' ? { advantage: true } : undefined)
    }
  }
};

export const conditionRegistry: Record<string, ConditionDefinition> = { ...CORE_CONDITIONS };

conditionRegistry.hidden = {
  id: 'hidden',
  name: 'Hidden',
  description: 'Stored stealth result for first-pass hidden-state testing.',
  defaultDurationType: 'permanentUntilRemoved',
  defaultStackBehavior: 'refresh',
  hooks: {}
};

conditionRegistry.disengaged = {
  id: 'disengaged',
  name: 'Disengaged',
  description: 'Temporary marker for opportunity-attack rules later.',
  defaultDurationType: 'untilEndOfTargetTurn',
  defaultStackBehavior: 'refresh',
  hooks: {}
};

conditionRegistry.helped = {
  id: 'helped',
  name: 'Helped',
  description: 'Advantage on the next attack or ability check before the helper turn starts.',
  defaultDurationType: 'untilStartOfSourceTurn',
  defaultStackBehavior: 'refresh',
  hooks: {
    beforeAttackRoll: (context) => (context.conditionBearer.id === context.attacker.id ? { advantage: true } : undefined),
    beforeAbilityCheck: () => ({ advantage: true })
  }
};

conditionRegistry.helpedTarget = {
  id: 'helpedTarget',
  name: 'Help Target',
  description: 'Next attack against this target by an ally of the helper has advantage.',
  defaultDurationType: 'untilStartOfSourceTurn',
  defaultStackBehavior: 'refresh',
  hooks: {
    beforeAttackRoll: (context) => {
      if (context.conditionBearer.id !== context.target.id || !context.condition.sourceCreatureId) {
        return undefined;
      }

      const helper = context.state.creatures.find((creature) => creature.id === context.condition.sourceCreatureId);
      return helper && helper.team === context.attacker.team && helper.id !== context.attacker.id ? { advantage: true } : undefined;
    }
  }
};

conditionRegistry.defeated = {
  id: 'defeated',
  name: 'Defeated',
  description: 'Creature is defeated and skipped by turn flow.',
  defaultDurationType: 'permanentUntilRemoved',
  defaultStackBehavior: 'refresh',
  hooks: {
    canMove: () => false,
    canTakeAction: () => false,
    canTakeReaction: () => false
  }
};

conditionRegistry.concentrating = {
  id: 'concentrating',
  name: 'Concentrating',
  description: 'Tracks an active concentration effect and triggers Constitution saves after damage.',
  defaultDurationType: 'permanentUntilRemoved',
  defaultStackBehavior: 'refresh',
  hooks: {}
};

export function registerCondition(definition: ConditionDefinition): void {
  conditionRegistry[definition.id] = definition;
}

export function getConditionDefinition(id: string): ConditionDefinition {
  return (
    conditionRegistry[id] ?? {
      id,
      name: id,
      description: 'Homebrew condition with no configured effects.',
      defaultDurationType: 'permanentUntilRemoved',
      defaultStackBehavior: 'refresh',
      hooks: {}
    }
  );
}

export function createAppliedCondition(
  conditionId: string,
  options: {
    sourceCreatureId?: string;
    name?: string;
    description?: string;
    tags?: string[];
    durationType?: ConditionDurationType;
    remainingRounds?: number;
    stackBehavior?: StackBehavior;
    stackCount?: number;
    intensity?: number;
    metadata?: Record<string, string | number | boolean | undefined>;
    rules?: RuleDefinition[];
  } = {}
): AppliedCondition {
  const definition = getConditionDefinition(conditionId);
  return {
    id: conditionId,
    name: options.name,
    description: options.description,
    tags: options.tags,
    sourceCreatureId: options.sourceCreatureId,
    durationType: options.durationType ?? definition.defaultDurationType,
    remainingRounds: options.remainingRounds,
    stackBehavior: options.stackBehavior ?? definition.defaultStackBehavior,
    stackCount: options.stackCount ?? 1,
    intensity: options.intensity ?? 1,
    metadata: options.metadata,
    rules: options.rules
  };
}

export function normalizeConditions(conditions: Array<AppliedCondition | string> | undefined): AppliedCondition[] {
  return (conditions ?? []).map((condition) => {
    if (typeof condition === 'string') {
      return createAppliedCondition(condition);
    }
    const definition = getConditionDefinition(condition.id);
    return {
      ...condition,
      durationType: condition.durationType ?? definition.defaultDurationType,
      stackBehavior: condition.stackBehavior ?? definition.defaultStackBehavior,
      stackCount: condition.stackCount ?? 1,
      intensity: condition.intensity ?? 1,
      tags: condition.tags ?? [],
      rules: condition.rules ?? []
    };
  });
}

export function hasCondition(creature: Creature, conditionId: string): boolean {
  return normalizeConditions(creature.conditions).some((condition) => condition.id === conditionId);
}

export function getConditionLabel(condition: AppliedCondition): string {
  const definition = getConditionDefinition(condition.id);
  const concentrationName =
    condition.id === 'concentrating' && typeof condition.metadata?.concentrationName === 'string'
      ? `: ${condition.metadata.concentrationName}`
      : '';
  const stack =
    condition.stackCount > 1 ? ` x${condition.stackCount}` : condition.intensity > 1 ? ` intensity ${condition.intensity}` : '';
  const duration =
    condition.durationType === 'rounds' && condition.remainingRounds !== undefined
      ? ` (${condition.remainingRounds} rounds)`
      : '';
  return `${condition.name ?? definition.name}${concentrationName}${stack}${duration}`;
}

export function applyConditionToCreature(
  creature: Creature,
  applied: AppliedCondition
): 'applied' | 'refreshed' | 'stacked' {
  creature.conditions = normalizeConditions(creature.conditions);
  const existing = creature.conditions.find((condition) => condition.id === applied.id);

  if (!existing) {
    creature.conditions.push(applied);
    return 'applied';
  }

  if (applied.stackBehavior === 'none') {
    return 'refreshed';
  }

  if (applied.stackBehavior === 'stackCount') {
    existing.stackCount += applied.stackCount;
    existing.remainingRounds = applied.remainingRounds ?? existing.remainingRounds;
    return 'stacked';
  }

  if (applied.stackBehavior === 'stackIntensity') {
    existing.intensity += applied.intensity;
    existing.remainingRounds = applied.remainingRounds ?? existing.remainingRounds;
    return 'stacked';
  }

  existing.sourceCreatureId = applied.sourceCreatureId;
  existing.name = applied.name;
  existing.description = applied.description;
  existing.tags = applied.tags;
  existing.durationType = applied.durationType;
  existing.remainingRounds = applied.remainingRounds;
  existing.stackBehavior = applied.stackBehavior;
  existing.metadata = applied.metadata;
  existing.rules = applied.rules;
  return 'refreshed';
}

export function removeConditionFromCreature(creature: Creature, conditionId: string): boolean {
  creature.conditions = normalizeConditions(creature.conditions);
  const before = creature.conditions.length;
  creature.conditions = creature.conditions.filter((condition) => condition.id !== conditionId);
  return creature.conditions.length !== before;
}

export function expireConditionsForTurn(
  state: CombatState,
  creature: Creature,
  phase: 'start' | 'end'
): AppliedCondition[] {
  const expired: AppliedCondition[] = [];

  state.creatures.forEach((target) => {
    target.conditions = normalizeConditions(target.conditions).filter((condition) => {
      const expiresBySource =
        condition.sourceCreatureId === creature.id &&
        ((phase === 'start' && condition.durationType === 'untilStartOfSourceTurn') ||
          (phase === 'end' && condition.durationType === 'untilEndOfSourceTurn'));
      const expiresByTarget =
        target.id === creature.id &&
        ((phase === 'start' && condition.durationType === 'untilStartOfTargetTurn') ||
          (phase === 'end' && condition.durationType === 'untilEndOfTargetTurn'));

      if (expiresBySource || expiresByTarget) {
        expired.push(condition);
        return false;
      }

      return true;
    });
  });

  return expired;
}

export function tickRoundDurations(state: CombatState): AppliedCondition[] {
  const expired: AppliedCondition[] = [];

  state.creatures.forEach((creature) => {
    creature.conditions = normalizeConditions(creature.conditions).filter((condition) => {
      if (condition.durationType !== 'rounds') {
        return true;
      }

      condition.remainingRounds = Math.max(0, (condition.remainingRounds ?? 1) - 1);
      if (condition.remainingRounds === 0) {
        expired.push(condition);
        return false;
      }

      return true;
    });
  });

  return expired;
}

export function collectAttackRollModifiers(
  state: CombatState,
  attacker: Creature,
  target: Creature,
  action: ActionDefinition,
  distanceFeet: number
): RollModifier {
  return collectCreaturePairModifiers(state, attacker, target, (conditionBearer, condition) =>
    annotateRollModifier(
      getConditionDefinition(condition.id).hooks.beforeAttackRoll?.({
      state,
      attacker,
      target,
      action,
      conditionBearer,
      condition,
      distanceFeet
      }),
      condition.id
    )
  );
}

export function collectSavingThrowModifiers(
  state: CombatState,
  creature: Creature,
  ability: Ability
): RollModifier {
  return normalizeConditions(creature.conditions).reduce<RollModifier>((modifier, condition) => {
    const next = annotateRollModifier(
      getConditionDefinition(condition.id).hooks.beforeSavingThrow?.({ state, creature, ability, condition }),
      condition.id
    );
    return mergeRollModifiers(modifier, next);
  }, {});
}

export function collectAbilityCheckModifiers(
  state: CombatState,
  creature: Creature,
  ability: Ability
): RollModifier {
  return normalizeConditions(creature.conditions).reduce<RollModifier>((modifier, condition) => {
    const next = annotateRollModifier(
      getConditionDefinition(condition.id).hooks.beforeAbilityCheck?.({ state, creature, ability, condition }),
      condition.id
    );
    return mergeRollModifiers(modifier, next);
  }, {});
}

export function applyBeforeDamageModifiers(
  state: CombatState,
  source: Creature,
  target: Creature,
  action: ActionDefinition,
  amount: number
): number {
  return [source, target].reduce((currentAmount, conditionBearer) => {
    return normalizeConditions(conditionBearer.conditions).reduce((innerAmount, condition) => {
      const nextAmount = getConditionDefinition(condition.id).hooks.beforeDamage?.({
        state,
        source,
        target,
        action,
        amount: innerAmount,
        conditionBearer,
        condition
      });
      return nextAmount ?? innerAmount;
    }, currentAmount);
  }, amount);
}

export function runAfterDamageHooks(
  state: CombatState,
  source: Creature,
  target: Creature,
  action: ActionDefinition,
  amount: number
): void {
  [source, target].forEach((conditionBearer) => {
    normalizeConditions(conditionBearer.conditions).forEach((condition) => {
      getConditionDefinition(condition.id).hooks.afterDamage?.({
        state,
        source,
        target,
        action,
        amount,
        conditionBearer,
        condition
      });
    });
  });
}

export function runConditionTurnHooks(
  state: CombatState,
  creature: Creature,
  phase: 'start' | 'end'
): void {
  normalizeConditions(creature.conditions).forEach((condition) => {
    const hooks = getConditionDefinition(condition.id).hooks;
    const hook = phase === 'start' ? hooks.onTurnStart : hooks.onTurnEnd;
    hook?.({ state, creature, condition });
  });
}

export function canCreatureMove(state: CombatState, creature: Creature): boolean {
  return normalizeConditions(creature.conditions).every((condition) => {
    const hook = getConditionDefinition(condition.id).hooks.canMove;
    return hook ? hook({ state, creature, condition }) : true;
  });
}

export function canCreatureTakeAction(state: CombatState, creature: Creature): boolean {
  return normalizeConditions(creature.conditions).every((condition) => {
    const hook = getConditionDefinition(condition.id).hooks.canTakeAction;
    return hook ? hook({ state, creature, condition }) : true;
  });
}

export function canCreatureTakeReaction(state: CombatState, creature: Creature): boolean {
  return normalizeConditions(creature.conditions).every((condition) => {
    const hook = getConditionDefinition(condition.id).hooks.canTakeReaction;
    return hook ? hook({ state, creature, condition }) : true;
  });
}

export function getMovementCostMultiplier(state: CombatState, creature: Creature): number {
  return normalizeConditions(creature.conditions).reduce((multiplier, condition) => {
    const hook = getConditionDefinition(condition.id).hooks.movementCostModifier;
    return multiplier * (hook ? hook({ state, creature, condition }) : 1);
  }, 1);
}

export function mergeRollModifiers(...modifiers: Array<RollModifier | undefined>): RollModifier {
  return modifiers.reduce<RollModifier>((merged, modifier) => {
    if (!modifier) {
      return merged;
    }

    return {
      advantage: merged.advantage || modifier.advantage,
      disadvantage: merged.disadvantage || modifier.disadvantage,
      flatModifier: (merged.flatModifier ?? 0) + (modifier.flatModifier ?? 0),
      autoFail: merged.autoFail || modifier.autoFail,
      autoSuccess: merged.autoSuccess || modifier.autoSuccess,
      notes: [...(merged.notes ?? []), ...(modifier.notes ?? [])]
    };
  }, {});
}

export function resolveRollMode(modifier: RollModifier): 'normal' | 'advantage' | 'disadvantage' {
  if (modifier.advantage && !modifier.disadvantage) {
    return 'advantage';
  }

  if (modifier.disadvantage && !modifier.advantage) {
    return 'disadvantage';
  }

  return 'normal';
}

function collectCreaturePairModifiers(
  state: CombatState,
  attacker: Creature,
  target: Creature,
  getModifier: (conditionBearer: Creature, condition: AppliedCondition) => RollModifier | undefined
): RollModifier {
  return [attacker, target].reduce<RollModifier>((modifier, conditionBearer) => {
    return normalizeConditions(conditionBearer.conditions).reduce<RollModifier>((inner, condition) => {
      return mergeRollModifiers(inner, getModifier(conditionBearer, condition));
    }, modifier);
  }, {});
}

function annotateRollModifier(modifier: RollModifier | undefined, conditionId: string): RollModifier | undefined {
  if (!modifier || (!modifier.advantage && !modifier.disadvantage && !modifier.flatModifier && !modifier.autoFail && !modifier.autoSuccess)) {
    return modifier;
  }

  return {
    ...modifier,
    notes: modifier.notes && modifier.notes.length > 0 ? modifier.notes : [getConditionDefinition(conditionId).name]
  };
}
