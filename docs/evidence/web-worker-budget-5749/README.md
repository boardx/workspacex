# Opt-in Web test worker budget — #5749

The preceding full release run on215152fa8 failed in Web during a recorded201-second macOS thermal sleep. Several unrelated tests reported approximately196seconds. Its feature9/harness2506/API15136 results passed; it is not a passing release certificate. Original failure and correlated power events are retained in sprint03/evidence/F03.verify.log and F03.host-sleep.log. The same two files passed unchanged in isolation(29tests).

Add optional WORKSPACEX_WEB_TEST_MAX_WORKERS (canonical integers1–16). Unset preserves default behavior; a configured limit sets Web maxWorkers and minWorkers1. No test scope, timeout, retry, product behavior, API worker setting, or OS protection changes. Turbo test.env propagates and hashes this input without loosening environment isolation.

Focused29tests passed with budget2. Zero was explicitly rejected before collection(exit1 expected), not accepted as a way to suppress tests. Turbo dry-run showed the original command `vitest run` and the budget variable in specified/configured hash inputs. Full Web/type/lint verification remains pending at this source commit.
