import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configurePerformanceProfiling,
  getPerformanceSnapshot,
  incrementPerformanceCounter,
  measurePerformance,
  resetPerformanceMetrics
} from './profiling';

describe('performance profiling', () => {
  beforeEach(() => {
    configurePerformanceProfiling(false);
    resetPerformanceMetrics();
  });

  afterEach(() => {
    configurePerformanceProfiling(false);
    resetPerformanceMetrics();
  });

  it('is inert while disabled', () => {
    expect(measurePerformance('disabled-operation', () => 42)).toBe(42);
    incrementPerformanceCounter('disabled-counter', 10);

    expect(getPerformanceSnapshot()).toEqual({ timings: {}, counters: {} });
  });

  it('records timing aggregates and work counters while enabled', () => {
    configurePerformanceProfiling(true);

    expect(measurePerformance('operation', () => 'result')).toBe('result');
    expect(measurePerformance('operation', () => 'again')).toBe('again');
    incrementPerformanceCounter('nodes', 4);
    incrementPerformanceCounter('nodes', 3);

    const snapshot = getPerformanceSnapshot();
    expect(snapshot.timings.operation.count).toBe(2);
    expect(snapshot.timings.operation.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.timings.operation.maximumDurationMs).toBeGreaterThanOrEqual(snapshot.timings.operation.lastDurationMs);
    expect(snapshot.counters.nodes).toBe(7);
  });

  it('records failed operations without changing their thrown error', () => {
    configurePerformanceProfiling(true);
    const error = new Error('expected');

    expect(() =>
      measurePerformance('failed-operation', () => {
        throw error;
      })
    ).toThrow(error);
    expect(getPerformanceSnapshot().timings['failed-operation'].count).toBe(1);
  });
});
