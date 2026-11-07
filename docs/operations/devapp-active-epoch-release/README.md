# DevApp active-epoch compatible release

Issue #6131 fixes deployment of immutable tag `41474708224-1`, source
`4581a58a1f002c39db28f04155a1d5436b78280f`. It is a fixed capability, not a
caller-configurable migration runner.

The original input drift was solely the authorized Web pricing UI environment
flag. A private backup and exact structural comparison were made before adopting
its new Compose hash; every other pinned input matched. No financial reset or
pricing epoch change is part of this release.

The adapter reuses the existing stopped-five-application, encrypted backup,
native no-force migrator, verified old-application forward compatibility,
candidate browser probe, independent verifier and bounded recovery protocol.
The root-owned policy pins the complete executable closure, exact candidate
images and schema plan, original 447-entry historical ledger, active epoch row
including its original activation timestamp, original live application IDs and
canonical lock. Only the three reviewed missing SQL files are accepted. A fresh
attempt requires BASELINE, and partial/unknown state requires reconciliation.
The capability cannot use the old eight-migration or dormant-epoch resume.

During the stopped migration window, the writer captures and compares financial
state. Existing prices and paid terms are preserved; only precisely specified
new schema fields, numeric scale widening and the four approved Pro seed rows
are allowed. A known financial mismatch remains a hard rejection even when the
native migrator acknowledgement is lost and the ledger is COMPLETE. The
independent verifier consumes the hash-bound financial before/after proof.
Successful window verification does not prohibit later legitimate user payments.

Business probes own their process groups. A successful leader exit does not
replace proven group cleanup, and an unverified recovery cannot leave public
writers running. No restore rehearsal, credential change, new privilege,
historical checksum repair, price hardcode in application flow or image rebuild
is introduced.

Validation:

```
python3 -B -m unittest discover -s tests -p test_devapp_active_epoch_release.py
python3 -B -m unittest discover -s tests -p test_devapp_reviewed_tag_release.py
python3 -B -m unittest discover -s tests -p test_devapp_diagnostic_browser_probe.py
```

Fixtures prove guards and state transitions, not actual host deployment. Live
release evidence must independently report workflow, tag/source, schema ledger,
unchanged active epoch, exact runtime images and successful browser/business
probes. After success, separately adopt the verified 450-entry admission ledger
without overwriting the preserved 447-entry plan or original attempt histories.
