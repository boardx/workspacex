import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Counter-proof for the layering gate (UC-0.6 V2 / V3).
 *
 * Asserting "the script exits 0" would be worthless: against a directory that does not
 * exist, lint-arch-deps prints "skipped" and exits 0. That was its real state for the
 * whole time ADR-020 described it as mandatory. So these tests assert what it CAUGHT and
 * how many files it SCANNED.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GATE = join(ROOT, ".harness/scripts/lint-arch-deps.mjs");

function run(...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function scannedCount(out: string): number {
  return Number(/scanned=(\d+)/.exec(out)?.[1] ?? "-1");
}

describe("lint-arch-deps", () => {
  it("actually scans the real source tree (V2: assert the file count, not the exit code)", () => {
    const r = run("apps/api/src");
    expect(r.code, r.out).toBe(0);
    expect(scannedCount(r.out), "scanned zero files -- the gate is idling").toBeGreaterThan(0);
  });

  it("V3 counter-proof: rejects every forbidden direction and says why", () => {
    const r = run("apps/api/__fixtures__/arch-bad");
    expect(r.code, "bad fixtures must fail the gate").toBe(1);
    expect(r.out).toContain("domain layer imports application layer");
    expect(r.out).toContain("domain layer imports infrastructure layer");
    expect(r.out).toContain("application layer imports infrastructure layer");
    expect(r.out).toContain("interface layer imports infrastructure layer");
    // Explanations are part of the gate: an error nobody understands gets worked around.
    expect(r.out).toContain("makes DI pointless");
  });

  it("V3 counter-proof: a file in no layer cannot silently escape the gate", () => {
    const r = run("apps/api/__fixtures__/arch-bad");
    expect(r.out).toContain("composition-escape.ts");
    expect(r.out).toContain("sits in no layer");
  });

  it("does NOT over-fire: infrastructure -> application is dependency inversion and must pass", () => {
    const r = run("apps/api/__fixtures__/arch-good");
    expect(r.code, r.out).toBe(0);
    expect(scannedCount(r.out)).toBeGreaterThan(0);
  });

  it("the composition root is allowlisted, and the allowlist is short", () => {
    const src = execFileSync("node", ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(GATE)},"utf8"))`], {
      encoding: "utf8",
    });
    const list = /const COMPOSITION_ROOT = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? "";
    const entries = list.split(",").map((s) => s.trim()).filter(Boolean);
    expect(entries.length, "every entry here is a file the layering rules do not protect").toBeLessThanOrEqual(3);
  });
});

describe("lint-error-leak", () => {
  it("catches every way of putting error detail into a response", () => {
    const gate = join(ROOT, "apps/api/scripts/lint-error-leak.mjs");
    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", [gate, "apps/api/__fixtures__/leak-bad"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      code = err.status ?? 1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(code).toBe(1);
    expect(out).toContain("err.message routinely contains SQL");
    expect(out).toContain("String(err) is err.message with extra steps");
    expect(out).toContain("a stack trace exposes");
    expect(out).toContain("serialising the exception object");
  });

  it("does NOT over-fire on ordinary .message / .stack on non-error objects", () => {
    const gate = join(ROOT, "apps/api/scripts/lint-error-leak.mjs");
    const out = execFileSync("node", [gate, "apps/api/__fixtures__/leak-good"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("scanned=1");
  });
});
