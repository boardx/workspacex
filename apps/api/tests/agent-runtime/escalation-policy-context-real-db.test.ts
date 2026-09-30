/**
 * AG06 真实模型缺口 —— run 钉住的 agent 版本上的 `escalation_policy` 事项名与裁决人（人话）真的进了
 * 发给模型的 system 上下文（运行时注入，不回填 instructions）。回环模型靠剧本绕开了「猜事项名」，
 * 真实模型绕不开：网关只按 `matter` 精确匹配。
 *
 * 全程 `executeQueuedRuns` → 真 PG 仓储读钉住策略，与生产同一条组装路径。
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { buildEscalationPolicyContext } from "../../src/domain/agent/escalation-policy-prompt";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ag06-escalation-ctx";
const PROJECT = "proj-ag06-escalation-ctx";
const THREAD = "thr-ag06-escalation-ctx";
const ACTOR = "u-ag06-escalation-ctx";
const AGENT_ID = "agent-ag06-escalation-ctx";
const INSTRUCTIONS = "You are the AG06 escalation context test agent.";
const POLICY = { rules: [
  { matter: "客户要求超额折扣", target: "project_owner" },
  { matter: "合同条款偏离标准模板", target: "org_admin" },
] };

let db: PgDatabase;
let repo: PgAgentRunRepository;

async function seedAgent(versionId: string, provider: string, policy: unknown): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT_ID, ORG, AGENT_ID, "AG06 测试 agent", ACTOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,escalation_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$1,$4,$5,'{}'::text[],$6,'m','[]'::jsonb,$7::jsonb,$8,now(),now())`,
      [versionId, ORG, AGENT_ID, createHash("sha256").update(INSTRUCTIONS).digest("hex"),
        INSTRUCTIONS, provider, JSON.stringify(policy), ACTOR],
    );
  });
}

async function runOnce(runId: string, versionId: string, provider: string): Promise<string> {
  const qid = `q-${runId}`;
  await addChatMessage({ orgId: ORG, id: qid, threadId: THREAD, body: "客户要 30% 折扣，怎么办？", authorId: ACTOR });
  await asApp(ORG, (c) => c.query(
    `INSERT INTO agent_runs (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
       skill_version_ids,model_provider,model_id,status)
     VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,'m','queued')`,
    [runId, ORG, THREAD, qid, AGENT_ID, versionId, provider],
  ));
  const calls: ModelCallInput[] = [];
  let clock = 0;
  const deps: ExecuteAgentRunDeps = {
    runs: repo,
    model: { async complete(input: ModelCallInput) { calls.push(input); return { text: "好的。" }; } },
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${runId}-${clock}` },
    log: () => {},
  };
  await executeQueuedRuns(deps, { orgId: toOrgId(ORG) });
  await writeBackPendingRuns(deps, { orgId: toOrgId(ORG) });
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)!.system;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
});

afterAll(async () => { await db.close(); });

describe("AG06 升级策略事项名运行时注入 system 上下文", () => {
  it("deep-agent run：钉住策略的每个事项名逐字出现，裁决人是人话（不是枚举值），instructions 未被改写", async () => {
    await seedAgent("v-deep", DEEP_AGENT_PROVIDER_NAME, POLICY);
    const system = await runOnce("run-ag06-ctx-deep", "v-deep", DEEP_AGENT_PROVIDER_NAME);
    expect(system).toContain(buildEscalationPolicyContext(POLICY)!);
    expect(system).toContain("「客户要求超额折扣」→ 由所在项目的负责人裁决");
    expect(system).toContain("「合同条款偏离标准模板」→ 由组织管理员裁决");
    expect(system).not.toMatch(/project_owner|org_admin/);
    expect(system.startsWith(INSTRUCTIONS)).toBe(true);
    const stored = await asApp(ORG, async (c) =>
      (await c.query<{ instructions: string }>("SELECT instructions FROM agent_versions WHERE id='v-deep'")).rows[0]!.instructions);
    expect(stored, "不回填 instructions").toBe(INSTRUCTIONS);
  });

  it("策略为空 ⇒ 不注入任何升级段落", async () => {
    await seedAgent("v-empty", DEEP_AGENT_PROVIDER_NAME, { rules: [] });
    const system = await runOnce("run-ag06-ctx-empty", "v-empty", DEEP_AGENT_PROVIDER_NAME);
    expect(system).not.toContain("升级策略");
  });

  it("非 deep-agent run（没有 escalate_matter 工具）⇒ 不注入", async () => {
    await seedAgent("v-plain", "test-provider", POLICY);
    const system = await runOnce("run-ag06-ctx-plain", "v-plain", "test-provider");
    expect(system).not.toContain("客户要求超额折扣");
  });
});

describe("buildEscalationPolicyContext", () => {
  it("非法策略 ⇒ null", () => {
    expect(buildEscalationPolicyContext(null)).toBeNull();
    expect(buildEscalationPolicyContext({ rules: [{ matter: "x", target: "ceo" }] })).toBeNull();
  });
  it("requester 用人话", () => {
    expect(buildEscalationPolicyContext({ rules: [{ matter: "越权", target: "requester" }] })).toContain("「越权」→ 由发起这次对话的人裁决");
  });
});
