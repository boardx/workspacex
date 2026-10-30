TAP version 13
# Subtest: only identical trusted same-repository promotion is admissible
ok 1 - only identical trusted same-repository promotion is admissible
  ---
  duration_ms: 0.579916
  type: 'test'
  ...
# Subtest: current-attempt successful evidence cannot be skipped, stale or rerun
ok 2 - current-attempt successful evidence cannot be skipped, stale or rerun
  ---
  duration_ms: 1.243916
  type: 'test'
  ...
# Subtest: accepts complete independent evidence
ok 3 - accepts complete independent evidence
  ---
  duration_ms: 1.706458
  type: 'test'
  ...
# Subtest: API errors fail closed
ok 4 - API errors fail closed
  ---
  duration_ms: 0.386084
  type: 'test'
  ...
# Subtest: policy changes fail closed
ok 5 - policy changes fail closed
  ---
  duration_ms: 0.077667
  type: 'test'
  ...
# Subtest: missing evidence fails closed
ok 6 - missing evidence fails closed
  ---
  duration_ms: 0.098333
  type: 'test'
  ...
# Subtest: failed evidence fails closed
ok 7 - failed evidence fails closed
  ---
  duration_ms: 0.130958
  type: 'test'
  ...
# Subtest: attempt evidence fails closed
ok 8 - attempt evidence fails closed
  ---
  duration_ms: 0.048917
  type: 'test'
  ...
# Subtest: expired evidence fails closed
ok 9 - expired evidence fails closed
  ---
  duration_ms: 0.605792
  type: 'test'
  ...
# Subtest: stale evidence fails closed
ok 10 - stale evidence fails closed
  ---
  duration_ms: 0.071625
  type: 'test'
  ...
# Subtest: artifact-missing rejected
ok 11 - artifact-missing rejected
  ---
  duration_ms: 0.232375
  type: 'test'
  ...
# Subtest: artifact-ambiguous rejected
ok 12 - artifact-ambiguous rejected
  ---
  duration_ms: 0.238209
  type: 'test'
  ...
# Subtest: duplicate-jobs rejected
ok 13 - duplicate-jobs rejected
  ---
  duration_ms: 0.099667
  type: 'test'
  ...
# Subtest: partial-matrix rejected
ok 14 - partial-matrix rejected
  ---
  duration_ms: 0.077292
  type: 'test'
  ...
# Subtest: workflow-disabled rejected
ok 15 - workflow-disabled rejected
  ---
  duration_ms: 0.029333
  type: 'test'
  ...
# Subtest: unrelated conditional skipped job permitted
ok 16 - unrelated conditional skipped job permitted
  ---
  duration_ms: 0.116459
  type: 'test'
  ...
# Subtest: stale PR payload rejected
ok 17 - stale PR payload rejected
  ---
  duration_ms: 0.035375
  type: 'test'
  ...
# Subtest: interleaved-rerun rejected at final admission
ok 18 - interleaved-rerun rejected at final admission
  ---
  duration_ms: 0.099541
  type: 'test'
  ...
# Subtest: new-failed-run rejected at final admission
ok 19 - new-failed-run rejected at final admission
  ---
  duration_ms: 0.110584
  type: 'test'
  ...
# Subtest: artifact count overflow rejected
ok 20 - artifact count overflow rejected
  ---
  duration_ms: 0.046375
  type: 'test'
  ...
# Subtest: pending producer blocks promotion
ok 21 - pending producer blocks promotion
  ---
  duration_ms: 0.045167
  type: 'test'
  ...
# Subtest: failed producer blocks promotion
ok 22 - failed producer blocks promotion
  ---
  duration_ms: 0.044166
  type: 'test'
  ...
# Subtest: changed policy permits full fallback
ok 23 - changed policy permits full fallback
  ---
  duration_ms: 0.033583
  type: 'test'
  ...
# Subtest: changed tree permits full fallback
ok 24 - changed tree permits full fallback
  ---
  duration_ms: 0.034125
  type: 'test'
  ...
1..24
# tests 24
# suites 0
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 51.569959
