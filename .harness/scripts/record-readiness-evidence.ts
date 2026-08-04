#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseEvidenceManifest, type ReadinessEvidenceKind } from "./lib/phase-readiness";
import { validateTargetCommit } from "./lib/phase-readiness-fs";

function option(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const phase = option("phase");
const kind = option("kind") as ReadinessEvidenceKind;
if (kind !== "runtime" && kind !== "e2e") throw new Error("--kind must be runtime or e2e");
const command = option("command");
const commit = option("commit");
const targetError = validateTargetCommit(commit);
if (targetError) throw new Error(targetError);
const logPath = resolve(option("log"));
const outputPath = resolve(option("output"));
if (!existsSync(logPath) || readFileSync(logPath).length === 0) throw new Error("evidence log must exist and be non-empty");

const artifact = relative(process.cwd(), logPath).replaceAll("\\", "/");
const manifest = {
  schema_version: 1 as const,
  phase,
  kind,
  command,
  exit_code: 0 as const,
  commit,
  recorded_at: new Date().toISOString(),
  artifacts: [artifact],
};
const parsed = parseEvidenceManifest(manifest, { phase, kind });
if (!parsed.ok) throw new Error(`invalid evidence manifest: ${parsed.errors.join("; ")}`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(parsed.value, null, 2) + "\n");
console.log(`[readiness-evidence] kind=${kind} commit=${commit} manifest=${relative(process.cwd(), outputPath)}`);
