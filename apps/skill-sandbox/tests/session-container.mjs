// Run inside the opt-in hardened container; never on the host.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import { BubblewrapProvider } from '/opt/sandbox/dist/session/provider.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const socketPath = process.env.SKILL_SANDBOX_SOCKET;
assert.equal(process.env.SKILL_SANDBOX_SESSIONS_ONLY, '1');
const service = spawn(process.execPath, ['/opt/sandbox/dist/main.js'], { stdio: 'inherit' });
const stopped = new Promise((resolve) => service.once('exit', resolve));
async function call(method, path, body, token) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: {
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    } }, (res) => { let text = ''; res.on('data', (chunk) => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) })); });
    req.on('error', reject); req.end(data);
  });
}
let session;
let sibling;
try {
  let ready = false;
  const startupDeadline = Date.now() + 10000;
  while (!ready && Date.now() < startupDeadline) {
    try { ready = (await call('GET', '/healthz')).status === 200; } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(ready, true, 'main service must start on its configured session socket');
  assert.equal((await call('POST', '/run', { script: 'throw new Error("must not run")' })).status, 404);
  assert.equal(await new BubblewrapProvider('/usr/bin/bwrap', '/missing-filter.bpf').probe(), false);
  await writeFile('/tmp/invalid-filter.bpf', 'not-bpf');
  assert.equal(await new BubblewrapProvider('/usr/bin/bwrap', '/tmp/invalid-filter.bpf').probe(), false);
  await unlink('/tmp/invalid-filter.bpf');
  const created = await call('POST', '/sessions', { skills: [{ path: '/skills/test/SKILL.md', contentBase64: Buffer.from('immutable').toString('base64') }] });
  assert.equal(created.status, 201); session = created.body;
  sibling = (await call('POST', '/sessions', {})).body;
  assert.equal((await call('POST', `/sessions/${sibling.sessionId}/files`, { path: '/workspace/sibling-secret', contentBase64: 'c2VjcmV0' }, sibling.token)).status, 200);
  assert.equal((await call('GET', `/sessions/${sibling.sessionId}/files?path=/workspace/sibling-secret`, undefined, session.token)).status, 404);
  const prefix = `/sessions/${session.sessionId}`;
  const execute = (command, timeoutMs = 10000, executionId = randomUUID()) => call('POST', `${prefix}/executions`, { executionId, command, timeoutMs }, session.token);
  const python = `import pathlib,ctypes,os,socket\np=pathlib.Path('/workspace/python.txt');p.write_text('python-ok')\nassert not pathlib.Path('/run/sessions').exists()\nassert not pathlib.Path('/proc').exists()\nassert not pathlib.Path('/workspace/sibling-secret').exists()\nassert not any(p.name.startswith('wx-session-') for p in pathlib.Path('/tmp').iterdir())\nnet=socket.socket();net.settimeout(.2)\ntry: net.connect(('1.1.1.1',80));raise AssertionError('external network available')\nexcept OSError: pass\nfinally: net.close()\nassert not any('token' in k.lower() for k in os.environ)\ntry: pathlib.Path('/skills/test/SKILL.md').write_text('bad');raise AssertionError('write permitted')\nexcept OSError: pass\nc=ctypes.CDLL(None,use_errno=True)\nassert c.unshare(0x10000000)==-1 and ctypes.get_errno()==1\nassert c.setns(-1,0)==-1 and ctypes.get_errno()==1\nassert c.mount(b'none',b'/tmp',b'tmpfs',0,None)==-1 and ctypes.get_errno()==1\ns=ctypes.CDLL('libseccomp.so.2');s.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]\nclone=s.seccomp_syscall_resolve_name(b'clone')\nfor bit in [0x80,0x20000,0x2000000,0x4000000,0x8000000,0x10000000,0x20000000,0x40000000]:\n assert c.syscall(clone,bit|17,0,0,0,0)==-1 and ctypes.get_errno()==1\nassert c.syscall(s.seccomp_syscall_resolve_name(b'clone3'),0,0)==-1 and ctypes.get_errno()==38\nprint('PYTHON_ISOLATION_OK')`;
  const uploaded = await call('POST', `${prefix}/files`, { path: '/workspace/check.py', contentBase64: Buffer.from(python).toString('base64') }, session.token);
  assert.equal(uploaded.status, 200);
  const ran = await execute(`python3 /workspace/check.py && node -e "require('fs').writeFileSync('/workspace/node.txt','node-ok');console.log('NODE_OK')"`);
  assert.equal(ran.status, 200, JSON.stringify(ran)); assert.equal(ran.body.exitCode, 0, JSON.stringify(ran));
  assert.match(ran.body.output, /PYTHON_ISOLATION_OK/); assert.match(ran.body.output, /NODE_OK/);
  for (const language of ['python', 'node']) {
    const file = await call('GET', `${prefix}/files?path=${encodeURIComponent(`/workspace/${language}.txt`)}`, undefined, session.token);
    assert.equal(file.status, 200); assert.equal(Buffer.from(file.body.contentBase64, 'base64').toString(), `${language}-ok`);
  }
  const noisy = await execute(`python3 -c "import sys;sys.stdout.write('x'*1000000);open('/workspace/drained','w').write('finished')"`);
  assert.equal(noisy.body.truncated, true); assert.equal(noisy.body.exitCode, 0);
  assert.equal((await call('GET', `${prefix}/files?path=/workspace/drained`, undefined, session.token)).status, 200);
  const timed = await execute('python3 -c "import time;time.sleep(20)"', 100);
  assert.equal(timed.body.timedOut, true);
  const executionId = randomUUID();
  const pending = execute('python3 -c "import time;time.sleep(20)"', 10000, executionId);
  let cancelled = false;
  const deadline = Date.now() + 5000;
  while (!cancelled && Date.now() < deadline) {
    cancelled = (await call('POST', `${prefix}/executions/${executionId}/cancel`, {}, session.token)).body.cancelled;
    if (!cancelled) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(cancelled, true);
  assert.equal((await pending).body.cancelled, true);
  console.log('HTTP_SESSION_PYTHON_NODE_DOWNLOAD_TIMEOUT_CANCEL_OK');
} finally {
  if (sibling) await call('DELETE', `/sessions/${sibling.sessionId}`, undefined, sibling.token);
  if (session) await call('DELETE', `/sessions/${session.sessionId}`, undefined, session.token);
  service.kill('SIGTERM'); await stopped;
}
