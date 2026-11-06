# Integration evidence — #6298

Current source is stacked on image PR6297 exact2a7b6331d37a9d808fd00a9de961749e8c393b58. The earlier6d16 generic-all-model design is superseded; its local/CI results do not verify this new dual-source integration.

The nonimage1700 migration excludes every bailian-image key, reuses the image writer, and exposes only a read-only UNION compatibility view. Native platform organization/image writes reject explicitly. Image CAS service, fixed-price helper and three customer prices remain the approved base. The activation CLI now uses its existing global GET/CAS PUT endpoint, explicitly rejects old organization scope and unknown arguments, verifies the quote and readback, and skips a matching schedule without another audit. Tests change old direct fixture writes only where the new app-read-only/view contract requires it; image payer coverage expands without changing prices.

## Executed verification (2026-11-05)

Business source exact `2fd9cd70484e4e5393f626394088ffd4855ef1ea`. These local results do not establish PR/merge-group CI green.

| Batch | Actual result | Evidence |
| --- | --- | --- |
| A1 consumption settings, pure HTTP | 4/4 pass at807767523 | Vitest credit-runtime config; no database |
| A2 image quote/service/repository/fixed-price helper/CLI | 35/35 pass, 5 files at42ab88c85 | Vitest image config; mock HTTP only |
| A3 native tariff UI | 16/16 pass at42ab88c85 | One web Vitest worker |
| A4 metadata permissions | 97/97 pass at2fd9cd704 | `/tmp/global-native-6298-A4-2fd9.log` |
| A5 migration scope | 2/2 pass at2fd9cd704 | `/tmp/global-native-6298-A5-2fd9.log` |
| B real commercial PG | 71/71 pass, all five selected files executed; 71.75s | `/tmp/global-native-6298-B-2fd9.log` |
| C exclusive native/force PG | 22/22 pass, both selected files executed; 110.91s | `/tmp/global-native-6298-C-2fd9.log` |
| D migrate:check | 458 migrations applied from empty; complete force replay, identical schema digest and populated data | `/tmp/global-native-6298-D-2fd9.log` |

Earlier green A1–A3 were not repeatedly rerun after the final comment-only change. Temporary log paths are local receipts, not uploaded CI artifacts. Normal affected typecheck/lint pre-push and updated source CI have not run yet.

B executed serially with one worker: root-provider chain16, usage repository15, native quota ledger15, credit consumption16, global image tariff9. No selected file was excluded or silently skipped. Isolated database `wsx_23ced1c901cca24f7a72`, compose `wsx-23ced1c901cca24f7a72`, run `run-mw3ld9w4-9f945d4c-23ced1c901cc`; wrapper cleanup1s, independent Docker project-label readback found zero remaining containers.

C executed native tariff7 and force replay15. Both complete force passes ran (32.157s and38.055s, unchanged60s per-case budget). Each compared current native price/audit, image schedule/audit and both request snapshots against its pre-replay digest, then verified default migrate applied no files and the original historical SQL checksum stayed unchanged. Old request settlement still debited its frozen25 hundredths. Actual personal/team/new-organization reservations, wallet isolation, app/legacy/view write rejection and malformed constraint/audit-trigger counterexamples passed. Isolated database `wsx_84b991caabbef94052ee`, compose `wsx-84b991caabbef94052ee`, run `run-mw3lit98-550ae2cd-84b991caabbe`; wrapper cleanup2s and independent label readback found zero containers.

D used isolated database `wsx_6c9a29db39cd9f11acde`, compose `wsx-6c9a29db39cd9f11acde`, run `run-mw3lrods-8be7b407-6c9a29db39cd`. It also verified the populated replay fixture, byte-identical legacy prototype version, append-only prototype behavior and every migration recorded. Command1m11s, cleanup2s; independent project-label readback found zero containers.

## Failed iterations retained

Each batch stopped at its first nonzero; subsequent commands waited for a reviewed fix and a fresh resource window.

- At807, A2 had27 pass/1 fail: the image-base CLI still sent per-org image PUTs to the now-strict native DTO. The fix uses the existing global image CAS, without weakening the native contract or changing fixed prices.
- Ateda91, A2 had34 pass/1 fail: unknown-argument rejection read a nonexistent credential file first. Argument validation now precedes credential reads; the counterexample remains strict.
- At42ab88, A4 had96 pass/1 fail: the existing permission scanner interpreted comment text “from the” as a SQL table. Only that comment was reworded; queries, scanner, assertions and allowlists were unchanged.
- Before this integration, missing0900 suffix caused release/Linux recovery failure and simulation(all) aggregation failure; historical force replay attempted ALTER on a view. Reviewed1600→1700 scope and verified-cutover-only historical replay mapping address those failures. C/D provide the new dynamic replay evidence above.

This PR verification performed no merge, deployment, production writer/schema changes or price activation. Earlier in this coordinated session, CN/US received root-private PENDING_NOT_BOUND retail snapshot files with successful readback; those prepared files remain unbound and do not establish active runtime tariffs. Devapp's earlier18org emergency ASR restoration and successful user retest remain historical incident evidence; the global cutover must be released before newly created organizations inherit the global ASR price. Estimated supplier receipts still do not prove an authoritative final debit.

## Concurrent remote integration

Normal push of83ab4a870 ran the mandatory affected typecheck/lint hook successfully (27/27 tasks,12 cached,6m13.761s), then Git rejected the write because the remote had advanced to ec79ab60e8963f2cf719a36cba6e67db2ec2a46b. No forced push was used. That remote is retained at refs/backup/global-native-6298-remote-ec79 and merged normally to preserve its history and accepted develop localization. Its superseded no-compatibility evidence remains explicitly marked historical.

The integration preserves every API, contract, migration and fixture byte of the tested83ab financial tree, including the absence of0900; A/B/C/D receipts above therefore continue to describe those same financial implementations. Only the native admin panel combines the accepted localization with its existing millisecond default and explicit image-CAS refusal. That UI delta needs a focused UI rerun and the next normal affected hook; no new PG test result is claimed for a changed financial implementation.
