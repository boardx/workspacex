import { constants } from "node:fs";
import { mkdir, open, lstat, rename, unlink, chown } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DeploymentConfig } from "./config";
import type { ReleaseManifest } from "./release";
import { createCloudCompose, type CloudComposeOptions } from "./compose";
import { runtimeEnvironment, serializeRuntimeEnvironment } from "./runtime-environment";
import { resolveSecret } from "./secrets";
import { validateAgentServerEnvironment } from "./agent-release";

type Context = { signal: AbortSignal; remainingMs: () => number };
export const agentPersistenceSchema = z.object({ DATABASE_URI: z.string().min(1), REDIS_URI: z.string().min(1), LANGGRAPH_CLOUD_LICENSE_KEY: z.string().min(1) }).strict();
const productionAgentSecretSchema = agentPersistenceSchema.extend({ databaseCaFile: z.string().startsWith("/"), memoryCaFile: z.string().startsWith("/"),
  MEMORY_STORE_DATABASE_URL: z.string().min(1), MEMORY_STORE_MIGRATION_DATABASE_URL: z.string().min(1) }).strict();
export function checkBudget(context: Context) {
  if (context.signal.aborted || context.remainingMs() <= 0) throw new Error("PROVISION_CANCELLED");
}
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("UNSAFE_RUNTIME_DIRECTORY");
}
/** Atomic replacement in a private directory; never follows an existing file symlink. */
export async function writeRuntimeFile(path: string, value: string, context: Context, mode = 0o600) {
  checkBudget(context);
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", mode);
  try {
    await file.writeFile(value); await file.sync(); checkBudget(context);
    await rename(temp, path);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close(); await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
async function certificateFile(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 65536) throw new Error("INVALID_CA_FILE");
    const buffer = Buffer.alloc(65537); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error("INVALID_CA_FILE");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await file.close(); }
}

export async function writeRuntimeBundle(config: DeploymentConfig, manifest: ReleaseManifest,
  options: CloudComposeOptions & { agentEnvironmentSecretRef: string }, context: Context, source = process.env) {
  checkBudget(context);
  const dir = options.runtimeDirectory;
  await privateDirectory(dir);
  const environment = await runtimeEnvironment(config, join(dir, "secrets"), source, context);
  checkBudget(context);
  let persistence: z.infer<typeof agentPersistenceSchema>;
  let agentCaFile: string | undefined;
  let memoryCaFile: string | undefined;
  try {
    const input = JSON.parse(await resolveSecret(options.agentEnvironmentSecretRef, source, context));
    if (config.environment.profile === "starter") {
      persistence = agentPersistenceSchema.parse({ ...z.object({ LANGGRAPH_CLOUD_LICENSE_KEY: z.string().min(1) }).strict().parse(input), DATABASE_URI: environment.agent.DATABASE_URI, REDIS_URI: environment.agent.REDIS_URI });
    } else {
      const { databaseCaFile, memoryCaFile: memoryCa, MEMORY_STORE_DATABASE_URL: memoryUri, MEMORY_STORE_MIGRATION_DATABASE_URL: migrationUri, ...values } = productionAgentSecretSchema.parse(input);
      agentCaFile = databaseCaFile; memoryCaFile = memoryCa; persistence = values;
      const memory = new URL(memoryUri), owner = new URL(migrationUri), graph = new URL(values.DATABASE_URI);
      for (const url of [memory, owner]) {
        if (!/^postgres(?:ql)?:$/.test(url.protocol) || url.searchParams.get("sslmode") !== "verify-full" ||
          ["sslrootcert", "sslcert", "sslkey"].some(key => url.searchParams.has(key)) || !url.password) throw new Error();
      }
      if (decodeURIComponent(memory.username) !== "memory_rw" || decodeURIComponent(owner.username) !== "memory_owner" ||
        memory.hostname !== owner.hostname || (memory.port || "5432") !== (owner.port || "5432") || memory.pathname !== owner.pathname) throw new Error();
      if ((memory.hostname === environment.api.PGHOST && decodeURIComponent(memory.pathname.slice(1)) === environment.api.PGDATABASE) ||
        (memory.hostname === graph.hostname && memory.pathname === graph.pathname)) throw new Error();
      for (const url of [memory, owner]) url.searchParams.set("sslrootcert", "/run/agent-certs/memory-ca.pem");
      environment.agent.MEMORY_STORE_DATABASE_URL = memory.href;
      environment.agent.MEMORY_STORE_SCHEMA = "workspacex_memory";
      Object.assign(environment.memoryMigration, { MEMORY_STORE_DATABASE_URL: memory.href, MEMORY_STORE_MIGRATION_DATABASE_URL: owner.href, MEMORY_STORE_SCHEMA: environment.agent.MEMORY_STORE_SCHEMA });
    }
    validateAgentServerEnvironment(persistence);
    const database = new URL(persistence.DATABASE_URI);
    if (["sslrootcert", "sslcert", "sslkey"].some(key => database.searchParams.has(key))) throw new Error();
    // The graph server owns its schema. It must never run as the restricted app role
    // or place its system tables in the application's database.
    if (decodeURIComponent(database.username) === environment.api.APP_DB_USER ||
      (database.hostname === environment.api.PGHOST && decodeURIComponent(database.pathname.slice(1)) === environment.api.PGDATABASE)) throw new Error();
    if (config.environment.profile === "production" && (database.searchParams.get("sslmode") !== "verify-full" || !persistence.REDIS_URI.startsWith("rediss://"))) throw new Error();
  } catch { throw new Error("AGENT_PERSISTENCE_CONFIGURATION_INVALID"); }
  Object.assign(environment.agent, persistence);
  const agentCerts = join(dir, "agent-certs");
  await mkdir(agentCerts, { recursive: true, mode: 0o755 });
  const agentCertStat = await lstat(agentCerts);
  if (!agentCertStat.isDirectory() || agentCertStat.isSymbolicLink()) throw new Error("UNSAFE_AGENT_CERT_DIRECTORY");
  if (memoryCaFile) await writeRuntimeFile(join(agentCerts, "memory-ca.pem"), await certificateFile(memoryCaFile), context, 0o644);
  if (agentCaFile) {
    await writeRuntimeFile(join(agentCerts, "ca.pem"), await certificateFile(agentCaFile), context, 0o644);
    const database = new URL(environment.agent.DATABASE_URI!);
    database.searchParams.set("sslrootcert", "/run/agent-certs/ca.pem");
    environment.agent.DATABASE_URI = database.href;
    environment.agent.PGSSLROOTCERT = "/run/agent-certs/ca.pem";
  }
  const certs = join(dir, "certs"); await mkdir(certs, { recursive: true, mode: 0o755 });
  const certStat = await lstat(certs); if (!certStat.isDirectory() || certStat.isSymbolicLink()) throw new Error("UNSAFE_CERT_DIRECTORY");
  const ca = environment.api.PGSSLROOTCERT;
  if (ca) {
    const contents = await certificateFile(ca);
    await writeRuntimeFile(join(certs, "ca.pem"), contents, context, 0o644);
    for (const map of [environment.api, environment.migration, environment.bootstrap]) map.PGSSLROOTCERT = "/run/certs/ca.pem";
  }
  for (const name of ["sandbox", "sessions"]) {
    checkBudget(context); const path = join(dir, name); await privateDirectory(path); await chown(path, 1000, 1000);
  }
  for (const service of ["api", "agent", "web", "migration", "bootstrap", "memoryMigration"] as const) {
    await writeRuntimeFile(join(dir, `${service}.env`), serializeRuntimeEnvironment(environment[service]), context);
  }
  if (config.environment.profile === "starter") {
    const { REDIS_PASSWORD, ...postgres } = environment.dependencies;
    await writeRuntimeFile(join(dir, "postgres.env"), serializeRuntimeEnvironment(postgres), context);
    // Generated hexadecimal password cannot inject Redis directives. Redis starts root
    // and changes to its prepared uid; its config file ownership is set by prepare.
    if (!/^[a-f0-9]{64}$/.test(REDIS_PASSWORD ?? "")) throw new Error("INVALID_REDIS_PASSWORD");
    await writeRuntimeFile(join(dir, "redis.conf"), `bind 0.0.0.0\nprotected-mode yes\nappendonly yes\nrequirepass ${REDIS_PASSWORD}\n`, context);
  }
  const compose = { ...createCloudCompose(config, manifest, { projectName: options.projectName, runtimeDirectory: dir }),
    networks: { default: { external: true, name: `${options.projectName}-runtime` } } };
  await writeRuntimeFile(join(dir, "compose.json"), JSON.stringify(compose), context);
  checkBudget(context);
  return environment;
}
