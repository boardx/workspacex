/**
 * PostgreSQL implementation of F34's rename/alias port (migration 0033's `artifact_aliases`).
 *
 * ## Every content read goes through `wsx_visible_artifacts()` -- the SAME predicate as F31/F32
 *
 * Not a copy of it: the same function call, joined exactly the way
 * `pg-download-grant-repository.ts` joins it. That is what makes "an artifact you cannot see
 * in the browser cannot be renamed, and its current name cannot be recovered through a stale
 * link" a property of there being ONE predicate rather than a rule a fourth reader has to
 * remember.
 *
 * ## `renameAndAlias` is one transaction
 *
 * `withTenant` wraps both statements. A crash between the alias INSERT and the `artifacts`
 * UPDATE must roll back both -- an alias row pointing at a rename that never happened, or a
 * renamed artifact with no alias trail, are each exactly the failure N-23 exists to prevent.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ArtifactRenameRepository,
  NewArtifactAlias,
  RenamableArtifactLookup,
} from "../../application/files/rename-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

export class PgArtifactRenameRepository implements ArtifactRenameRepository {
  constructor(private readonly db: DatabasePort) {}

  async findRenamable(input: {
    orgId: OrgId; artifactId: string; requesterTeamId: string | null;
  }): Promise<RenamableArtifactLookup | null> {
    const row = await this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ id: string; project_id: string | null; title: string }>(
        `SELECT a.id, a.project_id, a.title
           FROM artifacts a
           JOIN wsx_visible_artifacts(a.project_id, $3) vis ON vis.artifact_id = a.id
          WHERE a.org_id = $1 AND a.id = $2`,
        [input.orgId, input.artifactId, input.requesterTeamId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) return null;
    return {
      artifactId: row.id,
      projectId: row.project_id,
      artifact: guard({ kind: "artifact", id: row.id }, { currentName: row.title }),
    };
  }

  async renameAndAlias(input: NewArtifactAlias & { newName: string }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO artifact_aliases (id, org_id, project_id, artifact_id, old_name, reason, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.id, input.orgId, input.projectId, input.artifactId, input.oldName, input.reason, input.changedBy],
      );
      await s.query(`UPDATE artifacts SET title = $3 WHERE org_id = $1 AND id = $2`, [
        input.orgId, input.artifactId, input.newName,
      ]);
    });
  }

  async findByCurrentName(input: {
    orgId: OrgId; projectId: string; requesterTeamId: string | null; name: string;
  }): Promise<Guarded<{ artifactId: string }> | null> {
    const row = await this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `SELECT a.id
           FROM artifacts a
           JOIN wsx_visible_artifacts(a.project_id, $4) vis ON vis.artifact_id = a.id
          WHERE a.org_id = $1 AND a.project_id = $2 AND a.title = $3`,
        [input.orgId, input.projectId, input.name, input.requesterTeamId],
      );
      return r.rows[0] ?? null;
    });
    return row ? guard({ kind: "artifact", id: row.id }, { artifactId: row.id }) : null;
  }

  async findLatestAlias(input: {
    orgId: OrgId; projectId: string; requesterTeamId: string | null; oldName: string;
  }): Promise<Guarded<{ artifactId: string }> | null> {
    const row = await this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ artifact_id: string }>(
        `SELECT al.artifact_id
           FROM artifact_aliases al
           JOIN artifacts a ON a.id = al.artifact_id AND a.org_id = al.org_id
           JOIN wsx_visible_artifacts(a.project_id, $4) vis ON vis.artifact_id = a.id
          WHERE al.org_id = $1 AND al.project_id = $2 AND al.old_name = $3
       ORDER BY al.changed_at DESC
          LIMIT 1`,
        [input.orgId, input.projectId, input.oldName, input.requesterTeamId],
      );
      return r.rows[0] ?? null;
    });
    return row ? guard({ kind: "artifact", id: row.artifact_id }, { artifactId: row.artifact_id }) : null;
  }

  async currentName(input: {
    orgId: OrgId; artifactId: string; requesterTeamId: string | null;
  }): Promise<Guarded<{ currentName: string }> | null> {
    const row = await this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ title: string }>(
        `SELECT a.title
           FROM artifacts a
           JOIN wsx_visible_artifacts(a.project_id, $3) vis ON vis.artifact_id = a.id
          WHERE a.org_id = $1 AND a.id = $2`,
        [input.orgId, input.artifactId, input.requesterTeamId],
      );
      return r.rows[0] ?? null;
    });
    return row ? guard({ kind: "artifact", id: input.artifactId }, { currentName: row.title }) : null;
  }
}
