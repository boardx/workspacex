import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const Expected = z.object({ region: z.string().regex(/^(?:[a-z]{2}(?:-[a-z]+)+-\d+|cn-[a-z]+)$/),
  rdsInstanceId: z.string().regex(/^pgm-[a-zA-Z0-9]+$/), redisInstanceId: z.string().regex(/^r-[a-zA-Z0-9]+$/),
  backupRetentionDays: z.number().int().min(1).max(3650),
  postgresHost: z.string().min(1), redisHost: z.string().min(1),
  rdsTlsException: z.object({ kind: z.literal("aliyun-postgresql-serverless-no-tls"),
    allowedCidrs: z.array(z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/).refine(value => {
      const [address, prefix] = value.split("/");
      return address!.split(".").every(octet => Number(octet) <= 255) && Number(prefix) <= 32 && value !== "0.0.0.0/0";
    })).min(1).max(32),
  }).strict().optional(),
});
export type ManagedDataExpected = z.infer<typeof Expected>;
export interface CloudReadOptions { timeoutMs: number; signal?: AbortSignal }
/** Must return raw JSON stdout; stderr and provider payloads never reach the report. */
export type AliyunReadExecutor = (args: readonly string[], options: CloudReadOptions) => Promise<string>;
export interface ManagedDataCheck { id: "rds" | "rds-tls" | "rds-network" | "backup" | "redis" | "redis-tls"; passed: boolean; reason: string }
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
  if (expected.rdsTlsException) {
    if (rds.Category !== "serverless_standard") return "rds_serverless_ha_not_proven";
    if (!String(rds.DBInstanceClass).toLowerCase().includes("serverless")) return "rds_tls_exception_not_serverless";
  } else if (rds.Category !== "HighAvailability") return "rds_ha_not_proven";
  return "verified";
}
function backupReason(raw: unknown, expected: ManagedDataExpected): string {
  const result = record.safeParse(raw);
  if (!result.success || !Number.isSafeInteger(result.data.BackupRetentionPeriod)) return "backup_policy_unrecognized";
  if ((result.data.BackupRetentionPeriod as number) < expected.backupRetentionDays) return "backup_retention_insufficient";
  // Advanced policies can override classic retention fields. Fail until their semantics
  // are separately implemented instead of pretending the legacy number proves them.
  if (result.data.AdvancedBackupPolicyEnabled === true) return "advanced_backup_policy_not_supported";
  if (result.data.AdvancedBackupPolicyEnabled !== false) return "backup_policy_mode_unproven";
  if (typeof result.data.PreferredBackupPeriod !== "string" || !result.data.PreferredBackupPeriod.split(",").every(day => ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].includes(day))) return "backup_schedule_unproven";
  return "verified";
}
function rdsTlsReason(raw: unknown, expected: ManagedDataExpected): string {
  const result = record.safeParse(raw);
  if (!result.success) return "rds_tls_response_unrecognized";
  if (expected.rdsTlsException) {
    if (result.data.SSLEnabled !== "off") return "rds_tls_exception_state_mismatch";
    return "serverless_tls_exception_verified";
  }
  if (result.data.SSLEnabled !== "on") return "rds_tls_not_enabled";
  if (result.data.ConnectionString !== expected.postgresHost) return "rds_tls_endpoint_mismatch";
  return "verified";
}
function rdsNetworkReason(raw: unknown, expected: ManagedDataExpected): string {
  if (!expected.rdsTlsException) return "verified";
  const outer = record.safeParse(raw), expectedCidrs = [...new Set(expected.rdsTlsException.allowedCidrs)].sort();
  if (!outer.success) return "rds_whitelist_response_unrecognized";
  const container = record.safeParse(outer.data.Items);
  if (!container.success) return "rds_whitelist_response_unrecognized";
  const items = container.data.DBInstanceIPArray;
  if (!Array.isArray(items) || items.length < 1) return "rds_whitelist_response_unrecognized";
  const actual = new Set<string>();
  for (const item of items) {
    const parsed = record.safeParse(item);
    // PostgreSQL cloud-disk instances are fixed to general allowlist mode MIX.
    // Hidden groups are provider-managed service access, so they must remain safe
    // but are not part of the application's exact source-address contract.
    if (!parsed.success || parsed.data.WhitelistNetworkType !== "MIX" || typeof parsed.data.SecurityIPList !== "string") return "rds_network_constraint_unproven";
    const cidrs = parsed.data.SecurityIPList.split(",").map(value => value.trim()).filter(Boolean)
      .map(value => value.includes("/") ? value : `${value}/32`);
    if (cidrs.includes("0.0.0.0/0")) return "rds_whitelist_mismatch";
    if (parsed.data.DBInstanceIPArrayAttribute !== "hidden") for (const cidr of cidrs) actual.add(cidr);
  }
  if (JSON.stringify([...actual].sort()) !== JSON.stringify(expectedCidrs)) return "rds_whitelist_mismatch";
  return "serverless_tls_exception_network_verified";
}
function redisReason(raw: unknown, expected: ManagedDataExpected): string {
  const redis = one(raw, "Instances");
  if (!redis) return "redis_response_unrecognized";
  if (redis.InstanceId !== expected.redisInstanceId || redis.RegionId !== expected.region) return "redis_resource_mismatch";
  if (redis.ConnectionDomain !== expected.redisHost) return "redis_endpoint_mismatch";
  if (redis.InstanceStatus !== "Normal") return "redis_not_ready";
  if (redis.Engine !== "Redis" || !["Redis", "Tair"].includes(String(redis.InstanceType)) || !/^7(?:\.\d+)*$/.test(String(redis.EngineVersion))) return "redis_engine_not_supported";
  if (redis.ArchitectureType !== "standard" || redis.NodeType !== "double" || redis.ReplicationMode !== "master-slave") return "redis_ha_not_proven";
  // Alibaba Cloud defines Open as password authentication required. Close turns
  // authentication off and enables password-free VPC access.
  if (redis.VpcAuthMode !== "Open" || redis.NetworkType !== "VPC") return "redis_private_auth_not_proven";
  return "verified";
}
function redisTlsReason(raw: unknown): string {
  const result = record.safeParse(raw);
  if (!result.success) return "redis_tls_response_unrecognized";
  if (result.data.SSLEnabled !== "Enable") return "redis_tls_not_enabled";
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
    { id: "rds-tls" as const, args: ["rds", "DescribeDBInstanceSSL", "--region", expected.region, "--DBInstanceId", expected.rdsInstanceId], inspect: rdsTlsReason },
    { id: "rds-network" as const, args: ["rds", "DescribeDBInstanceIPArrayList", "--region", expected.region, "--DBInstanceId", expected.rdsInstanceId], inspect: rdsNetworkReason },
    { id: "backup" as const, args: ["rds", "DescribeBackupPolicy", "--region", expected.region, "--DBInstanceId", expected.rdsInstanceId, "--BackupPolicyMode", "DataBackupPolicy"], inspect: backupReason },
    { id: "redis" as const, args: ["r-kvstore", "DescribeInstanceAttribute", "--region", expected.region, "--InstanceId", expected.redisInstanceId], inspect: redisReason },
    { id: "redis-tls" as const, args: ["r-kvstore", "DescribeInstanceSSL", "--region", expected.region, "--InstanceId", expected.redisInstanceId], inspect: redisTlsReason },
  ];
  const checks = await Promise.all(requests.map(async request => {
    let reason: string;
    try {
      if (options.signal?.aborted) throw new Error("cancelled");
      const stdout = await run(request.args, options);
      if (options.signal?.aborted) throw new Error("cancelled");
      reason = request.inspect(JSON.parse(stdout) as unknown, expected);
    } catch { reason = options.signal?.aborted ? "cloud_read_cancelled" : "cloud_read_failed"; }
    return { id: request.id, passed: ["verified", "serverless_tls_exception_verified", "serverless_tls_exception_network_verified"].includes(reason), reason };
  }));
  return { passed: checks.every(check => check.passed), scope: "managed-data-control-plane", checks };
}
