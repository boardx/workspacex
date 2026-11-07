# PR 6369 isolated route fixture compilation

Current-head CI verify-full-compile job 128287248821 failed with TS2322: the legacy-route fixture used materials before the separate PR 6372 contract introduced it. The fixture now retains its existing default source policy (prioritize) while preserving the missing-source error, empty sources, pending tasks, fresh legacy URL, restored research stage, alert, and no-autoexecution assertions. Production behavior is unchanged; materials coverage stays in PR 6372.

- Exact prior head: d81af00cd6741a7736d568371b5ceaa75db1af4d.
- Scoped TypeScript RED reproduced the same TS2322, then GREEN exit 0.
- Actual route/flow component regression: 56 tests across 2 files, exit 0.
- Independent read-only review accepted the fixture isolation, no casts or deleted assertions.
- Local logs: /tmp/fix-6369-ci-d81a/{red-types.log,green-types.log,green-tests.log}. Required final-head CI and merge-group gates remain mandatory; this is not a new CUA or real-model run.
