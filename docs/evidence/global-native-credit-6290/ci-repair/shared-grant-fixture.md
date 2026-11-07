> Historical parallel-head evidence for e3816dd478d39239d39882f2fc3c1ac9c06e4d42. Its selected test name/schema differ from the retained reviewed integration. Current integration keeps the stronger private-schema ACL test with explicit result guard and simultaneous public-validator assertion; ordered image9/backfill7/ACL1 passed before the type-only guard. This document does not claim the historical command was run on the final merge tree.

# Shared-role grant gate repair

At b3124e3, verify-control-plane failed because the permission-corruption test
granted UPDATE on the shared application view to app_rw. The remaining five
harness jobs were cancelled by the workflow failure policy.

The test now creates catalog objects in its own transaction-local schema, checks
that the production cutover validator accepts their correct permissions, then
grants UPDATE on only its own view and verifies the same validator rejects it.
Rollback removes the schema and all grants. The shared application view's UPDATE
privilege remains denied. No allowlist or production behavior was changed.

Verification:

- Shared-grant lint reproduced the original violation, then passed with zero new
  shared-role violations after the change.
- Exclusive PostgreSQL test selected by `-t 'repeat migration validates permissions'`
  passed: 1 selected test passed; 14 other file tests were not selected. See
  `permission-fixture.log`. Full force-replay coverage remains in CI.
- `git diff --check`: passed. Isolation wrapper cleaned its owned stack.
