# Search candidate isolation (#5473)

An owned real report's first chapter recovery query returned HTTP 200 with a
`results` array. Validation failed at `results[2].snippet` (`invalid_type`),
which converted the entire search into `RESEARCH_SEARCH_UNAVAILABLE`.

The adapter now validates the envelope, then each row using the existing shared
candidate schema. Valid rows retain their original order, title, URL and excerpt.
All malformed rows, malformed envelopes and unsafe source URLs still fail under
their existing boundaries. Source relevance, verbatim quotes, document hashes,
report quality, retries and attempt limits are unchanged.

## Evidence

- RED: 4 failed / 45 passed in the affected search suite.
- After implementation: affected suite 49 passed; research pure suite 26 files,
  583 tests passed; API typecheck, lint and diff check exited 0.
- Independent review ran the same affected suite: 49 passed.
- A fresh real request to the same failed query returned HTTP 200 with 11 rows
  and the same invalid snippet path. The fixed adapter returned 10 legal candidates.
  This request used no model or document reads.
- Exact offline replay of that saved response: old whole-array validation failed,
  new adapter returned 10 legal candidates; title/URL/excerpt correspond to the
  original valid rows without invented content. Network/model calls were zero.
  Payload SHA-256:
  `13a12358f0ed9545c4b398911ebb34cddcc3f26f720030afefdc7fb19f8bdc75`.

The first observed response had 12 rows; its safe failure metadata remains, but
the original raw payload was overwritten by the later diagnostic request. The
exact replay above is of the preserved 11-row response, not the original 12 rows.
The raw public source response is kept privately outside Git.

## Limits

Legal candidates are not accepted research evidence. The owned full report still
has no formal pass (0 of 3 required topics). This change fixes one search failure
boundary; it does not certify source relevance, overall latency, other failures,
or recovery of the deployed production session.

Run the affected suite from `apps/api`:

```sh
./node_modules/.bin/vitest run --config vitest.research-unit.config.ts tests/research/google-guided-search.test.ts
./node_modules/.bin/vitest run --config vitest.research-unit.config.ts
./node_modules/.bin/tsc --noEmit
pnpm run lint
```
