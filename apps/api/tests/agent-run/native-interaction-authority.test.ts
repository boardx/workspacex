/**
 * 三个 native HITL 交互名 + edit 授权必须绑定 exact resumed args/call/request/attempt。
 *
 * ⚠ 所有 DB fixture id 一律带 `native-` 前缀，不要改回 `parent-*`。本文件是从
 * `parent-run-control.test.ts` 复制出来的，复制时保留了那边的 fixture id（`parent-project`
 * / `parent-thread` / `parent-agent` / run id `parent` …）却换了 org id。
 * `projects` / `chat_threads` / `chat_messages` / `agents` / `agent_versions` / `agent_runs`
 * / `agent_run_steps` 的主键都是**全局** `id text PRIMARY KEY`（见
 * `migrations/0003-identity.sql` 等），不是 `(org_id,id)` 复合键；而 `resetOrgs` 只按 org
 * 删，靠 `ON DELETE CASCADE` 带走下游行。于是「同一个 id + 不同 org」= 谁先跑谁占住那个
 * 主键，后跑的那个文件的 `beforeEach` 永远删不掉它：
 *
 *     error: duplicate key value violates unique constraint "projects_pkey"
 *       ❯ Module.seedOrg tests/support/db.ts:264:3
 *
 * 这不是 authority 逻辑的失败——4 条用例全挂在 `beforeEach` 的第一条 INSERT 上，断言
 * 一条都没跑到（run 34135593071 的 `e2e-full` job，被测 SHA 8a3834af）。
 *
 * 套件里大量文件共用 `p-1` / `proj-1` 这类 project id 而不出事，是因为它们**同时**共用
 * org id：后跑的 `resetOrgs` 会先把那个 org 连同它的 project 一起删掉。会炸的组合只有
 * 一个——**同 id、异 org**。新增 DB fixture 时按本文件所属 org 的前缀命名。
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
const ORG = "org-native-interactions", OTHER = "org-native-interactions-other";
const org = toOrgId(ORG);
const db: DatabasePort = { withTenant: (id, fn) => asApp(id, c => fn({ query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }) })), withoutTenant: async () => { throw new Error("tenant required"); }, close: async () => {} };
const reader = new PgParentRunControlReader(db);
const check = { orgId: org, parentRunId: "native-parent", leaseEpoch: 2, attemptId: "native-parent:1", toolName: "read_file" };
beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "native-parent-project" });
  await seedOrg({ orgId: OTHER, projectId: "native-parent-other-project" });
  await addChatThread({ orgId: ORG, id: "native-parent-thread", projectId: null, visibilityScope: "plenary", createdBy: "native-parent-user" });
  await addChatMessage({ orgId: ORG, id: "native-parent-input", threadId: "native-parent-thread", body: "run", authorId: "native-parent-user" });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('native-parent-agent',$1,'native-parent-agent','native-parent-agent','enabled','native-parent-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('native-parent-version',$1,'native-parent-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'native-parent-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('native-parent',$1,'native-parent-thread','native-parent-input','native-parent-agent','native-parent-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES('native-parent-context',$1,'native-parent',2,'context_built','succeeded',now(),now())`, [ORG]);
  });
});

import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import { bindNativeInvocation } from "../../src/application/agent-run/native-invocation";
import { ToolExecutionAuthority } from "../../src/application/agent-run/tool-execution-authority";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toolArgumentsDigest } from "../../src/application/agent-run/tool-arguments-digest";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
afterAll(async()=>{await resetOrgs(ORG,OTHER);});
it("trusted native provisioning requires the three shared interaction names to interrupt",async()=>{
 const provision=vi.fn(async(..._args:Parameters<import("../../src/application/agent-run/native-session-owner").NativeSessionOwner["provision"]>)=>({bindingId:"11111111-1111-4111-8111-111111111111",profile:"native-v1" as const,policy:"native-v1" as const}));
 await bindNativeInvocation({provision,resolve:vi.fn(),release:vi.fn(async()=>{}),releaseForRun:vi.fn(async()=>{})},
 {modelProvider:"deep-agent",modelId:"test",system:"",user:"",orgId:ORG,runId:"native-parent",executionAttemptId:"native-parent:1",executionLeaseEpoch:2,onSkillActivity:async()=>{},onRemoteRunStarted:async()=>{}});
 const policy=provision.mock.calls[0]?.[2];
 for(const name of Object.values(AGENT_INTERRUPTS_TOOL_NAMES))expect(policy).toHaveProperty(name,true);
});
it.each([
 [AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,{requestId:"i",understanding:"goal",assumptions:["old"]},{assumptions:["new"]}],
 [AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,{requestId:"p",fields:[{name:"count",aiGuess:"1"}]},{fields:[{name:"count",value:"42"}]}],
 [AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,{requestId:"o",options:[{optionId:"A"},{optionId:"B"}]},{selectedOptionId:"B"}],
] as const)("%s edit approval authorizes only exact resumed args/call/request/attempt",async(toolName,original,edited)=>{
 const repo=new PgAgentRunRepository(db),authority=new ToolExecutionAuthority(reader,repo,createInMemoryToolPermissionGrantStore());
 await repo.markAwaitingToolPermission(org,"native-parent",{toolName,argsSummary:"initial",toolCallId:"real-call",toolArgsDigest:toolArgumentsDigest(original)!});
 const requestId=await asApp(ORG,async c=>(await c.query<{pending_permission_request_id:string}>("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='native-parent'",[ORG])).rows[0]!.pending_permission_request_id);
 expect(await repo.decidePermissionRequest(org,"native-parent",requestId,"edit","native-parent-user",JSON.stringify(edited))).toBe(true);
 await asApp(ORG,c=>c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id='native-parent'",[ORG]));
 const exact={...check,toolName,toolCallId:"real-call",permissionRequestId:requestId,toolArgs:edited};
 for(const override of [{toolArgs:original},{toolCallId:"other"},{permissionRequestId:"00000000-0000-4000-8000-000000000000"},{attemptId:"native-parent:old"},{orgId:toOrgId(OTHER)}]){
  expect((await authority.check({...exact,...override})).allowed).toBe(false);
 }
 expect(await authority.check(exact)).toEqual({allowed:true});expect(await authority.check(exact)).toEqual({allowed:true});
 await asApp(ORG,c=>c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id='native-parent'",[ORG]));
 expect(await authority.check(exact)).toEqual({allowed:false,reason:"cancel_requested"});
});
