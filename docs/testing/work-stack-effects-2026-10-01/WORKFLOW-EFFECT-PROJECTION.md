# Workflow effect projection regression (#4867)

The real W029 browser run completed all stages and finalized artifact.write and notify.inapp receipts, but GET projection returned effects: [] because buildProjection hardcoded an empty array.

Projection now folds effect events in its existing tenant-scoped, locked snapshot. Identity is (stageId, effectKey); finalization and recovery statuses preserve recorded provenance. Permission-block events cannot create effects. A begun-only prefix stays begun, and no later receipt read can advance it beyond lastSeq. Existing visibility checks remain before projection.

EffectGateway records the same actual execution provenance used by its finalized receipt into begun/finalized events. gateId comes from that provenance's approvalRequestId, never an arbitrary preceding approval. For historical events, actor identifiers come from the frozen instance; missing gate and skill provenance remain null. skillVersion and finalizedAt remain null because the current event/receipt port does not authoritatively expose them. Event creation time is not misrepresented as receipt finalization time.

Validation: the new target suite failed 5/5 on the original source, then passed 5/5 after the fix. It exercises gateway-to-projection provenance, begun snapshot prefixes, deduplication and same key in different stages, reconciled/unresolved statuses, historical null provenance, permission blocks, and tenant/owner visibility. Logs are archived beside this document. No full typecheck, database run, or actual provider/browser run was performed by this subtask; the integration owner continues the existing strong W029 browser assertions (one finalized persist artifact.write and one finalized notify notify.inapp).
