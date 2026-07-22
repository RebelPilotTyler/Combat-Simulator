export type TeamId = string;

export type Team = TeamId;

export type TeamRelationship = 'allied' | 'hostile' | 'neutral';

export interface TeamDefinition {
  id: TeamId;
  name: string;
  color: string;
  neutral?: boolean;
  relationships?: Partial<Record<TeamId, TeamRelationship>>;
}

export type CreatureControlMode = 'manual' | 'bot';

export type BotProfile = 'aggressiveMelee' | 'rangedAttacker' | 'cowardly' | 'support' | 'passive';

export type BotTargetPriority = 'balanced' | 'nearest' | 'weakest' | 'lowestHp' | 'easiestToHit';

export type BotResourceStrategy = 'normal' | 'conserve' | 'spendFreely';

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

export type ActionTargetMode = 'creature' | 'point' | 'self';

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
  | 'onDefeated'
  | 'whileActive';

export type ReactionTriggerPoint = Exclude<RuleTriggerPoint, 'beforeAttackRoll' | 'beforeDamage' | 'beforeSavingThrow' | 'whileActive'>;

export type EffectOperationType =
  | 'addFlatModifier'
  | 'grantAdvantage'
  | 'grantDisadvantage'
  | 'addDamageDice'
  | 'dealDamage'
  | 'savingThrowDamage'
  | 'multiplyDamage'
  | 'reduceDamage'
  | 'setDamageMinimum'
  | 'grantDamageResistance'
  | 'grantDamageImmunity'
  | 'grantDamageVulnerability'
  | 'multiplyMovementCost'
  | 'modifyArmorClass'
  | 'modifySpeed'
  | 'modifyAttackBonus'
  | 'modifySavingThrowBonus'
  | 'modifySaveDc'
  | 'applyCondition'
  | 'applyConditionOnFailedSave'
  | 'removeCondition'
  | 'pushCreature'
  | 'pullCreature'
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
  | 'creaturesWithinRange'
  | 'sourceWithinRange'
  | 'alliesWithinRange'
  | 'enemiesWithinRange';

export type RuleFilterType =
  | 'actionHasTag'
  | 'targetHasCondition'
  | 'sourceHasCondition'
  | 'hpBelowHalf'
  | 'resourceAvailable'
  | 'damageTaken'
  | 'damageType'
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
  | { type: 'damageTaken'; minimum?: number }
  | { type: 'damageType'; damageType: string }
  | { type: 'oncePerTurn'; key?: string }
  | { type: 'oncePerRound'; key?: string };

export type RuleEffectOperation =
  | { type: 'addFlatModifier'; amount: number; note?: string }
  | { type: 'grantAdvantage'; note?: string }
  | { type: 'grantDisadvantage'; note?: string }
  | { type: 'addDamageDice'; dice: string; damageType?: string; note?: string }
  | { type: 'dealDamage'; dice: string; damageType?: string; note?: string }
  | { type: 'savingThrowDamage'; ability: Ability; dc: number; dice: string; damageType?: string; halfDamageOnSuccess: boolean; note?: string }
  | { type: 'multiplyDamage'; factor: number; note?: string }
  | { type: 'reduceDamage'; amount: number; note?: string }
  | { type: 'setDamageMinimum'; amount: number; note?: string }
  | { type: 'grantDamageResistance'; damageType: string; note?: string }
  | { type: 'grantDamageImmunity'; damageType: string; note?: string }
  | { type: 'grantDamageVulnerability'; damageType: string; note?: string }
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
  | {
      type: 'applyConditionOnFailedSave';
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
  | { type: 'pushCreature'; distanceFeet: number; note?: string }
  | { type: 'pullCreature'; distanceFeet: number; note?: string }
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

export interface ReactionTriggerDefinition {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger: ReactionTriggerPoint;
  selectors?: RuleTargetSelector[];
  filters?: RuleFilter[];
  target?: RuleCreatureReference;
  description?: string;
  reactorMustBeSelected?: boolean;
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
  targetMode?: ActionTargetMode;
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
  reactionTriggers?: ReactionTriggerDefinition[];
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
  botTargetPriority?: BotTargetPriority;
  botResourceStrategy?: BotResourceStrategy;
  hp: number;
  maxHp: number;
  ac: number;
  abilityScores: AbilityScores;
  proficiencyBonus: number;
  speed: number;
  climbSpeed?: number;
  flySpeed?: number;
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
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
  trigger: 'opportunityAttack' | ReactionTriggerPoint;
  reactorId: string;
  targetId?: string;
  actionId: string;
  from?: GridPosition;
  to?: GridPosition;
  description: string;
}

export interface CombatRulesSettings {
  flanking?: {
    enabled: boolean;
    benefit: 'advantage';
  };
}

export interface BotMemoryEntry {
  lastTargetId?: string;
  lastTargetRound?: number;
  lastAttackerId?: string;
  lastAttackedRound?: number;
  lastDamagedById?: string;
  lastDamagedRound?: number;
}

export interface CombatState {
  creatures: Creature[];
  teams: TeamDefinition[];
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
  botMemory?: Record<string, BotMemoryEntry>;
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
