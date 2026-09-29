# Storage adapter permission admission

Base: `4c1fbd545`. This patch adds production mechanical checks and mutation tests,
not a generic `permission-filter` import or an unrestricted file exemption.

Audited paths:

- `storage-maintenance-access`: authenticated principal; current organization
  membership under SHARE lock; administrator decision delegates to the identity
  domain's `canExportOrganization`; board-specific work additionally locks the
  board and requires owner or administrator. Organization enumeration is admin-only.
- `pg-storage-backfill`: no body disclosure; list/inspect/migrate call that helper
  before enumeration, counts or same-transaction migration. Counts bind both tenant
  and board, and only numeric counts escape.
- `pg-backup-maintenance`: source locator is not returned. Organization membership
  and current board owner (or administrator) checks precede locked backup capture
  disclosure. Deleted-source maintenance additionally binds the original actor.
  Recovery requires a live matching board, actor/hash-bound request receipt,
  verified backup, tenant-board destination key and current document CAS.
- `pg-portable-board`: final transaction locks board before reading membership,
  checks owner/editor and archive state before replay, checks media readback, then
  commits canonical commands, image roots and receipt in the same transaction.
- `pg-image-assets`: internal metadata port, consumed by the image service and
  locked portable publisher. Image delivery checks the board ACL before metadata
  lookup and again after blob I/O, verifies board-scoped storage key, hash, MIME
  and size, and returns bytes/metadata instead of ObjectStore paths. The mechanical
  boundary includes these application-layer checks as a dependency.

Every newly admitted adapter has an exact AST method inventory, query count per
method, permitted tenant-table set, method-local authorization predicates and
ordered authorization/publication steps. Comments are removed before matching.
New same-table reads in another method, inside an existing method, or outside the
admitted methods fail. Mutation tests remove membership locks/actor bindings,
owner checks, tenant predicates, receipt authorization, retention/restore guards,
CAS, media readback and post-I/O ACL; all must reject.

No product authorization implementation changed in this patch. The image and
portable implementations include prior work by this worker; these checks do not
constitute independent approval of that work. Root retains final review.

The base copy rule expects `FOR SHARE OF a,r`, while the audited immutable image
metadata implementation uses `FOR SHARE OF r`; root owns that separate correction.
This patch deliberately leaves it untouched. To verify composition without editing
that rule, an in-memory check replaced only that regex with root's specified `r`
variant before importing the production lint: it passed, scanning 1,587 files and
263 tenant tables with 118 precise admissions. The unchanged-tree production lint
still stops at the known copy-rule mismatch until root integrates its correction.
No Docker, DB, browser or heavy typecheck ran.

Focused verification: **86/86 tests passed**, including 35 mechanical mutation
checks plus portable, image, backfill and maintenance repository behavior tests.
Initial new-tree regression collection lacked local ignored workspace dependency
links; adding those links resolved `lib0/observable` resolution without changing
any manifest, lockfile or shared dependency directory.
