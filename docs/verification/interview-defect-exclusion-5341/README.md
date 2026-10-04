# Actual defect-exclusion regression (#5341)

Original public attempts and source copied byte-for-byte from evidence commit 05c4bb4bc45d00fda7629dc3203e9caf1954b579 into tests/itv/fixtures/defect-exclusion-5341. They retain SHA256 63b3cab722eb3bf65265c61a87152c9e857a5636757e591df3d1247f3d563630 and 9de08f57258a2b8915c502a8c3dadbb724d9e2d83ad8f544e0a188ea0b1d0543. No model calls or original evidence changes.

Both actual reports inferred “而非设备的固有缺陷” from another successful installation scenario. Existing finite gate missed that predicate, despite prompt guidance. Original raw/source regression plus finite controls reproduced RED8/218. The gate now rejects explicit unsupported exclusion predicates, preserving scoped negation/uncertainty/hypotheses and attribution through actual source quotations.

A narrow observed result is allowed only when same-paragraph exact server-bound source records a method on the same inspected component and preserves its complete scoped clause. This finite recognized observation form is not an unrestricted semantic truth certificate. Ordinary success, participant opinions, planned tests, different objects, forged/unbound citations and extrapolation to all devices cannot supply this exception. A scoped observed result cannot waive another broader exclusion in the same clause (additional RED1/225). Prompt explicitly requires object/method/scope and leaves unexamined ranges unknown; merely improving guidance is not evidence of new model output.

Controlled API six files226/226 pass (green.txt). Original two reports are now rejected; no semantic laundering. Overall #5327 remains OPEN, and #5342/#5343 await separate fixes. Independent exact review and current-head CI required.
