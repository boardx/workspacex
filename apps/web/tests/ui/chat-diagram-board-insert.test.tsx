import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listBoards: vi.fn(), importDiagram: vi.fn() }));
vi.mock('@/lib/live-whiteboard', () => api);
vi.mock('@repo/fabric-markdown', () => ({
  mermaidToModel: vi.fn(async () => ({ kind: 'flowchart', direction: 'LR', nodes: [{ id: 'a', label: 'A', shape: 'rect', x: 0, y: 0, width: 100, height: 60 }], edges: [] })),
  templateToModel: vi.fn(),
  diagramToWhiteboard: vi.fn((model, id) => ({ schemaVersion: 1, converterVersion: 'diagram-copy/1', groupId: id, payloadReferenceSpace: 'source-local', nodeIds: { a: 'a' }, edgeIds: {}, diagnostics: [], model })),
}));
vi.mock('@repo/whiteboard-core', () => ({
  prepareDiagramImport: vi.fn(() => ({ ok: true, groupId: 'group', objects: [], commands: [], losses: [{ code: 'PLUGIN_STYLE_NOT_RENDERED', detail: 'style' }] })),
}));

import { ChatDiagramBoardInsert } from '@/components/chat/chat-diagram-board-insert';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
    subtle: { digest: async () => new Uint8Array(32).fill(1).buffer },
  } });
  api.listBoards.mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222', name: 'Team Board', role: 'editor', archived: false }]);
  api.importDiagram.mockResolvedValue({ boardId: '22222222-2222-4222-8222-222222222222', groupId: 'group', epoch: 1, seq: 1, losses: [] });
});

describe('Chat diagram Board insertion', () => {
  it('disables incomplete sources and explains why', () => {
    render(<ChatDiagramBoardInsert code="flowchart LR\na-->b" kind="mermaid" closed={false} />);
    expect(screen.getByRole('button', { name: '插入到 Board' })).toBeDisabled();
    expect(screen.getByText(/图表仍在生成/)).toBeInTheDocument();
  });

  it('requires explicit loss consent, then sends a stable idempotent import', async () => {
    render(<ChatDiagramBoardInsert code="flowchart LR\na-->b" kind="mermaid" closed threadId="thread" messageId="message" bearer="token" />);
    fireEvent.click(screen.getByRole('button', { name: '插入到 Board' }));
    await screen.findByRole('option', { name: 'Team Board' });
    fireEvent.click(screen.getByRole('button', { name: '检查并插入' }));
    expect(await screen.findByTestId('board-insert-losses')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '确认插入' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.importDiagram).toHaveBeenCalledTimes(1));
    expect(api.importDiagram.mock.calls[0]![1]).toMatchObject({
      requestId: '11111111-1111-4111-8111-111111111111',
      acceptedLosses: ['PLUGIN_STYLE_NOT_RENDERED'],
      sourceRef: { threadId: 'thread', messageId: 'message', sourceVersion: expect.stringMatching(/^sha256:/) },
    });
    expect(await screen.findByText('已持久写入 Board。')).toBeInTheDocument();
  });
});
