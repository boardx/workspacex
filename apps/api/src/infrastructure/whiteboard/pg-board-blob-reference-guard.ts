import type { DatabasePort } from '../../application/ports/database.port';
import type { BoardBlobReferenceGuard, BoardManifestRoot } from '../../application/whiteboard/blob-gc';
import { toOrgId } from '../../domain/org-id';

type RootRow = {
  manifest_key: string;
  manifest_digest: string;
  manifest_plain_digest: string;
  manifest_size_bytes: string;
  tenant_key_version: number;
};

/** PostgreSQL side of the GC handshake; writers and this guard lock the same Board row. */
export class PgBoardBlobReferenceGuard implements BoardBlobReferenceGuard {
  constructor(private readonly db: DatabasePort) {}

  async withLockedManifestRoots<T>(input: { tenantId: string; boardId: string }, inspect: (roots: readonly BoardManifestRoot[]) => Promise<T>): Promise<T> {
    return this.db.withTenant(toOrgId(input.tenantId), async session => {
      const board = await session.query<{ id: string }>(
        `SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.boardId],
      );
      if (!board.rows[0]) throw new Error('BOARD_BLOB_GC_BOARD_NOT_FOUND');
      const roots = await session.query<RootRow>(
        `SELECT manifest_key,manifest_digest,manifest_plain_digest,manifest_size_bytes,tenant_key_version
           FROM whiteboard_content_heads
          WHERE org_id=$1 AND board_id=$2 AND manifest_key IS NOT NULL
         UNION
         SELECT candidate_manifest_key AS manifest_key,candidate_manifest_digest AS manifest_digest,
                candidate_manifest_plain_digest AS manifest_plain_digest,candidate_manifest_size_bytes AS manifest_size_bytes,
                candidate_tenant_key_version AS tenant_key_version
           FROM whiteboard_content_migrations
          WHERE org_id=$1 AND board_id=$2 AND candidate_manifest_key IS NOT NULL`,
        [input.tenantId, input.boardId],
      );
      return inspect(roots.rows.map(row => ({
        key: row.manifest_key,
        cipherDigest: row.manifest_digest,
        plainDigest: row.manifest_plain_digest,
        sizeBytes: Number(row.manifest_size_bytes),
        tenantKeyVersion: row.tenant_key_version,
      })));
    });
  }
}
