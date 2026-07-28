#!/usr/bin/env node
/**
 * lint-contract-source.mjs -- API contract single-source gate (ADR-020)
 *
 * Two checks:
 *   1. Generated files have not been hand-edited -- re-run the generator and compare byte
 *      for byte against what is on disk.
 *   2. No hand-written second copy -- outside `apps/web/lib/generated/`, nothing may
 *      redefine a type the contract already declares.
 *
 * Why this deserves its own gate: this project has drifted five times from "the same fact
 * declared in two places" -- design tokens, the font scale, the omission-reason enum, the
 * withdrawal-chain SLA, story points. The shape is identical every time: someone changes A
 * and forgets B, and both look correct until something breaks.
 *
 * Hand-edited generated files are the most insidious variant: editing one does not change
 * the contract, it just quietly separates the mock from it -- and a mock is always
 * self-consistent, so the UI keeps working right up to integration day.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GEN_DIR = join(ROOT, "apps/web/lib/generated");
const CONTRACTS = join(ROOT, "packages/contracts");

let fail = 0;

/* -- 1. generated files have not been hand-edited -------------------------- */
if (!existsSync(GEN_DIR)) {
  console.log("  (no generated directory yet, skipping the drift check)");
} else {
  const before = new Map();
  for (const f of readdirSync(GEN_DIR)) {
    if (f.endsWith(".ts")) before.set(f, readFileSync(join(GEN_DIR, f), "utf8"));
  }

  // The generator writes in place, so capture the old content before re-running it.
  try {
    execFileSync("pnpm", ["exec", "tsx", "scripts/gen-mock.ts"], {
      cwd: CONTRACTS, stdio: "pipe", encoding: "utf8",
    });
  } catch (e) {
    console.error(`✗ the generator failed to run: ${e.message.split("\n")[0]}`);
    process.exit(1);
  }

  for (const [name, old] of before) {
    const now = readFileSync(join(GEN_DIR, name), "utf8");
    if (now !== old) {
      console.error(`✗ [drift] apps/web/lib/generated/${name} does not match the contract`);
      console.error("    Either it was hand-edited, or the contract changed and was not regenerated.");
      console.error("    Fix: pnpm --filter @repo/contracts gen:mock, and commit the output with it.");
      fail++;
    }
  }
  // The generator may have produced new files (the contract gained a module).
  for (const f of readdirSync(GEN_DIR)) {
    if (f.endsWith(".ts") && !before.has(f)) {
      console.error(`✗ [uncommitted] apps/web/lib/generated/${f} was just generated but is not on disk's existing list`);
      fail++;
    }
  }
}

/* -- 2. no hand-written second copy ---------------------------------------- */
// Collect every exported type/const name from the contract source, then look for anyone
// who started their own version of it.
const contractNames = new Set();
const srcDir = join(CONTRACTS, "src");
if (existsSync(srcDir)) {
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".ts") || f === "index.ts") continue;
    const body = readFileSync(join(srcDir, f), "utf8");
    for (const m of body.matchAll(/^export const ([A-Z]\w+)\s*=\s*z\./gm)) contractNames.add(m[1]);
    // The contract may also declare plain structures with interface/type (not zod);
    // those are part of the contract too.
    for (const m of body.matchAll(/^export (?:interface|type) ([A-Z]\w+)\b/gm)) contractNames.add(m[1]);
  }
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "generated" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

/**
 * Scan scope. It MUST include `apps/api`.
 *
 * ADR-020's single-source rule says one zod definition feeds the backend DTOs, the frontend
 * types, OpenAPI and the mock -- but this gate used to scan only the frontend side, so a
 * hand-copied DTO on the backend triggered nothing at all. That is the highest-risk surface
 * for "the same fact in two places": backend DTOs are shaped like the contract, so they get
 * copied, and afterwards both sides are internally consistent until integration day. It has
 * already happened twice (`"org"|"team"` vs `"org-wide"|"team-only"`, and
 * `IngestionRun.status` vs `.state`).
 *
 * UC-0.6 V10 asserts on THIS LIST containing apps/api, not merely on the script exiting 0.
 */
const SCAN_DIRS = ["apps/web/lib", "apps/api/src"];
const scannedDirs = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs) || contractNames.size === 0) continue;
  scannedDirs.push(dir);
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    const body = readFileSync(file, "utf8");
    for (const name of contractNames) {
      // Only literal REDEFINITION counts. These three are correct and must pass:
      //   export type X = z.infer<typeof C.X>      <- derived from the contract
      //   export { X } from "@repo/contracts/..."  <- re-export
      //   export type X = C.X                      <- alias
      // A crude rule punishes correct code -- the first version of this check flagged five
      // legitimate z.infer derivations.
      //
      // `export interface X { ... }` is a DIFFERENT form of redefinition: it has no `= rhs`,
      // so the first version's regex missed it entirely. The phase coherence review found
      // Omission and Citation redefined exactly that way on the frontend.
      const ifaceRe = new RegExp(`^export interface ${name}\\b`, "m");
      const im = ifaceRe.exec(body);
      if (im) {
        const line = body.slice(0, im.index).split("\n").length;
        console.error(`✗ [copy] ${rel}:${line} redefines contract type \`${name}\` with \`interface\``);
        console.error(`    The contract lives in packages/contracts/src/. Derive from it or re-export it; do not restate the structure.`);
        fail++;
        continue;
      }

      const re = new RegExp(`^export (?:const|type) ${name}\\s*=\\s*([^;]+);`, "m");
      const m = re.exec(body);
      if (!m) continue;
      const rhs = m[1].trim();
      const derived =
        /\bz\.infer\s*</.test(rhs) ||          // derived via z.infer
        /^[A-Z]\w*\.\w+$/.test(rhs) ||          // C.X alias
        /@repo\/contracts/.test(rhs);           // direct reference to the contract package
      if (derived) continue;
      const line = body.slice(0, m.index).split("\n").length;
      console.error(`✗ [copy] ${rel}:${line} redefines contract type \`${name}\` with a LITERAL`);
      console.error(`    What it actually says: ${rhs.slice(0, 60)}`);
      console.error(`    The contract lives in packages/contracts/src/. Correct form: export type ${name} = z.infer<typeof C.${name}>;`);
      fail++;
    }
  }
}

console.log(
  fail === 0
    ? `✅ lint-contract-source: generated files match the contract, no hand-written copies (${contractNames.size} contract types)`
    : `\n❌ ${fail} violation(s). The contract is the single source -- the same fact in two places always drifts (ADR-020).`,
);
// Machine-readable: UC-0.6 V10 asserts this line contains apps/api.
// "It scanned only the frontend" must not count as a pass.
console.log(`scanned-dirs=${scannedDirs.join(",") || "(none)"}`);
process.exit(fail === 0 ? 0 : 1);
