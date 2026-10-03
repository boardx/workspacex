import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { runMaintenanceRelease, MaintenanceRecoveryRequired, MaintenanceWriteStateUnknown, type MaintenanceRequest, type MaintenanceOperations } from "../src/cn-maintenance-release";
const request: MaintenanceRequest = { sourceRevision: "9".repeat(40), baselineRevision: "b".repeat(40), migrationPlanSha256: "a".repeat(64), attemptId: "local-order-test", maintenanceOptIn: "stop-all-writes-and-require-database-recovery" };
function fixture(fail?: string) {
  const calls: string[] = [];
  const step = (name: string) => async () => { calls.push(name); if(name===fail) throw new Error("local injected failure"); };
  const ops: MaintenanceOperations = { prepareOffline: step("prepare"), acquireReleaseLock: async () => { calls.push("lock"); return step("unlock"); }, verifyThreeDatabaseRecovery: step("recovery"), persistMaintenanceHold: step("hold"), blockAllWrites: step("block"), verifyAllWritersDrained: step("drain"), migrateExactPlan: step("migrate"), verifyProductionDynamic: step("dynamic"), verifyPreactivate: step("preactivate"), activate: step("activate"), verifyAcceptance: step("acceptance"), resumeWrites: step("resume"), verifyWritesResumed: step("resumed-readback"), clearMaintenanceHold: step("clear-hold"), verifyWritesBlocked: step("blocked-readback"), recordWriteStateReconciliationRequired: step("reconcile-required"), recordDatabaseRecoveryRequired: step("restore-required") };
  return { calls, ops };
}
describe("maintenance ordering (local adapters, not live recovery evidence)", () => {
  it("holds release lock while preparing offline, migration precedes production dynamic, writes resume last", async () => {
    const f=fixture(); await runMaintenanceRelease(request,f.ops);
    expect(f.calls).toEqual(["lock","prepare","recovery","hold","block","drain","migrate","dynamic","preactivate","activate","acceptance","resume","resumed-readback","clear-hold","unlock"]);
  });
  it("rejects implicit maintenance", async () => { const f=fixture(); await expect(runMaintenanceRelease({...request,maintenanceOptIn: undefined} as unknown as MaintenanceRequest,f.ops)).rejects.toThrow("OPT_IN"); expect(f.calls).toEqual([]); });
  it("rejects missing real recovery adapter before any preparation or writes", async () => { const f=fixture(); delete f.ops.verifyThreeDatabaseRecovery; await expect(runMaintenanceRelease(request,f.ops)).rejects.toThrow("CAPABILITY_MISSING:verifyThreeDatabaseRecovery"); expect(f.calls).toEqual([]); });
  it("rejects invalid identity", async () => { const f=fixture(); await expect(runMaintenanceRelease({...request,sourceRevision:"main"},f.ops)).rejects.toThrow("IDENTITY"); expect(f.calls).toEqual([]); });
  it("unverified recovery prevents blocking and migration", async () => { const f=fixture("recovery"); await expect(runMaintenanceRelease(request,f.ops)).rejects.toThrow("injected"); expect(f.calls).toEqual(["lock","prepare","recovery","unlock"]); });
  for (const failure of ["hold","block","drain","migrate","dynamic","preactivate","activate","acceptance","resume"]) it(`keeps writes held and requires database recovery on ${failure} failure`,async()=>{
    const f=fixture(failure); await expect(runMaintenanceRelease(request,f.ops)).rejects.toBeInstanceOf(MaintenanceRecoveryRequired);
    expect(f.calls.at(-2)).toBe("restore-required"); expect(f.calls.at(-1)).toBe("unlock");
    if(failure!=="resume") expect(f.calls).not.toContain("resume");
    if(["hold","block","drain"].includes(failure)) expect(f.calls).not.toContain("migrate");
  });
});

it("installed entry rejects without a production recovery adapter", () => {
 const result=spawnSync(process.execPath,[".harness/scripts/vm/cn-maintenance-release-admission.mjs"],{cwd:new URL("../../../",import.meta.url).pathname,encoding:"utf8"});
 expect(result.status).toBe(1); expect(result.stderr).toContain("PRODUCTION_THREE_DATABASE_RECOVERY_ADAPTER_NOT_IMPLEMENTED");
});

it("failed lock cleanup cannot mask required database recovery", async () => {
 const f=fixture("migrate"); f.ops.acquireReleaseLock=async()=>async()=>{throw new Error("unlock failure");};
 await expect(runMaintenanceRelease(request,f.ops)).rejects.toBeInstanceOf(MaintenanceRecoveryRequired);
 expect(f.calls).not.toContain("resume");
});

it("unknown write resumption retains hold and lock and never claims writes held",async()=>{
 const f=fixture("resume"); f.ops.verifyWritesBlocked=async()=>{f.calls.push("blocked-readback");throw new Error("writes may be live");};
 await expect(runMaintenanceRelease(request,f.ops)).rejects.toBeInstanceOf(MaintenanceWriteStateUnknown);
 expect(f.calls).toContain("reconcile-required"); expect(f.calls).not.toContain("clear-hold"); expect(f.calls).not.toContain("restore-required"); expect(f.calls).not.toContain("unlock");
});
it("independent resumed readback failure leaves durable hold untouched",async()=>{
 const f=fixture("resumed-readback"); f.ops.verifyWritesBlocked=async()=>{throw new Error("not proven blocked");};
 await expect(runMaintenanceRelease(request,f.ops)).rejects.toBeInstanceOf(MaintenanceWriteStateUnknown); expect(f.calls).not.toContain("clear-hold"); expect(f.calls).not.toContain("unlock");
});
