// Default Docker profile regression; no session setup exceptions.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createSandboxServer } from '/opt/sandbox/dist/server.js';
const server = createSandboxServer({ preinstalledModulesDir: '/opt/sandbox/node_modules' });
const socketPath = '/tmp/legacy-integration.sock';
await new Promise((resolve) => server.listen(socketPath, resolve));
try {
  const body = JSON.stringify({ script: "console.log('LEGACY_RUN_OK')", timeoutMs: 10000 });
  const result = await new Promise((resolve, reject) => {
    const req = request({ socketPath, method: 'POST', path: '/run', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = ''; res.on('data', (chunk) => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.exitCode, 0, JSON.stringify(result));
  assert.match(result.body.stdout, /LEGACY_RUN_OK/); console.log('DEFAULT_PROFILE_LEGACY_RUN_OK');
} finally { await new Promise((resolve) => server.close(resolve)); }
