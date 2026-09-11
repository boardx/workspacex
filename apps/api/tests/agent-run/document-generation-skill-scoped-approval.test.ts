/**
 * issue #3440 —— 四个锁定文档 skill（pdf/docx/xlsx/pptx-create）的 (skill_name,
 * tool_name) 授权寻址 + composer 开关「自动批准文档生成所需权限」的真库反证套件。
 *
 * 2026-09-11 人类实测后裁决「推翻之前的设计，要以用户体验为优先级」——重新设计把原生
 * `execute` 的归因单位从"这个 run 挂载了什么"换成"这个 run 实际调用过什么"（调用口径，
 * 见 `src/domain/agent-run/document-generation-skills.ts` 头注"重新设计"一节）。本文件
 * 的测试相应重写：不再用"挂载集合"造场景，改成真实往 `agent_run_steps` 里追加工具调用
 * 记录（`appendToolCallStep`），复刻这个 run 真实发生过的调用序列。
 *
 * 判据（见 issue 正文 + 本次重新设计的三条安全边界）：
 * ① 「最多一次，且覆盖技能外临时脚本」：pdf-create 被真实调用（`read_file
 *    /skills/pdf-create/SKILL.md`）之后，`execute` 无论是在 `/workspace` 下跑模型现写
 *    的临时脚本（#3437 真实反例 `assistant-capabilities.js` 的形状），还是跑该 skill
 *    自带的 `/skills/pdf-create/scripts/render-office.py`，同一次确认必须都覆盖。
 * ② 「(skill_name, tool_name) 寻址」：批准 pdf-create 不得连带放行同一 run 内 docx-create
 *    这类不同 skill 的调用（#3221 同一种漏洞，这里只在四个锁定 skill 之间验证收紧后
 *    互不泄漏）——call_skill 路径本次未改动，测试原样保留。
 * ③ 「清单之外仍会问」：
 *    (a) 目标 skill 不在锁定清单内的 `call_skill`；
 *    (b) **调用口径的核心安全闸**——同一个 run 里，pdf-create 已经被批准过一次之后，
 *        若这个 run 又真实调用（不是挂载）了另一个非 L0 skill，后续的 `execute` 依然
 *        必须询问，composer 开关打开也不豁免；
 *    (c) 混挂但**没有被这个 run 实际调用过**的其它非 L0 skill 不影响归因——这正是
 *        解决"混挂 21 个技能"假阴性的那一条（#3437 devapp 真机实测条件），用一个只挂
 *        没叫的 skill 佐证"挂载"与"调用"是两件事。
 * composer 关闭时（默认状态）：清单内的调用照常询问，不是隐性零确认。
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
const nextSeq = () => (seqCounter += 1);
const ledger = () => ({ seq: nextSeq(), modelStartedAt: new Date().toISOString(), systemDigest: "b".repeat(64), system: "system" });

/**
 * 往 `agent_run_steps` 里追加一条真实的 `tool_call` 记录——测试用它复刻"这个 run 迄今
 * 为止真实发生过的工具调用序列"，`resolveNativeExecuteAttribution` 正是读这张表（经
 * `readToolCallAttributionSteps`）而不是任何"挂载集合"来做归因判定。
 */
async function appendToolCallStep(repo: PgAgentRunRepository, toolName: string, argsSummary: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.appendStep(org, {
    runId: RUN, seq: nextSeq(), kind: "tool_call", status: "succeeded",
    startedAt: now, endedAt: now, inputDigest: null, outputDigest: null, failureCode: null,
    toolName, toolArgsSummary: argsSummary, toolResultSummary: null, planningNote: null, toolCallId: null,
  });
}

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

it("① 最多一次（真实反例，#3437）：pdf-create 被真实调用后，/workspace 下的 node assistant-capabilities.js 必须被同一次确认覆盖", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantStanding(org, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, "doc-skill-user");

  // 复刻 baseline1-timeline.json 的真实第一步：模型读 pdf-create 的 SKILL.md——这是
  // "pdf-create 被实际调用了"的信号，不是"挂载了 pdf-create"。
  await appendToolCallStep(repo, "read_file", "{\"file_path\":\"/skills/pdf-create/SKILL.md\",\"limit\":\"1000\"}");

  // #3437 实测的真实反例：模型为「顺便总结一下你能做什么」这类混合请求自己写的脚本，
  // 落在 /workspace 而不是任何 skill 目录下——按人类裁决，这条必须被同一次确认覆盖。
  const first = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"cd /workspace && node assistant-capabilities.js\"}" }, ledger());
  expect(first.autoApproved, "composer 开关打开 + pdf-create 已被真实调用 ⇒ /workspace 下的临时脚本也不该问").toBe(true);
  expect((await runRow()).status).toBe("queued");

  await seedRunningRun();
  // 同一次流程里，稍后 pdf-create 自己声明的脚本也被调用——同一条归因链，同样零确认。
  const second = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"python3 /skills/pdf-create/scripts/render-office.py /workspace/out.pdf /workspace/preview\"}" }, ledger());
  expect(second.autoApproved, "同一流程里第二个不同的 execute 调用也不该问——用户全程零点击").toBe(true);
});

it("③(b) 调用口径安全闸：同一 run 里 pdf-create 已获批准，之后又真实调用了另一个非 L0 skill——后续 execute 依旧必须询问", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantStanding(org, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, "doc-skill-user");

  await appendToolCallStep(repo, "read_file", "{\"file_path\":\"/skills/pdf-create/SKILL.md\",\"limit\":\"1000\"}");

  // 第一次 execute：只有 pdf-create 被真实调用过，composer 开关打开 ⇒ 照预期零确认。
  const first = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"cd /workspace && node gen-capabilities.js\"}" }, ledger());
  expect(first.autoApproved, "前置条件：pdf-create 链路先要能正常零确认").toBe(true);
  await seedRunningRun();

  // 关键动作：这个 run 里又**真实调用**（不是挂载）了另一个非 L0 skill——按显式
  // skill_stable_name 参数走 legacy call_skill 记一条真实调用（原生模式同理，走
  // /skills/<name>/ 路径信号，这里用 call_skill 形态复刻"真实触发"这件事，不是
  // 挂载集合意义上的"存在"）。
  await appendToolCallStep(repo, "call_skill", "{\"skill_stable_name\":\"some-general-skill\"}");

  // 再来一次 execute：即使前面已经点过确认（composer 开关 + 已归因过 pdf-create），
  // 本次 run 混入了真实调用的非 L0 skill 之后，安全闸必须生效——依旧询问。
  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"cd /workspace && node another-step.js\"}" }, ledger(),
    [{ stableName: "some-general-skill", riskLevel: "L1" as const }]);
  expect(outcome.autoApproved, "同一 run 里真实触发了另一个非 L0 skill——即使前面已经批过一次，也不能被这次 execute 沿用").toBe(false);
  expect((await runRow()).status).toBe("awaiting_tool_permission");
});

it("③(c) 混挂但没有被这个 run 实际调用过的其它非 L0 skill 不影响归因（解决 21-挂载假阴性）", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantStanding(org, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, "doc-skill-user");

  await appendToolCallStep(repo, "read_file", "{\"file_path\":\"/skills/pdf-create/SKILL.md\",\"limit\":\"1000\"}");

  // `skillRisks` 复刻 #3437 实测的 21-挂载条件（另有一个非 L0 skill **挂载**在这个 run
  // 上），但这个 run 的工具调用序列（`agent_run_steps`，上面只追加了 pdf-create 一条）
  // 里从来没有真实调用过它——调用口径下，这不应该阻止归因。
  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"cd /workspace && node gen-capabilities.js\"}" }, ledger(),
    [{ stableName: "pdf-create", riskLevel: "L0" as const }, { stableName: "some-mounted-but-unused-skill", riskLevel: "L1" as const }]);

  expect(outcome.autoApproved, "只挂载没被这个 run 实际调用过的其它 skill 不该阻止归因——这正是调用口径要解决的假阴性").toBe(true);
});

it("③(a) 清单之外仍会问：composer 开关打开，但目标 skill 不在锁定清单内——不豁免", async () => {
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
  await appendToolCallStep(repo, "read_file", "{\"file_path\":\"/skills/pdf-create/SKILL.md\",\"limit\":\"1000\"}");

  const outcome = await handleInterruptedToolCall(deps(repo, grants), org, RUN,
    { toolName: "execute", argsSummary: "{\"command\":\"cd /workspace && node gen.js\"}" }, ledger());
  expect(outcome.autoApproved, "默认关闭 ⇒ 第一次仍然要问，不是零确认").toBe(false);
});
