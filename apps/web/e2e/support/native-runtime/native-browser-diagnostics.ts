import { createHash } from 'node:crypto';
import type { Page, WebSocket, CDPSession } from '@playwright/test';

const maximum = 12;
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
function errorClass(error: Error) {
  return ['ReferenceError', 'TypeError', 'SyntaxError', 'RangeError', 'SecurityError', 'AbortError'].includes(error.name) ? error.name : 'OtherError';
}
/** Passive, bounded evidence: never records credentials, URLs, queries, protocols or WS frames. */
export function observeNativeBrowserDiagnostics(page: Page, expectedApiOrigin: string) {
  let websocketCreated = 0, pageerrorCount = 0, dropped = 0;
  const errors: Array<{ class: string; stackHash: string; scriptClass: string }> = [];
  const sockets: Array<{ originMatchesManifest: boolean; pathClass: string }> = [];
  const documents: Array<{ online: boolean; sessionRecordPresent: boolean; sessionVersionValid: boolean; sessionCommitMatches: boolean; sessionActorPresent: boolean; sessionOrgPresent: boolean; tokenPresent: boolean }> = [];
  let cdp: CDPSession | null = null, cdpEnabled = false, socketClosed = 0, disposed = false;
  const boardRequests = new Set<string>();
  const handshakeStatuses: number[] = [], networkFailures: string[] = [];
  const ready = page.context().newCDPSession(page).then(async session => {
    if (disposed) { await session.detach(); return; }
    cdp = session;
    session.on('Network.webSocketCreated', (event: {requestId:string;url:string}) => {
      try { if (/^\/whiteboards\/[^/]+\/sync$/.test(new URL(event.url).pathname) && boardRequests.size < maximum) boardRequests.add(event.requestId); } catch { /* no raw URL retention */ }
    });
    session.on('Network.webSocketHandshakeResponseReceived', (event: {requestId:string;response:{status:number}}) => {
      if (!boardRequests.has(event.requestId)) return;
      if (handshakeStatuses.length < maximum) handshakeStatuses.push(event.response.status); else dropped++;
      // Deliberately do not access response headers, status text or request handshake fields.
    });
    session.on('Network.loadingFailed', (event: {requestId:string;errorText:string}) => {
      if (!boardRequests.has(event.requestId)) return;
      const known = ['ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_TIMED_OUT', 'ERR_FAILED', 'ERR_ABORTED'];
      const category = known.find(code => event.errorText === `net::${code}`) ?? 'OTHER_NETWORK_ERROR';
      if (networkFailures.length < maximum) networkFailures.push(category); else dropped++;
    });
    session.on('Network.webSocketClosed', (event: {requestId:string}) => { if (boardRequests.has(event.requestId)) socketClosed++; });
    await session.send('Network.enable'); cdpEnabled = true;
  }).catch(() => { /* Unsupported browser or a closed page: report availability only. */ });
  const pending = new Set<Promise<void>>();
  const readDocument = async () => {
    try {
      const value = await page.evaluate(() => {
        let session: Record<string, unknown> | null = null;
        const raw = localStorage.getItem('wsx.session');
        try { session = raw ? JSON.parse(raw) as Record<string, unknown> : null; } catch { /* boolean diagnostic only */ }
        return { online: navigator.onLine, sessionRecordPresent: Boolean(raw), sessionVersionValid: session?.version === 2,
          sessionCommitMatches: typeof session?.revision === 'string' && session.revision === localStorage.getItem('wsx.sessionCommit'),
          sessionActorPresent: typeof session?.userId === 'string' && session.userId.length > 0,
          sessionOrgPresent: typeof session?.currentOrgId === 'string' && Array.isArray(session.orgs) && session.orgs.includes(session.currentOrgId),
          tokenPresent: Boolean(localStorage.getItem('wsx.sessionToken')) };
      });
      if (documents.length < maximum) documents.push(value); else dropped++;
    } catch { /* Navigation/closed document is not evidence of invalid identity. */ }
  };
  const documentReady = () => { const task = readDocument(); pending.add(task); void task.finally(() => pending.delete(task)); };
  const pageerror = (error: Error) => {
    pageerrorCount++;
    if (errors.length >= maximum) { dropped++; return; }
    const stack = error.stack ?? error.name;
    errors.push({ class: errorClass(error), stackHash: fingerprint(stack), scriptClass: stack.includes('/_next/static/chunks/') ? 'next-static-chunk' : stack.includes('/_next/') ? 'next-runtime' : 'unclassified' });
  };
  const websocket = (socket: WebSocket) => {
    websocketCreated++;
    if (sockets.length >= maximum) { dropped++; return; }
    try {
      const url = new URL(socket.url()); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      sockets.push({ originMatchesManifest: url.origin === new URL(expectedApiOrigin).origin,
        pathClass: /^\/whiteboards\/[^/]+\/sync$/.test(url.pathname) ? 'board-sync' : 'other' });
    } catch { sockets.push({ originMatchesManifest: false, pathClass: 'invalid' }); }
  };
  page.on('domcontentloaded', documentReady); page.on('pageerror', pageerror); page.on('websocket', websocket);
  return {
    ready,
    async snapshot() { await ready; await Promise.allSettled([...pending]); await readDocument(); return { version: 2, cdpEnabled, handshakeStatuses: [...handshakeStatuses], networkFailures: [...networkFailures], socketClosed, websocketCreated, pageerrorCount, dropped, errors: [...errors], sockets: [...sockets], documents: [...documents] }; },
    dispose() { disposed = true; if (cdp) { cdp.removeAllListeners(); void cdp.detach().catch(() => {}); cdp = null; } page.off('domcontentloaded', documentReady); page.off('pageerror', pageerror); page.off('websocket', websocket); },
  };
}
