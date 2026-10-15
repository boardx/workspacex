# Sprint 21/05 - verified WeChat payment crediting

F05, issue #5759, owner coord-voice, in_progress. Source 2e3c2ef74 independently ACCEPTed. Startup: pnpm -w run dev; default ./init.sh quick check passed. Formal gate: pnpm harness verify --sprint 21/05 --feature F05 --owner coord-voice (not yet run).

Evidence rounds (all logs retained in evidence/): missing callback RED 21 failures; first implementation 50 passed/2 failed plus cleanup hook timeout and Buffer BodyInit type failure; repaired invalid FAILED-order enum/body timeout/byte type. Independent review repaired weak SQL boundary and poison receipt starvation with exact literal registry/backoff and actual recovery test. Second round 62 passed/type/lint exit0. Merchant transaction reuse RED both sequential/concurrent failed; unique provider transaction binding repaired both. Final source 2e3c2ef74: 64 tests/5 files, API type/lint, contracts type and default init all exit0. Tests use actual PostgreSQL/Nest HTTP/RSA/AES, connection crash/restart and lost ACK fault injection. Owned isolated scopes cleaned after each completed run.

Next: formal high-risk gate at frozen evidence checkpoint; independent final evidence review; separate F05 PR with Closes #5759 and current-head CI. Parent #5750 canonical READY_TO_MERGE but OPEN; F04 #5757 draft stacked pending coordinator integration. No worker self-merge/manual issue close.

Original product goal remains unfinished: cashier, expiry, admin recovery, Stripe and token settlement. No real merchant charge, activation or authenticated deployed cashier proof claimed. This callback feature alone does not make billing usable.

## Final observability review and restart checkpoint
The first formal run was deliberately interrupted with exit130 during root harness nested checks after review found missing correlated accept/audit SQL diagnostics. Both prescribed callback commands passed, but the interrupted baseline is not passing. Own guard/process/container scope was released; interrupted logs retained.

Observability RED 3 cases, then pending nonthrow trace bridge RED 1 case, demonstrated missing diagnostics. Source 399fdd0e1 fixes LoggerPort composition, safe SQL code/stage/request trace and verified receipt linkage, without raw payment/secret/payer logging. Final independent SOURCE ACCEPT at that exact SHA. Final reviewed run: 68/68 across 6 files, API type/lint, contracts type and default init all exit0. Requirement E3 now distinguishes known permanent business failure from retryable/unknown DB outcomes; no merchant query or new public error enum. Next formal uses the new frozen checkpoint; interrupted run remains interrupted evidence, never green.
