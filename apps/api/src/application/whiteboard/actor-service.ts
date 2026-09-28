import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  WhiteboardServiceActorCreate,
  WhiteboardServiceActorCreated,
  WhiteboardServiceActorList,
  WhiteboardServiceActorRevoked,
  WhiteboardServiceEventCursor,
  WhiteboardServiceOperationRequest,
  type WhiteboardServiceActor,
} from '@repo/contracts/whiteboard-actor';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../ports/database.port';
import { WhiteboardOperationError, type WhiteboardOperationService } from './operation-service';
import type { WhiteboardActorRepository, WhiteboardServiceActorCredentialBinding } from './actor-ports';
import type { WhiteboardOperationAuditRepository } from './operation-ports';

export const WHITEBOARD_ACTOR_SERVICE = Symbol('WhiteboardActorService');
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface AuthorizedWhiteboardServiceActor {
  principal: Principal;
  actor: {
    kind: 'service'; actorId: string; orgId: string; role: 'viewer';
    scopes: WhiteboardServiceActor['scopes']; delegatedBy: string;
  };
}

const digest = (credential: string) => createHash('sha256').update(credential).digest('hex');

/** Owner-managed, board-bound service identities. Raw credentials are returned once and never persisted. */
export class WhiteboardActorService {
  constructor(
    private readonly db: DatabasePort,
    private readonly repository: WhiteboardActorRepository,
    private readonly boards: Pick<WhiteboardOperationAuditRepository, 'lockHead'>,
    private readonly operations: Pick<WhiteboardOperationService, 'execute'|'undo'|'events'|'readObjects'>,
    private readonly now = () => new Date(),
    private readonly credentialFactory = () => `wsxb_${randomBytes(32).toString('base64url')}`,
    private readonly actorIdFactory = randomUUID,
    private readonly eventIdFactory = randomUUID,
  ) {}

  async create(principal: Principal, boardId: string, untrusted: unknown) {
    const input = WhiteboardServiceActorCreate.parse(untrusted);
    return this.db.withTenant(principal.orgId, async session => {
      await this.requireOwner(session, principal, boardId);
      const credential = this.credentialFactory();
      if (!/^wsxb_[a-zA-Z0-9_-]{43}$/.test(credential)) throw new WhiteboardOperationError('DEPENDENCY_UNAVAILABLE');
      const createdAt = this.now();
      const stored = await this.repository.create(session, principal, {
        actorId: this.actorIdFactory(), boardId, label: input.label, delegatedBy: principal.userId,
        scopes: input.scopes, credentialDigest: digest(credential), credentialPrefix: credential.slice(0, 13),
        createdAt, expiresAt: new Date(createdAt.getTime() + input.expiresInDays * DAY_MS), eventId: this.eventIdFactory(),
      });
      if (!stored) throw new WhiteboardOperationError('FORBIDDEN');
      return WhiteboardServiceActorCreated.parse({ ...stored, credential });
    });
  }

  async list(principal: Principal, boardId: string) {
    return this.db.withTenant(principal.orgId, async session => {
      await this.requireOwner(session, principal, boardId);
      return WhiteboardServiceActorList.parse({ actors: await this.repository.list(session, principal, boardId, this.now()) });
    });
  }

  async revoke(principal: Principal, boardId: string, actorId: string) {
    return this.db.withTenant(principal.orgId, async session => {
      await this.requireOwner(session, principal, boardId);
      const stored = await this.repository.revoke(session, principal, { boardId, actorId, eventId: this.eventIdFactory(), revokedAt: this.now() });
      if (!stored) throw new WhiteboardOperationError('NOT_FOUND');
      return WhiteboardServiceActorRevoked.parse(stored);
    });
  }

  async authorize(principal: Principal, boardId: string, credentialHeader: string | undefined): Promise<AuthorizedWhiteboardServiceActor> {
    const credential = /^wsxb_[a-zA-Z0-9_-]{43}$/.test(credentialHeader?.trim() ?? '') ? credentialHeader!.trim() : undefined;
    if (!credential) throw new WhiteboardOperationError('UNAUTHENTICATED');
    const binding = await this.db.withTenant(principal.orgId, session => this.repository.resolveCredential(session, principal, boardId, digest(credential)));
    if (!binding || binding.boardId !== boardId || binding.delegatedBy !== principal.userId) throw new WhiteboardOperationError('UNAUTHENTICATED');
    return this.binding(principal, binding);
  }

  async execute(principal: Principal, boardId: string, credential: string | undefined, untrusted: unknown) {
    const authorized = await this.authorize(principal, boardId, credential);
    if (!authorized.actor.scopes.includes('board:write')) throw new WhiteboardOperationError('FORBIDDEN');
    const input = WhiteboardServiceOperationRequest.parse(untrusted);
    return this.operations.execute(principal, boardId, { ...input, boardId, actor: authorized.actor });
  }

  async undo(principal: Principal, boardId: string, operationId: string, credential: string | undefined, untrusted: unknown) {
    const authorized = await this.authorize(principal, boardId, credential);
    if (!authorized.actor.scopes.includes('board:write')) throw new WhiteboardOperationError('FORBIDDEN');
    return this.operations.undo(principal, boardId, operationId, untrusted);
  }

  async readObjects(principal: Principal, boardId: string, credential: string | undefined) {
    const authorized = await this.authorize(principal, boardId, credential);
    if (!authorized.actor.scopes.includes('board:read')) throw new WhiteboardOperationError('FORBIDDEN');
    return this.operations.readObjects(principal, boardId, { actorId: authorized.actor.actorId });
  }

  async events(principal: Principal, boardId: string, credential: string | undefined, untrusted: unknown) {
    const authorized = await this.authorize(principal, boardId, credential);
    if (!authorized.actor.scopes.includes('board:read')) throw new WhiteboardOperationError('FORBIDDEN');
    const cursor = WhiteboardServiceEventCursor.parse(untrusted);
    return this.operations.events(principal, boardId, { ...cursor, actorId: authorized.actor.actorId });
  }

  private binding(principal: Principal, value: WhiteboardServiceActorCredentialBinding): AuthorizedWhiteboardServiceActor {
    return {
      principal,
      actor: { kind: 'service', actorId: value.actorId, orgId: principal.orgId, role: 'viewer', scopes: value.scopes, delegatedBy: value.delegatedBy },
    };
  }

  private async requireOwner(session: Parameters<WhiteboardOperationAuditRepository['lockHead']>[0], principal: Principal, boardId: string) {
    const head = await this.boards.lockHead(session, principal, boardId);
    if (!head) throw new WhiteboardOperationError('NOT_FOUND');
    if (head.archived) throw new WhiteboardOperationError('ARCHIVED');
    if (head.actorRole !== 'owner') throw new WhiteboardOperationError('FORBIDDEN');
  }
}
