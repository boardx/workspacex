#!/usr/bin/env node
import { loadEvidenceProof, validateTargetCommit } from "./lib/phase-readiness-fs";
import type { ReadinessEvidenceKind } from "./lib/phase-readiness";

function option(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const phase = option("phase");
const kind = option("kind") as ReadinessEvidenceKind;
const target = option("target-commit");
const targetError = validateTargetCommit(target);
if (targetError) throw new Error(targetError);
const loaded = loadEvidenceProof(option("manifest"), { phase, kind });
if (!loaded.ok) throw new Error(loaded.error);
if (loaded.proof.manifest.commit !== target) {
  throw new Error(`manifest commit ${loaded.proof.manifest.commit} does not match target ${target}`);
}
console.log(`[readiness-evidence] VALID kind=${kind} target=${target} sha256=${loaded.proof.sha256}`);
