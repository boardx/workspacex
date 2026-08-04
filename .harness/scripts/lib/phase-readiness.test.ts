import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditPhaseReadiness,
  createInitialPhaseReadiness,
  evaluateReadyTransition,
  parsePhaseReadiness,
  type EvidenceProof,
  type ReadinessFeature,
} from "./phase-readiness";

const COMMIT = "a".repeat(40);

function features(passing: number, inProgress = 0): ReadinessFeature[] {
  return [
    ...Array.from({ length: passing }, (_, i) => ({ id: `P${i + 1}`, status: "passing" as const })),
    ...Array.from({ length: inProgress }, (_, i) => ({ id: `I${i + 1}`, status: "in_progress" as const })),
  ];
}

function proof(kind: "runtime" | "e2e"): EvidenceProof {
  return {
    path: `phases/phase-01-run-a-project/evidence/${kind}.json`,
    sha256: kind === "runtime" ? "b".repeat(64) : "c".repeat(64),
    manifest: {
      schema_version: 1,
      phase: "01",
      kind,
      command: kind === "runtime" ? "pnpm verify:runtime --phase 01" : "pnpm verify:full --phase 01",
      exit_code: 0,
      commit: COMMIT,
      recorded_at: "2026-08-04T00:00:00.000Z",
      artifacts: [`evidence/${kind}.log`],
    },
  };
}

describe("phase runtime/E2E readiness", () => {
  it("does not infer ready from the exact 142 passing + 2 in_progress class", () => {
    const fs = features(142, 2);
    const result = evaluateReadyTransition({
      phase: "01",
      features: fs,
      actor: "agt_coord_architecture",
      targetCommit: COMMIT,
      at: "2026-08-04T00:01:00.000Z",
      runtime: proof("runtime"),
      e2e: proof("e2e"),
    });

    expect(result).toEqual({
      ok: false,
      reasons: ["feature gate failed: 142/144 passing; 2 still in_progress"],
    });
  });

  it("does not infer ready when all features pass but full-stack evidence is absent", () => {
    const result = evaluateReadyTransition({
      phase: "01",
      features: features(144),
      actor: "agt_coord_architecture",
      targetCommit: COMMIT,
      at: "2026-08-04T00:01:00.000Z",
      runtime: null,
      e2e: null,
    });

    expect(result).toEqual({
      ok: false,
      reasons: ["runtime evidence is required", "e2e evidence is required"],
    });
  });

  it("transitions explicitly only with all passing plus both valid evidence proofs", () => {
    const fs = features(144);
    const before = structuredClone(fs);
    const result = evaluateReadyTransition({
      phase: "01",
      features: fs,
      actor: "agt_coord_architecture",
      targetCommit: COMMIT,
      at: "2026-08-04T00:01:00.000Z",
      runtime: proof("runtime"),
      e2e: proof("e2e"),
    });

    expect(result).toEqual({
      ok: true,
      state: {
        schema_version: 1,
        phase: "01",
        status: "ready",
        reason: "runtime and E2E gates passed",
        assessed_at: "2026-08-04T00:01:00.000Z",
        assessed_by: "agt_coord_architecture",
        target_commit: COMMIT,
        evidence: {
          runtime: { path: proof("runtime").path, sha256: proof("runtime").sha256 },
          e2e: { path: proof("e2e").path, sha256: proof("e2e").sha256 },
        },
      },
    });
    expect(fs).toEqual(before);
  });

  it("doctor rejects a forged ready state for the 142/2 phase", () => {
    const initial = createInitialPhaseReadiness("01");
    const forged = {
      ...initial,
      status: "ready" as const,
      assessed_at: "2026-08-04T00:01:00.000Z",
      assessed_by: "someone",
      target_commit: COMMIT,
      evidence: {
        runtime: { path: proof("runtime").path, sha256: proof("runtime").sha256 },
        e2e: { path: proof("e2e").path, sha256: proof("e2e").sha256 },
      },
    };

    expect(auditPhaseReadiness(forged, features(142, 2), [proof("runtime"), proof("e2e")])).toEqual({
      status: "ready",
      fails: ["ready is invalid: feature gate failed: 142/144 passing; 2 still in_progress"],
      warns: [],
    });
  });

  it("initial state is explicitly not_ready and independent from feature status", () => {
    expect(createInitialPhaseReadiness("01")).toEqual({
      schema_version: 1,
      phase: "01",
      status: "not_ready",
      reason: "runtime/E2E evidence has not been accepted",
      assessed_at: null,
      assessed_by: null,
      target_commit: null,
      evidence: { runtime: null, e2e: null },
    });
  });

  it("schema rejects ready without complete provenance and not_ready with stale evidence", () => {
    expect(parsePhaseReadiness({
      ...createInitialPhaseReadiness("01"),
      status: "ready",
    }, "01")).toEqual({
      ok: false,
      errors: [
        "ready assessed_at must be canonical ISO 8601",
        "ready assessed_by must be non-empty",
        "ready target_commit must be a full SHA",
        "ready runtime evidence reference is required",
        "ready e2e evidence reference is required",
      ],
    });

    expect(parsePhaseReadiness({
      ...createInitialPhaseReadiness("01"),
      evidence: { runtime: { path: "stale", sha256: "a".repeat(64) }, e2e: null },
    }, "01")).toEqual({
      ok: false,
      errors: ["not_ready must not retain target_commit or evidence references"],
    });
  });

  it("new-phase scaffolds the independent state instead of deriving it from feature_list", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const source = readFileSync(resolve(root, ".harness/scripts/new-phase.ts"), "utf8");
    const template = JSON.parse(readFileSync(
      resolve(root, ".harness/templates/runtime-readiness.template.json"),
      "utf8",
    )) as Record<string, unknown>;

    expect(source).toContain('renderTemplateFile("runtime-readiness.template.json", vars)');
    expect(template).toMatchObject({ schema_version: 1, status: "not_ready" });
    expect(JSON.stringify(template)).not.toContain("passing");
  });
});
