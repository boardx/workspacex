import type { WhiteboardActorLifecycleEvent, WhiteboardServiceActor } from '@repo/contracts/whiteboard-actor';
import type {
  CreateWhiteboardServiceActorRecord,
  WhiteboardActorRepository,
  WhiteboardServiceActorCredentialBinding,
} from '../../application/whiteboard/actor-ports';
import type { RegisteredBoardActor } from '../../application/whiteboard/operation-ports';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../../application/ports/database.port';
import { PgWhiteboardOperationRepository } from './pg-operation-repository';

type StoredActor = {
  orgId: string;
  credentialDigest: string;
  actor: WhiteboardServiceActor;
};

export function boardAgentApiAcceptanceEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.BOARD_AGENT_API_ACCEPTANCE === '1' &&
    Boolean(env.WORKSPACEX_ISOLATION_ID) &&
    /^wsx_[a-f0-9]{20}$/.test(env.PGDATABASE ?? '') &&
    ['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST ?? '') &&
    !env.WORKSPACEX_DEPLOY_PROFILE;
}

/**
 * Process-local service actor registry for the isolated Board public-API lane.
 *
 * KernelModule only constructs this adapter when BOARD_AGENT_API_ACCEPTANCE=1.
 * It deliberately avoids pretending that the current production schema can
 * persist the lifecycle contract: the raw credential is never retained, while
 * operation receipts and events still use the real PostgreSQL repositories.
 */
export class AcceptanceWhiteboardActorRepository extends PgWhiteboardOperationRepository implements WhiteboardActorRepository {
  private readonly actors = new Map<string, StoredActor>();

  async create(_session: TenantSession, principal: Principal, input: CreateWhiteboardServiceActorRecord) {
    if (this.actors.has(this.key(principal.orgId, input.actorId))) return null;
    const actor: WhiteboardServiceActor = {
      actorId: input.actorId,
      boardId: input.boardId,
      label: input.label,
      delegatedBy: input.delegatedBy,
      scopes: input.scopes,
      credentialPrefix: input.credentialPrefix,
      status: 'active',
      createdAt: input.createdAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      revokedAt: null,
    };
    this.actors.set(this.key(principal.orgId, input.actorId), {
      orgId: principal.orgId,
      credentialDigest: input.credentialDigest,
      actor,
    });
    return { actor, auditEvent: this.event(input.eventId, actor, 'ServiceActorCreated', input.createdAt) };
  }

  async list(_session: TenantSession, principal: Principal, boardId: string, now: Date) {
    return [...this.actors.values()]
      .filter(row => row.orgId === principal.orgId && row.actor.boardId === boardId && row.actor.delegatedBy === principal.userId)
      .map(row => this.at(row.actor, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async revoke(_session: TenantSession, principal: Principal, input: { boardId: string; actorId: string; eventId: string; revokedAt: Date }) {
    const stored = this.actors.get(this.key(principal.orgId, input.actorId));
    if (!stored || stored.actor.boardId !== input.boardId || stored.actor.delegatedBy !== principal.userId || stored.actor.revokedAt) return null;
    const actor: WhiteboardServiceActor = { ...stored.actor, status: 'revoked', revokedAt: input.revokedAt.toISOString() };
    stored.actor = actor;
    return { actor, auditEvent: this.event(input.eventId, actor, 'ServiceActorRevoked', input.revokedAt) };
  }

  async resolveCredential(_session: TenantSession, principal: Principal, boardId: string, credentialDigest: string): Promise<WhiteboardServiceActorCredentialBinding | null> {
    const stored = [...this.actors.values()].find(row =>
      row.orgId === principal.orgId && row.actor.boardId === boardId &&
      row.actor.delegatedBy === principal.userId && row.credentialDigest === credentialDigest,
    );
    return stored ? this.binding(stored, new Date()) : null;
  }

  override async resolveActor(session: TenantSession, principal: Principal, boardId: string, actorId: string): Promise<RegisteredBoardActor | null> {
    const stored = this.actors.get(this.key(principal.orgId, actorId));
    if (stored) {
      if (stored.actor.boardId !== boardId || stored.actor.delegatedBy !== principal.userId) return null;
      const binding = this.binding(stored, new Date());
      return binding ? { ...binding, kind: 'service', model: null, skill: null } : null;
    }
    return super.resolveActor(session, principal, boardId, actorId);
  }

  private binding(stored: StoredActor, now: Date): WhiteboardServiceActorCredentialBinding | null {
    const actor = this.at(stored.actor, now);
    return actor.status === 'active'
      ? { boardId: actor.boardId, actorId: actor.actorId, delegatedBy: actor.delegatedBy, scopes: actor.scopes }
      : null;
  }

  private at(actor: WhiteboardServiceActor, now: Date): WhiteboardServiceActor {
    return actor.status === 'active' && Date.parse(actor.expiresAt) <= now.getTime() ? { ...actor, status: 'expired' } : actor;
  }

  private event(eventId: string, actor: WhiteboardServiceActor, type: WhiteboardActorLifecycleEvent['type'], occurredAt: Date): WhiteboardActorLifecycleEvent {
    return { eventId, boardId: actor.boardId, actorId: actor.actorId, type, delegatedBy: actor.delegatedBy, scopes: actor.scopes, occurredAt: occurredAt.toISOString() };
  }

  private key(orgId: string, actorId: string) { return `${orgId}\u0000${actorId}`; }
}
