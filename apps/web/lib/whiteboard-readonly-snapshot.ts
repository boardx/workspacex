import * as Y from 'yjs';
import { createWhiteboardDocument, readObjects } from '@repo/whiteboard-core';
import { WHITEBOARD_SYNC, WhiteboardClientMessage, WhiteboardServerMessage } from '@repo/contracts/whiteboard-sync';
import { apiWebSocketUrl, getStoredSessionToken } from './api-client';
import { bytesToBase64, base64ToBytes } from './whiteboard-provider';

/** One authorized read handshake; never loads outbox, sends edits/presence or resumes pending work. */
export async function readReadonlyBoardSnapshot(boardId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const token = getStoredSessionToken();
  if (!token) throw new Error('BOARD_SNAPSHOT_SESSION_REQUIRED');
  const doc = createWhiteboardDocument();
  let socket: WebSocket;
  try { socket = new WebSocket(apiWebSocketUrl(WHITEBOARD_SYNC.path.replace(':boardId', encodeURIComponent(boardId))), [WHITEBOARD_SYNC.protocol, WHITEBOARD_SYNC.bearerSubprotocolPrefix + token]); }
  catch (error) { doc.destroy(); throw error; }
  return new Promise<{ revision: { epoch: number; seq: number }; role: Extract<WhiteboardServerMessage, { type: 'sync' }>['role']; archived: boolean; objects: ReturnType<typeof readObjects> }>((resolve, reject) => {
    let settled = false, helloSent = false;
    const finish = (error?: unknown, value?: Parameters<typeof resolve>[0]) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      // Cleanup cannot replace the first failure or a successfully captured snapshot.
      try { socket.close(); } catch { /* detached read socket */ }
      try { doc.destroy(); } catch { /* detached empty document */ }
      if (error !== undefined) reject(error); else resolve(value!);
    };
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('BOARD_SNAPSHOT_TIMEOUT')), 10_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    const sameSession = () => getStoredSessionToken() === token;
    socket.onopen = () => {
      if (settled || helloSent) return;
      if (!sameSession()) { finish(new Error('BOARD_SNAPSHOT_SESSION_CHANGED')); return; }
      try { helloSent = true; socket.send(JSON.stringify(WhiteboardClientMessage.parse({ type: 'hello', stateVector: bytesToBase64(Y.encodeStateVector(doc)) }))); }
      catch (error) { finish(error); }
    };
    socket.onmessage = event => {
      if (!sameSession()) { finish(new Error('BOARD_SNAPSHOT_SESSION_CHANGED')); return; }
      try {
        const message = WhiteboardServerMessage.parse(JSON.parse(String(event.data)));
        if (message.type === 'error' || message.type === 'recovery') { finish(new Error('BOARD_SNAPSHOT_READ_REJECTED')); return; }
        if (message.type !== 'sync') return;
        Y.applyUpdate(doc, base64ToBytes(message.update));
        finish(undefined, { revision: { epoch: message.epoch, seq: message.seq }, role: message.role, archived: message.archived, objects: readObjects(doc) });
      } catch (error) { finish(error); }
    };
    socket.onerror = () => finish(new Error('BOARD_SNAPSHOT_CONNECTION_FAILED'));
    socket.onclose = () => finish(new Error('BOARD_SNAPSHOT_CONNECTION_CLOSED'));
  });
}
