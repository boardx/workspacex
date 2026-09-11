import { readFile, writeFile } from "node:fs/promises";
import { pinAgentDockerfile } from "./agent-release.js";
async function main() {
  const [input, output, baseImage, ...extra] = process.argv.slice(2);
  if (!input || !output || !baseImage || extra.length) throw new Error("USAGE: agent-dockerfile-cli.ts generated.Dockerfile Dockerfile.release base-image@sha256:digest");
  const dockerfile = pinAgentDockerfile(await readFile(input, "utf8"), baseImage);
  await writeFile(output, dockerfile, { flag: "wx", mode: 0o600 });
  process.stdout.write("AGENT_DOCKERFILE_PINNED\n");
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "AGENT_DOCKERFILE_FAILED"}\n`); process.exitCode = 1; });
