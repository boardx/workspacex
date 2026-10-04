# Report bounded repair retention (#5320)

The report stream clears its current accumulator when the next bounded attempt starts. Preserve the prior candidate as a separately labelled preview until new deltas arrive, and read the server's saved candidate once per repair attempt. Reject late snapshots that regress the report document version, omit the saved document, or conflict with its hash at the same version. A running repair does not expose a second retry action. Failed validation remains failed.

## Verification

- Before fix: report route remount/repair retention regression failed (1 failed, 14 passed).
- Version/hash regression failed before the guard (1 failed, 15 passed).
- After fix: execution UI, report stream and source report suites: **29/29 passed**.
- Web TypeScript check and normal pre-push lint passed; git diff --check passed.
- Independent review ACCEPT on bc0dec167f180035c3c81fcf7e9edc1a3e37ea19.
- Repository Playwright browser regression passed: `report repair retains saved candidate through failure and refresh`. Uses controlled NDJSON and routed synthetic envelopes against the local application, not a model or DB validation claim. Screenshots cover attempt 2, failed terminal state and refreshed persisted fixture. New deltas are independently accumulated; running repair exposes no retry; the candidate fixture retains the calculated raw SHA256 across refresh.
- Fixtures are synthetic. UI fixture hashes are synthetic equality markers, not database hash proof.

## Limits

The original devapp report's action-validation rejection cause is unknown. Browser access to that original report stopped on request-header policy failure; no authentication extraction or original regeneration was attempted. Public health response did not expose a deployment SHA. This change does not relax report action, quality, grounding, provenance or CAS requirements. Real API/provider bounded-repair evidence remains to be collected independently.
