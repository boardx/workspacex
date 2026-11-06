import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { sessionShellArguments } from "../src/session/provider.js";

function run(command: string) {
  const [shell, ...args] = sessionShellArguments(command);
  const result = spawnSync(shell!, args, { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  expect(result.error).toBeUndefined(); return result;
}
it("preserves upstream command failure instead of letting tail mask it", () => {
  const command = "(printf 'dependency unavailable\\n'; exit 7) 2>&1 | tail -5";
  expect(spawnSync("/bin/sh", ["-c", command]).status).toBe(0); // original false-success counterexample
  const result = run(command);
  expect(result.status).toBe(7); expect(result.stdout).toContain("dependency unavailable");
});
it("keeps successful pipelines and explicit shell recovery working without adding errexit", () => {
  expect(run("printf 'ready\\n' | tail -1").status).toBe(0);
  expect(run("false; printf recovered").stdout).toBe("recovered");
  expect(run("false; printf recovered").status).toBe(0);
});
