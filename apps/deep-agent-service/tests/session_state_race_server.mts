/** Real session HTTP boundary; only the OS execution provider is held for this race test. */
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../../skill-sandbox/src/session/manager.js';
import { handleSessionRequest } from '../../skill-sandbox/src/session/http.js';
const root = await mkdtemp(join(tmpdir(), 'wx-state-race-'));
let busy = false;
let release: (() => void) | undefined;
let conflicts = 0;
const manager = new SessionManager({probe: async () => true, execute: async input => {
  busy = true;
  await new Promise<void>(resolve => { release = resolve; });
  busy = false;
  return {executionId:input.executionId,exitCode:0,output:'ok',truncated:false,timedOut:false,cancelled:false};
}}, root);
const server = createServer(async (req, res) => {
  if (req.url === '/probe') { res.end(JSON.stringify({busy, conflicts})); return; }
  if (req.url === '/release') { release?.(); res.end('{}'); return; }
  res.on('finish', () => { if (res.statusCode === 409) conflicts++; });
  if (!await handleSessionRequest(req, res, manager)) { res.statusCode = 404; res.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:(server.address() as {port:number}).port})));
process.on('SIGTERM', () => { release?.(); server.close(async () => { await rm(root,{recursive:true,force:true});process.exit(); }); });
