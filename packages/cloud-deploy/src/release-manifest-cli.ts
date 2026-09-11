import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createReleaseManifest } from "./release-manifest.js";
const run = promisify(execFile);
async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error("USAGE: release-manifest-cli.ts build-input.json release.json");
  const manifest = await createReleaseManifest(JSON.parse(await readFile(input, "utf8")), async argv => {
    if (argv[0] !== "docker" || !(argv[1] === "image" && argv[2] === "inspect" || argv[1] === "buildx" && argv[2] === "imagetools" && argv[3] === "inspect")) throw new Error("INVALID_INSPECTION_COMMAND");
    return (await run("docker", argv.slice(1), { timeout: 15000, maxBuffer: 1024 * 1024 })).stdout;
  });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write("RELEASE_MANIFEST_CREATED\n");
}
main().catch(error => { process.stderr.write(`${error instanceof Error && /^((INVALID_RELEASE|RELEASE_DIGEST|RELEASE_REGISTRY|RELEASE_IMAGE|IMAGE_|INVALID_IMAGE)|USAGE:)/.test(error.message) ? error.message : "RELEASE_MANIFEST_GENERATION_FAILED"}\n`); process.exitCode = 1; });
