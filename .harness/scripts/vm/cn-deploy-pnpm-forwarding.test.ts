import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const deploy = readFileSync(resolve(import.meta.dirname, "deploy-cn-production.sh"), "utf8");
const root = resolve(import.meta.dirname, "../../..");

it("forwards CN deploy CLI arguments under the declared pnpm version", () => {
  expect(deploy).toContain('pnpm() { COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 "$@"; }');
  expect(deploy).toContain('[[ "$(pnpm --version)" == 9.15.0 ]]');
  const calls = deploy.split("\n").filter(line => /pnpm .*--filter @repo\/cloud-deploy (stable-secret-preflight|prepare-host|cn-fast-safe-release|provision) /.test(line));
  expect(calls.length).toBe(7);
  for (const call of calls) expect(call).not.toMatch(/\s--\s/);

  const protocol = spawnSync("pnpm", ["--filter", "@repo/cloud-deploy", "stable-secret-preflight", "/tmp/wsx-cn-missing-baseline", "/tmp/wsx-cn-missing-stable"], {
    cwd: root, encoding: "utf8", timeout: 15_000,
  });
  expect(protocol.error).toBeUndefined();
  expect(protocol.status).toBe(1);
  expect(protocol.stderr).toContain("STABLE_SECRET_DIRECTORY_DRIFT");
  expect(protocol.stderr).not.toContain("STABLE_SECRET_PREFLIGHT_ARGUMENTS_INVALID");
});
