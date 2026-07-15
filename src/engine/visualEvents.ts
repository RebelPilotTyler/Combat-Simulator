import type { CombatState, VisualEvent, VisualEventKind } from './types';

export type VisualEventInput = Omit<VisualEvent, 'id' | 'createdAt' | 'durationMs'> & {
  id?: string;
  createdAt?: number;
  durationMs?: number;
};

const DEFAULT_DURATION_MS: Record<VisualEventKind, number> = {
  attackHit: 650,
  attackMiss: 700,
  criticalHit: 900,
  damageDealt: 900,
  healingReceived: 900,
  conditionApplied: 950,
  conditionRemoved: 850,
  savingThrowSuccess: 800,
  savingThrowFailure: 800,
  opportunityAttackTriggered: 1100,
  creatureDefeated: 1200,
  movementComplete: 800,
  resourceSpent: 750,
  attackImpact: 900,
  shapeEffect: 1100
};

const MAX_QUEUED_EVENTS = 48;

export function createVisualEvent(input: VisualEventInput, now = Date.now()): VisualEvent {
  return {
    ...input,
    id: input.id ?? `visual-${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: input.createdAt ?? now,
    durationMs: input.durationMs ?? DEFAULT_DURATION_MS[input.kind]
  };
}

export function enqueueVisualEvent(state: CombatState, input: VisualEventInput, now = Date.now()): void {
  state.visualEvents = [
    ...pruneVisualEvents(state.visualEvents ?? [], now),
    createVisualEvent(input, now)
  ].slice(-MAX_QUEUED_EVENTS);
}

export function pruneVisualEvents(events: VisualEvent[], now = Date.now()): VisualEvent[] {
  return events.filter((event) => event.createdAt + event.durationMs > now);
}

export function getActiveVisualEvents(events: VisualEvent[] | undefined, now = Date.now()): VisualEvent[] {
  return pruneVisualEvents(events ?? [], now);
}
