import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, readObjects, BoardCommandPort, createStickyBatchEnvelope } from '@repo/whiteboard-core';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import { readReadonlyBoardSnapshot } from '@/lib/whiteboard-readonly-snapshot';
import { getStoredSessionToken } from '@/lib/api-client';
vi.mock('@/lib/api-client', () => ({ getStoredSessionToken: vi.fn(), apiWebSocketUrl: (path: string) => `ws://localhost${path}` }));
class ReadSocket {
  static instances: ReadSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor(readonly url: string, readonly protocols: string[]) { ReadSocket.instances.push(this); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getStoredSessionToken).mockReturnValue('private-token'); ReadSocket.instances = []; vi.stubGlobal('WebSocket', ReadSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('isolated readonly canonical Board handshake', () => {
  it('sends exactly one empty hello, captures actual viewer archived sync and closes without writes', async () => {
    const doc = createWhiteboardDocument();
    new BoardCommandPort(doc).dispatch(createStickyBatchEnvelope({ boardId: 'board', clientId: 'client', gestureId: 'gesture', items: [{ id: 'sticky', text: 'read only', geometry: { x: 0, y: 0, width: 200, height: 160, rotation: 0 } }] }));
    const update = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))), expected = readObjects(doc); doc.destroy();
    const result = readReadonlyBoardSnapshot('board', new AbortController().signal), socket = ReadSocket.instances[0]!;
    socket.onopen!(); expect(socket.protocols).toEqual([WHITEBOARD_SYNC.protocol, WHITEBOARD_SYNC.bearerSubprotocolPrefix + 'private-token']);
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toEqual({ type: 'hello', stateVector: 'AA==' });
    socket.message({ type: 'sync', epoch: 3, seq: 19, role: 'viewer', archived: true, update });
    expect(await result).toEqual({ revision: { epoch: 3, seq: 19 }, role: 'viewer', archived: true, objects: expected });
    expect(socket.send).toHaveBeenCalledTimes(1); expect(socket.close).toHaveBeenCalledOnce();
  });
  it('cancels and times out without sending updates or leaving the socket alive', async () => {
    const controller = new AbortController(), result = readReadonlyBoardSnapshot('board', controller.signal), socket = ReadSocket.instances[0]!;
    controller.abort(); await expect(result).rejects.toMatchObject({ name: 'AbortError' }); expect(socket.close).toHaveBeenCalledOnce(); expect(socket.send).not.toHaveBeenCalled();
    vi.useFakeTimers(); const timeout = readReadonlyBoardSnapshot('board', new AbortController().signal);
    const rejected = expect(timeout).rejects.toThrow('BOARD_SNAPSHOT_TIMEOUT'); await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(ReadSocket.instances[1]!.close).toHaveBeenCalledOnce(); expect(ReadSocket.instances[1]!.send).not.toHaveBeenCalled();
  });
  it('preserves rejection even if cleanup throws and refuses a changed session', async () => {
    const denied = readReadonlyBoardSnapshot('board', new AbortController().signal), socket = ReadSocket.instances[0]!;
    socket.close.mockImplementation(() => { throw new Error('cleanup'); }); socket.message({ type: 'error', code: 'FORBIDDEN', recoverable: false });
    await expect(denied).rejects.toThrow('BOARD_SNAPSHOT_READ_REJECTED'); expect(socket.send).not.toHaveBeenCalled();
    const changed = readReadonlyBoardSnapshot('board', new AbortController().signal); vi.mocked(getStoredSessionToken).mockReturnValue('other-token');
    ReadSocket.instances[1]!.onopen!(); await expect(changed).rejects.toThrow('BOARD_SNAPSHOT_SESSION_CHANGED'); expect(ReadSocket.instances[1]!.send).not.toHaveBeenCalled();
  });
});
