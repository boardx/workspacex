import type { GuidedResearchRuntime } from './guided-research-api';
/** A persisted source-choice command does not start or complete the research plan. */
export function isUnstartedResearch(state: Pick<GuidedResearchRuntime, 'version' | 'sourcePolicy' | 'generatedNodes' | 'modelCalls' | 'directions' | 'outline'>): boolean {
  return state.version === 0 || Boolean(state.version === 1 && state.sourcePolicy
    && !state.generatedNodes.length && !state.modelCalls.length && !state.directions.length && !state.outline.length);
}
