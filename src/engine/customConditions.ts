import type {
  AppliedCondition,
  ConditionDurationType,
  CustomConditionTemplate,
  RuleDefinition,
  RuleEffectOperation,
  RuleFilter,
  RuleTargetSelector,
  RuleTriggerPoint,
  StackBehavior
} from './types';
import { ALL_CONDITION_IDS, registerCondition, unregisterCondition } from './conditions';

export const CUSTOM_CONDITION_LIBRARY_KEY = 'dnd5e-combat.customConditionLibrary.v1';
const coreConditionIds = new Set<string>(ALL_CONDITION_IDS);
const registeredCustomConditionIds = new Set<string>();

const ruleTriggers: RuleTriggerPoint[] = [
  'beforeAttackRoll',
  'afterAttackRoll',
  'beforeDamage',
  'afterDamage',
  'beforeSavingThrow',
  'afterSavingThrow',
  'onTurnStart',
  'onTurnEnd',
  'onActionUsed',
  'onConditionApplied',
  'onDefeated',
  'whileActive'
];

const durationTypes: ConditionDurationType[] = [
  'untilStartOfSourceTurn',
  'untilEndOfSourceTurn',
  'untilStartOfTargetTurn',
  'untilEndOfTargetTurn',
  'rounds',
  'permanentUntilRemoved'
];

const stackBehaviors: StackBehavior[] = ['none', 'refresh', 'stackCount', 'stackIntensity'];

export const REFERENCE_CONDITION_TEMPLATES: CustomConditionTemplate[] = [
  conditionTemplate('blinded', 'Blinded', 'Cannot see. Attacks by the creature have disadvantage; attacks against it have advantage.', ['core', 'senses'], [
    rule('blinded-own-attacks', 'Blinded creature attacks with disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantDisadvantage', note: 'Blinded' }
    ]),
    rule('blinded-attacks-against', 'Attacks against blinded creature have advantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'blinded' }], [
      { type: 'grantAdvantage', note: 'Target is blinded' }
    ])
  ]),
  conditionTemplate('charmed', 'Charmed', 'Cannot attack or target the charmer with harmful effects. The core engine enforces the source-specific targeting restriction.', ['core', 'mental'], []),
  conditionTemplate('deafened', 'Deafened', 'Cannot hear. The current engine has no hearing-specific checks, so this is mostly a tracking condition.', ['core', 'senses'], []),
  conditionTemplate('frightened', 'Frightened', 'Disadvantage on attacks while afraid. The core engine handles source-specific line-of-sight behavior.', ['core', 'fear'], [
    rule('frightened-attacks', 'Frightened creature attacks with disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantDisadvantage', note: 'Frightened' }
    ])
  ]),
  conditionTemplate('grappled', 'Grappled', 'Speed becomes 0. Core behavior prevents movement; the custom-rule approximation shown here doubles movement cost instead.', ['core', 'movement'], [
    rule('grappled-movement', 'Movement is heavily restricted', 'whileActive', [{ type: 'self' }], [], [
      { type: 'multiplyMovementCost', factor: 99, note: 'Grappled' }
    ])
  ]),
  conditionTemplate('incapacitated', 'Incapacitated', 'Cannot take actions or reactions. This is core engine behavior; custom rules cannot currently disable action spending directly.', ['core', 'control'], []),
  conditionTemplate('invisible', 'Invisible', 'Attacks by the creature have advantage; attacks against it have disadvantage.', ['core', 'senses'], [
    rule('invisible-attacks', 'Invisible creature attacks with advantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantAdvantage', note: 'Invisible' }
    ]),
    rule('attacks-against-invisible', 'Attacks against invisible creature have disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'invisible' }], [
      { type: 'grantDisadvantage', note: 'Target is invisible' }
    ])
  ]),
  conditionTemplate('paralyzed', 'Paralyzed', 'Cannot move, act, or react. Attacks against the creature have advantage; Strength and Dexterity saves fail.', ['core', 'control'], [
    rule('paralyzed-attacks-against', 'Attacks against paralyzed creature have advantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'paralyzed' }], [
      { type: 'grantAdvantage', note: 'Target is paralyzed' }
    ]),
    rule('paralyzed-str-dex-saves', 'Paralyzed creature has disadvantage on Strength and Dexterity saves', 'beforeSavingThrow', [{ type: 'actionTarget' }], [{ type: 'targetHasCondition', conditionId: 'paralyzed' }], [
      { type: 'grantDisadvantage', note: 'Paralyzed' }
    ])
  ]),
  conditionTemplate('petrified', 'Petrified', 'Cannot move, act, or react. Attacks against it have advantage; Strength and Dexterity saves fail; damage is reduced.', ['core', 'control'], [
    rule('petrified-attacks-against', 'Attacks against petrified creature have advantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'petrified' }], [
      { type: 'grantAdvantage', note: 'Target is petrified' }
    ]),
    rule('petrified-resistance', 'Damage against petrified creature is halved', 'beforeDamage', [{ type: 'actionTarget' }], [{ type: 'targetHasCondition', conditionId: 'petrified' }], [
      { type: 'grantDamageResistance', damageType: 'all', note: 'Petrified resistance' }
    ])
  ]),
  conditionTemplate('poisoned', 'Poisoned', 'Disadvantage on attack rolls and ability checks. Custom rules can express the attack-roll part.', ['core', 'poison'], [
    rule('poisoned-attacks', 'Poisoned creature attacks with disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantDisadvantage', note: 'Poisoned' }
    ])
  ]),
  conditionTemplate('prone', 'Prone', 'Attacks by the creature have disadvantage. Nearby attacks against it have advantage; distant attacks have disadvantage. Core behavior also doubles movement cost.', ['core', 'movement'], [
    rule('prone-own-attacks', 'Prone creature attacks with disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantDisadvantage', note: 'Prone' }
    ]),
    rule('prone-movement-cost', 'Movement costs double', 'whileActive', [{ type: 'self' }], [], [
      { type: 'multiplyMovementCost', factor: 2, note: 'Prone' }
    ])
  ]),
  conditionTemplate('restrained', 'Restrained', 'Speed becomes 0. Attacks by it have disadvantage; attacks against it have advantage; Dexterity saves have disadvantage.', ['core', 'control'], [
    rule('restrained-own-attacks', 'Restrained creature attacks with disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantDisadvantage', note: 'Restrained' }
    ]),
    rule('restrained-attacks-against', 'Attacks against restrained creature have advantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'restrained' }], [
      { type: 'grantAdvantage', note: 'Target is restrained' }
    ]),
    rule('restrained-movement', 'Movement is heavily restricted', 'whileActive', [{ type: 'self' }], [], [
      { type: 'multiplyMovementCost', factor: 99, note: 'Restrained' }
    ])
  ]),
  conditionTemplate('stunned', 'Stunned', 'Cannot move, act, or react. Attacks against it have advantage; Strength and Dexterity saves fail.', ['core', 'control'], [
    rule('stunned-attacks-against', 'Attacks against stunned creature have advantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'stunned' }], [
      { type: 'grantAdvantage', note: 'Target is stunned' }
    ])
  ]),
  conditionTemplate('unconscious', 'Unconscious', 'Cannot move, act, or react. Attacks against it have advantage; nearby hits become critical in the combat engine.', ['core', 'control'], [
    rule('unconscious-attacks-against', 'Attacks against unconscious creature have advantage', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'unconscious' }], [
      { type: 'grantAdvantage', note: 'Target is unconscious' }
    ])
  ])
];

export const EXAMPLE_CUSTOM_CONDITION_TEMPLATES: CustomConditionTemplate[] = [
  conditionTemplate('burning-example', 'Burning', 'At the start of the creature turn, it takes fire damage.', ['example', 'fire', 'damage'], [
    rule('burning-start-damage', 'Burning damage', 'onTurnStart', [{ type: 'self' }], [], [
      { type: 'dealDamage', dice: '1d6', damageType: 'fire', note: 'Burning' }
    ])
  ]),
  conditionTemplate('slowed-example', 'Slowed', 'Movement costs twice as much while the condition is active.', ['example', 'movement'], [
    rule('slowed-movement', 'Movement costs double', 'whileActive', [{ type: 'self' }], [], [
      { type: 'multiplyMovementCost', factor: 2, note: 'Slowed' }
    ])
  ]),
  conditionTemplate('marked-example', 'Marked', 'Attackers gain +2 on attack rolls against the marked target.', ['example', 'mark'], [
    rule('marked-attack-bonus', 'Attack bonus against marked target', 'beforeAttackRoll', [{ type: 'source' }], [{ type: 'targetHasCondition', conditionId: 'marked-example' }], [
      { type: 'addFlatModifier', amount: 2, note: 'Marked' }
    ])
  ]),
  conditionTemplate('weakened-example', 'Weakened', 'The creature has disadvantage on attacks and deals less damage.', ['example', 'debuff'], [
    rule('weakened-attacks', 'Weakened attacks with disadvantage', 'beforeAttackRoll', [{ type: 'source' }], [], [
      { type: 'grantDisadvantage', note: 'Weakened' }
    ]),
    rule('weakened-damage-output', 'Damage dealt by weakened creature is reduced', 'beforeDamage', [{ type: 'actionTarget' }], [{ type: 'sourceHasCondition', conditionId: 'weakened-example' }], [
      { type: 'reduceDamage', amount: 2, note: 'Weakened' }
    ])
  ])
];

export function createBlankCustomConditionTemplate(): CustomConditionTemplate {
  return normalizeCustomConditionTemplate({
    id: createConditionId('Custom Condition'),
    name: 'Custom Condition',
    description: '',
    defaultDurationType: 'permanentUntilRemoved',
    stackBehavior: 'refresh',
    tags: [],
    notes: '',
    rules: []
  });
}

export function normalizeCustomConditionTemplate(value: Partial<CustomConditionTemplate>): CustomConditionTemplate {
  const name = value.name?.trim() || 'Custom Condition';
  const defaultDurationType = value.defaultDurationType && durationTypes.includes(value.defaultDurationType)
    ? value.defaultDurationType
    : 'permanentUntilRemoved';
  const stackBehavior = value.stackBehavior && stackBehaviors.includes(value.stackBehavior) ? value.stackBehavior : 'refresh';

  return {
    id: createConditionId(value.id || name),
    name,
    description: value.description ?? '',
    defaultDurationType,
    defaultRemainingRounds: defaultDurationType === 'rounds' ? Math.max(1, Math.round(value.defaultRemainingRounds ?? 1)) : undefined,
    stackBehavior,
    tags: normalizeTags(value.tags ?? []),
    notes: value.notes ?? '',
    rules: (value.rules ?? []).map(normalizeTemplateRule).filter((rule): rule is RuleDefinition => rule !== undefined),
    updatedAt: value.updatedAt ?? new Date().toISOString()
  };
}

export function filterCustomConditionTemplates(templates: CustomConditionTemplate[], query: string): CustomConditionTemplate[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return templates;
  }

  return templates.filter((template) => {
    const haystack = [
      template.name,
      template.id,
      template.description,
      template.notes ?? '',
      template.defaultDurationType ?? '',
      ...template.tags,
      ...template.rules.flatMap((rule) => [rule.name ?? '', rule.trigger, ...rule.effects.map((effect) => effect.type)])
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function upsertCustomConditionTemplate(
  templates: CustomConditionTemplate[],
  template: CustomConditionTemplate
): CustomConditionTemplate[] {
  const normalized = normalizeCustomConditionTemplate({ ...template, updatedAt: new Date().toISOString() });
  return templates.some((candidate) => candidate.id === normalized.id)
    ? templates.map((candidate) => (candidate.id === normalized.id ? normalized : candidate))
    : [normalized, ...templates];
}

export function duplicateCustomConditionTemplate(template: CustomConditionTemplate): CustomConditionTemplate {
  return normalizeCustomConditionTemplate({
    ...template,
    id: createConditionId(`${template.id}-copy`),
    name: `${template.name} Copy`,
    updatedAt: new Date().toISOString()
  });
}

export function deleteCustomConditionTemplate(templates: CustomConditionTemplate[], templateId: string): CustomConditionTemplate[] {
  return templates.filter((template) => template.id !== templateId);
}

export function getCustomConditionTemplateWarnings(template: CustomConditionTemplate): string[] {
  const warnings: string[] = [];
  if (template.rules.length === 0) {
    warnings.push(template.notes?.trim() || template.description.trim() ? 'Rules text only; no mechanical hooks configured.' : 'No mechanical or rules-text effects configured.');
  }
  template.rules.forEach((rule) => {
    if (rule.effects.length === 0) {
      warnings.push(`${rule.name || rule.id} has no valid mechanical effects.`);
    }
    rule.filters?.forEach((filter) => {
      if (filter.type === 'damageType' && !filter.damageType.trim()) {
        warnings.push(`${rule.name || rule.id}: Damage type filter requires a damage type.`);
      }
    });
    rule.effects.forEach((effect) => {
      getRuleEffectWarnings(effect).forEach((warning) => warnings.push(`${rule.name || rule.id}: ${warning}`));
    });
  });
  return warnings;
}

export function hasMechanicalCustomConditionEffects(template: CustomConditionTemplate): boolean {
  return template.rules.some((rule) => rule.effects.length > 0);
}

export function getRuleEffectPlainEnglish(effect: RuleEffectOperation): string {
  switch (effect.type) {
    case 'addFlatModifier':
      return `Add ${formatSigned(effect.amount)} to the selected roll.`;
    case 'grantAdvantage':
      return 'The selected creature rolls with advantage.';
    case 'grantDisadvantage':
      return 'The selected creature rolls with disadvantage.';
    case 'addDamageDice':
      return `Add ${effect.dice || 'extra dice'} to damage dealt by the selected source.`;
    case 'dealDamage':
      return `Deal ${effect.dice || 'damage'} ${effect.damageType ?? 'damage'} to the selected creature.`;
    case 'savingThrowDamage':
      return `Force a DC ${effect.dc} ${effect.ability.toUpperCase()} save, then deal ${effect.dice || 'damage'} ${effect.damageType ?? 'damage'}${effect.halfDamageOnSuccess ? ' with half damage on success' : ' on a failed save only'}.`;
    case 'multiplyDamage':
      return `Multiply damage against the selected target by ${effect.factor}.`;
    case 'reduceDamage':
      return `Reduce damage against the selected target by ${effect.amount}.`;
    case 'setDamageMinimum':
      return `Raise damage dealt by the selected source to at least ${effect.amount}.`;
    case 'grantDamageResistance':
      return `Grant resistance to ${effect.damageType} damage.`;
    case 'grantDamageImmunity':
      return `Grant immunity to ${effect.damageType} damage.`;
    case 'grantDamageVulnerability':
      return `Grant vulnerability to ${effect.damageType} damage.`;
    case 'multiplyMovementCost':
      return `Movement costs ${effect.factor}x as much while this condition is active.`;
    case 'modifyArmorClass':
      return `Change the selected creature's AC by ${formatSigned(effect.amount)} while active.`;
    case 'modifySpeed':
      return `Change the selected creature's walking speed by ${formatSigned(effect.amount)} feet while active.`;
    case 'modifyAttackBonus':
      return `Change the selected creature's attack bonus by ${formatSigned(effect.amount)} while active.`;
    case 'modifySavingThrowBonus':
      return `Change ${effect.ability ? `${effect.ability.toUpperCase()} saves` : 'all saving throws'} by ${formatSigned(effect.amount)} while active.`;
    case 'modifySaveDc':
      return `Change the selected creature's saving throw DCs by ${formatSigned(effect.amount)} while active.`;
    case 'applyCondition':
      return `Apply condition "${effect.conditionId}" to the selected creature.`;
    case 'applyConditionOnFailedSave':
      return `Apply condition "${effect.conditionId}" to the selected creature only when its saving throw fails.`;
    case 'removeCondition':
      return `Remove condition "${effect.conditionId}" from the selected creature.`;
    case 'pushCreature':
      return `Push the selected creature ${effect.distanceFeet} feet away from the source.`;
    case 'pullCreature':
      return `Pull the selected creature ${effect.distanceFeet} feet toward the source.`;
    case 'spendResource':
      return `Spend ${effect.amount} from the selected resource.`;
    case 'restoreResource':
      return `Restore ${effect.amount} to the selected resource.`;
    case 'addTag':
      return `Add the "${effect.tag}" tag to the current action.`;
    case 'removeTag':
      return `Remove the "${effect.tag}" tag from the current action.`;
    case 'logMessage':
      return 'Write a custom message to the combat log.';
  }
}

export function getRuleEffectWarnings(effect: RuleEffectOperation): string[] {
  const warnings: string[] = [];
  if ((effect.type === 'addDamageDice' || effect.type === 'dealDamage' || effect.type === 'savingThrowDamage') && !effect.dice.trim()) {
    warnings.push('Damage dice are required.');
  }
  if ((effect.type === 'dealDamage' || effect.type === 'addDamageDice' || effect.type === 'savingThrowDamage') && effect.dice && !/^\d+d\d+([+-]\d+)?$/i.test(effect.dice.trim())) {
    warnings.push('Damage dice should look like 1d6 or 2d8+3.');
  }
  if (effect.type === 'savingThrowDamage' && effect.dc < 0) {
    warnings.push('Save DC should not be negative.');
  }
  if (effect.type === 'multiplyDamage' && effect.factor < 0) {
    warnings.push('Damage multiplier should not be negative.');
  }
  if (
    (effect.type === 'grantDamageResistance' || effect.type === 'grantDamageImmunity' || effect.type === 'grantDamageVulnerability') &&
    !effect.damageType.trim()
  ) {
    warnings.push('Damage type is required. Use "all" to match every damage type.');
  }
  if (effect.type === 'multiplyMovementCost' && effect.factor <= 0) {
    warnings.push('Movement cost multiplier must be greater than 0.');
  }
  if (effect.type === 'modifySpeed' && effect.amount % 5 !== 0) {
    warnings.push('Speed changes usually work best in 5-foot increments.');
  }
  if ((effect.type === 'applyCondition' || effect.type === 'applyConditionOnFailedSave' || effect.type === 'removeCondition') && !effect.conditionId.trim()) {
    warnings.push('Condition ID is required.');
  }
  if ((effect.type === 'pushCreature' || effect.type === 'pullCreature') && effect.distanceFeet <= 0) {
    warnings.push('Forced movement distance must be greater than 0.');
  }
  if ((effect.type === 'pushCreature' || effect.type === 'pullCreature') && effect.distanceFeet % 5 !== 0) {
    warnings.push('Forced movement distance should be a 5-foot increment.');
  }
  if ((effect.type === 'spendResource' || effect.type === 'restoreResource') && !effect.resourceId.trim()) {
    warnings.push('Resource is required.');
  }
  if ((effect.type === 'addTag' || effect.type === 'removeTag') && !effect.tag.trim()) {
    warnings.push('Tag is required.');
  }
  if (effect.type === 'logMessage' && !effect.message.trim()) {
    warnings.push('Log message is required.');
  }
  return warnings;
}

export function createAppliedConditionFromTemplate(
  template: CustomConditionTemplate,
  sourceCreatureId?: string
): AppliedCondition {
  const normalized = normalizeCustomConditionTemplate(template);
  return {
    id: normalized.id,
    name: normalized.name,
    description: normalized.description,
    tags: normalized.tags,
    sourceCreatureId,
    durationType: normalized.defaultDurationType ?? 'permanentUntilRemoved',
    remainingRounds: normalized.defaultDurationType === 'rounds' ? normalized.defaultRemainingRounds ?? 1 : undefined,
    stackBehavior: normalized.stackBehavior ?? 'refresh',
    stackCount: 1,
    intensity: 1,
    metadata: normalized.notes ? { notes: normalized.notes } : undefined,
    rules: normalized.rules
  };
}

export function parseCustomConditionTemplates(text: string): { ok: true; templates: CustomConditionTemplate[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    const source = isRecord(parsed) && Array.isArray(parsed.customConditions) ? parsed.customConditions : parsed;
    const values = Array.isArray(source) ? source : [source];
    const templates = values.map(coerceCustomConditionTemplate).filter((template): template is CustomConditionTemplate => template !== undefined);
    if (templates.length === 0) {
      return { ok: false, error: 'No valid custom conditions found.' };
    }
    return { ok: true, templates };
  } catch {
    return { ok: false, error: 'Invalid custom condition JSON.' };
  }
}

export function loadCustomConditionLibrary(): CustomConditionTemplate[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const raw = window.localStorage.getItem(CUSTOM_CONDITION_LIBRARY_KEY);
  if (!raw) {
    return [];
  }
  const parsed = parseCustomConditionTemplates(raw);
  return parsed.ok ? parsed.templates : [];
}

export function saveCustomConditionLibrary(templates: CustomConditionTemplate[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CUSTOM_CONDITION_LIBRARY_KEY, JSON.stringify(templates.map(normalizeCustomConditionTemplate), null, 2));
}

export function registerCustomConditionTemplates(templates: CustomConditionTemplate[]): void {
  registeredCustomConditionIds.forEach((id) => unregisterCondition(id));
  registeredCustomConditionIds.clear();

  templates.map(normalizeCustomConditionTemplate).forEach((template) => {
    if (coreConditionIds.has(template.id)) {
      return;
    }

    registerCondition({
      id: template.id,
      name: template.name,
      description: template.description || template.notes || 'Custom condition.',
      defaultDurationType: template.defaultDurationType ?? 'permanentUntilRemoved',
      defaultStackBehavior: template.stackBehavior ?? 'refresh',
      hooks: {},
      rules: template.rules
    });
    registeredCustomConditionIds.add(template.id);
  });
}

function coerceCustomConditionTemplate(value: unknown): CustomConditionTemplate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return normalizeCustomConditionTemplate({
    id: typeof value.id === 'string' ? value.id : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    description: typeof value.description === 'string' ? value.description : '',
    defaultDurationType: typeof value.defaultDurationType === 'string' ? value.defaultDurationType as ConditionDurationType : undefined,
    defaultRemainingRounds: typeof value.defaultRemainingRounds === 'number' ? value.defaultRemainingRounds : undefined,
    stackBehavior: typeof value.stackBehavior === 'string' ? value.stackBehavior as StackBehavior : undefined,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    notes: typeof value.notes === 'string' ? value.notes : '',
    rules: Array.isArray(value.rules) ? value.rules.map(coerceTemplateRule).filter((rule): rule is RuleDefinition => rule !== undefined) : [],
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
  });
}

function normalizeTemplateRule(rule: RuleDefinition): RuleDefinition | undefined {
  if (!rule || !ruleTriggers.includes(rule.trigger)) {
    return undefined;
  }
  return {
    id: createConditionId(rule.id || rule.name || 'condition-rule'),
    name: rule.name?.trim() || undefined,
    enabled: rule.enabled !== false,
    trigger: rule.trigger,
    selectors: normalizeSelectors(rule.selectors ?? [{ type: 'self' }]),
    filters: normalizeFilters(rule.filters ?? []),
    effects: rule.effects.map(normalizeEffect).filter((effect): effect is RuleEffectOperation => effect !== undefined)
  };
}

function coerceTemplateRule(value: unknown): RuleDefinition | undefined {
  if (!isRecord(value) || typeof value.trigger !== 'string' || !Array.isArray(value.effects)) {
    return undefined;
  }
  return normalizeTemplateRule({
    id: typeof value.id === 'string' ? value.id : 'condition-rule',
    name: typeof value.name === 'string' ? value.name : undefined,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    trigger: value.trigger as RuleTriggerPoint,
    selectors: Array.isArray(value.selectors) ? value.selectors as RuleTargetSelector[] : [{ type: 'self' }],
    filters: Array.isArray(value.filters) ? value.filters as RuleFilter[] : [],
    effects: value.effects as RuleEffectOperation[]
  });
}

function normalizeSelectors(selectors: RuleTargetSelector[]): RuleTargetSelector[] {
  const valid = selectors.filter((selector) =>
    selector &&
    ['self', 'actionTarget', 'source', 'creaturesInArea', 'creaturesWithinRange', 'sourceWithinRange', 'alliesWithinRange', 'enemiesWithinRange'].includes(selector.type)
  );
  return valid.length > 0 ? valid : [{ type: 'self' }];
}

function normalizeFilters(filters: RuleFilter[]): RuleFilter[] {
  return filters.filter((filter) => filter && typeof filter.type === 'string');
}

function normalizeEffect(effect: RuleEffectOperation): RuleEffectOperation | undefined {
  if (!effect || typeof effect.type !== 'string') {
    return undefined;
  }
  switch (effect.type) {
    case 'grantAdvantage':
    case 'grantDisadvantage':
      return { type: effect.type, note: effect.note };
    case 'addFlatModifier':
    case 'reduceDamage':
    case 'setDamageMinimum':
    case 'modifyArmorClass':
    case 'modifySpeed':
    case 'modifyAttackBonus':
    case 'modifySavingThrowBonus':
    case 'modifySaveDc':
      return typeof effect.amount === 'number' ? effect : undefined;
    case 'addDamageDice':
    case 'dealDamage':
      return typeof effect.dice === 'string' && effect.dice.trim() ? effect : undefined;
    case 'savingThrowDamage':
      return typeof effect.dice === 'string' &&
        effect.dice.trim() &&
        typeof effect.dc === 'number' &&
        typeof effect.ability === 'string' &&
        typeof effect.halfDamageOnSuccess === 'boolean'
        ? effect
        : undefined;
    case 'multiplyDamage':
      return typeof effect.factor === 'number' ? effect : undefined;
    case 'grantDamageResistance':
    case 'grantDamageImmunity':
    case 'grantDamageVulnerability':
      return typeof effect.damageType === 'string' && effect.damageType.trim()
        ? { ...effect, damageType: effect.damageType.trim().toLowerCase() }
        : undefined;
    case 'multiplyMovementCost':
      return typeof effect.factor === 'number' && effect.factor > 0 ? effect : undefined;
    case 'applyCondition':
    case 'applyConditionOnFailedSave':
      return typeof effect.conditionId === 'string' && effect.conditionId.trim() ? effect : undefined;
    case 'removeCondition':
      return typeof effect.conditionId === 'string' && effect.conditionId.trim() ? effect : undefined;
    case 'pushCreature':
    case 'pullCreature':
      return typeof effect.distanceFeet === 'number' && effect.distanceFeet > 0 ? effect : undefined;
    case 'spendResource':
    case 'restoreResource':
      return typeof effect.resourceId === 'string' && effect.resourceId.trim() && typeof effect.amount === 'number' ? effect : undefined;
    case 'addTag':
    case 'removeTag':
      return typeof effect.tag === 'string' && effect.tag.trim() ? effect : undefined;
    case 'logMessage':
      return typeof effect.message === 'string' && effect.message.trim() ? effect : undefined;
    default:
      return undefined;
  }
}

function conditionTemplate(
  id: string,
  name: string,
  description: string,
  tags: string[],
  rules: RuleDefinition[],
  notes = 'Reference template. Duplicate it before editing.'
): CustomConditionTemplate {
  return normalizeCustomConditionTemplate({
    id,
    name,
    description,
    defaultDurationType: 'permanentUntilRemoved',
    stackBehavior: 'refresh',
    tags,
    notes,
    rules,
    updatedAt: 'reference'
  });
}

function rule(
  id: string,
  name: string,
  trigger: RuleTriggerPoint,
  selectors: RuleTargetSelector[],
  filters: RuleFilter[],
  effects: RuleEffectOperation[]
): RuleDefinition {
  return { id, name, enabled: true, trigger, selectors, filters, effects };
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function createConditionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-condition';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
