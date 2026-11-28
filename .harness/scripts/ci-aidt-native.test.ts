import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs the standalone AIDT native control guards", () => {
  const selftest = fileURLToPath(new URL("./ci-aidt-native.selftest.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--test", selftest], { encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.error?.message ?? result.stdout + result.stderr).toBe(0);
});
