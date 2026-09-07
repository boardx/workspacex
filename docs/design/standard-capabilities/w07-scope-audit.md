# W07 scope audit against the 75-capability catalog

Decision: do not add a new graph-seed resolver, interview index producer, or cross-interview consent aggregation as part of the standard-tool adapter work. This decision narrows implementation work; it does not relabel unsupported sources as covered.

## Requirement anchors

- `capability-catalog.json:762` WX-T016: authorized source retrieval, real version/citation, withdrawal exclusion, tenant/project counterexamples, and failure distinct from zero hits. Its explicit scope removes rebuilding existing knowledge/project/canvas domain logic.
- WX-T017 immediately follows: source bytes/version/locator consistency and current permission revocation. It does not request graph resolution or new ingestion domains.
- `capability-catalog.json:1526` WX-S001, `:1715` WX-S008, `:1792` WX-S011, `:1874` WX-S014 reuse existing knowledge/project facts and require explicit unknowns when evidence is unavailable. None specifies all interview sources or graph-seed discovery.
- `five-round-delivery-plan.md:45` later mentions five-channel retrieval/rerank. That implementation plan is not an additional capability requirement. The implemented hybrid profile runs the existing query planner and reports the actual planned channels, rather than inventing an always-five trace.

## Existing implementation boundaries

`application/retrieval/retrieve-candidates.ts` accepts `graphSeeds` from a caller and calls the existing graph channel. A source search found no production graph-seed resolver. The hybrid adapter explicitly refuses plans needing unresolved graph seeds, before provider execution. Ordinary FTS remains available.

`application/interview/consent-gate.ts` checks roster consent for starting an interview/recording. It is not a general permission decision for exporting historical interview text to an external reranker. `application/interview/subject-ports.ts` exposes current guarded `latestFor`/`latestSubmissionMeta`, while `PgConsentSnapshotRepository.findBySubject` explicitly selects the original historical snapshot. A historical acceptance must not be substituted for current AI-analysis consent. Interview retrieval would additionally need canonical session/subject attribution and its domain visibility rules; adding that pipeline is outside the 75 catalog's adapter requirements.

Current organization knowledge output explicitly reports `coverage: primary-file-index`. It excludes interview subjects, private/pending/revoked/confidential/synthesized sources before reranking. These exclusions remain real limitations, not an assertion of complete organization-source coverage. See `evidence/WX-T016/hybrid/README.md` for actual PG/HTTP/SDK verification and deployment boundaries.

No production code was changed for this scope audit. No readiness/passing or human signoff state was edited.
