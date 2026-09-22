#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseEvidenceManifest, type ReadinessEvidenceKind } from "./lib/phase-readiness";
import { parseExecutedCount } from "./lib/executed-count";
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

// #3008：日志「存在且非空」拦不住零收集——一份正文是 `Tests  no tests` 的日志
// 过去照样产出 exit_code:0 的合规 manifest。执行条数从日志正文解析，解析不到就报错。
const counted = parseExecutedCount(readFileSync(logPath, "utf8"));
if (!counted.ok) throw new Error(`evidence log executed count is unreadable: ${counted.reason}`);
if (counted.executed < 1) {
  const evidence = counted.matches.map((m) => `${m.runner}: ${m.line}`).join(" | ");
  throw new Error(`evidence log reports zero executed tests: ${evidence}`);
}

const artifact = relative(process.cwd(), logPath).replaceAll("\\", "/");
const manifest = {
  schema_version: 1 as const,
  phase,
  kind,
  command,
  exit_code: 0 as const,
  executed: counted.executed,
  commit,
  recorded_at: new Date().toISOString(),
  artifacts: [artifact],
};
const parsed = parseEvidenceManifest(manifest, { phase, kind });
if (!parsed.ok) throw new Error(`invalid evidence manifest: ${parsed.errors.join("; ")}`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(parsed.value, null, 2) + "\n");
console.log(`[readiness-evidence] kind=${kind} commit=${commit} executed=${counted.executed} manifest=${relative(process.cwd(), outputPath)}`);
