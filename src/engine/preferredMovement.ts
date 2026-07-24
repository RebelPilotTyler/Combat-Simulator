import {
  createOpportunityAttackPathLookup,
  getOpportunityAttackCandidatesForMovementPath,
  type OpportunityAttackPathCandidate
} from './combat';
import {
  getMovementOptionsForDestinations,
  type MovementOption
} from './movement';
import { getCombatQueryContext, type CombatQueryContext } from './queryContext';
import { position3DKey } from './shapes';
import type { CombatState, Creature, GridPosition } from './types';
import { incrementPerformanceCounter, measurePerformance } from '../performance/profiling';

export interface PreferredMovementAnalysis {
  optionByDestination: Map<string, MovementOption>;
  opportunityCandidatesByDestination: Map<string, OpportunityAttackPathCandidate[]>;
}

export function analyzePreferredMovementOptions(
  state: CombatState,
  mover: Creature,
  baseOptions: MovementOption[],
  query?: CombatQueryContext,
  maxOptionsPerDestination = 8
): PreferredMovementAnalysis {
  const context = getCombatQueryContext(state, query);
  return measurePerformance('engine.movement.preferred-options', () => {
    const alternativesByDestination = getMovementOptionsForDestinations(
      state,
      mover.id,
      baseOptions.map((option) => option.position),
      maxOptionsPerDestination,
      context
    );
    const opportunityLookup = createOpportunityAttackPathLookup(state, mover);
    const candidatesByPath = new Map<string, OpportunityAttackPathCandidate[]>();
    const optionByDestination = new Map<string, MovementOption>();
    const opportunityCandidatesByDestination = new Map<string, OpportunityAttackPathCandidate[]>();

    const getCandidates = (path: GridPosition[]) => {
      const key = path.map(position3DKey).join('|');
      const cached = candidatesByPath.get(key);
      if (cached) {
        return cached;
      }
      const candidates = getOpportunityAttackCandidatesForMovementPath(
        state,
        mover,
        path,
        context,
        opportunityLookup
      );
      candidatesByPath.set(key, candidates);
      return candidates;
    };

    baseOptions.forEach((baseOption) => {
      const destinationKey = position3DKey(baseOption.position);
      const alternatives = alternativesByDestination.get(destinationKey) ?? [];
      let preferred = alternatives[0] ?? baseOption;
      let preferredRisk = getCandidates(preferred.path).length;

      for (let index = 1; index < alternatives.length; index += 1) {
        const candidate = alternatives[index];
        const candidateRisk = getCandidates(candidate.path).length;
        if (
          candidateRisk < preferredRisk ||
          (candidateRisk === preferredRisk && candidate.costFeet < preferred.costFeet) ||
          (
            candidateRisk === preferredRisk &&
            candidate.costFeet === preferred.costFeet &&
            candidate.path.length < preferred.path.length
          )
        ) {
          preferred = candidate;
          preferredRisk = candidateRisk;
        }
      }

      optionByDestination.set(destinationKey, preferred);
      opportunityCandidatesByDestination.set(destinationKey, getCandidates(preferred.path));
      incrementPerformanceCounter('engine.movement.preferred-candidates-evaluated', Math.max(1, alternatives.length));
    });

    return {
      optionByDestination,
      opportunityCandidatesByDestination
    };
  });
}
