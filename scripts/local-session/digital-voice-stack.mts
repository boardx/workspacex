/**
 * Disposable real DB/API/Web stack for digital-voice-session.mjs. Run from repo root:
 * VOICE_TRIAL_DATA_DIR=<fresh-dir> node --import tsx scripts/local-session/digital-voice-stack.mts
 * The realtime supplier is an explicit loopback test simulator; no cloud model is used.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveLocalConfig, paths, DB_OWNER_ROLE, DB_APP_ROLE, apiEnv, webEnv,
} from "../../packages/local-runtime/src/config.ts";
import {
  ensureDatabaseExists, startPgliteServer, type PgliteHandle,
} from "../../packages/local-runtime/src/pglite-server.ts";
import { runMigrations, runOwnerSeeds } from "../../packages/local-runtime/src/seeds.ts";
import { tsxLaunch, nextLaunch } from "../../packages/local-runtime/src/node-launch.ts";
import { startManaged, waitForHttpOrExit, type Managed } from "../../packages/local-runtime/src/processes.ts";
import { handleOmniRealtimeConnection } from "../../apps/api/scripts/loopback-omni-realtime.ts";

const repoRoot = process.cwd();
const { WebSocketServer } = createRequire(join(repoRoot, "apps/api/package.json"))("ws") as typeof import("ws");
const omni = new WebSocketServer({ port: 14328, host: "127.0.0.1" });
omni.on("connection", handleOmniRealtimeConnection);
const config = resolveLocalConfig({
  repoRoot,
  dataDir: process.env.VOICE_TRIAL_DATA_DIR ?? "/private/tmp/wsx-digital-voice-data",
  ports: { api: 14320, web: 14310, postgres: 14325, sandbox: 14326, deepAgent: 14324, asr: 14327, ollama: 12434 },
});
for (const dir of [paths.objects(config), paths.logs(config)]) mkdirSync(dir, { recursive: true });
let db: PgliteHandle | null = null;
const children: Managed[] = [];
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) await child.stop();
  await db?.stop();
  await new Promise<void>((resolve) => omni.close(() => resolve()));
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => { void stop().then(() => process.exit(0)); });
}
try {
  await ensureDatabaseExists(paths.pgData(config));
  db = await startPgliteServer({ dataDir: paths.pgData(config), port: config.ports.postgres, username: DB_OWNER_ROLE });
  await runMigrations(config, console.log);
  await runOwnerSeeds(config, console.log);
  await db.stop();
  db = await startPgliteServer({ dataDir: paths.pgData(config), port: config.ports.postgres, username: DB_APP_ROLE });
  const launch = tsxLaunch(repoRoot, ["src/main.ts"]);
  const api = startManaged({
    name: "api", command: launch.command, args: launch.args,
    cwd: join(repoRoot, "apps/api"), logDir: paths.logs(config),
    env: {
      ...apiEnv(config), ...launch.env, WORKSPACEX_EDITION: "cloud",
      KERNEL_OMNI_REALTIME_BASE_URL: "ws://127.0.0.1:14328",
      KERNEL_OMNI_REALTIME_API_KEY: "local-test-only",
    },
  });
  children.push(api);
  await waitForHttpOrExit(`http://127.0.0.1:${config.ports.api}/healthz`, { timeoutMs: 180_000 }, api);
  const next = nextLaunch(repoRoot, ["dev", "-p", String(config.ports.web), "-H", "127.0.0.1"]);
  const web = startManaged({
    name: "web", command: next.command, args: next.args,
    cwd: join(repoRoot, "apps/web"), logDir: paths.logs(config),
    env: { ...webEnv(config), ...next.env, NEXT_PUBLIC_WORKSPACEX_EDITION: "cloud" },
  });
  children.push(web);
  await waitForHttpOrExit(`http://127.0.0.1:${config.ports.web}`, { timeoutMs: 300_000 }, web);
  console.log(`LOCAL_TRIAL_READY http://127.0.0.1:${config.ports.web}`);
} catch (error) {
  await stop();
  throw error;
}
