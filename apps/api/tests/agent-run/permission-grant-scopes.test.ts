/** Application delegation tests; durable atomic scope/rollback behavior is tested below against PostgreSQL. */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";

async function makeDeps(overrides: {
  status: string;
  requeueWins?: boolean;
  pendingToolName?: string | null;
}) {
  vi.resetModules();
  vi.doMock("../../src/application/chat/resolve-visibility", () => ({
    resolveVisibility: async () => ({
      kind: "allow",
      actor: { projectRole: "member" },
      thread: { archived: false },
      base: { requesterId: "u1" },
    }),
    AuthzUnavailableError: class extends Error {},
  }));
  vi.doMock("../../src/application/security/permission-filter", () => ({
    discloseDecided: (g: { value: unknown }) => ({ kind: "disclosed", payload: g.value }),
    isDisclosed: (d: { kind: string }) => d.kind === "disclosed",
  }));
  const mod = await import("../../src/application/agent-run/decide-tool-permission");

  const calls: string[] = [];
  let status = overrides.status;
  const pendingApproval = overrides.pendingToolName === undefined
    ? { permissionRequestId: "c1", toolName: "call_skill", argsSummary: "{}" }
    : overrides.pendingToolName === null ? null : { permissionRequestId: "c1", toolName: overrides.pendingToolName, argsSummary: "{}" };
  const runs = {
    findLocator: async () => ({ threadId: "t", projectId: null }),
    readRun: async () => ({ value: { runId: "r1", status, error: null, pendingApproval } }),
    decidePermissionRequest: async (org: typeof ORG, run: string, request: string, decision: string, user: string) => {
      calls.push(decision === "deny" ? "deny-requeue" : "approve-requeue");
      expect(request).toBe("c1");
      if (overrides.requeueWins === false) return false;
      if(decision === "run") await grants.grantForRun(org,run,"call_skill");
      if(decision === "forever") await grants.grantStanding(org,"call_skill",user);
      status = "queued";
      return true;
    },
  };
  const grants = createInMemoryToolPermissionGrantStore();
  let kicked = 0;
  const deps = { runs, grants, kick: () => { kicked += 1; } } as never;
  return { mod, deps, calls, grants, kicked: () => kicked };
}

const ORG = toOrgId("org-f06-grant-scopes");

describe("Phase 14 F06 -- decideToolPermission 四选一：授权粒度各自的生效范围", () => {
  it("once：atomic decision + kick，不落任何授权记录", async () => {
    const { mod, deps, calls, grants, kicked } = await makeDeps({ status: "awaiting_tool_permission" });
    const out = await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", toolCallId: "c1", decision: "once",
    });
    expect(calls).toEqual(["approve-requeue"]);
    expect(kicked()).toBe(1);
    expect(out.status).toBe("queued");
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
    expect(await grants.hasGrant(ORG, "some-other-run", "call_skill")).toBe(false);
  });

  it("run：atomic decision + 落一条本 run 内的授权记录，不越界到另一个 run", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission" });
    await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", toolCallId: "c1", decision: "run",
    });
    expect(calls).toEqual(["approve-requeue"]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(true);
    // I-4：授权粒度互不越界——"本次 run 内"不该被另一个 run 读到。
    expect(await grants.hasGrant(ORG, "r2-never-decided-here", "call_skill")).toBe(false);
  });

  it("forever：atomic decision + 落一条组织级授权记录，跨任意 run 生效（R12）", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission" });
    await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", toolCallId: "c1", decision: "forever",
    });
    expect(calls).toEqual(["approve-requeue"]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(true);
    // 跨 run 持久化生效——换一个从未在这次决策里出现过的 run 依然命中。
    expect(await grants.hasGrant(ORG, "a-totally-different-run", "call_skill")).toBe(true);
  });

  it("deny：atomic deny（不是 failRun）+ kick，不落任何授权记录", async () => {
    const { mod, deps, calls, grants, kicked } = await makeDeps({ status: "awaiting_tool_permission" });
    const out = await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", toolCallId: "c1", decision: "deny",
    });
    expect(calls).toEqual(["deny-requeue"]);
    expect(kicked()).toBe(1);
    // R3 步骤 6：拒绝也重新入队继续跑，不是终态失败——status 落回 queued，不是 failed。
    expect(out.status).toBe("queued");
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
  });

  it("run 不在 awaiting_tool_permission 时任何决策都拒绝——不是随时可以裁决的开关", async () => {
    const { mod, deps, calls } = await makeDeps({ status: "running" });
    await expect(
      mod.decideToolPermission(deps, { userId: "u1", orgId: ORG, runId: "r1", toolCallId: "c1", decision: "forever" }),
    ).rejects.toBeInstanceOf(mod.RunNotAwaitingToolPermissionError);
    expect(calls).toEqual([]);
  });

  it("竞态输了（已被别处裁决）→ 抛冲突，不假装生效、不静默补落授权记录", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission", requeueWins: false });
    await expect(
      mod.decideToolPermission(deps, { userId: "u1", orgId: ORG, runId: "r1", toolCallId: "c1", decision: "forever" }),
    ).rejects.toBeInstanceOf(mod.RunNotAwaitingToolPermissionError);
    expect(calls).toEqual(["approve-requeue"]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
  });
});


import { beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { ensureDatabase, migrateOnce, seedOrg, addOrgMember, asApp, resetOrgs } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgToolPermissionGrantRepository } from "../../src/infrastructure/agent-run/pg-tool-permission-grant-repository";
const scopes:ReturnType<typeof toOrgId>[]=[];let database:PgDatabase;
beforeAll(async()=>{await ensureDatabase();await migrateOnce();database=new PgDatabase(appConfig());});
afterAll(async()=>{await database?.close();await resetOrgs(...scopes);});
async function seedAtomic(scope: ReturnType<typeof toOrgId>, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
  await addOrgMember(scope,"intruder","consultant",null);
  await addChatThread({ orgId: scope, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: scope, id: `message-${scope}`, threadId: thread, body: "parent", authorId: "actor" });
  await asApp(scope, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,'t042','T042','enabled','actor',now(),now())`, [agent,scope]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
      skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','actor',now(),now())`,
    [version,scope,agent,createHash("sha256").update("pinned instructions").digest("hex")]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','queued')`,
    [id,scope,thread,`message-${scope}`,agent,version]);
  });
}

async function pendingAtomic(){
 const scope=toOrgId('grant-atomic-'+randomUUID()),run='run-'+randomUUID(),request=randomUUID();scopes.push(scope);
 await seedAtomic(scope,run);
 await asApp(scope,c=>c.query("UPDATE agent_runs SET status='running',started_at=now() WHERE id=$1",[run]));
 await asApp(scope,c=>c.query("UPDATE agent_runs SET status='awaiting_tool_permission',pending_tool_name='execute',pending_permission_request_id=$2 WHERE id=$1",[run,request]));
 return {scope,run,request,repo:new PgAgentRunRepository(database),grants:new PgToolPermissionGrantRepository(database)};
}
describe('real PostgreSQL atomic permission scope and CAS',()=>{
 it.each(['once','run','forever','deny'] as const)('%s commits decision and exact grant scope together',async decision=>{
  const {scope,run,request,repo,grants}=await pendingAtomic();
  expect(await repo.decidePermissionRequest(scope,run,request,decision,'actor')).toBe(true);
  expect(await grants.hasGrant(scope,run,'execute')).toBe(decision==='run'||decision==='forever');
  expect(await grants.hasGrant(scope,'another-run','execute')).toBe(decision==='forever');
  expect(await grants.hasGrant(toOrgId('other-tenant'),run,'execute')).toBe(false);
  const state=await asApp(scope,c=>c.query('SELECT status,pending_decision FROM agent_runs WHERE id=$1',[run]));
  expect(state.rows[0]).toEqual({status:'queued',pending_decision:decision==='deny'?'deny':'approve'});
  expect(await repo.decidePermissionRequest(scope,run,request,'forever','actor')).toBe(false);
  expect(await grants.hasGrant(scope,'another-run','execute')).toBe(decision==='forever');
 });
 it('stale request and cross tenant leave grants unchanged; concurrent approvals have exactly one CAS winner',async()=>{
  const {scope,run,request,repo,grants}=await pendingAtomic();
  expect(await repo.decidePermissionRequest(scope,run,randomUUID(),'forever','actor')).toBe(false);
  expect(await repo.decidePermissionRequest(toOrgId('other-tenant'),run,request,'forever','actor')).toBe(false);
  expect(await grants.hasGrant(scope,run,'execute')).toBe(false);
  const results=await Promise.all([repo.decidePermissionRequest(scope,run,request,'deny','actor'),repo.decidePermissionRequest(scope,run,request,'run','actor')]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await grants.hasGrant(scope,run,'execute')).toBe(results[1]);
  expect(await grants.hasGrant(scope,'another-run','execute')).toBe(false);
 });
 it('grant insert failure rolls back the run decision instead of partially requeueing',async()=>{
  const {scope,run,request,repo,grants}=await pendingAtomic();
  await asApp(scope,c=>c.query('UPDATE agent_runs SET pending_tool_name=NULL WHERE id=$1',[run]));
  await expect(repo.decidePermissionRequest(scope,run,request,'run','actor')).rejects.toThrow();
  const state=await asApp(scope,c=>c.query('SELECT status,pending_decision FROM agent_runs WHERE id=$1',[run]));
  expect(state.rows[0]).toEqual({status:'awaiting_tool_permission',pending_decision:null});
  expect(await grants.hasGrant(scope,run,'execute')).toBe(false);
 });

});
