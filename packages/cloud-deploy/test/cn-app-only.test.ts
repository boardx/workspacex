import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { baselineFingerprint, bindAppOnlyPreparation, switchAppOnly, type AppOnlyIO } from "../src/cn-app-only";
import { spawnSync } from "node:child_process";

const hash = (raw: string | Buffer) => createHash("sha256").update(raw).digest("hex");
const source = "a".repeat(40), old = "b".repeat(40), image = (s: string) => `sha256:${s.repeat(64)}`;
const now = new Date("2026-10-19T12:00:00.000Z");
const gate = () => ({ status: "passed", evidenceSha256: "e".repeat(64) });
function fixture() {
  const nginx = Buffer.from("unchanged ingress"), images = { api: image("1"), web: image("2"), agent: image("3"), sandbox: image("4") };
  const baseline = { schemaVersion: 1, composeFile: `/var/lib/workspacex-cn/runtime/${old}/compose.json`, images, nginxSha256: hash(nginx) };
  const baselineBytes = Buffer.from(JSON.stringify(baseline) + "\n");
  const manifest = { schemaVersion: 1, release: "1.2.3", sourceRevision: source, platform: "linux/amd64", images: Object.fromEntries(
    ["api", "web", "agent", "sandbox", "postgres", "redis"].map((s, i) => [s, { image: `registry.example/ns/${s}@${image((i + 5).toString(16))}` }])) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const request = { schemaVersion: 1, mode: "app-only", sourceRevision: source, baselineSourceRevision: old, attemptId: "once",
    baselineSha256: baselineFingerprint([baselineBytes, nginx]), runtimeConfigSha256: "c".repeat(64),
    compatibility: { schemaUnchanged: gate(), startupMutationFree: gate(), backwardReadWrite: gate(), unchangedEnvironmentAndSecurity: gate() },
    observedAt: "2026-10-19T11:59:00.000Z", expiresAt: "2026-10-19T12:30:00.000Z" };
  const prepared = { schemaVersion: 1, status: "prepared", sourceRevision: source, release: "1.2.3", baselineSha256: request.baselineSha256,
    manifestSha256: hash(manifestBytes), images: Object.fromEntries(["api", "web", "agent", "sandbox"].map(s => [s, manifest.images[s]!.image.split("@")[1]])),
    diff: { migrationRisk: "none", pendingMigrationCount: 0, changedServices: ["api", "web"] },
    durableConfig: { asrProfile: true, platformSuperuserEmails: true, githubIssueProfile: true, copilotkitExactTimeoutSeconds: 3600, copilotkitPrefixTimeoutSeconds: 3600 },
    checks: { sourceFrozen: gate(), imagesImmutable: gate(), canonicalConfigRendered: gate(), migrationAssessed: { ...gate(), evidenceSha256: hash(JSON.stringify(request)) },
      databaseBackup: gate(), shadowReadiness: gate(), shadowBusiness: gate() }, failures: [],
    preparedAt: request.observedAt, expiresAt: request.expiresAt };
  const commands: string[][] = [], events: string[] = [], writes: Record<string, string>[] = [];
  let switched = false, failStart = false, failSmoke = false, failRollback = false;
  const actualId = (service: string) => service === "api" ? image("5") : image("6");
  const io: AppOnlyIO = {
    configuration: async () => ({ nginxBytes: nginx, runtimeConfigSha256: request.runtimeConfigSha256 }),
    snapshot: async () => ({ baselineBytes: Buffer.from(JSON.stringify({ ...baseline, images: switched ? { ...images, api: actualId("api"), web: actualId("web") } : images }) + "\n"),
      nginxBytes: nginx, runtimeConfigSha256: request.runtimeConfigSha256 }),
    writeImages: async value => { writes.push(value); switched = value.api !== images.api; },
    record: async value => { events.push(value); },
    smoke: async () => { events.push("smoke"); if ((switched && failSmoke) || (!switched && failRollback)) throw Error("failed"); },
    execute: async argv => {
      commands.push([...argv]);
      if (argv.includes("up")) { if (switched && failStart) throw Error("partial start"); return ""; }
      if (argv.includes("ps")) return (argv.at(-1) === "api" ? "a" : "b").repeat(64);
      if (argv[1] === "image" && argv.includes("--format")) {
        if (argv.at(-2)?.includes("image.revision")) return JSON.stringify(old);
        const ref = argv.at(-1)!;
        if (ref.includes("/agent@")) return JSON.stringify(images.agent);
        if (ref.includes("/sandbox@")) return JSON.stringify(images.sandbox);
        return JSON.stringify(ref.includes("/api@") ? actualId("api") : actualId("web"));
      }
      if (argv[1] === "image") {
        const ref = argv.at(-1)!;
        return JSON.stringify([{ Os: "linux", Architecture: "amd64", RepoDigests: [ref], Config: { Labels: { "org.opencontainers.image.revision": source } } }]);
      }
      if (argv[1] === "container") {
        const service = argv.at(-1) === "a".repeat(64) ? "api" : "web";
        return argv[4]!.includes(".Config.Image") ? JSON.stringify([actualId(service), manifest.images[service]!.image, service, true, false, false]) :
          JSON.stringify([images[service], true, false, false]);
      }
      throw new Error("unexpected command");
    },
  };
  return { request, prepared, manifestBytes, baselineBytes, nginx, commands, events, writes, io,
    failStart: () => { failStart = true; }, failSmoke: () => { failSmoke = true; }, failRollback: () => { failRollback = true; },
    run: (operation: "activate" | "rollback" | "verify" | "check" = "activate") => switchAppOnly(request, prepared, manifestBytes, baselineBytes, nginx, io, operation, now) };
}

describe("app-only release (isolated executor, no production authority)", () => {
  it("switches only api/web by immutable image and keeps full acceptance false", async () => {
    const f = fixture(); const result = await f.run();
    expect(result).toEqual({ status: "activated", fullBusinessAcceptance: false });
    expect(f.events).toEqual(["switching", "smoke", "activated"]);
    const start = f.commands.find(c => c.includes("up"))!;
    expect(start.slice(-2)).toEqual(["api", "web"]);
    expect(start).toEqual(expect.arrayContaining(["--no-deps", "--no-build", "--pull", "never"]));
    expect(Object.keys(f.writes[0]!)).toEqual(["api", "web"]);
    expect(f.commands.flat().join(" ")).not.toMatch(/migrate|bootstrap|seed|apparmor|nginx|remove-orphans|buildx|clone|install|pull always/);
  });
  it("readiness performs no image writes, start or smoke", async () => {
    const f = fixture(); expect((await f.run("check")).status).toBe("ready");
    expect(f.writes).toEqual([]); expect(f.events).toEqual([]);
  });
  it("rejects unknown compatibility before any command", async () => {
    const f = fixture(); delete (f.request.compatibility as Partial<typeof f.request.compatibility>).startupMutationFree;
    await expect(f.run()).rejects.toThrow(); expect(f.commands).toEqual([]); expect(f.writes).toEqual([]);
  });
  it("rejects pending migrations instead of silently skipping them", async () => {
    const f = fixture(); f.prepared.diff.pendingMigrationCount = 1;
    await expect(f.run()).rejects.toThrow(); expect(f.commands).toEqual([]);
  });
  it("binds exact request bytes into the existing frozen preparation evidence", async () => {
    const f = fixture(); f.prepared.checks.migrationAssessed.evidenceSha256 = "f".repeat(64);
    await expect(f.run()).rejects.toThrow("APP_ONLY_REQUEST_NOT_FROZEN"); expect(f.commands).toEqual([]);
  });
  it("rejects stale evidence before mutations", async () => {
    const f = fixture(); f.request.expiresAt = "2026-10-19T11:59:30.000Z";
    f.prepared.checks.migrationAssessed.evidenceSha256 = hash(JSON.stringify(f.request));
    await expect(f.run()).rejects.toThrow("APP_ONLY_EVIDENCE_EXPIRED"); expect(f.writes).toEqual([]);
  });
  it("does not overwrite a changed baseline", async () => {
    const f = fixture(); f.io.snapshot = async () => ({ baselineBytes: Buffer.from("{}"), nginxBytes: f.nginx, runtimeConfigSha256: f.request.runtimeConfigSha256 });
    await expect(f.run()).rejects.toThrow("APP_ONLY_NOT_READY"); expect(f.writes).toEqual([]);
  });
  it("restores pinned old api/web after partial start and verifies recovery", async () => {
    const f = fixture(); f.failStart();
    await expect(f.run()).rejects.toThrow("APP_ONLY_ACTIVATION_FAILED_ROLLED_BACK");
    expect(f.writes).toHaveLength(2); expect(f.writes[1]).toEqual({ api: image("1"), web: image("2") });
    expect(f.events).toEqual(["switching", "smoke", "rolled-back"]);
  });
  it("rolls back a failed public smoke without database restore", async () => {
    const f = fixture(); f.failSmoke();
    await expect(f.run()).rejects.toThrow("APP_ONLY_ACTIVATION_FAILED_ROLLED_BACK");
    expect(f.events).toEqual(["switching", "smoke", "smoke", "rolled-back"]);
  });
  it("reports uncertain recovery rather than marking production accepted", async () => {
    const f = fixture(); f.failStart(); f.failRollback();
    await expect(f.run()).rejects.toThrow("APP_ONLY_ROLLBACK_UNPROVEN"); expect(f.events.at(-1)).toBe("uncertain");
  });
  it("rejects configuration drift during recovery without overwriting it", async () => {
    const f = fixture(); f.failStart();
    f.io.configuration = async () => ({ nginxBytes: Buffer.from("changed"), runtimeConfigSha256: f.request.runtimeConfigSha256 });
    await expect(f.run()).rejects.toThrow("APP_ONLY_ROLLBACK_UNPROVEN");
    expect(f.writes).toHaveLength(1); expect(f.events.at(-1)).toBe("uncertain");
  });
  it("verify-after-CAS does not perform another switch", async () => {
    const f = fixture(); await f.run();
    expect((await f.run("verify")).status).toBe("verified"); expect(f.writes).toHaveLength(1);
  });
  it("binding preserves existing gates and refuses Agent changes", () => {
    const f = fixture(); const bytes = Buffer.from(JSON.stringify(f.request));
    expect(bindAppOnlyPreparation(f.prepared, bytes).checks.migrationAssessed.evidenceSha256).toBe(hash(bytes));
    f.prepared.diff.changedServices.push("agent");
    expect(() => bindAppOnlyPreparation(f.prepared, bytes)).toThrow("APP_ONLY_PREPARATION_SCOPE");
  });
  it("rejects unapproved tool roots without entering any production path", () => {
    const guard = new URL("../../../.harness/scripts/vm/cn-app-only-guard.py", import.meta.url);
    const result = spawnSync("python3", ["-I", "-S", "-B", guard.pathname, "/tmp/NOT_A_PRODUCTION_TOOL_ROOT", source], { encoding: "utf8" });
    expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr.trim()).toBe("CN_APP_ONLY_TOOLS_UNAVAILABLE");
  });
  it("retains standard path and the existing shared lock/approval/CAS", () => {
    const shell = readFileSync(new URL("../../../.harness/scripts/vm/deploy-cn-production.sh", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("../../../.github/workflows/promote-cn-production.yml", import.meta.url), "utf8");
    expect(shell).toContain("flock -n 9"); expect(shell).toContain("app-only-inflight.json");
    expect(shell.indexOf('if [[ "$mode" == app-only* ]]')).toBeLessThan(shell.indexOf('if [[ "$mode" == rollback ]]'));
    expect(workflow).toContain("environment: production-cn-promotion"); expect(workflow).toContain("beforeOid,afterOid,force:false");
    expect(workflow).toContain("default: standard"); expect(workflow).toContain("--app-only-commit");
    expect(workflow).toContain("remote_commit_attempted");
  });
});
