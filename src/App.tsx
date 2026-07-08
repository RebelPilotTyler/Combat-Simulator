import { useMemo, useState } from 'react';
import { createSampleEncounter } from './data/sampleEncounter';
import {
  BASIC_ACTIONS,
  applyHpChange,
  applyCondition,
  endTurn,
  findCreature,
  getActionShapeSquares,
  getAttackDebugStats,
  getTargetsInShape,
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
import { ALL_CONDITION_IDS, getConditionDefinition, getConditionLabel, normalizeConditions } from './engine/conditions';
import { getAvailableActions, getEffectiveAC, getEffectiveSpeed, getUnavailableActionReason } from './engine/features';
import { getReachableMovementSquares } from './engine/movement';
import { getConditionTags, getHpPercent } from './engine/presentation';
import { positionKey, samePosition } from './engine/shapes';
import type { Ability, ActionDefinition, CardinalDirection, CombatState, Creature, GridPosition, TurnState } from './engine/types';

const directions: CardinalDirection[] = ['north', 'east', 'south', 'west'];
type SelectionMode = 'move' | 'target';

export function App() {
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
  const [jsonText, setJsonText] = useState(() => JSON.stringify(createSampleEncounter(), null, 2));
  const [jsonError, setJsonError] = useState<string | undefined>();

  const activeCreature = combat.activeCreatureId ? findCreature(combat, combat.activeCreatureId) : undefined;
  const selectedCreature = selectedCreatureId ? findCreature(combat, selectedCreatureId) : undefined;
  const activeActions = activeCreature ? getAvailableActions(activeCreature, combat) : [];
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

  function resetTargeting(actionId?: string) {
    setSelectedActionId(actionId);
    setSelectedTargetId(undefined);
    setAreaOrigin(undefined);
    setSelectionMode(actionId ? 'target' : 'move');
  }

  function cancelSelection() {
    resetTargeting();
  }

  function handleCellClick(position: GridPosition) {
    if (selectionMode === 'move' && activeCreature && movementKeys.has(positionKey(position))) {
      setCombat((current) => moveActiveCreature(current, position));
      setSelectedCreatureId(activeCreature.id);
      return;
    }

    const creature = combat.creatures.find((candidate) => samePosition(candidate.position, position));
    if (creature) {
      setSelectedCreatureId(creature.id);
      setBasicTargetId(creature.id);
      if (selectedAction && selectedAction.shape?.type === 'single') {
        setSelectedTargetId(creature.id);
        setAreaOrigin(creature.position);
      }
      return;
    }

    if (selectedAction?.type === 'savingThrowEffect') {
      setAreaOrigin(position);
    }
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
      const spell = activeActions.find((action) => action.tags.includes('spell') || action.kind === 'spell');
      resetTargeting(spell?.id);
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
    try {
      const parsed = JSON.parse(jsonText) as CombatState;
      if (!Array.isArray(parsed.creatures) || !parsed.grid) {
        throw new Error('JSON must look like a CombatState with creatures and grid.');
      }

      const normalized = {
        ...parsed,
        creatures: parsed.creatures.map((creature) => ({
          ...creature,
          conditions: normalizeConditions(creature.conditions),
          resources: creature.resources ?? [],
          features: creature.features ?? []
        })),
        turnState: parsed.turnState ?? { creatureId: parsed.activeCreatureId, remainingMovement: 0, actionUsed: false, bonusActionUsed: false, reactionUsed: false },
        turnResources: parsed.turnResources ?? {},
        pendingReactions: parsed.pendingReactions ?? []
      };

      setCombat(normalized);
      setSelectedCreatureId(parsed.activeCreatureId ?? parsed.creatures[0]?.id);
      resetTargeting();
      setJsonError(undefined);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON.');
    }
  }

  function loadSample() {
    const sample = createSampleEncounter();
    setCombat(sample);
    setSelectedCreatureId(sample.creatures[0]?.id);
    resetTargeting();
    setJsonText(JSON.stringify(sample, null, 2));
    setJsonError(undefined);
  }

  function exportCurrent() {
    setJsonText(JSON.stringify(combat, null, 2));
    setJsonError(undefined);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Combat Sandbox</h1>
          <p>Round {combat.round || '-'} - Active: {activeCreature?.name ?? 'No initiative'}</p>
        </div>
        <div className="top-actions">
          <button onClick={() => setCombat((current) => rollInitiative(current))}>Roll Initiative</button>
          <button onClick={() => setCombat((current) => endTurn(current))}>End Turn / Next Turn</button>
          <button onClick={loadSample}>Load Sample</button>
        </div>
      </header>

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
              <span>
                HP {creature.hp}/{creature.maxHp}
              </span>
              <ConditionTags creature={creature} />
            </button>
          );
        })}
      </section>

      {combat.pendingReactions.length > 0 && (
        <section className="reaction-prompts">
          <strong>Pending Reactions</strong>
          {combat.pendingReactions.map((reaction) => (
            <span className="reaction-prompt" key={reaction.id}>
              {reaction.description}
              <button onClick={() => setCombat((current) => resolvePendingReaction(current, reaction.id, true))}>Use reaction</button>
              <button onClick={() => setCombat((current) => resolvePendingReaction(current, reaction.id, false))}>Skip</button>
            </span>
          ))}
        </section>
      )}

      <section className="layout">
        <section className="panel board-panel">
          <div className="grid-board" style={{ gridTemplateColumns: `repeat(${combat.grid.width}, 48px)` }}>
            {Array.from({ length: combat.grid.height }).flatMap((_, y) =>
              Array.from({ length: combat.grid.width }).map((_, x) => {
                const position = { x, y };
                const creature = combat.creatures.find((candidate) => samePosition(candidate.position, position));
                const blocked = combat.grid.blocked.some((cell) => samePosition(cell, position));
                const movement = selectionMode === 'move' && movementKeys.has(positionKey(position));
                const highlighted = highlightedKeys.has(positionKey(position));
                const active = creature?.id === combat.activeCreatureId;
                const selected = creature?.id === selectedCreatureId;

                return (
                  <button
                    className={[
                      'grid-cell',
                      blocked ? 'blocked' : '',
                      highlighted ? 'highlighted' : '',
                      movement ? 'movement-cell' : '',
                      active ? 'active-cell' : '',
                      selected ? 'selected-cell' : ''
                    ].join(' ')}
                    key={positionKey(position)}
                    onClick={() => handleCellClick(position)}
                  >
                    <span className="coord">{x},{y}</span>
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

        <aside className="panel side-panel">
          <h2>Active Creature</h2>
          {activeCreature ? (
            <>
              <CreatureSummary creature={activeCreature} />
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

              <CreatureActionGroups
                activeCreature={activeCreature}
                actions={activeActions}
                selectedActionId={selectedActionId}
                turnState={combat.turnState}
                getDisabledReason={(action) => getActionDisabledReason(activeCreature, action, combat.turnState)}
                onSelect={(action) => {
                  if (isUtilityAction(action)) {
                    setCombat((current) => performCreatureUtilityAction(current, action.id));
                  } else {
                    resetTargeting(action.id);
                  }
                }}
              />
              {selectedAction && (
                <div className="target-panel">
                  <p>{describeAction(selectedAction)}</p>
                  {isAttackAction(selectedAction) && (
                    <div className="attack-debug">
                      <span>Attack bonus: +{selectedAction.attackBonus ?? 0}</span>
                      <span>Target AC: {selectedTarget?.ac ?? 'choose target'}</span>
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
                  <label>
                    Target
                    <select value={selectedTargetId ?? ''} onChange={(event) => setSelectedTargetId(event.target.value || undefined)}>
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
                  <p>Area targets: {targetsInArea.map((target) => target.name).join(', ') || 'none'}</p>
                  <button disabled={combat.turnState.actionUsed} onClick={applySelectedAction}>
                    Apply Action
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>Roll initiative to begin.</p>
          )}

          <h2>Selected</h2>
          {selectedCreature ? <CreatureSummary creature={selectedCreature} /> : <p>No creature selected.</p>}
          {selectedCreature?.id === combat.activeCreatureId && (
            <div className="turn-state">
              <span>Remaining movement: {combat.turnState.remainingMovement} ft</span>
              <span>Action used: {combat.turnState.actionUsed ? 'yes' : 'no'}</span>
              <span>Bonus action used: {combat.turnState.bonusActionUsed ? 'yes' : 'no'}</span>
              <span>Reaction used: {combat.turnState.reactionUsed ? 'yes' : 'no'}</span>
            </div>
          )}
          {selectedCreature && (
            <div className="condition-dev-panel">
              <h3>Dev / Test Tools</h3>
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
            </div>
          )}
        </aside>

        <section className="panel log-panel">
          <h2>Combat Log</h2>
          <ol className="combat-log">
            {combat.log.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.type}</strong> {entry.message}
              </li>
            ))}
          </ol>
        </section>

        <section className="panel json-panel">
          <h2>Import / Export</h2>
          <div className="json-actions">
            <button onClick={exportCurrent}>Export Current</button>
            <button onClick={loadJson}>Load JSON</button>
          </div>
          {jsonError && <p className="error">{jsonError}</p>}
          <textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
        </section>
      </section>
    </main>
  );
}

function CreatureSummary({ creature }: { creature: Creature }) {
  return (
    <div className="creature-summary">
      <strong>{creature.name}</strong>
      <span>{creature.team}</span>
      <HpBar creature={creature} />
      <span>
        HP {creature.hp}/{creature.maxHp}
      </span>
      <span>AC {creature.ac} effective {getEffectiveAC(creature, undefined as never)}</span>
      <span>Speed {creature.speed} effective {getEffectiveSpeed(creature, undefined as never)}</span>
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
  activeCreature,
  actions,
  selectedActionId,
  turnState,
  getDisabledReason,
  onSelect
}: {
  activeCreature: Creature;
  actions: ActionDefinition[];
  selectedActionId?: string;
  turnState: TurnState;
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
    <>
      <h3>Creature Actions</h3>
      {groups.map(([label, cost]) => {
        const groupedActions = actions.filter((action) => action.actionCost === cost);
        if (groupedActions.length === 0) {
          return null;
        }

        return (
          <div className="action-group" key={cost}>
            <strong>{label}</strong>
            <div className="action-list">
              {groupedActions.map((action) => {
                const disabledReason = getDisabledReason(action);
                return (
                  <button
                    className={action.id === selectedActionId ? 'selected-action' : ''}
                    disabled={Boolean(disabledReason)}
                    key={action.id}
                    title={disabledReason ?? action.description ?? describeAction(action)}
                    onClick={() => onSelect(action)}
                  >
                    {action.tags.includes('spell') || action.kind === 'spell' ? '[Spell] ' : ''}
                    {action.generatedByFeatureId ? '[Feature] ' : ''}
                    {action.name}
                    {isAttackAction(action) ? ` (+${action.attackBonus ?? 0})` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function describeAction(action: ActionDefinition): string {
  const rulesKind = action.type ?? action.kind;
  if (rulesKind === 'savingThrowEffect') {
    const save = action.save ?? action.effects.find((effect) => effect.save)?.save;
    return `${rulesKind} - ${action.damage?.dice ?? action.effects[0]?.damage?.dice ?? 'no damage'} - ${save?.ability.toUpperCase() ?? '?'} DC ${save?.dc ?? '?'}`;
  }

  return `${rulesKind} - +${action.attackBonus ?? 0} to hit - ${action.damage?.dice ?? 'no damage'} - range ${action.range}`;
}

function isAttackAction(action: ActionDefinition): boolean {
  const rulesKind = action.type ?? action.kind;
  return rulesKind === 'meleeAttack' || rulesKind === 'rangedAttack' || action.tags.includes('attack');
}

function isUtilityAction(action: ActionDefinition): boolean {
  const rulesKind = action.type ?? action.kind;
  return rulesKind !== 'meleeAttack' && rulesKind !== 'rangedAttack' && rulesKind !== 'savingThrowEffect';
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
    return selectedTargetId ? [findCreature(combat, selectedTargetId)].filter((target) => target.id !== activeCreature.id) : [];
  }

  if ((action.type ?? action.kind) === 'savingThrowEffect') {
    const origin = getShapeOrigin(action, activeCreature.position, areaOrigin);
    return getTargetsInShape(combat, action.id, origin, direction);
  }

  return [];
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
