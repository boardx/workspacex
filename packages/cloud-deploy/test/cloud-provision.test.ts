import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deploymentExample } from "../src/examples";
import { productionPreflightAddHost, provisionCloud } from "../src/cloud-provision";
import { captureProvisionCommand, CommandExecutionError } from "../src/command";
import { writeRuntimeBundle } from "../src/runtime-bundle";
import { verifyRunningRelease } from "../src/running-release";
import { verifyPreparedHost } from "../src/verify-prepared-host";
import { verifyEcsIdentity } from "../src/preflight";
import { verifyTlsPreflight } from "../src/tls-preflight";
import { assertTrustedPath } from "../src/trusted-path";
vi.mock("../src/command", async original => ({ ...await original<typeof import("../src/command")>(), captureProvisionCommand: vi.fn() }));
vi.mock("../src/preflight", () => ({ verifyEcsIdentity: vi.fn(), verifyHttpsEndpoint: vi.fn(), requireComposeVersion: vi.fn() }));
vi.mock("../src/tls-preflight", () => ({ verifyTlsPreflight: vi.fn() }));
vi.mock("../src/verify-prepared-host", () => ({ verifyPreparedHost: vi.fn() }));
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
vi.mock("../src/running-release", () => ({ verifyRunningRelease: vi.fn() }));
vi.mock("../src/runtime-bundle", async original => ({ ...await original<typeof import("../src/runtime-bundle")>(), writeRuntimeBundle: vi.fn() }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, chown: vi.fn(), lstat: vi.fn(async (path: string) => {
    if (path.endsWith("docker-seccomp.json")) return { isFile: (): boolean => true, isSymbolicLink: (): boolean => false };
    if (path.startsWith("/var/lib/workspacex/")) return { isDirectory: (): boolean => true, isSymbolicLink: (): boolean => false };
    return fs.lstat(path);
  }), readFile: vi.fn((path: string, ...args: unknown[]) => path === "/sys/kernel/security/apparmor/profiles"
    ? Promise.resolve("workspacex-native-sessions (enforce)\n") : (fs.readFile as Function)(path, ...args)) };
});
const uidDescriptor = Object.getOwnPropertyDescriptor(process, "getuid");
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const roots: string[] = []; let failedScript = ""; let cleanupUnknown = false; let remoteExitCode: number | undefined;
beforeEach(() => {
  vi.stubEnv("WORKSPACEX_BACKUP_TARGET", JSON.stringify({ backend: "oss", region: "cn-hangzhou", bucket: "backups-example", endpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com", prefix: "backups/example", authMode: "ecs-role", roleName: "workspacex-runtime" }));
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  Object.defineProperty(process, "getuid", { value: () => 0, configurable: true }); failedScript = ""; cleanupUnknown = false; remoteExitCode = undefined;
  vi.mocked(writeRuntimeBundle).mockResolvedValue({ api: { APP_DB_PASSWORD: "private-value" }, agent: { MEMORY_STORE_DATABASE_URL: "postgresql://memory/fixture", MEMORY_STORE_SCHEMA: "workspacex_memory" }, memoryMigration: {}, migration: {}, bootstrap: {}, web: {}, dependencies: {} });
  vi.mocked(captureProvisionCommand).mockImplementation(async command => {
    const args = command.args;
    if (command.executable === "git") return args.includes("rev-parse") ? "a".repeat(40) : "";
    if (args[0] === "info") return "linux/x86_64";
    if (args[0] === "image") return JSON.stringify([{ Os: "linux", Architecture: "amd64", RepoDigests: [args.at(-1)], Config: { Labels: { "org.opencontainers.image.revision": "a".repeat(40) } } }]);
    if (args[0] === "network") return '"example"';
    if (args[0] === "ps") { if (cleanupUnknown) throw new Error("daemon unavailable"); return ""; }
    if (args.at(-1) === "redis") return "999";
    if (args.at(-1) === "scripts/cloud-business-probe.ts" && remoteExitCode !== undefined) throw new CommandExecutionError(remoteExitCode);
    if (args.at(-1) === failedScript) throw new Error("private failure details");
    if (args.at(-1) === "scripts/provision-admin.ts") return JSON.stringify({ ok: true, userId: "user", orgId: "org", defaultAgentId: "agent" });
    if (args.at(-1) === "scripts/backup-target-readiness.ts") return '{"backupTargetVerified":true}';
    if (args.at(-1) === "scripts/verify-oss-storage.ts") return '{"ossVerified":true}';
    if (args.at(-1) === "scripts/cloud-business-probe.ts") return JSON.stringify({ ok: true, loginVerified: true, file: { fileRoundtripVerified: true }, agent: { agentBusinessVerified: true }, components: { model: true, sandbox: true } });
    return "";
  });
});
afterEach(async () => {
  Object.defineProperty(process, "platform", platform);
  if (uidDescriptor) Object.defineProperty(process, "getuid", uidDescriptor);
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function execute() {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "cloud-runner-")); roots.push(runtimeDirectory);
  const image = { image: `registry.example/team/app@sha256:${"b".repeat(64)}` };
  return provisionCloud(deploymentExample("starter"), { schemaVersion: 1, release: "1.0.0", sourceRevision: "a".repeat(40), platform: "linux/amd64", images: { web: image, api: image, agent: image, sandbox: image, postgres: image, redis: image } },
    { projectName: "example", runtimeDirectory, agentEnvironmentSecretRef: "env:AGENT_SERVER" });
}
it("wires real command stages without build/pull or credential argv; this is a mocked orchestration test", async () => {
  expect((await execute()).status).toBe("passed");
  const calls = vi.mocked(captureProvisionCommand).mock.calls.map(([command]) => command.args);
  const jobs = calls.filter(args => args[0] === "run" && args.includes("--env-file")).map(args => args.at(-1));
  expect(jobs).toEqual(["scripts/prepare-starter-roles.ts", "src/infrastructure/db/migrate-cli.ts", "prepare", "scripts/provision-admin.ts", "scripts/data-readiness.ts", "readiness", "scripts/cloud-service-readiness.ts", "scripts/backup-target-readiness.ts", "scripts/verify-oss-storage.ts", "scripts/cloud-business-probe.ts"]);
  expect(JSON.stringify(calls)).not.toContain("private-value");
  expect(calls.every(args => !args.includes("build") && !args.includes("pull"))).toBe(true);
  expect(verifyRunningRelease).toHaveBeenCalledOnce();
});
it("keeps the public hostname when routing production business probes to the ECS IP", () => {
  const config = deploymentExample("production");
  config.environment.publicUrl = "https://www.boardx.com.cn";
  config.environment.preflightTargetIp = "47.100.1.2";
  expect(productionPreflightAddHost(config.environment)).toBe("www.boardx.com.cn:47.100.1.2");
  expect(productionPreflightAddHost(deploymentExample("starter").environment)).toBeUndefined();
});
it("does not start application services when migration fails", async () => {
  failedScript = "src/infrastructure/db/migrate-cli.ts";
  const result = await execute(); expect(result.status).toBe("failed");
  expect(result.stages.at(-1)?.name).toBe("migrate");
  expect(verifyRunningRelease).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("private failure details");
});
it("keeps an explicit block when Docker cannot prove task-container cleanup", async () => {
  cleanupUnknown = true;
  // The retry helper must not swallow uncertain remote state and wait 300 seconds.
  const result = await execute();
  expect(result.status).toBe("failed"); expect(result.lockRetained).toBe(true);
});

it("does not confuse removal of the probe container with cancellation of its API Agent run", async () => {
  remoteExitCode = 79;
  const result = await execute();
  expect(result.status).toBe("failed"); expect(result.lockRetained).toBe(true);
  expect(result.stages.at(-1)?.name).toBe("business-probe");
});

it("retains the lock when the business helper is killed before it can prove remote cleanup", async () => {
  remoteExitCode = 137;
  const result = await execute();
  expect(result.status).toBe("failed"); expect(result.lockRetained).toBe(true);
  expect(result.stages.at(-1)?.name).toBe("business-probe");
});

it("checks prepared-host integrity before ECS identity and live TLS", async () => {
  await execute();
  expect(vi.mocked(verifyPreparedHost).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(verifyEcsIdentity).mock.invocationCallOrder[0]!);
  expect(vi.mocked(verifyEcsIdentity).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(verifyTlsPreflight).mock.invocationCallOrder[0]!);
});

it("stops before cloud and runtime actions when prepared-host integrity fails", async () => {
  vi.mocked(verifyPreparedHost).mockRejectedValueOnce(new Error("HOST_PREPARATION_INTEGRITY_FAILED"));
  const result = await execute();
  expect(result.status).toBe("failed"); expect(result.stages).toHaveLength(1); expect(result.stages[0]?.name).toBe("preflight");
  expect(verifyEcsIdentity).not.toHaveBeenCalled(); expect(verifyTlsPreflight).not.toHaveBeenCalled(); expect(writeRuntimeBundle).not.toHaveBeenCalled();
});

it("stops before host integrity and cloud checks when the driver SHA differs", async () => {
  const normal = vi.mocked(captureProvisionCommand).getMockImplementation()!;
  vi.mocked(captureProvisionCommand).mockImplementation(async (command, context) =>
    command.executable === "git" && command.args.includes("rev-parse") ? "f".repeat(40) : normal(command, context));
  expect((await execute()).status).toBe("failed");
  expect(verifyPreparedHost).not.toHaveBeenCalled(); expect(verifyEcsIdentity).not.toHaveBeenCalled();
});

it("does not create a provision lock in an untrusted runtime path", async () => {
  vi.mocked(assertTrustedPath).mockRejectedValueOnce(new Error("UNTRUSTED_HOST_PATH"));
  await expect(execute()).rejects.toThrow("UNTRUSTED_HOST_PATH");
  expect(captureProvisionCommand).not.toHaveBeenCalled();
});
