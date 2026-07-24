import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PerformanceProfiler } from './performance/PerformanceProfiler';
import { configurePerformanceProfiling, installPerformanceDebugApi } from './performance/profiling';
import './styles.css';

configurePerformanceProfiling(import.meta.env.DEV);
if (import.meta.env.DEV) {
  installPerformanceDebugApi();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PerformanceProfiler id="app">
      <App />
    </PerformanceProfiler>
  </React.StrictMode>
);
