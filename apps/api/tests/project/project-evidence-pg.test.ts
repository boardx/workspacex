/**
 * 项目中枢 B3-T1（#4495）—— `PgProjectEvidenceRepository` / `PgEvidenceSources` 对真实 PostgreSQL 的断言
 * （装配同 `project-resources-pg.test.ts`）。用例层的编排见 `project-evidence.test.ts`。
 *
 * ⚠ 本地没有 PG，本文件按仓库约定写好但**未在本地执行**（回报里已写明）。
 *
 * 钉住：
 *   · 列表按 (created_at, id) 倒序分页，游标不漏不重；按来源筛选；`countsBySource` 六类含 0、不受筛选影响；
 *   · 观察者可读；非成员 / 不存在的容器 NO_PROJECT_ROLE；单条不存在 EVIDENCE_NOT_FOUND；
 *   · 跨租户：另一组织同 id 的证据看不到（RLS + org_id 谓词）；
 *   · `revokeBySource` 之后默认不出现、`includeRevoked` 才带出，`find` 仍回；再 upsert 同源取消撤回；
 *   · upsert 幂等：同 (org, source_kind, source_ref) 第二次 `created=false` 且 id 不变、摘录刷新；
 *   · 采集器对真实来源表：问卷答卷（jsonb）/ 个人转写段 / 访谈段 + 引述 / 深研 accepted 来源 各采出正确条数；
 *   · chat 回填：批次带 `evidenceId` 经 `kg_apply_batch` 落表后 `claim_message_evidence.evidence_id` 指向单元，
 *     `listForIngestion` 不再把它当「尚未入图」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { collectProjectEvidence } from "../../src/application/project/collect-project-evidence";
import { authorizeProjectEvidenceAccess, listProjectEvidence } from "../../src/application/project/list-project-evidence";
import { getProjectEvidence } from "../../src/application/project/get-project-evidence";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { OntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { PgEvidenceSources } from "../../src/infrastructure/project/pg-evidence-sources";
import { PgProjectEvidenceRepository } from "../../src/infrastructure/project/pg-project-evidence-repository";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const HOOK_TIMEOUT_MS = 120_000;
const ORG = "org-b3t1-pg";
const OTHER = "org-b3t1-pg-other";
const ORG_ID = toOrgId(ORG);
const P_A = `${ORG}-pa`;
const OWNER = "u-owner";
const OBSERVER = "u-observer";

let db: PgDatabase;
let repo: PgProjectEvidenceRepository;
let sources: PgEvidenceSources;
let deps: Parameters<typeof listProjectEvidence>[0];

const asUser = (userId: string, projectId = P_A) => ({ userId, orgId: ORG_ID, projectId });

const cmd = (sourceRef: string, over: Partial<Parameters<PgProjectEvidenceRepository["upsert"]>[0]> = {}) => ({
  orgId: ORG_ID, projectId: P_A, sourceKind: "survey_response" as const, resourceId: "s1", sourceRef,
  excerpt: `摘录 ${sourceRef}`, locator: { ordinal: 1 }, speakerLabel: null, resourceTitle: "问卷一", ...over,
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProjectEvidenceRepository(db);
  sources = new PgEvidenceSources(db);
  deps = { auth: { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() }, evidence: repo };
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: P_A });
  await addOrgMember(ORG, OWNER, "consultant", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, P_A, OWNER, "member", null);
  await addProjectMember(ORG, P_A, OBSERVER, "observer", null);
  await seedOrg({ orgId: OTHER, projectId: `${OTHER}-p` });
}, HOOK_TIMEOUT_MS);

describe("PgProjectEvidenceRepository（真实 PG）", () => {
  it("upsert 幂等：同源第二次 created=false、id 不变、摘录刷新；不同来源类各自一行", async () => {
    const first = await repo.upsert(cmd("r1:q1"));
    expect(first.created).toBe(true);
    expect(first.id).toMatch(/^ev_[0-9a-f]{32}$/);
    const again = await repo.upsert(cmd("r1:q1", { excerpt: "新摘录" }));
    expect(again).toEqual({ id: first.id, created: false });
    const other = await repo.upsert(cmd("r1:q1", { sourceKind: "transcript_segment", resourceId: "t1" }));
    expect(other.created).toBe(true);
    expect(other.id).not.toBe(first.id);
    const row = await getProjectEvidence(deps, { ...asUser(OWNER), evidenceId: first.id });
    expect(row).toMatchObject({ excerpt: "新摘录", sourceKind: "survey_response", locator: { ordinal: 1 }, revoked: false });
  });

  it("列表：倒序分页游标不漏不重；按来源筛选；countsBySource 六类含 0 且不受筛选影响；观察者可读", async () => {
    for (let i = 1; i <= 5; i += 1) await repo.upsert(cmd(`r${i}:q1`));
    await repo.upsert(cmd("seg-1", { sourceKind: "transcript_segment", resourceId: "t1" }));

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listProjectEvidence(deps, { ...asUser(OBSERVER), limit: 4, ...(cursor !== undefined ? { cursor } : {}) });
      seen.push(...page.items.map((x) => x.id));
      expect(page.countsBySource).toEqual({ chat_message: 0, attachment: 0, survey_response: 5, interview_segment: 0, transcript_segment: 1, research_source: 0, whiteboard_note: 0 });
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(new Set(seen).size).toBe(6);
    expect(seen).toHaveLength(6);

    const only = await listProjectEvidence(deps, { ...asUser(OWNER), sourceKind: "transcript_segment" });
    expect(only.items.map((x) => x.sourceRef)).toEqual(["seg-1"]);
    expect(only.nextCursor).toBeNull();
    expect(only.countsBySource.survey_response).toBe(5);

    // 坏游标 ⇒ 从头开始，不抛
    const fromStart = await listProjectEvidence(deps, { ...asUser(OWNER), cursor: "not-a-cursor", limit: 10 });
    expect(fromStart.items).toHaveLength(6);
  });

  it("撤回：默认不出现、includeRevoked 才带出、find 仍回；再 upsert 同源取消撤回", async () => {
    const a = await repo.upsert(cmd("r1:q1"));
    await repo.upsert(cmd("r2:q1"));
    await repo.upsert(cmd("seg-1", { sourceKind: "transcript_segment", resourceId: "t1" }));
    expect(await repo.revokeBySource(ORG_ID, "survey_response", "s1")).toBe(2);
    expect(await repo.revokeBySource(ORG_ID, "survey_response", "s1")).toBe(0);

    const visible = await listProjectEvidence(deps, asUser(OWNER));
    expect(visible.items.map((x) => x.sourceRef)).toEqual(["seg-1"]);
    expect(visible.countsBySource.survey_response).toBe(0);
    const all = await listProjectEvidence(deps, { ...asUser(OWNER), includeRevoked: true });
    expect(all.items).toHaveLength(3);
    expect(all.countsBySource.survey_response).toBe(2);
    expect(await getProjectEvidence(deps, { ...asUser(OWNER), evidenceId: a.id })).toMatchObject({ revoked: true });

    expect(await repo.upsert(cmd("r1:q1"))).toEqual({ id: a.id, created: false });
    expect(await getProjectEvidence(deps, { ...asUser(OWNER), evidenceId: a.id })).toMatchObject({ revoked: false });
  });

  it("非成员 / 不存在的容器 ⇒ NO_PROJECT_ROLE；不存在的单条 ⇒ EVIDENCE_NOT_FOUND", async () => {
    const a = await repo.upsert(cmd("r1:q1"));
    await addOrgMember(ORG, "u-stranger", "consultant", null);
    await expect(listProjectEvidence(deps, asUser("u-stranger"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(getProjectEvidence(deps, { ...asUser("u-stranger"), evidenceId: a.id })).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(listProjectEvidence(deps, asUser(OWNER, "no-such-project"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(getProjectEvidence(deps, { ...asUser(OWNER), evidenceId: "ev_missing" })).rejects.toMatchObject({ reasonCode: "EVIDENCE_NOT_FOUND" });
  });

  it("跨租户：另一组织同 source_ref 的证据本组织看不到；同 id 也回 EVIDENCE_NOT_FOUND", async () => {
    const otherProject = `${OTHER}-p`;
    const theirs = await repo.upsert({ ...cmd("r1:q1"), orgId: toOrgId(OTHER), projectId: otherProject });
    const mine = await listProjectEvidence(deps, asUser(OWNER));
    expect(mine.items).toHaveLength(0);
    await expect(getProjectEvidence(deps, { ...asUser(OWNER), evidenceId: theirs.id })).rejects.toMatchObject({ reasonCode: "EVIDENCE_NOT_FOUND" });
    const raw = await asApp(ORG, (c) => c.query("SELECT id FROM project_evidence"));
    expect(raw.rows).toHaveLength(0);
  });
});

/* ────────────────────────────── 采集器对真实来源表 ────────────────────────────── */

async function seedSources(): Promise<void> {
  await asApp(ORG, async (c) => {
    const model = {
      id: "s1", title: "并网问卷", status: "collecting", version: 1, anonymity: "anonymous", answerRevision: 0, updatedAt: new Date().toISOString(),
      questions: [{ id: "q1", order: 1, chapterId: "c", type: "text", title: "最大痛点", required: true, options: [] }],
      responses: [
        { id: "r1", role: "x", companySize: "y", quality: "normal", submittedAt: new Date().toISOString(), durationSeconds: 1, answers: [{ questionId: "q1", value: "审批太慢" }] },
        { id: "r2", role: "x", companySize: "y", quality: "normal", analysis: "excluded", exclusionReason: "测试", submittedAt: new Date().toISOString(), durationSeconds: 1, answers: [{ questionId: "q1", value: "无" }] },
      ],
    };
    await c.query(
      `INSERT INTO survey_workspaces (org_id, id, owner_id, document) VALUES ($1, 's1', $2, $3::jsonb)`,
      [ORG, OWNER, JSON.stringify({ ownerId: OWNER, model, receipts: {} })],
    );
    await c.query(
      `INSERT INTO personal_transcriptions (id, org_id, owner_user_id, name, status) VALUES ('t1', $1, $2, '周会录音', 'idle')`,
      [ORG, OWNER],
    );
    await c.query(
      `INSERT INTO guided_research_sessions (id, org_id, owner_user_id, idempotency_key, title, brief, stage, resume_stage)
       VALUES ('g1', $1, $2, 'k-g1', '储能政策研究', '{}'::jsonb, 'researching', 'researching')`,
      [ORG, OWNER],
    );
    await c.query(
      `INSERT INTO guided_research_runtime (session_id, org_id, state) VALUES ('g1', $1, $2::jsonb)`,
      [ORG, JSON.stringify({ sources: [
        { id: "src1", taskId: "t", title: "发改委通知", url: "https://example.com/a", content: "正文", retrievedAt: "2026-09-28T00:00:00Z", decision: "accepted", presentation: { title: "发改委通知", summary: "补贴退坡" } },
        { id: "src2", taskId: "t", title: "无关", url: "https://example.com/b", content: "正文", retrievedAt: "2026-09-28T00:00:00Z", decision: "excluded" },
      ] })],
    );
    await c.query(
      `INSERT INTO interview_sessions (id, org_id, project_id, source_kind, title, created_by) VALUES ('i1', $1, $2, 'human', '采购访谈', $3)`,
      [ORG, P_A, OWNER],
    );
    await c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, created_by) VALUES ('sub1', $1, '张三', $2)`,
      [ORG, OWNER],
    );
    await c.query(
      `INSERT INTO interview_quotes (id, org_id, interview_id, segment_id, subject_id, text, created_by)
       VALUES ('qt1', $1, 'i1', 'seg-x', 'sub1', '我们只看交付周期', $2)`,
      [ORG, OWNER],
    );
    // 录音链：个人转写（project_id 必须为 NULL）与访谈（project_id 必须非空）各一段最终转写。
    for (const [sess, srcType, ref, projectId] of [["rs-t1", "personal", "t1", null], ["rs-i1", "interview", "i1", P_A]] as const) {
      await c.query(
        `INSERT INTO recording_sessions (id, org_id, project_id, source_type, source_ref_id, started_at,
                                         retention_days, retention_from, retention_resolved_at, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, now(), 30, 'org', now(), now() + interval '30 days', $6)`,
        [sess, ORG, projectId, srcType, ref, OWNER],
      );
      await c.query(
        `INSERT INTO recording_tracks (id, org_id, session_id, participant_id, mic_state, gap_ranges, open_gap_from_ms)
         VALUES ($1, $2, $3, NULL, 'granted', '[]'::jsonb, NULL)`,
        [`${sess}-track`, ORG, sess],
      );
      await c.query(
        `INSERT INTO recording_segments (id, org_id, session_id, track_id, ordinal, source_type, anchor_start_ms, anchor_end_ms,
                                         speaker_channel_id, status, low_confidence, text)
         VALUES ($1, $2, $3, $4, 1, $5, 0, 1500, 'ch-1', 'final', false, $6)`,
        [`${sess}-seg1`, ORG, sess, `${sess}-track`, srcType, srcType === "personal" ? "我们下周上线" : "价格是关键"],
      );
    }
    await c.query(
      `INSERT INTO project_resource_links (org_id, project_id, kind, resource_id, linked_by) VALUES
         ($1, $2, 'survey', 's1', $3), ($1, $2, 'personal_transcription', 't1', $3), ($1, $2, 'guided_research', 'g1', $3)`,
      [ORG, P_A, OWNER],
    );
  });
}

describe("采集器对真实来源表", () => {
  it("四类各采出正确条数；再采一次全部 refreshed；答卷匿名、访谈引述带受访者名", async () => {
    await seedSources();
    const decision = await authorizeProjectEvidenceAccess(deps, asUser(OWNER));
    const out = await collectProjectEvidence({ sources, evidence: repo }, { orgId: ORG_ID, projectId: P_A, decision });
    expect(out.survey_response).toEqual({ scanned: 1, created: 1, refreshed: 0 });
    expect(out.transcript_segment).toEqual({ scanned: 1, created: 1, refreshed: 0 });
    expect(out.interview_segment).toEqual({ scanned: 2, created: 2, refreshed: 0 });
    expect(out.research_source).toEqual({ scanned: 1, created: 1, refreshed: 0 });

    const again = await collectProjectEvidence({ sources, evidence: repo }, { orgId: ORG_ID, projectId: P_A, decision });
    expect(again.total).toEqual({ scanned: 5, created: 0, refreshed: 5 });

    // 内容断言按负责人读（观察者视角会抹掉说话人，见 evidence-redaction.ts；下面单独核一次）。
    const page = await listProjectEvidence(deps, { ...asUser(OWNER), limit: 50 });
    const byRef = Object.fromEntries(page.items.map((x) => [x.sourceRef, x]));
    const observerPage = await listProjectEvidence(deps, { ...asUser(OBSERVER), limit: 50 });
    expect(observerPage.items.map((x) => x.sourceRef).sort()).toEqual(page.items.map((x) => x.sourceRef).sort());
    expect(observerPage.items.every((x) => x.speakerLabel === null)).toBe(true);
    expect(byRef["r1:q1"]).toMatchObject({ sourceKind: "survey_response", resourceId: "s1", excerpt: "最大痛点：审批太慢", speakerLabel: null, resourceTitle: "并网问卷", locator: { ordinal: 1 } });
    expect(byRef["rs-t1-seg1"]).toMatchObject({ sourceKind: "transcript_segment", resourceId: "t1", excerpt: "我们下周上线", speakerLabel: "ch-1", locator: { ordinal: 1, startMs: 0, endMs: 1500 }, resourceTitle: "周会录音" });
    expect(byRef["rs-i1-seg1"]).toMatchObject({ sourceKind: "interview_segment", resourceId: "i1", excerpt: "价格是关键", resourceTitle: "采购访谈" });
    expect(byRef["qt1"]).toMatchObject({ sourceKind: "interview_segment", resourceId: "i1", excerpt: "我们只看交付周期", speakerLabel: "张三" });
    expect(byRef["src1"]).toMatchObject({ sourceKind: "research_source", resourceId: "g1", excerpt: "发改委通知 — 补贴退坡", resourceTitle: "储能政策研究" });
    expect(byRef["src2"]).toBeUndefined();
    expect(byRef["r2:q1"]).toBeUndefined();
  });

  it("来源读取是 Guarded：判定不允许 ⇒ 什么都不采", async () => {
    await seedSources();
    const denied = { allowed: false as const, decisionId: "d-x", reasonCode: "NO_PROJECT_ROLE", role: null, scope: null } as never;
    const out = await collectProjectEvidence({ sources, evidence: repo }, { orgId: ORG_ID, projectId: P_A, decision: denied });
    expect(out.total).toEqual({ scanned: 0, created: 0, refreshed: 0 });
    const g = await sources.surveysOf(ORG_ID, P_A);
    expect(isDisclosed(discloseDecided(g, denied))).toBe(false);
  });
});

/* ────────────────────────────── chat 回填经执行器落表 ────────────────────────────── */

describe("chat 消息证据回填 evidence_id（kg_apply_batch）", () => {
  it("批次带 evidenceId ⇒ claim_message_evidence.evidence_id 指向单元；listForIngestion 不再把它当尚未入图", async () => {
    const T = `${ORG}-thread`;
    await addChatThread({ orgId: ORG, id: T, projectId: P_A, visibilityScope: "private", createdBy: OWNER, title: "并网讨论" });
    await addChatMessage({ orgId: ORG, id: `${T}-m1`, threadId: T, body: "我们决定 9/29 上线", authorId: OWNER });
    expect(await sources.chatThreadProject(ORG_ID, T)).toEqual({ projectId: P_A, title: "并网讨论" });

    const unit = await repo.upsert({
      orgId: ORG_ID, projectId: P_A, sourceKind: "chat_message", resourceId: T, sourceRef: `${T}-m1`,
      excerpt: "我们决定 9/29 上线", locator: {}, speakerLabel: null, resourceTitle: "并网讨论",
    });
    const batch: OntologyBatch = {
      actionId: `act-${T}`, scope: { kind: "chat_session", id: T }, actor: { kind: "model", id: "kg-extractor" }, actionType: "extract",
      sourceRef: `${T}-m1`, pipelineVersion: "kg-extract@1", objects: [], edges: [],
      claims: [{
        id: `clm-${T}`, claimKind: "decision", statement: "决定 9/29 上线", status: "proposed", confidence: 0.8,
        evidence: [{ messageId: `${T}-m1`, stance: "supporting", excerpt: "我们决定 9/29 上线", evidenceId: unit.id }],
      }],
    };
    const out = await applyOntologyBatch(new PgOntologyStore(db), ORG_ID, null, batch);
    expect(out.outcome).toBe("accepted");

    const anchors = await asApp(ORG, (c) => c.query<{ evidence_id: string | null }>(
      "SELECT evidence_id FROM claim_message_evidence WHERE org_id = $1 AND claim_id = $2", [ORG, `clm-${T}`],
    ));
    expect(anchors.rows.map((r) => r.evidence_id)).toEqual([unit.id]);

    const decision = await authorizeProjectEvidenceAccess(deps, asUser(OWNER));
    const pending = discloseDecided(await repo.listForIngestion(ORG_ID, P_A, ["chat_message"], 10), decision);
    expect(isDisclosed(pending) ? pending.payload.map((x) => x.id) : "withheld").toEqual([]);
  });

  it("evidenceId 指不到本 org 的单元 ⇒ 落 NULL，不拒批", async () => {
    const T = `${ORG}-thread2`;
    await addChatThread({ orgId: ORG, id: T, projectId: P_A, visibilityScope: "private", createdBy: OWNER });
    await addChatMessage({ orgId: ORG, id: `${T}-m1`, threadId: T, body: "随便一句", authorId: OWNER });
    const batch: OntologyBatch = {
      actionId: `act-${T}`, scope: { kind: "chat_session", id: T }, actor: { kind: "model", id: "kg-extractor" }, actionType: "extract",
      sourceRef: `${T}-m1`, pipelineVersion: "kg-extract@1", objects: [], edges: [],
      claims: [{
        id: `clm-${T}`, claimKind: "fact", statement: "随便", status: "proposed", confidence: null,
        evidence: [{ messageId: `${T}-m1`, stance: "supporting", excerpt: "随便一句", evidenceId: "ev_does_not_exist" }],
      }],
    };
    expect((await applyOntologyBatch(new PgOntologyStore(db), ORG_ID, null, batch)).outcome).toBe("accepted");
    const anchors = await asApp(ORG, (c) => c.query<{ evidence_id: string | null }>(
      "SELECT evidence_id FROM claim_message_evidence WHERE org_id = $1 AND claim_id = $2", [ORG, `clm-${T}`],
    ));
    expect(anchors.rows.map((r) => r.evidence_id)).toEqual([null]);
  });
});
