import { readFile, writeFile } from "node:fs/promises";
import { validateDeploymentConfig } from "./config.js";
import { runtimeEnvironment, serializeRuntimeEnvironment } from "./runtime-environment.js";

async function main() {
  if (![4, 5].includes(process.argv.length)) throw new Error("RUNTIME_ENVIRONMENT_PREFLIGHT_ARGUMENTS_INVALID");
  const parsed = validateDeploymentConfig(JSON.parse(await readFile(process.argv[2]!, "utf8")) as unknown);
  if (!parsed.ok || parsed.config.environment.profile !== "production") throw new Error("RUNTIME_ENVIRONMENT_PREFLIGHT_CONFIG_INVALID");
  const controller = new AbortController();
  const maps = await runtimeEnvironment(parsed.config, process.argv[3]!, process.env, { signal: controller.signal });
  const requiredApiKeys = [
    "KERNEL_ASR_PROVIDER", "KERNEL_ASR_BASE_URL", "KERNEL_ASR_API_KEY", "KERNEL_ASR_MODEL",
    "GITHUB_ISSUE_TOKEN", "GITHUB_ISSUE_REPO_OWNER", "GITHUB_ISSUE_REPO_NAME",
    "GITHUB_ISSUE_ATTACHMENTS_BRANCH", "PLATFORM_SUPERUSER_EMAILS",
  ];
  const requiredAgentKeys = [
    "KERNEL_MODEL_PROVIDER", "KERNEL_MODEL_BASE_URL", "KERNEL_MODEL_API_KEY",
    "KERNEL_DEEP_AGENT_MODEL_ID", "DEEP_AGENT_SERVICE_INTERNAL_KEY",
  ];
  for (const key of requiredApiKeys) if (!maps.api[key]) throw new Error("RUNTIME_ENVIRONMENT_REQUIRED_API_KEY_MISSING");
  for (const key of requiredAgentKeys) if (!maps.agent[key]) throw new Error("RUNTIME_ENVIRONMENT_REQUIRED_AGENT_KEY_MISSING");
  let checkedMaps = 0;
  let checkedKeys = 0;
  for (const values of Object.values(maps)) {
    serializeRuntimeEnvironment(values);
    checkedMaps++;
    checkedKeys += Object.keys(values).length;
  }
  if (process.argv[4]) await writeFile(process.argv[4], serializeRuntimeEnvironment(maps.bootstrap), { mode: 0o600, flag: "wx" });
  process.stdout.write(`CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON=${JSON.stringify({
    ready: true,
    checkedMaps,
    checkedKeys,
    durableProfiles: {
      asrConfigured: true,
      githubIssueConfigured: true,
      platformSuperuserConfigured: true,
    },
  })}\n`);
}

main().catch(() => {
  process.stderr.write("CN_RUNTIME_ENVIRONMENT_PREFLIGHT_FAILED\n");
  process.exitCode = 1;
});
