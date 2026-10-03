import {describe,it,expect} from 'vitest';
import {assertJourneyBoundary,maintenanceJourneyEffects,rejectLegacyHeldPreflight,type AcceptanceBoundary} from '../src/cn-maintenance-host/acceptance_contract';
const held:AcceptanceBoundary={phase:'production-held-readback',lockRetained:true,writesHeld:true,testDataScopeApproved:false,publicResumeAuthorized:false};
describe('maintenance acceptance boundaries',()=>{
 for(const journey of ['login','hello','asr','skillTool','pdfDownload'] as const)it(`rejects ${journey} under the all-writer barrier`,()=>expect(()=>assertJourneyBoundary(journey,held)).toThrow('HELD_WRITE_JOURNEY_FORBIDDEN'));
 it('authenticated feedback GET can touch session state and cannot run under held barrier',()=>expect(()=>assertJourneyBoundary('githubFeedbackRead',held)).toThrow('HELD_WRITE_JOURNEY_FORBIDDEN'));
 it('cannot report held PASS after releasing ordinary writers',()=>expect(()=>assertJourneyBoundary('githubFeedbackRead',{...held,writesHeld:false})).toThrow('HELD_READBACK_WRITES_RELEASED'));
 it('public flows require explicit resume authorization, test scope and retained lock',()=>{
  const publicBoundary:AcceptanceBoundary={...held,phase:'production-public',writesHeld:false,testDataScopeApproved:true,publicResumeAuthorized:true};
  expect(()=>assertJourneyBoundary('hello',publicBoundary)).not.toThrow();
  expect(()=>assertJourneyBoundary('hello',{...publicBoundary,publicResumeAuthorized:false})).toThrow('PUBLIC_RESUME_AUTHORIZATION_REQUIRED');
  expect(()=>assertJourneyBoundary('hello',{...publicBoundary,testDataScopeApproved:false})).toThrow('TEST_DATA_SCOPE_REQUIRED');
  expect(()=>assertJourneyBoundary('hello',{...publicBoundary,lockRetained:false})).toThrow('MAINTENANCE_LOCK_REQUIRED');
 });
 it('isolated success cannot carry production resume authority',()=>expect(()=>assertJourneyBoundary('hello',{...held,phase:'isolated-candidate',testDataScopeApproved:true,publicResumeAuthorized:true})).toThrow('ISOLATED_PROOF'));
 it('refuses bootstrap fallback even if its output claims ready',()=>expect(()=>rejectLegacyHeldPreflight()).toThrow('HELD_PREFLIGHT_CONSUMER_NOT_IMPLEMENTED'));
 it('does not misclassify a generated PDF journey as a read-only download',()=>expect(maintenanceJourneyEffects.pdfDownload).toBe('writes'));
});
