#!/usr/bin/env node
/**
 * lint-arch-deps.mjs -- onion architecture dependency-direction gate (ADR-020)
 *
 * The entire value of onion architecture is the single rule "dependencies may only point
 * inward", and that rule is mechanically checkable. Splitting into four folders without
 * checking direction gives you four folders and zero benefit. This script is the check.
 *
 * Layers (innermost first):
 *   domain          entities / value objects / invariants  -- imports no outer layer
 *   application     use cases / ports                      -- imports domain only
 *   infrastructure  PG / S3 / gateways                     -- IMPLEMENTS application ports
 *   interface       controllers / DTOs / routes            -- imports application, never infrastructure
 *
 * `infrastructure` is the special case: it imports `application` ports in order to
 * implement them. Control flows outward, dependencies point inward -- that is exactly
 * dependency inversion, so it is allowed. It still may not import `interface`.
 *
 * `interface` may not import `infrastructure` directly: that binds controllers to concrete
 * implementations and makes dependency injection pointless. It should depend on
 * `application` ports and let the DI container supply the implementation.
 *
 * ## Two things this script asserts about ITSELF
 *
 * 1. It reports the number of files SCANNED, not just an exit code. Against a directory
 *    that does not exist it prints "skipped" and exits 0 -- so a check that only asserts
 *    "exit code is 0" is permanently, vacuously true. That was this gate's actual state
 *    from ADR-020 until F18: never scanned a single file while being described as
 *    "mandatory, on par with the other seven gates".
 *
 * 2. Files inside a scanned root that belong to NO layer are reported unless they are on
 *    the COMPOSITION_ROOT allowlist. Without that rule, "put the code in a directory with
 *    no layer name" is a silent way around the whole gate.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ["apps/api/src"];

/** Which layers each layer may import. Key is "who", value is "may depend on". */
const ALLOWED = {
  domain: new Set([]), // innermost: depends on nothing
  application: new Set(["domain"]),
  infrastructure: new Set(["domain", "application"]), // dependency inversion: implements application ports
  interface: new Set(["domain", "application"]), // deliberately excludes infrastructure
};
const LAYERS = Object.keys(ALLOWED);

/**
 * Files allowed to sit in a scanned root without belonging to a layer.
 *
 * The composition root is the one place that legitimately wires ports to implementations,
 * so it must import both `infrastructure` and `interface`. It is not business code, it is
 * assembly instructions -- but it is an exemption, so it is enumerated rather than inferred.
 * Keep this list tiny; every entry is a file the layering rules do not protect.
 */
const COMPOSITION_ROOT = new Set(["main.ts", "kernel.module.ts"]);

/** Why a given dependency is forbidden -- written for the person reading the error. */
const WHY = {
  "domain→application": "domain is the innermost layer; depending outward lets technical detail pollute business rules",
  "domain→infrastructure": "domain must not know a database or gateway exists; declare a port in application instead",
  "domain→interface": "domain must not know HTTP exists",
  "application→infrastructure": "the use-case layer depends only on the ports it defines; DI injects the implementation",
  "application→interface": "the use-case layer must not know HTTP exists; protocol adaptation belongs to interface",
  "infrastructure→interface": "infrastructure must not depend on the HTTP layer; both are outer layers and coupling them sideways is not layering",
  "interface→infrastructure": "importing a concrete implementation from a controller hard-wires the dependency and makes DI pointless -- depend on the application port",
};

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

/** Infer which layer a path belongs to. */
function layerOf(relPath) {
  for (const l of LAYERS) {
    if (relPath.includes(`/${l}/`) || relPath.startsWith(`${l}/`)) return l;
  }
  return null;
}

let fail = 0;
let scanned = 0;
let anyRoot = false;

for (const root of ROOTS) {
  const abs = join(ROOT, root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  anyRoot = true;
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    const from = layerOf(rel);

    if (!from) {
      // No layer: only the composition root may live here.
      const withinRoot = relative(abs, file);
      if (COMPOSITION_ROOT.has(withinRoot)) continue;
      console.error(`✗ ${rel}`);
      console.error(`    sits in no layer, and is not on the composition-root allowlist`);
      console.error(
        `    move it into domain/ application/ infrastructure/ interface/, or add it to COMPOSITION_ROOT in this script.`,
      );
      console.error(
        `    Why this is checked: a file outside every layer is exempt from the direction rule -- an unlisted one is a silent way around the gate.`,
      );
      fail++;
      continue;
    }

    scanned++;
    const body = readFileSync(file, "utf8");
    for (const m of body.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      // Only project-internal path references participate; third-party packages do not.
      const to = layerOf(spec.startsWith(".") ? join(dirname(rel), spec) : spec);
      if (!to || to === from) continue;
      if (ALLOWED[from].has(to)) continue;
      const line = body.slice(0, m.index).split("\n").length;
      const key = `${from}→${to}`;
      console.error(`✗ ${rel}:${line}`);
      console.error(`    ${from} layer imports ${to} layer: ${spec}`);
      console.error(`    ${WHY[key] ?? "dependencies must point inward"}`);
      fail++;
    }
  }
}

if (!anyRoot) {
  console.log("✅ lint-arch-deps: backend not created yet, nothing to check (active once the bundle is signed and work starts)");
  console.log("scanned=0");
  process.exit(0);
}
console.log(
  fail === 0
    ? `✅ lint-arch-deps: ${scanned} files, all dependencies point inward`
    : `\n❌ ${fail} violation(s). A broken onion degrades to four folders and zero benefit (ADR-020).`,
);
// Machine-readable line: V2 asserts scanned > 0, NOT the exit code.
// Against an empty directory this gate exits 0 while testing nothing.
console.log(`scanned=${scanned}`);
process.exit(fail === 0 ? 0 : 1);
