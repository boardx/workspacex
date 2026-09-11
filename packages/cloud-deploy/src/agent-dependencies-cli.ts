import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
async function main() {
  const [baseImage, pyproject, output, platform, ...extra] = process.argv.slice(2);
  if (!baseImage || !pyproject || !output || !["linux/amd64", "linux/arm64"].includes(platform ?? "") || extra.length || !/^langchain\/langgraph-(?:api|server)@sha256:[a-f0-9]{64}$/.test(baseImage)) {
    throw new Error("USAGE: agent-dependencies-cli.ts official-base@sha256:digest pyproject.toml requirements.release.txt linux/amd64|linux/arm64");
  }
  const path = resolve(pyproject);
  if (path.includes(",") || /[\r\n]/.test(path)) throw new Error("INVALID_PYPROJECT_PATH");
  await readFile(path, "utf8");
  const script = `import importlib.metadata, pathlib, subprocess
pathlib.Path("/tmp/base.txt").write_text("langgraph-api==" + importlib.metadata.version("langgraph-api"))
subprocess.run(["uv", "pip", "compile", "/workspace/pyproject.toml", "--constraint", "/api/constraints.txt", "--constraint", "/tmp/base.txt", "--generate-hashes", "--no-cache", "--python-version", "3.11"], check=True)
`;
  // No project source, env files, credentials, or license are mounted into this resolver.
  const name = `wsx-agent-lock-${randomUUID()}`;
  let stdout: string;
  try {
    ({ stdout } = await run("docker", ["run", "--rm", "--name", name, "--platform", platform!, "--pull=never", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=268435456", "--mount", `type=bind,src=${path},dst=/workspace/pyproject.toml,readonly`, "--entrypoint", "python", baseImage, "-c", script], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 }));
  } finally {
    // Killing a Docker CLI does not necessarily stop its container.
    await run("docker", ["rm", "-f", name], { timeout: 15_000, maxBuffer: 64 * 1024 }).catch(() => undefined);
  }
  if (!stdout.includes("langgraph-api==") || !stdout.includes("--hash=sha256:")) throw new Error("AGENT_DEPENDENCY_LOCK_INVALID");
  await writeFile(output, stdout, { flag: "wx", mode: 0o600 });
  process.stdout.write("AGENT_DEPENDENCY_LOCK_CREATED\n");
}
main().catch(() => { process.stderr.write("AGENT_DEPENDENCY_LOCK_FAILED: verify cached official base, public package access and unused output path\n"); process.exitCode = 1; });
