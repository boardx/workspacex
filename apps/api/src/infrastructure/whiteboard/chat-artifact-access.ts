import { randomUUID } from 'node:crypto';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { canReadChatArtifactSource } from '../../application/chat/artifact-source-access';
import type { Principal } from '../../domain/principal';
import { PgChatRepository } from '../chat/pg-chat-repository';
import { PgIdentityRepository } from '../identity/pg-identity-repository';

/** Locator-only query; Chat's existing policy resolves all content access. Reads stay in
 * the operation transaction, including its final authorization before publication. */
export async function chatArtifactAccess(session: TenantSession, principal: Principal, artifactId: string): Promise<boolean | null> {
  const result = await session.query<{thread_id: string; existing_thread_id: string | null; project_id: string | null; mode: string; created_by: string}>(`
    SELECT l.thread_id,t.id AS existing_thread_id,t.project_id,l.mode,l.created_by FROM chat_artifact_landings l
    LEFT JOIN chat_threads t ON t.org_id=l.org_id AND t.id=l.thread_id
    WHERE l.org_id=$1 AND l.artifact_id=$2 ORDER BY l.created_at DESC LIMIT 1`,
    [principal.orgId, artifactId]);
  const landing = result.rows[0];
  if (!landing) {
    // Thread deletion cascades its landing rows. The immutable generated event
    // keeps that artifact classified as Chat source: never fall back to generic ACL.
    const former=await session.query(`SELECT 1 FROM provenance_events WHERE org_id=$1 AND target_kind='artifact' AND target_id=$2 AND type='generated' AND detail ? 'threadId' LIMIT 1`,[principal.orgId,artifactId]);
    return former.rows.length ? false : null;
  }
  if (!landing.existing_thread_id) return false;
  const db: DatabasePort = {
    withTenant: async (orgId, fn) => {
      if (orgId !== principal.orgId) throw new Error('CHAT_ARTIFACT_TENANT_MISMATCH');
      return fn(session);
    },
    withoutTenant: async () => { throw new Error('CHAT_ARTIFACT_TENANT_REQUIRED'); },
    close: async () => {},
  };
  return canReadChatArtifactSource({ chat: new PgChatRepository(db), repo: new PgIdentityRepository(db), ids: { next: randomUUID } }, {
    userId: principal.userId, orgId: principal.orgId, projectId: landing.project_id,
    threadId: landing.thread_id, mode: landing.mode, createdBy: landing.created_by,
  });
}
