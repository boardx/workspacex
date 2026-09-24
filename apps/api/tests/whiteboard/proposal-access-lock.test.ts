import { describe, expect, it } from 'vitest';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { ProposalConflict } from '../../src/application/whiteboard/proposal-ports';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { PgProposalRepository } from '../../src/infrastructure/whiteboard/pg-proposal-repository';

const principal: Principal = { orgId: toOrgId('proposal-lock-org'), userId: 'proposal-lock-owner' };
const boardId = '123e4567-e89b-42d3-a456-426614174000';

function repository(queries: string[]): PgProposalRepository {
  const session: TenantSession = { query: async <T>(sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM whiteboards')) return { rows: [{ owner_id: principal.userId, archived: false }] as T[] };
    if (sql.includes('FROM org_memberships')) return { rows: [{ role: 'owner' }] as T[] };
    if (sql.includes('submitted_by=$3')) return { rows: [] as T[] };
    if (sql.includes('count(*)')) return { rows: [{ count: '1000' }] as T[] };
    if (sql.includes('ORDER BY created_at')) return { rows: [] as T[] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const db: DatabasePort = {
    withTenant: async (_orgId, run) => run(session),
    withoutTenant: async run => run(session),
    close: async () => {},
  };
  return new PgProposalRepository(db, {} as WhiteboardCollaborationStore);
}

describe('proposal board lock behavior', () => {
  it('keeps read polling lock-free while serializing quota-protected creates', async () => {
    const readQueries: string[] = [];
    await expect(repository(readQueries).list(principal, boardId)).resolves.toEqual([]);
    expect(readQueries.find(sql => sql.includes('FROM whiteboards'))).not.toContain('FOR UPDATE');

    const writeQueries: string[] = [];
    await expect(repository(writeQueries).create(principal, boardId, {
      requestId: 'a23e4567-e89b-42d3-a456-426614174000',
      title: 'Bounded proposal', baseEpoch: 1, baseSeq: 0,
      commands: [{ type: 'delete', id: 'note' }],
    })).rejects.toEqual(new ProposalConflict('PROPOSAL_LIMIT'));
    const boardLockIndex=writeQueries.findIndex(sql=>sql.includes('FROM whiteboards')&&sql.includes('FOR UPDATE'));
    const quotaIndex=writeQueries.findIndex(sql=>sql.includes('count(*)'));
    expect(boardLockIndex).toBeGreaterThanOrEqual(0);
    expect(quotaIndex).toBeGreaterThan(boardLockIndex);
  });
});
