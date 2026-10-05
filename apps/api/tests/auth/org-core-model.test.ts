import {beforeEach,describe,expect,it,vi} from "vitest";
import type {DatabasePort} from "../../src/application/ports/database.port";
import type {IdentityRepository} from "../../src/application/identity/ports";
import type {OrgId} from "../../src/domain/org-id";
import {readOrgCoreModel,setOrgCoreModel} from "../../src/application/model/org-core-model";
import {PgOrgCoreModelRepository} from "../../src/infrastructure/model/pg-org-core-model-repository";
import {PgChatMessageCommandRepository} from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import {DEFAULT_AGENT_STABLE_NAME} from "../../src/application/agent/ensure-default-agent";
const orgId="core-org" as OrgId;
const binding={modelId:"formal-text",modelProvider:"dashscope",runtimeModelId:"runtime-text",configRevision:"price-v1",privateConnectionId:"private-binding"};
const row={version:1,model_id:binding.modelId,model_provider:binding.modelProvider,runtime_model_id:binding.runtimeModelId,config_revision:binding.configRevision,private_connection_id:binding.privateConnectionId,updated_by:"admin",reason:"Reviewed"};
const identity={findOrgMembership:vi.fn()} as unknown as IdentityRepository;
function fixture(current:typeof row|undefined=undefined,kind="organization"){
 const query=vi.fn(async(sql:string,_params?:readonly unknown[])=>({rows:sql.startsWith("SELECT kind FROM organizations")?[{kind}]:sql.startsWith("SELECT version,")?current?[current]:[]:[]}));
 const db={withTenant:async(org:OrgId,work:(s:unknown)=>Promise<unknown>)=>{expect(org).toBe(orgId);return work({query});},withoutTenant:async()=>{throw new Error("NO_TENANT");},close:async()=>{}} as DatabasePort;
 const resolve=vi.fn(async()=>binding);
 return {query,db,resolve,repository:new PgOrgCoreModelRepository(db,{resolve},()=>identity)};
}
beforeEach(()=>{vi.mocked(identity.findOrgMembership).mockResolvedValue({orgRole:"admin"} as never);});
describe("organization core-model settings",()=>{
 it("keeps unconfigured selection explicit",async()=>{const f=fixture();expect(await readOrgCoreModel({identity,repository:f.repository},orgId,"admin")).toEqual({version:0,selection:null,updatedBy:null,reason:null});});
 it("rechecks trusted deployment in the same transaction and appends audit",async()=>{
  const f=fixture();const result=await setOrgCoreModel({identity,repository:f.repository},orgId,"admin",{expectedVersion:0,modelId:binding.modelId,reason:"Reviewed"});
  expect(result).toMatchObject({version:1,selection:binding});expect(f.resolve).toHaveBeenCalledWith(orgId,binding.modelId,"admin",expect.any(Object));
  expect(f.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO"))).toHaveLength(2);
 });
 it("rejects nonadmin before settings disclosure",async()=>{const f=fixture();vi.mocked(identity.findOrgMembership).mockResolvedValue(null);await expect(readOrgCoreModel({identity,repository:f.repository},orgId,"outsider")).rejects.toThrow("NOT_ORG_ADMIN");expect(f.query).not.toHaveBeenCalled();});
 it("rejects a role revoked between use case and atomic write",async()=>{const f=fixture();vi.mocked(identity.findOrgMembership).mockResolvedValueOnce({orgRole:"admin"} as never).mockResolvedValueOnce(null);await expect(setOrgCoreModel({identity,repository:f.repository},orgId,"admin",{expectedVersion:0,modelId:binding.modelId,reason:"Reviewed"})).rejects.toThrow("NOT_ORG_ADMIN");expect(f.resolve).not.toHaveBeenCalled();});
 it.each(["platform","personal-local"])("rejects container kind %s",async kind=>{const f=fixture(undefined,kind);await expect(f.repository.set(orgId,{expectedVersion:0,modelId:binding.modelId,actorId:"admin",reason:"Reviewed"})).rejects.toThrow("ORGANIZATION_REQUIRED");expect(f.resolve).not.toHaveBeenCalled();});
 it("does not overwrite a changed version",async()=>{const f=fixture(row);await expect(f.repository.set(orgId,{expectedVersion:0,modelId:binding.modelId,actorId:"admin",reason:"Reviewed"})).rejects.toThrow("VERSION_CHANGED");expect(f.resolve).not.toHaveBeenCalled();});
 it("unverified catalog entry cannot become a core model",async()=>{const f=fixture();f.resolve.mockResolvedValue(null as never);await expect(f.repository.set(orgId,{expectedVersion:0,modelId:binding.modelId,actorId:"admin",reason:"Reviewed"})).rejects.toThrow("CORE_MODEL_UNAVAILABLE");expect(f.query.mock.calls.some(([sql])=>sql.startsWith("INSERT INTO"))).toBe(false);});
});
function chatFixture(stableName:string|null=DEFAULT_AGENT_STABLE_NAME,replay=false){
 const input={projectId:null,threadId:"thread",actorId:"member",clientMessageId:"client",text:"hello",selectedAgentId:"agent",messageId:"message",runId:"new-run",snapshot:{agentId:"agent",agentVersionId:"version",skillVersionIds:[],modelProvider:"deep-agent",modelId:"deployment-default",instructions:"trusted",skillScope:"general" as const}};
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith("SELECT stable_name")?[{stable_name:stableName}]:sql.startsWith("SELECT kind")?[{kind:"organization"}]:sql.startsWith("SELECT version,")?[row]:sql.includes("RETURNING created_at")?[{created_at:new Date()}]:replay&&sql.includes("FROM chat_messages m JOIN agent_runs")?[{id:"message",thread_id:"thread",author_id:"member",body:"hello",client_message_id:"client",skill_scope:"general",requested_agent_id:"agent",created_at:new Date(),agent_run_id:"old-run",status:"succeeded"}]:[]}));
 const db={withTenant:async(_org:OrgId,work:(s:unknown)=>Promise<unknown>)=>work({query})} as DatabasePort;
 const resolve=vi.fn(async()=>binding);
 return {input,query,resolve,repository:new PgChatMessageCommandRepository(db,{resolve})};
}
describe("new system-default run core snapshot",()=>{
 it("freezes organization runtime model and audited binding without mutating the agent version",async()=>{
  const f=chatFixture();await f.repository.accept(orgId,f.input);
  const run=f.query.mock.calls.find(([sql])=>sql.includes("INSERT INTO agent_runs"))!;
  const index=f.query.mock.calls.indexOf(run);const params=(f.query.mock.calls as unknown as [string,readonly unknown[]][])[index]![1];
  expect(params[7]).toBe("deep-agent");expect(params[8]).toBe(binding.runtimeModelId);
  expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO agent_run_core_model_snapshots"))).toBe(true);
  expect(f.query.mock.calls.some(([sql])=>sql.includes("UPDATE agent_versions"))).toBe(false);
 });
 it("compatible legacy default keeps its execution provider and freezes core runtime",async()=>{
  const f=chatFixture();f.input.snapshot.modelProvider=binding.modelProvider;await f.repository.accept(orgId,f.input);
  const params=(f.query.mock.calls as unknown as [string,readonly unknown[]][]).find(([sql])=>sql.includes("INSERT INTO agent_runs"))![1];
  expect(params[7]).toBe(binding.modelProvider);expect(params[8]).toBe(binding.runtimeModelId);
 });
 it("incompatible legacy default refuses instead of changing execution runtimes",async()=>{
  const f=chatFixture();f.input.snapshot.modelProvider="other-vendor";await expect(f.repository.accept(orgId,f.input)).rejects.toThrow("CORE_MODEL_UNAVAILABLE");
  expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO agent_runs"))).toBe(false);
 });
 it("retains explicit pins of other published agents",async()=>{const f=chatFixture("custom-agent");await f.repository.accept(orgId,f.input);expect(f.resolve).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes("agent_run_core_model_snapshots"))).toBe(false);});
 it("message replay never rereads or changes a historical core selection",async()=>{const f=chatFixture(DEFAULT_AGENT_STABLE_NAME,true);await f.repository.accept(orgId,f.input);expect(f.resolve).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO agent_runs"))).toBe(false);});
 it("revoked deployment/changed immutable price blocks a new default run",async()=>{const f=chatFixture();f.resolve.mockResolvedValue({...binding,configRevision:"new-price"});await expect(f.repository.accept(orgId,f.input)).rejects.toThrow("CORE_MODEL_UNAVAILABLE");expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO agent_runs"))).toBe(false);});
});
