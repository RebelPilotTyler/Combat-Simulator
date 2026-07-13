import { useEffect, useMemo, useRef, useState } from 'react';
import { EncounterEditor } from './EncounterEditor';
import { createSampleEncounter } from './data/sampleEncounter';
import {
  BASIC_ACTIONS,
  applyHpChange,
  applyCondition,
  endTurn,
  findCreature,
  getActionShapeSquares,
  getAttackDebugStats,
  isDefeated,
  moveActiveCreature,
  performDisengageAction,
  performGrappleAction,
  performHelpAction,
  performHideAction,
  performImprovisedAction,
  performAttackAction,
  performBasicAction,
  performCreatureUtilityAction,
  performMultiattackAction,
  performReadyAction,
  performSearchAction,
  performShoveAction,
  performSavingThrowAction,
  performUseObjectAction,
  removeCondition,
  resolvePendingReaction,
  rollInitiative,
  type BasicActionName,
  type HelpMode,
  type SearchMode,
  type ShoveOutcome
} from './engine/combat';
import { ALL_CONDITION_IDS, getConditionDefinition, getConditionLabel } from './engine/conditions';
import { getAvailableActions, getEffectiveAC, getEffectiveAttackBonus, getEffectiveSpeed, getUnavailableActionReason } from './engine/features';
import { getReachableMovementSquares } from './engine/movement';
import { formatBaseEffectiveBonus, formatBaseEffectiveNumber, getConditionTags, getHpPercent } from './engine/presentation';
import { parseCombatStateJson, serializeCombatState } from './engine/serialization';
import { getShapeSquares, isInBounds, positionKey, samePosition } from './engine/shapes';
import { getDistanceFeet, getLineSquares, hasLineOfSight } from './engine/targeting';
import type { Ability, ActionDefinition, CardinalDirection, CombatState, Creature, GridPosition, ShapeDefinition, TurnState } from './engine/types';
import { getActionForNumberHotkey, getNumberHotkeyIndex, isTypingShortcutTarget, moveGridCursor } from './ui/keyboard';

const directions: CardinalDirection[] = ['north', 'east', 'south', 'west'];
type SelectionMode = 'move' | 'target';
type AppView = 'combat' | 'editor';
type MapTool = 'select' | 'distance' | 'lineOfSight' | 'radius' | 'line' | 'cone';
type UiTheme = 'slate' | 'parchment' | 'midnight';
type TextScale = 'compact' | 'normal' | 'large';
type UiDensity = 'comfortable' | 'compact';

interface UiSettings {
  theme: UiTheme;
  textScale: TextScale;
  density: UiDensity;
  shortcutsEnabled: boolean;
  showShortcutHints: boolean;
  showAdvancedTools: boolean;
  showMapTools: boolean;
  showGridCoordinates: boolean;
}

const UI_SETTINGS_KEY = 'dnd5e-combat.uiSettings.v1';

export function App() {
  const [uiSettings, setUiSettings] = useState<UiSettings>(loadUiSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('combat');
  const [combat, setCombat] = useState<CombatState>(() => createSampleEncounter());
  const [selectedCreatureId, setSelectedCreatureId] = useState<string | undefined>(combat.creatures[0]?.id);
  const [selectedActionId, setSelectedActionId] = useState<string | undefined>();
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>();
  const [areaOrigin, setAreaOrigin] = useState<GridPosition | undefined>();
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('move');
  const [conditionToApply, setConditionToApply] = useState<string>('poisoned');
  const [basicTargetId, setBasicTargetId] = useState<string | undefined>();
  const [basicNote, setBasicNote] = useState('');
  const [readyActionId, setReadyActionId] = useState<string | undefined>();
  const [readyTrigger, setReadyTrigger] = useState('');
  const [helpMode, setHelpMode] = useState<HelpMode>('ally');
  const [searchMode, setSearchMode] = useState<SearchMode>('perception');
  const [shoveOutcome, setShoveOutcome] = useState<ShoveOutcome>('prone');
  const [improvisedAbility, setImprovisedAbility] = useState<Ability | ''>('');
  const [hpAmount, setHpAmount] = useState(5);
  const [attackDebugStats, setAttackDebugStats] = useState<ReturnType<typeof getAttackDebugStats> | undefined>();
  const [direction, setDirection] = useState<CardinalDirection>('east');
  const [mapTool, setMapTool] = useState<MapTool>('select');
  const [mapToolStart, setMapToolStart] = useState<GridPosition | undefined>();
  const [mapToolEnd, setMapToolEnd] = useState<GridPosition | undefined>();
  const [mapToolDirection, setMapToolDirection] = useState<CardinalDirection>('east');
  const [mapToolRadiusFeet, setMapToolRadiusFeet] = useState(10);
  const [mapToolLengthFeet, setMapToolLengthFeet] = useState(30);
  const [gridCellSize, setGridCellSize] = useState(40);
  const [jsonText, setJsonText] = useState(() => serializeCombatState(createSampleEncounter()));
  const [jsonError, setJsonError] = useState<string | undefined>();
  const [multiattackTargets, setMultiattackTargets] = useState<Record<string, string>>({});
  const [actionTab, setActionTab] = useState<ActionDefinition['actionCost']>('action');
  const [gridCursor, setGridCursor] = useState<GridPosition>(combat.creatures[0]?.position ?? { x: 0, y: 0 });
  const [debugOpen, setDebugOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const targetPanelRef = useRef<HTMLDivElement>(null);
  const debugDetailsRef = useRef<HTMLDetailsElement>(null);
  const toolsDetailsRef = useRef<HTMLDetailsElement>(null);

  const activeCreature = combat.activeCreatureId ? findCreature(combat, combat.activeCreatureId) : undefined;
  const selectedCreature = selectedCreatureId ? findCreature(combat, selectedCreatureId) : undefined;
  const activeCreatureActions = activeCreature ? getAvailableActions(activeCreature, combat) : [];
  const activeActions = useMemo(() => activeCreatureActions, [activeCreatureActions]);
  const selectedAction = activeActions.find((action) => action.id === selectedActionId);
  const movementOptions = useMemo(
    () => (activeCreature ? getReachableMovementSquares(combat, activeCreature.id) : []),
    [activeCreature, combat]
  );

  const highlightedSquares = useMemo(() => {
    if (!activeCreature || !selectedAction) {
      return selectionMode === 'move' ? movementOptions.map((option) => option.position) : [];
    }

    const origin = getShapeOrigin(selectedAction, activeCreature.position, areaOrigin);
    return getActionShapeSquares(combat, selectedAction, origin, direction);
  }, [activeCreature, areaOrigin, combat, direction, movementOptions, selectedAction, selectionMode]);

  const highlightedKeys = new Set(highlightedSquares.map(positionKey));
  const mapToolSquares = useMemo(
    () =>
      uiSettings.showMapTools
        ? getMapToolSquares(combat, mapTool, mapToolStart, mapToolEnd, mapToolDirection, mapToolRadiusFeet, mapToolLengthFeet)
        : [],
    [combat, mapTool, mapToolDirection, mapToolEnd, mapToolLengthFeet, mapToolRadiusFeet, mapToolStart, uiSettings.showMapTools]
  );
  const mapToolKeys = new Set(mapToolSquares.map(positionKey));
  const movementKeys = new Set(movementOptions.map((option) => positionKey(option.position)));
  const targetsInArea =
    activeCreature && selectedAction
      ? getTargetsForAction(combat, activeCreature, selectedAction, selectedTargetId, areaOrigin, direction)
      : [];
  const selectedTarget = selectedTargetId ? findCreature(combat, selectedTargetId) : undefined;
  const selectedAttackDebug =
    selectedAction && selectedTarget && activeCreature && isAttackAction(selectedAction)
      ? getAttackDebugStats(combat, selectedAction.id, selectedTarget.id, 0)
      : undefined;
  const keyboardHint = getKeyboardHint(selectionMode, selectedAction, gridCursor, combat);
  const mapToolResult = uiSettings.showMapTools ? getMapToolResult(combat, mapTool, mapToolStart, mapToolEnd, mapToolSquares) : '';

  useEffect(() => {
    if (activeCreature) {
      setGridCursor(activeCreature.position);
    }
  }, [activeCreature?.id]);

  useEffect(() => {
    saveUiSettings(uiSettings);
  }, [uiSettings]);

  useEffect(() => {
    if (activeView !== 'combat') {
      return;
    }
    if (!uiSettings.shortcutsEnabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (showHelp && event.key === 'Escape') {
        event.preventDefault();
        setShowHelp(false);
        return;
      }

      if (isTypingShortcutTarget(event.target as HTMLElement | null)) {
        return;
      }

      const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (targetTag === 'button' && (event.key === ' ' || event.key === 'Enter')) {
        return;
      }

      const key = event.key.toLowerCase();
      const numberIndex = getNumberHotkeyIndex(event.key);

      if (numberIndex !== undefined) {
        const action = getActionForNumberHotkey(activeActions, event.key, event);
        if (action && activeCreature && !getActionDisabledReason(activeCreature, action, combat.turnState)) {
          event.preventDefault();
          setActionTab(action.actionCost);
          handleCreatureActionSelect(action);
        }
        return;
      }

      if (event.key === ' ' || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
      }

      if (event.key === ' ') {
        setCombat((current) => endTurn(current));
      } else if (key === 'r') {
        setCombat((current) => rollInitiative(current));
      } else if (key === 'm') {
        resetTargeting();
        gridRef.current?.focus();
      } else if (event.key === 'Escape') {
        cancelSelection();
      } else if (key === 'l') {
        logRef.current?.focus();
      } else if (key === 'g') {
        gridRef.current?.focus();
      } else if (key === 't') {
        targetPanelRef.current?.focus();
      } else if (key === 'd') {
        setDebugOpen((current) => !current);
        setTimeout(() => debugDetailsRef.current?.focus(), 0);
      } else if (key === 'i') {
        setToolsOpen((current) => !current);
        setTimeout(() => toolsDetailsRef.current?.focus(), 0);
      } else if (key === '?' || key === 'h') {
        setShowHelp(true);
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        setGridCursor((current) => moveGridCursor(current, event.key, combat.grid.width, combat.grid.height));
      } else if (event.key === 'Enter') {
        handleGridConfirm();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    actionTab,
    activeView,
    activeActions,
    activeCreature,
    combat,
    gridCursor,
    selectedAction,
    selectedTargetId,
    selectionMode,
    showHelp,
    multiattackTargets,
    uiSettings.shortcutsEnabled,
    uiSettings.showMapTools
  ]);

  function resetTargeting(actionId?: string) {
    setSelectedActionId(actionId);
    setSelectedTargetId(undefined);
    setMultiattackTargets({});
    setAreaOrigin(undefined);
    setSelectionMode(actionId ? 'target' : 'move');
  }

  function cancelSelection() {
    if (uiSettings.showMapTools && mapTool !== 'select') {
      clearMapToolMeasurement();
      return;
    }
    resetTargeting();
  }

  function handleCreatureActionSelect(action: ActionDefinition) {
    if (isUtilityAction(action)) {
      setCombat((current) => performCreatureUtilityAction(current, action.id));
    } else {
      resetTargeting(action.id);
      targetPanelRef.current?.focus();
    }
  }

  function handleGridConfirm() {
    if (uiSettings.showMapTools && mapTool !== 'select') {
      handleMapToolCell(gridCursor);
      return;
    }

    const creature = combat.creatures.find((candidate) => samePosition(candidate.position, gridCursor));

    if (selectionMode === 'move' && activeCreature && movementKeys.has(positionKey(gridCursor))) {
      setCombat((current) => moveActiveCreature(current, gridCursor));
      setSelectedCreatureId(activeCreature.id);
      return;
    }

    if (selectedAction && creature && creature.id !== activeCreature?.id) {
      setSelectedCreatureId(creature.id);
      setBasicTargetId(creature.id);

      if (isMultiattackAction(selectedAction)) {
        const nextStep = getNextUnassignedMultiattackStep(selectedAction, multiattackTargets);
        setSelectedTargetId((current) => current ?? creature.id);
        if (nextStep) {
          setMultiattackTargets((current) => ({
            ...current,
            [nextStep.id]: creature.id
          }));
          setAreaOrigin(creature.position);
          return;
        }

        if (areMultiattackTargetsComplete(selectedAction, multiattackTargets, selectedTargetId)) {
          applySelectedAction();
        }
        return;
      }

      if (selectedTargetId === creature.id) {
        applySelectedAction();
      } else if (selectedAction.shape?.type === 'single' || isMultiattackAction(selectedAction)) {
        setSelectedTargetId(creature.id);
        setAreaOrigin(creature.position);
      }
      return;
    }

    if (selectedAction && isMultiattackAction(selectedAction) && areMultiattackTargetsComplete(selectedAction, multiattackTargets, selectedTargetId)) {
      applySelectedAction();
      return;
    }

    if (selectedAction?.type === 'savingThrowEffect') {
      if (areaOrigin && samePosition(areaOrigin, gridCursor)) {
        applySelectedAction();
      } else {
        setAreaOrigin(gridCursor);
      }
      return;
    }

    handleCellClick(gridCursor);
  }

  function handleCellClick(position: GridPosition) {
    if (uiSettings.showMapTools && mapTool !== 'select') {
      handleMapToolCell(position);
      return;
    }

    if (selectionMode === 'move' && activeCreature && movementKeys.has(positionKey(position))) {
      setCombat((current) => moveActiveCreature(current, position));
      setSelectedCreatureId(activeCreature.id);
      return;
    }

    const creature = combat.creatures.find((candidate) => samePosition(candidate.position, position));
    if (creature) {
      setSelectedCreatureId(creature.id);
      setBasicTargetId(creature.id);
      if (selectedAction && isMultiattackAction(selectedAction)) {
        const nextStep = getNextUnassignedMultiattackStep(selectedAction, multiattackTargets);
        setSelectedTargetId((current) => current ?? creature.id);
        if (nextStep) {
          setMultiattackTargets((current) => ({
            ...current,
            [nextStep.id]: creature.id
          }));
        }
        setAreaOrigin(creature.position);
        return;
      }
      if (selectedAction && (selectedAction.shape?.type === 'single' || isMultiattackAction(selectedAction))) {
        setSelectedTargetId(creature.id);
        setAreaOrigin(creature.position);
      }
      return;
    }

    if (selectedAction?.type === 'savingThrowEffect') {
      setAreaOrigin(position);
    }
  }

  function selectMapTool(tool: MapTool) {
    setMapTool(tool);
    if (tool === 'select') {
      clearMapToolMeasurement();
      return;
    }

    setMapToolStart((current) => current ?? gridCursor);
    setMapToolEnd((current) => current ?? gridCursor);
  }

  function clearMapToolMeasurement() {
    setMapToolStart(undefined);
    setMapToolEnd(undefined);
  }

  function handleMapToolCell(position: GridPosition) {
    if (!mapToolStart) {
      setMapToolStart(position);
      setMapToolEnd(position);
      return;
    }

    if (mapToolEnd && samePosition(mapToolStart, position) && samePosition(mapToolEnd, position)) {
      setMapToolStart(position);
      setMapToolEnd(undefined);
      return;
    }

    setMapToolEnd(position);
  }

  function handleBasicAction(actionName: BasicActionName) {
    if (!activeCreature || combat.turnState.actionUsed) {
      return;
    }

    if (actionName === 'Attack') {
      setSelectionMode('target');
      return;
    }

    if (actionName === 'Cast a Spell') {
      const spellLikeAction = activeActions.find((action) => action.tags.includes('spell') || action.kind === 'spell');
      resetTargeting(spellLikeAction?.id);
      return;
    }

    if (actionName === 'Dash' || actionName === 'Dodge') {
      setCombat((current) => performBasicAction(current, actionName));
      return;
    }

    if (actionName === 'Disengage') {
      setCombat((current) => performDisengageAction(current));
      return;
    }

    if (actionName === 'Help' && basicTargetId) {
      setCombat((current) => performHelpAction(current, basicTargetId, helpMode));
      return;
    }

    if (actionName === 'Hide') {
      setCombat((current) => performHideAction(current));
      return;
    }

    if (actionName === 'Ready') {
      const actionId = readyActionId ?? activeActions[0]?.id;
      if (actionId) {
        setCombat((current) => performReadyAction(current, actionId, readyTrigger));
      }
      return;
    }

    if (actionName === 'Search') {
      setCombat((current) => performSearchAction(current, searchMode));
      return;
    }

    if (actionName === 'Use an Object') {
      setCombat((current) => performUseObjectAction(current, basicNote));
      return;
    }

    if (actionName === 'Grapple' && basicTargetId) {
      setCombat((current) => performGrappleAction(current, basicTargetId));
      return;
    }

    if (actionName === 'Shove' && basicTargetId) {
      setCombat((current) => performShoveAction(current, basicTargetId, shoveOutcome));
      return;
    }

    if (actionName === 'Improvised Action') {
      setCombat((current) => performImprovisedAction(current, basicNote, improvisedAbility || undefined));
      return;
    }

    setCombat((current) => performBasicAction(current, actionName));
  }

  function applySelectedAction() {
    if (!activeCreature || !selectedAction) {
      return;
    }

    const rulesKind = selectedAction.type ?? selectedAction.kind;
    if (rulesKind === 'multiattack') {
      setCombat((current) =>
        performMultiattackAction(current, selectedAction.id, {
          targetId: selectedTargetId,
          stepTargets: multiattackTargets
        })
      );
      return;
    }

    if (rulesKind === 'meleeAttack' || rulesKind === 'rangedAttack') {
      if (!selectedTargetId) {
        return;
      }

      setCombat((current) => performAttackAction(current, selectedAction.id, selectedTargetId));
      return;
    }

    const targets = getTargetsForAction(combat, activeCreature, selectedAction, selectedTargetId, areaOrigin, direction);
    if (targets.length === 0) {
      return;
    }

    setCombat((current) =>
      performSavingThrowAction(
        current,
        selectedAction.id,
        targets.map((target) => target.id)
      )
    );
  }

  function loadJson() {
    const result = parseCombatStateJson(jsonText);
    if (!result.ok || !result.state) {
      setJsonError(result.error ?? 'Invalid combat JSON.');
      return;
    }

    setCombat(result.state);
    setSelectedCreatureId(result.state.activeCreatureId ?? result.state.creatures[0]?.id);
    resetTargeting();
    setJsonError(undefined);
  }

  function loadSample() {
    const sample = createSampleEncounter();
    setCombat(sample);
    setSelectedCreatureId(sample.creatures[0]?.id);
    resetTargeting();
    setJsonText(serializeCombatState(sample));
    setJsonError(undefined);
  }

  function exportCurrent() {
    setJsonText(serializeCombatState(combat));
    setJsonError(undefined);
  }

  function downloadJson() {
    const blob = new Blob([serializeCombatState(combat)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `combat-state-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadJson(file: File | undefined) {
    if (!file) {
      return;
    }

    const text = await file.text();
    setJsonText(text);
    const result = parseCombatStateJson(text);
    if (!result.ok || !result.state) {
      setJsonError(result.error ?? 'Invalid combat JSON.');
      return;
    }

    setCombat(result.state);
    setSelectedCreatureId(result.state.activeCreatureId ?? result.state.creatures[0]?.id);
    resetTargeting();
    setJsonError(undefined);
  }

  function loadEncounterFromEditor(state: CombatState) {
    setCombat(state);
    setSelectedCreatureId(state.activeCreatureId ?? state.creatures[0]?.id);
    resetTargeting();
    setJsonText(serializeCombatState(state));
    setJsonError(undefined);
    setActiveView('combat');
  }

  function updateUiSettings(update: Partial<UiSettings>) {
    setUiSettings((current) => ({ ...current, ...update }));
  }

  function toggleMapTools() {
    const nextShowMapTools = !uiSettings.showMapTools;
    updateUiSettings({ showMapTools: nextShowMapTools });
    if (!nextShowMapTools) {
      setMapTool('select');
      clearMapToolMeasurement();
    }
  }

  return (
    <main className={['app-shell', `theme-${uiSettings.theme}`, `text-${uiSettings.textScale}`, `density-${uiSettings.density}`].join(' ')}>
      <header className="top-bar">
        <div className="brand-block">
          <h1>Combat Sandbox</h1>
          <p>Round {combat.round || '-'} · {activeCreature?.name ?? 'No active creature'}</p>
        </div>
        <div className="top-actions">
          <button className={activeView === 'combat' ? 'selected-action' : ''} onClick={() => setActiveView('combat')}>
            Combat
          </button>
          <button className={activeView === 'editor' ? 'selected-action' : ''} onClick={() => setActiveView('editor')}>
            Editor
          </button>
          <button onClick={() => setCombat((current) => rollInitiative(current))}>Roll Initiative</button>
          <button onClick={() => setCombat((current) => endTurn(current))}>End Turn / Next Turn</button>
          <button onClick={loadSample}>Load Sample</button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      {activeView === 'combat' ? (
      <section className="cockpit-layout">
        <aside className="panel left-rail" tabIndex={0} aria-label="Initiative and creature list">
          <div className="round-card">
            <strong>Round {combat.round || '-'}</strong>
            <span>{activeCreature?.name ?? 'No initiative'}</span>
          </div>
          <h2>Initiative</h2>
          <section className="initiative-tracker">
            {combat.initiative.length === 0 && <span>No initiative yet.</span>}
            {combat.initiative.map((entry) => {
              const creature = findCreature(combat, entry.creatureId);
              return (
                <button
                  className={[
                    'initiative-item',
                    creature.id === combat.activeCreatureId ? 'active-initiative' : '',
                    isDefeated(creature) ? 'defeated-initiative' : ''
                  ].join(' ')}
                  key={entry.creatureId}
                  onClick={() => setSelectedCreatureId(creature.id)}
                  title={getConditionLabels(creature)}
                >
                  <strong>{creature.name}</strong>
                  <HpBar creature={creature} compact />
                  <span>
                    HP {creature.hp}/{creature.maxHp}
                  </span>
                  <ConditionTags creature={creature} />
                </button>
              );
            })}
          </section>

          <h2>Creatures</h2>
          <section className="creature-roster">
            {combat.creatures.map((creature) => (
              <button
                className={[
                  'roster-item',
                  creature.id === selectedCreatureId ? 'selected-action' : '',
                  creature.id === combat.activeCreatureId ? 'active-roster' : '',
                  isDefeated(creature) ? 'defeated-initiative' : ''
                ].join(' ')}
                key={creature.id}
                onClick={() => setSelectedCreatureId(creature.id)}
                title={getConditionLabels(creature)}
              >
                <span className={`team-dot ${creature.team}`} />
                <strong>{getCreatureShortLabel(creature)}</strong>
                <span>{creature.name}</span>
                <span>
                  {creature.hp}/{creature.maxHp}
                </span>
                <ConditionTags creature={creature} compact />
              </button>
            ))}
          </section>

          {combat.pendingReactions.length > 0 && (
            <section className="reaction-prompts">
              <strong>Pending Reactions</strong>
              {combat.pendingReactions.map((reaction) => (
                <span className="reaction-prompt" key={reaction.id}>
                  {reaction.description}
                  <button onClick={() => setCombat((current) => resolvePendingReaction(current, reaction.id, true))}>Use</button>
                  <button onClick={() => setCombat((current) => resolvePendingReaction(current, reaction.id, false))}>Skip</button>
                </span>
              ))}
            </section>
          )}
        </aside>

        <section className="layout">
        <section className="panel board-panel" aria-label="Battle grid panel">
          <div className="map-toolbar">
            <div className="map-toolbar-row">
              <strong>Battlemap</strong>
              <span>
                {combat.grid.width} x {combat.grid.height}
              </span>
              <label>
                Cell
                <input
                  max={64}
                  min={24}
                  step={4}
                  type="range"
                  value={gridCellSize}
                  onChange={(event) => setGridCellSize(Number(event.target.value))}
                />
                <span>{gridCellSize}px</span>
              </label>
              <button className={uiSettings.showMapTools ? 'selected-action' : ''} onClick={toggleMapTools}>
                {uiSettings.showMapTools ? 'Hide Measure Tools' : 'Show Measure Tools'}
              </button>
              <button
                className={uiSettings.showGridCoordinates ? 'selected-action' : ''}
                onClick={() => updateUiSettings({ showGridCoordinates: !uiSettings.showGridCoordinates })}
              >
                {uiSettings.showGridCoordinates ? 'Hide Coordinates' : 'Show Coordinates'}
              </button>
            </div>
            {uiSettings.showMapTools && (
              <>
                <div className="map-toolbar-row">
                  {(['select', 'distance', 'lineOfSight', 'radius', 'line', 'cone'] as const).map((tool) => (
                    <button
                      className={mapTool === tool ? 'selected-action' : ''}
                      key={tool}
                      onClick={() => selectMapTool(tool)}
                    >
                      {formatMapToolLabel(tool)}
                    </button>
                  ))}
                  <button onClick={clearMapToolMeasurement} disabled={mapToolStart === undefined && mapToolEnd === undefined}>
                    Clear
                  </button>
                </div>
                {mapTool !== 'select' && (
                  <div className="map-toolbar-row map-tool-options">
                    {(mapTool === 'radius' || mapTool === 'line' || mapTool === 'cone') && (
                      <label>
                        {mapTool === 'radius' ? 'Radius' : 'Length'}
                        <input
                          min={5}
                          step={5}
                          type="number"
                          value={mapTool === 'radius' ? mapToolRadiusFeet : mapToolLengthFeet}
                          onChange={(event) =>
                            mapTool === 'radius'
                              ? setMapToolRadiusFeet(Math.max(5, Number(event.target.value)))
                              : setMapToolLengthFeet(Math.max(5, Number(event.target.value)))
                          }
                        />
                        ft
                      </label>
                    )}
                    {(mapTool === 'line' || mapTool === 'cone') && (
                      <span className="direction-buttons">
                        {directions.map((candidate) => (
                          <button
                            className={candidate === mapToolDirection ? 'selected-action' : ''}
                            key={candidate}
                            onClick={() => setMapToolDirection(candidate)}
                          >
                            {candidate}
                          </button>
                        ))}
                      </span>
                    )}
                    <span className="map-tool-readout">{mapToolResult}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div
            aria-label="Battle grid"
            className="grid-board"
            ref={gridRef}
            role="grid"
            tabIndex={0}
            title="Grid focused. Use arrow keys to move the cursor and Enter to select."
            style={{ gridTemplateColumns: `repeat(${combat.grid.width}, ${gridCellSize}px)` }}
          >
            {Array.from({ length: combat.grid.height }).flatMap((_, y) =>
              Array.from({ length: combat.grid.width }).map((_, x) => {
                const position = { x, y };
                const creature = combat.creatures.find((candidate) => samePosition(candidate.position, position));
                const blocked = combat.grid.blocked.some((cell) => samePosition(cell, position));
                const movement = selectionMode === 'move' && movementKeys.has(positionKey(position));
                const highlighted = highlightedKeys.has(positionKey(position));
                const toolHighlighted = uiSettings.showMapTools && mapToolKeys.has(positionKey(position));
                const active = creature?.id === combat.activeCreatureId;
                const selected = creature?.id === selectedCreatureId;
                const cursor = samePosition(gridCursor, position);
                const toolStart = uiSettings.showMapTools && mapToolStart ? samePosition(mapToolStart, position) : false;
                const toolEnd = uiSettings.showMapTools && mapToolEnd ? samePosition(mapToolEnd, position) : false;

                return (
                  <button
                    aria-label={`Grid ${x},${y}${creature ? ` ${creature.name}` : ''}${blocked ? ' blocked' : ''}`}
                    className={[
                      'grid-cell',
                      blocked ? 'blocked' : '',
                      highlighted ? 'highlighted' : '',
                      toolHighlighted ? 'tool-highlighted' : '',
                      movement ? 'movement-cell' : '',
                      active ? 'active-cell' : '',
                      selected ? 'selected-cell' : '',
                      toolStart ? 'tool-start-cell' : '',
                      toolEnd ? 'tool-end-cell' : '',
                      cursor ? 'keyboard-cursor' : ''
                    ].join(' ')}
                    key={positionKey(position)}
                    onClick={() => handleCellClick(position)}
                    style={{ height: gridCellSize, width: gridCellSize }}
                  >
                    {uiSettings.showGridCoordinates && <span className="coord">{x},{y}</span>}
                    {creature && (
                      <span className="token-stack" title={`${creature.name} HP ${creature.hp}/${creature.maxHp} ${getConditionLabels(creature)}`}>
                        <span className={`token ${creature.team} ${isDefeated(creature) ? 'defeated' : ''}`}>
                          {getCreatureShortLabel(creature)}
                        </span>
                        <HpBar creature={creature} compact />
                        <ConditionTags creature={creature} compact />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <aside className="panel side-panel" tabIndex={0} aria-label="Active creature and actions">
          <h2>Active Creature</h2>
          {activeCreature ? (
            <>
              <CreatureSummary creature={activeCreature} state={combat} />
              <div className="turn-state">
                <span>Movement: {combat.turnState.remainingMovement} ft</span>
                <span>Action used: {combat.turnState.actionUsed ? 'yes' : 'no'}</span>
                <span>Bonus action used: {combat.turnState.bonusActionUsed ? 'yes' : 'no'}</span>
                <span>Reaction used: {combat.turnState.reactionUsed ? 'yes' : 'no'}</span>
              </div>
              <div className="mode-actions">
                <button className={selectionMode === 'move' ? 'selected-action' : ''} onClick={() => resetTargeting()}>
                  Move
                </button>
                <button onClick={cancelSelection}>Cancel Selection</button>
              </div>
              {uiSettings.showShortcutHints && <p className="keyboard-hint">{keyboardHint}</p>}

              <h3>Basic Actions</h3>
              <div className="action-list">
                {BASIC_ACTIONS.map((actionName) => (
                  <button
                    disabled={combat.turnState.actionUsed}
                    key={actionName}
                    title={getBasicActionDescription(actionName)}
                    onClick={() => handleBasicAction(actionName)}
                  >
                    {actionName}
                  </button>
                ))}
              </div>
              <details className="compact-details">
                <summary>Basic action options</summary>
                <div className="basic-options">
                  <label>
                    Basic target
                    <select value={basicTargetId ?? ''} onChange={(event) => setBasicTargetId(event.target.value || undefined)}>
                      <option value="">None</option>
                      {combat.creatures
                        .filter((creature) => creature.id !== activeCreature.id && !isDefeated(creature))
                        .map((creature) => (
                          <option key={creature.id} value={creature.id}>
                            {creature.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Help mode
                    <select value={helpMode} onChange={(event) => setHelpMode(event.target.value as HelpMode)}>
                      <option value="ally">Help ally</option>
                      <option value="enemy">Help against enemy</option>
                    </select>
                  </label>
                  <label>
                    Ready action
                    <select value={readyActionId ?? activeActions[0]?.id ?? ''} onChange={(event) => setReadyActionId(event.target.value || undefined)}>
                      {activeActions.map((action) => (
                        <option key={action.id} value={action.id}>
                          {action.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ready trigger
                    <input value={readyTrigger} onChange={(event) => setReadyTrigger(event.target.value)} />
                  </label>
                  <label>
                    Search
                    <select value={searchMode} onChange={(event) => setSearchMode(event.target.value as SearchMode)}>
                      <option value="perception">WIS / Perception</option>
                      <option value="investigation">INT / Investigation</option>
                    </select>
                  </label>
                  <label>
                    Shove
                    <select value={shoveOutcome} onChange={(event) => setShoveOutcome(event.target.value as ShoveOutcome)}>
                      <option value="prone">Knock prone</option>
                      <option value="push">Push 5 ft</option>
                    </select>
                  </label>
                  <label>
                    Improvised ability
                    <select value={improvisedAbility} onChange={(event) => setImprovisedAbility(event.target.value as Ability | '')}>
                      <option value="">No roll</option>
                      <option value="str">STR</option>
                      <option value="dex">DEX</option>
                      <option value="con">CON</option>
                      <option value="int">INT</option>
                      <option value="wis">WIS</option>
                      <option value="cha">CHA</option>
                    </select>
                  </label>
                  <label>
                    Note
                    <input value={basicNote} onChange={(event) => setBasicNote(event.target.value)} />
                  </label>
                </div>
              </details>

              <CreatureActionGroups
                actions={activeActions}
                selectedActionId={selectedActionId}
                selectedTab={actionTab}
                onSelectTab={setActionTab}
                getDisabledReason={(action) => getActionDisabledReason(activeCreature, action, combat.turnState)}
                onSelect={handleCreatureActionSelect}
              />
              {selectedAction && (
                <div className="target-panel" ref={targetPanelRef} tabIndex={0} aria-label="Target panel">
                  <p>{describeAction(selectedAction)}</p>
                  {isAttackAction(selectedAction) && (
                    <details
                      className="attack-debug compact-details"
                      open={debugOpen}
                      ref={debugDetailsRef}
                      tabIndex={0}
                      onToggle={(event) => setDebugOpen(event.currentTarget.open)}
                    >
                      <summary>Hit chance</summary>
                      <span>Attack bonus: {formatBaseEffectiveBonus(selectedAction.attackBonus ?? 0, getEffectiveAttackBonus(selectedAction, activeCreature, combat))}</span>
                      <span>
                        Target AC:{' '}
                        {selectedTarget
                          ? formatBaseEffectiveNumber(selectedTarget.ac, getEffectiveAC(selectedTarget, combat))
                          : 'choose target'}
                      </span>
                      <span>
                        Expected hit: {selectedAttackDebug ? `${selectedAttackDebug.expectedHitPercentage.toFixed(1)}%` : 'choose target'}
                      </span>
                      <button
                        disabled={!selectedTargetId}
                        onClick={() => {
                          if (selectedTargetId) {
                            setAttackDebugStats(getAttackDebugStats(combat, selectedAction.id, selectedTargetId, 1000));
                          }
                        }}
                      >
                        Roll selected attack vs selected target 1000 times
                      </button>
                      {attackDebugStats && (
                        <span>
                          Hits {attackDebugStats.hits}, misses {attackDebugStats.misses}, crits {attackDebugStats.crits}, hit{' '}
                          {attackDebugStats.hitPercentage.toFixed(1)}%, expected {attackDebugStats.expectedHitPercentage.toFixed(1)}%
                        </span>
                      )}
                    </details>
                  )}
                  {isMultiattackAction(selectedAction) && (
                    <div className="multiattack-targets">
                      <strong>Multiattack target assignment</strong>
                      <label>
                        Same target for all
                        <select
                          value={selectedTargetId ?? ''}
                          onChange={(event) => {
                            const targetId = event.target.value || undefined;
                            setSelectedTargetId(targetId);
                            setMultiattackTargets(targetId ? assignAllMultiattackTargets(selectedAction, targetId) : {});
                          }}
                        >
                          <option value="">None</option>
                          {combat.creatures
                            .filter((creature) => creature.id !== activeCreature.id && !isDefeated(creature))
                            .map((creature) => (
                              <option key={creature.id} value={creature.id}>
                                {creature.name} AC {formatBaseEffectiveNumber(creature.ac, getEffectiveAC(creature, combat))}
                              </option>
                            ))}
                        </select>
                      </label>
                      {(selectedAction.multiattack?.steps ?? []).map((step) => (
                        <label key={step.id}>
                          {step.name}
                          <select
                            value={getMultiattackStepTargetValue(selectedAction, step.id, multiattackTargets, selectedTargetId)}
                            onChange={(event) =>
                              setMultiattackTargets((current) => ({
                                ...current,
                                [step.id]: event.target.value
                              }))
                            }
                          >
                            <option value="">None</option>
                            {combat.creatures
                              .filter((creature) => creature.id !== activeCreature.id && !isDefeated(creature))
                              .map((creature) => (
                                <option key={creature.id} value={creature.id}>
                                  {creature.name} AC {formatBaseEffectiveNumber(creature.ac, getEffectiveAC(creature, combat))}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                      <small>Keyboard: move the grid cursor onto a creature and press Enter to fill the next empty step. Enter again confirms once all steps have targets.</small>
                    </div>
                  )}
                  {(selectedAction.shape?.type === 'line' || selectedAction.shape?.type === 'cone') && (
                    <div className="direction-buttons">
                      {directions.map((candidate) => (
                        <button
                          className={candidate === direction ? 'selected-action' : ''}
                          key={candidate}
                          onClick={() => setDirection(candidate)}
                        >
                          {candidate}
                        </button>
                      ))}
                    </div>
                  )}
                  {!isMultiattackAction(selectedAction) && (
                    <label>
                      Target
                      <select value={selectedTargetId ?? ''} onChange={(event) => setSelectedTargetId(event.target.value || undefined)}>
                          <option value="">None</option>
                          {getTargetOptions(combat, activeCreature, selectedAction).map((creature) => (
                            <option key={creature.id} value={creature.id}>
                              {creature.name} AC {formatBaseEffectiveNumber(creature.ac, getEffectiveAC(creature, combat))}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  <p>Area targets: {targetsInArea.map((target) => target.name).join(', ') || 'none'}</p>
                  <button
                    disabled={Boolean(getTargetPanelDisabledReason(activeCreature, selectedAction, combat.turnState, multiattackTargets, selectedTargetId))}
                    title={getTargetPanelDisabledReason(activeCreature, selectedAction, combat.turnState, multiattackTargets, selectedTargetId)}
                    onClick={applySelectedAction}
                  >
                    Apply Action
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>Roll initiative to begin.</p>
          )}

          <h2>Selected</h2>
          {selectedCreature ? <CreatureSummary creature={selectedCreature} state={combat} /> : <p>No creature selected.</p>}
          {selectedCreature?.id === combat.activeCreatureId && (
            <div className="turn-state">
              <span>Remaining movement: {combat.turnState.remainingMovement} ft</span>
              <span>Action used: {combat.turnState.actionUsed ? 'yes' : 'no'}</span>
              <span>Bonus action used: {combat.turnState.bonusActionUsed ? 'yes' : 'no'}</span>
              <span>Reaction used: {combat.turnState.reactionUsed ? 'yes' : 'no'}</span>
            </div>
          )}
          {selectedCreature && uiSettings.showAdvancedTools && (
            <details className="condition-dev-panel compact-details">
              <summary>Creature Tools</summary>
              <div className="hp-tools">
                <label>
                  HP amount
                  <input
                    min={0}
                    type="number"
                    value={hpAmount}
                    onChange={(event) => setHpAmount(Number(event.target.value))}
                  />
                </label>
                <button onClick={() => setCombat((current) => applyHpChange(current, selectedCreature.id, hpAmount, 'damage'))}>
                  Apply Damage
                </button>
                <button onClick={() => setCombat((current) => applyHpChange(current, selectedCreature.id, hpAmount, 'heal'))}>
                  Heal
                </button>
              </div>
              <label>
                Apply condition
                <select value={conditionToApply} onChange={(event) => setConditionToApply(event.target.value)}>
                  {ALL_CONDITION_IDS.map((conditionId) => (
                    <option key={conditionId} value={conditionId}>
                      {getConditionDefinition(conditionId).name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() =>
                  setCombat((current) =>
                    applyCondition(current, selectedCreature.id, conditionToApply, {
                      sourceCreatureId: activeCreature?.id
                    })
                  )
                }
              >
                Apply
              </button>
              <div className="condition-list">
                {selectedCreature.conditions.length === 0 && <span>No conditions.</span>}
                {selectedCreature.conditions.map((condition) => (
                  <button
                    key={`${condition.id}-${condition.stackCount}-${condition.intensity}`}
                    onClick={() => setCombat((current) => removeCondition(current, selectedCreature.id, condition.id))}
                  >
                    Remove {getConditionLabel(condition)}
                  </button>
                ))}
              </div>
            </details>
          )}
        </aside>

        <section className="panel log-panel">
          <h2>Combat Log</h2>
          <ol className="combat-log" ref={logRef} tabIndex={0} aria-label="Combat log">
            {combat.log.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.type}</strong> {entry.message}
              </li>
            ))}
          </ol>
        </section>

        {uiSettings.showAdvancedTools && (
        <section className="panel json-panel">
          <details
            className="compact-details"
            open={toolsOpen}
            ref={toolsDetailsRef}
            tabIndex={0}
            onToggle={(event) => setToolsOpen(event.currentTarget.open)}
          >
            <summary>Import / Export</summary>
            <div className="json-actions">
              <button onClick={exportCurrent}>Export Current</button>
              <button onClick={loadJson}>Load JSON</button>
              <button onClick={downloadJson}>Download JSON</button>
              <label>
                Upload JSON
                <input accept="application/json,.json" type="file" onChange={(event) => void uploadJson(event.target.files?.[0])} />
              </label>
            </div>
            {jsonError && <p className="error">{jsonError}</p>}
            <textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
          </details>
        </section>
        )}
        </section>
      </section>
      ) : (
        <EncounterEditor currentCombat={combat} onLoadEncounter={loadEncounterFromEditor} />
      )}
      {showHelp && <KeyboardHelpOverlay onClose={() => setShowHelp(false)} />}
      {settingsOpen && (
        <SettingsDialog
          settings={uiSettings}
          onChange={updateUiSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function CreatureSummary({ creature, state }: { creature: Creature; state: CombatState }) {
  const effectiveAc = getEffectiveAC(creature, state);
  const effectiveSpeed = getEffectiveSpeed(creature, state);

  return (
    <div className="creature-summary">
      <strong>{creature.name}</strong>
      <span>{creature.team}</span>
      <HpBar creature={creature} />
      <span>
        HP {creature.hp}/{creature.maxHp}
      </span>
      <span>AC {formatBaseEffectiveNumber(creature.ac, effectiveAc)}</span>
      <span>Speed {formatBaseEffectiveNumber(creature.speed, effectiveSpeed)}</span>
      {(creature.resources ?? []).length > 0 && (
        <span>Resources: {(creature.resources ?? []).map((resource) => `${resource.name} ${resource.current}/${resource.max}`).join(', ')}</span>
      )}
      {(creature.features ?? []).length > 0 && (
        <span>Features: {(creature.features ?? []).map((feature) => `${feature.name}${feature.enabled ? '' : ' (off)'}`).join(', ')}</span>
      )}
      {creature.readiedAction && <span>Ready: {creature.readiedAction.actionName} when {creature.readiedAction.trigger}</span>}
      <span>
        Pos {creature.position.x},{creature.position.y}
      </span>
      <span>
        Conditions: {creature.conditions.length > 0 ? creature.conditions.map((condition) => getConditionLabel(condition)).join(', ') : 'none'}
      </span>
    </div>
  );
}


function CreatureActionGroups({
  actions,
  selectedActionId,
  selectedTab,
  onSelectTab,
  getDisabledReason,
  onSelect
}: {
  actions: ActionDefinition[];
  selectedActionId?: string;
  selectedTab: ActionDefinition['actionCost'];
  onSelectTab: (tab: ActionDefinition['actionCost']) => void;
  getDisabledReason: (action: ActionDefinition) => string | undefined;
  onSelect: (action: ActionDefinition) => void;
}) {
  const groups: Array<[string, ActionDefinition['actionCost']]> = [
    ['Action', 'action'],
    ['Bonus Action', 'bonusAction'],
    ['Reaction', 'reaction'],
    ['Free', 'free']
  ];

  return (
    <section className="ability-panel">
      <h3>Creature Actions</h3>
      <div className="action-tabs">
        {groups.map(([label, cost]) => {
          const count = actions.filter((action) => action.actionCost === cost).length;
          if (count === 0) {
            return null;
          }

          return (
            <button className={selectedTab === cost ? 'selected-action' : ''} key={cost} onClick={() => onSelectTab(cost)}>
              {label} <span>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="action-grid">
        {actions
          .filter((action) => action.actionCost === selectedTab)
          .map((action, index) => {
            const disabledReason = getDisabledReason(action);
            const hotkey = index < 9 ? getActionHotkeyLabel(selectedTab, index) : undefined;
            return (
              <button
                aria-label={`${hotkey ? `${hotkey}: ` : ''}${action.name}`}
                className={['ability-card', action.id === selectedActionId ? 'selected-action' : ''].join(' ')}
                disabled={Boolean(disabledReason)}
                key={action.id}
                title={`${hotkey ? `${hotkey}. ` : ''}${disabledReason ?? action.description ?? describeAction(action)}`}
                onClick={() => onSelect(action)}
              >
                {hotkey && <span className="hotkey-chip">{hotkey}</span>}
                <strong>{action.name}</strong>
                <span className="badge-row">
                  {action.tags.includes('spell') || action.kind === 'spell' ? <span>Spell</span> : null}
                  {action.kind === 'multiattack' ? <span>Multi</span> : null}
                  {action.generatedByFeatureId ? <span>Feature</span> : null}
                  {action.tags.includes('melee') ? <span>Melee</span> : null}
                  {action.tags.includes('ranged') ? <span>Ranged</span> : null}
                </span>
                <span className="ability-meta">{getActionMeta(action)}</span>
                {disabledReason && <small>{disabledReason}</small>}
              </button>
            );
          })}
      </div>
    </section>
  );
}

function describeAction(action: ActionDefinition): string {
  const rulesKind = action.type ?? action.kind;
  if (rulesKind === 'savingThrowEffect') {
    const save = action.save ?? action.effects.find((effect) => effect.save)?.save;
    return `${rulesKind} - ${action.damage?.dice ?? action.effects[0]?.damage?.dice ?? 'no damage'} - ${save?.ability.toUpperCase() ?? '?'} DC ${save?.dc ?? '?'}`;
  }

  if (rulesKind === 'multiattack') {
    const steps = action.multiattack?.steps.map((step) => step.name).join(', ') || 'no steps';
    return `multiattack - ${steps}`;
  }

  return `${rulesKind} - +${action.attackBonus ?? 0} to hit - ${action.damage?.dice ?? 'no damage'} - range ${action.range}`;
}

function getActionMeta(action: ActionDefinition): string {
  const bits: string[] = [];
  const rulesKind = action.type ?? action.kind;

  if (isAttackAction(action)) {
    bits.push(formatBaseEffectiveBonus(action.attackBonus ?? 0, action.attackBonus ?? 0));
  }

  if (action.damage?.dice) {
    bits.push(action.damage.dice);
  }

  if (rulesKind === 'savingThrowEffect') {
    const save = action.save ?? action.effects.find((effect) => effect.save)?.save;
    bits.push(`${save?.ability.toUpperCase() ?? '?'} DC ${save?.dc ?? '?'}`);
  }

  if (action.kind === 'multiattack') {
    bits.push(`${action.multiattack?.steps.length ?? 0} steps`);
  }

  if (action.range > 0) {
    bits.push(`R ${action.range}`);
  }

  if ((action.resourceCosts ?? []).length > 0) {
    bits.push(
      (action.resourceCosts ?? [])
        .map((cost) => `${cost.amount} ${cost.resourceId}${cost.spendActionWhenDepleted ? ' then action at 0' : ''}`)
        .join(', ')
    );
  }

  return bits.join(' | ') || action.description || 'Utility';
}

function formatActionCost(actionCost: ActionDefinition['actionCost']): string {
  if (actionCost === 'bonusAction') {
    return 'Bonus';
  }

  return actionCost[0].toUpperCase() + actionCost.slice(1);
}

function assignAllMultiattackTargets(action: ActionDefinition, targetId: string): Record<string, string> {
  return Object.fromEntries((action.multiattack?.steps ?? []).map((step) => [step.id, targetId]));
}

function getMultiattackStepTargetValue(
  action: ActionDefinition,
  stepId: string,
  stepTargets: Record<string, string>,
  sharedTargetId: string | undefined
): string {
  return stepTargets[stepId] ?? (action.multiattack?.targetMode === 'fixed' ? '' : sharedTargetId ?? '');
}

function getNextUnassignedMultiattackStep(action: ActionDefinition, stepTargets: Record<string, string>) {
  return (action.multiattack?.steps ?? []).find((step) => !stepTargets[step.id]);
}

function areMultiattackTargetsComplete(
  action: ActionDefinition,
  stepTargets: Record<string, string>,
  sharedTargetId: string | undefined
): boolean {
  const steps = action.multiattack?.steps ?? [];
  return steps.length > 0 && steps.every((step) => Boolean(getMultiattackStepTargetValue(action, step.id, stepTargets, sharedTargetId)));
}

function getActionHotkeyLabel(actionCost: ActionDefinition['actionCost'], index: number): string {
  const number = index + 1;
  if (actionCost === 'bonusAction') {
    return `Shift+${number}`;
  }

  if (actionCost === 'reaction' || actionCost === 'free') {
    return `Ctrl+${number}`;
  }

  return `${number}`;
}

function getKeyboardHint(
  selectionMode: SelectionMode,
  selectedAction: ActionDefinition | undefined,
  gridCursor: GridPosition,
  combat: CombatState
): string {
  if (selectedAction) {
    return `${selectedAction.name} selected. Use arrows to move the grid cursor (${gridCursor.x},${gridCursor.y}), Enter to choose/confirm, Escape to cancel.`;
  }

  if (selectionMode === 'move') {
    return `Move mode. Use arrows to move the grid cursor (${gridCursor.x},${gridCursor.y}); Enter attempts movement or selects a creature.`;
  }

  return `Keyboard ready. Round ${combat.round || '-'}; press ? for shortcuts.`;
}

function KeyboardHelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      <section className="help-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Keyboard Shortcuts</h2>
          <button onClick={onClose} aria-label="Close keyboard shortcuts">
            Close
          </button>
        </header>
        <div className="shortcut-grid">
          <span>Space</span>
          <p>End turn / next turn</p>
          <span>R</span>
          <p>Roll initiative</p>
          <span>M</span>
          <p>Move mode</p>
          <span>Esc</span>
          <p>Cancel targeting or close this help</p>
          <span>Arrows</span>
          <p>Move the grid cursor</p>
          <span>Enter</span>
          <p>Select cursor cell, choose target, or confirm selected target</p>
          <span>1-9</span>
          <p>Use visible Action hotbar buttons</p>
          <span>Shift+1-9</span>
          <p>Use visible Bonus Action buttons</p>
          <span>Ctrl/Cmd+1-9</span>
          <p>Use visible Reaction/Free buttons</p>
          <span>G / T / L</span>
          <p>Focus grid, target panel, or combat log</p>
          <span>D / I</span>
          <p>Toggle hit chance or import/export panels</p>
          <span>? / H</span>
          <p>Open this help</p>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  settings,
  onChange,
  onClose
}: {
  settings: UiSettings;
  onChange: (update: Partial<UiSettings>) => void;
  onClose: () => void;
}) {
  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Settings</h2>
            <p>Display and keyboard preferences</p>
          </div>
          <button onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </header>

        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-grid">
            <label>
              Theme
              <select value={settings.theme} onChange={(event) => onChange({ theme: event.target.value as UiTheme })}>
                <option value="slate">Slate</option>
                <option value="parchment">Parchment</option>
                <option value="midnight">Midnight</option>
              </select>
            </label>
            <label>
              Text Size
              <select value={settings.textScale} onChange={(event) => onChange({ textScale: event.target.value as TextScale })}>
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
              </select>
            </label>
            <label>
              Layout Density
              <select value={settings.density} onChange={(event) => onChange({ density: event.target.value as UiDensity })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Interface</h3>
          <div className="settings-toggles">
            <label>
              <input
                type="checkbox"
                checked={settings.shortcutsEnabled}
                onChange={(event) => onChange({ shortcutsEnabled: event.target.checked })}
              />
              Keyboard shortcuts enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showShortcutHints}
                onChange={(event) => onChange({ showShortcutHints: event.target.checked })}
              />
              Show shortcut hints in combat
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showAdvancedTools}
                onChange={(event) => onChange({ showAdvancedTools: event.target.checked })}
              />
              Show advanced import and creature tools
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showMapTools}
                onChange={(event) => onChange({ showMapTools: event.target.checked })}
              />
              Show battlemap measure tools
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showGridCoordinates}
                onChange={(event) => onChange({ showGridCoordinates: event.target.checked })}
              />
              Show grid coordinates
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Keyboard Shortcuts</h3>
          <ShortcutReference />
        </section>
      </section>
    </div>
  );
}

function ShortcutReference() {
  return (
    <div className="shortcut-grid settings-shortcuts">
      <span>Space</span>
      <p>End turn</p>
      <span>R</span>
      <p>Roll initiative</p>
      <span>M</span>
      <p>Move mode</p>
      <span>Esc</span>
      <p>Cancel targeting or close dialogs</p>
      <span>Arrows</span>
      <p>Move the grid cursor</p>
      <span>Enter</span>
      <p>Select the cursor square or confirm the selected action</p>
      <span>1-9</span>
      <p>Use visible action buttons</p>
      <span>Shift+1-9</span>
      <p>Use visible bonus action buttons</p>
      <span>Ctrl/Cmd+1-9</span>
      <p>Use visible reaction or free buttons</p>
      <span>G / T / L</span>
      <p>Focus grid, target panel, or combat log</p>
      <span>? / H</span>
      <p>Open shortcut help</p>
    </div>
  );
}

function isAttackAction(action: ActionDefinition): boolean {
  const rulesKind = action.type ?? action.kind;
  return rulesKind !== 'multiattack' && (rulesKind === 'meleeAttack' || rulesKind === 'rangedAttack' || action.tags.includes('attack'));
}

function isUtilityAction(action: ActionDefinition): boolean {
  const rulesKind = action.type ?? action.kind;
  return rulesKind !== 'meleeAttack' && rulesKind !== 'rangedAttack' && rulesKind !== 'savingThrowEffect' && rulesKind !== 'multiattack';
}

function isMultiattackAction(action: ActionDefinition): boolean {
  return action.kind === 'multiattack';
}

function isActionCostSpent(turnState: TurnState, actionCost: ActionDefinition['actionCost']): boolean {
  if (actionCost === 'free') {
    return false;
  }

  if (actionCost === 'bonusAction') {
    return turnState.bonusActionUsed;
  }

  if (actionCost === 'reaction') {
    return turnState.reactionUsed;
  }

  return turnState.actionUsed;
}

function getActionDisabledReason(creature: Creature, action: ActionDefinition, turnState: TurnState): string | undefined {
  if (isActionCostSpent(turnState, action.actionCost)) {
    return `${action.actionCost} already used.`;
  }

  return getUnavailableActionReason(creature, action);
}

function getTargetPanelDisabledReason(
  creature: Creature,
  action: ActionDefinition,
  turnState: TurnState,
  multiattackTargets: Record<string, string>,
  selectedTargetId: string | undefined
): string | undefined {
  const actionReason = getActionDisabledReason(creature, action, turnState);
  if (actionReason) {
    return actionReason;
  }

  if (isMultiattackAction(action) && !areMultiattackTargetsComplete(action, multiattackTargets, selectedTargetId)) {
    return 'Choose a target for each multiattack step.';
  }

  return undefined;
}

function getShapeOrigin(
  action: ActionDefinition,
  activePosition: GridPosition,
  areaOrigin?: GridPosition
): GridPosition {
  if (action.shape?.type === 'line' || action.shape?.type === 'cone') {
    return activePosition;
  }

  return areaOrigin ?? activePosition;
}

function getTargetsForAction(
  combat: CombatState,
  activeCreature: Creature,
  action: ActionDefinition,
  selectedTargetId?: string,
  areaOrigin?: GridPosition,
  direction?: CardinalDirection
): Creature[] {
  if (action.shape?.type === 'single') {
    return selectedTargetId ? [findCreature(combat, selectedTargetId)] : [];
  }

  if ((action.type ?? action.kind) === 'savingThrowEffect') {
    const origin = getShapeOrigin(action, activeCreature.position, areaOrigin);
    const squares = getActionShapeSquares(combat, action, origin, direction);
    return combat.creatures.filter(
      (creature) =>
        creature.id !== activeCreature.id &&
        !isDefeated(creature) &&
        squares.some((square) => samePosition(square, creature.position))
    );
  }

  return [];
}

function getMapToolSquares(
  combat: CombatState,
  tool: MapTool,
  start: GridPosition | undefined,
  end: GridPosition | undefined,
  direction: CardinalDirection,
  radiusFeet: number,
  lengthFeet: number
): GridPosition[] {
  if (tool === 'select' || !start) {
    return [];
  }

  if (tool === 'distance' || tool === 'lineOfSight') {
    return getLineSquares(start, end ?? start).filter((position) => isInBounds(position, combat.grid));
  }

  const shape: ShapeDefinition =
    tool === 'radius'
      ? { type: 'radius', radius: feetToSquares(radiusFeet) }
      : { type: tool, length: feetToSquares(lengthFeet), direction };

  return getShapeSquares(shape, start, combat.grid, direction);
}

function getMapToolResult(
  combat: CombatState,
  tool: MapTool,
  start: GridPosition | undefined,
  end: GridPosition | undefined,
  squares: GridPosition[]
): string {
  if (tool === 'select') {
    return 'Combat controls active.';
  }

  if (!start) {
    return 'Choose a start square.';
  }

  if (tool === 'distance' || tool === 'lineOfSight') {
    const target = end ?? start;
    const gridDistance = getDistanceFeet(start, target);
    const straightDistance = Math.round(Math.hypot(target.x - start.x, target.y - start.y) * 5);
    const blocked = squares.filter((square) => combat.grid.blocked.some((cell) => samePosition(cell, square))).length;
    const losText = tool === 'lineOfSight' ? ` LOS ${hasLineOfSight(combat, start, target) ? 'clear' : 'blocked'}.` : '';
    return `${formatPosition(start)} to ${formatPosition(target)}: ${gridDistance} ft grid, ${straightDistance} ft straight.${blocked ? ` ${blocked} blocked square(s) crossed.` : ''}${losText}`;
  }

  const creatures = combat.creatures
    .filter((creature) => !isDefeated(creature) && squares.some((square) => samePosition(square, creature.position)))
    .map((creature) => creature.name);
  return `${squares.length} square(s). Creatures: ${creatures.join(', ') || 'none'}.`;
}

function feetToSquares(feet: number): number {
  return Math.max(1, Math.ceil(feet / 5));
}

function formatPosition(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

function formatMapToolLabel(tool: MapTool): string {
  if (tool === 'lineOfSight') {
    return 'Line of Sight';
  }
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

function getTargetOptions(
  combat: CombatState,
  activeCreature: Creature,
  _action: ActionDefinition
): Creature[] {
  return combat.creatures.filter((creature) => {
    if (isDefeated(creature)) {
      return false;
    }

    return creature.id !== activeCreature.id;
  });
}

function HpBar({ creature, compact = false }: { creature: Creature; compact?: boolean }) {
  return (
    <span className={compact ? 'hp-bar compact-hp' : 'hp-bar'}>
      <span style={{ width: `${getHpPercent(creature)}%` }} />
    </span>
  );
}

function ConditionTags({ creature, compact = false }: { creature: Creature; compact?: boolean }) {
  const tags = getConditionTags(creature.conditions);
  if (tags.length === 0) {
    return null;
  }

  return (
    <span className={compact ? 'condition-tags compact-tags' : 'condition-tags'}>
      {tags.map((tag, index) => (
        <span key={`${tag}-${index}`}>{tag}</span>
      ))}
    </span>
  );
}

function getCreatureShortLabel(creature: Creature): string {
  const words = creature.name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return creature.name.slice(0, 2).toUpperCase();
}

function getConditionLabels(creature: Creature): string {
  return creature.conditions.map((condition) => getConditionLabel(condition)).join(', ');
}

function getBasicActionDescription(action: BasicActionName): string {
  const descriptions: Record<BasicActionName, string> = {
    Attack: 'Select and resolve one of the creature attack actions.',
    'Cast a Spell': 'Select a creature action tagged as a spell.',
    Dash: 'Gain extra movement equal to speed.',
    Disengage: 'Mark disengaged until end of turn.',
    Dodge: 'Attacks against you have disadvantage; Dex saves have advantage.',
    Help: 'Use the basic target and help mode controls.',
    Hide: 'Roll Dexterity / Stealth and store Hidden result.',
    Ready: 'Store a readied action and trigger text.',
    Search: 'Roll Perception or Investigation.',
    'Use an Object': 'Log the note field.',
    Grapple: 'Contested Athletics vs Athletics/Acrobatics.',
    Shove: 'Contested Athletics, then prone or push.',
    'Improvised Action': 'Log a note and optionally roll an ability check.'
  };
  return descriptions[action];
}

function loadUiSettings(): UiSettings {
  if (typeof window === 'undefined') {
    return defaultUiSettings();
  }

  const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
  if (!raw) {
    return defaultUiSettings();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...defaultUiSettings(),
      ...parsed,
      theme: parsed.theme === 'parchment' || parsed.theme === 'midnight' || parsed.theme === 'slate' ? parsed.theme : 'slate',
      textScale: parsed.textScale === 'compact' || parsed.textScale === 'large' || parsed.textScale === 'normal' ? parsed.textScale : 'normal',
      density: parsed.density === 'compact' || parsed.density === 'comfortable' ? parsed.density : 'comfortable'
    };
  } catch {
    return defaultUiSettings();
  }
}

function saveUiSettings(settings: UiSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}

function defaultUiSettings(): UiSettings {
  return {
    theme: 'slate',
    textScale: 'normal',
    density: 'comfortable',
    shortcutsEnabled: true,
    showShortcutHints: true,
    showAdvancedTools: false,
    showMapTools: true,
    showGridCoordinates: true
  };
}
