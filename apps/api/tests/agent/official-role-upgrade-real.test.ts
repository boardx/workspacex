import { createHash,randomUUID } from "node:crypto";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { agentRole,wave2Runtime } from "@repo/contracts";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { addOrgMember,asApp,asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from "../support/db";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
const ORG="org-official-role-upgrade",OTHER="org-official-role-upgrade-other",ADMIN="u-upgrade-admin",MEMBER="u-upgrade-member";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
let app:NestExpressApplication,base:string,root:string;
const auth=(user=ADMIN,org=ORG)=>({"x-kernel-test-principal":`${user}:${org}`,"content-type":"application/json"});
const post=(path:string,body:unknown,user=ADMIN,org=ORG)=>fetch(`${base}${path}`,{method:"POST",headers:auth(user,org),body:JSON.stringify(body)});
const legacyInstructions="Turn discovery signals into prioritized problem statements and PRDs, keep the roadmap traceable to evidence, and hand off sprint-ready scope without silently narrowing it.";
function legacyPack(){
 const target=buildOfficialAgentRolePack().agents.find((a)=>a.roleRef==="D003")!;
 const entry={...target,semanticVersion:"1.5.0",instructions:legacyInstructions,instructionDigest:digest(legacyInstructions),skillVersions:[]};
 // The historical fixture deliberately has no authored direct bindings.
 delete (entry as Record<string,unknown>).authoredSkillBindings;
 const raw=wave2Runtime.UnsignedOfficialAgentStarterPack.parse({schemaVersion:1,packId:"official-digitalhuman-roles",packVersion:"1.5.0",agents:[entry]});
 return {...raw,packDigest:digest(JSON.stringify(raw))};
}
beforeAll(async()=>{
 process.env.KERNEL_ALLOW_TEST_PRINCIPAL="1";process.env.KERNEL_QUIET="1";
 root=mkdtempSync(join(tmpdir(),"official-upgrade-"));process.env.AGENT_STARTER_PACK_ROOT=root;
 mkdirSync(join(root,"official-digitalhuman-roles"));writeFileSync(join(root,"official-digitalhuman-roles","1.5.0.json"),JSON.stringify(legacyPack()));
 ensureDatabase();await migrateOnce();const {createApp}=await import("../../src/main");app=await createApp();await app.listen(0,"127.0.0.1");
 const address=app.getHttpServer().address();base=`http://127.0.0.1:${typeof address==="object"&&address?address.port:0}`;
});
afterAll(async()=>{await app?.close();await resetOrgs(ORG,OTHER);rmSync(root,{recursive:true,force:true});});
beforeEach(async()=>{
 await resetOrgs(ORG,OTHER);for(const org of [ORG,OTHER]){const fixture=await seedOrg({orgId:org,projectId:`${org}-p`});await addOrgMember(org,ADMIN,"admin",fixture.teams.energy!);await addOrgMember(org,MEMBER,"consultant",fixture.teams.energy!);}
});
async function imported(){
 const response=await post("/admin/agents/starter-pack-imports",{packId:"official-digitalhuman-roles",packVersion:"1.5.0",idempotencyKey:randomUUID()});expect(response.status).toBe(201);
 const result=await response.json() as {agentIds:string[],versionIds:string[]};return {agentId:result.agentIds[0]!,expectedPublishedVersionId:result.versionIds[0]!};
}
const body=(selection:{agentId:string;expectedPublishedVersionId:string})=>({expectedOrgId:ORG,packVersion:buildOfficialAgentRolePack().packVersion,selections:[selection],idempotencyKey:randomUUID()});
async function versions(){return asApp(ORG,async(s)=>(await s.query("SELECT id,instructions,instruction_digest,skill_version_ids,pending_skill_bindings FROM agent_versions WHERE org_id=$1 ORDER BY id",[ORG])).rows);}
describe("official-role immutable selected upgrade: real PostgreSQL/HTTP",()=>{
 it("creates a new version, freezes pending refs honestly, preserves old version and disabled status, replays identical request",async()=>{
  const selection=await imported();const old=await versions();await asApp(ORG,s=>s.query("UPDATE agents SET status='disabled' WHERE org_id=$1 AND id=$2",[ORG,selection.agentId]));
  const offer=await fetch(`${base}/agents/official-role-pack/offer`,{headers:auth()});expect(offer.status).toBe(200);const offered=agentRole.OfficialRolePackOffer.parse(await offer.json());expect(offered.upgrades?.some((u)=>u.agentId===selection.agentId)).toBe(true);
  const input=body(selection);const response=await post(agentRole.operations.upgradeOfficialRoles.path,input);expect(response.status).toBe(201);
  const upgraded=agentRole.OfficialRoleUpgradeResult.parse(await response.json());expect(upgraded.agentIds).toEqual([selection.agentId]);expect(upgraded.versionIds[0]).not.toBe(selection.expectedPublishedVersionId);
  const now=await versions();expect(now).toHaveLength(2);expect(now.find((v)=>v.id===selection.expectedPublishedVersionId)).toEqual(old[0]);
  const latest=now.find((v)=>v.id===upgraded.versionIds[0])!;expect(latest.instructions).toContain("产品");expect(latest.skill_version_ids).toEqual([]);expect(latest.pending_skill_bindings.length).toBeGreaterThan(0);
  const agent=await asApp(ORG,async s=>(await s.query("SELECT status,published_version_id FROM agents WHERE org_id=$1 AND id=$2",[ORG,selection.agentId])).rows[0]);expect(agent.status).toBe("disabled");expect(agent.published_version_id).toBe(upgraded.versionIds[0]);
  const replay=await post(agentRole.operations.upgradeOfficialRoles.path,input);expect(replay.status).toBe(201);expect(await replay.json()).toEqual(upgraded);expect(await versions()).toHaveLength(2);
  const conflict=await post(agentRole.operations.upgradeOfficialRoles.path,{...input,selections:[{...selection,expectedPublishedVersionId:"different"}]});expect(conflict.status).toBe(409);expect(await versions()).toHaveLength(2);
 });
 it("rejects stale selection, nonadmin, cross-org and custom role, with zero version writes",async()=>{
  const selection=await imported();const original=await versions();const input=body(selection);
  expect((await post(agentRole.operations.upgradeOfficialRoles.path,input,MEMBER)).status).toBe(403);
  expect((await post(agentRole.operations.upgradeOfficialRoles.path,input,ADMIN,OTHER)).status).toBe(403);
  expect((await post(agentRole.operations.upgradeOfficialRoles.path,{...input,selections:[{...selection,expectedPublishedVersionId:"stale"}]})).status).toBe(409);
  await asApp(ORG,s=>s.query("UPDATE agents SET tags=ARRAY['custom'] WHERE org_id=$1 AND id=$2",[ORG,selection.agentId]));
  const offered=await fetch(`${base}/agents/official-role-pack/offer`,{headers:auth()});expect(agentRole.OfficialRolePackOffer.parse(await offered.json()).upgrades).toEqual([]);
  expect((await post(agentRole.operations.upgradeOfficialRoles.path,input)).status).toBe(409);expect(await versions()).toEqual(original);
 });
 it("requires trusted provenance rather than a matching stable name or copied instructions",async()=>{
  const selection=await imported();const original=await versions();
  await asOwner(s=>s.query("DELETE FROM agent_starter_pack_imports WHERE org_id=$1",[ORG]));
  expect((await post(agentRole.operations.upgradeOfficialRoles.path,body(selection))).status).toBe(409);expect(await versions()).toEqual(original);
 });
 it("rejects an unauthorized second selection atomically",async()=>{
  const selection=await imported();const original=await versions();
  const input={...body(selection),selections:[selection,{agentId:"other-agent",expectedPublishedVersionId:"other-version"}]};
  expect((await post(agentRole.operations.upgradeOfficialRoles.path,input)).status).toBe(409);expect(await versions()).toEqual(original);
 });
});
