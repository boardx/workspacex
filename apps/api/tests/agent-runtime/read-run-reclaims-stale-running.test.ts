/** GET remains read-only: an expired heartbeat is not evidence that the remote
 * operation failed. The scheduled, fenced recovery reader reconciles it separately. */
import { randomUUID, createHash } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
// ⚠ 这次要拿到的是"claim 走了但从没跑完"的状态，不是"跑完了"——autostart 关掉，
// POST 只把 run 落到 queued，永远不会自己被 tick() 跑走。
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";

const ORG = "org-i2399-read-reclaim";
const PROJECT = "proj-i2399-read-reclaim";
const THREAD = "thread-i2399-read-reclaim";
const ACTOR = "u-i2399-read-reclaim-actor";

const PROVIDER = "i2399-read-reclaim-loopback";
const AGENT = "agent-i2399-read-reclaim";
const V1 = "agent-version-i2399-read-reclaim-v1";
const SKILL = "skill-i2399-read-reclaim";
const SV = "skill-version-i2399-read-reclaim-v1";
const MODEL = "pinned-model-i2399-read-reclaim";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

async function addSkillVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, SKILL, SKILL, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [SV, ORG, SKILL, SV, sha256("# i2399 read-reclaim skill"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# i2399 read-reclaim skill", "utf8"), sha256("# i2399 read-reclaim skill")],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, SV]);
  });
}

async function addPublishedAgentVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT, ORG, AGENT, AGENT, ACTOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,'[]'::jsonb,$10,now(),now())`,
      [V1, ORG, AGENT, V1, sha256("i2399 read-reclaim instructions"),
        "You are the i2399 read-reclaim test agent.", [SV], PROVIDER, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [V1, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

async function postMessage(text: string): Promise<{ status: number; agentRunId: string }> {
  const response = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
    method: "POST",
    headers: principal(ACTOR, ORG),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId: AGENT }),
  });
  if (response.status !== 202) return { status: response.status, agentRunId: "" };
  const body = await response.json() as { agentRunId: string };
  return { status: 202, agentRunId: body.agentRunId };
}

async function getRun(runId: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(`${BASE}/agent-runs/${runId}`, { headers: principal(ACTOR, ORG) });
  const body = response.status === 200 ? await response.json() as Record<string, unknown> : null;
  return { status: response.status, body };
}

/** 模拟"这条 run 已经被 claim 走、翻成 running，处理它的进程随后消失"——`startedAgo`
 *  之前的 `started_at`，跟真实的 `claimQueued` UPDATE 效果逐字段一致。 */
async function markClaimedAndStuck(runId: string, startedAgo: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `UPDATE agent_runs SET status='running', started_at = now() - interval '${startedAgo}' WHERE id=$1`,
      [runId],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await addSkillVersion();
  await addPublishedAgentVersion();
});

describe("GET /agent-runs/:runId -- reads do not cancel or fail an unverified remote run", () => {
  it("an old running run remains running on GET until remote reconciliation proves its state", async () => {
    const { status: postStatus, agentRunId } = await postMessage("生成一个 pdf 来展示设计思维发展的历史，一页 pdf");
    expect(postStatus).toBe(202);

    await markClaimedAndStuck(agentRunId, "30 minutes");

    // 真实用户的复现步骤就是这一步：只刷新页面（= 只 GET 一次），不发第二条消息。
    const { status, body } = await getRun(agentRunId);
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "running", error: null });

    const row = await asApp(ORG, (c) =>
      c.query<{ status: string; error_code: string | null }>(
        "SELECT status, error_code FROM agent_runs WHERE id=$1", [agentRunId],
      ));
    expect(row.rows[0]).toMatchObject({ status: "running", error_code: null });
  }, 30_000);

  it("一条刚起步的 running run：单纯 GET 不会误杀它——它可能只是还在正常跑", async () => {
    const { status: postStatus, agentRunId } = await postMessage("生成一个 pdf 来展示设计思维发展的历史，一页 pdf");
    expect(postStatus).toBe(202);

    await markClaimedAndStuck(agentRunId, "10 seconds");

    const { status, body } = await getRun(agentRunId);
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "running", error: null });
  }, 30_000);

  it("一条早就是终态的 run：GET 不触发任何多余的回收（如实读，不是每次都跑一遍 UPDATE）", async () => {
    const { status: postStatus, agentRunId } = await postMessage("生成一个 pdf 来展示设计思维发展的历史，一页 pdf");
    expect(postStatus).toBe(202);

    await asApp(ORG, (c) =>
      c.query(
        `UPDATE agent_runs SET status='failed', error_code='MODEL_CALL_FAILED', ended_at=now() WHERE id=$1`,
        [agentRunId],
      ));

    const { status, body } = await getRun(agentRunId);
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "failed", error: "MODEL_CALL_FAILED" });
  }, 30_000);
});
