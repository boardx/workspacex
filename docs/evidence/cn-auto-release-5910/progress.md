# Issue #5910 progress — 2026-10-24 Asia/Shanghai

User authorized develop integration and China production release, then explicitly
requested main-cn push deployments without human approval.

## Verified preparation

- Integrated develop ef950098e982a1f807e6e7daa9bdbc8ed9356620 and main
  d98613266de68a57c9b73b471fd547ffb81092dc. Preserved main-only edits;
  resolved the interview whole-record/per-question fold conflict in favor of the
  reviewed develop behavior, including the tests left behind by automatic merge.
- Included the exact reviewed credit-runtime entry repair from PR #5906.
- Integration review ACCEPT at cfee6556d955062991e864a45b97b0b1f465abe4.
- Normal init passed. Static typecheck/lint: 54 tasks passed (50 cached).
- Interview: 29 tests. Credit runtime: 26 tests. Config reachability: 59 configs.
- Automatic trigger/offline-source tests: 19. Promotion identity/workflow tests: 62.
  Preparation/rollback boundaries: 25. Logs are adjacent, with explicit fixture
  boundaries; these are not production acceptance.
- GitHub GraphQL strict self-CAS was accepted on a disposable non-production ref;
  the temporary ref was deleted. No production ref was changed by that probe.
- Optional full-init was stopped during absent-pattern Playwright server startup;
  it did not finish and is not a full-regression pass. Its exact isolated compose
  project wsx-8e69902b4bf7a4926626 was downed with volumes after stopping its owned
  process tree. No other compose projects were removed.

## GitHub live state observed

production-cn-promotion required_reviewers was removed with user authorization.
Branch/tag allowlists remain. main-cn required_deployments is still present until
matching automatic workflow code is reviewed and installed. Baseline main-cn:
ba6343199f3c834d6a198f83d0c771614292c82b.

Read-only capability run 39984754226 succeeded: production runner online, several
newer fixed-release entrypoints absent, deploy entry root-owned mode 0700 and its
bytes unverified by the unprivileged probe. Diagnostic run 39986781990 actually
started without approval but rejected protected metadata with PermissionError.
It cannot establish runtime readiness or justify bypassing preparation checks.

## Still required

Exact final review and PR CI; merge; matching branch rule update; desired ref
synchronization; successful prepare, immutable-tag promotion, production/browser
acceptance. Existing develop Chat failures remain unresolved release evidence;
no successful preparation, deployment or production acceptance is claimed.
