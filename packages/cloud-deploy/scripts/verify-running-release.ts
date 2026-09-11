import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { validateReleaseManifest } from "../src/release.js";
import { verifyRunningRelease } from "../src/running-release.js";
const [image] = process.argv.slice(2);
if (!image || !/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Provide an already cached Node image by digest");
const ids: Record<string, string> = {};
const run = (argv: readonly string[]) => execFileSync(argv[0]!, argv.slice(1), { encoding: "utf8", timeout: 15_000 });
const artifact = { image };
const manifest = validateReleaseManifest({ schemaVersion: 1, release: "1.0.0", sourceRevision: "a".repeat(40), platform: run(["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image]).trim(), images: { web: artifact, api: artifact, agent: artifact, sandbox: artifact, postgres: artifact, redis: artifact } });
try {
  for (const service of ["web", "api", "agent", "sandbox", "sandbox-sessions"]) {
    ids[service] = run(["docker", "run", "--detach", "--pull", "never", "--network", "none", "--memory", "64m", "--cpus", "0.1", "--pids-limit", "32", "--label", `com.docker.compose.service=${service}`, image, "node", "-e", "setInterval(()=>{},1000)"]).trim();
  }
  assert.equal((await verifyRunningRelease(manifest, "production", ids, async argv => run(argv))).checked.length, 5);
  run(["docker", "stop", "--time", "1", ids.web!]);
  await assert.rejects(() => verifyRunningRelease(manifest, "production", ids, async argv => run(argv)), /RUNNING_RELEASE_MISMATCH: web/);
  process.stdout.write("Real Docker fixture: running identity verified; stopped container rejected. No application/cloud acceptance claimed.\n");
} finally {
  for (const id of Object.values(ids)) run(["docker", "rm", "--force", id]);
}
