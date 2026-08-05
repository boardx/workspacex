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

/* ─────────────────────── #413 writeback helpers ─────────────────────── */

interface AssistantRow {
  id: string;
  body: string;
  author_kind: string;
  agent_id: string | null;
  reply_to_message_id: string | null;
}

/**
 * Every assistant row the run produced -- the LIST, never a count of successful calls.
 *
 * #19's lesson, restated because this file is where it bites: asserting "the writeback
 * reported success once" is satisfied by an implementation that inserted five rows and
 * happened to return one. The only question worth asking the database is how many rows
 * are actually in it, so every idempotency assertion below reads this and checks `.length`.
 */
const assistantRowsFor = (runId: string) => asApp(ORG, (c) => c.query<AssistantRow>(
  `SELECT id, body, author_kind, agent_id, reply_to_message_id
     FROM chat_messages WHERE agent_run_id=$1 ORDER BY id`,
  [runId],
)).then((r) => r.rows);

/**
 * Put a run into `writeback_pending` with a stored output, the way #414's executor leaves
 * it, but WITHOUT running the model call.
 *
 * Needed because the writeback race this file has to prove is between concurrent attempts
 * on an ALREADY pending run. Driving it through `tick()` cannot produce that state: the
 * `queued -> running` claim serialises the model call, so racing ticks would be racing the
 * claim (which #414 already proves) instead of racing the writeback.
 */
/**
 * Model output that this file's injected trigger refuses to store as a Chat message.
 *
 * ⚠ This exists because the FIRST version of the two writeback-failure tests below injected
 * the failure with `REVOKE INSERT ON chat_messages FROM app_rw`, and that was a real defect
 * in this test file, not a stylistic problem. A privilege is DATABASE-WIDE, vitest runs test
 * files four at a time against ONE Postgres (`vitest.config.ts` -> `maxWorkers: 4`), and
 * every other file's fixtures insert `chat_messages`. It took `thread-badge-single-source`
 * down in CI, non-deterministically, depending purely on which file happened to be seeding
 * during the revoke window.
 *
 * Measured, not reasoned: with the revoke applied, `INSERT INTO chat_messages` for
 * `org-f109badge` -- another file's org, nothing to do with this one -- fails with
 * "permission denied for table chat_messages", while the identical insert succeeds a moment
 * before. That is the whole bug.
 *
 * The replacement is scoped two ways at once: the trigger fires only for THIS file's org AND
 * only for a body carrying this sentinel prefix, so no other file can observe it even while
 * it is installed. Its DDL runs twice per file (beforeAll/afterAll) rather than twice per
 * test, so it also stops taking a table-level lock in the middle of a parallel run.
 */
const INJECT = "WAVE2-INJECT-WRITEBACK-FAILURE::";

async function installWritebackFailureInjector(): Promise<void> {
  await asOwner((c) => c.query(`
    CREATE OR REPLACE FUNCTION wave2_test_break_writeback() RETURNS trigger AS $fn$
    BEGIN
      IF NEW.org_id = '${ORG}' AND NEW.body LIKE '${INJECT}%' THEN
        RAISE EXCEPTION 'injected writeback failure for %', NEW.agent_run_id;
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS wave2_test_break_writeback_trg ON chat_messages;
    CREATE TRIGGER wave2_test_break_writeback_trg BEFORE INSERT ON chat_messages
      FOR EACH ROW EXECUTE FUNCTION wave2_test_break_writeback();
  `));
}

async function removeWritebackFailureInjector(): Promise<void> {
  await asOwner((c) => c.query(
    "DROP TRIGGER IF EXISTS wave2_test_break_writeback_trg ON chat_messages",
  ));
}

async function forceWritebackPending(runId: string, text: string): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query("UPDATE agent_runs SET status='running' WHERE id=$1", [runId]);
    await c.query(
      "UPDATE agent_runs SET status='writeback_pending', model_output=$2 WHERE id=$1",
      [runId, text],
    );
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
  // The acceptance kick is proved separately, on its own app instance, so that every
  // other test can order "publish a new head" against "execute" instead of racing it.
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  // Installed once per file, after the migrations it depends on. Scoped to this org and
  // this sentinel body, so a parallel worker cannot see it -- see `INJECT`.
  await installWritebackFailureInjector();
}, 180_000);

afterAll(async () => {
  await removeWritebackFailureInjector();
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
  /**
   * ⚠ Terminal state UPDATED by #413, not relaxed.
   *
   * Before the writeback existed this test ended at `writeback_pending` with NO assistant
   * message, and that was the correct end of #414's slice. Now that §6 is implemented the
   * same tick carries the run to `succeeded`, so the assertions move with the behaviour.
   * The two claims that mattered are kept and made stronger: still EXACTLY one provider
   * call, and the reply is not fabricated -- its body is compared to the exact bytes the
   * stub put on the wire, rather than merely asserted to exist.
   */
  it("makes exactly one provider call and runs the ordered steps through to succeeded", async () => {
    replyWithText("durable reply from the loopback provider");
    const { agentRunId } = await postMessage("Analyse the pinned snapshot");
    const queued = await readRun(agentRunId);
    expect(queued.status).toBe("queued");
    // `accepted` is written by the acceptance transaction, not by the executor: a queued
    // run showing an empty step list would make the step a claim about an unrecorded moment.
    expect(queued.steps.map((s) => s.kind)).toEqual(["accepted"]);
    expect(calls).toHaveLength(0);

    await tick();

    const run = await readRun(agentRunId);
    expect(run.status).toBe("succeeded");
    expect(run.error).toBeNull();
    expect(run.steps.map((s) => s.kind))
      .toEqual(["accepted", "context_built", "model_called", "chat_writeback"]);
    expect(run.steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(run.steps.every((s) => s.failureCode === null)).toBe(true);
    expect(calls).toHaveLength(1);

    const assistant = await asApp(ORG, (c) => c.query<{ id: string; body: string }>(
      "SELECT id, body FROM chat_messages WHERE thread_id=$1 AND author_kind='agent'", [THREAD],
    ));
    expect(assistant.rows).toHaveLength(1);
    expect(assistant.rows[0]!.body).toBe("durable reply from the loopback provider");
    expect(run.resultMessageId).toBe(assistant.rows[0]!.id);
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

  it("re-ticking a completed run calls the provider once and leaves one message", async () => {
    const { agentRunId } = await postMessage("Only once");
    await tick();
    await tick();
    await tick();
    expect(calls).toHaveLength(1);
    expect((await readRun(agentRunId)).status).toBe("succeeded");
    // Added by #413: re-ticking must not answer the same message twice either.
    expect(await assistantRowsFor(agentRunId)).toHaveLength(1);
  });

  it("concurrent ticks claim the run once, so exactly one model call happens", async () => {
    const { agentRunId } = await postMessage("Race-safe execution");
    await Promise.all([tick(), tick(), tick()]);
    expect(calls).toHaveLength(1);
    expect((await readRun(agentRunId)).status).toBe("succeeded");
    expect(await assistantRowsFor(agentRunId)).toHaveLength(1);
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
  it("reaches the terminal succeeded state without any explicit tick", async () => {
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

      // Bounded backoff, stopping at a TERMINAL status (contract §5). Since #413 the
      // terminal success is `succeeded`; `writeback_pending` is now an intermediate state.
      let status = "queued";
      for (let attempt = 0; attempt < 60 && status !== "succeeded" && status !== "failed"; attempt++) {
        await new Promise((r) => setTimeout(r, 100));
        const view = await fetch(`${liveBase}/agent-runs/${agentRunId}`, {
          headers: principal(ACTOR, ORG),
        });
        status = (await view.json() as { status: string }).status;
      }
      expect(status).toBe("succeeded");
      expect(calls).toHaveLength(1);
      expect(await assistantRowsFor(agentRunId)).toHaveLength(1);
    } finally {
      await live.close();
      process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
    }
  });
});

/* ═════════════════════ 8. the Chat writeback (#413, delta §6) ═════════════════════ */

/**
 * Wave 2 / #413 — the idempotent Chat writeback.
 *
 * Scope taken from `contract.md` §6 (VERIFIED section number: §5 is #414's minimal run and
 * §4 is #417's Agent persistence; the issue body's "§5" is off by one).
 *
 *   * after the model call the executor stores the output and enters `writeback_pending`;
 *   * the writeback inserts ONE assistant message keyed by `(agentRunId, replyToMessageId)`;
 *   * a unique `agentRunId` constraint makes a retry return the EXISTING message;
 *   * the run becomes `succeeded` only after that transaction commits;
 *   * exhaustion produces `failed` / `CHAT_WRITEBACK_FAILED`, never a synthetic reply.
 *
 * ## The idempotency mechanism is REUSED, not reinvented
 *
 * `chat_messages_agent_run_idx` — `UNIQUE (org_id, agent_run_id) WHERE author_kind='agent'`
 * — already exists from #415
 * (`apps/api/migrations/20260804060000_wave2_chat_message_acceptance.sql:16`). #413 adds no
 * second uniqueness mechanism and no `result_message_id` column; `resultMessageId` stays a
 * projection over that index (`pg-agent-run-repository.ts:207`). Note that the human
 * `clientMessageId` index at line 12 of the same migration is partial on
 * `author_kind = 'human'`, so it structurally cannot dedupe an assistant row — the
 * agentRunId index is the single source of truth §6 names verbatim.
 */
describe("the Chat writeback is exactly-once and terminal only after it commits", () => {
  it("writes one assistant message linked to the run and the human message, then succeeds",
    async () => {
      replyWithText("the durable assistant reply");
      const { agentRunId, messageId } = await postMessage("Write me back");

      await tick();

      const run = await readRun(agentRunId);
      expect(run.status).toBe("succeeded");
      expect(run.error).toBeNull();
      expect(run.steps.map((s) => s.kind))
        .toEqual(["accepted", "context_built", "model_called", "chat_writeback"]);
      expect(run.steps.every((s) => s.status === "succeeded")).toBe(true);

      const rows = await assistantRowsFor(agentRunId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.author_kind).toBe("agent");
      expect(rows[0]!.agent_id).toBe(AGENT);
      // Both links §6 names, and the text really came over the wire from the stub.
      expect(rows[0]!.reply_to_message_id).toBe(messageId);
      expect(rows[0]!.body).toBe("the durable assistant reply");
      expect(run.resultMessageId).toBe(rows[0]!.id);
    });

  /**
   * The retry assertion that actually means something.
   *
   * Ten concurrent writeback attempts on one pending run, then COUNT THE ROWS. Asserting
   * "the writeback returned success once" would be satisfied by an implementation where
   * ten winners wrote ten messages, which is the exact shape #19 shipped.
   */
  it("keeps exactly one row when many writeback attempts race the same run", async () => {
    const { agentRunId } = await postMessage("Race the writeback");
    await forceWritebackPending(agentRunId, "only one of me may exist");

    await Promise.all(Array.from({ length: 10 }, () => tick()));

    const rows = await assistantRowsFor(agentRunId);
    expect(rows, "ten attempts must leave one row, not ten").toHaveLength(1);
    const run = await readRun(agentRunId);
    expect(run.status).toBe("succeeded");
    expect(run.resultMessageId).toBe(rows[0]!.id);
  });

  /**
   * The crash-recovery path: the message committed but the run never reached `succeeded`.
   *
   * ⚠ This test was written a first time as "tick, then tick twice more" and it was
   * VACUOUS. After the first tick the run is `succeeded`, so the later ticks select nothing
   * and the row count trivially stays 1 -- it passed even with the unique index DROPPED,
   * measured, not assumed. The retry path only exists while the run is still
   * `writeback_pending`, so the message has to be planted underneath a pending run.
   */
  it("a retry over an already-written message adopts it instead of inserting a second",
    async () => {
      const { agentRunId, messageId } = await postMessage("Retry is a no-op");
      await forceWritebackPending(agentRunId, "written once");

      // Exactly what a process death between the INSERT and the status update leaves behind.
      const planted = randomUUID();
      await asApp(ORG, (c) => c.query(
        `INSERT INTO chat_messages
           (id,org_id,thread_id,author_kind,author_id,agent_id,body,
            agent_run_id,reply_to_message_id)
         VALUES ($1,$2,$3,'agent',$4,$4,'written once',$5,$6)`,
        [planted, ORG, THREAD, AGENT, agentRunId, messageId],
      ));
      expect((await readRun(agentRunId)).status).toBe("writeback_pending");

      await tick();

      const rows = await assistantRowsFor(agentRunId);
      expect(rows, "the retry must adopt the existing row, not add one").toHaveLength(1);
      expect(rows[0]!.id).toBe(planted);
      const run = await readRun(agentRunId);
      expect(run.status).toBe("succeeded");
      expect(run.resultMessageId).toBe(planted);
    });

  /**
   * §6: "Only after that transaction commits may the run become `succeeded`."
   *
   * Enforced in the database, not by convention, for the same reason #414 put the status
   * machine in a trigger: the illegal move is a WRITE ("the model answered, mark it done")
   * and the damage is a run that claims an answer no human can read.
   */
  it("refuses at the database to mark a run succeeded with no assistant message", async () => {
    const { agentRunId } = await postMessage("No message, no success");
    await forceWritebackPending(agentRunId, "not written back yet");

    await asApp(ORG, async (c) => {
      await expect(c.query(
        "UPDATE agent_runs SET status='succeeded' WHERE id=$1", [agentRunId],
      )).rejects.toThrow();
    });

    // Non-vacuity: the SAME statement, same role, once the message really exists.
    await tick();
    expect(await assistantRowsFor(agentRunId)).toHaveLength(1);
    expect((await readRun(agentRunId)).status).toBe("succeeded");
  });

  /**
   * A failing writeback must not be terminal on the first try (§6: "the run stays
   * non-terminal for bounded retry"), and must never invent a reply.
   *
   * The failure is a real refusal from the database at the real seam -- the INSERT inside
   * `commitWriteback` throws -- rather than a stubbed rejection at a port boundary. See
   * `INJECT` above for why it is scoped to this org and this body instead of a privilege.
   */
  it("stays non-terminal for bounded retry, then fails with CHAT_WRITEBACK_FAILED", async () => {
    const { agentRunId, messageId } = await postMessage("Writeback will fail");
    await forceWritebackPending(agentRunId, `${INJECT}this must never reach the thread`);

    await tick();
    const afterOne = await readRun(agentRunId);
    expect(afterOne.status, "one failed attempt must not be terminal").toBe("writeback_pending");
    expect(afterOne.error).toBeNull();

    // Exhaust the bounded budget.
    await tick();
    await tick();
    await tick();

    const exhausted = await readRun(agentRunId);
    expect(exhausted.status).toBe("failed");
    expect(exhausted.error).toBe("CHAT_WRITEBACK_FAILED");
    const step = exhausted.steps.find((s) => s.kind === "chat_writeback")!;
    expect(step.status).toBe("failed");
    expect(step.failureCode).toBe("CHAT_WRITEBACK_FAILED");
    // Never a synthetic success message, and the human's message is still there.
    expect(await assistantRowsFor(agentRunId)).toHaveLength(0);

    const human = await asApp(ORG, (c) => c.query<{ id: string }>(
      "SELECT id FROM chat_messages WHERE id=$1", [messageId],
    ));
    expect(human.rows, "the human message must remain visible").toHaveLength(1);
  });

  it("leaks nothing about the writeback failure through the client-facing read", async () => {
    const { agentRunId } = await postMessage("Redacted writeback failure");
    await forceWritebackPending(agentRunId, `${INJECT}secret-body-sk-DO-NOT-LEAK`);

    for (let i = 0; i < 4; i++) await tick();

    const text = await (await getRun(agentRunId)).text();
    for (const leak of ["secret-body-sk-DO-NOT-LEAK", "injected writeback failure",
      "chat_messages", "app_rw", "at Object.", "node:internal", "PostgresError"]) {
      expect(text, `redaction leak: ${leak}`).not.toContain(leak);
    }
    // Non-vacuity for the loop above, exactly as the #414 redaction test does it.
    expect(text).toContain(agentRunId);
    expect(W.AgentRunView.parse(JSON.parse(text)).error).toBe("CHAT_WRITEBACK_FAILED");
  });

  it("keeps the database's error vocabulary and the contract's enum as one fact", async () => {
    const constraint = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_runs'::regclass AND conname='agent_runs_error_code_check'`,
    ));
    const declared = [...constraint.rows[0]!.def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    expect(declared.length, "read zero codes -- this assertion would pass vacuously")
      .toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set(W.AgentRunError.options));
  });
});

/* ═══════════ 9. retrying an exhausted writeback (#519, delta §6) ═══════════ */

/**
 * Wave 2 / #519 — retry after the writeback budget is exhausted.
 *
 * ## The one thing every assertion here exists to stop
 *
 * §6's prose says the human is offered "a NEW run associated with the same input message".
 * `agent_runs` carries `UNIQUE (org_id, input_message_id)` (#415), so a second run for that
 * message CANNOT EXIST. coord-main's ruling on #519: the constraint wins and the prose is
 * amended — retry RESETS the existing run. So the load-bearing assertion in this section is
 * `runsForInputMessage(...)` staying at ONE row with the SAME id, because the tempting wrong
 * implementation (relax the unique index, insert a second run) would satisfy every other
 * assertion below.
 *
 * ## Why the reset target is `writeback_pending` and not `queued`
 *
 * DELIBERATE DEVIATION from the issue's written direction, flagged in the PR as a decision
 * for human sign-off. `queued` is the executor's claim state: `claimQueued` would pick the
 * run up and make a SECOND model call for one human message. That contradicts §5's single
 * call, and `writeback.ts`'s header ("a retry writes back the output the ONE model call
 * already produced and stored... would make a writeback failure silently change the answer a
 * human eventually reads"). What ran out was the WRITEBACK budget, so the writeback is what
 * is retried. `expect(calls)` below is the mechanical guard on this: a reset to `queued`
 * turns those assertions red.
 *
 * ## The step log is append-only, so a retry does not overwrite the failure
 *
 * The exhausted attempt's `chat_writeback` / `failed` step stays. The retry's attempt is a
 * NEW step at a higher `seq`, keyed by the run's retry generation so that concurrent
 * writeback attempts within one generation still collapse to one row.
 */
describe("retrying a run whose writeback budget was exhausted (#519)", () => {
  /** Every run row that points at one input message. The count is the whole point. */
  const runsForInputMessage = (messageId: string) =>
    asApp(ORG, (c) => c.query<{ id: string; status: string; error_code: string | null }>(
      `SELECT id, status, error_code FROM agent_runs WHERE input_message_id=$1 ORDER BY id`,
      [messageId],
    )).then((r) => r.rows);

  const stepRows = (runId: string) =>
    asApp(ORG, (c) => c.query<{ seq: number; kind: string; status: string }>(
      `SELECT seq, kind, status FROM agent_run_steps WHERE run_id=$1 ORDER BY seq`,
      [runId],
    )).then((r) => r.rows);

  const postRetry = (runId: string, user = ACTOR, org = ORG) =>
    fetch(`${BASE}/agent-runs/${runId}/retries`, {
      method: "POST", headers: principal(user, org),
    });

  /** Drive a fresh run all the way to `failed` / `CHAT_WRITEBACK_FAILED`. */
  async function exhaust(text: string): Promise<{ agentRunId: string; messageId: string }> {
    const posted = await postMessage(text);
    await forceWritebackPending(posted.agentRunId, `${INJECT}${text}`);
    for (let i = 0; i < 4; i++) await tick();
    const run = await readRun(posted.agentRunId);
    expect(run.status, "fixture precondition: the run must really be exhausted").toBe("failed");
    expect(run.error).toBe("CHAT_WRITEBACK_FAILED");
    expect(await assistantRowsFor(posted.agentRunId)).toHaveLength(0);
    return posted;
  }

  it("resets the SAME run instead of creating a second one for the input message", async () => {
    const { agentRunId, messageId } = await exhaust("retry me, do not clone me");

    const response = await postRetry(agentRunId);
    expect(response.status).toBe(200);
    const parsed = W.AgentRunView.safeParse(await response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const view = parsed.success ? parsed.data : null!;

    // The ruling, asserted as a row count rather than as a status.
    const rows = await runsForInputMessage(messageId);
    expect(rows, "retry must reset one run, never insert a second for the same message")
      .toHaveLength(1);
    expect(rows[0]!.id).toBe(agentRunId);
    expect(view.runId).toBe(agentRunId);
    expect(view.inputMessageId).toBe(messageId);

    // Reopened, with the terminal failure cleared so the run is not "failed but running".
    expect(rows[0]!.status).toBe("writeback_pending");
    expect(rows[0]!.error_code).toBeNull();
    expect(view.status).toBe("writeback_pending");
    expect(view.error).toBeNull();
    expect(view.resultMessageId).toBeNull();
  });

  it("keeps the input-message uniqueness the reset exists to protect", async () => {
    const index = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_runs'::regclass AND contype='u'
          AND pg_get_constraintdef(oid) LIKE '%input_message_id%'`,
    ));
    expect(index.rows, "the constraint #519 refused to relax must still exist").toHaveLength(1);
    expect(index.rows[0]!.def).toContain("org_id");
    expect(index.rows[0]!.def).toContain("input_message_id");
  });

  it("writes the answer the ONE model call already produced, without calling the model again",
    async () => {
      // A real end-to-end run, so `model_output` is the stub's bytes rather than a fixture's.
      replyWithText(`${INJECT}the answer that could not be written back`);
      const posted = await postMessage("One call, two writeback generations");
      await tick();
      const failedFirst = await readRun(posted.agentRunId);
      expect(failedFirst.status).toBe("writeback_pending");
      await tick(); await tick(); await tick();
      expect((await readRun(posted.agentRunId)).error).toBe("CHAT_WRITEBACK_FAILED");
      expect(calls, "the failing writeback must not re-call the provider").toHaveLength(1);

      expect((await postRetry(posted.agentRunId)).status).toBe(200);

      // The operator fixed whatever was rejecting the insert; now the retry can commit.
      await removeWritebackFailureInjector();
      try {
        await tick();
      } finally {
        await installWritebackFailureInjector();
      }

      const run = await readRun(posted.agentRunId);
      expect(run.status).toBe("succeeded");
      expect(run.error).toBeNull();
      // THE deviation guard: a reset to `queued` would make this 2.
      expect(calls, "retry must not make a second model call").toHaveLength(1);

      const rows = await assistantRowsFor(posted.agentRunId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body, "the reply must be the bytes the single call returned")
        .toBe(`${INJECT}the answer that could not be written back`);
      expect(rows[0]!.reply_to_message_id).toBe(posted.messageId);
      expect(run.resultMessageId).toBe(rows[0]!.id);
    });

  it("appends the retry's writeback step instead of rewriting the failed one", async () => {
    const { agentRunId } = await exhaust("append, do not overwrite");
    const before = await stepRows(agentRunId);
    expect(before.filter((s) => s.kind === "chat_writeback")).toEqual([
      { seq: 4, kind: "chat_writeback", status: "failed" },
    ]);

    expect((await postRetry(agentRunId)).status).toBe(200);
    await removeWritebackFailureInjector();
    try {
      await tick();
    } finally {
      await installWritebackFailureInjector();
    }

    const after = await stepRows(agentRunId);
    expect(
      after.filter((s) => s.kind === "chat_writeback"),
      "the exhausted attempt stays on the record and the retry is a new step",
    ).toEqual([
      { seq: 4, kind: "chat_writeback", status: "failed" },
      { seq: 5, kind: "chat_writeback", status: "succeeded" },
    ]);
    expect((await readRun(agentRunId)).status).toBe("succeeded");
  });

  it("collapses concurrent writeback attempts within one retry generation to one row",
    async () => {
      const { agentRunId } = await exhaust("race the retry");
      expect((await postRetry(agentRunId)).status).toBe(200);

      await removeWritebackFailureInjector();
      try {
        await Promise.all(Array.from({ length: 10 }, () => tick()));
      } finally {
        await installWritebackFailureInjector();
      }

      expect(await assistantRowsFor(agentRunId), "ten retry ticks, one reply").toHaveLength(1);
      const writebacks = (await stepRows(agentRunId)).filter((s) => s.kind === "chat_writeback");
      expect(writebacks, "ten retry ticks, one new step").toHaveLength(2);
      expect((await readRun(agentRunId)).status).toBe("succeeded");
    });

  it("refuses to retry a run that did not exhaust its writeback budget", async () => {
    // `succeeded` — the answer is already in the thread; a retry would be a second reply.
    const done = await postMessage("Already answered");
    await tick();
    expect((await readRun(done.agentRunId)).status).toBe("succeeded");
    expect((await postRetry(done.agentRunId)).status).toBe(409);
    expect(await assistantRowsFor(done.agentRunId)).toHaveLength(1);

    // `writeback_pending` — the bounded budget has not run out, nothing to reopen.
    const pending = await postMessage("Still trying");
    await forceWritebackPending(pending.agentRunId, `${INJECT}still trying`);
    await tick();
    expect((await readRun(pending.agentRunId)).status).toBe("writeback_pending");
    expect((await postRetry(pending.agentRunId)).status).toBe(409);
  });

  it("refuses the reopening at the database, not only in the application", async () => {
    const done = await postMessage("Terminal means terminal");
    await tick();
    expect((await readRun(done.agentRunId)).status).toBe("succeeded");

    await asApp(ORG, async (c) => {
      await expect(c.query(
        `UPDATE agent_runs SET status='writeback_pending', writeback_attempts=0
          WHERE id=$1`, [done.agentRunId],
      )).rejects.toThrow();
    });
    expect((await readRun(done.agentRunId)).status).toBe("succeeded");

    // Non-vacuity: the SAME statement shape, same role, on a run that IS retryable.
    const { agentRunId } = await exhaust("this one may reopen");
    await asApp(ORG, (c) => c.query(
      `UPDATE agent_runs SET status='writeback_pending', error_code=NULL,
              writeback_attempts=0, retry_count=retry_count+1, ended_at=NULL
        WHERE id=$1`, [agentRunId],
    ));
    expect((await readRun(agentRunId)).status).toBe("writeback_pending");
  });

  it("answers 404 for a retry nobody in this thread may see", async () => {
    const { agentRunId } = await exhaust("not yours to retry");
    // Same org, no project membership; and another tenant entirely. Chat's I-3 rule: one
    // refusal, so the endpoint cannot confirm which run ids exist.
    expect((await postRetry(agentRunId, STRANGER, ORG)).status).toBe(404);
    expect((await postRetry(agentRunId, OUTSIDER, OTHER_ORG)).status).toBe(404);
    expect((await postRetry(randomUUID())).status).toBe(404);
    // And none of those refusals reopened anything.
    expect((await readRun(agentRunId)).status).toBe("failed");
  });
});
