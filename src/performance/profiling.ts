export interface PerformanceMetric {
  count: number;
  totalDurationMs: number;
  averageDurationMs: number;
  maximumDurationMs: number;
  lastDurationMs: number;
}

export interface PerformanceSnapshot {
  timings: Record<string, PerformanceMetric>;
  counters: Record<string, number>;
}

interface MutablePerformanceMetric {
  count: number;
  totalDurationMs: number;
  maximumDurationMs: number;
  lastDurationMs: number;
}

interface CombatPerformanceDebugApi {
  enable: () => void;
  disable: () => void;
  reset: () => void;
  snapshot: () => PerformanceSnapshot;
  report: () => PerformanceSnapshot;
}

declare global {
  interface Window {
    __DND_COMBAT_PERF__?: CombatPerformanceDebugApi;
  }
}

const metrics = new Map<string, MutablePerformanceMetric>();
const counters = new Map<string, number>();
let enabled = false;
let measurementId = 0;

export function configurePerformanceProfiling(nextEnabled: boolean): void {
  enabled = nextEnabled;
}

export function isPerformanceProfilingEnabled(): boolean {
  return enabled;
}

export function measurePerformance<T>(name: string, operation: () => T): T {
  if (!enabled || typeof performance === 'undefined') {
    return operation();
  }

  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    recordPerformanceMeasurement(name, performance.now() - startedAt, startedAt);
  }
}

export function recordPerformanceMeasurement(name: string, durationMs: number, startedAt?: number): void {
  if (!enabled || !Number.isFinite(durationMs)) {
    return;
  }

  const current = metrics.get(name) ?? {
    count: 0,
    totalDurationMs: 0,
    maximumDurationMs: 0,
    lastDurationMs: 0
  };
  current.count += 1;
  current.totalDurationMs += durationMs;
  current.maximumDurationMs = Math.max(current.maximumDurationMs, durationMs);
  current.lastDurationMs = durationMs;
  metrics.set(name, current);

  if (typeof performance === 'undefined' || typeof performance.mark !== 'function' || typeof performance.measure !== 'function') {
    return;
  }

  const markName = `dnd-combat:${name}:start:${measurementId++}`;
  try {
    performance.mark(markName, startedAt === undefined ? undefined : { startTime: startedAt });
    performance.measure(`dnd-combat:${name}`, markName);
  } catch {
    // Profiling must never interfere with combat or rendering.
  } finally {
    performance.clearMarks(markName);
  }
}

export function incrementPerformanceCounter(name: string, amount = 1): void {
  if (!enabled || !Number.isFinite(amount)) {
    return;
  }

  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function resetPerformanceMetrics(): void {
  metrics.clear();
  counters.clear();
  if (typeof performance !== 'undefined' && typeof performance.clearMeasures === 'function') {
    performance.clearMeasures();
  }
}

export function getPerformanceSnapshot(): PerformanceSnapshot {
  return {
    timings: Object.fromEntries(
      [...metrics.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, metric]) => [
          name,
          {
            count: metric.count,
            totalDurationMs: roundDuration(metric.totalDurationMs),
            averageDurationMs: roundDuration(metric.totalDurationMs / metric.count),
            maximumDurationMs: roundDuration(metric.maximumDurationMs),
            lastDurationMs: roundDuration(metric.lastDurationMs)
          }
        ])
    ),
    counters: Object.fromEntries([...counters.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
}

export function installPerformanceDebugApi(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.__DND_COMBAT_PERF__ = {
    enable: () => configurePerformanceProfiling(true),
    disable: () => configurePerformanceProfiling(false),
    reset: resetPerformanceMetrics,
    snapshot: getPerformanceSnapshot,
    report: () => {
      const snapshot = getPerformanceSnapshot();
      console.table(snapshot.timings);
      console.table(snapshot.counters);
      return snapshot;
    }
  };
}

function roundDuration(value: number): number {
  return Math.round(value * 1000) / 1000;
}
