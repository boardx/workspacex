import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  activatePreparedCnRelease,
  classifyReleaseFailures,
  createPreparedCnRelease,
  validatePreparedCnRelease,
  verifyPreparedReleaseManifest,
  type ActivationActions,
} from "../src/cn-fast-safe-release.js";

const sha = (value: string) => value.repeat(40);
const digest = (value: string) => `sha256:${value.repeat(64)}`;
const gate = (value="e") => ({ status:"passed", evidenceSha256:value.repeat(64) });
const evidence = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  sourceRevision: sha("a"),
  baselineSha256: "b".repeat(64),
  release: "2026.9.14-cn.11",
  manifestSha256: digest("c").slice(7),
  images: { web: digest("1"), api: digest("2"), agent: digest("3"), sandbox: digest("4") },
  diff: { migrationRisk: "none", changedServices: ["web", "api", "agent"] },
  durableConfig: {
    asrProfile: true,
    platformSuperuserEmails: true,
    githubIssueProfile: true,
    copilotkitExactTimeoutSeconds: 3600,
    copilotkitPrefixTimeoutSeconds: 3600,
  },
  checks: {
    sourceFrozen: gate(), imagesImmutable: gate(), canonicalConfigRendered: gate(),
    migrationAssessed: gate(), databaseBackup: gate(), shadowReadiness: gate(), shadowBusiness: gate(),
  },
  failures: [],
  preparedAt: "2026-09-14T00:00:00.000Z",
  expiresAt: "2026-09-15T00:00:00.000Z",
  ...overrides,
});

describe("CN fast-safe preparation", () => {
  it("freezes an exact four-image release without any traffic action", async () => {
    const actions = {
      freezeSource: vi.fn(async () => sha("a")),
      buildImmutableImages: vi.fn(async () => evidence().images),
      renderCanonicalConfig: vi.fn(async () => ({ ...evidence().durableConfig, asrProfile: true as const, platformSuperuserEmails: true as const, githubIssueProfile: true as const })),
      assessDiff: vi.fn(async () => ({ migrationRisk: "none" as const, changedServices: ["web", "api", "agent"] as ("web" | "api" | "agent" | "sandbox")[] })),
      verifyDatabaseBackup: vi.fn(async () => "passed" as const),
      runShadowChecks: vi.fn(async () => ({ shadowReadiness: "passed" as const, shadowBusiness: "passed" as const })),
    };
    const receipt = await createPreparedCnRelease({
      sourceRevision: sha("a"), baselineSha256: "b".repeat(64), release: "2026.9.14-cn.11",
      manifestSha256: digest("c").slice(7), preparedAt: "2026-09-14T00:00:00.000Z", expiresAt: "2026-09-15T00:00:00.000Z",
    }, actions);
    expect(receipt.status).toBe("prepared");
    expect(Object.values(receipt.images)).toHaveLength(4);
    expect(Object.keys(actions)).not.toContain("activateTraffic");
  });

  it("blocks missing durable profiles, weak timeouts, skips, and non-digest images", () => {
    for (const invalid of [
      evidence({ durableConfig: { ...evidence().durableConfig, asrProfile: false } }),
      evidence({ durableConfig: { ...evidence().durableConfig, copilotkitPrefixTimeoutSeconds: 300 } }),
      evidence({ checks: { ...evidence().checks, shadowBusiness: { status:"skipped", evidenceSha256:"e".repeat(64) } } }),
      evidence({ images: { ...evidence().images, api: "registry/app:latest" } }),
      evidence({ diff: { migrationRisk: "destructive", changedServices: ["api"] } }),
    ]) expect(() => validatePreparedCnRelease(invalid)).toThrow("INVALID_PREPARED_CN_RELEASE");
  });

  it("binds the receipt to the exact manifest bytes and four application digests", () => {
    const images=evidence().images;
    const image=(service:keyof typeof images)=>({image:`registry.example/team/${service}@${images[service]}`});
    const manifest=Buffer.from(`${JSON.stringify({schemaVersion:1,release:"2026.9.14-cn.11",sourceRevision:sha("a"),platform:"linux/amd64",images:{web:image("web"),api:image("api"),agent:image("agent"),sandbox:image("sandbox"),postgres:image("api"),redis:image("api")}})}\n`);
    const receipt=evidence({manifestSha256:createHash("sha256").update(manifest).digest("hex")});
    expect(verifyPreparedReleaseManifest(receipt,manifest).sourceRevision).toBe(sha("a"));
    expect(()=>verifyPreparedReleaseManifest(receipt,Buffer.from(manifest.toString().replace(images.api,images.web)))).toThrow("PREPARED_MANIFEST_MISMATCH");
  });

  it("only waives stale-test or infrastructure failures with bounded evidence", () => {
    const waiver = { issueUrl: "https://github.com/boardx/workspacex/issues/3609", evidenceSha256: digest("d").slice(7), owner: "release-owner", expiresAt: "2026-09-14T12:00:00.000Z" };
    expect(classifyReleaseFailures([{ check: "stale-fixture", classification: "stale-test", waiver }], new Date("2026-09-14T01:00:00Z"))).toEqual({ blocked: [], waived: ["stale-fixture"] });
    for (const classification of ["product", "unknown"] as const) {
      expect(classifyReleaseFailures([{ check: "gate", classification, waiver }], new Date("2026-09-14T01:00:00Z")).blocked).toEqual(["gate"]);
    }
    expect(classifyReleaseFailures([{ check: "infra", classification: "infrastructure", waiver: { ...waiver, expiresAt: "2026-09-14T00:30:00Z" } }], new Date("2026-09-14T01:00:00Z")).blocked).toEqual(["infra"]);
    expect(classifyReleaseFailures([{ check: "infra", classification: "infrastructure" }], new Date("2026-09-14T01:00:00Z")).blocked).toEqual(["infra"]);
  });
});

function activationActions(overrides: Partial<ActivationActions> = {}): ActivationActions {
  return {
    readBaselineFingerprint: vi.fn(async () => "b".repeat(64)),
    drainRuns: vi.fn(async () => ({ queued: 0, running: 0, writebackPending: 0 })),
    promotePreparedPointer: vi.fn(async () => undefined),
    activateTraffic: vi.fn(async () => undefined),
    verifyCanonical: vi.fn(async () => ({ status: "passed" as const, lockRetained: false, passedStages: 8 })),
    runBrowserSmoke: vi.fn(async () => ({ login: true, hello: true, asr: true, githubFeedbackRead: true, skillTool: true, pdfDownload: true })),
    restoreBaseline: vi.fn(async () => undefined),
    restorePointer: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("CN fast-safe activation", () => {
  it("uses CAS, drains all run states, then promotes and verifies 8/8 plus browser evidence", async () => {
    const actions = activationActions();
    const report = await activatePreparedCnRelease(evidence(), actions, { now: new Date("2026-09-14T01:00:00Z"), deadlineMs: 300_000 });
    expect(report.status).toBe("passed");
    expect(vi.mocked(actions.promotePreparedPointer).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(actions.drainRuns).mock.invocationCallOrder[0]!);
    expect(vi.mocked(actions.activateTraffic).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(actions.promotePreparedPointer).mock.invocationCallOrder[0]!);
    expect(vi.mocked(actions.runBrowserSmoke).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(actions.verifyCanonical).mock.invocationCallOrder[0]!);
  });

  it.each([
    ["baseline CAS", { readBaselineFingerprint: vi.fn(async () => "f".repeat(64)) }],
    ["queued runs", { drainRuns: vi.fn(async () => ({ queued: 1, running: 0, writebackPending: 0 })) }],
  ])("blocks before promotion on %s failure", async (_name, override) => {
    const actions = activationActions(override as Partial<ActivationActions>);
    const report = await activatePreparedCnRelease(evidence(), actions, { now: new Date("2026-09-14T01:00:00Z") });
    expect(report.status).toBe("blocked");
    expect(actions.promotePreparedPointer).not.toHaveBeenCalled();
  });

  it("rolls traffic and the pointer back when a post-switch gate fails", async () => {
    const actions = activationActions({ verifyCanonical: vi.fn(async () => ({ status: "failed" as const, lockRetained: false, passedStages: 7 })) });
    const report = await activatePreparedCnRelease(evidence(), actions, { now: new Date("2026-09-14T01:00:00Z") });
    expect(report).toMatchObject({ status: "rolled-back", code: "CANONICAL_GATE_FAILED" });
    expect(actions.restoreBaseline).toHaveBeenCalledOnce();
    expect(actions.restorePointer).toHaveBeenCalledOnce();
  });

  it("fails closed when rollback cannot be proven and never accepts over-five-minute deadlines", async () => {
    const actions = activationActions({ activateTraffic: vi.fn(async () => { throw new Error("credential=secret"); }), restoreBaseline: vi.fn(async () => { throw new Error("unknown"); }) });
    const report = await activatePreparedCnRelease(evidence(), actions, { now: new Date("2026-09-14T01:00:00Z") });
    expect(report).toEqual(expect.objectContaining({ status: "rollback-unproven", code: "ACTIVATION_FAILED" }));
    expect(JSON.stringify(report)).not.toContain("secret");
    await expect(activatePreparedCnRelease(evidence(), activationActions(), { now: new Date("2026-09-14T01:00:00Z"), deadlineMs: 300_001 })).rejects.toThrow("INVALID_ACTIVATION_DEADLINE");
  });
});
