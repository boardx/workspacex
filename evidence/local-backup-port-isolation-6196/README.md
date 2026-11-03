# Local-runtime real backup fixture isolation — #6196

At developdfdaa47035fae59505c3be114aeb3da5f1eb2b13, the unmodified real A→B roundtrip passed with free ports (1/1,7.00s). Holding55492 with an owned sentinel reproduced the candidate's exact bind failure (4.19s), while that sentinel stayed listening and was closed only by its owner. CI did not capture the occupying process; its identity remains unknown.

The wrapper now reports the actual bound port published by pglite-socket0.2.11. Its existing explicit-port refusal stays intact; port0 binds atomically without selecting/releasing a candidate port. The roundtrip requests port0 for each operation and uses independent client/server finally boundaries, including connect failure and end failure. No resource discovery/kill, retry, timeout increase or change to #6195's fetcher is added.

Evidence:

- baseline-free.txt / baseline-occupied.txt: original source control and owned-port counterexample.
- port-red.txt: actual dynamically bound endpoint incorrectly reported as0 before correction.
- lifecycle-red.txt: connect and end failure leave an owned listener alive before cleanup correction; callback failure already passed.
- target-green.txt: initial endpoint/lifecycle/realroundtrip5/5 passes after correction, before adding the explicit-port ownership compatibility test.
- fixed-occupied.txt: same real roundtrip passes1/1 while owned55492 sentinel remains alive, then owner closes it.
- package-green.txt: final43files/255tests pass, including all6tests in the3changed/new test files.
- typecheck.txt / lint.txt / init-final.txt: final package typecheck, standard lint and baseline initialization exit0. Package lint is the repository's existing no-op script; full normal-push hook evidence is tracked separately.
- ci-failure-excerpt.txt: original candidate failure, without attributing its port owner.

Reproduce with `node evidence/local-backup-port-isolation-6196/verify-occupied-port.mjs`. It fails rather than touching any preexisting owner if55492 is occupied before the check. The script starts only its own sentinel and the original real roundtrip spec. The full package command is `pnpm --filter @repo/local-runtime test`; typecheck uses the matching package script.

Original assertions remain: dumpBytes>1000, backup manifest37chat_threads, restored37chat_threads and1organization in a new directory. The removed no-op reopen had no assertions; real backup reopening and destination SQL reads still run. Only the roundtrip fixture is migrated; unrelated local-runtime fixtures keep their existing port conventions. No Next, Docker or browser stack was started for this maintenance.
