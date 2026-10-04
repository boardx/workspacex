# Counterexample-first boundary label (#5340)

Fresh main base246abb59ca5f4d941ac5663d904da4deb215effc. Public unchanged report (integration original evidence05c4bb4bc) contains explicit “反例与边界” label and concrete successful installation counterexample. Existing structure gate recognized “边界与反例” and “反例”, but not this equivalent label order.

One regex alternative change: anchored 反例 becomes 反例(?:与边界)?. No AST, heading/prose extraction, threshold, action/evidence identity, API/error/schema/hash or saved-report state changes.

Four labels (plain/bold list/heading/CRLF heading) RED4/45→GREEN49; six controls keep empty heading, heading followed only by code, fenced/inline code, incidental prose and link URL from supplying boundary analysis. Existing converse-label cases still pass. Full controlled API192 pass, contracts typecheck exit0. Fresh base does not contain separate #5338/#5339 fixes; these192 are this exact branch, not integrated totals.

Offline assessment of BOTH complete original raw attempts now returns analysis ok/missing[] with byte hashes63b3cab722eb3bf65265c61a87152c9e857a5636757e591df3d1247f3d563630 and9de08f57258a2b8915c502a8c3dadbb724d9e2d83ad8f544e0a188ea0b1d0543 unchanged. `public-analysis.json` is new offline structure assessment, not the original85ec generation/validation result. No original evidence overwritten or new model/storage API called.

Structure ok is NOT exact quotation/finite claim/semantic approval. Overall public semantic FAIL with #5341/#5342/#5343, #5327 OPEN, original private cause UNKNOWN; other finite parser issues #5338/#5339/#5346 separate. No merges/deploys/new models.
