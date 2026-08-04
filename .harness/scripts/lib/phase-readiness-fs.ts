import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findPhaseDir, REPO_ROOT } from "./paths";
import {
  parseEvidenceManifest,
  parsePhaseReadiness,
  type EvidenceRef,
  type EvidenceProof,
  type PhaseReadiness,
  type ReadinessEvidenceKind,
} from "./phase-readiness";

export interface EvidencePathContext {
  repoRoot: string;
  phaseEvidenceDir: string;
}

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

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

function defaultEvidenceContext(phase: string): EvidencePathContext {
  return { repoRoot: REPO_ROOT, phaseEvidenceDir: join(findPhaseDir(phase), "evidence") };
}

function safeEvidencePath(
  input: string,
  context: EvidencePathContext,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
  if (!input || isAbsolute(input) || input.includes("\\"))
    return { ok: false, error: `path must be repository-relative: ${input}` };
  const repoRoot = resolve(context.repoRoot);
  const phaseEvidenceDir = resolve(context.phaseEvidenceDir);
  const absolute = resolve(repoRoot, input);
  const rel = relative(repoRoot, absolute).replaceAll("\\", "/");
  if (!isWithin(repoRoot, absolute) || rel.startsWith("../"))
    return { ok: false, error: `path escapes repository: ${input}` };
  if (!isWithin(phaseEvidenceDir, absolute) || absolute === phaseEvidenceDir)
    return { ok: false, error: `path is outside the phase evidence directory: ${rel}` };
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch {
    return { ok: false, error: `file is missing: ${rel}` };
  }
  if (metadata.isSymbolicLink()) return { ok: false, error: `file must not be a symbolic link: ${rel}` };
  if (!metadata.isFile() || metadata.size === 0) return { ok: false, error: `file is missing or empty: ${rel}` };
  try {
    const repoReal = realpathSync(repoRoot);
    // Resolve the phase directory but intentionally not its evidence child. If
    // evidence/ itself is a symlink, the candidate's real path cannot be under
    // this nominal allowed directory and is rejected.
    const allowedReal = join(realpathSync(dirname(phaseEvidenceDir)), basename(phaseEvidenceDir));
    const candidateReal = realpathSync(absolute);
    if (!isWithin(repoReal, candidateReal))
      return { ok: false, error: `real path escapes repository: ${rel}` };
    if (!isWithin(allowedReal, candidateReal) || candidateReal === allowedReal)
      return { ok: false, error: `real path is outside the phase evidence directory: ${rel}` };
  } catch {
    return { ok: false, error: `real path cannot be validated: ${rel}` };
  }
  return { ok: true, absolute, relative: rel };
}

function committedAndClean(path: string, repoRoot: string): string | null {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], { cwd: repoRoot, stdio: "ignore" });
    return null;
  } catch {
    return `${path} must be committed at HEAD and unchanged`;
  }
}

function validateArtifact(path: string, context: EvidencePathContext): string | null {
  const safe = safeEvidencePath(path, context);
  if (!safe.ok) return `artifact ${safe.error}`;
  return committedAndClean(safe.relative, context.repoRoot);
}

export function loadEvidenceProof(
  inputPath: string,
  expected: { phase: string; kind: ReadinessEvidenceKind },
  context: EvidencePathContext = defaultEvidenceContext(expected.phase),
): { ok: true; proof: EvidenceProof } | { ok: false; error: string } {
  const safe = safeEvidencePath(inputPath, context);
  if (!safe.ok) return { ok: false, error: `${expected.kind} evidence ${safe.error}` };
  const committedError = committedAndClean(safe.relative, context.repoRoot);
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
    const error = validateArtifact(artifact, context);
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

export function loadReferencedEvidenceProof(
  ref: EvidenceRef,
  expected: { phase: string; kind: ReadinessEvidenceKind },
  context: EvidencePathContext = defaultEvidenceContext(expected.phase),
): { ok: true; proof: EvidenceProof } | { ok: false; error: string } {
  const loaded = loadEvidenceProof(ref.path, expected, context);
  if (!loaded.ok) return loaded;
  if (loaded.proof.sha256 !== ref.sha256) {
    return {
      ok: false,
      error: `${expected.kind} evidence hash drift (recorded ${ref.sha256.slice(0, 8)} / actual ${loaded.proof.sha256.slice(0, 8)})`,
    };
  }
  return loaded;
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
