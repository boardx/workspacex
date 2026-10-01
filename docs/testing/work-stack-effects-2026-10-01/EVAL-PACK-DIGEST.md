# EV05 imported pack fixture mismatch — #4867

CI's `eval-all-skills-real-pack-digest.test.ts` imported immutable work-research 1.0.0 while the filesystem evaluator ran S003 source 1.0.1. The 409 WORK_EVAL_DIGEST_MISMATCH was correct protection, not a production digest bug.

Using the existing digest functions:

- Current S003 source and generated work-research 1.0.1: `sha256:7b5be5eda90cc8e90e484d57166604dd406e43a06ed570510a2b06cc36bbd7bd`.
- Historical work-research 1.0.0 S003: `sha256:180e71f8e550429926ae8aacd543de0404efdd6c76c2f3b54ff7ce34a36a0cf5`.

The fixture now imports PACK_ID/PACK_VERSION from the existing research builder and asserts the actual published database digest matches the source before HTTP write-back. A second assertion preserves the fact that the immutable old pack's digest differs from current source. No runtime digest, role pin, or historical pack was changed.

Verification: the isolated PostgreSQL and HTTP target test passed 2/2, exit 0. Evidence: `eval-pack-digest-db.log` (trailing whitespace normalized). Project `wsx-1f313c10f9a4f775ecca` was cleaned by the isolation wrapper; subsequent Docker container and volume lookups for that project returned empty. No full typecheck or broader database rerun was performed in this subtask.
