/**
 * #595 后台管理面最小闭环 —— **真实 HTTP、真实 Postgres**，从「编辑一个已导入 skill
 * 的内容」一路走到「后台试跑真的读到编辑后的内容」。
 *
 * ## 这个文件证明什么，且只证明这个
 *
 * 用户可见行为的最小闭环是三步：
 *   ① `POST /admin/skills/:skillId/versions`（本 PR 新增）编辑内容 → 落一个新版本；
 *   ② `POST /admin/agents/:agentId/skill-pins`（#595 A2，已合入）把该 agent 换成新版本；
 *   ③ `POST /agents/:agentId/trial-run`（#595 Line A，已合入）真的调用模型，
 *      system prompt 里必须是**编辑后**的内容，不是编辑前的。
 *
 * 与 `trial-run-agent.test.ts` 同一纪律：真实 socket 上的 HTTP loopback 模型
 * provider、真实 Postgres 生产表，`ModelCallPort` 边界不打桩——断言比对的是
 * loopback 桩放在线上的字面字节，不是伪造的回声。
 *
 * ⚠ 本文件**不**覆盖目录浏览 / 文件上传 / Agent 侧导入——那三件本轮显式延后
 * （见 PR 正文），不要把这里的绿读成它们也做了。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wave2Runtime as C, agentRuntime } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-edit-skill-trial-run";
const PROJECT = "proj-edit-skill-trial-run";
const ADMIN = "u-edit-skill-trial-run-admin";
const NON_ADMIN = "u-edit-skill-trial-run-member";

const PROVIDER = "edit-trial-run-loopback";
const API_KEY = "sk-edit-trial-run-do-not-echo-this-anywhere";
const MODEL_ID = "edit-trial-run-model-v1";

const AGENT = "agent-edit-skill-trial-run";
const AGENT_V1 = "agent-version-edit-skill-trial-run-v1";
const SKILL = "skill-edit-skill-trial-run";
const SKILL_V1 = "skill-version-edit-skill-trial-run-v1";

const ORIGINAL_CONTENT = "# Skill Under Edit\noriginal content, pre-edit";
const EDITED_CONTENT = "# Skill Under Edit\nEDITED-SENTINEL-3f9a71 this is the new content";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback provider ─────────────────────────── */

interface CapturedCall {
  readonly body: { model?: string; messages?: { role: string; content: string }[] };
}

let providerServer: Server;
let providerBase = "";
let calls: CapturedCall[] = [];

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: CapturedCall["body"] = {};
      try {
        body = JSON.parse(raw) as CapturedCall["body"];
      } catch {
        body = {};
      }
      calls.push({ body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "trial run reply after edit" } }],
        usage: { total_tokens: 7 },
      }));
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

/* ─────────────────────────── fixtures ─────────────────────────── */

async function addSkillVersion(versionId: string, skillId: string, content: string): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [skillId, ORG, skillId, skillId, ADMIN],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,now(),false)`,
      [versionId, ORG, skillId, sha256(content), ADMIN],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, versionId, Buffer.from(content, "utf8"), sha256(content)],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, versionId]);
  });
}

async function addAgentVersion(versionId: string, skillVersionIds: readonly string[]): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT, ORG, AGENT, AGENT, ADMIN],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,'[]'::jsonb,$10,now(),now())`,
      [versionId, ORG, AGENT, versionId, sha256("instructions"), "You are the edit-trial-run agent.",
        skillVersionIds, PROVIDER, MODEL_ID, ADMIN],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
      [versionId, AGENT, ORG]);
  });
}

/* ─────────────────────────── HTTP helpers ─────────────────────────── */

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

async function postEdit(content: string, user = ADMIN, skillId = SKILL) {
  return fetch(`${BASE}/admin/skills/${skillId}/versions`, {
    method: "POST",
    headers: principal(user, ORG),
    body: JSON.stringify({ content }),
  });
}

async function postPins(skillVersionIds: readonly string[], expectedVersion: string, user = ADMIN) {
  return fetch(`${BASE}/admin/agents/${AGENT}/skill-pins`, {
    method: "POST",
    headers: principal(user, ORG),
    body: JSON.stringify({ agentId: AGENT, skillVersionIds, expectedVersion }),
  });
}

async function postTrialRun(scenario: string, user = ADMIN) {
  return fetch(`${BASE}/agents/${AGENT}/trial-run`, {
    method: "POST",
    headers: principal(user, ORG),
    body: JSON.stringify({ agentId: AGENT, scenario }),
  });
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = API_KEY;
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => providerServer.close(() => resolve()));
});

beforeEach(async () => {
  calls = [];
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy ?? null);
  await addOrgMember(ORG, NON_ADMIN, "consultant", fx.teams.energy ?? null);
  await addSkillVersion(SKILL_V1, SKILL, ORIGINAL_CONTENT);
  await addAgentVersion(AGENT_V1, [SKILL_V1]);
});

describe("POST /admin/skills/:skillId/versions（编辑）", () => {
  it("产出并发布一个新版本，内容真的落进 skill_version_files", async () => {
    const response = await postEdit(EDITED_CONTENT);
    expect(response.status).toBe(201);
    const body = await response.json() as unknown;
    const parsed = C.operations.editSkillVersionContent.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    if (!parsed.success) throw new Error("unreachable");

    expect(parsed.data.skillId).toBe(SKILL);
    expect(parsed.data.versionId).not.toBe(SKILL_V1);
    expect(parsed.data.semanticLabel).toBe("v2");

    const rows = await asApp(ORG, (c) => c.query(
      "SELECT content, published FROM skill_version_files f JOIN skill_versions v ON v.id = f.version_id WHERE f.version_id = $1",
      [parsed.data.versionId],
    ));
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { content: Buffer }).content.toString("utf8")).toBe(EDITED_CONTENT);
    expect((rows.rows[0] as { published: boolean }).published).toBe(true);
  });

  it("拒绝非 admin，且不落库", async () => {
    const response = await postEdit(EDITED_CONTENT, NON_ADMIN);
    expect(response.status).toBe(403);
    const body = await response.json() as { reasonCode?: string };
    expect(body.reasonCode).toBe("EDIT_NOT_ORG_ADMIN");
    const rows = await asApp(ORG, (c) => c.query(
      "SELECT id FROM skill_versions WHERE skill_id = $1", [SKILL],
    ));
    expect(rows.rows).toHaveLength(1); // still only the seeded v1
  });

  it("拒绝空白内容", async () => {
    const response = await postEdit("   \n  ");
    expect(response.status).toBe(422);
    const body = await response.json() as { reasonCode?: string };
    expect(body.reasonCode).toBe("EDIT_CONTENT_INVALID");
  });

  it("找不到 skill 时报 404，而不是把别的组织的 skill 泄漏为 200", async () => {
    const response = await postEdit(EDITED_CONTENT, ADMIN, "sk_does-not-exist");
    expect(response.status).toBe(404);
    const body = await response.json() as { reasonCode?: string };
    expect(body.reasonCode).toBe("EDIT_SKILL_NOT_FOUND");
  });
});

describe("编辑 → pin → 试跑：闭环真的读到编辑后的内容", () => {
  it("试跑发给模型的 system prompt 是编辑后的内容，不是编辑前的", async () => {
    const editResponse = await postEdit(EDITED_CONTENT);
    expect(editResponse.status).toBe(201);
    const edited = await editResponse.json() as { versionId: string };

    const pinResponse = await postPins([edited.versionId], AGENT_V1);
    expect(pinResponse.status).toBe(201);
    const pinParsed = agentRuntime.operations.setAgentSkillPins.out.safeParse(await pinResponse.json());
    expect(pinParsed.success).toBe(true);

    const trialResponse = await postTrialRun("What does this skill say?");
    expect(trialResponse.status).toBe(201);
    await trialResponse.json();

    expect(calls).toHaveLength(1);
    const system = calls[0]!.body.messages!.find((m) => m.role === "system")!.content;
    expect(system).toContain("EDITED-SENTINEL-3f9a71");
    expect(system).not.toContain("original content, pre-edit");
  });
});
