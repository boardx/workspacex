import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const Expected = z.object({ region: z.string().regex(/^(?:[a-z]{2}(?:-[a-z]+)+-\d+|cn-[a-z]+)$/),
  rdsInstanceId: z.string().regex(/^pgm-[a-zA-Z0-9]+$/), redisInstanceId: z.string().regex(/^r-[a-zA-Z0-9]+$/),
  backupRetentionDays: z.number().int().min(1).max(3650),
  postgresHost: z.string().min(1), redisHost: z.string().min(1),
});
export type ManagedDataExpected = z.infer<typeof Expected>;
export interface CloudReadOptions { timeoutMs: number; signal?: AbortSignal }
/** Must return raw JSON stdout; stderr and provider payloads never reach the report. */
export type AliyunReadExecutor = (args: readonly string[], options: CloudReadOptions) => Promise<string>;
export interface ManagedDataCheck { id: "rds" | "backup" | "redis"; passed: boolean; reason: string }
export interface ManagedDataPreflight { passed: boolean; checks: ManagedDataCheck[]; scope: "managed-data-control-plane" }
const execute = promisify(execFile);
export const aliyunReadExecutor: AliyunReadExecutor = async (args, options) => {
  const result = await execute("aliyun", [...args], { timeout: options.timeoutMs, signal: options.signal,
    maxBuffer: 1024 * 1024, encoding: "utf8", shell: false, killSignal: "SIGKILL" });
  return result.stdout;
};
const record = z.record(z.unknown());
function one(raw: unknown, container: string): Record<string, unknown> | undefined {
  const outer = record.safeParse(raw);
  if (!outer.success) return;
  const inner = record.safeParse(outer.data[container]);
  if (!inner.success || !Array.isArray(inner.data.DBInstanceAttribute) || inner.data.DBInstanceAttribute.length !== 1) return;
  const entry = record.safeParse(inner.data.DBInstanceAttribute[0]);
  return entry.success ? entry.data : undefined;
}
function rdsReason(raw: unknown, expected: ManagedDataExpected): string {
  const rds = one(raw, "Items");
  if (!rds) return "rds_response_unrecognized";
  if (rds.DBInstanceId !== expected.rdsInstanceId || rds.RegionId !== expected.region) return "rds_resource_mismatch";
  if (rds.ConnectionString !== expected.postgresHost) return "rds_endpoint_mismatch";
  if (rds.DBInstanceStatus !== "Running" || rds.DBInstanceType !== "Primary") return "rds_not_ready_primary";
  if (rds.Engine !== "PostgreSQL" || !/^16(?:\.\d+)*$/.test(String(rds.EngineVersion))) return "rds_engine_not_supported";
  if (rds.InstanceNetworkType !== "VPC" || rds.LockMode !== "Unlock") return "rds_private_access_not_ready";
  if (rds.Category !== "HighAvailability") return "rds_ha_not_proven";
  return "verified";
}
function backupReason(raw: unknown, expected: ManagedDataExpected): string {
  const result = record.safeParse(raw);
  if (!result.success || !Number.isSafeInteger(result.data.BackupRetentionPeriod)) return "backup_policy_unrecognized";
  if ((result.data.BackupRetentionPeriod as number) < expected.backupRetentionDays) return "backup_retention_insufficient";
  // Advanced policies can override classic retention fields. Fail until their semantics
  // are separately implemented instead of pretending the legacy number proves them.
  if (result.data.AdvancedBackupPolicyEnabled === true) return "advanced_backup_policy_not_supported";
  if (typeof result.data.PreferredBackupPeriod !== "string" || !result.data.PreferredBackupPeriod.split(",").every(day => ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].includes(day))) return "backup_schedule_unproven";
  return "verified";
}
function redisReason(raw: unknown, expected: ManagedDataExpected): string {
  const redis = one(raw, "Instances");
  if (!redis) return "redis_response_unrecognized";
  if (redis.InstanceId !== expected.redisInstanceId || redis.RegionId !== expected.region) return "redis_resource_mismatch";
  if (redis.ConnectionDomain !== expected.redisHost) return "redis_endpoint_mismatch";
  if (redis.InstanceStatus !== "Normal") return "redis_not_ready";
  if (redis.Engine !== "Redis" || !["Redis", "Tair"].includes(String(redis.InstanceType)) || !/^7(?:\.\d+)*$/.test(String(redis.EngineVersion))) return "redis_engine_not_supported";
  if (redis.ArchitectureType !== "standard" || redis.NodeType !== "double" || redis.ReplicationMode !== "master-slave") return "redis_ha_not_proven";
  if (redis.VpcAuthMode !== "Open" || redis.NetworkType !== "VPC") return "redis_private_auth_not_proven";
  return "verified";
}

/** Three read-only calls; timeout is one shared budget, not three sequential budgets. */
export async function verifyManagedDataPreflight(input: ManagedDataExpected, run: AliyunReadExecutor = aliyunReadExecutor,
  options: CloudReadOptions = { timeoutMs: 15000 }): Promise<ManagedDataPreflight> {
  const parsed = Expected.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300000) {
    return { passed: false, scope: "managed-data-control-plane", checks: [{ id: "rds", passed: false, reason: "invalid_managed_data_configuration" }] };
  }
  const expected = parsed.data;
  const requests = [
    { id: "rds" as const, args: ["rds", "DescribeDBInstanceAttribute", "--region", expected.region, "--DBInstanceId", expected.rdsInstanceId], inspect: rdsReason },
    { id: "backup" as const, args: ["rds", "DescribeBackupPolicy", "--region", expected.region, "--DBInstanceId", expected.rdsInstanceId, "--BackupPolicyMode", "DataBackupPolicy"], inspect: backupReason },
    { id: "redis" as const, args: ["r-kvstore", "DescribeInstanceAttribute", "--region", expected.region, "--InstanceId", expected.redisInstanceId], inspect: redisReason },
  ];
  const checks = await Promise.all(requests.map(async request => {
    let reason: string;
    try {
      if (options.signal?.aborted) throw new Error("cancelled");
      const stdout = await run(request.args, options);
      reason = request.inspect(JSON.parse(stdout) as unknown, expected);
    } catch { reason = options.signal?.aborted ? "cloud_read_cancelled" : "cloud_read_failed"; }
    return { id: request.id, passed: reason === "verified", reason };
  }));
  return { passed: checks.every(check => check.passed), scope: "managed-data-control-plane", checks };
}
