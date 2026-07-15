export type Team = 'players' | 'enemies' | 'neutral';

export type CreatureControlMode = 'manual' | 'bot';

export type BotProfile = 'aggressiveMelee' | 'rangedAttacker' | 'cowardly' | 'support' | 'passive';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type ConditionId = string;

export type ConditionDurationType =
  | 'untilStartOfSourceTurn'
  | 'untilEndOfSourceTurn'
  | 'untilStartOfTargetTurn'
  | 'untilEndOfTargetTurn'
  | 'rounds'
  | 'permanentUntilRemoved';

export type StackBehavior = 'none' | 'refresh' | 'stackCount' | 'stackIntensity';

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export type Skill = 'athletics' | 'acrobatics' | 'stealth' | 'perception' | 'investigation';

export type ActionKind = 'meleeAttack' | 'rangedAttack' | 'savingThrowEffect' | 'basicAction' | 'spell' | 'multiattack' | 'custom';

export type ActionCost = 'action' | 'bonusAction' | 'reaction' | 'free';

export type ResourceReset = 'turnStart' | 'shortRest' | 'longRest' | 'dawn' | 'manual' | 'never';

export type ResourceDisplay = 'pips' | 'number' | 'bar';

export type ResourceConsumeOn = 'use' | 'hit' | 'failedSave' | 'manual';

export type ActionTag = string;

export type RuleTriggerPoint =
  | 'beforeAttackRoll'
  | 'afterAttackRoll'
  | 'beforeDamage'
  | 'afterDamage'
  | 'beforeSavingThrow'
  | 'afterSavingThrow'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onActionUsed'
  | 'onConditionApplied'
  | 'whileActive';

export type EffectOperationType =
  | 'addFlatModifier'
  | 'grantAdvantage'
  | 'grantDisadvantage'
  | 'addDamageDice'
  | 'dealDamage'
  | 'multiplyDamage'
  | 'reduceDamage'
  | 'setDamageMinimum'
  | 'multiplyMovementCost'
  | 'modifyArmorClass'
  | 'modifySpeed'
  | 'modifyAttackBonus'
  | 'modifySavingThrowBonus'
  | 'modifySaveDc'
  | 'applyCondition'
  | 'removeCondition'
  | 'spendResource'
  | 'restoreResource'
  | 'addTag'
  | 'removeTag'
  | 'logMessage';

export type TargetSelectorType =
  | 'self'
  | 'actionTarget'
  | 'source'
  | 'creaturesInArea'
  | 'alliesWithinRange'
  | 'enemiesWithinRange';

export type RuleFilterType =
  | 'actionHasTag'
  | 'targetHasCondition'
  | 'sourceHasCondition'
  | 'hpBelowHalf'
  | 'resourceAvailable'
  | 'oncePerTurn'
  | 'oncePerRound';

export interface RuleTargetSelector {
  type: TargetSelectorType;
  range?: number;
}

export type RuleCreatureReference = 'self' | 'source' | 'actionTarget';

export type RuleFilter =
  | { type: 'actionHasTag'; tag: ActionTag }
  | { type: 'targetHasCondition'; conditionId: ConditionId }
  | { type: 'sourceHasCondition'; conditionId: ConditionId }
  | { type: 'hpBelowHalf'; target?: RuleCreatureReference }
  | { type: 'resourceAvailable'; resourceId: string; amount?: number; target?: RuleCreatureReference }
  | { type: 'oncePerTurn'; key?: string }
  | { type: 'oncePerRound'; key?: string };

export type RuleEffectOperation =
  | { type: 'addFlatModifier'; amount: number; note?: string }
  | { type: 'grantAdvantage'; note?: string }
  | { type: 'grantDisadvantage'; note?: string }
  | { type: 'addDamageDice'; dice: string; damageType?: string; note?: string }
  | { type: 'dealDamage'; dice: string; damageType?: string; note?: string }
  | { type: 'multiplyDamage'; factor: number; note?: string }
  | { type: 'reduceDamage'; amount: number; note?: string }
  | { type: 'setDamageMinimum'; amount: number; note?: string }
  | { type: 'multiplyMovementCost'; factor: number; note?: string }
  | { type: 'modifyArmorClass'; amount: number; note?: string }
  | { type: 'modifySpeed'; amount: number; note?: string }
  | { type: 'modifyAttackBonus'; amount: number; note?: string }
  | { type: 'modifySavingThrowBonus'; ability?: Ability; amount: number; note?: string }
  | { type: 'modifySaveDc'; amount: number; note?: string }
  | {
      type: 'applyCondition';
      conditionId: ConditionId;
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
      note?: string;
    }
  | { type: 'removeCondition'; conditionId: ConditionId; note?: string }
  | { type: 'spendResource'; resourceId: string; amount: number; note?: string }
  | { type: 'restoreResource'; resourceId: string; amount: number; note?: string }
  | { type: 'addTag'; tag: ActionTag; note?: string }
  | { type: 'removeTag'; tag: ActionTag; note?: string }
  | { type: 'logMessage'; message: string };

export interface RuleDefinition {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger: RuleTriggerPoint;
  selectors?: RuleTargetSelector[];
  filters?: RuleFilter[];
  effects: RuleEffectOperation[];
}

export interface RollModifier {
  advantage?: boolean;
  disadvantage?: boolean;
  flatModifier?: number;
  autoFail?: boolean;
  autoSuccess?: boolean;
  notes?: string[];
}

export interface AppliedCondition {
  id: ConditionId;
  name?: string;
  description?: string;
  tags?: string[];
  sourceCreatureId?: string;
  durationType: ConditionDurationType;
  remainingRounds?: number;
  stackBehavior: StackBehavior;
  stackCount: number;
  intensity: number;
  metadata?: Record<string, string | number | boolean | undefined>;
  rules?: RuleDefinition[];
}

export interface ConditionLifecycleContext {
  state: CombatState;
  creature: Creature;
  condition: AppliedCondition;
}

export interface AttackRollModifierContext {
  state: CombatState;
  attacker: Creature;
  target: Creature;
  action: ActionDefinition;
  conditionBearer: Creature;
  condition: AppliedCondition;
  distanceFeet: number;
}

export interface SavingThrowModifierContext {
  state: CombatState;
  creature: Creature;
  ability: Ability;
  condition: AppliedCondition;
}

export interface AbilityCheckModifierContext {
  state: CombatState;
  creature: Creature;
  ability: Ability;
  condition: AppliedCondition;
}

export interface DamageModifierContext {
  state: CombatState;
  source: Creature;
  target: Creature;
  action: ActionDefinition;
  amount: number;
  conditionBearer: Creature;
  condition: AppliedCondition;
}

export interface MovementContext {
  state: CombatState;
  creature: Creature;
  condition: AppliedCondition;
}

export interface ConditionEffectHooks {
  onTurnStart?: (context: ConditionLifecycleContext) => void;
  onTurnEnd?: (context: ConditionLifecycleContext) => void;
  beforeAttackRoll?: (context: AttackRollModifierContext) => RollModifier | undefined;
  beforeSavingThrow?: (context: SavingThrowModifierContext) => RollModifier | undefined;
  beforeAbilityCheck?: (context: AbilityCheckModifierContext) => RollModifier | undefined;
  beforeDamage?: (context: DamageModifierContext) => number | undefined;
  afterDamage?: (context: DamageModifierContext) => void;
  canMove?: (context: MovementContext) => boolean;
  canTakeAction?: (context: MovementContext) => boolean;
  canTakeReaction?: (context: MovementContext) => boolean;
  movementCostModifier?: (context: MovementContext) => number;
}

export interface ConditionDefinition {
  id: ConditionId;
  name: string;
  description: string;
  defaultDurationType: ConditionDurationType;
  defaultStackBehavior: StackBehavior;
  hooks: ConditionEffectHooks;
  rules?: RuleDefinition[];
}

export interface CustomConditionTemplate {
  id: string;
  name: string;
  description: string;
  defaultDurationType?: ConditionDurationType;
  defaultRemainingRounds?: number;
  stackBehavior?: StackBehavior;
  tags: string[];
  notes?: string;
  rules: RuleDefinition[];
  updatedAt?: string;
}

export interface AbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface GridPosition {
  x: number;
  y: number;
  z?: number;
}

export type CardinalDirection = 'north' | 'east' | 'south' | 'west';

export interface GridDefinition {
  width: number;
  height: number;
  blocked: GridPosition[];
  heights?: GridPosition[];
}

export interface DamageDefinition {
  dice: string;
  type?: string;
}

export interface SaveDefinition {
  ability: Ability;
  dc: number;
  halfDamageOnSuccess: boolean;
}

export type ShapeType = 'single' | 'line' | 'radius' | 'cone';

export interface ShapeDefinition {
  type: ShapeType;
  length?: number;
  radius?: number;
  direction?: CardinalDirection;
}

export interface VisualEffectStyle {
  color?: string;
}

export interface EffectDefinition {
  id: string;
  name: string;
  type: 'damage' | 'condition';
  damage?: DamageDefinition;
  save?: SaveDefinition;
  condition?: ConditionId;
  visual?: VisualEffectStyle;
}

export interface Resource {
  id: string;
  name: string;
  current: number;
  max: number;
  resetOn: ResourceReset;
  display?: {
    showOnCreaturePanel: boolean;
    mode: ResourceDisplay;
  };
}

export interface ResourceCost {
  resourceId: string;
  amount: number;
  consumeOn: ResourceConsumeOn;
  spendActionWhenDepleted?: boolean;
}

export interface StatModifiers {
  speed?: number;
  climbSpeed?: number;
  flySpeed?: number;
  ac?: number;
  attackBonus?: number;
  saveDc?: number;
  saveBonus?: Partial<Record<Ability, number>>;
  abilityScoreBonus?: Partial<Record<Ability, number>>;
  maxHp?: number;
}

export interface FeatureAlternateAction {
  id: string;
  name: string;
  baseActionName?: string;
  baseActionId?: string;
  actionCost: ActionCost;
  tags: ActionTag[];
  resourceCosts?: ResourceCost[];
  description?: string;
}

export interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  modifiers?: StatModifiers;
  alternateActions?: FeatureAlternateAction[];
  rules?: RuleDefinition[];
  resourceCostModifiers?: Array<{
    actionTag?: ActionTag;
    resourceId: string;
    amountDelta: number;
  }>;
}

export type ActionType = 'meleeAttack' | 'rangedAttack' | 'savingThrowEffect';

export interface MultiattackStep {
  id: string;
  name: string;
  actionId?: string;
  inlineAction?: ActionDefinition;
  targetId?: string;
  required?: boolean;
}

export interface ActionDefinition {
  id: string;
  name: string;
  kind: ActionKind;
  type?: ActionType;
  actionCost: ActionCost;
  tags: ActionTag[];
  range: number;
  reach?: number;
  normalRange?: number;
  longRange?: number;
  attackBonus?: number;
  damage?: DamageDefinition;
  save?: SaveDefinition;
  shape?: ShapeDefinition;
  effects: EffectDefinition[];
  visual?: VisualEffectStyle;
  description?: string;
  resourceCosts?: ResourceCost[];
  rules?: RuleDefinition[];
  generatedByFeatureId?: string;
  baseActionName?: string;
  multiattack?: {
    steps: MultiattackStep[];
    targetMode?: 'sameTarget' | 'chooseEach' | 'fixed';
  };
}

export interface ReadiedAction {
  actionId: string;
  actionName: string;
  trigger: string;
}

export interface Creature {
  id: string;
  name: string;
  team: Team;
  controlMode?: CreatureControlMode;
  botProfile?: BotProfile;
  hp: number;
  maxHp: number;
  ac: number;
  abilityScores: AbilityScores;
  proficiencyBonus: number;
  speed: number;
  climbSpeed?: number;
  flySpeed?: number;
  position: GridPosition;
  conditions: AppliedCondition[];
  actions: ActionDefinition[];
  resources?: Resource[];
  features?: FeatureDefinition[];
  skillBonuses?: Partial<Record<Skill, number>>;
  readiedAction?: ReadiedAction;
}

export interface InitiativeEntry {
  creatureId: string;
  roll: number;
  modifier: number;
  total: number;
}

export interface CombatLogEntry {
  id: string;
  round: number;
  turn: number;
  type:
    | 'initiative'
    | 'turn'
    | 'movement'
    | 'action'
    | 'attack'
    | 'damage'
    | 'save'
    | 'condition'
    | 'defeat'
    | 'system';
  message: string;
  timestamp: string;
}

export type VisualEventKind =
  | 'attackHit'
  | 'attackMiss'
  | 'criticalHit'
  | 'damageDealt'
  | 'healingReceived'
  | 'conditionApplied'
  | 'conditionRemoved'
  | 'savingThrowSuccess'
  | 'savingThrowFailure'
  | 'opportunityAttackTriggered'
  | 'creatureDefeated'
  | 'movementComplete'
  | 'resourceSpent'
  | 'attackImpact'
  | 'shapeEffect';

export interface VisualEvent {
  id: string;
  kind: VisualEventKind;
  creatureId: string;
  sourceCreatureId?: string;
  amount?: number;
  label?: string;
  conditionId?: string;
  conditionName?: string;
  resourceId?: string;
  resourceName?: string;
  color?: string;
  origin?: GridPosition;
  direction?: CardinalDirection;
  shape?: ShapeDefinition;
  targetIds?: string[];
  from?: GridPosition;
  to?: GridPosition;
  path?: GridPosition[];
  createdAt: number;
  durationMs: number;
}

export interface TurnState {
  creatureId?: string;
  remainingMovement: number;
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
}

export interface TurnResourceState extends TurnState {
  movementRemaining: number;
}

export interface PendingReaction {
  id: string;
  trigger: 'opportunityAttack';
  reactorId: string;
  targetId: string;
  actionId: string;
  from: GridPosition;
  to: GridPosition;
  description: string;
}

export interface CombatRulesSettings {
  flanking?: {
    enabled: boolean;
    benefit: 'advantage';
  };
}

export interface CombatState {
  creatures: Creature[];
  grid: GridDefinition;
  initiative: InitiativeEntry[];
  round: number;
  turnIndex: number;
  activeCreatureId?: string;
  turnState: TurnState;
  turnResources: Record<string, TurnResourceState>;
  pendingReactions: PendingReaction[];
  rulesSettings?: CombatRulesSettings;
  ruleMemory?: Record<string, { turnKey?: string; round?: number }>;
  visualEvents?: VisualEvent[];
  log: CombatLogEntry[];
}

export interface AttackRollContext {
  attacker: Creature;
  target: Creature;
  action: ActionDefinition;
  attackTotal?: number;
}

export interface DamageContext {
  source: Creature;
  target: Creature;
  action: ActionDefinition;
  amount?: number;
}

export interface CombatHooks {
  onTurnStart?: (state: CombatState, creature: Creature) => void;
  onTurnEnd?: (state: CombatState, creature: Creature) => void;
  beforeAttackRoll?: (state: CombatState, context: AttackRollContext) => void;
  afterAttackRoll?: (state: CombatState, context: AttackRollContext) => void;
  beforeDamage?: (state: CombatState, context: DamageContext) => void;
  afterDamage?: (state: CombatState, context: DamageContext) => void;
  onCreatureDefeated?: (state: CombatState, creature: Creature) => void;
}
