import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { sampleCreatures } from './data/sampleEncounter';
import { createCombatState } from './engine/combat';
import { crCalculationTable, estimateCreatureCR, getCrXp } from './engine/cr';
import {
  EXAMPLE_CUSTOM_CONDITION_TEMPLATES,
  REFERENCE_CONDITION_TEMPLATES,
  createBlankCustomConditionTemplate,
  deleteCustomConditionTemplate,
  duplicateCustomConditionTemplate,
  filterCustomConditionTemplates,
  getCustomConditionTemplateWarnings,
  getRuleEffectPlainEnglish,
  getRuleEffectWarnings,
  hasMechanicalCustomConditionEffects,
  loadCustomConditionLibrary,
  normalizeCustomConditionTemplate,
  parseCustomConditionTemplates,
  registerCustomConditionTemplates,
  saveCustomConditionLibrary,
  upsertCustomConditionTemplate
} from './engine/customConditions';
import { MAX_GRID_SIZE, normalizeGridDefinition } from './engine/grid';
import { parseCombatStateJson } from './engine/serialization';
import { getTileHeight, getTilePosition, positionKey, sameTilePosition } from './engine/shapes';
import type {
  Ability,
  ActionCost,
  ActionDefinition,
  ActionKind,
  ActionTag,
  CombatState,
  ConditionDurationType,
  Creature,
  CustomConditionTemplate,
  FeatureDefinition,
  GridDefinition,
  GridPosition,
  Resource,
  ResourceConsumeOn,
  ResourceReset,
  RuleDefinition,
  RuleEffectOperation,
  RuleFilter,
  RuleTargetSelector,
  RuleTriggerPoint,
  EffectOperationType,
  TargetSelectorType,
  RuleFilterType,
  ShapeType,
  StatModifiers,
  StackBehavior,
  Team
} from './engine/types';

const CREATURE_LIBRARY_KEY = 'dnd5e-combat.creatureLibrary.v1';
const ENCOUNTER_LIBRARY_KEY = 'dnd5e-combat.encounterLibrary.v1';
const ACTION_LIBRARY_KEY = 'dnd5e-combat.actionLibrary.v1';
const FEATURE_LIBRARY_KEY = 'dnd5e-combat.featureLibrary.v1';
const RESOURCE_LIBRARY_KEY = 'dnd5e-combat.resourceLibrary.v1';

const abilities: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const teams: Team[] = ['players', 'enemies', 'neutral'];
const actionKinds: ActionKind[] = ['meleeAttack', 'rangedAttack', 'savingThrowEffect', 'basicAction', 'spell', 'multiattack', 'custom'];
const actionCosts: ActionCost[] = ['action', 'bonusAction', 'reaction', 'free'];
const actionTags: ActionTag[] = ['attack', 'spell', 'melee', 'ranged', 'area', 'condition', 'movement', 'opportunity', 'bonus', 'reaction', 'placeholder'];
const shapeTypes: ShapeType[] = ['single', 'line', 'radius', 'cone'];
const resetOptions: ResourceReset[] = ['turnStart', 'shortRest', 'longRest', 'dawn', 'manual', 'never'];
const consumeOptions: ResourceConsumeOn[] = ['use', 'hit', 'failedSave', 'manual'];
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
  'whileActive'
];
const selectorTypes: TargetSelectorType[] = ['self', 'actionTarget', 'source', 'creaturesInArea', 'alliesWithinRange', 'enemiesWithinRange'];
const filterTypes: RuleFilterType[] = ['actionHasTag', 'targetHasCondition', 'sourceHasCondition', 'hpBelowHalf', 'resourceAvailable', 'oncePerTurn', 'oncePerRound'];
const effectTypes: EffectOperationType[] = [
  'addFlatModifier',
  'grantAdvantage',
  'grantDisadvantage',
  'addDamageDice',
  'dealDamage',
  'multiplyDamage',
  'reduceDamage',
  'setDamageMinimum',
  'multiplyMovementCost',
  'applyCondition',
  'removeCondition',
  'spendResource',
  'restoreResource',
  'addTag',
  'removeTag',
  'logMessage'
];
const stackBehaviors: StackBehavior[] = ['none', 'refresh', 'stackCount', 'stackIntensity'];
type EditorMode = 'creatures' | 'encounters';
type EncounterBalanceLeader = 'players' | 'enemies' | 'even' | 'unopposed';

interface EncounterBalanceTeamSummary {
  team: Team;
  count: number;
  xp: number;
  crLabels: string[];
}

export interface EncounterBalanceSummary {
  teams: Record<Team, EncounterBalanceTeamSummary>;
  leader: EncounterBalanceLeader;
  ratio: number;
  message: string;
}

const encounterBalanceCrOptions = { targetAc: 15, targetSaveBonus: 3 };

export interface SavedEncounter {
  id: string;
  name: string;
  grid: GridDefinition;
  instances: SavedEncounterCreatureInstance[];
  creatures?: Creature[];
  updatedAt: string;
}

export interface SavedEncounterCreatureInstance {
  id: string;
  templateId: string;
  overrides: Partial<Creature>;
  fallback?: Creature;
}

export function EncounterEditor({
  currentCombat,
  onLoadEncounter
}: {
  currentCombat: CombatState;
  onLoadEncounter: (state: CombatState) => void;
}) {
  const [creatureLibrary, setCreatureLibrary] = useState<Creature[]>(loadCreatureLibrary);
  const [encounters, setEncounters] = useState<SavedEncounter[]>(loadEncounterLibrary);
  const [actionLibrary, setActionLibrary] = useState<ActionDefinition[]>(loadActionLibrary);
  const [featureLibrary, setFeatureLibrary] = useState<FeatureDefinition[]>(loadFeatureLibrary);
  const [resourceLibrary, setResourceLibrary] = useState<Resource[]>(loadResourceLibrary);
  const [customConditionLibrary, setCustomConditionLibrary] = useState<CustomConditionTemplate[]>(loadCustomConditionLibrary);
  const [selectedCreatureId, setSelectedCreatureId] = useState<string>(() => creatureLibrary[0]?.id ?? '');
  const [creatureDraft, setCreatureDraft] = useState<Creature>(() => cloneCreature(creatureLibrary[0] ?? createBlankCreature()));
  const [selectedActionId, setSelectedActionId] = useState<string>(() => creatureDraft.actions[0]?.id ?? '');
  const [selectedResourceId, setSelectedResourceId] = useState<string>(() => creatureDraft.resources?.[0]?.id ?? '');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>(() => creatureDraft.features?.[0]?.id ?? '');
  const [selectedLibraryActionId, setSelectedLibraryActionId] = useState<string>(() => actionLibrary[0]?.id ?? '');
  const [selectedLibraryFeatureId, setSelectedLibraryFeatureId] = useState<string>(() => featureLibrary[0]?.id ?? '');
  const [selectedLibraryResourceId, setSelectedLibraryResourceId] = useState<string>(() => resourceLibrary[0]?.id ?? '');
  const [selectedCustomConditionId, setSelectedCustomConditionId] = useState<string>(() => customConditionLibrary[0]?.id ?? '');
  const [partLibraryMessage, setPartLibraryMessage] = useState<string | undefined>();
  const [creatureJson, setCreatureJson] = useState('');
  const [creatureJsonMessage, setCreatureJsonMessage] = useState<string | undefined>();
  const [customConditionJson, setCustomConditionJson] = useState('');
  const [customConditionMessage, setCustomConditionMessage] = useState<string | undefined>();
  const [customConditionSearch, setCustomConditionSearch] = useState('');
  const [encounterJson, setEncounterJson] = useState('');
  const [encounterJsonMessage, setEncounterJsonMessage] = useState<string | undefined>();
  const [editorMode, setEditorMode] = useState<EditorMode>('creatures');
  const [creatureSearch, setCreatureSearch] = useState('');
  const [crTargetAc, setCrTargetAc] = useState(15);
  const [crTargetSaveBonus, setCrTargetSaveBonus] = useState(3);
  const [manualDprOverride, setManualDprOverride] = useState('');
  const [manualFinalCrOverride, setManualFinalCrOverride] = useState('');

  const [builderName, setBuilderName] = useState('New Encounter');
  const [builderGrid, setBuilderGrid] = useState<GridDefinition>({ width: 10, height: 10, blocked: [] });
  const [builderInstances, setBuilderInstances] = useState<SavedEncounterCreatureInstance[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => creatureLibrary[0]?.id ?? '');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | undefined>();
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | undefined>();
  const [builderTool, setBuilderTool] = useState<'place' | 'move' | 'block' | 'height'>('place');
  const [builderTileHeight, setBuilderTileHeight] = useState(1);

  const selectedAction = creatureDraft.actions.find((action) => action.id === selectedActionId) ?? creatureDraft.actions[0];
  const selectedResource = (creatureDraft.resources ?? []).find((resource) => resource.id === selectedResourceId) ?? creatureDraft.resources?.[0];
  const selectedFeature = (creatureDraft.features ?? []).find((feature) => feature.id === selectedFeatureId) ?? creatureDraft.features?.[0];
  const selectedLibraryAction = actionLibrary.find((action) => action.id === selectedLibraryActionId) ?? actionLibrary[0];
  const selectedLibraryFeature = featureLibrary.find((feature) => feature.id === selectedLibraryFeatureId) ?? featureLibrary[0];
  const selectedLibraryResource = resourceLibrary.find((resource) => resource.id === selectedLibraryResourceId) ?? resourceLibrary[0];
  const referenceConditionLibrary = useMemo(
    () => [...REFERENCE_CONDITION_TEMPLATES, ...EXAMPLE_CUSTOM_CONDITION_TEMPLATES],
    []
  );
  const selectedReferenceCondition = referenceConditionLibrary.find((template) => getReferenceConditionSelectionId(template) === selectedCustomConditionId);
  const selectedCustomCondition = customConditionLibrary.find((template) => template.id === selectedCustomConditionId);
  const selectedConditionTemplate = selectedCustomCondition ?? selectedReferenceCondition ?? customConditionLibrary[0] ?? referenceConditionLibrary[0];
  const selectedConditionIsReference = Boolean(
    selectedReferenceCondition || (!selectedCustomCondition && selectedConditionTemplate && referenceConditionLibrary.some((template) => template.id === selectedConditionTemplate.id))
  );
  const filteredCustomConditions = useMemo(
    () => filterCustomConditionTemplates(customConditionLibrary, customConditionSearch),
    [customConditionLibrary, customConditionSearch]
  );
  const filteredReferenceConditions = useMemo(
    () => filterCustomConditionTemplates(referenceConditionLibrary, customConditionSearch),
    [referenceConditionLibrary, customConditionSearch]
  );
  const selectedCustomConditionWarnings = selectedConditionTemplate ? getCustomConditionTemplateWarnings(selectedConditionTemplate) : [];
  const hydratedBuilder = useMemo(
    () => hydrateEncounterCreatures(builderInstances, creatureLibrary),
    [builderInstances, creatureLibrary]
  );
  const builderCreatures = hydratedBuilder.creatures;
  const encounterTemplateWarnings = hydratedBuilder.warnings;
  const encounterBalance = useMemo(() => estimateEncounterBalance(builderCreatures), [builderCreatures]);
  const selectedInstance = builderCreatures.find((creature) => creature.id === selectedInstanceId);
  const selectedTemplate = creatureLibrary.find((creature) => creature.id === selectedTemplateId) ?? creatureLibrary[0];
  const filteredCreatureLibrary = useMemo(
    () => filterCreaturesForEditor(creatureLibrary, creatureSearch),
    [creatureLibrary, creatureSearch]
  );
  const crEstimate = useMemo(
    () =>
      estimateCreatureCR(creatureDraft, {
        targetAc: crTargetAc,
        targetSaveBonus: crTargetSaveBonus,
        manualDpr: parseOptionalNumber(manualDprOverride),
        manualFinalCr: manualFinalCrOverride.trim() || undefined
      }),
    [creatureDraft, crTargetAc, crTargetSaveBonus, manualDprOverride, manualFinalCrOverride]
  );

  useEffect(() => {
    saveJson(CREATURE_LIBRARY_KEY, creatureLibrary);
  }, [creatureLibrary]);

  useEffect(() => {
    saveJson(ENCOUNTER_LIBRARY_KEY, encounters);
  }, [encounters]);

  useEffect(() => {
    saveJson(ACTION_LIBRARY_KEY, actionLibrary);
  }, [actionLibrary]);

  useEffect(() => {
    saveJson(FEATURE_LIBRARY_KEY, featureLibrary);
  }, [featureLibrary]);

  useEffect(() => {
    saveJson(RESOURCE_LIBRARY_KEY, resourceLibrary);
  }, [resourceLibrary]);

  useEffect(() => {
    registerCustomConditionTemplates(customConditionLibrary);
    saveCustomConditionLibrary(customConditionLibrary);
  }, [customConditionLibrary]);

  useEffect(() => {
    const selected = creatureLibrary.find((creature) => creature.id === selectedCreatureId);
    if (!selected) {
      return;
    }

    const nextDraft = cloneCreature(selected);
    setCreatureDraft(nextDraft);
    setSelectedActionId(nextDraft.actions[0]?.id ?? '');
    setSelectedResourceId(nextDraft.resources?.[0]?.id ?? '');
    setSelectedFeatureId(nextDraft.features?.[0]?.id ?? '');
  }, [creatureLibrary, selectedCreatureId]);

  useEffect(() => {
    if (!creatureLibrary.some((creature) => creature.id === selectedTemplateId)) {
      setSelectedTemplateId(creatureLibrary[0]?.id ?? '');
    }
  }, [creatureLibrary, selectedTemplateId]);

  useEffect(() => {
    if (!actionLibrary.some((action) => action.id === selectedLibraryActionId)) {
      setSelectedLibraryActionId(actionLibrary[0]?.id ?? '');
    }
  }, [actionLibrary, selectedLibraryActionId]);

  useEffect(() => {
    if (!featureLibrary.some((feature) => feature.id === selectedLibraryFeatureId)) {
      setSelectedLibraryFeatureId(featureLibrary[0]?.id ?? '');
    }
  }, [featureLibrary, selectedLibraryFeatureId]);

  useEffect(() => {
    if (!resourceLibrary.some((resource) => resource.id === selectedLibraryResourceId)) {
      setSelectedLibraryResourceId(resourceLibrary[0]?.id ?? '');
    }
  }, [resourceLibrary, selectedLibraryResourceId]);

  useEffect(() => {
    const customSelectionExists = customConditionLibrary.some((template) => template.id === selectedCustomConditionId);
    const referenceSelectionExists = referenceConditionLibrary.some(
      (template) => getReferenceConditionSelectionId(template) === selectedCustomConditionId
    );

    if (!customSelectionExists && !referenceSelectionExists) {
      setSelectedCustomConditionId(customConditionLibrary[0]?.id ?? getReferenceConditionSelectionId(referenceConditionLibrary[0]));
    }
  }, [customConditionLibrary, referenceConditionLibrary, selectedCustomConditionId]);

  const occupiedKeys = useMemo(() => new Set(builderCreatures.map((creature) => positionKey(creature.position))), [builderCreatures]);
  const blockedKeys = useMemo(() => new Set(builderGrid.blocked.map(positionKey)), [builderGrid.blocked]);

  function createFromBlank() {
    const blank = createBlankCreature();
    setCreatureLibrary((current) => [blank, ...current]);
    setSelectedCreatureId(blank.id);
    setCreatureJsonMessage('Blank creature added to the library.');
  }

  function duplicateSelectedCreature() {
    const source = creatureLibrary.find((creature) => creature.id === selectedCreatureId) ?? sampleCreatures[0];
    const duplicate = {
      ...cloneCreature(source),
      id: createId(source.name, 'creature'),
      name: `${source.name} Copy`,
      conditions: [],
      readiedAction: undefined
    };
    setCreatureLibrary((current) => [duplicate, ...current]);
    setSelectedCreatureId(duplicate.id);
    setCreatureJsonMessage(`${source.name} duplicated.`);
  }

  function saveCreatureDraft() {
    const normalized = normalizeCreatureDraft(creatureDraft);
    setCreatureDraft(normalized);
    setCreatureLibrary((current) => upsertById(current, normalized));
    setSelectedCreatureId(normalized.id);
    setCreatureJsonMessage(`${normalized.name} saved to localStorage.`);
  }

  function deleteCreature() {
    if (creatureLibrary.length <= 1) {
      setCreatureJsonMessage('Keep at least one creature in the library.');
      return;
    }

    const next = creatureLibrary.filter((creature) => creature.id !== selectedCreatureId);
    setCreatureLibrary(next);
    setSelectedCreatureId(next[0]?.id ?? '');
    setCreatureJsonMessage('Creature deleted from the library.');
  }

  function exportSelectedCreature() {
    setCreatureJson(JSON.stringify(creatureDraft, null, 2));
    setCreatureJsonMessage('Selected creature exported below.');
  }

  function exportCreatureLibrary() {
    setCreatureJson(JSON.stringify(creatureLibrary, null, 2));
    setCreatureJsonMessage('Creature library exported below.');
  }

  function importCreatureJson() {
    const imported = parseCreatureImport(creatureJson);
    if (!imported.ok) {
      setCreatureJsonMessage(imported.error);
      return;
    }

    const creatures = imported.creatures.map(normalizeCreatureDraft);
    setCreatureLibrary((current) => mergeCreatures(current, creatures));
    setSelectedCreatureId(creatures[0]?.id ?? selectedCreatureId);
    setCreatureJsonMessage(`${creatures.length} creature${creatures.length === 1 ? '' : 's'} imported.`);
  }

  function updateDraftCreature(update: Partial<Creature>) {
    setCreatureDraft((current) => ({ ...current, ...update }));
  }

  function updateAbility(ability: Ability, score: number) {
    setCreatureDraft((current) => ({
      ...current,
      abilityScores: {
        ...current.abilityScores,
        [ability]: score
      }
    }));
  }

  function updateSkill(skill: 'athletics' | 'acrobatics' | 'stealth' | 'perception' | 'investigation', value: string) {
    setCreatureDraft((current) => {
      const next = { ...(current.skillBonuses ?? {}) };
      if (value.trim() === '') {
        delete next[skill];
      } else {
        next[skill] = Number(value);
      }
      return { ...current, skillBonuses: next };
    });
  }

  function addAction() {
    const action = createBlankAction();
    setCreatureDraft((current) => ({ ...current, actions: [...current.actions, action] }));
    setSelectedActionId(action.id);
  }

  function duplicateAction() {
    if (!selectedAction) {
      return;
    }

    const action = { ...cloneAction(selectedAction), id: createId(selectedAction.name, 'action'), name: `${selectedAction.name} Copy` };
    setCreatureDraft((current) => ({ ...current, actions: [...current.actions, action] }));
    setSelectedActionId(action.id);
  }

  function deleteAction() {
    if (!selectedAction || creatureDraft.actions.length <= 1) {
      return;
    }

    const nextActions = creatureDraft.actions.filter((action) => action.id !== selectedAction.id);
    setCreatureDraft((current) => ({ ...current, actions: nextActions }));
    setSelectedActionId(nextActions[0]?.id ?? '');
  }

  function updateAction(update: Partial<ActionDefinition>) {
    if (!selectedAction) {
      return;
    }

    if (update.id) {
      setSelectedActionId(update.id);
    }

    setCreatureDraft((current) => ({
      ...current,
      actions: current.actions.map((action) => (action.id === selectedAction.id ? normalizeAction({ ...action, ...update }) : action))
    }));
  }

  function saveSelectedActionToLibrary() {
    if (!selectedAction) {
      return;
    }

    const action = normalizeAction(cloneAction(selectedAction));
    setActionLibrary((current) => upsertById(current, action));
    setSelectedLibraryActionId(action.id);
    setPartLibraryMessage(`${action.name} saved to the action library.`);
  }

  function applyLibraryAction() {
    if (!selectedLibraryAction) {
      return;
    }

    const action = normalizeAction(cloneAction(selectedLibraryAction));
    setCreatureDraft((current) => ({ ...current, actions: upsertById(current.actions, action) }));
    setSelectedActionId(action.id);
    setPartLibraryMessage(`${action.name} applied to ${creatureDraft.name}.`);
  }

  function deleteLibraryAction() {
    if (!selectedLibraryAction) {
      return;
    }

    setActionLibrary((current) => current.filter((action) => action.id !== selectedLibraryAction.id));
    setPartLibraryMessage(`${selectedLibraryAction.name} removed from the action library.`);
  }

  function addResource() {
    const resource: Resource = {
      id: createId('resource', 'resource'),
      name: 'New Resource',
      current: 1,
      max: 1,
      resetOn: 'longRest',
      display: { showOnCreaturePanel: true, mode: 'pips' }
    };
    setCreatureDraft((current) => ({ ...current, resources: [...(current.resources ?? []), resource] }));
    setSelectedResourceId(resource.id);
  }

  function deleteResource() {
    if (!selectedResource) {
      return;
    }

    const nextResources = (creatureDraft.resources ?? []).filter((resource) => resource.id !== selectedResource.id);
    setCreatureDraft((current) => ({ ...current, resources: nextResources }));
    setSelectedResourceId(nextResources[0]?.id ?? '');
  }

  function updateResource(update: Partial<Resource>) {
    if (!selectedResource) {
      return;
    }

    if (update.id) {
      setSelectedResourceId(update.id);
    }

    setCreatureDraft((current) => ({
      ...current,
      resources: (current.resources ?? []).map((resource) => (resource.id === selectedResource.id ? { ...resource, ...update } : resource))
    }));
  }

  function saveSelectedResourceToLibrary() {
    if (!selectedResource) {
      return;
    }

    const resource = normalizeResource(cloneJson(selectedResource));
    setResourceLibrary((current) => upsertById(current, resource));
    setSelectedLibraryResourceId(resource.id);
    setPartLibraryMessage(`${resource.name} saved to the resource library.`);
  }

  function applyLibraryResource() {
    if (!selectedLibraryResource) {
      return;
    }

    const resource = normalizeResource(cloneJson(selectedLibraryResource));
    setCreatureDraft((current) => ({ ...current, resources: upsertById(current.resources ?? [], resource) }));
    setSelectedResourceId(resource.id);
    setPartLibraryMessage(`${resource.name} applied to ${creatureDraft.name}.`);
  }

  function deleteLibraryResource() {
    if (!selectedLibraryResource) {
      return;
    }

    setResourceLibrary((current) => current.filter((resource) => resource.id !== selectedLibraryResource.id));
    setPartLibraryMessage(`${selectedLibraryResource.name} removed from the resource library.`);
  }

  function addCustomConditionTemplate() {
    const template = createBlankCustomConditionTemplate();
    setCustomConditionLibrary((current) => [template, ...current]);
    setSelectedCustomConditionId(template.id);
    setCustomConditionMessage('Custom condition created.');
  }

  function duplicateSelectedCustomCondition() {
    if (!selectedConditionTemplate) {
      return;
    }
    const duplicate = duplicateCustomConditionTemplate(selectedConditionTemplate);
    setCustomConditionLibrary((current) => [duplicate, ...current]);
    setSelectedCustomConditionId(duplicate.id);
    setCustomConditionMessage(`${selectedConditionTemplate.name} duplicated as an editable custom copy.`);
  }

  function deleteSelectedCustomCondition() {
    if (!selectedCustomCondition || selectedConditionIsReference) {
      return;
    }
    setCustomConditionLibrary((current) => deleteCustomConditionTemplate(current, selectedCustomCondition.id));
    setCustomConditionMessage(`${selectedCustomCondition.name} deleted.`);
  }

  function updateSelectedCustomCondition(update: Partial<CustomConditionTemplate>) {
    if (!selectedCustomCondition || selectedConditionIsReference) {
      return;
    }

    const previousId = selectedCustomCondition.id;
    const next = normalizeCustomConditionTemplate({ ...selectedCustomCondition, ...update });
    setCustomConditionLibrary((current) =>
      current.map((template) => (template.id === previousId ? next : template))
    );
    if (next.id !== previousId || selectedCustomConditionId !== next.id) {
      setSelectedCustomConditionId(next.id);
    }
  }

  function saveSelectedCustomCondition() {
    if (!selectedCustomCondition || selectedConditionIsReference) {
      return;
    }
    const normalized = normalizeCustomConditionTemplate(selectedCustomCondition);
    setCustomConditionLibrary((current) => upsertCustomConditionTemplate(current, normalized));
    setSelectedCustomConditionId(normalized.id);
    setCustomConditionMessage(`${normalized.name} saved to the custom condition library.`);
  }

  function exportSelectedCustomCondition() {
    if (!selectedConditionTemplate) {
      return;
    }
    setCustomConditionJson(JSON.stringify(selectedConditionTemplate, null, 2));
    setCustomConditionMessage('Selected custom condition exported below.');
  }

  function exportCustomConditionLibrary() {
    setCustomConditionJson(JSON.stringify({ customConditions: customConditionLibrary }, null, 2));
    setCustomConditionMessage('Custom condition library exported below.');
  }

  function importCustomConditionJson() {
    const parsed = parseCustomConditionTemplates(customConditionJson);
    if (!parsed.ok) {
      setCustomConditionMessage(parsed.error);
      return;
    }
    setCustomConditionLibrary((current) =>
      parsed.templates.reduce((next, template) => upsertCustomConditionTemplate(next, template), current)
    );
    setSelectedCustomConditionId(parsed.templates[0]?.id ?? selectedCustomConditionId);
    setCustomConditionMessage(`${parsed.templates.length} custom condition${parsed.templates.length === 1 ? '' : 's'} imported.`);
  }

  function addFeature() {
    const feature = createBlankFeature();
    setCreatureDraft((current) => ({ ...current, features: [...(current.features ?? []), feature] }));
    setSelectedFeatureId(feature.id);
  }

  function duplicateFeature() {
    if (!selectedFeature) {
      return;
    }

    const feature = {
      ...cloneJson(selectedFeature),
      id: createId(selectedFeature.name, 'feature'),
      name: `${selectedFeature.name} Copy`
    };
    setCreatureDraft((current) => ({ ...current, features: [...(current.features ?? []), normalizeFeature(feature)] }));
    setSelectedFeatureId(feature.id);
  }

  function deleteFeature() {
    if (!selectedFeature) {
      return;
    }

    const nextFeatures = (creatureDraft.features ?? []).filter((feature) => feature.id !== selectedFeature.id);
    setCreatureDraft((current) => ({ ...current, features: nextFeatures }));
    setSelectedFeatureId(nextFeatures[0]?.id ?? '');
  }

  function updateFeature(update: Partial<FeatureDefinition>) {
    if (!selectedFeature) {
      return;
    }

    if (update.id) {
      setSelectedFeatureId(update.id);
    }

    setCreatureDraft((current) => ({
      ...current,
      features: (current.features ?? []).map((feature) => (feature.id === selectedFeature.id ? normalizeFeature({ ...feature, ...update }) : feature))
    }));
  }

  function saveSelectedFeatureToLibrary() {
    if (!selectedFeature) {
      return;
    }

    const feature = normalizeFeature(cloneJson(selectedFeature));
    setFeatureLibrary((current) => upsertById(current, feature));
    setSelectedLibraryFeatureId(feature.id);
    setPartLibraryMessage(`${feature.name} saved to the feature library.`);
  }

  function applyLibraryFeature() {
    if (!selectedLibraryFeature) {
      return;
    }

    const feature = normalizeFeature(cloneJson(selectedLibraryFeature));
    setCreatureDraft((current) => ({ ...current, features: upsertById(current.features ?? [], feature) }));
    setSelectedFeatureId(feature.id);
    setPartLibraryMessage(`${feature.name} applied to ${creatureDraft.name}.`);
  }

  function deleteLibraryFeature() {
    if (!selectedLibraryFeature) {
      return;
    }

    setFeatureLibrary((current) => current.filter((feature) => feature.id !== selectedLibraryFeature.id));
    setPartLibraryMessage(`${selectedLibraryFeature.name} removed from the feature library.`);
  }

  function clearBuilder() {
    setBuilderName('New Encounter');
    setBuilderGrid({ width: 10, height: 10, blocked: [] });
    setBuilderInstances([]);
    setSelectedInstanceId(undefined);
    setSelectedEncounterId(undefined);
    setEncounterJsonMessage('Builder cleared.');
  }

  function seedBuilderFromCombat() {
    setBuilderName(`Combat Snapshot ${new Date().toLocaleDateString()}`);
    setBuilderGrid(cloneJson(currentCombat.grid));
    setBuilderInstances(currentCombat.creatures.map((creature) => createEncounterInstanceFromCreature(creature, creatureLibrary)));
    setSelectedInstanceId(currentCombat.creatures[0]?.id);
    setSelectedEncounterId(undefined);
    setEncounterJsonMessage('Active combat copied into the builder.');
  }

  function loadSavedEncounter(encounter: SavedEncounter) {
    setBuilderName(encounter.name);
    setBuilderGrid(cloneJson(encounter.grid));
    setBuilderInstances(encounter.instances.map(normalizeEncounterInstance));
    setSelectedInstanceId(encounter.instances[0]?.id);
    setSelectedEncounterId(encounter.id);
    const warnings = hydrateEncounterCreatures(encounter.instances, creatureLibrary).warnings;
    setEncounterJsonMessage(`${encounter.name} loaded into the builder.${warnings.length > 0 ? ` ${warnings.length} template warning(s).` : ''}`);
  }

  function saveBuilderEncounter() {
    const encounter: SavedEncounter = {
      id: selectedEncounterId ?? createId(builderName, 'encounter'),
      name: builderName.trim() || 'Untitled Encounter',
      grid: normalizeGrid(builderGrid),
      instances: builderInstances.map(normalizeEncounterInstance),
      updatedAt: new Date().toISOString()
    };

    setBuilderGrid(encounter.grid);
    setBuilderInstances(encounter.instances);
    setSelectedEncounterId(encounter.id);
    setEncounters((current) => upsertById(current, encounter));
    setEncounterJsonMessage(`${encounter.name} saved to localStorage.`);
  }

  function deleteSavedEncounter() {
    if (!selectedEncounterId) {
      return;
    }

    setEncounters((current) => current.filter((encounter) => encounter.id !== selectedEncounterId));
    setSelectedEncounterId(undefined);
    setEncounterJsonMessage('Saved encounter deleted.');
  }

  function loadBuilderIntoCombat() {
    const grid = normalizeGrid(builderGrid);
    const hydrated = hydrateEncounterCreatures(builderInstances, creatureLibrary);
    const state = createCombatState(hydrated.creatures.map(normalizeCreatureDraft), grid.width, grid.height, grid.blocked, grid.heights ?? []);
    onLoadEncounter(state);
  }

  function exportBuilderEncounter() {
    const encounter: SavedEncounter = {
      id: selectedEncounterId ?? createId(builderName, 'encounter'),
      name: builderName.trim() || 'Untitled Encounter',
      grid: normalizeGrid(builderGrid),
      instances: builderInstances.map(normalizeEncounterInstance),
      updatedAt: new Date().toISOString()
    };
    setEncounterJson(JSON.stringify(encounter, null, 2));
    setEncounterJsonMessage('Builder encounter exported below.');
  }

  function importEncounterJson() {
    const imported = parseEncounterImport(encounterJson, creatureLibrary);
    if (!imported.ok) {
      setEncounterJsonMessage(imported.error);
      return;
    }

    const encounter = imported.encounter;
    setEncounters((current) => upsertById(current, encounter));
    loadSavedEncounter(encounter);
    setEncounterJsonMessage(`${encounter.name} imported.`);
  }

  function handleBuilderCellClick(position: GridPosition) {
    const tilePosition = getTilePosition(position, builderGrid);
    const existing = builderCreatures.find((creature) => sameTilePosition(creature.position, tilePosition));

    if (builderTool === 'height') {
      setBuilderGrid((current) => setTileHeight(current, position, builderTileHeight));
      const creatureIdsAtTile = builderCreatures
        .filter((creature) => sameTilePosition(creature.position, position))
        .map((creature) => creature.id);
      setBuilderInstances((current) =>
        current.map((instance) =>
          creatureIdsAtTile.includes(instance.id)
            ? mergeEncounterInstanceOverrides(instance, {
                position: { ...(instance.overrides.position ?? position), z: builderTileHeight }
              })
            : instance
        )
      );
      return;
    }

    if (builderTool === 'block') {
      if (existing) {
        setSelectedInstanceId(existing.id);
        return;
      }

      setBuilderGrid((current) => ({
        ...current,
        blocked: current.blocked.some((cell) => sameTilePosition(cell, position))
          ? current.blocked.filter((cell) => !sameTilePosition(cell, position))
          : [...current.blocked, position]
      }));
      return;
    }

    if (existing) {
      setSelectedInstanceId(existing.id);
      return;
    }

    if (blockedKeys.has(positionKey(position))) {
      return;
    }

    if (builderTool === 'move' && selectedInstanceId) {
      setBuilderInstances((current) =>
        current.map((instance) =>
          instance.id === selectedInstanceId ? mergeEncounterInstanceOverrides(instance, { position: tilePosition }) : instance
        )
      );
      return;
    }

    if (builderTool === 'place' && selectedTemplate) {
      const instance = createEncounterInstanceFromTemplate(selectedTemplate, tilePosition);
      setBuilderInstances((current) => [...current, instance]);
      setSelectedInstanceId(instance.id);
    }
  }

  function updateSelectedInstance(update: Partial<Creature>) {
    if (!selectedInstanceId) {
      return;
    }

    setBuilderInstances((current) =>
      current.map((instance) => (instance.id === selectedInstanceId ? mergeEncounterInstanceOverrides(instance, update) : instance))
    );
  }

  function removeSelectedInstance() {
    if (!selectedInstanceId) {
      return;
    }

    const next = builderInstances.filter((instance) => instance.id !== selectedInstanceId);
    setBuilderInstances(next);
    setSelectedInstanceId(next[0]?.id);
  }

  return (
    <section className="editor-shell">
      <nav className="editor-mode-tabs" aria-label="Editor modes">
        <button className={editorMode === 'creatures' ? 'selected-action' : ''} onClick={() => setEditorMode('creatures')}>
          Creature Library / Editor
        </button>
        <button className={editorMode === 'encounters' ? 'selected-action' : ''} onClick={() => setEditorMode('encounters')}>
          Encounter Builder / Editor
        </button>
      </nav>

      {editorMode === 'creatures' ? (
      <section className="panel editor-library-panel">
        <header className="editor-panel-header">
          <h2>Creature Library</h2>
          <div className="editor-button-row">
            <button onClick={createFromBlank}>New Blank</button>
            <button onClick={duplicateSelectedCreature}>Duplicate</button>
            <button onClick={saveCreatureDraft}>Save Creature</button>
            <button onClick={deleteCreature}>Delete</button>
          </div>
        </header>

        <label className="editor-search">
          Search creatures
          <input
            value={creatureSearch}
            placeholder="Name, team, action, tag, or stat"
            onChange={(event) => setCreatureSearch(event.target.value)}
          />
        </label>

        <div className="editor-list-form">
          <div className="library-list">
            {filteredCreatureLibrary.map((creature) => (
              <button
                className={['creature-summary-card', creature.id === selectedCreatureId ? 'selected-action' : ''].join(' ')}
                key={creature.id}
                onClick={() => setSelectedCreatureId(creature.id)}
              >
                <strong>{creature.name}</strong>
                <span>{creature.team}</span>
                <small>HP {creature.hp}/{creature.maxHp}</small>
                <small>AC {creature.ac}</small>
                <small>Speed {creature.speed}</small>
                <small>{creature.actions.length} action(s)</small>
              </button>
            ))}
            {filteredCreatureLibrary.length === 0 && <span className="empty-list">No creatures match that search.</span>}
          </div>

          <div className="creature-editor">
            {partLibraryMessage && <p className="editor-message">{partLibraryMessage}</p>}

            <details className="editor-section editor-subsection" open>
              <summary>Basic Stats</summary>
              <div className="form-grid">
                <label>
                  Name
                  <input value={creatureDraft.name} onChange={(event) => updateDraftCreature({ name: event.target.value })} />
                </label>
                <label>
                  Team
                  <select value={creatureDraft.team} onChange={(event) => updateDraftCreature({ team: event.target.value as Team })}>
                    {teams.map((team) => (
                      <option key={team} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberInput label="HP" value={creatureDraft.hp} onChange={(value) => updateDraftCreature({ hp: value })} />
                <NumberInput label="Max HP" value={creatureDraft.maxHp} onChange={(value) => updateDraftCreature({ maxHp: value })} />
                <NumberInput label="AC" value={creatureDraft.ac} onChange={(value) => updateDraftCreature({ ac: value })} />
                <NumberInput label="Proficiency" value={creatureDraft.proficiencyBonus} onChange={(value) => updateDraftCreature({ proficiencyBonus: value })} />
              </div>
            </details>

            <details className="editor-section editor-subsection">
              <summary>Ability Scores</summary>
              <div className="ability-score-grid">
                {abilities.map((ability) => (
                  <NumberInput
                    key={ability}
                    label={ability.toUpperCase()}
                    value={creatureDraft.abilityScores[ability]}
                    onChange={(value) => updateAbility(ability, value)}
                  />
                ))}
              </div>
              <div className="ability-score-grid">
                {(['athletics', 'acrobatics', 'stealth', 'perception', 'investigation'] as const).map((skill) => (
                  <label key={skill}>
                    {skill}
                    <input
                      type="number"
                      value={creatureDraft.skillBonuses?.[skill] ?? ''}
                      onChange={(event) => updateSkill(skill, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </details>

            <details className="editor-section editor-subsection">
              <summary>Movement / Position Defaults</summary>
              <div className="form-grid">
                <NumberInput label="Speed" value={creatureDraft.speed} onChange={(value) => updateDraftCreature({ speed: value })} />
                <NumberInput label="Climb" value={creatureDraft.climbSpeed ?? 0} onChange={(value) => updateDraftCreature({ climbSpeed: value })} />
                <NumberInput label="Fly" value={creatureDraft.flySpeed ?? 0} onChange={(value) => updateDraftCreature({ flySpeed: value })} />
                <NumberInput label="Start X" value={creatureDraft.position.x} onChange={(value) => updateDraftCreature({ position: { ...creatureDraft.position, x: value } })} />
                <NumberInput label="Start Y" value={creatureDraft.position.y} onChange={(value) => updateDraftCreature({ position: { ...creatureDraft.position, y: value } })} />
                <NumberInput label="Start Z" value={creatureDraft.position.z ?? 0} onChange={(value) => updateDraftCreature({ position: { ...creatureDraft.position, z: value } })} />
              </div>
            </details>

            <details className="editor-section editor-subsection" open>
              <summary>Actions</summary>
              <div className="editor-button-row">
                <button onClick={addAction}>Add Action</button>
                <button onClick={duplicateAction}>Duplicate Action</button>
                <button onClick={deleteAction} disabled={creatureDraft.actions.length <= 1}>
                  Delete Action
                </button>
              </div>
              <PartLibraryControls
                title="Action Library"
                items={actionLibrary}
                selectedId={selectedLibraryAction?.id ?? ''}
                onSelect={setSelectedLibraryActionId}
                onSave={saveSelectedActionToLibrary}
                onApply={applyLibraryAction}
                onDelete={deleteLibraryAction}
                saveDisabled={!selectedAction}
                applyDisabled={!selectedLibraryAction}
                deleteDisabled={!selectedLibraryAction}
                getSummary={(action) => `${formatEditorActionCost(action.actionCost)} - ${action.kind} - ${action.rules?.length ?? 0} hook(s)`}
              />
              <div className="action-card-list">
                {creatureDraft.actions.map((action) => (
                  <details
                    className={['action-edit-card', action.id === selectedAction?.id ? 'selected-action' : ''].join(' ')}
                    key={action.id}
                    open={action.id === selectedAction?.id}
                    onToggle={(event) => {
                      if (event.currentTarget.open) {
                        setSelectedActionId(action.id);
                      }
                    }}
                  >
                    <summary>
                      <strong>{action.name}</strong>
                      <span>
                        {formatEditorActionCost(action.actionCost)} - {action.kind}
                      </span>
                      <small>
                        {action.tags.join(', ') || 'no tags'}
                        {(action.rules?.length ?? 0) > 0 ? ` - ${action.rules?.length} hook(s)` : ''}
                      </small>
                    </summary>
                    {action.id === selectedAction?.id && (
                      <ActionEditor
                        action={selectedAction}
                        customConditions={customConditionLibrary}
                        resources={creatureDraft.resources ?? []}
                        onChange={updateAction}
                      />
                    )}
                  </details>
                ))}
              </div>
            </details>

            <details className="editor-section editor-subsection">
              <summary>Features / Triggers / Effects</summary>
              <div className="editor-button-row">
                <button onClick={addFeature}>Add Feature</button>
                <button onClick={duplicateFeature} disabled={!selectedFeature}>
                  Duplicate Feature
                </button>
                <button onClick={deleteFeature} disabled={!selectedFeature}>
                  Delete Feature
                </button>
              </div>
              <PartLibraryControls
                title="Feature Library"
                items={featureLibrary}
                selectedId={selectedLibraryFeature?.id ?? ''}
                onSelect={setSelectedLibraryFeatureId}
                onSave={saveSelectedFeatureToLibrary}
                onApply={applyLibraryFeature}
                onDelete={deleteLibraryFeature}
                saveDisabled={!selectedFeature}
                applyDisabled={!selectedLibraryFeature}
                deleteDisabled={!selectedLibraryFeature}
                getSummary={(feature) => `${feature.enabled ? 'enabled' : 'disabled'} - ${feature.source || 'custom'} - ${feature.rules?.length ?? 0} hook(s)`}
              />
              <div className="feature-editor-layout">
                <div className="library-list compact-list">
                  {(creatureDraft.features ?? []).map((feature) => (
                    <button
                      className={feature.id === selectedFeature?.id ? 'selected-action' : ''}
                      key={feature.id}
                      onClick={() => setSelectedFeatureId(feature.id)}
                    >
                      <strong>{feature.name}</strong>
                      <span>{feature.enabled ? 'enabled' : 'disabled'} - {feature.source || 'feature'}</span>
                      <small>{feature.rules?.length ?? 0} hook(s)</small>
                    </button>
                  ))}
                  {(creatureDraft.features ?? []).length === 0 && <span className="empty-list">No features yet.</span>}
                </div>
                {selectedFeature && (
                  <FeatureEditor
                    feature={selectedFeature}
                    customConditions={customConditionLibrary}
                    resources={creatureDraft.resources ?? []}
                    onChange={updateFeature}
                  />
                )}
              </div>
            </details>

            <details className="editor-section editor-subsection">
              <summary>Resources / Limited Uses</summary>
              <div className="editor-button-row">
                <button onClick={addResource}>Add Resource</button>
                <button onClick={deleteResource} disabled={!selectedResource}>
                  Delete Resource
                </button>
              </div>
              <PartLibraryControls
                title="Resource Library"
                items={resourceLibrary}
                selectedId={selectedLibraryResource?.id ?? ''}
                onSelect={setSelectedLibraryResourceId}
                onSave={saveSelectedResourceToLibrary}
                onApply={applyLibraryResource}
                onDelete={deleteLibraryResource}
                saveDisabled={!selectedResource}
                applyDisabled={!selectedLibraryResource}
                deleteDisabled={!selectedLibraryResource}
                getSummary={(resource) => `${resource.current}/${resource.max} - resets ${resource.resetOn}`}
              />
              <div className="resource-editor-layout">
                <div className="library-list compact-list">
                  {(creatureDraft.resources ?? []).map((resource) => (
                    <button
                      className={resource.id === selectedResource?.id ? 'selected-action' : ''}
                      key={resource.id}
                      onClick={() => setSelectedResourceId(resource.id)}
                    >
                      <strong>{resource.name}</strong>
                      <span>
                        {resource.current}/{resource.max}
                      </span>
                    </button>
                  ))}
                  {(creatureDraft.resources ?? []).length === 0 && <span className="empty-list">No resources.</span>}
                </div>
                {selectedResource && (
                  <div className="form-grid">
                    <label>
                      Name
                      <input value={selectedResource.name} onChange={(event) => updateResource({ name: event.target.value })} />
                    </label>
                    <label>
                      ID
                      <input value={selectedResource.id} onChange={(event) => updateResource({ id: toId(event.target.value) })} />
                    </label>
                    <NumberInput label="Current" value={selectedResource.current} onChange={(value) => updateResource({ current: value })} />
                    <NumberInput label="Max" value={selectedResource.max} onChange={(value) => updateResource({ max: value })} />
                    <label>
                      Reset
                      <select value={selectedResource.resetOn} onChange={(event) => updateResource({ resetOn: event.target.value as ResourceReset })}>
                        {resetOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </details>

            <details className="editor-section editor-subsection">
              <summary>CR / Balance Helper</summary>
              <p className="editor-muted">Estimated from 5e-style monster creation math. This does not affect saved creature data or combat behavior.</p>
              <div className="form-grid">
                <NumberInput label="Target AC" value={crTargetAc} min={1} onChange={setCrTargetAc} />
                <NumberInput label="Target Save Bonus" value={crTargetSaveBonus} onChange={setCrTargetSaveBonus} />
                <label>
                  Manual DPR Override
                  <input
                    type="number"
                    value={manualDprOverride}
                    placeholder={`${crEstimate.estimatedDpr}`}
                    onChange={(event) => setManualDprOverride(event.target.value)}
                  />
                </label>
                <label>
                  Manual Final CR
                  <input
                    value={manualFinalCrOverride}
                    placeholder={crEstimate.finalCr}
                    onChange={(event) => setManualFinalCrOverride(event.target.value)}
                  />
                </label>
              </div>
              <div className="cr-helper-results">
                <span><strong>Defensive CR</strong>{crEstimate.defensiveCr}</span>
                <span><strong>Offensive CR</strong>{crEstimate.offensiveCr}</span>
                <span><strong>Final Estimated CR</strong>{crEstimate.finalCr}</span>
                <span><strong>Suggested PB</strong>+{crEstimate.proficiencyBonusSuggestion}</span>
                <span><strong>Effective HP</strong>{crEstimate.effectiveHp}</span>
                <span><strong>Estimated DPR</strong>{crEstimate.estimatedDpr}</span>
              </div>
              <ul className="cr-helper-notes">
                {crEstimate.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <details className="cr-table-reference">
                <summary>CR Calculation Table</summary>
                <div className="cr-table-scroll">
                  <table className="cr-reference-table">
                    <thead>
                      <tr>
                        <th>CR</th>
                        <th>HP</th>
                        <th>AC</th>
                        <th>DPR</th>
                        <th>Attack</th>
                        <th>Save DC</th>
                        <th>XP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crCalculationTable.map((row) => (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          <td>{row.minHp}-{row.maxHp}</td>
                          <td>{row.ac}</td>
                          <td>{row.minDpr}-{row.maxDpr}</td>
                          <td>+{row.attackBonus}</td>
                          <td>{row.saveDc}</td>
                          <td>{row.xp.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </details>

            <details className="editor-section editor-subsection">
              <summary>Custom Conditions</summary>
              <div className="condition-builder-help">
                <strong>How custom conditions work</strong>
                <p>
                  A custom condition is a reusable status effect you can apply in combat. The name, description, tags, and notes explain the rule to you; only mechanical hooks change engine behavior.
                </p>
                <ul>
                  <li><strong>Tags</strong> are labels for searching and future automation. A tag does nothing by itself unless a hook/filter looks for it.</li>
                  <li><strong>Mechanical hooks</strong> say when something happens: before an attack roll, at turn start, while active, and so on.</li>
                  <li><strong>Selectors</strong> choose who receives the effect. For example, source usually means the attacker or acting creature.</li>
                  <li><strong>Filters</strong> narrow when a hook applies, such as only when the target has this condition.</li>
                  <li><strong>Description and notes</strong> are rules text for humans. They do not change rolls, damage, movement, or targeting unless matching hooks are configured.</li>
                </ul>
                <p>
                  Common patterns: Burning uses onTurnStart + dealDamage. Slowed uses whileActive + multiplyMovementCost. Marked uses beforeAttackRoll + targetHasCondition + addFlatModifier.
                </p>
              </div>
              <div className="editor-button-row">
                <button onClick={addCustomConditionTemplate}>New Condition</button>
                <button onClick={duplicateSelectedCustomCondition} disabled={!selectedConditionTemplate}>
                  Duplicate as Custom Copy
                </button>
                <button onClick={saveSelectedCustomCondition} disabled={!selectedCustomCondition || selectedConditionIsReference}>
                  Save Condition
                </button>
                <button onClick={deleteSelectedCustomCondition} disabled={!selectedCustomCondition || selectedConditionIsReference}>
                  Delete
                </button>
              </div>
              <label className="editor-search">
                Search custom conditions
                <input
                  value={customConditionSearch}
                  placeholder="Name, tag, rules text, or hook"
                  onChange={(event) => setCustomConditionSearch(event.target.value)}
                />
              </label>
              <div className="condition-template-layout">
                <div className="library-list compact-list">
                  <span className="library-list-heading">Reference and examples</span>
                  {filteredReferenceConditions.map((template) => (
                    <button
                      className={getReferenceConditionSelectionId(template) === selectedCustomConditionId ? 'selected-action' : ''}
                      key={`reference-${template.id}`}
                      onClick={() => setSelectedCustomConditionId(getReferenceConditionSelectionId(template))}
                    >
                      <strong>{template.name}</strong>
                      <span>{template.tags.join(', ') || 'reference'}</span>
                      <small>{hasMechanicalCustomConditionEffects(template) ? `${template.rules.length} hook(s)` : 'rules text only'}</small>
                    </button>
                  ))}
                  <span className="library-list-heading">Your custom conditions</span>
                  {filteredCustomConditions.map((template) => (
                    <button
                      className={template.id === selectedCustomConditionId ? 'selected-action' : ''}
                      key={template.id}
                      onClick={() => setSelectedCustomConditionId(template.id)}
                    >
                      <strong>{template.name}</strong>
                      <span>{template.tags.join(', ') || 'no tags'}</span>
                      <small>{hasMechanicalCustomConditionEffects(template) ? `${template.rules.length} hook(s)` : 'rules text only'}</small>
                    </button>
                  ))}
                  {filteredCustomConditions.length === 0 && <span className="empty-list">No custom conditions match that search.</span>}
                </div>
                {selectedConditionTemplate ? (
                  <div className="condition-template-form">
                    {selectedConditionIsReference && (
                      <div className="condition-template-status reference-note">
                        <strong>Read-only reference template</strong>
                        <span>Duplicate this template to create an editable custom copy. Reference templates do not overwrite core condition behavior.</span>
                      </div>
                    )}
                    <div className="form-grid">
                      <label>
                        Name
                        <input disabled={selectedConditionIsReference} value={selectedConditionTemplate.name} onChange={(event) => updateSelectedCustomCondition({ name: event.target.value })} />
                      </label>
                      <label>
                        ID
                        <input disabled={selectedConditionIsReference} value={selectedConditionTemplate.id} onChange={(event) => updateSelectedCustomCondition({ id: toId(event.target.value) })} />
                      </label>
                      <label>
                        Default Duration
                        <select
                          disabled={selectedConditionIsReference}
                          value={selectedConditionTemplate.defaultDurationType ?? 'permanentUntilRemoved'}
                          onChange={(event) => updateSelectedCustomCondition({ defaultDurationType: event.target.value as ConditionDurationType })}
                        >
                          <option value="untilStartOfSourceTurn">untilStartOfSourceTurn</option>
                          <option value="untilEndOfSourceTurn">untilEndOfSourceTurn</option>
                          <option value="untilStartOfTargetTurn">untilStartOfTargetTurn</option>
                          <option value="untilEndOfTargetTurn">untilEndOfTargetTurn</option>
                          <option value="rounds">rounds</option>
                          <option value="permanentUntilRemoved">permanentUntilRemoved</option>
                        </select>
                      </label>
                      {selectedConditionTemplate.defaultDurationType === 'rounds' && (
                        <NumberInput
                          label="Default Rounds"
                          value={selectedConditionTemplate.defaultRemainingRounds ?? 1}
                          min={1}
                          disabled={selectedConditionIsReference}
                          onChange={(value) => updateSelectedCustomCondition({ defaultRemainingRounds: value })}
                        />
                      )}
                      <label>
                        Stack
                        <select
                          disabled={selectedConditionIsReference}
                          value={selectedConditionTemplate.stackBehavior ?? 'refresh'}
                          onChange={(event) => updateSelectedCustomCondition({ stackBehavior: event.target.value as StackBehavior })}
                        >
                          {stackBehaviors.map((behavior) => (
                            <option key={behavior} value={behavior}>
                              {behavior}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tags
                        <input
                          disabled={selectedConditionIsReference}
                          value={selectedConditionTemplate.tags.join(', ')}
                          placeholder="homebrew, curse, aura"
                          onChange={(event) => updateSelectedCustomCondition({ tags: parseCsv(event.target.value) })}
                        />
                      </label>
                      <label className="wide-field">
                        Description
                        <textarea disabled={selectedConditionIsReference} value={selectedConditionTemplate.description} onChange={(event) => updateSelectedCustomCondition({ description: event.target.value })} />
                      </label>
                      <label className="wide-field">
                        Notes / Rules Text
                        <textarea disabled={selectedConditionIsReference} value={selectedConditionTemplate.notes ?? ''} onChange={(event) => updateSelectedCustomCondition({ notes: event.target.value })} />
                      </label>
                    </div>
                    <div className="condition-template-status">
                      <strong>{hasMechanicalCustomConditionEffects(selectedConditionTemplate) ? 'Mechanical hooks configured' : 'Rules text only'}</strong>
                      {selectedCustomConditionWarnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                    <RuleListEditor
                      title="Mechanical Hooks"
                      customConditions={[...customConditionLibrary, ...referenceConditionLibrary]}
                      rules={selectedConditionTemplate.rules}
                      resources={creatureDraft.resources ?? []}
                      readOnly={selectedConditionIsReference}
                      onChange={(rules) => updateSelectedCustomCondition({ rules })}
                    />
                  </div>
                ) : (
                  <span className="empty-list">Create a custom condition to begin.</span>
                )}
              </div>
              <details className="editor-subsection">
                <summary>Custom Condition JSON</summary>
                <div className="editor-button-row">
                  <button onClick={exportSelectedCustomCondition} disabled={!selectedCustomCondition}>
                    Export Selected
                  </button>
                  <button onClick={exportCustomConditionLibrary}>Export Library</button>
                  <button onClick={importCustomConditionJson}>Import JSON</button>
                </div>
                {customConditionMessage && <p className="editor-message">{customConditionMessage}</p>}
                <textarea value={customConditionJson} onChange={(event) => setCustomConditionJson(event.target.value)} spellCheck={false} />
              </details>
            </details>

            <section className="editor-section">
              <h3>Creature JSON</h3>
              <div className="editor-button-row">
                <button onClick={exportSelectedCreature}>Export Selected</button>
                <button onClick={exportCreatureLibrary}>Export Library</button>
                <button onClick={importCreatureJson}>Import JSON</button>
              </div>
              {creatureJsonMessage && <p className="editor-message">{creatureJsonMessage}</p>}
              <textarea value={creatureJson} onChange={(event) => setCreatureJson(event.target.value)} spellCheck={false} />
            </section>
          </div>
        </div>
      </section>
      ) : (
      <section className="panel encounter-builder-panel">
        <header className="editor-panel-header">
          <h2>Encounter Builder</h2>
          <div className="editor-button-row">
            <button onClick={clearBuilder}>New</button>
            <button onClick={seedBuilderFromCombat}>From Active Combat</button>
            <button onClick={saveBuilderEncounter}>Save Encounter</button>
            <button onClick={loadBuilderIntoCombat} disabled={builderCreatures.length === 0}>
              Load Into Combat
            </button>
          </div>
        </header>
        {encounterTemplateWarnings.length > 0 && (
          <div className="editor-message">
            {encounterTemplateWarnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}

        <div className="encounter-layout">
          <aside className="encounter-side">
            <section className="editor-section">
              <h3>Saved Encounters</h3>
              <div className="library-list encounter-list">
                {encounters.map((encounter) => (
                  <button
                    className={encounter.id === selectedEncounterId ? 'selected-action' : ''}
                    key={encounter.id}
                    onClick={() => loadSavedEncounter(encounter)}
                  >
                    <strong>{encounter.name}</strong>
                    <span>{encounter.instances.length} creature(s)</span>
                    <small>{new Date(encounter.updatedAt).toLocaleString()}</small>
                  </button>
                ))}
                {encounters.length === 0 && <span className="empty-list">No saved encounters.</span>}
              </div>
              <button onClick={deleteSavedEncounter} disabled={!selectedEncounterId}>
                Delete Saved Encounter
              </button>
            </section>

            <section className="editor-section">
              <h3>Setup</h3>
              <div className="form-grid">
                <label className="wide-field">
                  Name
                  <input value={builderName} onChange={(event) => setBuilderName(event.target.value)} />
                </label>
                <NumberInput label="Width" value={builderGrid.width} min={1} max={MAX_GRID_SIZE} onChange={(value) => setBuilderGrid((current) => normalizeGrid({ ...current, width: value }))} />
                <NumberInput label="Height" value={builderGrid.height} min={1} max={MAX_GRID_SIZE} onChange={(value) => setBuilderGrid((current) => normalizeGrid({ ...current, height: value }))} />
              </div>
              <div className="action-tabs">
                <button className={builderTool === 'place' ? 'selected-action' : ''} onClick={() => setBuilderTool('place')}>
                  Place
                </button>
                <button className={builderTool === 'move' ? 'selected-action' : ''} onClick={() => setBuilderTool('move')}>
                  Move
                </button>
                <button className={builderTool === 'block' ? 'selected-action' : ''} onClick={() => setBuilderTool('block')}>
                  Block
                </button>
                <button className={builderTool === 'height' ? 'selected-action' : ''} onClick={() => setBuilderTool('height')}>
                  Height
                </button>
              </div>
              {builderTool === 'height' && (
                <div className="form-grid">
                  <NumberInput label="Tile Z" value={builderTileHeight} onChange={setBuilderTileHeight} />
                </div>
              )}
              <label>
                Creature to place
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                  {creatureLibrary.map((creature) => (
                    <option key={creature.id} value={creature.id}>
                      {creature.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="editor-section encounter-balance-card">
              <h3>Encounter Balance</h3>
              <strong>{encounterBalance.message}</strong>
              <div className="encounter-balance-grid">
                {teams.map((team) => (
                  <span key={team}>
                    <strong>{team}</strong>
                    {encounterBalance.teams[team].xp.toLocaleString()} XP
                    <small>{encounterBalance.teams[team].count} creature(s)</small>
                  </span>
                ))}
              </div>
              <p className="editor-muted">
                Based on estimated final CR converted to XP weight. Neutral creatures are listed but not counted for the player/enemy edge.
              </p>
            </section>

            <section className="editor-section">
              <h3>Placed Creatures</h3>
              <div className="library-list encounter-list">
                {builderCreatures.map((creature) => (
                  <button
                    className={creature.id === selectedInstanceId ? 'selected-action' : ''}
                    key={creature.id}
                    onClick={() => setSelectedInstanceId(creature.id)}
                  >
                    <strong>{creature.name}</strong>
                    <span>
                      {creature.team} {creature.position.x},{creature.position.y},{creature.position.z ?? 0}
                    </span>
                  </button>
                ))}
                {builderCreatures.length === 0 && <span className="empty-list">Place a creature on the grid.</span>}
              </div>
              {selectedInstance && (
                <div className="form-grid">
                  <label className="wide-field">
                    Instance Name
                    <input value={selectedInstance.name} onChange={(event) => updateSelectedInstance({ name: event.target.value })} />
                  </label>
                  <label>
                    Team
                    <select value={selectedInstance.team} onChange={(event) => updateSelectedInstance({ team: event.target.value as Team })}>
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberInput label="X" value={selectedInstance.position.x} onChange={(value) => updateSelectedInstance({ position: { ...selectedInstance.position, x: value } })} />
                  <NumberInput label="Y" value={selectedInstance.position.y} onChange={(value) => updateSelectedInstance({ position: { ...selectedInstance.position, y: value } })} />
                  <NumberInput label="Z" value={selectedInstance.position.z ?? 0} onChange={(value) => updateSelectedInstance({ position: { ...selectedInstance.position, z: value } })} />
                  <NumberInput label="HP" value={selectedInstance.hp} onChange={(value) => updateSelectedInstance({ hp: value })} />
                  <button onClick={removeSelectedInstance}>Remove From Encounter</button>
                </div>
              )}
            </section>
          </aside>

          <section className="builder-board-section">
            <div
              className="builder-grid-board"
              role="grid"
              style={{ gridTemplateColumns: `repeat(${builderGrid.width}, 52px)` }}
            >
              {Array.from({ length: builderGrid.height }).flatMap((_, y) =>
                Array.from({ length: builderGrid.width }).map((_, x) => {
                  const position = getTilePosition({ x, y }, builderGrid);
                  const key = positionKey(position);
                  const creature = builderCreatures.find((candidate) => sameTilePosition(candidate.position, position));
                  const blocked = blockedKeys.has(key);
                  const tileHeight = getTileHeight(position, builderGrid);
                  return (
                    <button
                      aria-label={`Builder grid ${x},${y}${creature ? ` ${creature.name}` : ''}${blocked ? ' blocked' : ''}`}
                      className={[
                        'grid-cell',
                        'builder-cell',
                        blocked ? 'blocked' : '',
                        creature?.id === selectedInstanceId ? 'selected-cell' : '',
                        occupiedKeys.has(key) ? 'occupied-builder-cell' : ''
                      ].join(' ')}
                      key={key}
                      onClick={() => handleBuilderCellClick(position)}
                    >
                      <span className="coord">{x},{y}</span>
                      {tileHeight !== 0 && <span className="height-marker">z{tileHeight}</span>}
                      {creature && <span className={`token ${creature.team}`}>{getCreatureShortLabel(creature)}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <section className="editor-section">
          <h3>Encounter JSON</h3>
          <div className="editor-button-row">
            <button onClick={exportBuilderEncounter}>Export Builder</button>
            <button onClick={importEncounterJson}>Import JSON</button>
          </div>
          {encounterJsonMessage && <p className="editor-message">{encounterJsonMessage}</p>}
          <textarea value={encounterJson} onChange={(event) => setEncounterJson(event.target.value)} spellCheck={false} />
        </section>
      </section>
      )}
    </section>
  );
}

function PartLibraryControls<T extends { id: string; name: string }>({
  title,
  items,
  selectedId,
  onSelect,
  onSave,
  onApply,
  onDelete,
  saveDisabled,
  applyDisabled,
  deleteDisabled,
  getSummary
}: {
  title: string;
  items: T[];
  selectedId: string;
  onSelect: (id: string) => void;
  onSave: () => void;
  onApply: () => void;
  onDelete: () => void;
  saveDisabled?: boolean;
  applyDisabled?: boolean;
  deleteDisabled?: boolean;
  getSummary: (item: T) => string;
}) {
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  return (
    <details className="part-library-tools">
      <summary>{title}</summary>
      <div className="part-library-grid">
        <label>
          Saved Entry
          <select value={selected?.id ?? ''} onChange={(event) => onSelect(event.target.value)}>
            <option value="">No saved entries</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="editor-button-row">
          <button onClick={onSave} disabled={saveDisabled}>
            Save Selected
          </button>
          <button onClick={onApply} disabled={applyDisabled || !selected}>
            Apply Saved
          </button>
          <button onClick={onDelete} disabled={deleteDisabled || !selected}>
            Delete Saved
          </button>
        </div>
        <span className="part-library-summary">{selected ? getSummary(selected) : 'Nothing saved yet.'}</span>
      </div>
    </details>
  );
}

function ActionEditor({
  action,
  customConditions,
  resources,
  onChange
}: {
  action: ActionDefinition;
  customConditions: CustomConditionTemplate[];
  resources: Resource[];
  onChange: (update: Partial<ActionDefinition>) => void;
}) {
  const cost = action.resourceCosts?.[0];

  function setKind(kind: ActionKind) {
    onChange({
      kind,
      type: kind === 'meleeAttack' || kind === 'rangedAttack' || kind === 'savingThrowEffect' ? kind : kind === 'spell' ? action.type : undefined,
      tags: inferTags(kind, action.tags)
    });
  }

  function setResourceCost(resourceId: string) {
    onChange({
              resourceCosts: resourceId
        ? [
            {
              resourceId,
              amount: cost?.amount ?? 1,
              consumeOn: cost?.consumeOn ?? 'use',
              spendActionWhenDepleted: cost?.spendActionWhenDepleted ?? false
            }
          ]
        : []
    });
  }

  return (
    <div className="action-form">
      <details className="editor-subsection" open>
        <summary>Identity</summary>
        <div className="form-grid">
          <label>
            Name
            <input value={action.name} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label>
            ID
            <input value={action.id} onChange={(event) => onChange({ id: toId(event.target.value) })} />
          </label>
          <label>
            Kind
            <select value={action.kind} onChange={(event) => setKind(event.target.value as ActionKind)}>
              {actionKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rules Type
            <select value={action.type ?? ''} onChange={(event) => onChange({ type: (event.target.value || undefined) as ActionDefinition['type'] })}>
              <option value="">Utility / manual</option>
              <option value="meleeAttack">Melee attack</option>
              <option value="rangedAttack">Ranged attack</option>
              <option value="savingThrowEffect">Saving throw effect</option>
            </select>
          </label>
          <label>
            Cost
            <select value={action.actionCost} onChange={(event) => onChange({ actionCost: event.target.value as ActionCost })}>
              {actionCosts.map((costOption) => (
                <option key={costOption} value={costOption}>
                  {formatEditorActionCost(costOption)}
                </option>
              ))}
            </select>
          </label>
          <label className="wide-field">
            Tags
            <input value={action.tags.join(', ')} onChange={(event) => onChange({ tags: parseTags(event.target.value) })} />
          </label>
          <label className="wide-field">
            Description
            <textarea value={action.description ?? ''} onChange={(event) => onChange({ description: event.target.value })} />
          </label>
        </div>
      </details>

      <details className="editor-subsection" open>
        <summary>Attack and Damage</summary>
        <div className="form-grid">
          <NumberInput label="Range Cells" value={action.range} min={0} onChange={(value) => onChange({ range: value })} />
          <NumberInput label="Reach Feet" value={action.reach ?? 5} min={0} onChange={(value) => onChange({ reach: value })} />
          <NumberInput label="Normal Range" value={action.normalRange ?? 0} min={0} onChange={(value) => onChange({ normalRange: value })} />
          <NumberInput label="Long Range" value={action.longRange ?? 0} min={0} onChange={(value) => onChange({ longRange: value })} />
          <NumberInput label="Attack Bonus" value={action.attackBonus ?? 0} onChange={(value) => onChange({ attackBonus: value })} />
          <label>
            Damage Dice
            <input value={action.damage?.dice ?? ''} onChange={(event) => onChange({ damage: { dice: event.target.value, type: action.damage?.type } })} />
          </label>
          <label>
            Damage Type
            <input value={action.damage?.type ?? ''} onChange={(event) => onChange({ damage: { dice: action.damage?.dice ?? '', type: event.target.value } })} />
          </label>
        </div>
      </details>

      <details className="editor-subsection">
        <summary>Saving Throw and Area</summary>
        <div className="form-grid">
          <label>
            Save Ability
            <select
              value={action.save?.ability ?? ''}
              onChange={(event) =>
                onChange({
                  save: event.target.value
                    ? { ability: event.target.value as Ability, dc: action.save?.dc ?? 10, halfDamageOnSuccess: action.save?.halfDamageOnSuccess ?? true }
                    : undefined
                })
              }
            >
              <option value="">None</option>
              {abilities.map((ability) => (
                <option key={ability} value={ability}>
                  {ability.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Save DC"
            value={action.save?.dc ?? 10}
            min={0}
            onChange={(value) => action.save && onChange({ save: { ...action.save, dc: value } })}
          />
          <label className="checkbox-field">
            <input
              checked={Boolean(action.save?.halfDamageOnSuccess)}
              disabled={!action.save}
              type="checkbox"
              onChange={(event) => action.save && onChange({ save: { ...action.save, halfDamageOnSuccess: event.target.checked } })}
            />
            Half damage on success
          </label>
          <label>
            Shape
            <select value={action.shape?.type ?? 'single'} onChange={(event) => onChange({ shape: { ...action.shape, type: event.target.value as ShapeType } })}>
              {shapeTypes.map((shape) => (
                <option key={shape} value={shape}>
                  {shape}
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Radius"
            value={action.shape?.radius ?? 0}
            min={0}
            onChange={(value) => onChange({ shape: { type: action.shape?.type ?? 'radius', ...action.shape, radius: value } })}
          />
          <NumberInput
            label="Length"
            value={action.shape?.length ?? 0}
            min={0}
            onChange={(value) => onChange({ shape: { type: action.shape?.type ?? 'line', ...action.shape, length: value } })}
          />
        </div>
      </details>

      <details className="editor-subsection" open>
        <summary>Resource Cost</summary>
        <div className="form-grid">
          <label>
            Resource
            <select value={cost?.resourceId ?? ''} onChange={(event) => setResourceCost(event.target.value)}>
              <option value="">None</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Amount"
            value={cost?.amount ?? 1}
            min={1}
            onChange={(value) => cost && onChange({ resourceCosts: [{ ...cost, amount: value }] })}
          />
          <label>
            Consume On
            <select value={cost?.consumeOn ?? 'use'} onChange={(event) => cost && onChange({ resourceCosts: [{ ...cost, consumeOn: event.target.value as ResourceConsumeOn }] })}>
              {consumeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input
              checked={Boolean(cost?.spendActionWhenDepleted)}
              disabled={!cost}
              type="checkbox"
              onChange={(event) => cost && onChange({ resourceCosts: [{ ...cost, spendActionWhenDepleted: event.target.checked }] })}
            />
            Spend action when depleted
          </label>
        </div>
      </details>

      <details className="editor-subsection">
        <summary>Multiattack</summary>
        <div className="form-grid">
          <label className="wide-field">
            Step Action IDs
            <input
              value={(action.multiattack?.steps ?? []).map((step) => step.actionId ?? step.name).join(', ')}
              onChange={(event) =>
                onChange({
                  multiattack: {
                    targetMode: action.multiattack?.targetMode ?? 'sameTarget',
                    steps: parseCsv(event.target.value).map((actionId, index) => ({
                      id: `step-${index + 1}`,
                      name: actionId,
                      actionId,
                      required: true
                    }))
                  }
                })
              }
            />
          </label>
          <label>
            Targets
            <select
              value={action.multiattack?.targetMode ?? 'sameTarget'}
              onChange={(event) =>
                onChange({
                  multiattack: {
                    steps: action.multiattack?.steps ?? [],
                    targetMode: event.target.value as 'sameTarget' | 'chooseEach' | 'fixed'
                  }
                })
              }
            >
              <option value="sameTarget">sameTarget</option>
              <option value="chooseEach">chooseEach</option>
              <option value="fixed">fixed</option>
            </select>
          </label>
        </div>
      </details>

      <RuleListEditor
        title="Action Hooks"
        customConditions={customConditions}
        rules={action.rules ?? []}
        resources={resources}
        onChange={(rules) => onChange({ rules })}
      />
    </div>
  );
}

function FeatureEditor({
  feature,
  customConditions,
  resources,
  onChange
}: {
  feature: FeatureDefinition;
  customConditions: CustomConditionTemplate[];
  resources: Resource[];
  onChange: (update: Partial<FeatureDefinition>) => void;
}) {
  return (
    <div className="feature-form">
      <details className="editor-subsection" open>
        <summary>Feature Details</summary>
        <div className="form-grid">
          <label>
            Name
            <input value={feature.name} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label>
            ID
            <input value={feature.id} onChange={(event) => onChange({ id: toId(event.target.value) })} />
          </label>
          <label>
            Source
            <input value={feature.source} onChange={(event) => onChange({ source: event.target.value })} />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={feature.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            Enabled
          </label>
          <label className="wide-field">
            Description
            <textarea value={feature.description} onChange={(event) => onChange({ description: event.target.value })} />
          </label>
        </div>
      </details>

      <details className="editor-subsection">
        <summary>Passive Stat Modifiers</summary>
        <div className="form-grid">
          <NumberInput label="AC" value={feature.modifiers?.ac ?? 0} onChange={(value) => onChange({ modifiers: cleanStatModifiers({ ...feature.modifiers, ac: value }) })} />
          <NumberInput label="Speed" value={feature.modifiers?.speed ?? 0} onChange={(value) => onChange({ modifiers: cleanStatModifiers({ ...feature.modifiers, speed: value }) })} />
          <NumberInput label="Climb" value={feature.modifiers?.climbSpeed ?? 0} onChange={(value) => onChange({ modifiers: cleanStatModifiers({ ...feature.modifiers, climbSpeed: value }) })} />
          <NumberInput label="Fly" value={feature.modifiers?.flySpeed ?? 0} onChange={(value) => onChange({ modifiers: cleanStatModifiers({ ...feature.modifiers, flySpeed: value }) })} />
          <NumberInput label="Attack Bonus" value={feature.modifiers?.attackBonus ?? 0} onChange={(value) => onChange({ modifiers: cleanStatModifiers({ ...feature.modifiers, attackBonus: value }) })} />
          <NumberInput label="Max HP" value={feature.modifiers?.maxHp ?? 0} onChange={(value) => onChange({ modifiers: cleanStatModifiers({ ...feature.modifiers, maxHp: value }) })} />
        </div>
      </details>

      <RuleListEditor
        title="Feature Hooks"
        customConditions={customConditions}
        rules={feature.rules ?? []}
        resources={resources}
        onChange={(rules) => onChange({ rules })}
      />
    </div>
  );
}

function RuleListEditor({
  title,
  customConditions,
  rules,
  resources,
  readOnly = false,
  onChange
}: {
  title: string;
  customConditions: CustomConditionTemplate[];
  rules: RuleDefinition[];
  resources: Resource[];
  readOnly?: boolean;
  onChange: (rules: RuleDefinition[]) => void;
}) {
  function addRule() {
    onChange([...rules, createBlankRule()]);
  }

  function updateRule(index: number, update: RuleDefinition) {
    onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? normalizeRule(update) : rule)));
  }

  function deleteRule(index: number) {
    onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  }

  return (
    <details className="editor-subsection rule-section" open>
      <summary>{title}</summary>
      <div className="editor-button-row">
        <button onClick={addRule} disabled={readOnly}>Add Hook</button>
      </div>
      <div className="rule-list">
        {rules.map((rule, index) => (
          <RuleEditor
            key={`${rule.id}-${index}`}
            rule={rule}
            customConditions={customConditions}
            resources={resources}
            readOnly={readOnly}
            onChange={(nextRule) => updateRule(index, nextRule)}
            onDelete={() => deleteRule(index)}
          />
        ))}
        {rules.length === 0 && <span className="empty-list">No hooks configured.</span>}
      </div>
    </details>
  );
}

function RuleEditor({
  rule,
  customConditions,
  resources,
  readOnly = false,
  onChange,
  onDelete
}: {
  rule: RuleDefinition;
  customConditions: CustomConditionTemplate[];
  resources: Resource[];
  readOnly?: boolean;
  onChange: (rule: RuleDefinition) => void;
  onDelete: () => void;
}) {
  const selectors = rule.selectors ?? [];
  const filters = rule.filters ?? [];

  return (
    <article className="rule-card">
      <div className="rule-card-header">
        <strong>{rule.name || rule.id}</strong>
        <button onClick={onDelete} disabled={readOnly}>Delete</button>
      </div>
      <div className="form-grid">
        <label>
          Name
          <input disabled={readOnly} value={rule.name ?? ''} onChange={(event) => onChange({ ...rule, name: event.target.value })} />
        </label>
        <label>
          ID
          <input disabled={readOnly} value={rule.id} onChange={(event) => onChange({ ...rule, id: toId(event.target.value) })} />
        </label>
        <label>
          Trigger
          <select disabled={readOnly} value={rule.trigger} onChange={(event) => onChange({ ...rule, trigger: event.target.value as RuleTriggerPoint })}>
            {ruleTriggers.map((trigger) => (
              <option key={trigger} value={trigger}>
                {trigger}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input disabled={readOnly} type="checkbox" checked={rule.enabled !== false} onChange={(event) => onChange({ ...rule, enabled: event.target.checked })} />
          Enabled
        </label>
      </div>

      <RulePartList
        title="Targets"
        addLabel="Add Target"
        emptyText="Defaults to source or action target based on trigger."
        readOnly={readOnly}
        onAdd={() => onChange({ ...rule, selectors: [...selectors, createBlankSelector()] })}
      >
        {selectors.map((selector, index) => (
          <SelectorEditor
            key={index}
            selector={selector}
            readOnly={readOnly}
            onChange={(nextSelector) => onChange({ ...rule, selectors: updateArray(selectors, index, nextSelector) })}
            onDelete={() => onChange({ ...rule, selectors: removeArrayItem(selectors, index) })}
          />
        ))}
      </RulePartList>

      <RulePartList
        title="Filters"
        addLabel="Add Filter"
        emptyText="No filters. Hook can run whenever the trigger fires."
        readOnly={readOnly}
        onAdd={() => onChange({ ...rule, filters: [...filters, createBlankFilter()] })}
      >
        {filters.map((filter, index) => (
          <FilterEditor
            key={index}
            filter={filter}
            resources={resources}
            readOnly={readOnly}
            onChange={(nextFilter) => onChange({ ...rule, filters: updateArray(filters, index, nextFilter) })}
            onDelete={() => onChange({ ...rule, filters: removeArrayItem(filters, index) })}
          />
        ))}
      </RulePartList>

      <RulePartList
        title="Effects"
        addLabel="Add Effect"
        emptyText="Add at least one effect."
        readOnly={readOnly}
        onAdd={() => onChange({ ...rule, effects: [...rule.effects, createBlankEffect()] })}
      >
        {rule.effects.map((effect, index) => (
          <EffectEditor
            key={index}
            effect={effect}
            customConditions={customConditions}
            resources={resources}
            readOnly={readOnly}
            onChange={(nextEffect) => onChange({ ...rule, effects: updateArray(rule.effects, index, nextEffect) })}
            onDelete={() => onChange({ ...rule, effects: removeArrayItem(rule.effects, index) })}
          />
        ))}
      </RulePartList>
    </article>
  );
}

function RulePartList({
  title,
  addLabel,
  emptyText,
  readOnly = false,
  onAdd,
  children
}: {
  title: string;
  addLabel: string;
  emptyText: string;
  readOnly?: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rule-part-list">
      <div className="rule-part-header">
        <strong>{title}</strong>
        <button onClick={onAdd} disabled={readOnly}>{addLabel}</button>
      </div>
      {hasChildren ? children : <span className="empty-list">{emptyText}</span>}
    </div>
  );
}

function SelectorEditor({
  selector,
  readOnly = false,
  onChange,
  onDelete
}: {
  selector: RuleTargetSelector;
  readOnly?: boolean;
  onChange: (selector: RuleTargetSelector) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rule-row">
      <label>
        Selector
        <select disabled={readOnly} value={selector.type} onChange={(event) => onChange(createBlankSelector(event.target.value as TargetSelectorType))}>
          {selectorTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {(selector.type === 'alliesWithinRange' || selector.type === 'enemiesWithinRange') && (
        <NumberInput disabled={readOnly} label="Range Feet" value={selector.range ?? 10} min={0} onChange={(value) => onChange({ ...selector, range: value })} />
      )}
      <button onClick={onDelete} disabled={readOnly}>Remove</button>
    </div>
  );
}

function FilterEditor({
  filter,
  resources,
  readOnly = false,
  onChange,
  onDelete
}: {
  filter: RuleFilter;
  resources: Resource[];
  readOnly?: boolean;
  onChange: (filter: RuleFilter) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rule-row">
      <label>
        Filter
        <select disabled={readOnly} value={filter.type} onChange={(event) => onChange(createBlankFilter(event.target.value as RuleFilterType))}>
          {filterTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {filter.type === 'actionHasTag' && (
        <label>
          Tag
          <input disabled={readOnly} value={filter.tag} onChange={(event) => onChange({ ...filter, tag: event.target.value })} />
        </label>
      )}
      {(filter.type === 'targetHasCondition' || filter.type === 'sourceHasCondition') && (
        <label>
          Condition ID
          <input disabled={readOnly} value={filter.conditionId} onChange={(event) => onChange({ ...filter, conditionId: toId(event.target.value) })} />
        </label>
      )}
      {filter.type === 'hpBelowHalf' && (
        <CreatureReferenceSelect disabled={readOnly} value={filter.target ?? 'actionTarget'} onChange={(target) => onChange({ ...filter, target })} />
      )}
      {filter.type === 'resourceAvailable' && (
        <>
          <ResourceSelect disabled={readOnly} label="Resource" value={filter.resourceId} resources={resources} onChange={(resourceId) => onChange({ ...filter, resourceId })} />
          <NumberInput disabled={readOnly} label="Amount" value={filter.amount ?? 1} min={1} onChange={(amount) => onChange({ ...filter, amount })} />
          <CreatureReferenceSelect disabled={readOnly} value={filter.target ?? 'source'} onChange={(target) => onChange({ ...filter, target })} />
        </>
      )}
      {(filter.type === 'oncePerTurn' || filter.type === 'oncePerRound') && (
        <label>
          Key
          <input disabled={readOnly} value={filter.key ?? ''} onChange={(event) => onChange({ ...filter, key: event.target.value || undefined })} />
        </label>
      )}
      <button onClick={onDelete} disabled={readOnly}>Remove</button>
    </div>
  );
}

function EffectEditor({
  effect,
  customConditions,
  resources,
  readOnly = false,
  onChange,
  onDelete
}: {
  effect: RuleEffectOperation;
  customConditions: CustomConditionTemplate[];
  resources: Resource[];
  readOnly?: boolean;
  onChange: (effect: RuleEffectOperation) => void;
  onDelete: () => void;
}) {
  const warnings = getRuleEffectWarnings(effect);
  const matchingTemplate =
    effect.type === 'applyCondition' ? customConditions.find((template) => template.id === effect.conditionId) : undefined;
  const isMissingTemplateHooks = effect.type === 'applyCondition' && Boolean(matchingTemplate && !(effect.rules?.length));
  return (
    <div className="rule-row effect-row">
      <label>
        Effect
        <select disabled={readOnly} value={effect.type} onChange={(event) => onChange(createBlankEffect(event.target.value as EffectOperationType))}>
          {effectTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {renderEffectFields(effect, resources, customConditions, onChange, readOnly)}
      <p className="rule-effect-help">{getRuleEffectPlainEnglish(effect)}</p>
      {warnings.map((warning) => (
        <span className="rule-effect-warning" key={warning}>{warning}</span>
      ))}
      {isMissingTemplateHooks && (
        <span className="rule-effect-warning">
          This ID matches the custom template "{matchingTemplate?.name}", but this effect does not include that template's hooks yet.
          Re-select the template or edit the Condition ID to embed its mechanics.
        </span>
      )}
      <button onClick={onDelete} disabled={readOnly}>Remove</button>
    </div>
  );
}

function renderEffectFields(
  effect: RuleEffectOperation,
  resources: Resource[],
  customConditions: CustomConditionTemplate[],
  onChange: (effect: RuleEffectOperation) => void,
  readOnly = false
) {
  if (effect.type === 'addFlatModifier' || effect.type === 'reduceDamage' || effect.type === 'setDamageMinimum') {
    return <NumberInput disabled={readOnly} label="Amount" value={effect.amount} onChange={(amount) => onChange({ ...effect, amount })} />;
  }
  if (effect.type === 'multiplyMovementCost') {
    return <NumberInput disabled={readOnly} label="Cost x" value={effect.factor} min={0.1} onChange={(factor) => onChange({ ...effect, factor })} />;
  }
  if (effect.type === 'multiplyDamage') {
    return <NumberInput disabled={readOnly} label="Factor" value={effect.factor} min={0} onChange={(factor) => onChange({ ...effect, factor })} />;
  }
  if (effect.type === 'addDamageDice' || effect.type === 'dealDamage') {
    return (
      <>
        <label>
          Dice
          <input disabled={readOnly} value={effect.dice} onChange={(event) => onChange({ ...effect, dice: event.target.value })} />
        </label>
        <label>
          Type
          <input disabled={readOnly} value={effect.damageType ?? ''} onChange={(event) => onChange({ ...effect, damageType: event.target.value || undefined })} />
        </label>
      </>
    );
  }
  if (effect.type === 'applyCondition') {
    return (
      <>
        {customConditions.length > 0 && (
          <label>
            Custom Template
            <select
              disabled={readOnly}
              value={customConditions.some((template) => template.id === effect.conditionId && effect.name === template.name) ? effect.conditionId : ''}
              onChange={(event) => {
                const template = customConditions.find((candidate) => candidate.id === event.target.value);
                if (template) {
                  onChange(createApplyConditionEffectFromTemplate(template, effect));
                }
              }}
            >
              <option value="">Manual condition</option>
              {customConditions.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Condition ID
          <input
            disabled={readOnly}
            value={effect.conditionId}
            onChange={(event) => onChange(updateApplyConditionEffectFromTemplateMatch(effect, customConditions, { conditionId: toId(event.target.value) }))}
          />
        </label>
        <label>
          Duration
          <select
            disabled={readOnly}
            value={effect.durationType ?? ''}
            onChange={(event) =>
              onChange(
                updateApplyConditionEffectFromTemplateMatch(effect, customConditions, {
                  durationType: (event.target.value || undefined) as ConditionDurationType | undefined
                })
              )
            }
          >
            <option value="">Default</option>
            <option value="untilStartOfSourceTurn">untilStartOfSourceTurn</option>
            <option value="untilEndOfSourceTurn">untilEndOfSourceTurn</option>
            <option value="untilStartOfTargetTurn">untilStartOfTargetTurn</option>
            <option value="untilEndOfTargetTurn">untilEndOfTargetTurn</option>
            <option value="rounds">rounds</option>
            <option value="permanentUntilRemoved">permanentUntilRemoved</option>
          </select>
        </label>
        <NumberInput
          disabled={readOnly}
          label="Rounds"
          value={effect.remainingRounds ?? 1}
          min={1}
          onChange={(remainingRounds) => onChange(updateApplyConditionEffectFromTemplateMatch(effect, customConditions, { remainingRounds }))}
        />
        <label>
          Stack
          <select
            disabled={readOnly}
            value={effect.stackBehavior ?? ''}
            onChange={(event) =>
              onChange(
                updateApplyConditionEffectFromTemplateMatch(effect, customConditions, {
                  stackBehavior: (event.target.value || undefined) as StackBehavior | undefined
                })
              )
            }
          >
            <option value="">Default</option>
            {stackBehaviors.map((behavior) => (
              <option key={behavior} value={behavior}>
                {behavior}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }
  if (effect.type === 'removeCondition') {
    return (
      <label>
        Condition ID
        <input disabled={readOnly} value={effect.conditionId} onChange={(event) => onChange({ ...effect, conditionId: toId(event.target.value) })} />
      </label>
    );
  }
  if (effect.type === 'spendResource' || effect.type === 'restoreResource') {
    return (
      <>
        <ResourceSelect disabled={readOnly} label="Resource" value={effect.resourceId} resources={resources} onChange={(resourceId) => onChange({ ...effect, resourceId })} />
        <NumberInput disabled={readOnly} label="Amount" value={effect.amount} min={1} onChange={(amount) => onChange({ ...effect, amount })} />
      </>
    );
  }
  if (effect.type === 'addTag' || effect.type === 'removeTag') {
    return (
      <label>
        Tag
        <input disabled={readOnly} value={effect.tag} onChange={(event) => onChange({ ...effect, tag: event.target.value })} />
      </label>
    );
  }
  if (effect.type === 'logMessage') {
    return (
      <label className="wide-field">
        Message
        <input disabled={readOnly} value={effect.message} onChange={(event) => onChange({ ...effect, message: event.target.value })} />
      </label>
    );
  }

  return null;
}

function createApplyConditionEffectFromTemplate(
  template: CustomConditionTemplate,
  previous: Extract<RuleEffectOperation, { type: 'applyCondition' }>
): Extract<RuleEffectOperation, { type: 'applyCondition' }> {
  const normalized = normalizeCustomConditionTemplate(template);
  return {
    ...previous,
    type: 'applyCondition',
    conditionId: normalized.id,
    name: normalized.name,
    description: normalized.description,
    tags: normalized.tags,
    durationType: normalized.defaultDurationType,
    remainingRounds: normalized.defaultDurationType === 'rounds' ? normalized.defaultRemainingRounds ?? 1 : undefined,
    stackBehavior: normalized.stackBehavior,
    metadata: normalized.notes ? { notes: normalized.notes } : undefined,
    rules: normalized.rules
  };
}

function updateApplyConditionEffectFromTemplateMatch(
  effect: Extract<RuleEffectOperation, { type: 'applyCondition' }>,
  customConditions: CustomConditionTemplate[],
  update: Partial<Extract<RuleEffectOperation, { type: 'applyCondition' }>>
): Extract<RuleEffectOperation, { type: 'applyCondition' }> {
  const next = { ...effect, ...update, type: 'applyCondition' as const };
  const template = customConditions.find((candidate) => candidate.id === next.conditionId);
  if (!template) {
    return next;
  }

  const hydrated = createApplyConditionEffectFromTemplate(template, next);
  return {
    ...hydrated,
    durationType: next.durationType,
    remainingRounds: next.remainingRounds,
    stackBehavior: next.stackBehavior,
    stackCount: next.stackCount,
    intensity: next.intensity
  };
}

function CreatureReferenceSelect({
  value,
  disabled = false,
  onChange
}: {
  value: 'self' | 'source' | 'actionTarget';
  disabled?: boolean;
  onChange: (value: 'self' | 'source' | 'actionTarget') => void;
}) {
  return (
    <label>
      Target
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as 'self' | 'source' | 'actionTarget')}>
        <option value="self">self</option>
        <option value="source">source</option>
        <option value="actionTarget">actionTarget</option>
      </select>
    </label>
  );
}

function ResourceSelect({
  label,
  value,
  resources,
  disabled = false,
  onChange
}: {
  label: string;
  value: string;
  resources: Resource[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select resource</option>
        {resources.map((resource) => (
          <option key={resource.id} value={resource.id}>
            {resource.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  disabled = false,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input disabled={disabled} max={max} min={min} type="number" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function filterCreaturesForEditor(creatures: Creature[], query: string): Creature[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return creatures;
  }

  return creatures.filter((creature) => {
    const haystack = [
      creature.name,
      creature.team,
      `hp ${creature.hp}`,
      `maxhp ${creature.maxHp}`,
      `ac ${creature.ac}`,
      `speed ${creature.speed}`,
      `actions ${creature.actions.length}`,
      ...(creature.actions ?? []).flatMap((action) => [action.name, action.kind, action.actionCost, ...action.tags]),
      ...(creature.resources ?? []).map((resource) => resource.name),
      ...(creature.features ?? []).map((feature) => feature.name)
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

export function estimateEncounterBalance(creatures: Creature[]): EncounterBalanceSummary {
  const teamsSummary: Record<Team, EncounterBalanceTeamSummary> = {
    players: { team: 'players', count: 0, xp: 0, crLabels: [] },
    enemies: { team: 'enemies', count: 0, xp: 0, crLabels: [] },
    neutral: { team: 'neutral', count: 0, xp: 0, crLabels: [] }
  };

  creatures.forEach((creature) => {
    const estimate = estimateCreatureCR(creature, encounterBalanceCrOptions);
    const teamSummary = teamsSummary[creature.team];
    teamSummary.count += 1;
    teamSummary.xp += getCrXp(estimate.finalCr);
    teamSummary.crLabels.push(estimate.finalCr);
  });

  const playerXp = teamsSummary.players.xp;
  const enemyXp = teamsSummary.enemies.xp;
  const contestTotal = playerXp + enemyXp;

  if (contestTotal === 0) {
    return {
      teams: teamsSummary,
      leader: 'unopposed',
      ratio: 0,
      message: 'No player or enemy creatures placed yet.'
    };
  }

  if (playerXp === 0 || enemyXp === 0) {
    const leader = playerXp > enemyXp ? 'players' : 'enemies';
    return {
      teams: teamsSummary,
      leader: 'unopposed',
      ratio: 0,
      message: `${capitalizeTeam(leader)} are currently unopposed.`
    };
  }

  const strongerTeam: Team = playerXp >= enemyXp ? 'players' : 'enemies';
  const strongerXp = Math.max(playerXp, enemyXp);
  const weakerXp = Math.min(playerXp, enemyXp);
  const ratio = strongerXp / weakerXp;

  if (ratio <= 1.15) {
    return {
      teams: teamsSummary,
      leader: 'even',
      ratio,
      message: 'Roughly even by estimated CR weight.'
    };
  }

  const edge = ratio <= 1.5 ? 'slight edge' : ratio <= 2 ? 'clear advantage' : 'overwhelming advantage';
  return {
    teams: teamsSummary,
    leader: strongerTeam,
    ratio,
    message: `${capitalizeTeam(strongerTeam)} have a ${edge}.`
  };
}

function capitalizeTeam(team: Team): string {
  return team.charAt(0).toUpperCase() + team.slice(1);
}

function loadCreatureLibrary(): Creature[] {
  const stored = readJson<unknown>(CREATURE_LIBRARY_KEY);
  const imported = Array.isArray(stored) ? stored.map(coerceCreature).filter(isDefined) : [];
  return imported.length > 0 ? imported : sampleCreatures.map((creature) => normalizeCreatureDraft(cloneCreature(creature)));
}

function loadActionLibrary(): ActionDefinition[] {
  const stored = readJson<unknown>(ACTION_LIBRARY_KEY);
  return Array.isArray(stored) ? stored.map(coerceAction).filter(isDefined) : [];
}

function loadFeatureLibrary(): FeatureDefinition[] {
  const stored = readJson<unknown>(FEATURE_LIBRARY_KEY);
  return Array.isArray(stored) ? stored.map(coerceFeature).filter(isDefined) : [];
}

function loadResourceLibrary(): Resource[] {
  const stored = readJson<unknown>(RESOURCE_LIBRARY_KEY);
  return Array.isArray(stored) ? stored.map(coerceResource).filter(isDefined) : [];
}

function loadEncounterLibrary(): SavedEncounter[] {
  const stored = readJson<unknown>(ENCOUNTER_LIBRARY_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }

  return stored.map(coerceEncounter).filter(isDefined);
}

function parseCreatureImport(text: string): { ok: true; creatures: Creature[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    const source = isRecord(parsed) && Array.isArray(parsed.creatures) ? parsed.creatures : parsed;
    const values = Array.isArray(source) ? source : [source];
    const creatures = values.map(coerceCreature).filter(isDefined);
    if (creatures.length === 0) {
      return { ok: false, error: 'No valid creatures found in that JSON.' };
    }
    return { ok: true, creatures };
  } catch {
    return { ok: false, error: 'Invalid creature JSON.' };
  }
}

function parseEncounterImport(text: string, creatureLibrary: Creature[] = []): { ok: true; encounter: SavedEncounter } | { ok: false; error: string } {
  const combatResult = parseCombatStateJson(text);
  if (combatResult.ok && combatResult.state) {
    return {
      ok: true,
      encounter: {
        id: createId('imported-combat', 'encounter'),
        name: 'Imported Combat',
        grid: combatResult.state.grid,
        instances: combatResult.state.creatures.map((creature) => createEncounterInstanceFromCreature(creature, creatureLibrary)),
        updatedAt: new Date().toISOString()
      }
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const encounter = coerceEncounter(parsed);
    if (!encounter) {
      return { ok: false, error: 'No valid encounter found in that JSON.' };
    }
    return { ok: true, encounter: { ...encounter, id: encounter.id || createId(encounter.name, 'encounter') } };
  } catch {
    return { ok: false, error: 'Invalid encounter JSON.' };
  }
}

function coerceEncounter(value: unknown): SavedEncounter | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const legacyCreatures = Array.isArray(value.creatures) ? value.creatures.map(coerceCreature).filter(isDefined) : [];
  const instances = Array.isArray(value.instances)
    ? value.instances.map(coerceEncounterInstance).filter(isDefined)
    : legacyCreatures.map(createEncounterInstanceFromLegacyCreature);
  if (instances.length === 0) {
    return undefined;
  }

  return {
    id: typeof value.id === 'string' ? value.id : createId(String(value.name ?? 'encounter'), 'encounter'),
    name: typeof value.name === 'string' ? value.name : 'Imported Encounter',
    grid: normalizeGrid(isRecord(value.grid) ? (value.grid as Partial<GridDefinition>) : { width: 10, height: 10, blocked: [] }),
    instances,
    creatures: legacyCreatures.length > 0 ? legacyCreatures : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  };
}

function coerceEncounterInstance(value: unknown): SavedEncounterCreatureInstance | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const fallback = coerceCreature(value.fallback);
  const overrides = isRecord(value.overrides) ? cloneJson(value.overrides) as Partial<Creature> : {};
  const id = typeof value.id === 'string' ? value.id : typeof overrides.id === 'string' ? overrides.id : createId(fallback?.name ?? 'encounter-creature', 'encounter-creature');
  const templateId = typeof value.templateId === 'string' ? value.templateId : fallback?.id ?? id;
  return normalizeEncounterInstance({
    id,
    templateId,
    overrides,
    fallback
  });
}

function coerceCreature(value: unknown): Creature | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }

  const blank = createBlankCreature();
  const abilityScores = isRecord(value.abilityScores) ? value.abilityScores : {};
  const position = isRecord(value.position) ? value.position : {};
  const actions = Array.isArray(value.actions) ? value.actions.map(coerceAction).filter(isDefined) : blank.actions;
  const resources = Array.isArray(value.resources) ? value.resources.map(coerceResource).filter(isDefined) : undefined;

  return normalizeCreatureDraft({
    ...blank,
    id: typeof value.id === 'string' ? value.id : createId(value.name, 'creature'),
    name: value.name,
    team: isTeam(value.team) ? value.team : blank.team,
    hp: numberOr(value.hp, blank.hp),
    maxHp: numberOr(value.maxHp, numberOr(value.hp, blank.maxHp)),
    ac: numberOr(value.ac, blank.ac),
    abilityScores: coerceAbilityScores(abilityScores, blank.abilityScores),
    proficiencyBonus: numberOr(value.proficiencyBonus, blank.proficiencyBonus),
    speed: numberOr(value.speed, blank.speed),
    climbSpeed: numberOr(value.climbSpeed, blank.climbSpeed ?? 0),
    flySpeed: numberOr(value.flySpeed, blank.flySpeed ?? 0),
    position: {
      x: numberOr(position.x, blank.position.x),
      y: numberOr(position.y, blank.position.y),
      z: numberOr(position.z, blank.position.z ?? 0)
    },
    conditions: Array.isArray(value.conditions) ? cloneJson(value.conditions) : [],
    actions: actions.length ? actions : blank.actions,
    resources,
    features: Array.isArray(value.features) ? cloneJson(value.features) : undefined,
    skillBonuses: isRecord(value.skillBonuses) ? cloneJson(value.skillBonuses) : {}
  });
}

function coerceAction(value: unknown): ActionDefinition | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }

  return normalizeAction({
    ...createBlankAction(),
    ...cloneJson(value),
    id: typeof value.id === 'string' ? value.id : createId(value.name, 'action'),
    name: value.name
  });
}

function coerceResource(value: unknown): Resource | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }

  return normalizeResource({
    id: typeof value.id === 'string' ? value.id : createId(value.name, 'resource'),
    name: value.name,
    current: numberOr(value.current, 1),
    max: numberOr(value.max, 1),
    resetOn: resetOptions.includes(value.resetOn as ResourceReset) ? (value.resetOn as ResourceReset) : 'longRest',
    display: { showOnCreaturePanel: true, mode: 'pips' }
  });
}

function coerceFeature(value: unknown): FeatureDefinition | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return undefined;
  }

  return normalizeFeature({
    ...createBlankFeature(),
    ...cloneJson(value),
    id: typeof value.id === 'string' ? value.id : createId(value.name, 'feature'),
    name: value.name
  });
}

function coerceAbilityScores(source: Partial<Record<Ability, unknown>> | undefined, fallback: Creature['abilityScores']): Creature['abilityScores'] {
  return {
    str: numberOr(source?.str, fallback.str),
    dex: numberOr(source?.dex, fallback.dex),
    con: numberOr(source?.con, fallback.con),
    int: numberOr(source?.int, fallback.int),
    wis: numberOr(source?.wis, fallback.wis),
    cha: numberOr(source?.cha, fallback.cha)
  };
}

function createBlankFeature(): FeatureDefinition {
  return {
    id: createId('new-feature', 'feature'),
    name: 'New Feature',
    description: '',
    enabled: true,
    source: 'custom',
    rules: []
  };
}

function createBlankCreature(): Creature {
  return {
    id: createId('new-creature', 'creature'),
    name: 'New Creature',
    team: 'enemies',
    hp: 10,
    maxHp: 10,
    ac: 12,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    climbSpeed: 0,
    flySpeed: 0,
    position: { x: 0, y: 0, z: 0 },
    conditions: [],
    actions: [createBlankAction()],
    resources: [],
    features: [],
    skillBonuses: {}
  };
}

function createBlankAction(): ActionDefinition {
  return {
    id: createId('strike', 'action'),
    name: 'Strike',
    kind: 'meleeAttack',
    type: 'meleeAttack',
    actionCost: 'action',
    tags: ['attack', 'melee'],
    range: 1,
    reach: 5,
    attackBonus: 4,
    damage: { dice: '1d6+2', type: 'bludgeoning' },
    shape: { type: 'single' },
    effects: [],
    description: ''
  };
}

function createEncounterInstanceFromTemplate(template: Creature, position: GridPosition): SavedEncounterCreatureInstance {
  const id = createId(template.name, 'encounter-creature');
  return normalizeEncounterInstance({
    id,
    templateId: template.id,
    overrides: {
      id,
      position,
      conditions: []
    },
    fallback: cloneCreature(template)
  });
}

function createEncounterInstanceFromCreature(creature: Creature, creatureLibrary: Creature[]): SavedEncounterCreatureInstance {
  const template = findEncounterTemplate(
    {
      id: creature.id,
      templateId: creature.id,
      overrides: {},
      fallback: creature
    },
    creatureLibrary
  );
  const templateId = template?.id ?? creature.id;
  return normalizeEncounterInstance({
    id: creature.id,
    templateId,
    overrides: getEncounterOverridesFromCreature(creature, template),
    fallback: cloneCreature(creature)
  });
}

function createEncounterInstanceFromLegacyCreature(creature: Creature): SavedEncounterCreatureInstance {
  return normalizeEncounterInstance({
    id: creature.id,
    templateId: creature.id,
    overrides: getEncounterOverridesFromCreature(creature, creature),
    fallback: cloneCreature(creature)
  });
}

export function hydrateEncounterCreatures(
  instances: SavedEncounterCreatureInstance[],
  creatureLibrary: Creature[]
): { creatures: Creature[]; warnings: string[] } {
  const warnings: string[] = [];
  const creatures = instances.map((instance) => {
    const template = findEncounterTemplate(instance, creatureLibrary);
    const fallback = instance.fallback ? normalizeCreatureDraft(cloneCreature(instance.fallback)) : undefined;
    const source = template ?? fallback ?? createMissingTemplateCreature(instance);
    if (!template) {
      warnings.push(
        fallback
          ? `${fallback.name} is using saved fallback data because template "${instance.templateId}" was not found.`
          : `Encounter creature "${instance.id}" is missing template "${instance.templateId}".`
      );
    }

    const merged = {
      ...cloneCreature(source),
      ...cloneJson(instance.overrides),
      id: instance.id,
      position: instance.overrides.position ?? source.position,
      conditions: instance.overrides.conditions ?? [],
      resources: mergeEncounterResourceState(source.resources ?? [], instance.overrides.resources),
      readiedAction: instance.overrides.readiedAction
    } as Creature;
    return normalizeCreatureDraft(merged);
  });

  return { creatures, warnings };
}

function findEncounterTemplate(instance: SavedEncounterCreatureInstance, creatureLibrary: Creature[]): Creature | undefined {
  return (
    creatureLibrary.find((creature) => creature.id === instance.templateId) ??
    (instance.fallback ? creatureLibrary.find((creature) => creature.id === instance.fallback?.id) : undefined) ??
    (instance.fallback ? creatureLibrary.find((creature) => creature.name === instance.fallback?.name) : undefined)
  );
}

function createMissingTemplateCreature(instance: SavedEncounterCreatureInstance): Creature {
  return normalizeCreatureDraft({
    ...createBlankCreature(),
    id: instance.id,
    name: `Missing Template (${instance.templateId})`,
    position: instance.overrides.position ?? { x: 0, y: 0, z: 0 },
    conditions: instance.overrides.conditions ?? []
  });
}

function normalizeEncounterInstance(instance: SavedEncounterCreatureInstance): SavedEncounterCreatureInstance {
  const fallback = instance.fallback ? normalizeCreatureDraft(cloneCreature(instance.fallback)) : undefined;
  const id = toId(instance.id || instance.overrides.id || fallback?.id || 'encounter-creature');
  return {
    id,
    templateId: toId(instance.templateId || fallback?.id || id),
    overrides: normalizeEncounterOverrides({ ...instance.overrides, id }),
    fallback
  };
}

function mergeEncounterInstanceOverrides(instance: SavedEncounterCreatureInstance, update: Partial<Creature>): SavedEncounterCreatureInstance {
  return normalizeEncounterInstance({
    ...instance,
    overrides: normalizeEncounterOverrides({
      ...instance.overrides,
      ...update,
      position: update.position ? { ...instance.overrides.position, ...update.position } : instance.overrides.position
    })
  });
}

function getEncounterOverridesFromCreature(creature: Creature, template?: Creature): Partial<Creature> {
  const overrides: Partial<Creature> = {
    id: creature.id,
    position: cloneJson(creature.position),
    conditions: cloneJson(creature.conditions)
  };

  if (!template || creature.hp !== template.hp) {
    overrides.hp = creature.hp;
  }
  if (!template || creature.name !== template.name) {
    overrides.name = creature.name;
  }
  if (!template || creature.team !== template.team) {
    overrides.team = creature.team;
  }
  if (creature.readiedAction) {
    overrides.readiedAction = cloneJson(creature.readiedAction);
  }
  if (shouldPersistEncounterResources(creature.resources, template?.resources)) {
    overrides.resources = cloneJson(creature.resources);
  }
  return normalizeEncounterOverrides(overrides);
}

function shouldPersistEncounterResources(resources: Resource[] | undefined, templateResources: Resource[] | undefined): boolean {
  if (!resources || resources.length === 0) {
    return false;
  }

  if (!templateResources) {
    return true;
  }

  if (resources.length !== templateResources.length) {
    return true;
  }

  return resources.some((resource) => {
    const templateResource = templateResources.find((candidate) => candidate.id === resource.id);
    return !templateResource || templateResource.current !== resource.current;
  });
}

function mergeEncounterResourceState(templateResources: Resource[], overrideResources: Resource[] | undefined): Resource[] {
  if (!overrideResources) {
    return templateResources;
  }

  const overrideById = new Map(overrideResources.map((resource) => [resource.id, resource]));
  const merged = templateResources.map((resource) => {
    const override = overrideById.get(resource.id);
    return override ? { ...resource, current: override.current } : resource;
  });

  const templateIds = new Set(templateResources.map((resource) => resource.id));
  return [
    ...merged,
    ...overrideResources.filter((resource) => !templateIds.has(resource.id))
  ];
}

function normalizeEncounterOverrides(overrides: Partial<Creature>): Partial<Creature> {
  const normalized = cloneJson(overrides);
  delete normalized.actions;
  delete normalized.features;
  delete normalized.maxHp;
  delete normalized.ac;
  delete normalized.abilityScores;
  delete normalized.proficiencyBonus;
  delete normalized.speed;
  delete normalized.climbSpeed;
  delete normalized.flySpeed;
  if (normalized.id) {
    normalized.id = toId(normalized.id);
  }
  if (normalized.position) {
    normalized.position = {
      x: Math.max(0, numberOr(normalized.position.x, 0)),
      y: Math.max(0, numberOr(normalized.position.y, 0)),
      z: numberOr(normalized.position.z, 0)
    };
  }
  return normalized;
}

function normalizeCreatureDraft(creature: Creature): Creature {
  const maxHp = Math.max(1, numberOr(creature.maxHp, 1));
  return {
    ...creature,
    id: toId(creature.id || creature.name || 'creature'),
    name: creature.name.trim() || 'Unnamed Creature',
    hp: clamp(numberOr(creature.hp, maxHp), 0, maxHp),
    maxHp,
    ac: Math.max(0, numberOr(creature.ac, 10)),
    proficiencyBonus: numberOr(creature.proficiencyBonus, 2),
    speed: Math.max(0, numberOr(creature.speed, 30)),
    climbSpeed: Math.max(0, numberOr(creature.climbSpeed, 0)),
    flySpeed: Math.max(0, numberOr(creature.flySpeed, 0)),
    position: {
      x: Math.max(0, numberOr(creature.position?.x, 0)),
      y: Math.max(0, numberOr(creature.position?.y, 0)),
      z: numberOr(creature.position?.z, 0)
    },
    abilityScores: coerceAbilityScores(creature.abilityScores, createBlankCreature().abilityScores),
    conditions: Array.isArray(creature.conditions) ? cloneJson(creature.conditions) : [],
    actions: creature.actions.length ? creature.actions.map(normalizeAction) : [createBlankAction()],
    resources: (creature.resources ?? []).map(normalizeResource),
    features: (creature.features ?? []).map(normalizeFeature),
    skillBonuses: creature.skillBonuses ?? {}
  };
}

function normalizeAction(action: ActionDefinition): ActionDefinition {
  const kind = action.kind ?? action.type ?? 'custom';
  const type = kind === 'multiattack' || kind === 'basicAction'
    ? undefined
    : action.type ?? (kind === 'meleeAttack' || kind === 'rangedAttack' || kind === 'savingThrowEffect' ? kind : undefined);
  return {
    ...action,
    id: toId(action.id || action.name || 'action'),
    name: action.name.trim() || 'Unnamed Action',
    kind,
    type,
    actionCost: action.actionCost ?? 'action',
    tags: action.tags ?? inferTags(kind, []),
    range: Math.max(0, numberOr(action.range, 1)),
    effects: action.effects ?? [],
    shape: action.shape ?? { type: 'single' },
    rules: (action.rules ?? []).map(normalizeRule)
  };
}

function normalizeFeature(feature: FeatureDefinition): FeatureDefinition {
  return {
    ...feature,
    id: toId(feature.id || feature.name || 'feature'),
    name: feature.name?.trim() || 'Unnamed Feature',
    description: feature.description ?? '',
    enabled: feature.enabled !== false,
    source: feature.source ?? 'custom',
    rules: (feature.rules ?? []).map(normalizeRule)
  };
}

function normalizeResource(resource: Resource): Resource {
  const max = Math.max(0, numberOr(resource.max, 1));
  return {
    ...resource,
    id: toId(resource.id || resource.name || 'resource'),
    name: resource.name?.trim() || 'Unnamed Resource',
    max,
    current: clamp(numberOr(resource.current, max), 0, max),
    resetOn: resetOptions.includes(resource.resetOn) ? resource.resetOn : 'longRest',
    display: resource.display ?? { showOnCreaturePanel: true, mode: 'pips' }
  };
}

function normalizeRule(rule: RuleDefinition): RuleDefinition {
  return {
    ...rule,
    id: toId(rule.id || rule.name || 'rule'),
    name: rule.name?.trim() || undefined,
    enabled: rule.enabled !== false,
    trigger: rule.trigger ?? 'beforeAttackRoll',
    selectors: (rule.selectors ?? []).map((selector) => createBlankSelector(selector.type, selector)),
    filters: (rule.filters ?? []).map(normalizeFilter),
    effects: (rule.effects ?? []).map(normalizeEffect)
  };
}

function normalizeFilter(filter: RuleFilter): RuleFilter {
  return createBlankFilter(filter.type, filter);
}

function normalizeEffect(effect: RuleEffectOperation): RuleEffectOperation {
  return createBlankEffect(effect.type, effect);
}

function normalizeGrid(grid: Partial<GridDefinition>): GridDefinition {
  return normalizeGridDefinition(grid);
}

function setTileHeight(grid: GridDefinition, position: GridPosition, z: number): GridDefinition {
  const height = Math.round(numberOr(z, 0));
  const heights = (grid.heights ?? []).filter((cell) => !sameTilePosition(cell, position));
  return normalizeGrid({
    ...grid,
    heights: height === 0 ? heights : [...heights, { x: position.x, y: position.y, z: height }]
  });
}

function inferTags(kind: ActionKind, existing: ActionTag[]): ActionTag[] {
  const tags = new Set(existing);
  if (kind === 'meleeAttack') {
    tags.add('attack');
    tags.add('melee');
  } else if (kind === 'rangedAttack') {
    tags.add('attack');
    tags.add('ranged');
  } else if (kind === 'spell') {
    tags.add('spell');
  } else if (kind === 'savingThrowEffect') {
    tags.add('area');
  }
  return [...tags];
}

function parseTags(value: string): ActionTag[] {
  return parseCsv(value);
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function createBlankRule(update: Partial<RuleDefinition> = {}): RuleDefinition {
  return normalizeRule({
    id: createId('rule', 'rule'),
    name: 'New Hook',
    enabled: true,
    trigger: 'beforeAttackRoll',
    selectors: [{ type: 'source' }],
    filters: [],
    effects: [createBlankEffect()],
    ...update
  });
}

function createBlankSelector(type: TargetSelectorType = 'source', update: Partial<RuleTargetSelector> = {}): RuleTargetSelector {
  return {
    type,
    ...(type === 'alliesWithinRange' || type === 'enemiesWithinRange' ? { range: 10 } : {}),
    ...update
  };
}

function createBlankFilter(type: RuleFilterType = 'actionHasTag', update: Partial<RuleFilter> = {}): RuleFilter {
  if (type === 'actionHasTag') {
    return { tag: 'attack', ...update, type } as RuleFilter;
  }
  if (type === 'targetHasCondition' || type === 'sourceHasCondition') {
    return { conditionId: 'prone', ...update, type } as RuleFilter;
  }
  if (type === 'hpBelowHalf') {
    return { target: 'actionTarget', ...update, type } as RuleFilter;
  }
  if (type === 'resourceAvailable') {
    return { resourceId: '', amount: 1, target: 'source', ...update, type } as RuleFilter;
  }
  if (type === 'oncePerTurn' || type === 'oncePerRound') {
    return { ...update, type } as RuleFilter;
  }
  return { type: 'actionHasTag', tag: 'attack' };
}

function createBlankEffect(type: EffectOperationType = 'addFlatModifier', update: Partial<RuleEffectOperation> = {}): RuleEffectOperation {
  if (type === 'addFlatModifier') {
    return { amount: 1, ...update, type } as RuleEffectOperation;
  }
  if (type === 'grantAdvantage' || type === 'grantDisadvantage') {
    return { ...update, type } as RuleEffectOperation;
  }
  if (type === 'addDamageDice') {
    return { dice: '1d6', ...update, type } as RuleEffectOperation;
  }
  if (type === 'dealDamage') {
    return { dice: '1d6', damageType: 'fire', ...update, type } as RuleEffectOperation;
  }
  if (type === 'multiplyDamage') {
    return { factor: 2, ...update, type } as RuleEffectOperation;
  }
  if (type === 'multiplyMovementCost') {
    return { factor: 2, ...update, type } as RuleEffectOperation;
  }
  if (type === 'reduceDamage' || type === 'setDamageMinimum') {
    return { amount: 1, ...update, type } as RuleEffectOperation;
  }
  if (type === 'applyCondition') {
    return { conditionId: 'prone', ...update, type } as RuleEffectOperation;
  }
  if (type === 'removeCondition') {
    return { conditionId: 'prone', ...update, type } as RuleEffectOperation;
  }
  if (type === 'spendResource' || type === 'restoreResource') {
    return { resourceId: '', amount: 1, ...update, type } as RuleEffectOperation;
  }
  if (type === 'addTag' || type === 'removeTag') {
    return { tag: 'attack', ...update, type } as RuleEffectOperation;
  }
  if (type === 'logMessage') {
    return { message: '{source} uses {action}.', ...update, type } as RuleEffectOperation;
  }
  return { type: 'addFlatModifier', amount: 1 };
}

function getReferenceConditionSelectionId(template: CustomConditionTemplate): string {
  return `reference:${template.id}`;
}

function cleanStatModifiers(modifiers: StatModifiers): StatModifiers | undefined {
  const cleaned: StatModifiers = {};
  if (modifiers.ac) {
    cleaned.ac = modifiers.ac;
  }
  if (modifiers.speed) {
    cleaned.speed = modifiers.speed;
  }
  if (modifiers.climbSpeed) {
    cleaned.climbSpeed = modifiers.climbSpeed;
  }
  if (modifiers.flySpeed) {
    cleaned.flySpeed = modifiers.flySpeed;
  }
  if (modifiers.attackBonus) {
    cleaned.attackBonus = modifiers.attackBonus;
  }
  if (modifiers.maxHp) {
    cleaned.maxHp = modifiers.maxHp;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function updateArray<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function removeArrayItem<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function formatEditorActionCost(actionCost: ActionCost): string {
  if (actionCost === 'bonusAction') {
    return 'Bonus Action';
  }
  return actionCost.charAt(0).toUpperCase() + actionCost.slice(1);
}

function mergeCreatures(current: Creature[], imported: Creature[]): Creature[] {
  return imported.reduce((next, creature) => upsertById(next, creature), current);
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((candidate) => candidate.id === item.id)
    ? items.map((candidate) => (candidate.id === item.id ? item : candidate))
    : [item, ...items];
}

function cloneCreature(creature: Creature): Creature {
  return cloneJson(creature);
}

function cloneAction(action: ActionDefinition): ActionDefinition {
  return cloneJson(action);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readJson<T>(key: string): T | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function saveJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function createId(name: string, prefix: string): string {
  return `${prefix}-${toId(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  );
}

function getCreatureShortLabel(creature: Creature): string {
  const words = creature.name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return creature.name.slice(0, 2).toUpperCase();
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTeam(value: unknown): value is Team {
  return teams.includes(value as Team);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
