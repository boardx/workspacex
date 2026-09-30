# Read-only migration plan probe, 2026-09-30 (Refs #4763)

Observed production baseline supplied by the release controller: `ba6343199f3c834d6a198f83d0c771614292c82b`. Inspected offline target: `ea6c22be0d88f109d625925f107c3a87d5f66d5c`; this probe does not claim that target is released or merged. Source inventory used the frozen target's canonical `migrationFiles()`.

The controller's sanitized read-only ledger contains 184 applied names/checksums. The target contains 377 SQL migrations, leaving 193 pending. The CLI printed the full plan and exited 1, as required. `ready=false` and `productionMigrationAuthorized=false`.

- Baseline ledger SHA-256: `b0b85b2132c3dc92846feb438cfcdb8a7b49c68d10ec65114d67afdb43ee83cd`
- Complete source inventory SHA-256: `d7c9d6c0e9f9cfc32f4ef40da3c36add34f5a226b87609a8cd3b927de1525ad1`
- Pending filenames/checksums SHA-256: `dee021d3bf7c582a46ab3cc8ab4b658de166ffe5abfa8475d7d5851ea770a40d`
- Complete plan SHA-256: `b3dbbb1e8224360252fa80ca47afd0074afde4770b2230c0c840e831f16b50e4`

F82 (`20260801103000_f82_interview_templates.sql`) remains an applied checksum mismatch. Production ledger checksum begins `959b18bc`; target source checksum begins `3b1b09a8`. No legacy evidence array was supplied to this CLI probe, so both drift and missing evidence blockers remain. The controller's earlier baseline/runtime comparison is separate evidence and is not silently inferred by this tool.

There are 71 pending names earlier than the highest applied filename. Conservative triage reports 146 destructive (including policy drops), 43 unknown, 3 contract and 1 narrowly recognized additive migration. These categories require manual/rehearsal investigation; they are not a statement that 146 migrations delete user data. The W1 project rename/drop, research table drops, agent purge and legacy email-table drop remain blocked. No database or production mutation occurred.

Verification: cloud-deploy TypeScript check, generated-schema check, focused migration failure probes and package suite. Test fixtures contain synthetic SQL/ledgers only; the full production-derived ledger/plan stays in the controller's private temporary evidence storage, outside version control. A final source SHA after integration requires rerunning the generator and all plan-bound rehearsal evidence.

Coordination: readiness read successfully; user-requested release safety work is outside CLR queue and the reason is recorded on #4763. `tick` could not run because this delegated environment has no `COORD_GATEWAY_URL`; no lease or clock was invented. Dependencies were reused through symlinks to the existing local installation; `init.sh` was not rerun because its install/hooks mutations would affect that shared installation. The controller must retain its baseline initialization verification before integration.
