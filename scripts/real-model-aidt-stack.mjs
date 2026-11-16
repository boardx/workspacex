// Explicit, isolated developer acceptance stack. Never used by aidt:local.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const work = process.env.REAL_MODEL_E2E_WORK_DIR;
const webMode = process.env.REAL_MODEL_E2E_WEB_MODE ?? 'dev';
if (!['dev', 'build-start', 'reuse-start'].includes(webMode)) throw new Error('Unsupported acceptance Web mode.');
if (!work || process.env.WORKSPACEX_REAL_MODEL_DEV_OPT_IN !== '1' || !process.env.WORKSPACEX_ISOLATION_ID || process.env.WORKSPACEX_MODEL_ENV_ONLY !== '1') {
  throw new Error('Use the explicit safe model configuration --stack entry with test isolation.');
}
mkdirSync(work, { recursive: true, mode: 0o700 });
mkdirSync(join(work, 'docker'), { recursive: true, mode: 0o700 });
const api = `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
const web = `http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT}`;
const restoreReceipt = process.env.REAL_MODEL_E2E_RESTORE_RECEIPT;
let FULLSTACK_E2E;
let restored;
if (restoreReceipt) {
  const { verifyRestoredReceipt } = await import('./lib/aidt-checkpoint-restored-db.mjs');
  restored = await verifyRestoredReceipt(root, restoreReceipt);
  FULLSTACK_E2E = restored.fixture;
} else {
  if (webMode === 'reuse-start') throw new Error('Reusing a build requires a verified private restore receipt.');
  ({ FULLSTACK_E2E } = await import(pathToFileURL(join(root, 'apps/web/e2e/fullstack-smoke-fixture.ts'))));
}
const baseEnv = {
  ...process.env,
  DOCKER_CONFIG: join(work, 'docker'),
  REAL_MODEL_E2E_REUSE_IMAGES: '1',
  REAL_MODEL_E2E_USAGE_SPOOL_DIR: join(work, 'usage-spool'),
  REAL_MODEL_E2E_PYTHON_PRELOAD_DIR: join(root, 'scripts/real-model-python'),
  NO_PROXY: [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(','),
  ENABLE_AIDT_MODULE: '1', ENABLE_PROJECT_MEMBER_CHAT: '1',
  // Paid AIDT evidence must use the product's canonical default assistant, never the loopback echo oracle.
  FULLSTACK_E2E_AGENT_INSTRUCTIONS_PROFILE: 'canonical-default',
  KERNEL_SKIP_LOCAL_ENV_FILE: '1',
  NEXT_PUBLIC_ENABLE_AIDT: '1', NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT: '1',
  FULLSTACK_E2E_COLLABORATION_PROJECT_ID: FULLSTACK_E2E.collaborationFixtureProjectId,
  KERNEL_MODEL_MAX_OUTPUT_TOKENS: '2048',
  KERNEL_MODEL_THINKING_DISABLE_IDS: process.env.DASHSCOPE_MODEL,
  KERNEL_MODEL_VISION_IDS: process.env.DASHSCOPE_MODEL,
  KERNEL_DEFAULT_AGENT_MODEL_ID: process.env.DASHSCOPE_MODEL,
  // The native provider requires authenticated per-request accounting callbacks.
  // This is our isolated API, never the uploaded deployment's callback address.
  KERNEL_SUBTASK_CALLBACK_BASE_URL: api,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${JSON.stringify(join(root, 'scripts/real-model-proxy-preload.cjs'))}`].filter(Boolean).join(' '),
};
const children = [];
const launchFailures = new WeakSet();
let stopping = false;
let ready = false;
const log = name => openSync(join(work, name), 'a', 0o600);
function start(command, args, options) {
  const child = spawn(command, args, { ...options, detached: true });
  child.once('error', () => launchFailures.add(child));
  children.push(child);
  return child;
}
async function stop() {
  if (stopping) return;
  stopping = true;
  writeFileSync(join(work, 'status.json'), JSON.stringify({ ready: false, stopped: true, api, web }, null, 2));
  for (const child of children.reverse()) try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  // e2e-up owns children with PID files; verify they were created in our private dir.
  for (const name of ['api', 'sandbox', 'deep-agent']) {
    const p = join(work, `e2e-${name}.pid`);
    if (existsSync(p)) try { process.kill(Number(readFileSync(p, 'utf8').trim()), 'SIGTERM'); } catch {}
  }
  const down = spawn('docker', ['compose', '-f', 'apps/api/docker-compose.dev.yml', '-p', process.env.COMPOSE_PROJECT_NAME, 'down', '-v', '--remove-orphans'], { cwd: root, env: baseEnv, stdio: 'ignore' });
  await new Promise(resolve => down.once('exit', resolve));
}
process.on('SIGTERM', () => void stop().then(() => process.exit(0)));
process.on('SIGINT', () => void stop().then(() => process.exit(0)));
async function wait(url, child, timeout = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (launchFailures.has(child) || child.exitCode !== null || child.signalCode !== null) throw new Error('Acceptance child exited before readiness; inspect private local logs.');
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Acceptance service readiness timed out; inspect private local logs.');
}
try {
  const offlineEnv = {
    ...baseEnv,
    PYTHONPATH: [baseEnv.REAL_MODEL_E2E_PYTHON_PRELOAD_DIR, join(root, 'apps/deep-agent-service/src')].join(':'),
    KERNEL_MODEL_BASE_URL: process.env.DASHSCOPE_BASE_URL,
    KERNEL_MODEL_API_KEY: process.env.DASHSCOPE_API_KEY,
    KERNEL_DEEP_AGENT_MODEL_ID: process.env.DASHSCOPE_MODEL,
    DEEP_AGENT_USAGE_SPOOL_DIR: baseEnv.REAL_MODEL_E2E_USAGE_SPOOL_DIR,
    DEEP_AGENT_USAGE_CALLBACK_BASE_URL: api,
    DEEP_AGENT_SERVICE_INTERNAL_KEY: process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY || 'e2e-internal-key-not-a-secret',
  };
  const offline = start(join(dirname(process.env.REAL_MODEL_E2E_UVICORN), 'python'), [join(root, 'scripts/real-model-python/doctor.py')], { cwd: root, env: offlineEnv, stdio: ['ignore', log('runtime-offline-preflight.log'), log('runtime-offline-preflight.log')] });
  const offlineCode = await new Promise(resolve => { offline.once('exit', resolve); offline.once('error', () => resolve(1)); });
  children.splice(children.indexOf(offline), 1);
  if (offlineCode !== 0) throw new Error('Offline native accounting/model construction preflight failed.');
  const stack = start('bash', ['e2e-up.sh'], { cwd: root, env: baseEnv, stdio: ['ignore', log('stack.log'), log('stack.log')] });
  await wait(`${api}/healthz`, stack);
  // Fixture identity from the same single source that the real-model lane uses.
  const privateRuntime = {
    apiOrigin: api, baseURL: web,
    email: FULLSTACK_E2E.email, password: FULLSTACK_E2E.password,
    leadEmail: FULLSTACK_E2E.leadEmail, leadPassword: FULLSTACK_E2E.leadPassword,
    fundedAdminEmail: FULLSTACK_E2E.adminEmail, fundedAdminPassword: FULLSTACK_E2E.adminPassword,
    orgId: FULLSTACK_E2E.orgId, userId: FULLSTACK_E2E.userId,
    isolation: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('WORKSPACEX_') && !key.includes('ENV_FILE'))),
    composeProject: process.env.COMPOSE_PROJECT_NAME,
  };
  writeFileSync(join(work, 'runtime-private.json'), JSON.stringify(privateRuntime, null, 2), { mode: 0o600 });
  const webEnv = {
    ...baseEnv, NEXT_PUBLIC_API_URL: web,
    NEXT_PUBLIC_API_PATH_PREFIX: '/__fullstack_api', NEXT_PUBLIC_API_WS_URL: api,
    FULLSTACK_E2E_API_ORIGIN: api, NEXT_DIST_DIR: restored ? restored.plan.buildReceipt.dist : '.next-aidt-real-model',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: join(root, 'apps/web/e2e/support/google-fonts-mock.cjs'),
    ...(webMode !== 'dev' ? {
      WORKSPACEX_RELEASE_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: `${baseEnv.NODE_OPTIONS} --max-old-space-size=4096`,
    } : {}),
  };
  if (webMode === 'build-start') {
    writeFileSync(join(work, 'status.json'), JSON.stringify({ ready: false, phase: 'building', api, web, webMode }, null, 2));
    const build = start('pnpm', ['--filter', 'web', 'exec', 'next', 'build'], { cwd: root, env: webEnv, stdio: ['ignore', log('web-build.log'), log('web-build.log')] });
    const code = await new Promise(resolve => { build.once('exit', resolve); build.once('error', () => resolve(1)); });
    children.splice(children.indexOf(build), 1);
    if (code !== 0) throw new Error('Acceptance Web build failed; inspect private build log.');
  }
  const server = start('pnpm', ['--filter', 'web', 'exec', 'next', webMode === 'dev' ? 'dev' : 'start', '--hostname', '127.0.0.1', '-p', process.env.WORKSPACEX_WEB_PORT], { cwd: root, env: webEnv, stdio: ['ignore', log('web.log'), log('web.log')] });
  await wait(`${web}/login`, server);
  ready = true;
  writeFileSync(join(work, 'status.json'), JSON.stringify({ ready, api, web, webMode, nativeDeepAgent: true, realProviderConfigured: true, modelAcceptance: 'pending', pid: process.pid }, null, 2));
  console.log(JSON.stringify({ ready, api, web, runtimeFile: join(work, 'runtime-private.json'), modelAcceptance: 'pending' }));
  await new Promise((resolve, reject) => { for (const child of children) child.once('exit', () => stopping ? resolve() : reject(new Error('Acceptance child exited.'))); });
} catch (error) {
  console.error('[real-model-stack] Failed; inspect private logs. No configuration values emitted.');
  process.exitCode = 1;
} finally { if (!stopping) await stop(); }
