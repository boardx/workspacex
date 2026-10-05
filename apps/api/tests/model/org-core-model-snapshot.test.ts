import {describe,it,expect,vi} from "vitest";
import type {DatabasePort} from "../../src/application/ports/database.port";
import type {OrgId} from "../../src/domain/org-id";
import {assertRunCoreModelSnapshot} from "../../src/infrastructure/model/pg-org-core-model-repository";
const org="org-snapshot" as OrgId;
const binding={modelId:"formal",modelProvider:"qwen",runtimeModelId:"runtime",configRevision:"rev-1",privateConnectionId:"connection-1"};
function db(row:unknown){return {withTenant:async(_org:OrgId,work:Function)=>work({query:async(sql:string,params:unknown[])=>{expect(sql).toContain("agent_run_core_model_snapshots");expect(sql).not.toContain("organization_core_models");expect(params).toEqual([org,"root-run"]);return {rows:row?[row]:[]};}})} as unknown as DatabasePort;}
const snapshot={model_id:"formal",model_provider:"qwen",runtime_model_id:"runtime",config_revision:"rev-1",private_connection_id:"connection-1",selected_by:"admin"};
describe("accepted core model snapshot dispatch guard",()=>{
 it("keeps existing unsnapshotted runs independent of new selection",async()=>{await expect(assertRunCoreModelSnapshot(db(null),undefined,org,"root-run")).resolves.toBeUndefined();});
 it("requires trusted resolver for snapshotted runs",async()=>{await expect(assertRunCoreModelSnapshot(db(snapshot),undefined,org,"root-run")).rejects.toThrow("CORE_MODEL_UNAVAILABLE");});
 it.each(["modelId","modelProvider","runtimeModelId","configRevision","privateConnectionId"])("rejects changed %s without substituting latest selection",async field=>{
  await expect(assertRunCoreModelSnapshot(db(snapshot),{resolve:async()=>({...binding,[field]:"changed"})},org,"root-run")).rejects.toThrow("CORE_MODEL_UNAVAILABLE");
 });
 it("rechecks accepted formal identity and actor for root and child calls",async()=>{
  const resolve=vi.fn(async()=>binding);await assertRunCoreModelSnapshot(db(snapshot),{resolve},org,"root-run");expect(resolve).toHaveBeenCalledWith(org,"formal","admin",expect.any(Object));
 });
});
