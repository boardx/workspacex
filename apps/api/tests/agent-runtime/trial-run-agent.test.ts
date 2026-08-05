/**
 * `POST /agents/:agentId/trial-run` -- #595 Line A.
 *
 * Same discipline as `no-tool-run-writeback.test.ts`: a real HTTP loopback provider on a
 * real socket, real Postgres fixtures against the production `agents`/`agent_versions`/
 * `skill_versions`/`skill_version_files` tables, and the real `ConfiguredModelProvider`
 * adapter -- no fake injected at the `ModelCallPort` boundary.
 *
 * What this file proves that `no-tool-run-writeback.test.ts` does not:
 *   * a trial run reaches the model WITHOUT ever touching `agent_runs` -- no thread, no
 *     accepted Chat message, no run row of any kind is created;
 *   * it is gated to org admins, matching the only existing precedent on this same table
 *     (`importAgentStarterPack`'s admin requirement);
 *   * the response is a real completion, not a fabricated echo -- the assertion compares
 *     against the literal bytes the loopback stub put on the wire.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRuntime as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-trial-run-agent";
const PROJECT = "proj-trial-run-agent";
const ADMIN = "u-trial-run-agent-admin";
const NON_ADMIN = "u-trial-run-agent-member";

const PROVIDER = "trial-run-loopback";
const API_KEY = "sk-trial-run-do-not-echo-this-anywhere";
const MODEL_ID = "trial-run-model-v1";

const AGENT = "agent-trial-run";
const V1 = "agent-version-trial-run-v1";
const SKILL_A = "skill-trial-run-a";
const SV_A = "skill-version-trial-run-a1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback provider ─────────────────────────── */

interface CapturedCall {
  readonly authorization: string | undefined;
  readonly body: { model?: string; messages?: { role: string; content: string }[] };
}

let providerServer: Server;
let providerBase = "";
let calls: CapturedCall[] = [];
let nextReplyText = "trial run reply from the loopback provider";

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
      calls.push({
        authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: nextReplyText } }],
        usage: { total_tokens: 42 },
      }));
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

/* ─────────────────────────── catalog fixtures ─────────────────────────── */

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
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [versionId, ORG, skillId, versionId, sha256(content), ADMIN],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, versionId, Buffer.from(content, "utf8"), sha256(content)],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, versionId]);
  });
}

async function addAgentVersion(input: {
  versionId: string;
  skillVersionIds: readonly string[];
  instructions: string;
  publish?: boolean;
}): Promise<void> {
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
      [input.versionId, ORG, AGENT, input.versionId, sha256(input.instructions),
        input.instructions, input.skillVersionIds, PROVIDER, MODEL_ID, ADMIN],
    );
    if (input.publish !== false) {
      await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
        [input.versionId, AGENT, ORG]);
    }
  });
}

/* ─────────────────────────── HTTP helpers ─────────────────────────── */

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

async function postTrialRun(scenario: string, user = ADMIN, agentId = AGENT) {
  const response = await fetch(`${BASE}/agents/${agentId}/trial-run`, {
    method: "POST",
    headers: principal(user, ORG),
    body: JSON.stringify({ agentId, scenario }),
  });
  return response;
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
  nextReplyText = "trial run reply from the loopback provider";
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy ?? null);
  await addOrgMember(ORG, NON_ADMIN, "consultant", fx.teams.energy ?? null);
  await addSkillVersion(SV_A, SKILL_A, "# Skill A\ntrial run content");
  await addAgentVersion({
    versionId: V1, skillVersionIds: [SV_A], instructions: "You are the trial-run agent.",
  });
});

describe("POST /agents/:agentId/trial-run", () => {
  it("calls the real model exactly once and returns the real completion, with no agent_runs row created", async () => {
    const response = await postTrialRun("What is our onboarding checklist?");
    expect(response.status).toBe(201);
    const body = await response.json() as unknown;
    const parsed = C.operations.trialRunAgent.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    if (!parsed.success) throw new Error("unreachable");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]!.body.model).toBe(MODEL_ID);
    const system = calls[0]!.body.messages!.find((m) => m.role === "system")!.content;
    expect(system).toContain("You are the trial-run agent.");
    expect(system).toContain("# Skill A");
    expect(calls[0]!.body.messages!.find((m) => m.role === "user")!.content)
      .toBe("What is our onboarding checklist?");

    expect(parsed.data.steps).toEqual([{ ordinal: 1, text: "trial run reply from the loopback provider" }]);
    expect(parsed.data.toolCalls).toEqual([]);
    expect(parsed.data.dataRead).toEqual([]);
    expect(parsed.data.asyncTaskId).toBeNull();
    expect(parsed.data.tokens).toBe(42);
    expect(parsed.data.durationMs).toBeGreaterThanOrEqual(0);

    // Trial run ≠ private chat (contract's own note): it must not create ANY agent_runs row.
    const runs = await asApp(ORG, (c) => c.query("SELECT id FROM agent_runs WHERE org_id=$1", [ORG]));
    expect(runs.rows).toHaveLength(0);
  });

  it("refuses a non-admin with ROLE_INSUFFICIENT and never calls the model", async () => {
    const response = await postTrialRun("anything", NON_ADMIN);
    expect(response.status).toBe(403);
    const body = await response.json() as { reasonCode?: string };
    expect(body.reasonCode).toBe("ROLE_INSUFFICIENT");
    expect(calls).toHaveLength(0);
  });

  it("reports AGENT_DEPENDENCY_FAILED for an agent with no published version", async () => {
    await addAgentVersion({
      versionId: `${V1}-unpublished`, skillVersionIds: [SV_A],
      instructions: "unpublished", publish: false,
    });
    await asApp(ORG, (c) => c.query(
      "UPDATE agents SET published_version_id=NULL WHERE id=$1 AND org_id=$2", [AGENT, ORG],
    ));
    const response = await postTrialRun("anything");
    expect(response.status).toBe(503);
    const body = await response.json() as { reasonCode?: string };
    expect(body.reasonCode).toBe("AGENT_DEPENDENCY_FAILED");
    expect(calls).toHaveLength(0);
  });
});
