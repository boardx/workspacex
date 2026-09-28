# AI proposal and Undo body storage

The API contract is unchanged. Full proposal commands, AI labels and inverse Undo text live only in immutable ObjectStore JSON. PostgreSQL retains identity/owner/actor/request hash, status, expiry and `{object_key, content_hash, byte_size}`; `payload` is `{}`. Reading a file reference never falls back to old PG JSON.

Publication order within the already-authorized Board transaction:

1. Validate the full proposal, tenant/Board identity and Undo Board identity.
2. `putOnce` at `whiteboards/tenants/{sha256(org)[0:32]}/boards/{board}/proposal-bodies/{sha256}.json`.
3. Verify fetched bytes, head MIME/length, SHA-256, schema and proposal identity.
4. Insert an active `whiteboard_asset_refs` root through the existing purge fence.
5. Insert/update the PG pointer, clearing legacy `payload`, then commit the transaction.

Failure before commit cannot acknowledge a proposal pointer. An orphan file after transaction failure is handled by the existing delayed GC. Previous immutable versions stay rooted conservatively; this change does not release any live proposal, Undo, import or backup roots.

## Deployment and legacy rows

Stop old application writers before migration `20260928003000_whiteboard_proposal_bodies.sql`, then deploy the file-aware repository and shared ObjectStore injection. The new NOT VALID constraint permits unchanged old rows but rejects new plaintext writes. Do not restart an old writer against this schema.

Existing rows migrate on the first service access under the existing fresh Board ACL → Board lock → proposal lock transaction. Verification failure retains the old row; success clears payload in the same transaction as root registration. Dormant legacy rows remain pending migration and must not be reported as fully migrated. An operator can enumerate `(org_id, board_id, proposal_id, owner_user_id)` under the authorized owner context and call `WhiteboardProposalService.read`; the existing read ACL remains authoritative: revoked access fails closed, while an authorized owner may still read and migrate an archived Board; proposal confirmation writes retain the existing archive restriction. Count outstanding rows with `object_key IS NULL`, then validate the constraint only after zero remain. No plaintext values should be emitted by migration reports. PostgreSQL WAL/backups taken before migration still require their existing retention policy; this is not retroactive erasure.

## Acceptance boundary

Focused tests use the actual filesystem ObjectStore plus a SQL recorder: file verification, plaintext exclusion, legacy ordering, root fence rejection, idempotency, fresh-instance Undo hydration, tenant/Board/proposal mismatch and corrupt bytes. They do not claim real PG atomicity or race acceptance. The main session runs the PG lane.

Joint archive integration is a separate companion patch: include source-only active history references, retain their backup pins and restore to original keys only when matching restored PG metadata. Ordinary restore to a new Board must not reactivate old proposal commands or identities. Until that patch is integrated, the existing snapshot/image/comment archive is not a complete AI history disaster backup.
