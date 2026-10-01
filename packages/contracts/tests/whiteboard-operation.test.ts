import { describe, expect, it } from 'vitest';
import {
  RenderedDiagramLayout, WhiteboardAIProposal, WhiteboardOperationRequest,
  WhiteboardPointerCapability, WhiteboardPresentationCommand,
} from '../src/whiteboard-operation';

const actor = { kind: 'ai', actorId: 'agent-1', orgId: 'org-1', role: 'editor', scopes: ['board:read', 'board:write'], delegatedBy: 'user-1' };
const boardId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const object = { id: 'n1', schemaVersion: 1, kind: 'sticky', geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, text: 'idea', style: {}, parentId: null, orderKey: '' };

describe('versioned public Board operation contracts', () => {
  it('pins actor, revision, idempotency, provenance and canonical commands', () => {
    const parsed = WhiteboardOperationRequest.parse({ apiVersion: '2026-09-01', requestId, boardId,
      expectedRevision: { epoch: 1, seq: 0 }, actor, commands: [{ type: 'create', object }],
      provenance: { source: 'ai-proposal', model: 'gpt', skill: 'cluster', inputObjectIds: [] } });
    expect(parsed.actor.kind).toBe('ai');
    expect(parsed.provenance.source).toBe('ai-proposal');
    expect(() => WhiteboardOperationRequest.parse({ ...parsed, apiVersion: 'latest' })).toThrow();
    expect(() => WhiteboardOperationRequest.parse({ ...parsed, actor: { ...actor, scopes: ['root'] } })).toThrow();
  });

  it('requires click-time geometry identities and a bounded layout integrity token', () => {
    const layout = RenderedDiagramLayout.parse({ schemaVersion: 1, artifactId: 'chat-a', orgId: 'org-1', sourceRevision: 'r7', diagramKind: 'sequence',
      objects: [{ sourceId: 'alice', kind: 'node', geometry: { x: 10, y: 20, width: 120, height: 40, rotation: 0 }, text: 'Alice', style: {}, fromSourceId: null, toSourceId: null }],
      layoutHash: `layout-v1:${'01'.repeat(32)}` });
    expect(layout.objects[0]?.geometry.x).toBe(10);
    expect(() => RenderedDiagramLayout.parse({ ...layout, layoutHash: 'sha256:nope' })).toThrow();
  });

  it('models preview state separately from confirmation and preserves input digests', () => {
    const proposal = WhiteboardAIProposal.parse({ proposalId: requestId, boardId, createdBy: actor, baseRevision: { epoch: 1, seq: 4 },
      baseObjectDigests: { n1: `object-v1:${'01'.repeat(32)}` }, action: { type: 'arrange', objectIds: ['n1'], layout: 'grid', commands: [{ type: 'geometry', id: 'n1', geometry: object.geometry }] },
      provenance: { source: 'ai-proposal', model: 'gpt', skill: 'organize', inputObjectIds: ['n1'] }, status: 'preview',
      createdAt: '2026-09-26T00:00:00.000Z', expiresAt: '2026-09-26T00:05:00.000Z' });
    expect(proposal.status).toBe('preview');
    expect(proposal.baseObjectDigests.n1).toMatch(/^object-v1:/);
  });

  it('covers presenter handoff and touch/stylus meeting-room capabilities', () => {
    expect(WhiteboardPresentationCommand.parse({ type: 'handoff', actorId: 'room-1', toActorId: 'user-2', expectedRevision: 3 }).type).toBe('handoff');
    expect(WhiteboardPointerCapability.parse({ pointerType: 'pen', pressure: .7, roomIdentity: 'meeting-room-a', reconnectToken: '1234567890abcdef' }).pressure).toBe(.7);
  });
});
