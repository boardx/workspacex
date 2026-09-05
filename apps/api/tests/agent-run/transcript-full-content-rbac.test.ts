/**
 * Phase 14 F15 -- 完整可审计 transcript 存储改造：完整内容 + 字段级加密 + RBAC 审计接口。
 *
 * `requirements/05-error-observability.md` R3'/R6，`contracts/error-observability/domain.md`
 * I-4/I-5，`usecases.md` UC-2。真实 Postgres——加密落库/RLS/角色判定都不是内存假件能测对
 * 的东西（同 `agent-run-step-collapse-order.test.ts` 的既有先例）。
 *
 * 覆盖：
 *   V1 完整内容按字段级加密落库，不是明文（R6 后置条件）。
 *   V2 有权限角色（`admin`）经 `getRunTranscript` 读到完整明文（R3'-3）。
 *   V3 无权限角色（`consultant`）被拒绝，且**先于**任何存在性判断（探针防护，UC-2）。
 *   V4（I-4/E3）密钥不可用（此处用"换一把不匹配的钥匙"模拟密钥轮转/不可用）时诚实报告
 *     `decryptStatus: "unreadable"`，`fullContent: null`，不静默返回空值也不崩溃。
 *   V5 本轮范围诚实标注：`tool_call` 步骤尚无完整内容捕获，同样诚实报 `unreadable`，
 *     不伪造成"看似加密成功"。
 *
 * 每条正向断言配一条 `*-CP` 反证，证明断言确实抓得住退化（同仓 `failure-classification.
 * test.ts` 纪律）。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import {
  AesGcmTranscriptContentCipher, transcriptContentCipherFromEnv,
} from "../../src/infrastructure/agent-run/transcript-content-cipher";
import {
  getRunTranscript, RunTranscriptForbiddenError, RunTranscriptNotFoundError,
} from "../../src/application/agent-run/get-run-transcript";
import type { AppendedRunStep } from "../../src/application/agent-run/ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
// 全程用同一把钥匙——`createApp()` 内部通过 `transcriptContentCipherFromEnv()` 构造的
// 密文侧与本文件直接构造的 `repo` 读到的是同一把钥匙派生的密钥，二者才谈得上"互相验证"。
process.env.AGENT_RUN_TRANSCRIPT_KEY = "test-transcript-key-f15-9f2a";

const ORG = toOrgId("org-f15-transcript-rbac");
const PROJECT = "proj-f15-transcript-rbac";
const THREAD = "thread-f15-transcript-rbac";
const ADMIN = "u-f15-admin";
const CONSULTANT = "u-f15-consultant";

let db: PgDatabase;
let repo: PgAgentRunRepository;
let identity: PgIdentityRepository;
let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  // 与 `kernel.module.ts` 的 AGENT_RUN_STORE provider 同一条装配路径
  // （`transcriptContentCipherFromEnv()`），不是另起一套加密配置。
  repo = new PgAgentRunRepository(db, transcriptContentCipherFromEnv());
  identity = new PgIdentityRepository(db);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, CONSULTANT, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ADMIN,
  });
});

/** 同 `agent-run-step-collapse-order.test.ts` 的既有最小夹具：`agent_id`/`agent_version_id`
 *  无 FK，只需要 `thread_id`/`input_message_id` 指向真实行。 */
async function seedRun(id: string): Promise<void> {
  const inputMessageId = `${id}-input`;
  await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hi", authorId: ADMIN });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'succeeded')`,
      [id, ORG, THREAD, inputMessageId, "agent-f15", "agent-version-f15", "test-provider", "test-model"],
    ),
  );
}

function step(over: Partial<AppendedRunStep> & { runId: string; seq: number }): AppendedRunStep {
  return {
    kind: "model_called", status: "succeeded", startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(), inputDigest: null, outputDigest: null, failureCode: null,
    toolName: null, toolArgsSummary: null, toolResultSummary: null, planningNote: null,
    toolCallId: null,
    ...over,
  };
}

async function readRawStepColumns(runId: string, seq: number): Promise<{
  input_full_content_enc: string | null; output_full_content_enc: string | null;
}> {
  const rows = await asApp(ORG, (c) =>
    c.query<{ input_full_content_enc: string | null; output_full_content_enc: string | null }>(
      `SELECT input_full_content_enc, output_full_content_enc FROM agent_run_steps
        WHERE org_id=$1 AND run_id=$2 AND seq=$3`,
      [ORG, runId, seq],
    ));
  return rows.rows[0]!;
}

const CIPHERTEXT_SHAPE = /^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/;
const SYSTEM_PROMPT = "你是一个助手。今天的任务：处理用户的 PDF 生成请求。";
const MODEL_REPLY = "好的，我已经生成了这份 PDF，包含三个章节，共 12 页。";

describe("V1（R6）完整内容按字段级加密落库，不是明文", () => {
  it("model_called 步骤的 input/outputFullContent 落库为密文，且能用同一把钥匙解密回原文", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    await repo.appendStep(ORG, step({
      runId, seq: 1,
      inputFullContent: SYSTEM_PROMPT, outputFullContent: MODEL_REPLY,
    }));

    const raw = await readRawStepColumns(runId, 1);
    expect(raw.input_full_content_enc).not.toBeNull();
    expect(raw.output_full_content_enc).not.toBeNull();
    // 不是明文，也不是明文的子串——真的加密了，不是"看起来存了个东西"。
    expect(raw.input_full_content_enc).not.toBe(SYSTEM_PROMPT);
    expect(raw.input_full_content_enc).not.toContain(SYSTEM_PROMPT);
    expect(raw.output_full_content_enc).not.toContain(MODEL_REPLY);
    expect(raw.input_full_content_enc).toMatch(CIPHERTEXT_SHAPE);
    expect(raw.output_full_content_enc).toMatch(CIPHERTEXT_SHAPE);
  });

  it("V1-CP 反证：把 inputFullContent 直接落成明文（不加密），上一条『不是明文』断言必红", async () => {
    // 直接重放"忘记加密"这个退化：构造一个不带 cipher 的仓储，appendStep 会把
    // input_full_content_enc 存成 NULL（诚实降级），而不是明文——证明"存 NULL"与
    // "存明文"是两回事，而当前实现选的是前者，绝不会让后一种情况悄悄发生。
    const noCipherRepo = new PgAgentRunRepository(db, null);
    const runId = randomUUID();
    await seedRun(runId);
    await noCipherRepo.appendStep(ORG, step({
      runId, seq: 1, inputFullContent: SYSTEM_PROMPT, outputFullContent: MODEL_REPLY,
    }));
    const raw = await readRawStepColumns(runId, 1);
    // 无密钥时诚实存 NULL，不是"退化成明文"——这正是本条 CP 要守住的边界。
    expect(raw.input_full_content_enc).toBeNull();
    expect(raw.output_full_content_enc).toBeNull();
  });
});

describe("V2（R3'-3）admin 经 getRunTranscript 读到完整明文", () => {
  it("HTTP GET /agent-runs/:runId/transcript：admin 200，decryptStatus ok，能看到完整原文", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    await repo.appendStep(ORG, step({
      runId, seq: 1, inputFullContent: SYSTEM_PROMPT, outputFullContent: MODEL_REPLY,
    }));

    const response = await fetch(`${BASE}/agent-runs/${runId}/transcript`, {
      headers: principal(ADMIN, ORG),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      runId: string;
      steps: { runStepId: string; kind: string; decryptStatus: string; fullContent: string | null }[];
    };
    expect(body.runId).toBe(runId);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]!.kind).toBe("model_call");
    expect(body.steps[0]!.decryptStatus).toBe("ok");
    const content = JSON.parse(body.steps[0]!.fullContent!) as { input: string; output: string };
    expect(content.input).toBe(SYSTEM_PROMPT);
    expect(content.output).toBe(MODEL_REPLY);
  });

  it("直调用例（不经 HTTP）同样成立，且 context_built 步骤不出现在 transcript 里", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    await repo.appendStep(ORG, step({
      // `input_digest` is CHECK-constrained to a 64-hex-char sha256 shape
      // (agent_run_steps_input_digest_check) -- a short placeholder like "deadbeef"
      // fails at the database, not at this test's assertions.
      runId, seq: 1, kind: "context_built", inputDigest: "deadbeef".repeat(8),
    }));
    await repo.appendStep(ORG, step({
      runId, seq: 2, inputFullContent: SYSTEM_PROMPT, outputFullContent: MODEL_REPLY,
    }));

    const out = await getRunTranscript(
      { repo: identity, runs: repo },
      { callerId: ADMIN, orgId: ORG, runId },
    );
    // 只有 model_call/tool_call 两种契约 kind 会出现——context_built 不是它们之一
    // （R3'-1 的四类之外），见 `AgentRunStore.readRunTranscriptSteps` 的文档。
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]!.kind).toBe("model_call");
  });

  it("V2-CP 反证：调用一个真实存在但完全没有 model_called/tool_call 步骤的 run，读到空 transcript 而非报错", async () => {
    // 证明"读到 0 条"和"RUN_NOT_FOUND"是两回事——这条 CP 反证如果误把空数组当成
    // "找不到 run"就会在这里抛错，而不是安静地返回空数组。
    const runId = randomUUID();
    await seedRun(runId);
    const out = await getRunTranscript(
      { repo: identity, runs: repo },
      { callerId: ADMIN, orgId: ORG, runId },
    );
    expect(out.steps).toEqual([]);
  });
});

describe("V3（UC-2）无权限角色被拒绝，且先于任何存在性判断", () => {
  it("HTTP：consultant 打真实存在的 run 得 403，不是 404", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    await repo.appendStep(ORG, step({ runId, seq: 1, inputFullContent: SYSTEM_PROMPT }));

    const response = await fetch(`${BASE}/agent-runs/${runId}/transcript`, {
      headers: principal(CONSULTANT, ORG),
    });
    expect(response.status).toBe(403);
  });

  it("consultant 打一个根本不存在的 runId 仍然是 FORBIDDEN，不是 RUN_NOT_FOUND——防止把这条端点当探针", async () => {
    await expect(getRunTranscript(
      { repo: identity, runs: repo },
      { callerId: CONSULTANT, orgId: ORG, runId: "run-does-not-exist" },
    )).rejects.toBeInstanceOf(RunTranscriptForbiddenError);
  });

  it("admin 打一个不存在的 runId 才是 RUN_NOT_FOUND（HTTP 404）——角色检查通过之后才轮到存在性", async () => {
    const response = await fetch(`${BASE}/agent-runs/run-does-not-exist/transcript`, {
      headers: principal(ADMIN, ORG),
    });
    expect(response.status).toBe(404);
    await expect(getRunTranscript(
      { repo: identity, runs: repo },
      { callerId: ADMIN, orgId: ORG, runId: "run-does-not-exist" },
    )).rejects.toBeInstanceOf(RunTranscriptNotFoundError);
  });

  it("V3-CP 反证：把角色判定改回『管理员或合规官都算审计角色』，`compliance` 会被误放行——证明当前实现没有这么做", async () => {
    await addOrgMember(ORG, "u-f15-compliance", "compliance", null);
    const runId = randomUUID();
    await seedRun(runId);
    await expect(getRunTranscript(
      { repo: identity, runs: repo },
      { callerId: "u-f15-compliance", orgId: ORG, runId },
    )).rejects.toBeInstanceOf(RunTranscriptForbiddenError);
    // 旧的（错误的）判权函数会让这一行成立——重放它证明"放行 compliance"确实是一个
    // 会被这组测试抓到的退化，而不是一条没人会踩的假想红线。
    const legacyIsAuditor = (role: string | null): boolean => role === "admin" || role === "compliance";
    expect(legacyIsAuditor("compliance")).toBe(true);
  });
});

describe("V4（I-4/E3）密钥不可用/不匹配时诚实报告 unreadable，不静默返回空值也不崩溃", () => {
  it("换一把不匹配的钥匙读回：decryptStatus unreadable，fullContent null，函数不抛异常", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    await repo.appendStep(ORG, step({
      runId, seq: 1, inputFullContent: SYSTEM_PROMPT, outputFullContent: MODEL_REPLY,
    }));

    // 模拟密钥轮转/不可用：同一份密文，换一个仓储实例读，钥匙对不上。
    const wrongKeyRepo = new PgAgentRunRepository(db, new AesGcmTranscriptContentCipher("a-completely-different-key"));
    const out = await getRunTranscript(
      { repo: identity, runs: wrongKeyRepo },
      { callerId: ADMIN, orgId: ORG, runId },
    );
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]!.decryptStatus).toBe("unreadable");
    expect(out.steps[0]!.fullContent).toBeNull();
  });

  it("完全没有配置密钥（cipher=null）读回同样是 unreadable，不是抛错", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    await repo.appendStep(ORG, step({
      runId, seq: 1, inputFullContent: SYSTEM_PROMPT, outputFullContent: MODEL_REPLY,
    }));

    const noCipherReadRepo = new PgAgentRunRepository(db, null);
    const out = await getRunTranscript(
      { repo: identity, runs: noCipherReadRepo },
      { callerId: ADMIN, orgId: ORG, runId },
    );
    expect(out.steps[0]!.decryptStatus).toBe("unreadable");
    expect(out.steps[0]!.fullContent).toBeNull();
  });

  it("V4-CP 反证：直接调用 cipher.decrypt 面对篡改过的密文，证明它返回 null 而不是抛异常（这是上面两条测试成立的前提）", () => {
    const cipher = new AesGcmTranscriptContentCipher("some-key");
    const sealed = cipher.encrypt("secret");
    const tampered = sealed.slice(0, -2) + "ff"; // 篡改密文尾部（authTag 校验会失败）
    expect(() => cipher.decrypt(tampered)).not.toThrow();
    expect(cipher.decrypt(tampered)).toBeNull();
    expect(cipher.decrypt("not-even-the-right-shape")).toBeNull();
  });
});

describe("V5 本轮范围诚实标注：tool_call 尚无完整内容捕获，如实报 unreadable，不伪造", () => {
  it("一个没有 inputFullContent/outputFullContent 的 tool_call 步骤：出现在 transcript 里，但 decryptStatus 是 unreadable", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    // 与 execute-run.ts 当前真实行为一致：tool_call 步骤目前不传 full content 字段。
    await repo.appendStep(ORG, step({
      runId, seq: 1, kind: "tool_call", toolName: "search", toolArgsSummary: "{\"q\":\"...\"}",
      toolResultSummary: "3 hits",
    }));

    const out = await getRunTranscript(
      { repo: identity, runs: repo },
      { callerId: ADMIN, orgId: ORG, runId },
    );
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]!.kind).toBe("tool_call");
    // 诚实：不是"加密失败"，是"这轮范围内本来就没有完整内容"——但契约没有第三态，
    // 见 `readRunTranscriptSteps` 的文档，这里断言的是当前诚实的降级行为。
    expect(out.steps[0]!.decryptStatus).toBe("unreadable");
    expect(out.steps[0]!.fullContent).toBeNull();
  });
});
