import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { prewarmRelease, validateReleaseManifest, verifyPrewarmedRelease, type ReleaseExecutor } from "./release.js";

const run = promisify(execFile);
const execute: ReleaseExecutor = async argv => {
  const [command, ...args] = argv;
  if (command !== "docker") throw new Error("INVALID_RELEASE_COMMAND");
  const { stdout } = await run(command, args, { timeout: argv[1] === "pull" ? 1_800_000 : 15_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};

async function main() {
  const [action, path, profile, ...extra] = process.argv.slice(2);
  if (!path || !["validate", "verify", "prewarm"].includes(action ?? "") || !["starter", "production"].includes(profile ?? "") || extra.length) {
    throw new Error("USAGE: release-cli.ts validate|verify|prewarm manifest.json starter|production");
  }
  let input: unknown;
  try { input = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new Error("RELEASE_MANIFEST_UNREADABLE"); }
  const manifest = validateReleaseManifest(input);
  const target = profile as "starter" | "production";
  const result = action === "validate" ? { release: manifest.release, valid: true, cloudVerified: false }
    : await (action === "prewarm" ? prewarmRelease : verifyPrewarmedRelease)(manifest, target, execute);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "RELEASE_FAILED"}\n`); process.exitCode = 1; });
