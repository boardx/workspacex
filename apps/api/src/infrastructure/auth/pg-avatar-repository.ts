/**
 * `AvatarRepository` on PostgreSQL (#638 delta, iteration 2).
 *
 * `user_avatars` carries the `kernel-no-tenant-data` exemption (migration comment) for the
 * same reason `credentials` does: an avatar belongs to the account, not to one organization
 * (O-12). So this repository uses `withoutTenant`, same as `PgCredentialRepository` -- see
 * that file's header for the fuller argument against `withTenant` here.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { AvatarRepository, AvatarRow } from "../../application/identity/avatar-ports";

export class PgAvatarRepository implements AvatarRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(row: AvatarRow): Promise<void> {
    await this.db.withoutTenant((s) =>
      s.query(
        `INSERT INTO user_avatars (artifact_id, user_id, object_key, content_type, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.artifactId, row.userId, row.objectKey, row.contentType, row.sizeBytes, row.sha256],
      ),
    );
  }

  async findOwned(artifactId: string, userId: string): Promise<AvatarRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{
        artifact_id: string; user_id: string; object_key: string; content_type: string;
        size_bytes: string; sha256: string;
      }>(
        `SELECT artifact_id, user_id, object_key, content_type, size_bytes, sha256
           FROM user_avatars WHERE artifact_id = $1 AND user_id = $2`,
        [artifactId, userId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        artifactId: row.artifact_id,
        userId: row.user_id,
        objectKey: row.object_key,
        contentType: row.content_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
      };
    });
  }

  async findAnyById(artifactId: string): Promise<AvatarRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{
        artifact_id: string; user_id: string; object_key: string; content_type: string;
        size_bytes: string; sha256: string;
      }>(
        `SELECT artifact_id, user_id, object_key, content_type, size_bytes, sha256
           FROM user_avatars WHERE artifact_id = $1`,
        [artifactId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        artifactId: row.artifact_id,
        userId: row.user_id,
        objectKey: row.object_key,
        contentType: row.content_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
      };
    });
  }
}
