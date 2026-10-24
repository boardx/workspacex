# Switch-boundary pause contract repair

The root legitimately returns `WAITING_FOR_A3_A4_EVIDENCE`, stage `switch`, with 13 completed
stages when evidence is withdrawn after switch staging. Checkpoint, begin(previous_pause) and
recover now consistently accept both `switch-stage` (12) and `switch` (13). Stage regression is
rejected; original root clocks, backup epoch, independent approval and no-replay rules remain.

`test_actual_root_switch_revocation_pause_recovery_and_explicit_resume` uses the actual root loop,
Router admission and checkpoint, phase API and loopback RPC. It saves the real 13-stage response,
recovers its exact bytes without submission, explicitly calls again while still revoked (still
waits), recovers that continuation with its predecessor, restores the same evidence, then requires
actual-hash A5 approval before the final explicit continuation and original A6 readbacks. It checks
17 unique root advances, unchanged clocks, no automatic writer approval and no duplicate RPC.
Protected filesystem/live gate observation and external stage execution remain fixture seams.

Frozen local regression: 22 suites / 230 tests plus both canonical bootstrap modes passed. Commands,
exit codes and original logs are in `results.json` and adjacent files. The previously documented
legacy conditional-writer container-ownership limitation is not weakened; all 12 of those tests
remain mandatory in GitHub CI. New source requires its own GitHub regression/Docker receipt; old
241-test receipts are historical only. No new CI success is inferred before that run.

A3/A4 is an independent approved evidence consumer, not a provider parser/restore executor.
The candidate stays expired, A0–A6 gray, production calls 0, NO-GO. No live evidence or duration
proves full backup/restore/SQL/approval/business acceptance can fit the original 30-minute window.
