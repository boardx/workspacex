import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { findPhaseDir, REPO_ROOT } from "./paths";
import {
  parseEvidenceManifest,
  parsePhaseReadiness,
  type EvidenceProof,
  type PhaseReadiness,
  type ReadinessEvidenceKind,
} from "./phase-readiness";

export function phaseReadinessPath(phaseId: string): string {
  return join(findPhaseDir(phaseId), "runtime-readiness.json");
}

export function loadPhaseReadiness(phaseId: string): PhaseReadiness {
  const path = phaseReadinessPath(phaseId);
  if (!existsSync(path)) throw new Error(`readiness document missing: ${relative(REPO_ROOT, path)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`readiness document is not valid JSON: ${relative(REPO_ROOT, path)}`);
  }
  const parsed = parsePhaseReadiness(raw, phaseId);
  if (!parsed.ok) throw new Error(`readiness schema invalid: ${parsed.errors.join("; ")}`);
  return parsed.value;
}

export function savePhaseReadiness(state: PhaseReadiness): void {
  writeFileSync(phaseReadinessPath(state.phase), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function safeRepoPath(input: string): { absolute: string; relative: string } | null {
  if (!input || isAbsolute(input) || input.includes("\\")) return null;
  const absolute = resolve(REPO_ROOT, input);
  if (absolute !== REPO_ROOT && !absolute.startsWith(REPO_ROOT + sep)) return null;
  const rel = relative(REPO_ROOT, absolute).replaceAll("\\", "/");
  return rel.startsWith("../") ? null : { absolute, relative: rel };
}

function committedAndClean(path: string): string | null {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { cwd: REPO_ROOT, stdio: "ignore" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
    return null;
  } catch {
    return `${path} must be committed at HEAD and unchanged`;
  }
}

function validateArtifact(path: string): string | null {
  const safe = safeRepoPath(path);
  if (!safe) return `artifact path is unsafe: ${path}`;
  if (!existsSync(safe.absolute) || !statSync(safe.absolute).isFile() || statSync(safe.absolute).size === 0)
    return `artifact is missing or empty: ${safe.relative}`;
  return committedAndClean(safe.relative);
}

export function loadEvidenceProof(
  inputPath: string,
  expected: { phase: string; kind: ReadinessEvidenceKind },
): { ok: true; proof: EvidenceProof } | { ok: false; error: string } {
  const safe = safeRepoPath(inputPath);
  if (!safe) return { ok: false, error: `${expected.kind} evidence path is unsafe` };
  if (!existsSync(safe.absolute) || !statSync(safe.absolute).isFile() || statSync(safe.absolute).size === 0)
    return { ok: false, error: `${expected.kind} evidence is missing or empty: ${safe.relative}` };
  const committedError = committedAndClean(safe.relative);
  if (committedError) return { ok: false, error: committedError };
  const bytes = readFileSync(safe.absolute);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, error: `${expected.kind} evidence is not valid JSON: ${safe.relative}` };
  }
  const parsed = parseEvidenceManifest(raw, expected);
  if (!parsed.ok) return { ok: false, error: `${expected.kind} evidence schema invalid: ${parsed.errors.join("; ")}` };
  for (const artifact of parsed.value.artifacts) {
    const error = validateArtifact(artifact);
    if (error) return { ok: false, error: `${expected.kind} evidence ${error}` };
  }
  return {
    ok: true,
    proof: {
      path: safe.relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      manifest: parsed.value,
    },
  };
}

export function validateTargetCommit(commit: string): string | null {
  if (!/^[0-9a-f]{40}$/.test(commit)) return "target commit must be a full 40-character lowercase SHA";
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: REPO_ROOT, stdio: "ignore" });
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: REPO_ROOT, stdio: "ignore" });
    return null;
  } catch {
    return `target commit ${commit} must exist and be an ancestor of HEAD`;
  }
}
