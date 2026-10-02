#!/usr/bin/env node
/**
 * Isolated true API + Web + PGlite acceptance stack, using the configured real model.
 * User authorization is required before reading --model-config and calling its provider.
 * Credentials stay in memory and are never printed. Does not discover or manage Ollama.
 * The data directory must already be migrated/seeded with local-runtime.
 * Run: node --import tsx scripts/local-session/design-html-stack.mjs
 * --data-dir /private/tmp/wsx-html-data --model-config /path/to/.env.local
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const cfg = await import(join(root, 'packages/local-runtime/src/config.ts'));
const db = await import(join(root, 'packages/local-runtime/src/pglite-server.ts'));
const proc = await import(join(root, 'packages/local-runtime/src/processes.ts'));
const launch = await import(join(root, 'packages/local-runtime/src/node-launch.ts'));
const config = cfg.resolveLocalConfig({
  repoRoot: root,
  dataDir: arg('data-dir', '/private/tmp/wsx-html-data'),
  ports: {
    api: Number(arg('api-port', '3292')),
    web: Number(arg('web-port', '3192')),
    postgres: Number(arg('pg-port', '55992')),
    sandbox: 3392, deepAgent: 2292, asr: 3393, ollama: 11492,
  },
});
const modelConfigPath = arg('model-config', null);
const env = cfg.apiEnv(config);
if (modelConfigPath) {
  const local = {};
  for (const line of readFileSync(modelConfigPath, 'utf8').split('\n')) {
    const match = /^(\w+)=(.*)$/.exec(line);
    if (match) local[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  for (const [key, value] of Object.entries(local)) {
    if (/^KERNEL_(MODEL_|DEFAULT_AGENT_MODEL_ID|FEEDBACK_STRUCTURE_MODEL_ID)/.test(key)) env[key] = value;
  }
  env.KERNEL_MODEL_ID = local.KERNEL_DEFAULT_AGENT_MODEL_ID || local.KERNEL_MODEL_ID || 'qwen3.5-plus';
  env.KERNEL_DEFAULT_AGENT_MODEL_ID = env.KERNEL_MODEL_ID;
  env.KERNEL_FEEDBACK_STRUCTURE_MODEL_ID = env.KERNEL_MODEL_ID;
}
const pg = await db.startPgliteServer({
  dataDir: join(config.dataDir, 'pgdata'),
  port: config.ports.postgres,
  username: cfg.DB_APP_ROLE,
});
const children = [];
function start(name, directory, args, environment, next = false) {
  const command = next ? launch.nextLaunch(root, args) : launch.tsxLaunch(root, args);
  const child = proc.startManaged({
    name, command: command.command, args: command.args,
    cwd: join(root, directory), env: environment, logDir: cfg.paths.logs(config),
  });
  children.push(child);
  return child;
}
let closing = false;
async function close(exitCode = 0) {
  if (closing) return;
  closing = true;
  const errors = [];
  for (const child of children.reverse()) {
    try { await child.stop(); } catch (error) { errors.push(error); }
  }
  try { await pg.stop(); } catch (error) { errors.push(error); }
  process.exit(exitCode || (errors.length > 0 ? 1 : 0));
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
try {
  start('sandbox', 'apps/skill-sandbox', ['src/main.ts'], cfg.sandboxEnv(config));
  const api = start('api', 'apps/api', ['src/main.ts'], env);
  await proc.waitForHttpOrExit(`http://127.0.0.1:${config.ports.api}/healthz`, { timeoutMs: 180000 }, api);
  const web = start('web', 'apps/web', ['dev', '--hostname', '127.0.0.1', '--port', String(config.ports.web)], cfg.webEnv(config), true);
  await proc.waitForHttpOrExit(`http://127.0.0.1:${config.ports.web}/login`, { timeoutMs: 180000 }, web);
  console.log(`Acceptance ready (${modelConfigPath ? 'real configured provider' : 'model unconfigured'}): http://127.0.0.1:${config.ports.web}`);
  await new Promise(() => {});
} catch (error) {
  console.error('Acceptance stack failed:', error instanceof Error ? error.message : String(error));
  await close(1);
}

