import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const stage = readFileSync(resolve(import.meta.dirname, "stage-cn-offline-source-cache.sh"), "utf8");
const verification = stage.match(/^verify_cache\(\)\{[\s\S]*?^\}/m)?.[0];
if (!verification) throw new Error("offline cache verifier is missing");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("rejects absent, untrusted, and promisor caches before Prepare", () => {
  const root = mkdtempSync(join(tmpdir(), "cn-offline-cache-"));
  roots.push(root);
  const cache = join(root, "cache.git");
  const bare = spawnSync("git", ["init", "--bare", "-q", cache], { encoding: "utf8" });
  expect(bare.status).toBe(0);
  const run = (path: string, env?: Record<string, string>) => spawnSync("bash", ["-c", `${verification}\nverify_cache "$1"`, "bash", path], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  expect(run(join(root, "absent")).status).not.toBe(0);
  expect(run(cache).status).not.toBe(0); // local user-owned fixture is not root-private

  const bin = join(root, "bin");
  mkdirSync(bin);
  const stat = join(bin, "stat");
  writeFileSync(stat, "#!/bin/sh\necho root:root:700\n");
  chmodSync(stat, 0o700);
  const trustedFixture = { PATH: `${bin}:${process.env.PATH}` };
  expect(run(cache, trustedFixture).status).toBe(0);
  writeFileSync(join(cache, "objects", "pack", "fixture.promisor"), "");
  expect(run(cache, trustedFixture).status).not.toBe(0);
});
