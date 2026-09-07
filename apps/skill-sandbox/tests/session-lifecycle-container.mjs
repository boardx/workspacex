// Run via docker exec against the running sessions service, never on the host.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.SKILL_SANDBOX_SESSIONS_ONLY, '1');
async function call(method, path, body, token) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: process.env.SKILL_SANDBOX_SOCKET, method, path,
      headers: { ...(data ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res => {
      let text = ''; res.on('data', chunk => text += chunk);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(data);
  });
}
async function processes() {
  const entries = await readdir('/proc');
  const states = await Promise.all(entries.filter(name => /^\d+$/.test(name)).map(async name => {
    try { return (await readFile(`/proc/${name}/stat`, 'utf8')).match(/^\d+ \(.+\) (\S)/)?.[1]; } catch { return undefined; }
  }));
  return { count: states.filter(Boolean).length, zombies: states.filter(state => state === 'Z').length };
}
assert.equal((await call('GET', '/healthz')).status, 200);
const baseline = await processes();
assert.equal(baseline.zombies, 0, JSON.stringify(baseline));
for (let batch = 0; batch < 2; batch++) {
  const created = await call('POST', '/sessions', {});
  assert.equal(created.status, 201, JSON.stringify(created));
  const { sessionId, token } = created.body;
  try {
    for (let index = 0; index < 80; index++) {
      const result = await call('POST', `/sessions/${sessionId}/executions`, {
        executionId: randomUUID(), command: 'node -e "console.log(42)"', timeoutMs: 10000,
      }, token);
      assert.equal(result.status, 200, `batch=${batch} execution=${index}: ${JSON.stringify(result)}`);
      assert.equal(result.body.exitCode, 0, JSON.stringify(result));
      assert.match(result.body.output, /42/);
    }
  } finally { assert.equal((await call('DELETE', `/sessions/${sessionId}`, undefined, token)).status, 200); }
  // Allow the container init a bounded turn to reap orphaned namespace helpers.
  let settled;
  for (let attempt = 0; attempt < 100; attempt++) {
    settled = await processes();
    if (settled.zombies === 0 && settled.count <= baseline.count + 2) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(settled.zombies, 0, JSON.stringify(settled));
  assert.ok(settled.count <= baseline.count + 2, JSON.stringify({ baseline, settled }));
  console.log(JSON.stringify({ completedExecutions: (batch + 1) * 80, baseline, settled }));
}
console.log('SESSION_LIFECYCLE_160_EXECUTIONS_NO_ZOMBIE_ACCUMULATION_OK');
