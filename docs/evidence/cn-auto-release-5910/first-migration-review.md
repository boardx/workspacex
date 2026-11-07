# First release migration review — not production acceptance

Independent read-only review compared running baseline
`f0eb9d07398a66fdd5646a9e6b855fa1b940e571` with source `93abbca21`.
There are 16 added migration files and no modifications to existing migration
files. Canonical classification remains 13 destructive, three unknown, plus
`out_of_order_pending` for `20261001090000_billing_credits_core.sql` against the
observed production ledger maximum `20261006001000_organization_creation_requests.sql`.
No classifier or ordinary admission gate has been changed.

The review found no immediate DELETE FROM, TRUNCATE, DROP TABLE or DROP COLUMN
against existing business content. This does not establish rollback safety:

- `billing_reference_packages` disables three old packages and overwrites six
  `pkg-cn-*` package amounts, credits and enablement on conflict. Verify exact
  allowed directory changes while preserving historical order snapshots,
  wallets and ledgers. `billing_stripe_webhook` inserts subscription bindings
  while skipping conflicts; inspect the actual conflict set in the clone.
- `credit_consumption` changes balances and ledger amounts from integer to
  `numeric(12,2)`, permits negative balances and adds consumption/request types.
  PostgreSQL client decoding and old application semantics can change; changing
  images back cannot undo subsequently written values. Exercise precision,
  append-only accounting and concurrent consumption on the restored clone.
- `wechat_reference_compatibility` removes the receipt check requiring
  `signature_verified=true`. Candidate AES-GCM-only receipts can prevent restoring
  that old constraint. Verify old-image reads after candidate receipt writes.
- New credit errors, auxiliary request identities, foreign keys and unique
  constraints require actual legacy-row validation and old/new DTO and business
  compatibility tests. A project CRUD HTTP journey does not cover billing,
  payments or model accounting.
- The out-of-order core migration has no identified forward dependency, but
  depends on existing roles, UUID support and organization identity helpers;
  subsequent receipts, webhook, package and consumption migrations depend on
  its new tables. Restore the real 415-entry ledger and execute the canonical
  migrator without force. Prove missing-file order, transaction retry behavior,
  a second run with zero applied files, 431 total entries and all 16 checksums.
  Compare schema/grant/policy/trigger digests with a fresh full ordered replay.
- Rebuilt RLS/frozen-organization policies and new unique indexes need real
  cross-tenant, frozen-organization, minimal app-role and duplicate-data probes.
  Future CASCADE effects also require application behavior review even though
  applying these migrations itself does not delete parent data.

These are requirements for the first exact-image database rehearsal. No real
restore, migration, compatibility, backup recovery or production activation has
been performed by this review. The ordinary release remains blocked.
