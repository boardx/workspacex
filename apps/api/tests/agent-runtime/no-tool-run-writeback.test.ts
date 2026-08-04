/**
 * Wave 2 / #414 — the minimal no-tool AgentRun.
 *
 * Scope of THIS file, taken from the signed delta
 * (`phases/phase-01-run-a-project/design-deltas/wave2-runtime/contract.md` §5):
 *
 *   * the run executes against the snapshot recorded at acceptance — the immutable
 *     `agentVersionId`, the ORDERED `skillVersionIds`, and the fixed provider/model;
 *   * exactly one call to exactly one configured provider, with no fallback;
 *   * durable run state and APPEND-ONLY steps;
 *   * `GET /agent-runs/:runId` is authorized;
 *   * a provider failure surfaces as a stable, REDACTED code.
 *
 * Deliberately NOT in this file, because #413 owns it: the Chat writeback. The run's
 * terminal state here is `writeback_pending`, and the assertions below prove that #414
 * writes no assistant message and fabricates no reply.
 *
 * ## Why the provider is a real HTTP server and not a stubbed port
 *
 * The thing that can actually be wrong is the ADAPTER: the request it builds, the
 * response shape it accepts, and — the one this project has been burned by (PR #310) —
 * what it puts into the client-facing error when the provider fails. A fake injected at
 * the port boundary skips all three. So the tests below run the real adapter against a
 * real socket on loopback and inspect what was actually sent. No vendor endpoint is
 * contacted, and no reply is fabricated: every assistant text asserted here came over
 * the wire from the stub.
 *
 * ## Fixtures use the REAL catalog tables
 *
 * `agents` / `agent_versions` / `skills` / `skill_versions` / `skill_version_files` are
 * the production tables from #417 and #412, written here as the app role under tenant
 * scope inside an isolated test database. The delta forbids seeding built-ins from
 * bootstrap/migrations, not writing fixtures in a test database (§3, §4).
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wave2Runtime as W } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import {
  AGENT_RUN_EXECUTOR, type AgentRunExecutorPort,
} from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-wave2-run";
const OTHER_ORG = "org-wave2-run-other";
const PROJECT = "proj-wave2-run";
const THREAD = "thread-wave2-run";
const ACTOR = "u-wave2-run-actor";
const OUTSIDER = "u-wave2-run-outsider";
const STRANGER = "u-wave2-run-stranger";

const PROVIDER = "wave2-loopback";
const API_KEY = "sk-wave2-do-not-echo-this-anywhere";

const AGENT = "agent-wave2-run";
const V1 = "agent-version-wave2-run-v1";
const V2 = "agent-version-wave2-run-v2";
const SKILL_A = "skill-wave2-run-a";
const SKILL_B = "skill-wave2-run-b";
const SV_A = "skill-version-wave2-run-a1";
const SV_B = "skill-version-wave2-run-b1";
const SV_C = "skill-version-wave2-run-c1";
const MODEL_V1 = "pinned-model-v1";
const MODEL_V2 = "head-model-v2";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── the loopback provider ─────────────────────────── */

interface CapturedCall {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: {
    model?: string;
    messages?: { role: string; content: string }[];
  };
}

interface StubReply {
  status: number;
  body: string;
  contentType?: string;
  /** Held open until the returned release function is called. */
  hold?: Promise<void>;
}

let providerServer: Server;
let providerBase = "";
let calls: CapturedCall[] = [];
let nextReply: StubReply = { status: 200, body: "" };

function replyWithText(text: string): void {
  nextReply = {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }),
  };
}

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
        path: req.url ?? "",
        authorization: typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : undefined,
        body,
      });
      const reply = nextReply;
      void Promise.resolve(reply.hold).then(() => {
        res.writeHead(reply.status, { "content-type": reply.contentType ?? "application/json" });
        res.end(reply.body);
      });
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
      [skillId, ORG, skillId, skillId, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [versionId, ORG, skillId, versionId, sha256(content), ACTOR],
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
  modelProvider?: string;
  modelId: string;
  instructions: string;
  publish?: boolean;
}): Promise<void> {
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
      [input.versionId, ORG, AGENT, input.versionId, sha256(input.instructions),
        input.instructions, input.skillVersionIds, input.modelProvider ?? PROVIDER,
        input.modelId, ACTOR],
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

async function postMessage(text: string, agentId = AGENT): Promise<{
  status: number; agentRunId: string; messageId: string;
}> {
  const response = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
    method: "POST",
    headers: principal(ACTOR, ORG),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId }),
  });
  if (response.status !== 202) return { status: response.status, agentRunId: "", messageId: "" };
  const body = await response.json() as { agentRunId: string; message: { id: string } };
  return { status: 202, agentRunId: body.agentRunId, messageId: body.message.id };
}

const getRun = (runId: string, user = ACTOR, org = ORG) =>
  fetch(`${BASE}/agent-runs/${runId}`, { headers: principal(user, org) });

/** The run projection, strict-parsed through the contract so an extra key is a failure. */
async function readRun(runId: string, user = ACTOR, org = ORG) {
  const response = await getRun(runId, user, org);
  expect(response.status).toBe(200);
  const raw = await response.json() as unknown;
  const parsed = W.AgentRunView.safeParse(raw);
  expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
  return parsed.success ? parsed.data : null!;
}

/** One tick of the SAME executor the acceptance kick drives, awaited for determinism. */
const tick = () => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(ORG));

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = API_KEY;
  // The acceptance kick is proved separately, on its own app instance, so that every
  // other test can order "publish a new head" against "execute" instead of racing it.
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
  replyWithText("durable reply from the loopback provider");
  await resetOrgs(ORG, OTHER_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addOrgMember(ORG, STRANGER, "consultant", fx.teams.platform!);
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(OTHER_ORG, OUTSIDER, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await addSkillVersion(SV_A, SKILL_A, "# Skill A\nordered first");
  await addSkillVersion(SV_B, SKILL_B, "# Skill B\nordered second");
  await addAgentVersion({
    versionId: V1, skillVersionIds: [SV_A, SV_B], modelId: MODEL_V1,
    instructions: "You are the pinned v1 agent.",
  });
});

afterEach(() => {
  nextReply = { status: 200, body: "" };
});

/* ═══════════════════════════ 1. the happy path ═══════════════════════════ */

describe("executing a queued run", () => {
  it("makes exactly one provider call and lands on writeback_pending with ordered steps", async () => {
    const { agentRunId } = await postMessage("Analyse the pinned snapshot");
    const queued = await readRun(agentRunId);
    expect(queued.status).toBe("queued");
    // `accepted` is written by the acceptance transaction, not by the executor: a queued
    // run showing an empty step list would make the step a claim about an unrecorded moment.
    expect(queued.steps.map((s) => s.kind)).toEqual(["accepted"]);
    expect(calls).toHaveLength(0);

    await tick();

    const run = await readRun(agentRunId);
    expect(run.status).toBe("writeback_pending");
    expect(run.error).toBeNull();
    // #413 owns the writeback. #414 must not invent one.
    expect(run.resultMessageId).toBeNull();
    expect(run.steps.map((s) => s.kind)).toEqual(["accepted", "context_built", "model_called"]);
    expect(run.steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(run.steps.every((s) => s.failureCode === null)).toBe(true);
    expect(calls).toHaveLength(1);

    const assistant = await asApp(ORG, (c) => c.query(
      "SELECT id FROM chat_messages WHERE thread_id=$1 AND author_kind='agent'", [THREAD],
    ));
    expect(assistant.rows).toEqual([]);
  });

  it("sends the pinned model, the credential, and the ordered Skill content", async () => {
    const { agentRunId } = await postMessage("Ordered context please");
    await tick();
    await readRun(agentRunId);

    const call = calls[0]!;
    expect(call.body.model).toBe(MODEL_V1);
    expect(call.authorization).toBe(`Bearer ${API_KEY}`);
    const system = call.body.messages!.find((m) => m.role === "system")!.content;
    expect(system).toContain("You are the pinned v1 agent.");
    // Ordered, and in the snapshot's order -- not alphabetical, not insertion order.
    expect(system.indexOf("# Skill A")).toBeGreaterThan(-1);
    expect(system.indexOf("# Skill B")).toBeGreaterThan(system.indexOf("# Skill A"));
    expect(call.body.messages!.find((m) => m.role === "user")!.content)
      .toBe("Ordered context please");
  });

  it("re-ticking a run already past queued does not call the provider a second time", async () => {
    const { agentRunId } = await postMessage("Only once");
    await tick();
    await tick();
    await tick();
    expect(calls).toHaveLength(1);
    expect((await readRun(agentRunId)).status).toBe("writeback_pending");
  });

  it("concurrent ticks claim the run once, so exactly one model call happens", async () => {
    const { agentRunId } = await postMessage("Race-safe execution");
    await Promise.all([tick(), tick(), tick()]);
    expect(calls).toHaveLength(1);
    expect((await readRun(agentRunId)).status).toBe("writeback_pending");
  });
});

/* ═════════════ 2. the snapshot is pinned, proved against a MOVED head ═════════════ */

describe("the run executes its acceptance snapshot, not the current head", () => {
  it("uses the pinned version after a NEW version becomes the published head", async () => {
    const { agentRunId } = await postMessage("Pinned at acceptance");

    // B really changes: a second immutable version with a different model and different
    // ordered Skill versions becomes the head BEFORE the run executes. Without this the
    // assertion below would hold for a head-resolving implementation too.
    await addSkillVersion(SV_C, SKILL_A, "# Skill C\nonly reachable via the new head");
    await addAgentVersion({
      versionId: V2, skillVersionIds: [SV_C], modelId: MODEL_V2,
      instructions: "You are the v2 head agent.",
    });
    const head = await asApp(ORG, (c) => c.query<{ published_version_id: string }>(
      "SELECT published_version_id FROM agents WHERE id=$1", [AGENT],
    ));
    expect(head.rows[0]!.published_version_id, "the head must really have moved").toBe(V2);

    await tick();

    const call = calls[0]!;
    expect(call.body.model).toBe(MODEL_V1);
    const system = call.body.messages!.find((m) => m.role === "system")!.content;
    expect(system).toContain("You are the pinned v1 agent.");
    expect(system).not.toContain("You are the v2 head agent.");
    expect(system).not.toContain("# Skill C");

    const run = await readRun(agentRunId);
    expect(run.agentVersionId).toBe(V1);
    expect(run.skillVersionIds).toEqual([SV_A, SV_B]);
    expect(run.modelId).toBe(MODEL_V1);
  });

  /**
   * `agent_versions.skill_version_ids` is a `text[]` with no foreign key, so a version can
   * name a Skill version this repository cannot read (#417's import validates at import
   * time; nothing revalidates afterwards). The run must refuse rather than proceed with
   * the subset it happened to find.
   */
  it("fails closed when a pinned Skill version is unreachable, rather than dropping it", async () => {
    await asApp(ORG, (c) => c.query(
      "UPDATE agents SET published_version_id=NULL WHERE id=$1", [AGENT],
    ));
    await addAgentVersion({
      versionId: V2, skillVersionIds: [SV_A, "skill-version-not-in-this-repository"],
      modelId: MODEL_V1, instructions: "Pins a Skill version that is not here.",
    });
    const { agentRunId } = await postMessage("Pinned skills must exist");

    await tick();

    const run = await readRun(agentRunId);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("SKILL_VERSION_UNAVAILABLE");
    expect(calls, "a run missing pinned context must not reach the provider").toHaveLength(0);
    const contextStep = run.steps.find((s) => s.kind === "context_built")!;
    expect(contextStep.status).toBe("failed");
    expect(contextStep.failureCode).toBe("SKILL_VERSION_UNAVAILABLE");
  });

  /**
   * `agent_runs.agent_version_id` has no foreign key, so a claimed run can point at a
   * version this repository cannot read. Found the hard way: the first version of this
   * executor SKIPPED such runs, which left them `running` with no step and no terminal
   * state -- a message that is simply never answered and nothing to look at.
   */
  it("gives a claimed run a terminal state when its snapshot is no longer resolvable", async () => {
    const { agentRunId } = await postMessage("Snapshot points at nothing");
    await asApp(ORG, (c) => c.query(
      "UPDATE agent_runs SET agent_version_id='agent-version-that-is-gone' WHERE id=$1",
      [agentRunId],
    ));

    await tick();

    const run = await readRun(agentRunId);
    expect(run.status, "a claimed run must never be left in `running`").toBe("failed");
    expect(run.error).toBe("AGENT_VERSION_UNAVAILABLE");
    expect(calls).toHaveLength(0);
  });
});

/* ═════════════ 3. one provider, no fallback, redacted failure ═════════════ */

describe("provider failure and single-provider discipline", () => {
  it("reports a stable code and leaks nothing about the provider response", async () => {
    const secret = "upstream said: api_key=sk-LEAKED-SECRET at https://vendor.internal/v1";
    nextReply = { status: 500, body: JSON.stringify({ error: { message: secret } }) };
    const { agentRunId } = await postMessage("Provider will fail");

    await tick();

    const response = await getRun(agentRunId);
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const leak of [secret, "sk-LEAKED-SECRET", API_KEY, "vendor.internal", providerBase,
      "127.0.0.1", "at Object.", "node:internal"]) {
      expect(text, `redaction leak: ${leak}`).not.toContain(leak);
    }
    // Non-vacuity for the loop above: the same matcher, aimed at something the response
    // really does contain. Without this, a response body of `{}` would satisfy every
    // `not.toContain` line and the redaction claim would be untested.
    expect(text).toContain(agentRunId);
    const run = W.AgentRunView.parse(JSON.parse(text));
    expect(run.status).toBe("failed");
    expect(run.error).toBe("MODEL_CALL_FAILED");
    const modelStep = run.steps.find((s) => s.kind === "model_called")!;
    expect(modelStep.status).toBe("failed");
    expect(modelStep.failureCode).toBe("MODEL_CALL_FAILED");
    // No retry loop inside the slice: one call, one recorded failure.
    expect(calls).toHaveLength(1);
  });

  /**
   * The redaction test above proves the code that runs today does not leak. This one
   * proves the CHANNEL is closed: PR #310's mistake was writing `String(err)` into the
   * field a client reads, and the fix that survives is a column that cannot hold it.
   */
  it("closes the leak channel at the database: a free-text error code is refused", async () => {
    const { agentRunId } = await postMessage("Error code is an enumeration");
    await asApp(ORG, async (c) => {
      await expect(c.query(
        "UPDATE agent_runs SET status='failed', error_code=$2 WHERE id=$1",
        [agentRunId, "upstream 500: api_key=sk-LEAKED at https://vendor.internal/v1"],
      )).rejects.toThrow();
    });
    // Non-vacuity: the same role, same statement shape, with a legal code.
    await asApp(ORG, (c) => c.query(
      "UPDATE agent_runs SET status='failed', error_code='MODEL_CALL_FAILED' WHERE id=$1",
      [agentRunId],
    ));
    expect((await readRun(agentRunId)).error).toBe("MODEL_CALL_FAILED");
  });

  it("fails rather than fabricating a reply when the provider returns no content", async () => {
    nextReply = { status: 200, body: JSON.stringify({ choices: [] }) };
    const { agentRunId } = await postMessage("Empty completion");
    await tick();
    const run = await readRun(agentRunId);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("MODEL_CALL_FAILED");
  });

  it("does not fall back to the configured provider when the snapshot names another", async () => {
    await asApp(ORG, (c) => c.query(
      "UPDATE agents SET published_version_id=NULL WHERE id=$1", [AGENT],
    ));
    await addAgentVersion({
      versionId: V2, skillVersionIds: [SV_A], modelProvider: "some-other-vendor",
      modelId: "some-other-model", instructions: "Different provider.",
    });
    const { agentRunId } = await postMessage("Unconfigured provider");

    await tick();

    const run = await readRun(agentRunId);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("MODEL_PROVIDER_NOT_CONFIGURED");
    expect(run.modelProvider).toBe("some-other-vendor");
    expect(calls, "falling back to the configured provider is the failure mode").toHaveLength(0);
  });
});

/* ═════════════════════════ 4. authorization on the read ═════════════════════════ */

describe("GET /agent-runs/:runId authorization", () => {
  it("refuses an unauthenticated read with 401 and no body detail", async () => {
    const { agentRunId } = await postMessage("Authorized reads only");
    const response = await fetch(`${BASE}/agent-runs/${agentRunId}`);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(agentRunId);
  });

  it("refuses another organization's member and another project's member", async () => {
    const { agentRunId } = await postMessage("Tenant isolated");
    // I-3: existence is not disclosed on the read path, so both denials share one exit.
    expect((await getRun(agentRunId, OUTSIDER, OTHER_ORG)).status).toBe(404);
    expect((await getRun(agentRunId, STRANGER, ORG)).status).toBe(404);
  });

  it("returns the run to the thread's authorized member", async () => {
    const { agentRunId, messageId } = await postMessage("Visible to its author");
    const run = await readRun(agentRunId);
    expect(run.runId).toBe(agentRunId);
    expect(run.inputMessageId).toBe(messageId);
    expect(run.threadId).toBe(THREAD);
  });

  it("returns 404 for a run id that does not exist", async () => {
    expect((await getRun("run-does-not-exist")).status).toBe(404);
  });
});

/* ═════════════════════════ 5. steps are append-only ═════════════════════════ */

describe("run steps are append-only in the database, not by convention", () => {
  it("refuses UPDATE and DELETE as the role that serves traffic, while INSERT works", async () => {
    const { agentRunId } = await postMessage("Append only");
    await tick();
    await readRun(agentRunId);

    await asApp(ORG, async (c) => {
      await expect(c.query(
        "UPDATE agent_run_steps SET status='succeeded' WHERE run_id=$1", [agentRunId],
      )).rejects.toThrow();
    });
    await asApp(ORG, async (c) => {
      await expect(c.query(
        "DELETE FROM agent_run_steps WHERE run_id=$1", [agentRunId],
      )).rejects.toThrow();
    });
    // Non-vacuity: the same role, same table, INSERT -- so the two refusals above are
    // about UPDATE/DELETE and not about the role being unable to touch the table at all.
    await asApp(ORG, async (c) => {
      await c.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,input_digest,output_digest)
         VALUES ($1,$2,$3,99,'chat_writeback','succeeded',now(),now(),NULL,NULL)`,
        [randomUUID(), ORG, agentRunId],
      );
    });
  });

  /**
   * Measured, not assumed: re-running the test above with `GRANT UPDATE, DELETE` added
   * left every assertion green, because the trigger caught it. Each half is sufficient
   * alone today, so the behavioural refusal cannot tell you whether both are still there
   * -- and the day one is dropped is the day the other becomes the only thing standing.
   */
  it("keeps BOTH mechanisms, since the behavioural test alone cannot see either", async () => {
    const privileges = await asOwner((c) => c.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE table_name='agent_run_steps' AND grantee='app_rw'`,
    ));
    expect(new Set(privileges.rows.map((r) => r.privilege_type)))
      .toEqual(new Set(["SELECT", "INSERT"]));

    const trigger = await asOwner((c) => c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid='agent_run_steps'::regclass AND NOT tgisinternal`,
    ));
    expect(trigger.rows.map((r) => r.tgname)).toContain("agent_run_steps_append_only_trg");
  });

  it("keeps the database's step vocabulary and the contract's enum as one fact", async () => {
    const constraint = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_run_steps'::regclass AND conname='agent_run_steps_kind_check'`,
    ));
    const declared = [...constraint.rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(declared.length, "read zero kinds -- this assertion would pass vacuously")
      .toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set(W.AgentRunStepKind.options));
  });
});

/* ═════════════════════ 6. the status machine is enforced ═════════════════════ */

describe("the run status machine is enforced, not merely described", () => {
  it("refuses queued -> succeeded, and refuses leaving a terminal state", async () => {
    const { agentRunId } = await postMessage("Status machine");

    // §5's whole point: `succeeded` may only be reached after #413's writeback commits.
    // A run that can jump straight there is a run that can claim an answer nobody wrote.
    await asApp(ORG, async (c) => {
      await expect(c.query(
        "UPDATE agent_runs SET status='succeeded' WHERE id=$1", [agentRunId],
      )).rejects.toThrow();
    });

    // Non-vacuity: the legal move, same role, same statement shape.
    await asApp(ORG, (c) => c.query(
      "UPDATE agent_runs SET status='running' WHERE id=$1", [agentRunId],
    ));
    expect((await readRun(agentRunId)).status).toBe("running");

    await asApp(ORG, (c) => c.query(
      "UPDATE agent_runs SET status='failed', error_code='MODEL_CALL_FAILED' WHERE id=$1",
      [agentRunId],
    ));
    await asApp(ORG, async (c) => {
      await expect(c.query(
        "UPDATE agent_runs SET status='running', error_code=NULL WHERE id=$1", [agentRunId],
      )).rejects.toThrow();
    });
    expect((await readRun(agentRunId)).status).toBe("failed");
  });
});

/* ═════════════════════ 7. the acceptance kick is really wired ═════════════════════ */

describe("acceptance kicks execution when autostart is enabled", () => {
  it("reaches writeback_pending without any explicit tick", async () => {
    process.env.KERNEL_AGENT_RUN_AUTOSTART = "1";
    const { createApp } = await import("../../src/main");
    const live = await createApp();
    await live.listen(0);
    const addr = live.getHttpServer().address();
    const liveBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      const accepted = await fetch(`${liveBase}/chat/threads/${THREAD}/messages`, {
        method: "POST",
        headers: principal(ACTOR, ORG),
        body: JSON.stringify({
          clientMessageId: randomUUID(), text: "Kicked by acceptance", agentId: AGENT,
        }),
      });
      expect(accepted.status).toBe(202);
      const { agentRunId } = await accepted.json() as { agentRunId: string };

      // Bounded backoff, stopping at a terminal-for-#414 status (contract §5).
      let status = "queued";
      for (let attempt = 0; attempt < 60 && status !== "writeback_pending" && status !== "failed"; attempt++) {
        await new Promise((r) => setTimeout(r, 100));
        const view = await fetch(`${liveBase}/agent-runs/${agentRunId}`, {
          headers: principal(ACTOR, ORG),
        });
        status = (await view.json() as { status: string }).status;
      }
      expect(status).toBe("writeback_pending");
      expect(calls).toHaveLength(1);
    } finally {
      await live.close();
      process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
    }
  });
});
