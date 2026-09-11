import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { prepareAcrProductionRelease, validateAcrProductionReleaseManifest } from "./acr-production-release.js";

const run = promisify(execFile);

async function main() {
  const [action, path, repositoryPrefix, ...extra] = process.argv.slice(2);
  if (!path || !repositoryPrefix || !["validate", "prepare"].includes(action ?? "") || extra.length) {
    throw new Error("USAGE: acr-production-release-cli.ts validate|prepare manifest.json registry/namespace");
  }
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const result = action === "validate"
    ? validateAcrProductionReleaseManifest(manifest, repositoryPrefix)
    : await prepareAcrProductionRelease(manifest, repositoryPrefix, async argv => {
      if (argv[0] !== "docker" || !(
        argv[1] === "pull" && argv[2] === "--platform" ||
        argv[1] === "image" && argv[2] === "inspect"
      )) throw new Error("INVALID_ACR_PREPARATION_COMMAND");
      return (await run("docker", argv.slice(1), { timeout: 300_000, maxBuffer: 1024 * 1024 })).stdout;
    });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(error => {
  const message = error instanceof Error && /^(ACR_|INVALID_ACR|USAGE:)/.test(error.message)
    ? error.message
    : "ACR_PRODUCTION_RELEASE_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
