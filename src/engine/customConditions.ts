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

export const CUSTOM_CONDITION_LIBRARY_KEY = 'dnd5e-combat.customConditionLibrary.v1';

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
  'onConditionApplied'
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
  });
  return warnings;
}

export function hasMechanicalCustomConditionEffects(template: CustomConditionTemplate): boolean {
  return template.rules.some((rule) => rule.effects.length > 0);
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
    ['self', 'actionTarget', 'source', 'creaturesInArea', 'alliesWithinRange', 'enemiesWithinRange'].includes(selector.type)
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
      return typeof effect.amount === 'number' ? effect : undefined;
    case 'addDamageDice':
      return typeof effect.dice === 'string' && effect.dice.trim() ? effect : undefined;
    case 'multiplyDamage':
      return typeof effect.factor === 'number' ? effect : undefined;
    case 'applyCondition':
      return typeof effect.conditionId === 'string' && effect.conditionId.trim() ? effect : undefined;
    case 'removeCondition':
      return typeof effect.conditionId === 'string' && effect.conditionId.trim() ? effect : undefined;
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
