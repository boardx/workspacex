/**
 * 项目中枢 B3-T1（#4495）—— 证据归一化的**编排**断言，喂 in-memory 假端口（同 `project-resources.test.ts`）。
 * SQL 那一侧（分页游标、幂等 upsert、撤回、跨租户）由 `project-evidence-pg.test.ts` 对真实 PostgreSQL 断言。
 *
 * 钉住：
 *   · 读：成员 / 观察者能读；非成员 NO_PROJECT_ROLE；组织管理员无项目角色也折叠为 NO_PROJECT_ROLE
 *     （契约 `err` 里没有 ADMIN_NOT_SUPERUSER）；判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE；容器不存在 ⇒
 *     NO_PROJECT_ROLE；单条不存在 ⇒ EVIDENCE_NOT_FOUND；筛选 / 分页参数原样交给端口。
 *   · 采集：四个采集器把来源展开成正确粒度的 upsert 命令（答卷每题一条、匿名；转写段带时间锚；访谈段 + 引述；
 *     深研只采 accepted），判定不允许 ⇒ 一条不写。
 *   · 挂载顺带采集：`linkProjectResource` 成功后对刚挂上的那一类 + 访谈调采集；采集抛错不影响挂载结果。
 *   · chat 回填：项目线程的消息锚点 upsert 一条 `chat_message` 单元并带上 `evidenceId`；个人线程原样返回。
 */
import { describe, expect, it } from "vitest";
import { listProjectEvidence } from "../../src/application/project/list-project-evidence";
import { getProjectEvidence } from "../../src/application/project/get-project-evidence";
import { collectProjectEvidence } from "../../src/application/project/collect-project-evidence";
import { attachChatMessageEvidence } from "../../src/application/project/collect-evidence/chat";
import { answerText } from "../../src/application/project/collect-evidence/survey";
import { clipExcerpt } from "../../src/application/project/collect-evidence/shared";
import { linkProjectResource } from "../../src/application/project/link-project-resource";
import type { ProjectEvidenceSourcePort } from "../../src/application/project/collect-evidence/ports";
import type {
  ProjectEvidenceListFilter, ProjectEvidencePage, ProjectEvidencePort, ProjectEvidenceRow, ProjectEvidenceSourceKind, UpsertEvidenceCommand,
} from "../../src/application/project/project-evidence-ports";
import type { LinkResourceOutcome, ProjectResourcePort, ProjectResourceRow } from "../../src/application/project/project-resource-ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { IdentityRepository } from "../../src/application/identity/ports";
import type { OntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-b3t1");
const PROJECT = "p-b3t1";
const ZERO_COUNTS: Record<ProjectEvidenceSourceKind, number> = {
  chat_message: 0, attachment: 0, survey_response: 0, interview_segment: 0, transcript_segment: 0, research_source: 0, whiteboard_note: 0,
};

const row = (id: string, sourceKind: ProjectEvidenceSourceKind = "survey_response"): ProjectEvidenceRow => ({
  id, projectId: PROJECT, sourceKind, resourceId: "r1", sourceRef: `ref-${id}`, excerpt: `e-${id}`, locator: {},
  speakerLabel: null, resourceTitle: "t", revoked: false, createdAt: "2026-09-28T00:00:00.000Z",
});

class FakeEvidence implements ProjectEvidencePort {
  readonly rows: ProjectEvidenceRow[] = [];
  readonly upserts: UpsertEvidenceCommand[] = [];
  lastFilter: ProjectEvidenceListFilter | null = null;
  constructor(private readonly projectExists = true) {}
  async list(_o: OrgId, projectId: string, filter: ProjectEvidenceListFilter): Promise<Guarded<ProjectEvidencePage | null>> {
    this.lastFilter = filter;
    const ref = { kind: "project" as const, id: projectId };
    if (!this.projectExists) return guard(ref, null);
    return guard(ref, { items: this.rows, nextCursor: null, countsBySource: ZERO_COUNTS });
  }
  async find(_o: OrgId, projectId: string, evidenceId: string): Promise<Guarded<ProjectEvidenceRow | null>> {
    return guard({ kind: "project", id: projectId }, this.rows.find((r) => r.id === evidenceId) ?? null);
  }
  async upsert(cmd: UpsertEvidenceCommand): Promise<{ id: string; created: boolean }> {
    const existing = this.upserts.findIndex((u) => u.sourceKind === cmd.sourceKind && u.sourceRef === cmd.sourceRef);
    this.upserts.push(cmd);
    return { id: `ev_${cmd.sourceKind}_${cmd.sourceRef}`, created: existing < 0 };
  }
  async revokeBySource(): Promise<number> { return 0; }
  async listForIngestion(_o: OrgId, projectId: string): Promise<Guarded<readonly ProjectEvidenceRow[]>> {
    return guard({ kind: "project", id: projectId }, this.rows);
  }
}

const identity = new FakeRoleViewRepository({
  member: { orgRole: "consultant", projectRole: "member" },
  observer: { orgRole: "consultant", projectRole: "observer" },
  outsider: { orgRole: "consultant", projectRole: null },
  admin: { orgRole: "admin", projectRole: null },
});
const deps = (evidence: ProjectEvidencePort, repo: IdentityRepository = identity) => ({ auth: { repo, ids: new FakeDecisionIds() }, evidence });
const viewer = (userId: string, projectId = PROJECT) => ({ userId, orgId: ORG, projectId });

describe("listProjectEvidence / getProjectEvidence：成员门", () => {
  it("成员与观察者都能读；筛选 / 分页参数原样交给端口，limit 缺省 50", async () => {
    const ev = new FakeEvidence();
    ev.rows.push(row("a"), row("b", "transcript_segment"));
    for (const u of ["member", "observer"]) {
      const out = await listProjectEvidence(deps(ev), viewer(u));
      expect(out.items.map((x) => x.id)).toEqual(["a", "b"]);
      expect(out.countsBySource).toEqual(ZERO_COUNTS);
      expect(ev.lastFilter).toEqual({ limit: 50 });
    }
    await listProjectEvidence(deps(ev), { ...viewer("member"), sourceKind: "transcript_segment", includeRevoked: true, limit: 5, cursor: "c" });
    expect(ev.lastFilter).toEqual({ limit: 5, sourceKind: "transcript_segment", includeRevoked: true, cursor: "c" });
    expect(await getProjectEvidence(deps(ev), { ...viewer("observer"), evidenceId: "b" })).toMatchObject({ id: "b", sourceKind: "transcript_segment" });
  });

  it("B3-T5 接线：观察者读到的证据脱敏（说话人置空、摘录截到 80 字加「…」），成员原样", async () => {
    const ev = new FakeEvidence();
    const long = "长".repeat(120);
    ev.rows.push({ ...row("p"), excerpt: long, speakerLabel: "受访者 A" });
    const asObserver = await listProjectEvidence(deps(ev), viewer("observer"));
    expect(asObserver.items[0]).toMatchObject({ speakerLabel: null, excerpt: `${"长".repeat(80)}…` });
    const asMember = await listProjectEvidence(deps(ev), viewer("member"));
    expect(asMember.items[0]).toMatchObject({ speakerLabel: "受访者 A", excerpt: long });
    expect(await getProjectEvidence(deps(ev), { ...viewer("observer"), evidenceId: "p" })).toMatchObject({ speakerLabel: null });
  });

  it("非成员 / 无项目角色的组织管理员 / 容器不存在 ⇒ NO_PROJECT_ROLE；单条不存在 ⇒ EVIDENCE_NOT_FOUND", async () => {
    const ev = new FakeEvidence();
    ev.rows.push(row("a"));
    await expect(listProjectEvidence(deps(ev), viewer("outsider"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(listProjectEvidence(deps(ev), viewer("admin"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(listProjectEvidence(deps(new FakeEvidence(false)), viewer("member"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(getProjectEvidence(deps(ev), { ...viewer("outsider"), evidenceId: "a" })).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(getProjectEvidence(deps(ev), { ...viewer("member"), evidenceId: "zzz" })).rejects.toMatchObject({ reasonCode: "EVIDENCE_NOT_FOUND" });
  });

  it("判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE，不降级放行", async () => {
    const broken: IdentityRepository = Object.assign(Object.create(identity), {
      findOrgMembership: async () => { throw new Error("pg down"); },
    });
    await expect(listProjectEvidence(deps(new FakeEvidence(), broken), viewer("member"))).rejects.toMatchObject({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" });
  });
});

/* ────────────────────────────── 采集器 ────────────────────────────── */

const ALLOW = { allowed: true as const, decisionId: "d-1", reasonCode: null, role: "member" as const, scope: null } as never;
const DENY = { allowed: false as const, decisionId: "d-2", reasonCode: "NO_PROJECT_ROLE", role: null, scope: null } as never;

function sources(): ProjectEvidenceSourcePort {
  const ref = { kind: "project" as const, id: PROJECT };
  return {
    surveysOf: async () => guard(ref, [{
      surveyId: "s1", title: "并网问卷",
      questions: [{ id: "q1", title: "最大痛点", order: 1 }, { id: "q2", title: "预算", order: 2 }],
      responses: [
        { id: "r1", analysis: "included", answers: [{ questionId: "q1", value: "审批太慢" }, { questionId: "q2", value: ["10 万", "20 万"] }, { questionId: "q9", value: "" }] },
        { id: "r2", analysis: "excluded", answers: [{ questionId: "q1", value: "无" }] },
      ],
    }]),
    transcriptionsOf: async () => guard(ref, [{
      transcriptionId: "t1", title: "周会录音",
      segments: [{ segmentId: "seg1", ordinal: 1, startMs: 0, endMs: 1500, speakerLabel: "ch-1", text: "  我们下周\n上线 " }],
    }]),
    interviewsOf: async () => guard(ref, [{
      interviewId: "i1", title: "采购访谈",
      segments: [{ segmentId: "iseg1", ordinal: 3, startMs: null, endMs: null, speakerLabel: null, text: "价格是关键" }],
      quotes: [{ quoteId: "qt1", speakerLabel: "张三", text: "我们只看交付周期" }],
    }]),
    researchSessionsOf: async () => guard(ref, [{
      sessionId: "g1", title: "储能政策研究",
      sources: [{ sourceId: "src1", title: "发改委通知", url: "https://x", summary: "2026 起并网补贴退坡" }],
    }]),
    whiteboardsOf: async () => guard(ref, []),
    chatThreadProject: async () => null,
  };
}

describe("collectProjectEvidence：四个采集器", () => {
  it("四类全采：答卷每题一条且匿名、排除的答卷不采、空答案跳过；转写段带时间锚；访谈段 + 引述；深研来源", async () => {
    const ev = new FakeEvidence();
    const out = await collectProjectEvidence({ sources: sources(), evidence: ev }, { orgId: ORG, projectId: PROJECT, decision: ALLOW });
    expect(out.survey_response).toEqual({ scanned: 3, created: 2, refreshed: 0 });
    expect(out.transcript_segment).toEqual({ scanned: 1, created: 1, refreshed: 0 });
    expect(out.interview_segment).toEqual({ scanned: 2, created: 2, refreshed: 0 });
    expect(out.research_source).toEqual({ scanned: 1, created: 1, refreshed: 0 });
    expect(out.total).toEqual({ scanned: 7, created: 6, refreshed: 0 });
    const byRef = Object.fromEntries(ev.upserts.map((u) => [u.sourceRef, u]));
    expect(byRef["r1:q1"]).toMatchObject({ sourceKind: "survey_response", resourceId: "s1", excerpt: "最大痛点：审批太慢", locator: { ordinal: 1 }, speakerLabel: null, resourceTitle: "并网问卷" });
    expect(byRef["r1:q2"]).toMatchObject({ excerpt: "预算：10 万、20 万", locator: { ordinal: 2 } });
    expect(byRef["r2:q1"]).toBeUndefined();
    expect(byRef["seg1"]).toMatchObject({ sourceKind: "transcript_segment", resourceId: "t1", excerpt: "我们下周 上线", locator: { ordinal: 1, startMs: 0, endMs: 1500 }, speakerLabel: "ch-1", resourceTitle: "周会录音" });
    expect(byRef["iseg1"]).toMatchObject({ sourceKind: "interview_segment", resourceId: "i1", locator: { ordinal: 3 }, speakerLabel: null });
    expect(byRef["qt1"]).toMatchObject({ sourceKind: "interview_segment", resourceId: "i1", excerpt: "我们只看交付周期", locator: {}, speakerLabel: "张三", resourceTitle: "采购访谈" });
    expect(byRef["src1"]).toMatchObject({ sourceKind: "research_source", resourceId: "g1", excerpt: "发改委通知 — 2026 起并网补贴退坡", speakerLabel: null, resourceTitle: "储能政策研究" });
    expect(ev.upserts.every((u) => u.orgId === ORG && u.projectId === PROJECT)).toBe(true);
  });

  it("只采指定的类；判定不允许 ⇒ 一条不写", async () => {
    const ev = new FakeEvidence();
    const out = await collectProjectEvidence({ sources: sources(), evidence: ev }, { orgId: ORG, projectId: PROJECT, decision: ALLOW, kinds: ["research_source"] });
    expect(out.total).toEqual({ scanned: 1, created: 1, refreshed: 0 });
    expect(ev.upserts.map((u) => u.sourceKind)).toEqual(["research_source"]);
    const denied = new FakeEvidence();
    const none = await collectProjectEvidence({ sources: sources(), evidence: denied }, { orgId: ORG, projectId: PROJECT, decision: DENY });
    expect(none.total).toEqual({ scanned: 0, created: 0, refreshed: 0 });
    expect(denied.upserts).toHaveLength(0);
  });

  it("答案值三种形状压成一句；摘录折叠空白并截到 280", () => {
    expect(answerText(" a ")).toBe("a");
    expect(answerText(["x", " y ", 3])).toBe("x、y");
    expect(answerText({ 城市: "上海", 规模: ["A", "B"], 空: "" })).toBe("城市：上海；规模：A、B");
    expect(answerText(42)).toBe("");
    expect(clipExcerpt("a\n\n  b")).toBe("a b");
    expect(clipExcerpt("x".repeat(400))).toHaveLength(280);
    expect(clipExcerpt("x".repeat(400)).endsWith("…")).toBe(true);
  });
});

/* ────────────────────────────── 挂载顺带采集 ────────────────────────────── */

class FakeResources implements ProjectResourcePort {
  async listProjectResources(_o: OrgId, projectId: string): Promise<Guarded<readonly ProjectResourceRow[] | null>> {
    return guard({ kind: "project", id: projectId }, []);
  }
  async isOwnedResource(): Promise<boolean> { return true; }
  async linkResource(): Promise<LinkResourceOutcome> { return { kind: "linked" }; }
  async unlinkResource(): Promise<boolean> { return true; }
}

describe("linkProjectResource 之后顺带采集", () => {
  it("挂问卷 ⇒ 采 survey_response + interview_segment，不采别的类；不给 evidence 依赖就只挂不采", async () => {
    const ev = new FakeEvidence();
    const out = await linkProjectResource(
      { auth: { repo: identity, ids: new FakeDecisionIds() }, resources: new FakeResources(), evidence: { sources: sources(), evidence: ev } },
      { ...viewer("member"), kind: "survey", resourceId: "s1" },
    );
    expect(out).toMatchObject({ alreadyLinked: false });
    expect(new Set(ev.upserts.map((u) => u.sourceKind))).toEqual(new Set(["survey_response", "interview_segment"]));
    const plain = await linkProjectResource(
      { auth: { repo: identity, ids: new FakeDecisionIds() }, resources: new FakeResources() },
      { ...viewer("member"), kind: "guided_research", resourceId: "g1" },
    );
    expect(plain).toMatchObject({ alreadyLinked: false });
  });

  it("采集抛错：挂载照样成功，错误进日志", async () => {
    const errors: string[] = [];
    const broken: ProjectEvidenceSourcePort = { ...sources(), surveysOf: async () => { throw new Error("pg down"); } };
    const out = await linkProjectResource(
      {
        auth: { repo: identity, ids: new FakeDecisionIds() }, resources: new FakeResources(),
        evidence: { sources: broken, evidence: new FakeEvidence() }, logger: { error: (msg) => { errors.push(msg); } },
      },
      { ...viewer("member"), kind: "survey", resourceId: "s1" },
    );
    expect(out).toMatchObject({ alreadyLinked: false });
    expect(errors).toEqual(["project evidence collect failed after link"]);
  });
});

/* ────────────────────────────── chat 回填 ────────────────────────────── */

const batch = (scopeKind: "chat_session" | "personal"): OntologyBatch => ({
  actionId: "act_1", scope: { kind: scopeKind, id: "thread-1" }, actor: { kind: "model", id: "m" }, actionType: "extract",
  sourceRef: "msg-1", pipelineVersion: "v1", objects: [], edges: [],
  claims: [
    { id: "clm_1", claimKind: "fact", statement: "s", status: "proposed", confidence: null, evidence: [
      { messageId: "msg-1", stance: "supporting", excerpt: "原话一" }, { segmentId: "seg-1", stance: "supporting" },
    ] },
    { id: "clm_2", claimKind: "fact", statement: "s2", status: "proposed", confidence: null, evidence: [
      { messageId: "msg-1", stance: "contradicting", excerpt: "原话一" }, { messageId: "msg-2", stance: "supporting", excerpt: "   " },
    ] },
  ],
});

describe("attachChatMessageEvidence：项目线程的消息锚点回填 evidenceId", () => {
  it("项目线程：每条消息只 upsert 一次（多条结论共用同一个 evidenceId）；片段锚点与空摘录的锚点不动", async () => {
    const ev = new FakeEvidence();
    const out = await attachChatMessageEvidence(
      { sources: { chatThreadProject: async () => ({ projectId: PROJECT, title: "并网讨论" }) }, evidence: ev }, ORG, batch("chat_session"),
    );
    expect(ev.upserts).toHaveLength(1);
    expect(ev.upserts[0]).toMatchObject({ sourceKind: "chat_message", resourceId: "thread-1", sourceRef: "msg-1", excerpt: "原话一", projectId: PROJECT, resourceTitle: "并网讨论", speakerLabel: null, locator: {} });
    const id = "ev_chat_message_msg-1";
    expect(out.claims[0]!.evidence).toEqual([{ messageId: "msg-1", stance: "supporting", excerpt: "原话一", evidenceId: id }, { segmentId: "seg-1", stance: "supporting" }]);
    expect(out.claims[1]!.evidence).toEqual([{ messageId: "msg-1", stance: "contradicting", excerpt: "原话一", evidenceId: id }, { messageId: "msg-2", stance: "supporting", excerpt: "   " }]);
    expect(out.actionId).toBe("act_1");
  });

  it("个人线程（无 project_id）与非会话作用域：原样返回同一个引用，不碰证据仓储", async () => {
    const ev = new FakeEvidence();
    const personal = batch("chat_session");
    expect(await attachChatMessageEvidence({ sources: { chatThreadProject: async () => null }, evidence: ev }, ORG, personal)).toBe(personal);
    const scoped = batch("personal");
    expect(await attachChatMessageEvidence({ sources: { chatThreadProject: async () => { throw new Error("must not be called"); } }, evidence: ev }, ORG, scoped)).toBe(scoped);
    expect(ev.upserts).toHaveLength(0);
  });
});
