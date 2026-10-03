/** Actual browser journeys are not interchangeable with held readback probes.
 * Authenticated login may persist sessions/audit; ASR includes service activity.
 * Treat unknown side effects conservatively, never grant a writer capability. */
export const maintenanceJourneyEffects = {
 login: 'writes-or-unproven', hello: 'writes', asr: 'writes-or-unproven',
 githubFeedbackRead: 'read-needs-authenticated-api', skillTool: 'writes', pdfDownload: 'writes',
} as const;
export type MaintenanceJourney = keyof typeof maintenanceJourneyEffects;
export type AcceptancePhase = 'isolated-candidate' | 'production-held-readback' | 'production-public';
export interface AcceptanceBoundary {
 phase: AcceptancePhase;
 lockRetained: boolean;
 writesHeld: boolean;
 testDataScopeApproved: boolean;
 publicResumeAuthorized: boolean;
}
/** Admission constraint only: does not execute/resume writers or certify a PASS.
 * Isolated fixtures and post-resume production receipts must remain distinct. */
export function assertJourneyBoundary(journey: MaintenanceJourney, boundary: AcceptanceBoundary): void {
 if (!Object.hasOwn(maintenanceJourneyEffects, journey)) throw Error('UNKNOWN_ACCEPTANCE_JOURNEY');
 if (!boundary.lockRetained) throw Error('ACCEPTANCE_MAINTENANCE_LOCK_REQUIRED');
 if (boundary.phase === 'production-held-readback') {
  if (!boundary.writesHeld) throw Error('HELD_READBACK_WRITES_RELEASED');
  if (maintenanceJourneyEffects[journey] === 'read-needs-authenticated-api') throw Error('HELD_AUTHENTICATED_API_UNAVAILABLE');
  throw Error('HELD_WRITE_JOURNEY_FORBIDDEN');
 }
 if (!boundary.testDataScopeApproved) throw Error('ACCEPTANCE_TEST_DATA_SCOPE_REQUIRED');
 if (boundary.phase === 'production-public' && (boundary.writesHeld || !boundary.publicResumeAuthorized)) throw Error('PUBLIC_RESUME_AUTHORIZATION_REQUIRED');
 if (boundary.phase === 'isolated-candidate' && boundary.publicResumeAuthorized) throw Error('ISOLATED_PROOF_CANNOT_AUTHORIZE_PRODUCTION_RESUME');
}
/** Existing collector starts a bootstrap container/new role connection. It is not
 * a held readback consumer; no ordinary provision fallback is permissible. */
export function rejectLegacyHeldPreflight(): never {
 throw Error('MAINTENANCE_HELD_PREFLIGHT_CONSUMER_NOT_IMPLEMENTED');
}
