#!/usr/bin/env node
/**
 * lint-error-leak.mjs -- static half of the error boundary.
 *
 * architecture.md's third runtime gate says the exception filter returns only
 * `internal_error`, "with a lint gate on `String(err)` / `err.message` in the response body".
 * verify-runtime-gates.sh proves the ONE path it exercises is clean; this catches every
 * other path before it is written.
 *
 * Rule: nothing under `src/interface/` may read `.message` or `.stack` off an error, or
 * stringify an exception. That layer builds responses; error detail belongs to the logger,
 * which lives in `infrastructure`. Making it a layer-wide ban rather than a per-call check
 * means there is nothing to reason about at review time.
 *
 * Deliberately narrow: it only fires on error-ish identifiers (err / error / exception / e),
 * so `user.message` or `frame.stack` in unrelated code is not flagged. This project has two
 * precedents for over-firing gates -- lint-omission-reason flagged 42 free-text strings, and
 * lint-contract-source flagged 5 correct z.infer derivations -- and a noisy gate gets muted.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : [join(API, "src/interface")];

const ERRISH = String.raw`(?:err|error|exception|e)\b`;
const RULES = [
  { re: new RegExp(String.raw`\b${ERRISH}\s*\.\s*message\b`, "i"), why: "err.message routinely contains SQL fragments and table names" },
  { re: new RegExp(String.raw`\b${ERRISH}\s*\.\s*stack\b`, "i"), why: "a stack trace exposes file layout and internal call paths" },
  { re: new RegExp(String.raw`String\(\s*${ERRISH}\s*\)`, "i"), why: "String(err) is err.message with extra steps" },
  { re: new RegExp(String.raw`JSON\.stringify\(\s*${ERRISH}\s*\)`, "i"), why: "serialising the exception object dumps whatever it carries" },
];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

let fail = 0;
let scanned = 0;
for (const root of ROOTS) {
  if (!existsSync(root)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  for (const file of walk(root)) {
    scanned++;
    const body = readFileSync(file, "utf8");
    body.split("\n").forEach((line, i) => {
      // Comments are exempt: a comment explaining "err.message must not be returned"
      // is documentation of the rule, not a violation of it.
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
      for (const r of RULES) {
        if (r.re.test(line)) {
          console.error(`✗ ${relative(API, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
          console.error(`    ${r.why}`);
          console.error(`    The interface layer builds responses. Pass the error to LoggerPort instead.`);
          fail++;
        }
      }
    });
  }
}

console.log(
  fail === 0
    ? `✅ lint-error-leak: ${scanned} files in the interface layer, no error detail reaches a response`
    : `\n❌ ${fail} potential leak(s). Detail goes to the log, the response gets a code and a traceId.`,
);
console.log(`scanned=${scanned}`);
process.exit(fail === 0 ? 0 : 1);
