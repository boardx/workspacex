# Independent review

Read-only reviewer /root/review_report_pipeline examined current diff against 305c629c4 and approved design.

Initial P2: repeated quote occurrences/context-to-direct replacement caused final ranking dedup to remove IDs referenced by complete batch manifests. Added persisted round-trip RED tests, then preserve exact revalidated manifest-backed spans, bound by existing ledger limit; evict manifests when needed rather than weaken checks. Canonical facts are deduped separately before applying the limit.

Follow-up: reviewer confirmed P2 resolved, task priority preserves all sources, progress totals share batching authority, first prose excludes bare JSON envelopes. No additional concrete regressions found. Reviewer ran no tests or services; test evidence belongs to root execution.

Subsequent GitHub P2: call timeout included queued wait. RED80s waiting+89s work reproduced false timeout. Independent follow-up rejected naive budget-inside-permit implementation because timeout released the permit while an abort-ignoring provider still ran; second RED reproduced a fifth actual request. Final admission bridge starts the budget on admission while queue ownership lasts through actual provider settlement. Queue6 tests and full914 research tests pass. Reviewer found no further concrete defects in working-tree review; exact final SHA review follows on GitHub.

Final cancellation edge: a parent abort between permit grant and provider microtask incorrectly invoked work. RED reproduced started=true; budget.check before admit/work plus finally cleanup fixes it. Independent read-only review confirmed the guard. Final full915 and queue7PASS.
