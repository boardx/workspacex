import { readFile } from "node:fs/promises";
import { validateDeploymentConfig } from "./config.js";
import { verifyManagedDataPreflight, aliyunReadExecutor } from "./managed-data-preflight.js";

async function main() {
  if (process.argv.length !== 3) throw new Error("MANAGED_DATA_PREFLIGHT_ARGUMENTS_INVALID");
  const parsed = validateDeploymentConfig(JSON.parse(await readFile(process.argv[2]!, "utf8")) as unknown);
  if (!parsed.ok || parsed.config.environment.profile !== "production") throw new Error("MANAGED_DATA_PREFLIGHT_CONFIG_INVALID");
  const environment = parsed.config.environment;
  const roleName = process.env.WSX_ECS_RAM_ROLE_NAME;
  if (!roleName || !/^[A-Za-z0-9._-]+$/.test(roleName)) throw new Error("MANAGED_DATA_PREFLIGHT_ROLE_INVALID");
  const result = await verifyManagedDataPreflight({
    region: environment.regionId,
    rdsInstanceId: environment.rdsInstanceId,
    redisInstanceId: environment.redisInstanceId,
    backupRetentionDays: environment.backupRetentionDays,
    postgresHost: new URL(`postgresql://${JSON.parse(await readFile(environment.databaseSecretRef.slice(5), "utf8")).host}`).hostname,
    redisHost: new URL(`redis://${JSON.parse(await readFile(environment.redisSecretRef.slice(5), "utf8")).host}`).hostname,
    ...(environment.rdsTlsException ? { rdsTlsException: environment.rdsTlsException } : {}),
  }, (args, options) => aliyunReadExecutor([...args, "--mode", "EcsRamRole", "--ram-role-name", roleName], options));
  process.stdout.write(`CN_MANAGED_DATA_PREFLIGHT_JSON=${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 1;
}

main().catch(() => {
  process.stderr.write("CN_MANAGED_DATA_PREFLIGHT_FAILED\n");
  process.exitCode = 1;
});
