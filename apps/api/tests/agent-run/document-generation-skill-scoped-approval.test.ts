/**
 * issue #3440 —— 四个锁定文档 skill（pdf/docx/xlsx/pptx-create）的 (skill_name,
 * tool_name) 授权寻址 + composer 开关「自动批准文档生成所需权限」的真库反证套件。
 *
 * 判据（见 issue 正文"判据要求"一节）：
 * ① 「最多一次」：同一次生成流程内，无论调用清单里几个不同的 L2 工具调用（真实证据里
 *    `execute` 会被调用不止一次——`node gen-capabilities.js` 之后还有
 *    `python3 .../render-office.py`），用户操作至多一次。
 * ② 「(skill_name, tool_name) 寻址」：批准 pdf-create 不得连带放行同一 run 内 docx-create
 *    这类不同 skill 的调用（#3221 同一种漏洞，这里只在四个锁定 skill 之间验证收紧后
 *    互不泄漏）。
 * ③ 「清单之外仍会问」：composer 开关打开也不改变——非锁定 skill 的 `call_skill`、
 *    以及本次 run 混挂了非 L0 skill（#3437 devapp 真机实测的真实条件：21 个挂载 skill，
 *    只有 4 个平台官方 L0）时的原生 `execute`，两条路径都必须继续询问。
 */
import { beforeAll, beforeEach, expect, it } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgToolPermissionGrantRepository } from "../../src/infrastructure/agent-run/pg-tool-permission-grant-repository";
import { handleInterruptedToolCall } from "../../src/application/agent-run/tool-permission-gate";
import type { ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS } from "../../src/domain/agent-run/document-generation-skills";

const ORG = "org-doc-skill-scoped-3440";
const org = toOrgId(ORG);
const RUN = "run-doc-skill-scoped";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

async function runRow(): Promise<{ status: string; pending_tool_name: string | null; pending_grant_scope: string | null }> {
  return asApp(ORG, async (c) => (await c.query(
    "SELECT status,pending_tool_name,pending_grant_scope FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0]);
}

async function seedRunningRun(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `UPDATE agent_runs SET status='running', pending_decision=NULL, pending_tool_name=NULL, pending_grant_scope=NULL,
         pending_args_summary=NULL, pending_permission_request_id=NULL,
         lease_epoch=2, lease_expires_at=now()+interval '1 minute', started_at=now()-interval '1 minute',
         heartbeat_at=now()-interval '1 minute'
       WHERE org_id=$1 AND id=$2`, [ORG, RUN],
    );
  });
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "doc-skill-project" });
  await addChatThread({ orgId: ORG, id: "doc-skill-thread", projectId: null, visibilityScope: "plenary", createdBy: "doc-skill-user" });
  await addChatMessage({ orgId: ORG, id: "doc-skill-input", threadId: "doc-skill-thread", body: "生成一份 PDF", authorId: "doc-skill-user" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('doc-skill-agent',$1,'doc-skill-agent','doc-skill-agent','enabled','doc-skill-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('doc-skill-version',$1,'doc-skill-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'doc-skill-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at,remote_run_id,remote_thread_id) VALUES('${RUN}',$1,'doc-skill-thread','doc-skill-input','doc-skill-agent','doc-skill-version','[]','deep-agent','deep-agent','running',now()-interval '1 minute',2,now()+interval '1 minute','remote-run-doc','remote-thread-doc')`, [ORG]);
  });
});

function deps(repo: PgAgentRunRepository, grants: PgToolPermissionGrantRepository): ExecuteAgentRunDeps {
  return {
    runs: repo, toolPermissionGrants: grants,
    clock: { now: () => new Date().toISOString() },
    log: () => {},
  } as unknown as ExecuteAgentRunDeps;
}

let seqCounter = 0;
const ledger = () => ({ seq: (seqCounter += 1), modelStartedAt: new Date().toISOString(), systemDigest: "b".repeat(64), system: "system" });

it("② (skill_name, tool_name) 寻址：批准 pdf-create 的 call_skill「本 run 内都允许」不连带放行同一 run 内 docx-create", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);

  // 用户第一次面对 pdf-create 的 call_skill 中断，选「本次 run 内都允许」。
  await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "call_skill", argsSummary: "{\"skill_stable_name\":\"pdf-create\"}", skillStableName: "pdf-create" }, ledger());
  const rid = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, RUN, rid, "run", "doc-skill-user")).toBe(true);

  const granted = await asApp(ORG, async (c) => (await c.query(
    "SELECT tool_name FROM tool_permission_grants WHERE org_id=$1", [ORG],
  )).rows);
  expect(granted, "授权必须按 (skill,tool) 收紧地址落库，不是裸 call_skill").toEqual([{ tool_name: "call_skill:pdf-create" }]);

  // run 回到 running，模拟 executor 恢复执行；同一个 run 里现在轮到 docx-create 的 call_skill。
  await seedRunningRun();
  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "call_skill", argsSummary: "{\"skill_stable_name\":\"docx-create\"}", skillStableName: "docx-create" }, ledger());
  expect(outcome.autoApproved, "批准 pdf-create 不得连带放行同一 run 内的 docx-create——这正是 #3221 的漏洞形状").toBe(false);
  const row = await runRow();
  expect(row.status).toBe("awaiting_tool_permission");
});

it("① 最多一次：composer 开关打开后，同一次原生生成流程里两次不同的 execute 中断都不再询问", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantStanding(org, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, "doc-skill-user");

  // 干净挂载：本次 run 只挂了 pdf-create（L0），符合"唯一锁定 skill 且无其它非 L0 skill"。
  const skillRisks = [{ stableName: "pdf-create", riskLevel: "L0" as const }];

  const first = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"cd /workspace && node gen-capabilities.js\"}" }, ledger(), skillRisks);
  expect(first.autoApproved, "composer 开关打开 ⇒ 第一次 execute 就不该问").toBe(true);
  expect((await runRow()).status).toBe("queued");

  await seedRunningRun();
  const second = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"python3 /skills/pdf-create/scripts/render-office.py\"}" }, ledger(), skillRisks);
  expect(second.autoApproved, "同一流程里第二个不同的 execute 调用也不该问——用户全程零点击").toBe(true);
});

it("③ 清单之外仍会问（1/2）：composer 开关打开，但本次 run 混挂了非 L0 skill——不豁免（#3437 devapp 真机实测条件）", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantStanding(org, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, "doc-skill-user");

  // 混挂：除了锁定的 pdf-create（L0），还挂了一个默认 L1 的普通 skill——#3437 实测的
  // 21-挂载真实条件（4 个平台官方 + 其余默认 L1）的最小复现。
  const skillRisks = [
    { stableName: "pdf-create", riskLevel: "L0" as const },
    { stableName: "some-general-skill", riskLevel: "L1" as const },
  ];

  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    // 模拟 #3437 证据里的 `node assistant-capabilities.js`——同一个 execute 工具名，
    // 但不是 pdf-create 声明清单里可归因的那次调用。
    { toolName: "execute", argsSummary: "{\"command\":\"node assistant-capabilities.js\"}" }, ledger(), skillRisks);

  expect(outcome.autoApproved, "本次 run 混挂了非 L0 skill——execute 无法安全归因给 pdf-create，必须照旧询问").toBe(false);
  expect((await runRow()).status).toBe("awaiting_tool_permission");
});

it("③ 清单之外仍会问（2/2）：composer 开关打开，但目标 skill 不在锁定清单内——不豁免", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantStanding(org, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, "doc-skill-user");

  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "call_skill", argsSummary: "{\"skill_stable_name\":\"some-other-skill\"}", skillStableName: "some-other-skill" }, ledger());

  expect(outcome.autoApproved, "非锁定 skill 的 call_skill——composer 开关不该对它生效").toBe(false);
  expect((await runRow()).status).toBe("awaiting_tool_permission");
});

it("composer 开关关闭时（默认状态）：清单内的调用照常询问，不会被误放行", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  const skillRisks = [{ stableName: "pdf-create", riskLevel: "L0" as const }];

  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"node gen.js\"}" }, ledger(), skillRisks);
  expect(outcome.autoApproved, "默认关闭 ⇒ 第一次仍然要问，不是零确认").toBe(false);
});
