import type { WhiteboardActorLifecycleEvent, WhiteboardServiceActor } from '@repo/contracts/whiteboard-actor';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../ports/database.port';

export interface CreateWhiteboardServiceActorRecord {
  actorId: string;
  boardId: string;
  label: string;
  delegatedBy: string;
  scopes: WhiteboardServiceActor['scopes'];
  credentialDigest: string;
  credentialPrefix: string;
  createdAt: Date;
  expiresAt: Date;
  eventId: string;
}

export interface WhiteboardServiceActorCredentialBinding {
  boardId: string;
  actorId: string;
  delegatedBy: string;
  scopes: WhiteboardServiceActor['scopes'];
}

export interface WhiteboardActorRepository {
  create(session: TenantSession, principal: Principal, input: CreateWhiteboardServiceActorRecord): Promise<{ actor: WhiteboardServiceActor; auditEvent: WhiteboardActorLifecycleEvent } | null>;
  list(session: TenantSession, principal: Principal, boardId: string, now: Date): Promise<WhiteboardServiceActor[]>;
  revoke(session: TenantSession, principal: Principal, input: { boardId: string; actorId: string; eventId: string; revokedAt: Date }): Promise<{ actor: WhiteboardServiceActor; auditEvent: WhiteboardActorLifecycleEvent } | null>;
  resolveCredential(session: TenantSession, principal: Principal, boardId: string, credentialDigest: string): Promise<WhiteboardServiceActorCredentialBinding | null>;
}
