/**
 * AG07 —— 数字人委派 / 转交（handoff）（03-agent-role.md R3 ⑨ / E5 / E8；契约束 agent-role UC-7 / I-13 / V8 / V12；
 * CONTRACT §11 `request-handoff`；ADR-118 #6 权限重查）。
 *
 * 生产路径，唯一替身是 Agent 的模型（脚本化 `ModelCallPort`，同 AG05 / AG06 测试）：
 *   真 PostgreSQL + 真 `executeQueuedRuns` + 真 `PgAgentRunRepository` + 真 `PgAgentHandoffStore`
 *   + 真 `AgentHandoffController` + 真 `ArtifactSourceReadPermissionCheck`（文件预览同一道读门）。
 * 链路：Agent 调 `request_handoff` ⇒ 内核中断 ⇒ `tool-permission-gate` ⇒ `handoff-gate` ⇒
 *   `requestAgentHandoff`（读 run **钉住**的版本快照 delegationPolicy）⇒ 登记 `requested` ⇒ edit resume ⇒ run 跑完；
 *   发起人 GET 卡片 ⇒ confirm ⇒ 接收方新线程 ⇒ 新线程上以**发起人**身份重读证据引用。
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRole as R } from "@repo/contracts";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ModelCallCompletion, ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import { AgentRunNotAwaitingToolPermissionError, decideAgentRun } from "../../src/application/agent-run/decide-agent-run";
import { classifyToolRisk } from "../../src/domain/agent-run/tool-risk-tier";
import { requestAgentHandoff, type AgentHandoffOutcome } from "../../src/application/agent/agent-handoff";
import { ArtifactSourceReadPermissionCheck } from "../../src/application/agent/artifact-source-read-check";
import { NATIVE_PROFILE_TOOLS, nativeInterruptOn } from "../../src/application/agent-run/native-invocation";
import { CALL_CHAIN_MAX_DEPTH } from "../../src/domain/agent/call-chain";
import { decideHandoff, handoffNotAllowedMessage, parseDelegationPolicy } from "../../src/domain/agent/handoff-policy";
import { SNAPSHOT_FROZEN_FIELDS } from "../../src/domain/agent/version-snapshot";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";
import { PgAgentHandoffStore } from "../../src/infrastructure/agent/pg-agent-handoff-store";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDownloadGrantRepository } from "../../src/infrastructure/files/pg-download-grant-repository";
import { IsolatedDownloadUrlBuilder } from "../../src/infrastructure/files/isolated-download-url-builder";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { AgentHandoffController } from "../../src/interface/controllers/agent-handoff.controller";
import { addBinding, addCapability, addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addBrowserArtifact } from "../support/files-db";
import { fixture } from "../agent-run/loopback-deep-agent-fixture";
import { importOfficialAgentRolePack } from "../../src/application/agent-import/import-official-agent-role-pack";
import { buildOfficialAgentRolePack, officialRoleDelegationTargets, OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION } from "../../src/domain/agent/official-role-packs";
import { PgOfficialAgentRolePackImportRepository } from "../../src/infrastructure/agent/pg-official-agent-role-pack-import-repository";

/* ── 一、纯判定（domain）──────────────────────────────────────────── */

describe("AG07 · decideHandoff（纯函数）", () => {
  const target = { agentId: "a-d003", published: true, enabled: true };
  const policy = { allowedTargets: ["D003", "D011"], maxDepth: 1 };

  it("目标在允许集且深度未超 ⇒ 放行，新深度 = 来源深度 + 1", () => {
    expect(decideHandoff({ policy, targetRole: "D003", sourceDepth: 0, target })).toEqual({ ok: true, depth: 1 });
  });

  it("E5：目标不在 allowedTargets ⇒ target_not_in_allowed_targets（精确匹配，不做前缀）", () => {
    expect(decideHandoff({ policy, targetRole: "D005", sourceDepth: 0, target })).toEqual({ ok: false, reason: "target_not_in_allowed_targets" });
    expect(decideHandoff({ policy: { allowedTargets: ["D00"], maxDepth: 1 }, targetRole: "D003", sourceDepth: 0, target }).ok).toBe(false);
  });

  it("E5：深度超 maxDepth ⇒ depth_exceeded；maxDepth=0（默认）⇒ 不允许任何转交", () => {
    expect(decideHandoff({ policy, targetRole: "D003", sourceDepth: 1, target })).toEqual({ ok: false, reason: "depth_exceeded" });
    expect(decideHandoff({ policy: { allowedTargets: ["D003"], maxDepth: 0 }, targetRole: "D003", sourceDepth: 0, target })).toEqual({ ok: false, reason: "depth_exceeded" });
  });

  it("深度同时受 CALL_CHAIN_MAX_DEPTH 封顶（即便快照的 maxDepth 更大）", () => {
    const wide = { allowedTargets: ["D003"], maxDepth: 99 };
    expect(decideHandoff({ policy: wide, targetRole: "D003", sourceDepth: CALL_CHAIN_MAX_DEPTH - 1, target }).ok).toBe(true);
    expect(decideHandoff({ policy: wide, targetRole: "D003", sourceDepth: CALL_CHAIN_MAX_DEPTH, target })).toEqual({ ok: false, reason: "depth_exceeded" });
  });

  it("E5：目标本组织未发布 / 已停用", () => {
    expect(decideHandoff({ policy, targetRole: "D003", sourceDepth: 0, target: null })).toEqual({ ok: false, reason: "target_not_published" });
    expect(decideHandoff({ policy, targetRole: "D003", sourceDepth: 0, target: { ...target, published: false } })).toEqual({ ok: false, reason: "target_not_published" });
    expect(decideHandoff({ policy, targetRole: "D003", sourceDepth: 0, target: { ...target, enabled: false } })).toEqual({ ok: false, reason: "target_disabled" });
  });

  it("冻结字段形状不对 ⇒ 按「不允许任何转交」（fail closed）", () => {
    expect(parseDelegationPolicy(null)).toEqual({ allowedTargets: [], maxDepth: 0 });
    expect(parseDelegationPolicy({ allowedTargets: "D003", maxDepth: "1" })).toEqual({ allowedTargets: [], maxDepth: 0 });
  });

  it("拒绝文案是友好中文，不含原因码，并提示原对话继续", () => {
    for (const reason of R.HandoffNotAllowedReason.options) {
      const text = handoffNotAllowedMessage(reason, "D003");
      expect(text).not.toContain(reason);
      expect(text).toContain("当前对话会继续");
    }
  });
});

describe("AG07 · 契约与冻结", () => {
  it("交接包只含引用：多带摘录字段即整包拒绝（I-13）", () => {
    const packet = { originalQuestion: "q", confirmedScope: "", evidenceRefs: ["v1"], openItems: [] };
    expect(R.RequestHandoffArgs.safeParse({ targetRole: "D003", packet }).success).toBe(true);
    expect(R.RequestHandoffArgs.safeParse({ targetRole: "D003", packet: { ...packet, excerpts: ["原文全文"] } }).success).toBe(false);
    expect(R.RequestHandoffArgs.safeParse({ targetRole: "PM", packet }).success).toBe(false);
  });

  it("转交目标是快照冻结字段：delegationPolicy ∈ SNAPSHOT_FROZEN_FIELDS", () => {
    expect(SNAPSHOT_FROZEN_FIELDS).toContain("delegationPolicy");
    expect(R.AGENT_ROLE_FROZEN_FIELDS).toContain("delegationPolicy");
  });

  it("request_handoff 每次都中断：L2 登记 + 原生准入表 interrupt_on=true", () => {
    expect(classifyToolRisk(R.REQUEST_HANDOFF_TOOL_NAME)).toBe("L2");
    expect(NATIVE_PROFILE_TOOLS).toContain(R.REQUEST_HANDOFF_TOOL_NAME);
    expect(nativeInterruptOn()[R.REQUEST_HANDOFF_TOOL_NAME]).toBe(true);
  });

  it("lint-permission-paths 豁免条件：存储从不 withoutTenant，只碰声明过的表", () => {
    const src = readFileSync(new URL("../../src/infrastructure/agent/pg-agent-handoff-store.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/withoutTenant/);
    const tables = new Set([...src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/g)].map((m) => m[1]));
    for (const t of tables) {
      expect(["agent_handoffs", "agent_runs", "agent_versions", "chat_messages", "capability_listings", "agents", "chat_threads"]).toContain(t);
    }
  });
});

/* ── 二、loopback 剧本（loopback 栈上可操作）──────────────────────────── */

describe("AG07 · loopback deep-agent 替身 · request_handoff 剧本", () => {
  async function startTurn(request: ReturnType<typeof fixture>, thread: string, text: string) {
    await request("POST", "/threads", { thread_id: thread });
    await request("POST", `/threads/${thread}/runs`, { input: { messages: [{ role: "user", content: text }] } });
    let status: any;
    for (let i = 0; i < 5; i += 1) status = await request("GET", `/threads/${thread}/runs/${thread}`);
    return status;
  }

  it("标记命中：停在 interrupted，未配对的 request_handoff 调用只带问题原文与证据 ID", async () => {
    const request = fixture();
    const status = await startTurn(request, "h1", "帮我写一份 PRD [request_handoff:D003] [evidence:ver-1]");
    expect(status.status).toBe("interrupted");
    const state = await request("GET", "/threads/h1/state");
    const calls = state.values.messages.flatMap((m: any) => m.tool_calls ?? []);
    expect(calls).toEqual([{
      id: "request-handoff-h1", name: "request_handoff",
      args: { targetRole: "D003", packet: { originalQuestion: "帮我写一份 PRD", confirmedScope: "", evidenceRefs: ["ver-1"], openItems: [] } },
    }]);
    expect(R.RequestHandoffArgs.safeParse(calls[0].args).success).toBe(true);
  });

  it("edit resume 交回 requested outcome ⇒ 终稿 = outcome.message", async () => {
    const request = fixture();
    await startTurn(request, "h3", "[request_handoff:D003]");
    const outcome = { status: "requested", handoffId: "hid-1", targetRole: "D003", message: "已提交转交给「产品经理」的请求，等待你在对话中确认；确认后会新开一个对话继续。" };
    await request("POST", "/threads/h3/runs", {
      command: { resume: { decisions: [{ type: "edit", edited_action: { name: "request_handoff", args: { outcome } } }] } },
    });
    expect((await request("GET", "/threads/h3/runs/h3")).status).toBe("success");
    const msgs = (await request("GET", "/threads/h3/state")).values.messages;
    expect(msgs.at(-1)).toMatchObject({ type: "ai", content: outcome.message });
  });

  it("edit resume 交回 refused outcome ⇒ 终稿不复述拒绝原因（提示条已展示，UIUX r2 屏 4 #3）", async () => {
    const request = fixture();
    await startTurn(request, "h2", "[request_handoff:D005]");
    const outcome = { status: "refused", reason: "target_not_in_allowed_targets", targetRole: "D005", message: handoffNotAllowedMessage("target_not_in_allowed_targets", "产品经理") };
    await request("POST", "/threads/h2/runs", {
      command: { resume: { decisions: [{ type: "edit", edited_action: { name: "request_handoff", args: { outcome } } }] } },
    });
    expect((await request("GET", "/threads/h2/runs/h2")).status).toBe("success");
    const msgs = (await request("GET", "/threads/h2/state")).values.messages;
    const aiTexts = msgs.filter((m: any) => m.type === "ai").map((m: any) => String(m.content ?? ""));
    expect(aiTexts.some((t: string) => t.includes(outcome.message)), "拒绝原因只出现一次：在结构化提示条里").toBe(false);
    expect(msgs.at(-1)).toMatchObject({ type: "ai", content: "我会继续在这个对话里、按我的职责范围帮你处理。" });
  });

  it("UIUX r3 屏 5：自转交（D002→D002）被拒 ⇒ 工具结果是带显示名的拒绝句（含 HANDOFF_REFUSAL_MARK），过渡语被清掉", async () => {
    const request = fixture();
    await startTurn(request, "h4", "UIUX 这个需求请产品经理接手 [request_handoff:D002]");
    const outcome = { status: "refused", reason: "target_not_in_allowed_targets", targetRole: "D002", message: handoffNotAllowedMessage("target_not_in_allowed_targets", "产品经理") };
    await request("POST", "/threads/h4/runs", {
      command: { resume: { decisions: [{ type: "edit", edited_action: { name: "request_handoff", args: { outcome } } }] } },
    });
    const msgs = (await request("GET", "/threads/h4/state")).values.messages;
    const tool = msgs.find((m: any) => m.type === "tool");
    expect(tool.content).toBe(outcome.message);
    expect(tool.content).toContain(R.HANDOFF_REFUSAL_MARK);
    expect(tool.content).toContain("产品经理");
    const texts = msgs.filter((m: any) => m.type === "ai").map((m: any) => String(m.content ?? ""));
    expect(texts.some((t: string) => t.includes("正在提交转交请求")), "过渡语不留在终态").toBe(false);
  });
});

/* ── 三、真库端到端 ──────────────────────────────────────────────── */

const ORG = toOrgId("org-ag07-handoff");
const PROJECT = "proj-ag07-handoff";
const PRIVATE_PROJECT = "proj-ag07-private";
const REQUESTER = "u-ag07-requester";
const OTHER = "u-ag07-other";
const SOURCE = "agt-ag07-d002";
const TARGETS = { D003: "agt-ag07-d003", D005: "agt-ag07-d005", D011: "agt-ag07-d011" } as const;
const PACKET = { originalQuestion: "把这次调研结论整理成 PRD", confirmedScope: "仅 B 端新用户流失", evidenceRefs: [] as string[], openItems: ["定价是否纳入"] };

describe("AG07 · handoff 端到端（真库、真网关、真路由）", () => {
  let db: PgDatabase;
  let runs: PgAgentRunRepository;
  let handoffs: PgAgentHandoffStore;
  let controller: AgentHandoffController;
  let sources: ArtifactSourceReadPermissionCheck;
  const calls: ModelCallInput[] = [];
  let script: ModelCallCompletion[] = [];
  const model: ModelCallPort = {
    async complete(input) {
      calls.push(input);
      const next = script.shift();
      if (!next) throw new Error("unexpected model call");
      return next;
    },
  };
  const as = (userId: string): Principal => ({ userId, orgId: ORG } as unknown as Principal);
  const readableRef = "art-ag07-ok-v1";
  const deniedRef = "art-ag07-private-v1";
  const missingRef = "art-ag07-never-existed-v1";

  function deps(withStore = true): ExecuteAgentRunDeps {
    let n = 0;
    return {
      runs, model, log: () => {}, handoffs: withStore ? handoffs : undefined,
      clock: { now: () => new Date().toISOString(), newStepId: () => `step-ag07-${n++}` },
    } as unknown as ExecuteAgentRunDeps;
  }

  async function insertAgent(agentId: string, roleRef: string, opts: { status?: string; versions: { id: string; delegation?: unknown; publish?: boolean }[] }) {
    await asApp(ORG, async (c) => {
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$1,$3,$4,$5,now(),now())`,
        [agentId, ORG, `角色 ${roleRef}`, opts.status ?? "enabled", REQUESTER],
      );
      for (const v of opts.versions) {
        await c.query(
          `INSERT INTO agent_versions
            (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
             model_provider,model_id,tool_policy,creator_id,created_at,published_at,catalog_source,delegation_policy)
           VALUES ($1,$2,$3,$1,$4,'角色','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,$5,now(),now(),'official',$6::jsonb)`,
          [v.id, ORG, agentId, "d".repeat(64), REQUESTER, JSON.stringify(v.delegation ?? { allowedTargets: [], maxDepth: 0, requireApproval: true })],
        );
        if (v.publish) await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [v.id, agentId, ORG]);
      }
    });
    await addCapability({ orgId: ORG, id: agentId, kind: "agent", name: `角色 ${roleRef}`, abbr: roleRef });
  }

  async function seedQueuedRun(id: string, versionId: string, thread = `thread-${id}`, existingThread = false): Promise<void> {
    if (!existingThread) await addChatThread({ orgId: ORG, id: thread, projectId: PROJECT, visibilityScope: "plenary", createdBy: REQUESTER });
    await addChatMessage({ orgId: ORG, id: `${id}-in`, threadId: thread, body: "这个需要产品经理接手", authorId: REQUESTER });
    await asApp(ORG, (c) => c.query(
      `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
         skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'deep-agent','deep-agent','queued')`,
      [id, ORG, thread, `${id}-in`, SOURCE, versionId]));
  }

  /** 跑一轮：Agent 调 request_handoff → 网关判定 → edit resume → Agent 回复。返回交回工具的 outcome。 */
  async function agentRequests(runId: string, args: unknown, opts: { toolCallId?: string; unwired?: boolean } = {}): Promise<AgentHandoffOutcome> {
    calls.length = 0;
    script = [
      { text: "", interrupted: { toolName: "request_handoff", toolCallId: opts.toolCallId ?? `call-${randomUUID()}`, argsSummary: JSON.stringify(args) } },
      { text: "好的。" },
    ];
    const d = deps(!opts.unwired);
    await executeQueuedRuns(d, { orgId: ORG });
    if ((await runStatus(runId)) === "queued") await executeQueuedRuns(d, { orgId: ORG });
    expect(calls, "中断 + edit resume 共两次模型调用").toHaveLength(2);
    const resume = calls[1]!.resume as { decision: string; editedAction: { name: string; argsJson: string } };
    expect(resume.decision).toBe("edit");
    expect(resume.editedAction.name).toBe("request_handoff");
    expect(await runStatus(runId), "原线程继续：resume 之后 run 跑完进入写回").toBe("writeback_pending");
    return (JSON.parse(resume.editedAction.argsJson) as { outcome: AgentHandoffOutcome }).outcome;
  }

  async function runStatus(id: string): Promise<string> {
    return asApp(ORG, async (c) => (await c.query<{ status: string }>("SELECT status FROM agent_runs WHERE id=$1", [id])).rows[0]!.status);
  }

  async function handoffRows(): Promise<{ id: string; status: string; target_role: string }[]> {
    return asApp(ORG, async (c) => (await c.query<{ id: string; status: string; target_role: string }>(
      "SELECT id, status, target_role FROM agent_handoffs WHERE org_id=$1 ORDER BY created_at, id", [ORG])).rows);
  }

  async function httpError(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(HttpException);
    const h = e as HttpException;
    return { status: h.getStatus(), body: h.getResponse() as Record<string, unknown> };
  }

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    runs = new PgAgentRunRepository(db);
    handoffs = new PgAgentHandoffStore(db);
    sources = new ArtifactSourceReadPermissionCheck({
      repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), grants: new PgDownloadGrantRepository(db),
      objectStore: { available: async () => true }, integrity: { verify: async () => "ok" as const },
      urls: new IsolatedDownloadUrlBuilder(), provenance: new PgProvenanceRepository(db),
      idFactory: { next: (p: string) => `${p}-${randomUUID()}` }, now: () => new Date(),
    } as never);
    controller = new AgentHandoffController(handoffs, sources);
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["red", "blue"] });
    await addOrgMember(ORG, REQUESTER, "consultant", `${ORG}-team-red`);
    await addOrgMember(ORG, OTHER, "consultant", `${ORG}-team-blue`);
    await addProjectMember(ORG, PROJECT, REQUESTER, "member", null);
    await addProjectMember(ORG, PROJECT, OTHER, "member", null);

    // 来源 Agent：钉给 run 的 v1 允许 D003 / D011 / D007（maxDepth 1）；头版本 v2 只允许 D005（证明读钉住快照）。
    await insertAgent(SOURCE, "D002", {
      versions: [
        { id: `${SOURCE}-v1`, delegation: { allowedTargets: ["D003", "D011", "D007"], maxDepth: 1, requireApproval: true } },
        { id: `${SOURCE}-v2`, delegation: { allowedTargets: ["D005"], maxDepth: 1, requireApproval: true }, publish: true },
      ],
    });
    await insertAgent(TARGETS.D003, "D003", { versions: [{ id: `${TARGETS.D003}-v1`, publish: true }] });
    await insertAgent(TARGETS.D005, "D005", { versions: [{ id: `${TARGETS.D005}-v1`, publish: true }] });
    await insertAgent(TARGETS.D011, "D011", { status: "disabled", versions: [{ id: `${TARGETS.D011}-v1`, publish: true }] });

    // 证据：一条发起人可读（项目内 org-wide）；一条只对 blue 组可见（发起人在 red 组）。
    await addBrowserArtifact({ orgId: ORG, id: "art-ag07-ok", projectId: PROJECT, title: "调研简报", mime: "application/pdf" });
    await addBrowserArtifact({ orgId: ORG, id: "art-ag07-private", projectId: PROJECT, title: "内部定价", mime: "application/pdf" });
    await addBinding({ orgId: ORG, subject: { kind: "team", id: `${ORG}-team-blue` }, object: { kind: "artifact", id: "art-ag07-private" }, scope: "team-only", ownerTeamId: `${ORG}-team-blue` });
  }, 120_000);

  afterAll(async () => {
    await resetOrgs(ORG);
    await db?.close();
  });

  let handoffId = "";
  let newThreadId = "";

  it("允许集内（D002→D003）：登记 requested、不新开线程；卡片只对发起人可见；账本留痕", async () => {
    await seedQueuedRun("run-ag07-ok", `${SOURCE}-v1`);
    const packet = { ...PACKET, evidenceRefs: [readableRef, deniedRef, missingRef] };
    const outcome = await agentRequests("run-ag07-ok", { targetRole: "D003", packet });
    expect(outcome).toMatchObject({ status: "requested", targetRole: "D003" });
    expect(outcome.message).toContain("等待你在对话中确认");
    handoffId = (outcome as { handoffId: string }).handoffId;

    const rows = await handoffRows();
    expect(rows).toEqual([{ id: handoffId, status: "requested", target_role: "D003" }]);
    const stored = await asApp(ORG, async (c) => (await c.query<{ packet: unknown; depth: number; requester_user_id: string; new_thread_id: string | null }>(
      "SELECT packet, depth, requester_user_id, new_thread_id FROM agent_handoffs WHERE id=$1", [handoffId])).rows[0]!);
    expect(stored).toEqual({ packet, depth: 1, requester_user_id: REQUESTER, new_thread_id: null });

    const notes = await asApp(ORG, async (c) => (await c.query<{ planning_note: string }>(
      "SELECT planning_note FROM agent_run_steps WHERE run_id=$1 AND planning_note LIKE 'Agent 请求转交%'", ["run-ag07-ok"])).rows);
    expect(notes.map((n) => n.planning_note)).toEqual([`Agent 请求转交给 D003：已登记 ${handoffId}，等待发起人确认`]);

    const mine = await controller.list(as(REQUESTER), "thread-run-ag07-ok");
    expect(mine.requested).toHaveLength(1);
    expect(mine.requested[0]).toMatchObject({ handoffId, status: "requested", targetRole: "D003", targetAgentId: TARGETS.D003, targetName: "角色 D003", packet });
    expect(mine.origin).toBeNull();
    const theirs = await controller.list(as(OTHER), "thread-run-ag07-ok");
    expect(theirs, "别人看不到这张卡（不泄露存在性）").toEqual({ requested: [], origin: null });
  });

  it("同一次工具调用重放（崩溃恢复）只落一行", async () => {
    await seedQueuedRun("run-ag07-replay", `${SOURCE}-v1`);
    const argsJson = JSON.stringify({ targetRole: "D003", packet: PACKET });
    const a = await requestAgentHandoff({ handoffs }, { orgId: ORG, runId: "run-ag07-replay", toolCallId: "call-replay", argsJson });
    const b = await requestAgentHandoff({ handoffs }, { orgId: ORG, runId: "run-ag07-replay", toolCallId: "call-replay", argsJson });
    expect(a.status).toBe("requested");
    expect(b).toEqual(a);
    const n = await asApp(ORG, async (c) => (await c.query("SELECT 1 FROM agent_handoffs WHERE source_run_id=$1", ["run-ag07-replay"])).rowCount);
    expect(n).toBe(1);
    // 这条 run 只用来直调用例，不让后面的执行器批次认领它。
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='failed', error_code='RUN_INTERRUPTED' WHERE id=$1", ["run-ag07-replay"]));
  });

  it.each([
    ["E5 目标不在钉住快照的允许集（头版本允许 D005 也不算）", "D005", "target_not_in_allowed_targets"],
    ["E5 目标角色在本组织未发布", "D007", "target_not_published"],
    ["E5 目标角色已停用", "D011", "target_disabled"],
  ] as const)("%s ⇒ HANDOFF_NOT_ALLOWED，不登记、原线程继续、文案无原因码", async (_label, role, reason) => {
    const runId = `run-ag07-deny-${role}`;
    const before = (await handoffRows()).length;
    await seedQueuedRun(runId, `${SOURCE}-v1`);
    const outcome = await agentRequests(runId, { targetRole: role, packet: PACKET });
    expect(outcome).toMatchObject({ status: "refused", reason, targetRole: role });
    // UIUX r2 屏 4 #3：文案用目标的显示名，解析不到时用中性称呼——从不出现角色编号。
    const seeded = role in TARGETS;
    expect(outcome.message).toBe(handoffNotAllowedMessage(reason, seeded ? `角色 ${role}` : "所请求的角色"));
    expect(outcome.message).not.toContain(reason);
    if (!seeded) expect(outcome.message).not.toContain(role);
    expect((await handoffRows()).length).toBe(before);
  });

  it("交接包夹带摘录全文 ⇒ 整包拒绝（invalid_request），不登记", async () => {
    const before = (await handoffRows()).length;
    await seedQueuedRun("run-ag07-excerpt", `${SOURCE}-v1`);
    const outcome = await agentRequests("run-ag07-excerpt", { targetRole: "D003", packet: { ...PACKET, excerpts: ["全文……"] } });
    expect(outcome).toMatchObject({ status: "refused", reason: "invalid_request" });
    expect((await handoffRows()).length).toBe(before);
  });

  it("存储未接线 ⇒ 如实拒绝（转交暂不可用），不假装已提交", async () => {
    await seedQueuedRun("run-ag07-unwired", `${SOURCE}-v1`);
    const outcome = await agentRequests("run-ag07-unwired", { targetRole: "D003", packet: PACKET }, { unwired: true });
    expect(outcome).toMatchObject({ status: "refused", reason: "handoff_unavailable" });
  });

  it("结果只由服务端算出：通用审批通路对 request_handoff 只允许拒绝", async () => {
    await seedQueuedRun("run-ag07-generic", `${SOURCE}-v1`);
    await asApp(ORG, (c) => c.query(
      "UPDATE agent_runs SET status='running' WHERE id=$1", ["run-ag07-generic"]));
    await asApp(ORG, (c) => c.query(
      "UPDATE agent_runs SET status='awaiting_tool_permission', pending_tool_name='request_handoff', pending_args_summary='{}' WHERE id=$1",
      ["run-ag07-generic"]));
    const decideDeps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db), runs, kick: () => {} };
    const e = await decideAgentRun(decideDeps as never, { orgId: ORG, userId: REQUESTER, runId: "run-ag07-generic", decision: "approve" } as never)
      .then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(AgentRunNotAwaitingToolPermissionError);
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='failed', error_code='RUN_INTERRUPTED' WHERE id=$1", ["run-ag07-generic"]));
  });

  it("非发起人确认 / 取消 ⇒ 404 HANDOFF_NOT_FOUND；错形 id ⇒ 422 / 404", async () => {
    expect(await httpError(controller.confirm(as(OTHER), handoffId))).toEqual({ status: 404, body: { reasonCode: "HANDOFF_NOT_FOUND" } });
    expect(await httpError(controller.cancel(as(OTHER), handoffId))).toEqual({ status: 404, body: { reasonCode: "HANDOFF_NOT_FOUND" } });
    expect((await httpError(controller.confirm(as(REQUESTER), ""))).status).toBe(422);
  });

  it("发起人确认 ⇒ 接收方新开私有线程（以发起人身份），重复确认返回同一线程", async () => {
    const out = await controller.confirm(as(REQUESTER), handoffId);
    expect(out).toMatchObject({ handoffId, targetAgentId: TARGETS.D003 });
    newThreadId = out.newThreadId;
    const thread = await asApp(ORG, async (c) => (await c.query<{ created_by: string; visibility_scope: string; project_id: string | null; title: string }>(
      "SELECT created_by, visibility_scope, project_id, title FROM chat_threads WHERE id=$1", [newThreadId])).rows[0]!);
    expect(thread).toEqual({ created_by: REQUESTER, visibility_scope: "private", project_id: null, title: "转交：把这次调研结论整理成 PRD" });
    expect(await controller.confirm(as(REQUESTER), handoffId)).toEqual(out);
    expect((await controller.list(as(REQUESTER), "thread-run-ag07-ok")).requested[0]).toMatchObject({ status: "confirmed", newThreadId });
    // 已确认后不能再取消。
    expect((await httpError(controller.cancel(as(REQUESTER), handoffId))).status).toBe(404);
  });

  it("E8：新线程上以发起人身份重读引用——可读的给出类型，无权 / 不存在的只显示为不可展示、不带内容", async () => {
    const view = await controller.list(as(REQUESTER), newThreadId);
    expect(view.requested).toEqual([]);
    expect(view.origin?.handoff).toMatchObject({ handoffId, status: "confirmed", newThreadId });
    expect(view.origin?.evidence).toEqual([
      { ref: readableRef, readable: true, mime: "application/pdf" },
      { ref: deniedRef, readable: false },
      { ref: missingRef, readable: false },
    ]);
    // 同一条被拒引用对有权的人（blue 组）是可读的——判定用的确实是发起人身份，而不是「引用坏了」。
    const blue = await sources.check({ orgId: ORG, userId: OTHER, sourceRefs: [deniedRef] });
    expect(blue.readable.map((x) => x.ref)).toEqual([deniedRef]);
    // 别人打开这个线程 id 拿不到交接包。
    expect(await controller.list(as(OTHER), newThreadId)).toEqual({ requested: [], origin: null });
  });

  it("深度：由转交新开的线程里再转交 ⇒ 深度 2 > maxDepth 1 ⇒ depth_exceeded", async () => {
    await seedQueuedRun("run-ag07-depth", `${SOURCE}-v1`, newThreadId, true);
    const outcome = await agentRequests("run-ag07-depth", { targetRole: "D003", packet: PACKET });
    expect(outcome).toMatchObject({ status: "refused", reason: "depth_exceeded" });
  });

  it("取消：requested → cancelled，之后确认 ⇒ 404；确认时目标已停用 ⇒ 403 HANDOFF_NOT_ALLOWED + 原因", async () => {
    await seedQueuedRun("run-ag07-cancel", `${SOURCE}-v1`);
    const a = await agentRequests("run-ag07-cancel", { targetRole: "D003", packet: PACKET });
    const idA = (a as { handoffId: string }).handoffId;
    expect(await controller.cancel(as(REQUESTER), idA)).toEqual({ handoffId: idA, status: "cancelled" });
    expect((await httpError(controller.confirm(as(REQUESTER), idA))).status).toBe(404);

    await seedQueuedRun("run-ag07-late-disable", `${SOURCE}-v1`);
    const b = await agentRequests("run-ag07-late-disable", { targetRole: "D003", packet: PACKET });
    const idB = (b as { handoffId: string }).handoffId;
    await asApp(ORG, (c) => c.query("UPDATE agents SET status='disabled' WHERE id=$1", [TARGETS.D003]));
    try {
      expect(await httpError(controller.confirm(as(REQUESTER), idB))).toEqual({
        status: 403, body: { reasonCode: "HANDOFF_NOT_ALLOWED", reason: "target_disabled" },
      });
      const row = (await controller.list(as(REQUESTER), "thread-run-ag07-late-disable")).requested[0]!;
      expect(row).toMatchObject({ status: "rejected", notAllowedReason: "target_disabled", newThreadId: null });
    } finally {
      await asApp(ORG, (c) => c.query("UPDATE agents SET status='enabled' WHERE id=$1", [TARGETS.D003]));
    }
  });

  it("冻结：登记后的目标角色 / 交接包 / 深度不可改（DB 触发器）；包内多余键被 CHECK 拒绝", async () => {
    const tamper = await asApp(ORG, (c) => c.query("UPDATE agent_handoffs SET target_role='D005' WHERE id=$1", [handoffId]).then(() => null, (x: { code?: string }) => x.code));
    expect(tamper).toBe("23514");
    const extra = await asApp(ORG, (c) => c.query(
      `INSERT INTO agent_handoffs (id, org_id, source_run_id, tool_call_id, source_thread_id, source_agent_id, source_agent_version_id,
         requester_user_id, target_role, packet, depth)
       VALUES ('h-bad', $1, 'r', 't', 'th', 'a', 'v', 'u', 'D003', $2::jsonb, 1)`,
      [ORG, JSON.stringify({ ...PACKET, excerpt: "全文" })]).then(() => null, (x: { code?: string }) => x.code));
    expect(extra).toBe("23514");
  });
});

/* ── 四、官方角色包开箱即可转交（1.3.0）───────────────────────────── */

describe("AG07 · 官方角色包：D002 开箱转交给 D003（真导入、真网关、loopback 剧本同形参数）", () => {
  const ORG2 = toOrgId("org-ag07-official");
  const ADMIN = "u-ag07-official-admin";
  let db: PgDatabase;
  let runs: PgAgentRunRepository;
  let handoffs: PgAgentHandoffStore;
  const calls: ModelCallInput[] = [];
  let script: ModelCallCompletion[] = [];
  const model: ModelCallPort = {
    async complete(input) { calls.push(input); const n = script.shift(); if (!n) throw new Error("unexpected model call"); return n; },
  };

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    runs = new PgAgentRunRepository(db);
    handoffs = new PgAgentHandoffStore(db);
    await resetOrgs(ORG2);
    await seedOrg({ orgId: ORG2, projectId: "proj-ag07-official" });
    await addOrgMember(ORG2, ADMIN, "admin", null);
    await addProjectMember(ORG2, "proj-ag07-official", ADMIN, "member", null);
    const pack = buildOfficialAgentRolePack();
    await importOfficialAgentRolePack(
      {
        identities: new PgIdentityRepository(db),
        packs: { load: async () => pack } as never,
        workflows: { isRegistered: async () => true, workflowName: async () => null } as never,
        imports: new PgOfficialAgentRolePackImportRepository(db),
      },
      { actorId: ADMIN, orgId: ORG2, packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() },
    );
  }, 120_000);

  afterAll(async () => {
    await resetOrgs(ORG2);
    await db?.close();
  });

  it("官方包的转交目标由白名单推导，D002 → D003 登记 requested；D002 → D002 自己不在允许集", async () => {
    expect(OFFICIAL_AGENT_ROLE_PACK_VERSION).toBe("1.4.0");
    expect(officialRoleDelegationTargets().D002).toContain("D003");
    const d002 = await asApp(ORG2, async (c) => (await c.query<{ agent_id: string; version_id: string; policy: unknown }>(
      `SELECT a.id AS agent_id, a.published_version_id AS version_id, v.delegation_policy AS policy
         FROM agents a JOIN agent_versions v ON v.id = a.published_version_id AND v.org_id = a.org_id
        WHERE a.org_id = $1 AND a.stable_name = 'd002-research-knowledge-analyst'`, [ORG2])).rows[0]!);
    expect(d002.policy).toEqual({ allowedTargets: [...officialRoleDelegationTargets().D002!], maxDepth: 1, requireApproval: true });

    for (const [runId, role] of [["run-ag07-off-ok", "D003"], ["run-ag07-off-self", "D002"]] as const) {
      // 每条 run 独立线程（同一线程上一条 run 未写回前不会认领下一条）。
      await addChatThread({ orgId: ORG2, id: `thr-${runId}`, projectId: "proj-ag07-official", visibilityScope: "plenary", createdBy: ADMIN });
      await addChatMessage({ orgId: ORG2, id: `${runId}-in`, threadId: `thr-${runId}`, body: `请转交 [request_handoff:${role}]`, authorId: ADMIN });
      await asApp(ORG2, (c) => c.query(
        `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids, model_provider, model_id, status)
         VALUES ($1,$2,'thr-' || $1,$3,$4,$5,'[]'::jsonb,'deep-agent','deep-agent','queued')`,
        [runId, ORG2, `${runId}-in`, d002.agent_id, d002.version_id]));
      // 参数与 loopback 剧本 `[request_handoff:Dxxx]` 发出的形状逐字相同。
      const args = { targetRole: role, packet: { originalQuestion: "请转交", confirmedScope: "", evidenceRefs: [], openItems: [] } };
      calls.length = 0;
      script = [{ text: "", interrupted: { toolName: "request_handoff", toolCallId: `call-${runId}`, argsSummary: JSON.stringify(args) } }, { text: "好的。" }];
      let n = 0;
      const d = { runs, model, log: () => {}, handoffs, clock: { now: () => new Date().toISOString(), newStepId: () => `s-${runId}-${n++}` } } as unknown as ExecuteAgentRunDeps;
      await executeQueuedRuns(d, { orgId: ORG2 });
      const st = await asApp(ORG2, async (c) => (await c.query<{ status: string }>("SELECT status FROM agent_runs WHERE id=$1", [runId])).rows[0]!.status);
      if (st === "queued") await executeQueuedRuns(d, { orgId: ORG2 });
      expect(calls, "中断 + edit resume 共两次模型调用").toHaveLength(2);
      const outcome = (JSON.parse((calls[1]!.resume as { editedAction: { argsJson: string } }).editedAction.argsJson) as { outcome: AgentHandoffOutcome }).outcome;
      if (role === "D003") expect(outcome).toMatchObject({ status: "requested", targetRole: "D003" });
      else expect(outcome).toMatchObject({ status: "refused", reason: "target_not_in_allowed_targets" });
    }
    const rows = await asApp(ORG2, async (c) => (await c.query<{ target_role: string; status: string; target_name: string }>(
      "SELECT target_role, status, target_name FROM agent_handoffs WHERE org_id=$1", [ORG2])).rows);
    expect(rows).toEqual([{ target_role: "D003", status: "requested", target_name: "产品经理" }]);
  });
});
