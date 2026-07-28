import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { identity } from "@repo/contracts";
import { PROBE_BODY_SCHEMA } from "../src/interface/controllers/kernel-probe.controller";

/**
 * "The contract reaches the backend" (UC-0.6 V10 / invariant I-12).
 *
 * ADR-020 says one zod definition feeds four consumers: backend DTOs, frontend types,
 * OpenAPI and the frontend mock. Until F18 only the frontend end was wired -- the backend
 * end was described but never connected, and nothing checked it.
 *
 * The risk is specific: backend DTOs look exactly like the contract, so they get copied by
 * hand. Afterwards both sides are internally consistent and nothing fails until integration.
 * It has already happened twice on this project (`"org"|"team"` vs `"org-wide"|"team-only"`,
 * and `IngestionRun.status` vs `.state`).
 */

const API_SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

describe("contract as single source, backend side", () => {
  it("the validation pipe uses the contract's schema by REFERENCE, not a look-alike", () => {
    // Structural equality would be satisfied by a hand-copied schema that happens to match
    // today. Reference identity is what proves there is only one definition.
    expect(PROBE_BODY_SCHEMA).toBe(identity.operations.authorize.in);
  });

  it("no backend file redefines a contract type", () => {
    const contractNames = new Set<string>();
    const contractsSrc = fileURLToPath(new URL("../../../packages/contracts/src", import.meta.url));
    for (const f of readdirSync(contractsSrc)) {
      if (!f.endsWith(".ts") || f === "index.ts") continue;
      const body = readFileSync(join(contractsSrc, f), "utf8");
      for (const m of body.matchAll(/^export const ([A-Z]\w+)\s*=\s*z\./gm)) contractNames.add(m[1]!);
      for (const m of body.matchAll(/^export (?:interface|type) ([A-Z]\w+)\b/gm)) contractNames.add(m[1]!);
    }
    expect(contractNames.size, "read zero contract names -- this test would pass vacuously").toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of walk(API_SRC)) {
      const body = readFileSync(file, "utf8");
      for (const name of contractNames) {
        if (new RegExp(`^export interface ${name}\\b`, "m").test(body)) {
          offenders.push(`${relative(API_SRC, file)} redefines ${name}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no backend file declares its own zod object schema (schemas belong in the contract)", () => {
    const offenders: string[] = [];
    for (const file of walk(API_SRC)) {
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        if (/^\s*(?:export\s+)?const\s+\w+\s*=\s*z\.object\(/.test(line)) {
          offenders.push(`${relative(API_SRC, file)}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    expect(
      offenders,
      `Request/response shapes are defined once, in packages/contracts.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the contract gate reaches the backend at all", () => {
  it("V10: lint-contract-source scans apps/api, not just the frontend", () => {
    // Asserting "the script exits 0" would have passed for the whole period the gate
    // covered only apps/web/lib -- which is exactly how the backend end of ADR-020's
    // single-source chain went unchecked from the day it was written.
    const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
    const out = execFileSync("node", [".harness/scripts/lint-contract-source.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const dirs = /scanned-dirs=(.*)/.exec(out)?.[1] ?? "";
    expect(dirs, out).toContain("apps/api");
  });
});
