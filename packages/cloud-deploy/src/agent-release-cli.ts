import { readFile, writeFile } from "node:fs/promises";
import { agentReleaseConfig } from "./agent-release.js";
async function main() {
  const [source, destination, baseImage, revision, ...extra] = process.argv.slice(2);
  if (!source || !destination || !baseImage || !revision || extra.length) throw new Error("USAGE: agent-release-cli.ts source.json destination.json base-image@sha256:digest revision");
  const config = agentReleaseConfig(JSON.parse(await readFile(source, "utf8")), baseImage, revision);
  await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write("AGENT_RELEASE_CONFIG_CREATED\n");
}
main().catch(() => { process.stderr.write("AGENT_RELEASE_CONFIG_FAILED: check arguments, source configuration and unused output path\n"); process.exitCode = 1; });
