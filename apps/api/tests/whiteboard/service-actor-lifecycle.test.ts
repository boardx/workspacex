import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { WhiteboardServiceActor } from '@repo/contracts/whiteboard-actor';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type {
  CreateWhiteboardServiceActorRecord,
  WhiteboardActorRepository,
  WhiteboardServiceActorCredentialBinding,
} from '../../src/application/whiteboard/actor-ports';
import { WhiteboardActorService } from '../../src/application/whiteboard/actor-service';
import type { WhiteboardOperationAuditRepository } from '../../src/application/whiteboard/operation-ports';
import { WhiteboardOperationError } from '../../src/application/whiteboard/operation-service';
import { toOrgId } from '../../src/domain/org-id';
import { WhiteboardServiceActorController } from '../../src/interface/controllers/whiteboard-service-actor.controller';
import { AcceptanceWhiteboardActorRepository, boardAgentApiAcceptanceEnabled } from '../../src/infrastructure/whiteboard/acceptance-whiteboard-actor-repository';

const boardId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const eventId = '00000000-0000-4000-8000-000000000003';
const operationId = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';
const credential = `wsxb_${'a'.repeat(43)}`;
const now = new Date('2026-09-28T00:00:00.000Z');
const principal = { orgId: toOrgId('org-1'), userId: 'owner-1' };
const session: TenantSession = { query: async () => ({ rows: [] }) };

const operationBody = {
  apiVersion: '2026-09-01',
  requestId,
  expectedRevision: { epoch: 1, seq: 0 },
  commands: [{
    type: 'create',
    object: {
      id: 'sticky-1', schemaVersion: 1, kind: 'sticky',
      geometry: { x: 0, y: 0, width: 200, height: 200, rotation: 0 },
      text: 'service actor idea', style: {}, parentId: null, orderKey: '',
    },
  }],
  provenance: {
    source: 'public-api', model: null, skill: null, sourceArtifactId: null,
    sourceRevision: null, layoutHash: null, inputObjectIds: [],
  },
};

function fixture(options: { role?: 'owner'|'editor'|'viewer'; binding?: WhiteboardServiceActorCredentialBinding|null } = {}) {
  let record: CreateWhiteboardServiceActorRecord | undefined;
  let revokedAt: Date | null = null;
  const db: DatabasePort = {
    withTenant: async (orgId, fn) => {
      expect(orgId).toBe(principal.orgId);
      return fn(session);
    },
    withoutTenant: async fn => fn(session),
    close: async () => {},
  };
  const toActor = (input: CreateWhiteboardServiceActorRecord): WhiteboardServiceActor => ({
    actorId: input.actorId,
    boardId: input.boardId,
    label: input.label,
    delegatedBy: input.delegatedBy,
    scopes: input.scopes,
    credentialPrefix: input.credentialPrefix,
    status: revokedAt ? 'revoked' : 'active',
    createdAt: input.createdAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    revokedAt: revokedAt?.toISOString() ?? null,
  });
  const repository: WhiteboardActorRepository = {
    create: vi.fn(async (_session, _principal, input) => {
      record = input;
      const actor = toActor(input);
      return {
        actor,
        auditEvent: {
          eventId: input.eventId, boardId: input.boardId, actorId: input.actorId,
          type: 'ServiceActorCreated' as const, delegatedBy: input.delegatedBy,
          scopes: input.scopes, occurredAt: input.createdAt.toISOString(),
        },
      };
    }),
    list: vi.fn(async () => record ? [toActor(record)] : []),
    revoke: vi.fn(async (_session, _principal, input) => {
      if (!record || record.actorId !== input.actorId) return null;
      revokedAt = input.revokedAt;
      const actor = toActor(record);
      return {
        actor,
        auditEvent: {
          eventId: input.eventId, boardId: input.boardId, actorId: input.actorId,
          type: 'ServiceActorRevoked' as const, delegatedBy: record.delegatedBy,
          scopes: record.scopes, occurredAt: input.revokedAt.toISOString(),
        },
      };
    }),
    resolveCredential: vi.fn(async () => options.binding === undefined ? ({
      boardId, actorId, delegatedBy: principal.userId, scopes: ['board:read', 'board:write'],
    } satisfies WhiteboardServiceActorCredentialBinding) : options.binding),
  };
  const boards = {
    lockHead: vi.fn(async () => ({ epoch: 1, seq: 0, actorRole: options.role ?? 'owner' })),
  } as Pick<WhiteboardOperationAuditRepository, 'lockHead'>;
  const operations = {
    execute: vi.fn(async () => ({ ok: 'execute' })),
    undo: vi.fn(async () => ({ ok: 'undo' })),
    readObjects: vi.fn(async () => ({ ok: 'objects' })),
    events: vi.fn(async () => ({ ok: 'events' })),
  };
  const service = new WhiteboardActorService(
    db,
    repository,
    boards,
    operations as never,
    () => now,
    () => credential,
    () => actorId,
    () => eventId,
  );
  return { service, repository, operations, getRecord: () => record };
}

describe('Board service actor lifecycle boundary', () => {
  it('lets only the Board owner create an actor and returns the raw credential once', async () => {
    const { service, getRecord } = fixture();
    const receipt = await service.create(principal, boardId, {
      label: 'Meeting room facilitator',
      scopes: ['board:read', 'board:write'],
      expiresInDays: 30,
    });

    expect(receipt.credential).toBe(credential);
    expect(receipt.actor).toMatchObject({ actorId, boardId, delegatedBy: principal.userId, status: 'active' });
    expect(receipt.auditEvent).toMatchObject({ eventId, type: 'ServiceActorCreated', actorId });
    expect(getRecord()).toMatchObject({
      credentialPrefix: credential.slice(0, 13),
      credentialDigest: createHash('sha256').update(credential).digest('hex'),
    });
    expect(JSON.stringify(getRecord())).not.toContain(credential);
    expect(receipt.actor).not.toHaveProperty('credentialDigest');
  });

  it('fails closed before persistence when a non-owner manages actors', async () => {
    const { service, repository } = fixture({ role: 'editor' });
    await expect(service.create(principal, boardId, {
      label: 'forbidden', scopes: ['board:read'], expiresInDays: 10,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.create).not.toHaveBeenCalled();
    await expect(service.list(principal, boardId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('binds service operations to the authenticated human, board and server-side actor', async () => {
    const { service, operations } = fixture();
    await expect(service.execute(principal, boardId, credential, {
      ...operationBody,
      actor: { kind: 'service', actorId: 'spoofed' },
    })).rejects.toMatchObject({ name: 'ZodError' });

    await expect(service.execute(principal, boardId, credential, operationBody)).resolves.toEqual({ ok: 'execute' });
    expect(operations.execute).toHaveBeenCalledWith(principal, boardId, expect.objectContaining({
      boardId,
      actor: expect.objectContaining({
        kind: 'service', actorId, orgId: principal.orgId,
        delegatedBy: principal.userId, scopes: ['board:read', 'board:write'],
      }),
    }));
  });

  it('requires a valid dual credential and never accepts a cross-board or cross-delegator binding', async () => {
    await expect(fixture().service.authorize(principal, boardId, undefined)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(fixture().service.authorize(principal, boardId, 'not-a-token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(fixture({ binding: null }).service.authorize(principal, boardId, credential)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(fixture({ binding: { boardId: '00000000-0000-4000-8000-000000000099', actorId, delegatedBy: principal.userId, scopes: ['board:read'] } }).service.authorize(principal, boardId, credential)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(fixture({ binding: { boardId, actorId, delegatedBy: 'other-user', scopes: ['board:read'] } }).service.authorize(principal, boardId, credential)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('enforces least-privilege scopes for read and write entry points', async () => {
    const { service, operations } = fixture({
      binding: { boardId, actorId, delegatedBy: principal.userId, scopes: ['board:read'] },
    });
    await expect(service.readObjects(principal, boardId, credential)).resolves.toEqual({ ok: 'objects' });
    expect(operations.readObjects).toHaveBeenCalledWith(principal, boardId, { actorId });
    await expect(service.execute(principal, boardId, credential, operationBody)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(operations.execute).not.toHaveBeenCalled();
  });

  it('revokes with an immutable lifecycle event and keeps credentials out of list output', async () => {
    const { service } = fixture();
    await service.create(principal, boardId, {
      label: 'automation', scopes: ['board:read'], expiresInDays: 90,
    });
    const listed = await service.list(principal, boardId);
    expect(listed.actors).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(credential);

    const revoked = await service.revoke(principal, boardId, actorId);
    expect(revoked.actor).toMatchObject({ status: 'revoked', revokedAt: now.toISOString() });
    expect(revoked.auditEvent).toMatchObject({ type: 'ServiceActorRevoked', actorId });
  });

  it('uses the operation service error taxonomy for missing credentials', async () => {
    await expect(fixture().service.execute(principal, boardId, undefined, operationBody))
      .rejects.toBeInstanceOf(WhiteboardOperationError);
  });
});

describe('Board service actor HTTP adapter contract', () => {
  it('forwards the separate credential header without accepting actor identity from transport metadata', async () => {
    const actors = { execute: vi.fn(async () => ({ ok: true })) };
    const controller = new WhiteboardServiceActorController(actors as never);
    await expect(controller.execute(principal, boardId, credential, operationBody)).resolves.toEqual({ ok: true });
    expect(actors.execute).toHaveBeenCalledWith(principal, boardId, credential, operationBody);
  });

  it('maps an invalid, expired or revoked credential to the same 401 boundary', async () => {
    const actors = { execute: vi.fn(async () => { throw new WhiteboardOperationError('UNAUTHENTICATED'); }) };
    const controller = new WhiteboardServiceActorController(actors as never);
    await expect(controller.execute(principal, boardId, credential, operationBody)).rejects.toMatchObject({ status: 401 });
  });
});

describe('isolated acceptance actor registry', () => {
  it('cannot be composed into a remote, shared or deploy-profile API process', () => {
    const isolated = { BOARD_AGENT_API_ACCEPTANCE: '1', WORKSPACEX_ISOLATION_ID: 'lane', PGDATABASE: `wsx_${'a'.repeat(20)}`, PGHOST: '127.0.0.1' };
    expect(boardAgentApiAcceptanceEnabled(isolated)).toBe(true);
    expect(boardAgentApiAcceptanceEnabled({ ...isolated, PGDATABASE: 'workspacex' })).toBe(false);
    expect(boardAgentApiAcceptanceEnabled({ ...isolated, PGHOST: 'database.internal' })).toBe(false);
    expect(boardAgentApiAcceptanceEnabled({ ...isolated, WORKSPACEX_DEPLOY_PROFILE: 'production' })).toBe(false);
    expect(boardAgentApiAcceptanceEnabled({ ...isolated, BOARD_AGENT_API_ACCEPTANCE: '0' })).toBe(false);
  });

  it('resolves only the digest-bound active credential and fails closed after revocation', async () => {
    const repository = new AcceptanceWhiteboardActorRepository();
    const input: CreateWhiteboardServiceActorRecord = {
      actorId, boardId, label: 'acceptance actor', delegatedBy: principal.userId,
      scopes: ['board:read', 'board:write'], credentialPrefix: credential.slice(0, 13),
      credentialDigest: createHash('sha256').update(credential).digest('hex'),
      createdAt: now, expiresAt: new Date('2099-01-01T00:00:00.000Z'), eventId,
    };
    await repository.create(session, principal, input);

    await expect(repository.resolveCredential(session, principal, boardId, input.credentialDigest))
      .resolves.toMatchObject({ boardId, actorId, delegatedBy: principal.userId });
    await expect(repository.resolveCredential(session, principal, boardId, createHash('sha256').update(`${credential}wrong`).digest('hex')))
      .resolves.toBeNull();
    await expect(repository.resolveActor(session, principal, boardId, actorId))
      .resolves.toMatchObject({ kind: 'service', actorId, scopes: ['board:read', 'board:write'] });

    await repository.revoke(session, principal, { boardId, actorId, eventId, revokedAt: now });
    await expect(repository.resolveCredential(session, principal, boardId, input.credentialDigest)).resolves.toBeNull();
    await expect(repository.resolveActor(session, principal, boardId, actorId)).resolves.toBeNull();
    expect(JSON.stringify(repository)).not.toContain(credential);
  });
});
