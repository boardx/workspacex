# Squash provenance regression (#5790)

The exact `4cc236c75cdc09f16bbdff1ac76ce90d377222c8` → `9755d770c61ee7abd2b2cc189d48a65c5d9e6ed8` transition returned one F04 `attestation_unverifiable` finding before this fix. `before.json` retains that diagnostic; `after.json` records zero findings with the same pair and unchanged historical evidence.

The witness `53ba99bd780be3db298aa580ca9f6ba3dd0c6792` is an ancestor of source `6c439585da13e15fb65a097f04b54408a02f1589`. That source and the squash commit have the identical complete tree `bba97b060ab5521a1605c79d8339a105ec4a68cf`. The new proof additionally requires that the equivalent tree contain the current exact evidence blob at its current path. An old common tree, another log version, or another path cannot supply this proof. Git query failures reject it. Fingerprint, rewrite, duplicate-evidence and existing missing-object handling are unchanged.

Validation: `pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/lint-feature-transition.test.ts .harness/scripts/lib/feature-transition.test.ts` — 45/45 passed. Fixtures cover real squash, downstream commits, different source trees, unrelated witnesses, forged fingerprints, common-base reverts, query failures and cache separation by evidence path/blob. No database, payment behavior, deployment or permissions changed.

Reproduce the exact transition with `node --import tsx .harness/scripts/cli.ts lint-feature-transition --base 4cc236c75cdc09f16bbdff1ac76ce90d377222c8 --head 9755d770c61ee7abd2b2cc189d48a65c5d9e6ed8 --json`.
