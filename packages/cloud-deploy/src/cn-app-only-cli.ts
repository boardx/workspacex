/** Called only by the installed root dispatcher under its existing release lock.
 * All inputs/tool dependencies are staged beforehand. No Git/network/install path.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { assertTrustedPath } from "./trusted-path";
import { captureProvisionCommand } from "./command";
import { deploymentConfigSchema } from "./config";
import { verifyEcsIdentity } from "./preflight";
import { appOnlyInputSchema, appOnlyOperation, type AppOnlyMode, appContainerImage, baselineSchema, switchAppOnly, appServices, type AppContext } from "./cn-app-only";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` :
  v !== null && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}` : JSON.stringify(v) ?? "null";
async function bytes(path: string, privateFile = true) {
  await assertTrustedPath(path, { trustedRoot: "/", kind: "file", private: privateFile });
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) throw new Error("APP_ONLY_INPUT_FILE");
    const raw = Buffer.alloc(65537); const { bytesRead } = await file.read(raw, 0, raw.length, 0);
    if (bytesRead !== stat.size) throw new Error("APP_ONLY_INPUT_CHANGED");
    return raw.subarray(0, bytesRead);
  } finally { await file.close(); }
}
async function main() {
  const [mode, revision, attempt] = process.argv.slice(2);
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.argv.length !== 5 ||
    !["activate", "rollback", "commit", "verify", "check"].includes(mode!) || !/^[a-f0-9]{40}$/.test(revision!) || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(attempt!)) throw new Error("APP_ONLY_USAGE");
  const dir = `/var/lib/workspacex-cn/runtime/${revision}`;
  await assertTrustedPath(dir, { trustedRoot: "/", kind: "directory", private: true });
  await assertTrustedPath(process.cwd(), { trustedRoot: "/", kind: "directory" });
  const rawRequest = await bytes(`/etc/workspacex-cn/preparations/${revision}.app-only.${attempt}.json`);
  const request = appOnlyInputSchema.parse(JSON.parse(rawRequest.toString()));
  if (request.sourceRevision !== revision || request.attemptId !== attempt) throw new Error("APP_ONLY_REQUEST_IDENTITY");
  const baselineBytes = await bytes(join(dir, "baseline.json")), nginxBytes = await bytes(join(dir, "baseline-nginx.conf"));
  const baseline = baselineSchema.parse(JSON.parse(baselineBytes.toString()));
  const baselineDir = dirname(baseline.composeFile);
  await bytes(baseline.composeFile);
  await bytes(join(baselineDir, "bootstrap.env"));
  const preparedBytes = await bytes(join(dir, "fast-safe-release.json"));
  const prepared = JSON.parse(preparedBytes.toString());
  const manifest = await bytes(`/etc/workspacex-cn/releases/${revision}.json`, false);
  const seal = JSON.parse((await bytes(`/etc/workspacex-cn/releases/${revision}.sealed.json`, false)).toString());
  if (seal.schemaVersion !== 1 || seal.status !== "sealed" || seal.sourceRevision !== revision || seal.manifestSha256 !== sha(manifest)) throw new Error("APP_ONLY_SEAL");
  const cancelled = new AbortController();
  process.once("SIGTERM", () => cancelled.abort()); process.once("SIGINT", () => cancelled.abort());
  const execute = (argv: readonly string[], context: AppContext) => captureProvisionCommand({ executable: argv[0]!, args: argv.slice(1), cwd: process.cwd(),
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/root", LC_ALL: "C", COREPACK_ENABLE_NETWORK: "0" } }, context);
  const write = async (path: string, value: unknown) => {
    await assertTrustedPath(dirname(path), { trustedRoot: "/", kind: "directory", private: true });
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value) + "\n"); await file.sync(); } finally { await file.close(); }
    const parent = await open(dirname(path), "r"); try { await parent.sync(); } finally { await parent.close(); }
  };
  const marker = "/var/lib/workspacex-cn/runtime/app-only-inflight.json";
  const state = join(dir, `app-only-${attempt}.json`);
  const syncParent = async (path: string) => { const file = await open(dirname(path), "r"); try { await file.sync(); } finally { await file.close(); } };
  const replace = async (path: string, value: unknown) => {
    const temporary = `${path}.${randomUUID()}.tmp`; await write(temporary, value); await rename(temporary, path); await syncParent(path);
  };
  const optionalState = async (path: string): Promise<unknown> => {
    // Test existence before bytes(): trusted-path deliberately masks filesystem
    // errors, so a missing optional record must be distinguished here only.
    try { await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    return JSON.parse((await bytes(path)).toString());
  };
  const intent = await optionalState(marker);
  const operation = appOnlyOperation(mode as AppOnlyMode, intent, intent === undefined ? await optionalState(state) : undefined,
    { sourceRevision: revision!, attemptId: attempt!, requestSha256: sha(rawRequest), preparedSha256: sha(preparedBytes), manifestSha256: sha(manifest) });
  const configuration = async (context: AppContext) => {
    const nginxBytes = await bytes("/etc/nginx/conf.d/workspacex-cn.conf");
    const config = JSON.parse(await execute(["docker", "compose", "--project-name", "workspacex-cn", "--file", baseline.composeFile, "config", "--format", "json"], context));
    if (config.services?.api?.environment?.KERNEL_PLATFORM_SKILL_SELFHEAL !== "off") throw new Error("APP_ONLY_STARTUP_SEED_NOT_DISABLED");
    for (const service of appServices) if (!config.services?.[service]) throw new Error("APP_ONLY_CONFIG_SERVICE");
    delete config.services.api.image; delete config.services.web.image;
    return { nginxBytes, runtimeConfigSha256: sha(canonical(config)) };
  };
  try {
    const result = await switchAppOnly(rawRequest, prepared, manifest, baselineBytes, nginxBytes, {
      signal: cancelled.signal,
      verifyHost: async context => {
        const config = deploymentConfigSchema.parse(JSON.parse((await bytes(`/etc/workspacex-cn/candidate-configs/${revision}/${attempt}/deployment.json`)).toString()));
        if (config.environment.ecsInstanceId !== "i-uf6ga92ewloganobbln6" || config.environment.regionId !== "cn-shanghai" ||
          config.environment.publicUrl !== "https://app.boardx.com.cn") throw new Error("APP_ONLY_TARGET");
        await verifyEcsIdentity(config, context);
      },
      execute,
      snapshot: async context => {
        const images: Record<string, string> = {};
        for (const service of appServices) {
          const value = JSON.parse(await execute(["docker", "container", "inspect", "--format",
            '[{{json .Image}},{{json .State.Running}},{{json (index .Config.Labels "com.docker.compose.project")}},{{json (index .Config.Labels "com.docker.compose.service")}},{{json .State.Restarting}},{{json .State.OOMKilled}},{{json (index .Config.Labels "com.docker.compose.project.config_files")}}]', `workspacex-cn-${service}-1`], context));
          images[service] = appContainerImage(value, service, baseline.composeFile);
        }
        if (images["sandbox-sessions"] !== images.sandbox) throw new Error("APP_ONLY_SESSIONS_IMAGE");
        const { nginxBytes, runtimeConfigSha256 } = await configuration(context);
        const { "sandbox-sessions": _sessions, ...four } = images;
        return { baselineBytes: Buffer.from(JSON.stringify({ schemaVersion: 1, composeFile: baseline.composeFile, images: four, nginxSha256: sha(nginxBytes) }) + "\n"),
          nginxBytes, runtimeConfigSha256 };
      },
      configuration,
      writeImages: async images => {
        if (Object.keys(images).sort().join(",") !== "api,web") throw new Error("APP_ONLY_IMAGE_SCOPE");
        const original = await bytes(baseline.composeFile);
        const config = JSON.parse(original.toString());
        if (!config.services?.api || !config.services?.web) throw new Error("APP_ONLY_CONFIG_SERVICE");
        config.services.api.image = images.api; config.services.web.image = images.web;
        if (Buffer.byteLength(JSON.stringify(config) + "\n") > 65536) throw new Error("APP_ONLY_COMPOSE_BOUND");
        const temporary = `${baseline.composeFile}.${randomUUID()}.tmp`;
        await write(temporary, config);
        if (sha(await bytes(baseline.composeFile)) !== sha(original)) throw new Error("APP_ONLY_COMPOSE_CAS");
        await rename(temporary, baseline.composeFile);
        const parent = await open(baselineDir, "r"); try { await parent.sync(); } finally { await parent.close(); }
      },
      smoke: async context => {
        // Reuse the existing public browser smoke and pre-existing account only.
        const config = JSON.parse((await bytes(`/etc/workspacex-cn/candidate-configs/${revision}/${attempt}/deployment.json`)).toString());
        if (config.environment?.publicUrl !== "https://app.boardx.com.cn") throw new Error("APP_ONLY_PUBLIC_ORIGIN");
        const browser = "/usr/bin/chromium";
        await captureProvisionCommand({ executable: "/usr/bin/node", args: [".harness/scripts/vm/cn-release-browser-smoke.mjs", config.environment.publicUrl, join(baselineDir, "bootstrap.env")],
          cwd: process.cwd(), env: { PATH: "/usr/bin:/bin", CN_BROWSER_EXECUTABLE_PATH: browser } }, context);
      },
      record: async status => {
        const value = { sourceRevision: revision, attemptId: attempt, requestSha256: sha(rawRequest), preparedSha256: sha(preparedBytes), manifestSha256: sha(manifest), status, observedAt: new Date().toISOString(), fullBusinessAcceptance: false };
        if (status === "switching") await write(marker, value);
        await replace(state, value);
        if (status === "rolled-back") { await unlink(marker); await syncParent(marker); }
      },
    }, operation);
    if (mode === "commit") {
      const value = { sourceRevision: revision, attemptId: attempt, requestSha256: sha(rawRequest), preparedSha256: sha(preparedBytes), manifestSha256: sha(manifest), status: "committed", observedAt: new Date().toISOString(), fullBusinessAcceptance: false };
      await replace(state, value);
      try { await unlink(marker); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await syncParent(marker);
    }
    // The same Compose path remains authoritative. No env/mount/DB edits,
    // temporary container cleanup or orphan deletion occurs here.
    console.log(JSON.stringify(result));
  } catch { throw new Error("APP_ONLY_REJECTED_OR_FAILED"); }
}
main().catch(() => { console.error("CN_APP_ONLY_REJECTED_OR_UNKNOWN"); process.exitCode = 1; });
