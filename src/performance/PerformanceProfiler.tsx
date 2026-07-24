import { Profiler, type ReactNode } from 'react';
import { isPerformanceProfilingEnabled, recordPerformanceMeasurement } from './profiling';

export function PerformanceProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!isPerformanceProfilingEnabled()) {
    return children;
  }

  return (
    <Profiler
      id={id}
      onRender={(profilerId, _phase, actualDuration) => {
        recordPerformanceMeasurement(`react.${profilerId}`, actualDuration);
      }}
    >
      {children}
    </Profiler>
  );
}
