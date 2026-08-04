import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadEvidenceProof,
  loadReferencedEvidenceProof,
  type EvidencePathContext,
} from "./phase-readiness-fs";
import { evaluateReadyTransition, type EvidenceProof } from "./phase-readiness";
import { phaseReadiness, type PhaseReadinessDependencies } from "../phase-readiness";

const PHASE = "01";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

interface Fixture {
  root: string;
  evidenceDir: string;
  context: EvidencePathContext;
  readinessPath: string;
  featurePath: string;
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "phase-readiness-fs-"));
  const phaseDir = join(root, "phases/phase-01-fixture");
  const evidenceDir = join(phaseDir, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const readinessPath = join(phaseDir, "runtime-readiness.json");
  const featurePath = join(phaseDir, "feature_list.json");
  writeFileSync(readinessPath, '{"status":"not_ready"}\n');
  writeFileSync(featurePath, '{"features":[{"id":"F01","status":"passing"}]}\n');
  git(root, "init", "-q");
  git(root, "config", "user.email", "phase-readiness@example.invalid");
  git(root, "config", "user.name", "Phase Readiness Test");
  return {
    root,
    evidenceDir,
    context: { repoRoot: root, phaseEvidenceDir: evidenceDir },
    readinessPath,
    featurePath,
  };
}

function repoPath(fixture: Fixture, absolute: string): string {
  return relative(fixture.root, absolute).replaceAll("\\", "/");
}

function manifest(kind: "runtime" | "e2e", artifact: string, commit = COMMIT_A): string {
  return JSON.stringify({
    schema_version: 1,
    phase: PHASE,
    kind,
    command: `pnpm verify:${kind} --phase ${PHASE}`,
    exit_code: 0,
    commit,
    recorded_at: "2026-08-04T00:00:00.000Z",
    artifacts: [artifact],
  }, null, 2) + "\n";
}

function commitAll(fixture: Fixture): void {
  git(fixture.root, "add", ".");
  git(fixture.root, "commit", "-qm", "fixture");
}

function controlBytes(fixture: Fixture): [Buffer, Buffer] {
  return [readFileSync(fixture.readinessPath), readFileSync(fixture.featurePath)];
}

function expectControlBytes(fixture: Fixture, before: [Buffer, Buffer]): void {
  expect(readFileSync(fixture.readinessPath)).toEqual(before[0]);
  expect(readFileSync(fixture.featurePath)).toEqual(before[1]);
}

function writeRegularProof(fixture: Fixture, kind: "runtime" | "e2e", commit = COMMIT_A): string {
  const artifact = join(fixture.evidenceDir, `${kind}.log`);
  const manifestPath = join(fixture.evidenceDir, `${kind}.json`);
  writeFileSync(artifact, `${kind} passed\n`);
  writeFileSync(manifestPath, manifest(kind, repoPath(fixture, artifact), commit));
  return repoPath(fixture, manifestPath);
}

describe("phase readiness evidence filesystem gate", () => {
  it("rejects a committed manifest symlink escaping the repository without control-state side effects", () => {
    const fixture = makeFixture();
    const artifact = join(fixture.evidenceDir, "runtime.log");
    writeFileSync(artifact, "runtime passed\n");
    const outside = join(tmpdir(), `runtime-manifest-${Date.now()}.json`);
    writeFileSync(outside, manifest("runtime", repoPath(fixture, artifact)));
    const manifestPath = join(fixture.evidenceDir, "runtime.json");
    symlinkSync(outside, manifestPath);
    commitAll(fixture);
    const before = controlBytes(fixture);

    const result = loadEvidenceProof(repoPath(fixture, manifestPath), { phase: PHASE, kind: "runtime" }, fixture.context);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("must not be a symbolic link") });
    expectControlBytes(fixture, before);
  });

  it("the CLI fail-closes a manifest symlink before calling its state writer", () => {
    const fixture = makeFixture();
    const artifact = join(fixture.evidenceDir, "runtime.log");
    writeFileSync(artifact, "runtime passed\n");
    const outside = join(tmpdir(), `runtime-cli-manifest-${Date.now()}.json`);
    writeFileSync(outside, manifest("runtime", repoPath(fixture, artifact), COMMIT_B));
    const manifestPath = join(fixture.evidenceDir, "runtime.json");
    symlinkSync(outside, manifestPath);
    commitAll(fixture);
    const before = controlBytes(fixture);
    let saveCalls = 0;
    const dependencies: PhaseReadinessDependencies = {
      now: () => new Date("2026-08-04T00:01:00.000Z"),
      fail: (message) => { throw new Error(message); },
      loadCurrent: () => ({
        schema_version: 1,
        phase: PHASE,
        status: "not_ready",
        reason: "runtime/E2E evidence has not been accepted",
        assessed_at: null,
        assessed_by: null,
        target_commit: null,
        evidence: { runtime: null, e2e: null },
      }),
      save: () => { saveCalls += 1; },
      validateTarget: () => null,
      loadProof: (path, expected) => loadEvidenceProof(path, expected, fixture.context),
      loadFeatures: () => [{ id: "F01", status: "passing" }],
    };

    expect(() => phaseReadiness({
      _: [],
      flags: {},
      opts: {
        phase: PHASE,
        to: "ready",
        actor: "coord-architecture",
        "target-commit": COMMIT_B,
        "runtime-evidence": repoPath(fixture, manifestPath),
        "e2e-evidence": "not-reached.json",
      },
    }, dependencies)).toThrow("must not be a symbolic link");
    expect(saveCalls).toBe(0);
    expectControlBytes(fixture, before);
  });

  it("rejects a committed artifact symlink to an internal untracked file without control-state side effects", () => {
    const fixture = makeFixture();
    const untracked = join(fixture.root, "untracked-runtime.log");
    writeFileSync(untracked, "untracked runtime passed\n");
    const artifact = join(fixture.evidenceDir, "runtime.log");
    symlinkSync(untracked, artifact);
    const manifestPath = join(fixture.evidenceDir, "runtime.json");
    writeFileSync(manifestPath, manifest("runtime", repoPath(fixture, artifact)));
    git(fixture.root, "add", repoPath(fixture, artifact), repoPath(fixture, manifestPath),
      repoPath(fixture, fixture.readinessPath), repoPath(fixture, fixture.featurePath));
    git(fixture.root, "commit", "-qm", "fixture");
    const before = controlBytes(fixture);

    const result = loadEvidenceProof(repoPath(fixture, manifestPath), { phase: PHASE, kind: "runtime" }, fixture.context);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("must not be a symbolic link") });
    expectControlBytes(fixture, before);
  });

  it("rejects a regular file reached through a symlinked phase evidence directory", () => {
    const fixture = makeFixture();
    const redirected = join(fixture.root, "redirected-evidence");
    mkdirSync(redirected);
    const artifact = join(redirected, "runtime.log");
    const manifestPath = join(redirected, "runtime.json");
    writeFileSync(artifact, "runtime passed\n");
    writeFileSync(manifestPath, manifest("runtime", repoPath(fixture, artifact)));
    // Use a second nominal phase evidence path so the fixture's control files
    // remain regular while the parent-directory realpath crosses the boundary.
    const nominal = join(fixture.root, "phases/phase-01-redirected/evidence");
    mkdirSync(join(fixture.root, "phases/phase-01-redirected"), { recursive: true });
    symlinkSync(redirected, nominal);
    const context = { repoRoot: fixture.root, phaseEvidenceDir: nominal };
    const before = controlBytes(fixture);

    const result = loadEvidenceProof(
      repoPath(fixture, join(nominal, "runtime.json")),
      { phase: PHASE, kind: "runtime" },
      context,
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("real path is outside the phase evidence directory"),
    });
    expectControlBytes(fixture, before);
  });

  it.each(["manifest", "artifact"] as const)(
    "rejects dirty committed %s bytes without control-state side effects",
    (dirtyTarget) => {
      const fixture = makeFixture();
      const manifestPath = writeRegularProof(fixture, "runtime");
      commitAll(fixture);
      const target = dirtyTarget === "manifest"
        ? join(fixture.root, manifestPath)
        : join(fixture.evidenceDir, "runtime.log");
      writeFileSync(target, dirtyTarget === "manifest"
        ? manifest("runtime", repoPath(fixture, join(fixture.evidenceDir, "runtime.log"))) + " "
        : "changed after commit\n");
      const before = controlBytes(fixture);

      const result = loadEvidenceProof(manifestPath, { phase: PHASE, kind: "runtime" }, fixture.context);

      expect(result).toEqual({ ok: false, error: expect.stringContaining("must be committed at HEAD and unchanged") });
      expectControlBytes(fixture, before);
    },
  );

  it("rejects a recorded hash that drifts from committed bytes without control-state side effects", () => {
    const fixture = makeFixture();
    const manifestPath = writeRegularProof(fixture, "runtime");
    commitAll(fixture);
    const before = controlBytes(fixture);

    const result = loadReferencedEvidenceProof(
      { path: manifestPath, sha256: "f".repeat(64) },
      { phase: PHASE, kind: "runtime" },
      fixture.context,
    );

    expect(result).toEqual({ ok: false, error: expect.stringContaining("evidence hash drift") });
    expectControlBytes(fixture, before);
  });

  it("rejects committed evidence bound to a different target commit without control-state side effects", () => {
    const fixture = makeFixture();
    const runtimePath = writeRegularProof(fixture, "runtime", COMMIT_A);
    const e2ePath = writeRegularProof(fixture, "e2e", COMMIT_A);
    commitAll(fixture);
    const runtime = loadEvidenceProof(runtimePath, { phase: PHASE, kind: "runtime" }, fixture.context);
    const e2e = loadEvidenceProof(e2ePath, { phase: PHASE, kind: "e2e" }, fixture.context);
    expect(runtime.ok).toBe(true);
    expect(e2e.ok).toBe(true);
    const before = controlBytes(fixture);

    const result = evaluateReadyTransition({
      phase: PHASE,
      features: [{ id: "F01", status: "passing" }],
      actor: "coord-architecture",
      targetCommit: COMMIT_B,
      at: "2026-08-04T00:01:00.000Z",
      runtime: runtime.ok ? runtime.proof : null,
      e2e: e2e.ok ? e2e.proof : null,
    });

    expect(result).toEqual({
      ok: false,
      reasons: [
        `runtime evidence invalid: manifest commit ${COMMIT_A} does not match target ${COMMIT_B}`,
        `e2e evidence invalid: manifest commit ${COMMIT_A} does not match target ${COMMIT_B}`,
      ],
    });
    expectControlBytes(fixture, before);
  });
});
