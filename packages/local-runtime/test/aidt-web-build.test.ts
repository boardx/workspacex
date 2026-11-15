import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PORTS, webEnv, type LocalConfig } from "../src/config";
import { acquireWebOutputLease, checkAidtWebBuild, fingerprintAidtWebBuild, invalidateAidtWebBuild, recordAidtWebBuild } from "../src/aidt-web-build";
const directories: string[] = [], leases: { close(): Promise<void> }[] = [];
const receiptFile = (c: LocalConfig) => join(output(c), "aidt-local-build-receipt.json");
function output(c: LocalConfig): string { return join(c.repoRoot, "apps", "web", webEnv(c).NEXT_DIST_DIR!); }
function write(file: string, content: string) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); }
function fixture(): LocalConfig {
  const repoRoot = mkdtempSync(join(tmpdir(), "aidt-build-")); directories.push(repoRoot);
  for (const [file, text] of Object.entries({ "apps/web/package.json": "{}", "apps/web/next.config.mjs": "export default {}", "apps/web/app/page.tsx": "export default function Page(){return null}", "packages/ui/src/button.tsx": "export const button = true", "package.json": "{}", "pnpm-lock.yaml": "lockfileVersion: '9.0'", "tsconfig.json": "{}" })) write(join(repoRoot, file), text);
  return { repoRoot, dataDir: join(repoRoot, "private-data"), profile: "aidt", ports: DEFAULT_PORTS, chatModel: "local", metaModel: "local", embeddingModel: "local", secrets: { modelCredentialKey: "SECRET", emailVerificationSecret: "SECRET", deepAgentInternalKey: "SECRET", adminPassword: "SECRET" } };
}
function build(c: LocalConfig) {
  for (const [file, text] of Object.entries({ "BUILD_ID": "build-one", "build-manifest.json": "{}", "required-server-files.json": "{}", "routes-manifest.json": "{}", "package.json": "{}", "server/app/page.js": "export const compiled = true", "static/chunks/client.js": "window.CLIENT_BUILD = true" })) write(join(output(c), file), text);
}
afterEach(async () => { for (const lease of leases.splice(0)) await lease.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
describe("AIDT verified local prebuild", () => {
  it("records a compatible build using the actual profile web environment and verifies it", async () => {
    const c = fixture(); build(c); const before = fingerprintAidtWebBuild(c); await recordAidtWebBuild(c, before);
    const receipt = JSON.parse(readFileSync(receiptFile(c), "utf8")) as Record<string, unknown>;
    expect(receipt).toMatchObject({ schema: 1, buildId: "build-one", apiURL: webEnv(c).NEXT_PUBLIC_API_URL, publicEnv: before.publicEnv, sourceInputHash: before.sourceInputHash });
    expect(receipt.runtimeArtifactHash).toMatch(/^[a-f0-9]{64}$/); expect(checkAidtWebBuild(c)).toEqual({ usable: true, reason: null });
    expect(JSON.stringify(receipt)).not.toContain("SECRET"); expect(JSON.stringify(receipt)).not.toContain(c.dataDir);
  });
  it("fails closed without a receipt and does not create output while checking", () => {
    const c = fixture(); expect(checkAidtWebBuild(c).usable).toBe(false); expect(existsSync(output(c))).toBe(false);
    build(c); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it("rejects another API port and a disabled profile or edited browser flag", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c);
    expect(checkAidtWebBuild({ ...c, ports: { ...c.ports, api: 3300 } }).usable).toBe(false);
    expect(checkAidtWebBuild({ ...c, profile: "default" }).usable).toBe(false);
    const receipt = JSON.parse(readFileSync(receiptFile(c), "utf8")) as { publicEnv: Record<string, string> }; receipt.publicEnv.NEXT_PUBLIC_ENABLE_AIDT = "0";
    write(receiptFile(c), JSON.stringify(receipt)); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it.each(["apps/web/app/page.tsx", "packages/ui/src/button.tsx", "pnpm-lock.yaml", "apps/web/next.config.mjs", "apps/web/e2e/support/board-provider-receipt-build.mjs"])("detects changed source/dependency input %s", async (file) => {
    const c = fixture(); write(join(c.repoRoot, file), "original build input"); build(c); await recordAidtWebBuild(c); write(join(c.repoRoot, file), "changed"); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it.each([".env", ".env.local", ".env.production", ".env.production.local"])("invalidates a receipt when actual Next dotenv input %s changes, without retaining its values", async (name) => {
    const c = fixture(), file = join(c.repoRoot, "apps/web", name); write(file, "NEXT_PUBLIC_CLASSROOM_NAME=PRIVATE_DOTENV_SENTINEL"); build(c); await recordAidtWebBuild(c);
    expect(checkAidtWebBuild(c).usable).toBe(true); expect(readFileSync(receiptFile(c), "utf8")).not.toContain("PRIVATE_DOTENV_SENTINEL");
    write(file, "NEXT_PUBLIC_CLASSROOM_NAME=CHANGED_PRIVATE_SENTINEL"); const result = checkAidtWebBuild(c); expect(result.usable).toBe(false); expect(result.reason).toContain("source"); expect(result.reason).not.toContain("CHANGED_PRIVATE_SENTINEL");
  });
  it.skipIf(process.platform === "win32")("rejects a symlinked Next dotenv input before reading a private target", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); const secret = join(c.dataDir, "private-config"); write(secret, "PRIVATE_DOTENV_TARGET");
    symlinkSync(secret, join(c.repoRoot, "apps/web/.env.production.local")); const result = checkAidtWebBuild(c);
    expect(result.usable).toBe(false); expect(result.reason).toContain("symlinked"); expect(result.reason).not.toContain("PRIVATE_DOTENV_TARGET"); expect(readFileSync(secret, "utf8")).toBe("PRIVATE_DOTENV_TARGET");
  });
  it("detects new and deleted source files, not only existing timestamps", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); write(join(c.repoRoot, "packages/ui/src/new.ts"), ""); expect(checkAidtWebBuild(c).usable).toBe(false);
    unlinkSync(join(c.repoRoot, "packages/ui/src/new.ts")); expect(checkAidtWebBuild(c).usable).toBe(true);
    unlinkSync(join(c.repoRoot, "packages/ui/src/button.tsx")); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it.each(["server/app/page.js", "static/chunks/client.js", "routes-manifest.json", "BUILD_ID"])("rejects changed compiled runtime %s", async (file) => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); write(join(output(c), file), "changed"); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it("detects newly added compiled runtime files", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); write(join(output(c), "server/new-route.js"), ""); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it("ignores generated caches, test results, evidence and private data instead of traversing them", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c);
    for (const file of ["apps/web/.next-aidt-local/cache/fetch/one", "apps/web/.next-aidt-local/types/generated.ts", "apps/web/.next-aidt-local/trace", "apps/web/.next-other/static/chunk.js", "apps/web/node_modules/fake.js", "apps/web/coverage/result.json", "apps/web/test-results/run.json", "packages/ui/dist/index.js", "packages/ui/test/example.test.ts", "docs/evidence/run.log", "private-data/secrets.json", "apps/web/.env.example"]) write(join(c.repoRoot, file), "PRIVATE_OR_GENERATED_CONTENT");
    expect(checkAidtWebBuild(c)).toEqual({ usable: true, reason: null });
  });
  it("allows native generated Monaco during a fresh build but binds its browser bytes to the receipt", async () => {
    const c = fixture(), before = fingerprintAidtWebBuild(c); build(c);
    const generated = join(c.repoRoot, "apps/web/public/monaco-editor/min/vs/editor/editor.main.js"); write(generated, "generated Monaco runtime");
    expect(fingerprintAidtWebBuild(c)).toEqual(before); await recordAidtWebBuild(c, before); expect(checkAidtWebBuild(c).usable).toBe(true);
    write(generated, "tampered Monaco runtime"); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
  it("invalidates first so a failed build or incomplete output cannot retain an old success receipt", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); invalidateAidtWebBuild(c); expect(existsSync(receiptFile(c))).toBe(false);
    expect(checkAidtWebBuild(c).usable).toBe(false); unlinkSync(join(output(c), "BUILD_ID"));
    await expect(recordAidtWebBuild(c)).rejects.toThrow(); expect(existsSync(receiptFile(c))).toBe(false);
  });
  it("rejects source edits made during the build rather than blessing new source against old artifacts", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); const before = fingerprintAidtWebBuild(c);
    write(join(c.repoRoot, "apps/web/app/page.tsx"), "edited while Next was building");
    await expect(recordAidtWebBuild(c, before)).rejects.toThrow(/changed during the build/); expect(existsSync(receiptFile(c))).toBe(false);
  });
  it.skipIf(process.platform === "win32")("rejects manifest/receipt symlinks before reading private data", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c);
    const secret = join(c.dataDir, "secret.txt"); write(secret, "PRIVATE_TARGET_SENTINEL");
    const manifest = join(output(c), "required-server-files.json"); unlinkSync(manifest); symlinkSync(secret, manifest);
    const result = checkAidtWebBuild(c); expect(result.usable).toBe(false); expect(result.reason).toContain("symlinked"); expect(result.reason).not.toContain("PRIVATE_TARGET_SENTINEL");
    unlinkSync(receiptFile(c)); symlinkSync(secret, receiptFile(c)); const receiptResult = checkAidtWebBuild(c); expect(receiptResult.usable).toBe(false); expect(receiptResult.reason).toContain("symlinked"); expect(receiptResult.reason).not.toContain("PRIVATE_TARGET_SENTINEL");
    expect(readFileSync(secret, "utf8")).toBe("PRIVATE_TARGET_SENTINEL");
  });
  it("clears a previous receipt before a recording error and rejects malformed receipt data", async () => {
    const c = fixture(); build(c); await recordAidtWebBuild(c); write(join(output(c), "build-manifest.json"), "not-json");
    await expect(recordAidtWebBuild(c)).rejects.toThrow(); expect(existsSync(receiptFile(c))).toBe(false);
    write(receiptFile(c), "null"); expect(checkAidtWebBuild(c).usable).toBe(false);
  });
});

describe("AIDT repository output ownership", () => {
  it("permits exactly one concurrent owner even when data directories differ", async () => {
    const c = fixture(); const attempts = await Promise.allSettled([acquireWebOutputLease(c.repoRoot), acquireWebOutputLease(c.repoRoot), acquireWebOutputLease(c.repoRoot)]);
    const winners = attempts.filter((result): result is PromiseFulfilledResult<{ close(): Promise<void> }> => result.status === "fulfilled"); for (const item of winners) leases.push(item.value);
    expect(winners).toHaveLength(1); expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(2);
    const fingerprint = fingerprintAidtWebBuild(c); await winners[0]!.value.close(); expect(fingerprintAidtWebBuild(c)).toEqual(fingerprint);
    const next = await acquireWebOutputLease(c.repoRoot); leases.push(next); await Promise.all([next.close(), next.close()]);
  });
  it("does not kill, remove or adopt a stale/foreign output lock", async () => {
    const c = fixture(), lock = join(c.repoRoot, "apps/web/.aidt-local-output-owner.json"), text = JSON.stringify({ schema: 1, instanceId: "old", pid: process.pid, startedAt: "1970-01-01" });
    write(lock, text); const kill = vi.spyOn(process, "kill");
    await expect(acquireWebOutputLease(c.repoRoot)).rejects.toThrow(/stale lock/); expect(readFileSync(lock, "utf8")).toBe(text); expect(kill).not.toHaveBeenCalled();
  });
  it("does not remove a replacement owner on old close and does not delete runtime output", async () => {
    const c = fixture(); build(c); const lease = await acquireWebOutputLease(c.repoRoot); leases.push(lease);
    const lock = join(c.repoRoot, "apps/web/.aidt-local-output-owner.json"), replacement = JSON.stringify({ schema: 1, instanceId: "replacement", pid: process.pid }); write(lock, replacement);
    await lease.close(); expect(readFileSync(lock, "utf8")).toBe(replacement); expect(readdirSync(output(c))).toContain("BUILD_ID");
  });
});
