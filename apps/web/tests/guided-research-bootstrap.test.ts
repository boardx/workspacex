import { expect, it } from 'vitest';
import { isUnstartedResearch } from '@/lib/guided-research-bootstrap';
it('allows plan bootstrap after persisted source choice but does not replay prior model work', () => {
 const state = { version: 1, sourcePolicy: { mode: 'materials' as const, domains: [], internalSourceIds: [], revision: 1 }, generatedNodes: [], modelCalls: [], directions: [], outline: [] };
 expect(isUnstartedResearch(state)).toBe(true);
 expect(isUnstartedResearch({ ...state, sourcePolicy: undefined })).toBe(false);
 expect(isUnstartedResearch({ ...state, version: 2 })).toBe(false);
 expect(isUnstartedResearch({ ...state, generatedNodes: ['brief'] })).toBe(false);
});
