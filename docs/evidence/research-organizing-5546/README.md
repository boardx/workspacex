# #5546 report-generation repair — full UI acceptance passed; release validation in progress

The repair discards invalid model-authored prose citations without interrupting report generation. Surviving citations determine source metadata. Complete chapters retain every original question and still pass independent support, depth and evidence-gap review. Provider refusals exclude the affected evidence request; healthy evidence remains usable. Reviewers receive the full final paragraphs and selectable direct evidence, and explicit verdict labels prevent confusing missing evidence with a missing answer. Negative verdicts cannot change during format correction.

Accepted full-scope UI evidence: the initial formal report (version 2) contains four chapters and all 32 original questions, with 42 actual model calls. Its immutable actual responses reproduce the same chapter hashes and pass current final review guards offline; it predates the last protocol changes. The final-code full regeneration (version 10) was initiated from the normal UI and completed four new chapters, all 32 questions, with 38 paired calls (306–343). Seven invalid prose citations were discarded, and 66 valid chapter citations survived. No draft, error or quality warning remains. Current report hash is `47feb11dd4f015d4d64bfca8fb511254d837639b8138d5b6f9df3fa91ec0253d`; previous formal v9 hash is `203ecf860d17630d7ebe77b2e19bb46944c79a1b4106e994cef538e097ed2b59`.

Normal refresh preserved both hashes and 343 accumulated calls. The production report page now mounts the existing history reader, including during generation. Independent normal browser inspection confirmed separate complete current/previous documents; history has its own navigation and no current-report actions. Three UI files / 35 tests passed after a two-test red reproduction of the missing production mount; the full guided-research UI suite passed 31 files / 319 tests. Research API verification passed 36 files / 808 tests, API types/lint, and Web typecheck plus affected-component lint. Final release exited1 at four reproduced Bash3.2 compatibility failures in two unchanged harness scripts (206/208files,2475/2479tests passed); root owns their independent repair. The three temporary baseline dependency patches were restored byte-for-byte. Final validation and PR delivery remain in progress; no deployment or merge is claimed.

Historical v3–v6 and v8 failures, and v7/v9 normal continuation recovery, remain diagnostic evidence rather than independent complete regeneration successes. A history overwrite lost v2 from business state at v4; it was never restored from evidence files. The history guard now preserves the latest formal report across failures and retries. Final regeneration previous history is the genuine v9 report.

The new fixture preserves all four original chapters, 32 questions, four tasks and 23 raw source rows. It uses 19 freshly read public documents, retains four actual read failures, and revalidates existing source approvals/evidence records. It is a fresh same-scope fixture, not an exact export of historical source bodies; normal screening may exclude irrelevant/unavailable sources. No approved chapter, report or draft is copied.

- [Current full-scope causes, repairs and acceptance boundary](full-scope-repair.md)
- [Historical partial investigation](investigation.md)
- [Historical reduced seven-source model metadata](final-real-replay.txt)
- [Historical independent generation results](final-real-results.json)
- [Historical release gate log](verify-release.txt)
- [Current handoff](session-handoff.md)

The reduced seven-source partial first/regeneration runs below are historical failed experiments. They are not full-scope acceptance. Their first-runtime overwrite correction remains recorded in investigation.md; current full-scope first snapshots are independent and immutable.

## Historical partial replay

Run from repository root; use the existing approved model environment in a child shell. This reads public pages and calls the real model, capped at 60 calls. It writes private local runtime snapshots under /tmp, without storing credentials. It does not read or mutate the devapp database.

```bash
source scripts/real-model-env.sh
WORKSPACEX_ENV_FILE=/path/to/approved/model.env real_model_load_env_file "$PWD"
pnpm --filter @repo/api exec tsx ../../docs/evidence/research-organizing-5546/replay/read.ts
pnpm --filter @repo/api exec tsx ../../docs/evidence/research-organizing-5546/replay/report.ts
```

The report replay exits 1 unless both generations produce formal reports without drafts/quality warnings. Source pages may change; fixture hash comparisons expose that difference. The archived partial run is not accepted; current main authorization covers the fresh full-scope normal UI first/regeneration workflow described in full-scope-repair.md.

Offline full-fixture follow-up: see [full-fixture-feasibility.md](full-fixture-feasibility.md). Original approvals skip screening; prior seven-source partial replay is not equivalent. Test/evidence-only follow-up passes 717 unit tests and preserves same-source healthy chunks after a batch refusal. Historical source bodies remain unavailable as an exact export. Current same-scope fresh fixtures and immutable failure/diagnostic boundaries are described in full-scope-repair.md.
