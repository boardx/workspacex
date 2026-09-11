import { describe, expect, it, vi } from "vitest";
import { verifyManagedDataPreflight } from "../src/managed-data-preflight";
const expected = { region: "cn-hangzhou", rdsInstanceId: "pgm-test", redisInstanceId: "r-test", backupRetentionDays: 7, postgresHost: "pg.internal", redisHost: "redis.internal" };
function fixtures() {
  return {
    rds: { Items: { DBInstanceAttribute: [{ DBInstanceId: "pgm-test", RegionId: "cn-hangzhou", ConnectionString: "pg.internal", DBInstanceStatus: "Running", DBInstanceType: "Primary", Engine: "PostgreSQL", EngineVersion: "16.0", Category: "HighAvailability", InstanceNetworkType: "VPC", LockMode: "Unlock" }] } },
    backup: { BackupRetentionPeriod: 7, PreferredBackupPeriod: "Monday,Wednesday,Friday" },
    redis: { Instances: { DBInstanceAttribute: [{ InstanceId: "r-test", RegionId: "cn-hangzhou", ConnectionDomain: "redis.internal", InstanceStatus: "Normal", Engine: "Redis", EngineVersion: "7.0", InstanceType: "Redis", ArchitectureType: "standard", ReplicationMode: "master-slave", NodeType: "double", VpcAuthMode: "Open", NetworkType: "VPC" }] } },
  };
}
function executor(data = fixtures()) { return vi.fn(async (args: readonly string[]) => JSON.stringify(args[1] === "DescribeBackupPolicy" ? data.backup : args[0] === "rds" ? data.rds : data.redis)); }
describe("managed data control-plane preflight", () => {
  it("uses only documented read-only operations with bounded argv execution", async () => {
    const run = executor(); const result = await verifyManagedDataPreflight(expected,run,{ timeoutMs: 1234 });
    expect(result.passed).toBe(true); expect(result.scope).toBe("managed-data-control-plane");
    expect(run).toHaveBeenCalledWith(["rds","DescribeDBInstanceAttribute","--region","cn-hangzhou","--DBInstanceId","pgm-test"], {timeoutMs:1234});
    expect(run.mock.calls.map(([args]) => args[1]).sort()).toEqual(["DescribeBackupPolicy","DescribeDBInstanceAttribute","DescribeInstanceAttribute"]);
    expect(JSON.stringify(result)).not.toContain("pg.internal");
  });
  it.each([
    ["DBInstanceId","pgm-other","rds_resource_mismatch"], ["RegionId","cn-shanghai","rds_resource_mismatch"],
    ["ConnectionString","other.internal","rds_endpoint_mismatch"], ["DBInstanceStatus","Creating","rds_not_ready_primary"],
    ["DBInstanceType","Readonly","rds_not_ready_primary"], ["Engine","MySQL","rds_engine_not_supported"],
    ["EngineVersion","17.0","rds_engine_not_supported"], ["Category","Basic","rds_ha_not_proven"], ["LockMode","ManualLock","rds_private_access_not_ready"],
  ])("rejects RDS %s=%s", async (key,value,reason) => {
    const data = fixtures(); Object.assign(data.rds.Items.DBInstanceAttribute[0]!, {[key]:value});
    expect((await verifyManagedDataPreflight(expected,executor(data))).checks[0]?.reason).toBe(reason);
  });
  it.each([
    ["NodeType","single","redis_ha_not_proven"], ["NodeType",undefined,"redis_ha_not_proven"],
    ["ArchitectureType","cluster","redis_ha_not_proven"], ["ReplicationMode","unknown","redis_ha_not_proven"],
    ["InstanceStatus","Creating","redis_not_ready"], ["RegionId","cn-shanghai","redis_resource_mismatch"],
    ["InstanceId","r-other","redis_resource_mismatch"], ["ConnectionDomain","other","redis_endpoint_mismatch"],
    ["VpcAuthMode","Close","redis_private_auth_not_proven"], ["EngineVersion","6.0","redis_engine_not_supported"],
  ])("rejects unproven Redis %s=%s", async (key,value,reason) => {
    const data = fixtures(); Object.assign(data.redis.Instances.DBInstanceAttribute[0]!, {[key]:value,AvailabilityValue:"100%"});
    const result = await verifyManagedDataPreflight(expected,executor(data)); expect(result.passed).toBe(false); expect(result.checks[2]?.reason).toBe(reason);
  });
  it("rejects insufficient backup retention", async () => {
    const data=fixtures(); data.backup.BackupRetentionPeriod=6;
    expect((await verifyManagedDataPreflight(expected,executor(data))).checks[1]?.reason).toBe("backup_retention_insufficient");
  });
  it("rejects absent schedule and advanced-policy ambiguity", async () => {
    const data=fixtures(); data.backup.PreferredBackupPeriod="";
    expect((await verifyManagedDataPreflight(expected,executor(data))).checks[1]?.reason).toBe("backup_schedule_unproven");
    Object.assign(data.backup,{PreferredBackupPeriod:"Monday",AdvancedBackupPolicyEnabled:true});
    expect((await verifyManagedDataPreflight(expected,executor(data))).checks[1]?.reason).toBe("advanced_backup_policy_not_supported");
  });
  it("never leaks CLI stderr, credentials or raw malformed payloads", async () => {
    const result = await verifyManagedDataPreflight(expected,async () => {throw new Error("AccessKeySecret=PRIVATE");});
    expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(result.checks.every(c => !c.passed)).toBe(true);
    expect((await verifyManagedDataPreflight(expected,async () => "not JSON PRIVATE")).passed).toBe(false);
  });
  it("rejects multiple/absent resource rows rather than picking a convenient row", async () => {
    const data=fixtures(); data.rds.Items.DBInstanceAttribute.push(data.rds.Items.DBInstanceAttribute[0]!);
    expect((await verifyManagedDataPreflight(expected,executor(data))).checks[0]?.reason).toBe("rds_response_unrecognized");
  });
  it("rejects invalid identifiers without invoking a process", async () => {
    const run=executor(); expect((await verifyManagedDataPreflight({...expected,rdsInstanceId:"--help"},run)).passed).toBe(false); expect(run).not.toHaveBeenCalled();
  });
  it("honors cancellation without invoking a process", async () => {
    const controller=new AbortController(); controller.abort(); const run=executor();
    expect((await verifyManagedDataPreflight(expected,run,{timeoutMs:100,signal:controller.signal})).checks[0]?.reason).toBe("cloud_read_cancelled"); expect(run).not.toHaveBeenCalled();
  });
});
