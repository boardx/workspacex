import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { guard } from '../../src/application/security/permission-filter';
import { importChatDiagram, ImportChatDiagramError } from '../../src/application/whiteboard/import-chat-diagram';

const principal = { userId: 'user-1', orgId: 'org-1' as never };
const code = 'flowchart LR\n  a[Start] --> b[Done]';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceRef = {
  threadId: 'thread-1', messageId: 'message-1', kind: 'mermaid' as const,
  sourceHash: digest(code), blockId: digest(`mermaid\0${code}`), sourceVersion: `sha256:${digest(code)}`,
};
const input = {
  requestId: randomUUID(), acceptedLosses: ['PLUGIN_STYLE_NOT_RENDERED' as const], sourceRef,
  bundle: {
    schemaVersion: 1 as const, converterVersion: 'diagram-copy/1' as const, groupId: 'source',
    payloadReferenceSpace: 'source-local' as const, nodeIds: { a: 'a', b: 'b' }, edgeIds: { e: 'e' }, diagnostics: [],
    model: { kind: 'flowchart', direction: 'LR', nodes: [
      { id: 'a', label: 'Start', shape: 'rect', x: 60, y: 60, width: 120, height: 60 },
      { id: 'b', label: 'Done', shape: 'rect', x: 260, y: 60, width: 120, height: 60 },
    ], edges: [{ id: 'e', source: 'a', target: 'b', kind: 'arrow' }] },
  },
};
function deps(role: 'owner' | 'editor' | 'viewer' = 'owner') {
  const writeCommands = vi.fn(async (_principal: unknown, _boardId: string, _input: { commands: any[] }) => ({ epoch: 1, seq: 4, updateId: input.requestId, replayed: false, update: new Uint8Array([1]) }));
  const findMessages = vi.fn(async () => guard({ kind: 'project', id: 'personal:thread-1' }, [{
    id: 'message-1', authorKind: 'agent', authorId: 'agent', agentId: null,
    body: `Here it is\n\n\`\`\`mermaid\n${code}\n\`\`\``, rawTranscript: false,
    visibilityScope: null, reviewPending: false, createdAt: new Date().toISOString(),
  }]));
  return {
    value: {
      boards: { get: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', name: 'Board', ownerId: 'user-1', role, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) },
      collaboration: { head: vi.fn(async () => ({ epoch: 1, seq: 3, role, archived: false })), writeCommands },
      chat: {
        findMessageLocation: vi.fn(async () => ({ threadId: 'thread-1', projectId: null })),
        findThreadFacts: vi.fn(async () => ({ threadId: 'thread-1', projectId: null, groupId: null, visibilityScope: 'private', createdBy: 'user-1', archived: false })),
        findMessages,
      },
      repo: {
        findOrgMembership: vi.fn(async () => ({ orgRole: 'member', teamId: null })),
        findProjectMembership: vi.fn(async () => null),
        findBindings: vi.fn(async () => new Map()),
      }, ids: { next: vi.fn(() => 'decision-1') },
    } as any,
    writeCommands, findMessages,
  };
}

describe('Chat diagram → Board import', () => {
  it('verifies both resources and commits one atomic command batch with durable ACK', async () => {
    const d = deps();
    const result = await importChatDiagram(d.value, principal, '11111111-1111-4111-8111-111111111111', input);
    expect(result).toMatchObject({ epoch: 1, seq: 4 });
    expect(d.writeCommands).toHaveBeenCalledTimes(1);
    const commands = d.writeCommands.mock.calls[0]![2].commands;
    expect(commands).toHaveLength(4);
    expect(commands[0].object.extensionData.sourceRef).toEqual(sourceRef);
  });

  it('checks target write permission before reading chat content', async () => {
    const d = deps('viewer');
    await expect(importChatDiagram(d.value, principal, '11111111-1111-4111-8111-111111111111', input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(d.findMessages).not.toHaveBeenCalled();
    expect(d.writeCommands).not.toHaveBeenCalled();
  });

  it('rejects changed sources and missing loss consent without a partial write', async () => {
    const changed = deps();
    await expect(importChatDiagram(changed.value, principal, '11111111-1111-4111-8111-111111111111', {
      ...input, sourceRef: { ...sourceRef, sourceHash: '0'.repeat(64), sourceVersion: `sha256:${'0'.repeat(64)}` },
    })).rejects.toBeInstanceOf(ImportChatDiagramError);
    expect(changed.writeCommands).not.toHaveBeenCalled();
    const unaccepted = deps();
    await expect(importChatDiagram(unaccepted.value, principal, '11111111-1111-4111-8111-111111111111', { ...input, acceptedLosses: [] })).rejects.toMatchObject({ code: 'LOSS_CONSENT_REQUIRED' });
    expect(unaccepted.writeCommands).not.toHaveBeenCalled();
  });
});
