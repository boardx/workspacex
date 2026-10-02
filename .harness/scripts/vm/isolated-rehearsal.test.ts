import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("isolated rehearsal input and failure closure", () => {
  it("executes provider, target, durable-intent and real-process counterexamples", () => {
    const suite = dirname(fileURLToPath(import.meta.url));
    const output = execFileSync("python3", ["-m", "unittest", "discover", "-s", suite, "-p", "isolated_*_test.py"], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, PYTHONPYCACHEPREFIX: "/tmp/wsx-isolated-test-pycache" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toBe("");
    for (const script of ["isolated_test_frozen_engine.cjs", "isolated_test_canvas_law.cjs", "isolated_test_pending_attachment_law.cjs", "isolated_test_role_scope_law.cjs", "isolated_rehearsal_role_password_test.cjs"]) {
      const result = execFileSync(process.execPath, [`${suite}/${script}`], { encoding: "utf8", timeout: 10_000 });
      expect(result).toContain("PASS");
    }
  });
});
