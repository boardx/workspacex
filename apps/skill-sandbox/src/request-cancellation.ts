import type { IncomingMessage, ServerResponse } from 'node:http';
/** Response close fires on client disconnect, while request close also fires after a normal body. */
export function requestCancellation(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  req.on('aborted', abort); res.on('close', abort);
  if (req.aborted || res.destroyed) controller.abort();
  return { signal: controller.signal, dispose: () => { req.off('aborted', abort); res.off('close', abort); } };
}
