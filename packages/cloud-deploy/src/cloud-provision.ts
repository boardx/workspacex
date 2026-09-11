import { randomUUID } from "node:crypto";
import { lstat, readFile, chown, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deploymentConfigSchema } from "./config";
import { validateReleaseManifest, verifyPrewarmedRelease } from "./release";
import { verifyRunningRelease } from "./running-release";
import { provision, UncertainProvisionStateError, type ProvisionAction } from "./provision";
import { captureProvisionCommand, CommandExecutionError } from "./command";
import { verifyEcsIdentity, requireComposeVersion } from "./preflight";
import { verifyTlsPreflight } from "./tls-preflight";
import { verifyManagedDataPreflight } from "./managed-data-preflight";
import { parseBackupTarget } from "./backup-target";
import { resolveSecret } from "./secrets";
import { DatabaseSecret, RedisSecret } from "./data-secrets";
import { writeRuntimeBundle, writeRuntimeFile, checkBudget } from "./runtime-bundle";
import { serializeRuntimeEnvironment, type RuntimeEnvironmentMaps } from "./runtime-environment";

type Context = Parameters<ProvisionAction>[0];
export const cloudProvisionOptionsSchema = z.object({
  projectName: z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/),
  runtimeDirectory: z.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/),
  agentEnvironmentSecretRef: z.string().regex(/^(?:env:[A-Z][A-Z0-9_]*|file:\/[^\r\n\0]+)$/),
}).strict();
export type CloudProvisionOptions = z.infer<typeof cloudProvisionOptionsSchema>;

/** Execute on the prepared ECS itself, as root. No image builds/pulls, cloud resource
 * creation, certificate issuance, or global Docker cleanup occur in this timed path.
 */
export async function provisionCloud(configInput: unknown, releaseInput: unknown, optionsInput: CloudProvisionOptions, signal?: AbortSignal) {
  const config = deploymentConfigSchema.parse(configInput);
  const manifest = validateReleaseManifest(releaseInput);
  const options = cloudProvisionOptionsSchema.parse(optionsInput);
  if (config.provision.release !== manifest.release) throw new Error("RELEASE_VERSION_MISMATCH");
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("PREPARED_ECS_ROOT_REQUIRED");
  const dir = options.runtimeDirectory;
  const network = `${options.projectName}-runtime`;
  const source = process.env;
  const deploymentMarker = randomUUID();
  let maps: RuntimeEnvironmentMaps | undefined;
  let backupEnvironment: Record<string, string> | undefined;
  let admin: { userId: string; orgId: string; defaultAgentId: string } | undefined;
  const run = (args: readonly string[], context: Context) => captureProvisionCommand({ executable: args[0]!, args: args.slice(1), cwd: dir, env: source }, context);
  const compose = (args: string[], context: Context) => run(["docker", "compose", "--project-name", options.projectName, "--file", join(dir, "compose.json"), ...args], context);
  const env = () => { if (!maps) throw new Error("RUNTIME_NOT_PREPARED"); return maps; };
  const retry = async (action: () => Promise<void>, context: Context) => {
    for (;;) {
      checkBudget(context);
      try { await action(); return; } catch (error) {
        if (error instanceof UncertainProvisionStateError) throw error;
        checkBudget(context);
      }
      await delay(Math.min(500, Math.max(1, context.remainingMs())), undefined, { signal: context.signal });
    }
  };
  // Every helper is an individually named container, so cancellation can stop the
  // actual job rather than merely killing its Docker client. Names never come from users.
  const job = async (script: string, environment: Record<string, string>, context: Context, runtime: "api" | "agent" = "api") => {
    const name = `wsx-provision-${randomUUID()}`;
    const file = join(dir, `${name}.env`);
    await writeRuntimeFile(file, serializeRuntimeEnvironment({ ...environment, PROVISION_TIMEOUT_MS: String(Math.max(1, Math.floor(context.remainingMs()))) }), context);
    const args = ["docker", "run", "--rm", "--pull=never", "--name", name, "--network", network, "--env-file", file,
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2",
      "--mount", `type=bind,src=${dir}/certs,dst=/run/certs,readonly`,
      "--mount", `type=bind,src=${dir}/agent-certs,dst=/run/agent-certs,readonly`,
      "--mount", `type=bind,src=${dir}/sandbox,dst=/run/sandbox`,
      "--mount", `type=bind,src=${dir}/sessions,dst=/run/sessions`,
      "--entrypoint", runtime === "api" ? "node" : "python", manifest.images[runtime].image,
      ...(runtime === "api" ? ["--import", "tsx", script] : ["-m", "deep_agent_service.memory_deployment", script])];
    try { return await run(args, context); }
    finally {
      const cleanupContext = context.signal.aborted
        ? { signal: AbortSignal.timeout(5000), remainingMs: () => 5000 } : context;
      try {
        const ids = (await run(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${name}$`], cleanupContext)).trim();
        if (ids) await run(["docker", "rm", "--force", name], cleanupContext);
      } catch { throw new UncertainProvisionStateError("PROVISION_JOB_CLEANUP_UNPROVEN"); }
      finally {
        try { await unlink(file); } catch { throw new UncertainProvisionStateError("PROVISION_JOB_SECRET_CLEANUP_UNPROVEN"); }
      }
      // Cancellation or unproven cleanup retains the core lock for explicit inspection.
    }
  };
  return provision({ stateDirectory: dir, signal, actions: {
    preflight: async context => {
      const driverRoot = fileURLToPath(new URL("../../../", import.meta.url));
      const driverRevision = (await run(["git", "-C", driverRoot, "rev-parse", "HEAD"], context)).trim();
      const changed = (await run(["git", "-C", driverRoot, "status", "--porcelain", "--untracked-files=no"], context)).trim();
      if (driverRevision !== manifest.sourceRevision || changed) throw new Error("PROVISION_DRIVER_REVISION_MISMATCH");
      await verifyEcsIdentity(config, context);
      const architecture = (await run(["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"], context)).trim().replace("aarch64", "arm64").replace("x86_64", "amd64");
      if (architecture !== manifest.platform) throw new Error("TARGET_PLATFORM_MISMATCH");
      requireComposeVersion(await run(["docker", "compose", "version", "--short"], context));
      await verifyPrewarmedRelease(manifest, config.environment.profile, args => run(args, context));
      await verifyTlsPreflight(config.environment, context, source);
      // Security profiles and local directories are prepared before this clock starts.
      const seccomp = await lstat(join(dir, "docker-seccomp.json"));
      if (!seccomp.isFile() || seccomp.isSymbolicLink()) throw new Error("SECCOMP_NOT_PREPARED");
      const profiles = await readFile("/sys/kernel/security/apparmor/profiles", "utf8");
      if (!profiles.split("\n").includes("workspacex-native-sessions (enforce)")) throw new Error("APPARMOR_NOT_PREPARED");
      if (config.environment.profile === "production") {
        const environment = config.environment;
        const db = DatabaseSecret.parse(JSON.parse(await resolveSecret(environment.databaseSecretRef, source, context)));
        const redis = RedisSecret.parse(JSON.parse(await resolveSecret(environment.redisSecretRef, source, context)));
        const result = await verifyManagedDataPreflight({ region: environment.regionId, rdsInstanceId: environment.rdsInstanceId,
          redisInstanceId: environment.redisInstanceId, backupRetentionDays: environment.backupRetentionDays, postgresHost: db.host, redisHost: redis.host },
          args => run(["aliyun", ...args], context), { signal: context.signal, timeoutMs: Math.max(1, Math.floor(context.remainingMs())) });
        if (!result.passed) throw new Error("MANAGED_DATA_NOT_PREPARED");
      } else {
        for (const name of ["postgres", "redis"]) {
          const stat = await lstat(join(config.environment.dataVolumePath, name));
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("DATA_VOLUME_NOT_PREPARED");
        }
      }
    },
    secrets: async context => {
      maps = await writeRuntimeBundle(config, manifest, options, context, source);
      maps.api.WORKSPACEX_DEPLOYMENT_MARKER = deploymentMarker;
      maps.web.WORKSPACEX_DEPLOYMENT_MARKER = deploymentMarker;
      await writeRuntimeFile(join(dir, "web.env"), serializeRuntimeEnvironment(maps.web), context);
      await writeRuntimeFile(join(dir, "api.env"), serializeRuntimeEnvironment(maps.api), context);
      if (config.environment.profile === "starter") {
        const raw = await resolveSecret(config.environment.backupTargetRef, source, context);
        const target = parseBackupTarget(raw);
        if (target.region !== config.environment.regionId || target.roleName !== config.environment.runtimeRole) throw new Error("BACKUP_TARGET_PROFILE_MISMATCH");
        backupEnvironment = { STARTER_BACKUP_TARGET_JSON: JSON.stringify(target) };
        await writeRuntimeFile(join(dir, "backup.env"), serializeRuntimeEnvironment(backupEnvironment), context);
        // Resolve the actual immutable Redis image's uid instead of assuming uid 999.
        const uid = (await run(["docker", "run", "--rm", "--pull=never", "--network=none", "--entrypoint", "id", manifest.images.redis.image, "-u", "redis"], context)).trim();
        if (!/^\d{1,6}$/.test(uid) || Number(uid) === 0) throw new Error("REDIS_RUNTIME_USER_INVALID");
        checkBudget(context); await chown(join(dir, "redis.conf"), Number(uid), Number(uid));
      }
    },
    dependencies: async context => {
      let exists = false;
      try {
        const owner = JSON.parse(await run(["docker", "network", "inspect", "--format", '{{json (index .Labels "workspacex.deployment")}}', network], context));
        if (owner !== options.projectName) throw new Error("NETWORK_OWNER_MISMATCH");
        exists = true;
      } catch (error) {
        if (error instanceof Error && error.message === "NETWORK_OWNER_MISMATCH") throw error;
        checkBudget(context);
      }
      if (!exists) await run(["docker", "network", "create", "--label", `workspacex.deployment=${options.projectName}`, network], context);
      if (config.environment.profile === "starter") {
        await compose(["up", "--detach", "--pull", "never", "--no-build", "postgres", "redis"], context);
        await retry(async () => { await job("scripts/prepare-starter-roles.ts", env().migration, context); }, context);
      }
    },
    migrate: async context => {
      await job("src/infrastructure/db/migrate-cli.ts", env().migration, context);
      await job("prepare", env().memoryMigration, context, "agent");
    },
    bootstrap: async context => {
      const result = z.object({ ok: z.literal(true), userId: z.string().min(1), orgId: z.string().min(1), defaultAgentId: z.string().min(1) }).parse(JSON.parse(await job("scripts/provision-admin.ts", env().bootstrap, context)));
      admin = result;
    },
    start: async context => { await compose(["up", "--detach", "--pull", "never", "--no-build"], context); },
    readiness: async context => {
      await retry(async () => { await job("scripts/data-readiness.ts", env().api, context); }, context);
      await job("readiness", { MEMORY_STORE_DATABASE_URL: env().agent.MEMORY_STORE_DATABASE_URL!, MEMORY_STORE_SCHEMA: env().agent.MEMORY_STORE_SCHEMA! }, context, "agent");
      await retry(async () => { await job("scripts/cloud-service-readiness.ts", env().api, context); }, context);
      const ids: Record<string, string> = {};
      for (const name of ["web", "api", "agent", "sandbox", "sandbox-sessions", ...(config.environment.profile === "starter" ? ["postgres", "redis"] : [])]) {
        ids[name] = (await compose(["ps", "--quiet", name], context)).trim();
      }
      await verifyRunningRelease(manifest, config.environment.profile, ids, args => run(args, context));
    },
    "business-probe": async context => {
      if (!admin) throw new Error("ADMIN_NOT_BOOTSTRAPPED");
      if (backupEnvironment) {
        const target = JSON.parse(await job("scripts/backup-target-readiness.ts", backupEnvironment, context));
        if (target.backupTargetVerified !== true) throw new Error("BACKUP_TARGET_NOT_VERIFIED");
      }
      const storage = JSON.parse(await job("scripts/verify-oss-storage.ts", { ...env().api, WORKSPACEX_OSS_SMOKE: "1" }, context));
      if (storage.ossVerified !== true) throw new Error("OSS_NOT_VERIFIED");
      try {
        const result = JSON.parse(await job("scripts/cloud-business-probe.ts", { ...env().api, ...env().bootstrap,
          PROVISION_PUBLIC_URL: config.environment.publicUrl, PROVISION_ORG_ID: admin.orgId, PROVISION_DEFAULT_AGENT_ID: admin.defaultAgentId }, context));
        if (result.ok !== true || result.loginVerified !== true || result.file?.fileRoundtripVerified !== true || result.agent?.agentBusinessVerified !== true || result.components?.model !== true || result.components?.sandbox !== true) throw new Error("BUSINESS_NOT_VERIFIED");
      } catch (error) {
        if (error instanceof CommandExecutionError && error.exitCode === 79) throw new UncertainProvisionStateError("REMOTE_AGENT_CLEANUP_UNPROVEN");
        throw error;
      }
    },
  } });
}
