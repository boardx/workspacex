# Report bounded repair retention (#5320)

The report stream clears its current accumulator when the next bounded attempt starts. Preserve the prior candidate as a separately labelled preview until new deltas arrive, and read the server's saved candidate once per repair attempt. Reject late snapshots that regress the report document version, omit the saved document, or conflict with its hash at the same version. A running repair does not expose a second retry action. Failed validation remains failed.

## Verification

- Before fix: report route remount/repair retention regression failed (1 failed, 14 passed).
- Version/hash regression failed before the guard (1 failed, 15 passed).
- After fix: execution UI, report stream and source report suites: **29/29 passed**.
- Web TypeScript check passed; git diff --check passed.
- Fixtures are synthetic. UI fixture hashes are synthetic equality markers, not database hash proof.

## Limits

The original devapp report's action-validation rejection cause is unknown. Browser access to that original report stopped on request-header policy failure; no authentication extraction or original regeneration was attempted. Public health response did not expose a deployment SHA. This change does not relax report action, quality, grounding, provenance or CAS requirements. Browser/real API bounded-repair evidence remains to be collected independently.
