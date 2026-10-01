/**
 * #4615 W2（PROP-PROJECT-WORKSPACE-001 §3.2–3.3）—— DB-free 单测：挂载 + 白板项目来源 + 白板证据 + 对话 / 采纳走统一判据。
 *
 * 钉住：
 *   · 白板项目来源的映射（`projectWhiteboardRole`）：工作坊三写角色 / 通用项目负责人·协作者 ⇒ editor；
 *     观察者 / 名单外组织 lead·admin ⇒ viewer；其余 ⇒ 无；与白板 ACL 取并集（`unionWhiteboardRole`），永不给 owner；
 *   · `resolveWhiteboardProjectRole`：没挂 / 不是组织成员 / agent / 被移出项目 ⇒ 无；项目归档 ⇒ 最多 viewer；
 *   · 白板存储在锁住白板行之后问项目来源（collaboration store `head`、repository `get`），并集生效，未接来源时行为不变；
 *   · 白板证据采集器：一张便签 / 一个文本块一条，摘录 ≤ 280，标题 = 白板名，判定拒绝 ⇒ 什么都不写；
 *     挂载白板时顺带采；设计只挂不采；`whiteboard_note` 进「白板」这个 AI 开关；
 *   · 对话：通用项目协作者能看到项目内共享的会话、看不到别人的仅自己；新建默认项目内共享、不采信 groupId；
 *     分享只有两档；能力集合不含工作坊现场专属两项；
 *   · 采纳为决策：通用项目协作者过得去，名单外的组织 lead KG_NOT_OWNER。
 */
import { describe, expect, it } from "vitest";
import { projectEvidence as PE } from "@repo/contracts";
import { mutateThread, VisibilityScopeInvalidError, type MutateThreadDeps, type MutateThreadInput } from "../../src/application/chat/mutate-thread";
import type { ChatRepository } from "../../src/application/chat/ports";
import { resolveVisibility } from "../../src/application/chat/resolve-visibility";
import type { NonWorkshopStandingRow } from "../../src/application/identity/ports";
import { adoptProjectDecision } from "../../src/application/knowledge-graph/adopt-project-decision";
import { allowedEvidenceKinds } from "../../src/application/knowledge-graph/ingest-project-evidence";
import type { PromotionPort } from "../../src/application/knowledge-graph/ports";
import type { PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { COLLECTABLE_EVIDENCE_KINDS, LINKABLE_KIND_TO_EVIDENCE } from "../../src/application/project/collect-project-evidence";
import type { ProjectEvidenceSourcePort, WhiteboardSourceDoc } from "../../src/application/project/collect-evidence/ports";
import { EVIDENCE_EXCERPT_MAX } from "../../src/application/project/collect-evidence/shared";
import { collectWhiteboardEvidence } from "../../src/application/project/collect-evidence/whiteboard";
import { linkProjectResource } from "../../src/application/project/link-project-resource";
import type { ProjectEvidencePort, UpsertEvidenceCommand } from "../../src/application/project/project-evidence-ports";
import type { ProjectResourcePort } from "../../src/application/project/project-resource-ports";
import { guard } from "../../src/application/security/permission-filter";
import { resolveWhiteboardProjectRole, type BoardProjectLink, type WhiteboardProjectAccess } from "../../src/application/whiteboard/project-access";
import { capabilitiesFor, chatReadAction, decideThreadRead, type ThreadFacts } from "../../src/domain/chat/thread-visibility";
import type { PermissionDecision, ProjectLayerInput } from "../../src/domain/identity/permission-decision";
import { containerAllows, NON_WORKSHOP_CONTAINER_ACTIONS, PROJECT_ROLE_MATRIX } from "../../src/domain/identity/project-role-matrix";
import { nonWorkshopProjectLayer } from "../../src/domain/project/non-workshop-member-access";
import { projectWhiteboardRole, unionWhiteboardRole } from "../../src/domain/whiteboard/access-decision";
import { toOrgId } from "../../src/domain/org-id";
import { projectWhiteboardNotes } from "../../src/infrastructure/project/pg-evidence-sources";
import { PgWhiteboardCollaborationStore } from "../../src/infrastructure/whiteboard/pg-collaboration-store";
import { PgWhiteboardRepository } from "../../src/infrastructure/whiteboard/pg-whiteboard-repository";
import { sessionBoundDatabase } from "../../src/infrastructure/whiteboard/pg-whiteboard-project-access";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository, type FakeMembership } from "../support/role-view-fakes";

const ORG = toOrgId("org-4615-w2");
const GENERAL = "p-4615-general";
const WORKSHOP = "p-4615-workshop";
const BOARD = "8f0e3c1a-5b7d-4c2e-9a1f-0d6b2e4c8a10";

/** 工作坊身份沿用 `FakeRoleViewRepository`（按 userId）；通用项目两档身份按 `projectId/userId` 另存。 */
class GeneralIdentity extends FakeRoleViewRepository {
  constructor(members: Record<string, FakeMembership>, private readonly tiers: Record<string, NonWorkshopStandingRow["memberRole"]>) {
    super(members);
  }
  override async findProjectMembership(userId: string, projectId?: string) {
    // 工作坊行只在 WORKSHOP 里有（真实仓储：project_memberships 只装工作坊）。
    if (projectId !== undefined && projectId !== WORKSHOP) return null;
    return super.findProjectMembership(userId);
  }
  override async findNonWorkshopStanding(userId: string, projectId: string): Promise<NonWorkshopStandingRow | null> {
    if (projectId !== GENERAL) return null;
    return { containerKind: "general", memberRole: this.tiers[`${projectId}/${userId}`] ?? null } as NonWorkshopStandingRow;
  }
}

const members: Record<string, FakeMembership> = {
  "u-owner": { orgRole: "consultant", projectRole: null },
  "u-collab": { orgRole: "consultant", projectRole: null },
  "u-outsider": { orgRole: "consultant", projectRole: null },
  "u-lead": { orgRole: "lead", projectRole: null },
  "u-ws-member": { orgRole: "consultant", projectRole: "member", groupId: "g1" },
  "u-ws-observer": { orgRole: "consultant", projectRole: "observer" },
};
const tiers = { [`${GENERAL}/u-owner`]: "owner", [`${GENERAL}/u-collab`]: "collaborator" } as const;
const identity = () => new GeneralIdentity(members, { ...tiers });

/* ───────────────────────── 白板：项目来源的映射 ───────────────────────── */

describe("projectWhiteboardRole / unionWhiteboardRole（纯函数）", () => {
  const ws = (role: ProjectLayerInput["role"]): ProjectLayerInput => ({ role, groupId: null, containerKind: "workshop" });

  it("工作坊：facilitator / groupLead / member ⇒ editor；observer ⇒ viewer；无角色 ⇒ null", () => {
    expect(projectWhiteboardRole(ws("facilitator"))).toBe("editor");
    expect(projectWhiteboardRole(ws("groupLead"))).toBe("editor");
    expect(projectWhiteboardRole(ws("member"))).toBe("editor");
    expect(projectWhiteboardRole(ws("observer"))).toBe("viewer");
    expect(projectWhiteboardRole(ws(null))).toBeNull();
  });

  it("通用项目（经 nonWorkshopProjectLayer）：负责人 / 协作者 ⇒ editor；名单外 lead·admin ⇒ viewer；名单外顾问 ⇒ null", () => {
    const layer = (memberRole: "owner" | "collaborator" | null, orgRole: "consultant" | "lead" | "admin") =>
      nonWorkshopProjectLayer({ containerKind: "general" as never, memberRole, orgRole });
    expect(projectWhiteboardRole(layer("owner", "consultant"))).toBe("editor");
    expect(projectWhiteboardRole(layer("collaborator", "consultant"))).toBe("editor");
    expect(projectWhiteboardRole(layer(null, "lead"))).toBe("viewer");
    expect(projectWhiteboardRole(layer(null, "admin"))).toBe("viewer");
    expect(projectWhiteboardRole(layer(null, "consultant"))).toBeNull();
  });

  it("矩阵：编辑动作给三个写角色、observer 没有，且在非工作坊白名单里", () => {
    expect(PROJECT_ROLE_MATRIX.observer).not.toContain("content.editWhiteboard");
    for (const r of ["facilitator", "groupLead", "member"] as const) expect(PROJECT_ROLE_MATRIX[r]).toContain("content.editWhiteboard");
    expect(NON_WORKSHOP_CONTAINER_ACTIONS).toContain("content.editWhiteboard");
    expect(containerAllows("general" as never, "content.editWhiteboard")).toBe(true);
    // 现场贴便签仍对非工作坊关着：白板编辑不是借它开的。
    expect(containerAllows("general" as never, "content.postNote")).toBe(false);
  });

  it("并集：取更强的一个；项目来源永不给 owner、也不削弱白板自己的角色", () => {
    expect(unionWhiteboardRole(null, null)).toBeNull();
    expect(unionWhiteboardRole(null, "editor")).toBe("editor");
    expect(unionWhiteboardRole("viewer", "editor")).toBe("editor");
    expect(unionWhiteboardRole("commenter", "viewer")).toBe("commenter");
    expect(unionWhiteboardRole("owner", "viewer")).toBe("owner");
    expect(unionWhiteboardRole("editor", null)).toBe("editor");
  });
});

describe("resolveWhiteboardProjectRole（经 resolveProjectLayer）", () => {
  const link = (l: BoardProjectLink | null) => async () => l;
  const run = (userId: string, l: BoardProjectLink | null, repo = identity()) =>
    resolveWhiteboardProjectRole({ identity: repo, boardProject: link(l) }, { userId, orgId: ORG, boardId: BOARD });

  it("没挂在项目上 ⇒ 无来源（哪怕是项目负责人）", async () => {
    expect(await run("u-owner", null)).toBeNull();
  });
  it("挂在通用项目上：负责人 / 协作者 editor，名单外 lead viewer，名单外顾问无", async () => {
    const l = { projectId: GENERAL, archived: false };
    expect(await run("u-owner", l)).toBe("editor");
    expect(await run("u-collab", l)).toBe("editor");
    expect(await run("u-lead", l)).toBe("viewer");
    expect(await run("u-outsider", l)).toBeNull();
  });
  it("挂在工作坊上：成员 editor、观察者 viewer", async () => {
    const l = { projectId: WORKSHOP, archived: false };
    expect(await run("u-ws-member", l)).toBe("editor");
    expect(await run("u-ws-observer", l)).toBe("viewer");
  });
  it("项目已归档 ⇒ 最多 viewer；不是组织成员 / agent ⇒ 无", async () => {
    expect(await run("u-collab", { projectId: GENERAL, archived: true })).toBe("viewer");
    expect(await run("stranger", { projectId: GENERAL, archived: false })).toBeNull();
    expect(await run("agent:helper", { projectId: GENERAL, archived: false })).toBeNull();
  });
  it("被移出项目 ⇒ 立即失去这条来源", async () => {
    const repo = identity();
    const l = { projectId: GENERAL, archived: false };
    expect(await run("u-collab", l, repo)).toBe("editor");
    delete (repo as unknown as { tiers: Record<string, unknown> }).tiers[`${GENERAL}/u-collab`];
    expect(await run("u-collab", l, repo)).toBeNull();
  });
});

/* ─────────────── 白板存储：锁住白板行之后问项目来源，与 ACL 取并集 ─────────────── */

type Handler = (sql: string, params: readonly unknown[]) => { rows: unknown[] } | undefined;
function fakeDb(handler: Handler, log: string[] = []) {
  const session = {
    async query(sql: string, params: readonly unknown[] = []) {
      log.push(sql.replace(/\s+/g, " ").trim());
      return handler(sql, params) ?? { rows: [] };
    },
  };
  return {
    db: { withTenant: async (_o: unknown, fn: (s: unknown) => unknown) => fn(session), withoutTenant: async () => { throw new Error("no"); }, close: async () => {} } as never,
    log,
  };
}
const projectSource = (role: "editor" | "viewer" | null, calls: string[] = []): WhiteboardProjectAccess => ({
  async roleIn(_s, input) { calls.push(input.userId); return role; },
});
const principal = (userId: string) => ({ orgId: ORG, userId });

describe("PgWhiteboardCollaborationStore.head：项目来源", () => {
  const board = (owner: string, memberRole: string | null): Handler => (sql) => {
    if (/FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR/.test(sql)) return { rows: [{ owner_id: owner, archived: false }] };
    if (/FROM whiteboard_members/.test(sql)) return { rows: memberRole ? [{ role: memberRole }] : [] };
    if (/SELECT epoch,seq FROM whiteboard_documents/.test(sql)) return { rows: [{ epoch: 1, seq: "7" }] };
    return undefined;
  };

  it("白板成员表里没有、项目给 editor ⇒ editor（且项目来源在锁白板行之后才问）", async () => {
    const { db, log } = fakeDb(board("u-owner", null));
    const calls: string[] = [];
    const store = new PgWhiteboardCollaborationStore(db, undefined, undefined, projectSource("editor", calls));
    await expect(store.head(principal("u-collab"), BOARD)).resolves.toMatchObject({ role: "editor", seq: 7 });
    expect(calls).toEqual(["u-collab"]);
    expect(log[0]).toMatch(/FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR SHARE/);
  });

  it("白板 viewer + 项目 editor ⇒ editor；白板 owner 不问项目来源", async () => {
    const calls: string[] = [];
    const s1 = new PgWhiteboardCollaborationStore(fakeDb(board("u-owner", "viewer")).db, undefined, undefined, projectSource("editor", calls));
    await expect(s1.head(principal("u-collab"), BOARD)).resolves.toMatchObject({ role: "editor" });
    const s2 = new PgWhiteboardCollaborationStore(fakeDb(board("u-owner", null)).db, undefined, undefined, projectSource("viewer", calls));
    await expect(s2.head(principal("u-owner"), BOARD)).resolves.toMatchObject({ role: "owner" });
    expect(calls).toEqual(["u-collab"]);
  });

  it("两个来源都没有 ⇒ NOT_FOUND；未接项目来源时与此前逐字相同", async () => {
    const s1 = new PgWhiteboardCollaborationStore(fakeDb(board("u-owner", null)).db, undefined, undefined, projectSource(null));
    await expect(s1.head(principal("u-outsider"), BOARD)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const s2 = new PgWhiteboardCollaborationStore(fakeDb(board("u-owner", null)).db);
    await expect(s2.head(principal("u-collab"), BOARD)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PgWhiteboardRepository.get：项目来源", () => {
  const boardRow = (role: string | null) => ({
    id: BOARD, name: "项目白板", owner_id: "u-owner", role, archived: false, lifecycle_revision: 0, tags_revision: 0, tag_ids: [],
    created_at: new Date("2026-09-29T00:00:00Z"), updated_at: new Date("2026-09-29T00:00:00Z"),
  });

  it("ACL 看不到、项目给 viewer ⇒ 读得到，role = viewer；ACL 与项目都没有 ⇒ null", async () => {
    const handler: Handler = (sql) => (/\$\{?visible|m\.user_id IS NOT NULL/.test(sql) ? { rows: [] } : { rows: [boardRow(null)] });
    const repo = new PgWhiteboardRepository(fakeDb(handler).db, undefined, projectSource("viewer"));
    await expect(repo.get(principal("u-lead"), BOARD)).resolves.toMatchObject({ id: BOARD, role: "viewer" });
    const none = new PgWhiteboardRepository(fakeDb(handler).db, undefined, projectSource(null));
    await expect(none.get(principal("u-outsider"), BOARD)).resolves.toBeNull();
  });

  it("ACL viewer + 项目 editor ⇒ editor", async () => {
    const handler: Handler = () => ({ rows: [boardRow("viewer")] });
    const repo = new PgWhiteboardRepository(fakeDb(handler).db, undefined, projectSource("editor"));
    await expect(repo.get(principal("u-collab"), BOARD)).resolves.toMatchObject({ role: "editor" });
  });
});

describe("sessionBoundDatabase", () => {
  it("同组织直接在给定会话上跑；别的组织 / 全局读一律拒绝", async () => {
    const session = { query: async () => ({ rows: [{ ok: 1 }] }) } as unknown as import("../../src/application/ports/database.port").TenantSession;
    const db = sessionBoundDatabase(session, ORG);
    await expect(db.withTenant(ORG, (s) => s.query("SELECT 1"))).resolves.toEqual({ rows: [{ ok: 1 }] });
    await expect(db.withTenant(toOrgId("other"), (s) => s.query("SELECT 1"))).rejects.toThrow(/tenant mismatch/);
    await expect(db.withoutTenant(async () => 1)).rejects.toThrow();
  });
});

/* ───────────────────────────── 白板证据 ───────────────────────────── */

class FakeEvidence implements Pick<ProjectEvidencePort, "upsert"> {
  readonly commands: UpsertEvidenceCommand[] = [];
  async upsert(cmd: UpsertEvidenceCommand) {
    this.commands.push(cmd);
    return { id: `ev-${this.commands.length}`, created: true };
  }
}
const ALLOW = { allowed: true, decisionId: "d-1", reasonCode: null } as unknown as PermissionDecision;
const DENY = { allowed: false, decisionId: "d-2", reasonCode: "NO_PROJECT_ROLE" } as unknown as PermissionDecision;

function whiteboardSources(docs: WhiteboardSourceDoc[]): ProjectEvidenceSourcePort {
  const ref = { kind: "project" as const, id: GENERAL };
  return {
    surveysOf: async () => guard(ref, []),
    transcriptionsOf: async () => guard(ref, []),
    interviewsOf: async () => guard(ref, []),
    researchSessionsOf: async () => guard(ref, []),
    whiteboardsOf: async () => guard(ref, docs),
    chatThreadProject: async () => null,
  };
}

describe("白板证据采集器 whiteboard_note", () => {
  const doc: WhiteboardSourceDoc = {
    boardId: BOARD, title: "用户旅程白板",
    notes: [
      { objectId: "n1", kind: "sticky", text: "  审批流程\n太慢 ", ordinal: 1, authorLabel: "张三" },
      { objectId: "n2", kind: "text", text: "长".repeat(400), ordinal: 2, authorLabel: null },
      { objectId: "n3", kind: "sticky", text: "   ", ordinal: 3, authorLabel: null },
    ],
  };

  it("一张便签 / 一个文本块一条：sourceRef 带白板 id、摘录 ≤ 280、标题 = 白板名、说话人拿不到就 null；空白跳过", async () => {
    const ev = new FakeEvidence();
    const out = await collectWhiteboardEvidence(
      { sources: whiteboardSources([doc]), evidence: ev as unknown as ProjectEvidencePort },
      { orgId: ORG, projectId: GENERAL, decision: ALLOW },
    );
    expect(out).toEqual({ scanned: 3, created: 2, refreshed: 0 });
    expect(ev.commands).toHaveLength(2);
    expect(ev.commands[0]).toMatchObject({
      sourceKind: "whiteboard_note", resourceId: BOARD, sourceRef: `${BOARD}:n1`, excerpt: "审批流程 太慢",
      locator: { ordinal: 1 }, speakerLabel: "张三", resourceTitle: "用户旅程白板",
    });
    expect(ev.commands[1]!.excerpt.length).toBeLessThanOrEqual(EVIDENCE_EXCERPT_MAX);
    expect(ev.commands[1]!.speakerLabel).toBeNull();
  });

  it("判定不允许 ⇒ 什么都不写", async () => {
    const ev = new FakeEvidence();
    const out = await collectWhiteboardEvidence(
      { sources: whiteboardSources([doc]), evidence: ev as unknown as ProjectEvidencePort },
      { orgId: ORG, projectId: GENERAL, decision: DENY },
    );
    expect(out).toEqual({ scanned: 0, created: 0, refreshed: 0 });
    expect(ev.commands).toEqual([]);
  });

  it("快照对象 → 便签：只要 sticky / text、跳过隐藏与空白，按白板顺序编号", () => {
    const notes = projectWhiteboardNotes([
      { id: "a", kind: "rectangle", text: "形状上的字" },
      { id: "b", kind: "sticky", text: "第一张" },
      { id: "c", kind: "text", text: "  " },
      { id: "d", kind: "sticky", text: "藏起来的", hidden: true },
      { id: "e", kind: "text", text: "第二条" },
    ]);
    expect(notes).toEqual([
      { objectId: "b", kind: "sticky", text: "第一张", ordinal: 1, authorLabel: null },
      { objectId: "e", kind: "text", text: "第二条", ordinal: 2, authorLabel: null },
    ]);
  });

  it("映射：白板 → whiteboard_note、访谈 → interview_segment、设计只挂不采；whiteboard_note 进「白板」开关", () => {
    expect(LINKABLE_KIND_TO_EVIDENCE.whiteboard).toBe("whiteboard_note");
    expect(LINKABLE_KIND_TO_EVIDENCE.interview).toBe("interview_segment");
    expect(LINKABLE_KIND_TO_EVIDENCE.design).toBeNull();
    expect(COLLECTABLE_EVIDENCE_KINDS).toContain("whiteboard_note");
    expect(PE.PROJECT_EVIDENCE_TO_AI_SOURCE.whiteboard_note).toBe("whiteboard");
    expect(allowedEvidenceKinds(["whiteboard"])).toEqual(["whiteboard_note"]);
    expect(allowedEvidenceKinds(["chat"])).not.toContain("whiteboard_note");
  });

  it("挂载白板时顺带采白板证据；挂载设计只挂不采（仍顺带访谈）", async () => {
    const resources: ProjectResourcePort = {
      listProjectResources: async () => guard({ kind: "project", id: GENERAL }, []),
      isOwnedResource: async () => true,
      linkResource: async () => ({ kind: "linked" }),
      unlinkResource: async () => true,
    };
    const ev = new FakeEvidence();
    const deps = {
      auth: { repo: identity(), ids: new FakeDecisionIds() },
      resources,
      evidence: { sources: whiteboardSources([doc]), evidence: ev as unknown as ProjectEvidencePort },
    };
    const out = await linkProjectResource(deps, { userId: "u-collab", orgId: ORG, projectId: GENERAL, kind: "whiteboard", resourceId: BOARD });
    expect(out.alreadyLinked).toBe(false);
    expect(ev.commands.map((c) => c.sourceKind)).toEqual(["whiteboard_note", "whiteboard_note"]);
    const ev2 = new FakeEvidence();
    await linkProjectResource(
      { ...deps, evidence: { sources: whiteboardSources([doc]), evidence: ev2 as unknown as ProjectEvidencePort } },
      { userId: "u-collab", orgId: ORG, projectId: GENERAL, kind: "design", resourceId: "dp-1" },
    );
    expect(ev2.commands).toEqual([]);
  });
});

/* ───────────────────────────── 对话 ───────────────────────────── */

const thread = (over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  threadId: "t1", projectId: GENERAL, groupId: null, visibilityScope: "plenary", createdBy: "u-owner", archived: false, ...over,
});
const baseAllow = (role: ProjectLayerInput["role"]): PermissionDecision => ({
  allowed: true, orgLayer: { role: "consultant", teamId: null, passed: true },
  projectLayer: { role, groupId: null, passed: true }, scopeLayer: { scope: "org-wide", passed: true }, reasonCode: null, decisionId: "d",
} as PermissionDecision);

describe("对话可见性：非工作坊容器两档", () => {
  const actor = (userId: string, projectRole: ProjectLayerInput["role"]) => ({ userId, projectRole, groupId: null, containerKind: "general" as never });

  it("项目内共享：协作者可读、旁观者降级可读；仅自己：只有创建者；组内共享等三档：谁都不可读", () => {
    expect(decideThreadRead({ thread: thread(), actor: actor("u-collab", "member"), base: baseAllow("member") }).allowed).toBe(true);
    const obs = decideThreadRead({ thread: thread(), actor: actor("u-lead", "observer"), base: baseAllow("observer") });
    expect(obs).toMatchObject({ allowed: true, observerProjection: true });
    expect(decideThreadRead({ thread: thread({ visibilityScope: "private" }), actor: actor("u-collab", "member"), base: baseAllow("member") }).allowed).toBe(false);
    expect(decideThreadRead({ thread: thread({ visibilityScope: "private" }), actor: actor("u-owner", "facilitator"), base: baseAllow("facilitator") }).allowed).toBe(true);
    for (const scope of ["group-shared", "member-private", "team-visible"] as const) {
      expect(decideThreadRead({ thread: thread({ visibilityScope: scope }), actor: actor("u-owner", "facilitator"), base: baseAllow("facilitator") }).allowed).toBe(false);
    }
  });

  it("读动作：非工作坊恒问 read.allHands（在白名单里）；观察者仍是 read.published；工作坊不变", () => {
    expect(chatReadAction(thread({ visibilityScope: "private" }), actor("u-collab", "member"))).toBe("read.allHands");
    expect(chatReadAction(thread(), actor("u-lead", "observer"))).toBe("read.published");
    expect(chatReadAction(thread({ visibilityScope: "private" }), { userId: "u", projectRole: "member", groupId: "g1" })).toBe("read.ownGroup");
  });

  it("能力集合：非工作坊不下发改派 / 停止录音；工作坊照旧", () => {
    const g = capabilitiesFor("facilitator", "general" as never);
    expect(g).toContain("composer.send");
    expect(g).toContain("thread.mutate");
    expect(g).not.toContain("reassign");
    expect(g).not.toContain("recording.stop");
    expect(capabilitiesFor("facilitator")).toContain("reassign");
  });
});

class FakeChat {
  created: Array<{ groupId: string | null; visibilityScope: string; projectId: string | null }> = [];
  visibility: string[] = [];
  constructor(private readonly facts: ThreadFacts | null = null) {}
  async findThreadFacts() { return this.facts; }
  async createThread(input: { groupId: string | null; visibilityScope: string; projectId: string | null }) { this.created.push(input); }
  async setThreadVisibility(_o: unknown, _t: string, scope: string) { this.visibility.push(scope); return 4; }
}
function chatDeps(chat: FakeChat): MutateThreadDeps {
  return {
    chat: chat as unknown as ChatRepository,
    repo: identity(),
    ids: new FakeDecisionIds(),
    provenance: new FakeProvenanceWriter(),
    artifactIds: { next: () => "thr-1" } as never,
  };
}
const create = (userId: string, visibilityScope: string | null, groupId: string | null = null): MutateThreadInput => ({
  userId, orgId: ORG, op: "create", projectId: GENERAL, threadId: null, groupId, title: "调研讨论",
  visibilityScope, expectedVersion: null, reason: null,
});

describe("对话用例：通用项目走 resolveProjectLayer", () => {
  it("resolveVisibility：协作者读得到项目内共享的会话；名单外顾问读不到", async () => {
    const chat = new FakeChat(thread());
    const deps = { repo: identity(), ids: new FakeDecisionIds(), chat: chat as unknown as ChatRepository };
    await expect(resolveVisibility(deps, { userId: "u-collab", orgId: ORG, projectId: GENERAL, threadId: "t1" })).resolves.toMatchObject({ kind: "allow" });
    await expect(resolveVisibility(deps, { userId: "u-outsider", orgId: ORG, projectId: GENERAL, threadId: "t1" })).resolves.toMatchObject({ kind: "denied" });
  });

  it("新建：协作者可建；默认项目内共享；「组内共享」落成项目内共享、「组员私聊」落成仅自己；groupId 不采信", async () => {
    const chat = new FakeChat();
    await mutateThread(chatDeps(chat), create("u-collab", null, "g-x"));
    await mutateThread(chatDeps(chat), create("u-collab", "group-shared"));
    await mutateThread(chatDeps(chat), create("u-owner", "member-private"));
    expect(chat.created.map((c) => [c.visibilityScope, c.groupId])).toEqual([["plenary", null], ["plenary", null], ["private", null]]);
  });

  it("新建：名单外的组织 lead（旁观者）/ 名单外顾问 ⇒ NO_WRITE_ROLE", async () => {
    await expect(mutateThread(chatDeps(new FakeChat()), create("u-lead", null))).rejects.toMatchObject({ message: "no_write_role" });
    await expect(mutateThread(chatDeps(new FakeChat()), create("u-outsider", null))).rejects.toMatchObject({ message: "no_write_role" });
  });

  it("分享：通用项目只有两档（private / plenary），group-shared 被拒", async () => {
    const chat = new FakeChat(thread({ visibilityScope: "private", createdBy: "u-collab" }));
    const input = (scope: string): MutateThreadInput => ({
      userId: "u-collab", orgId: ORG, op: "setVisibility", projectId: GENERAL, threadId: "t1", groupId: null, title: null,
      visibilityScope: scope, expectedVersion: 3, reason: null,
    });
    await expect(mutateThread(chatDeps(chat), input("plenary"))).resolves.toMatchObject({ version: 4 });
    await expect(mutateThread(chatDeps(chat), input("group-shared"))).rejects.toBeInstanceOf(VisibilityScopeInvalidError);
    expect(chat.visibility).toEqual(["plenary"]);
  });
});

/* ───────────────────────────── 采纳为决策 ───────────────────────────── */

describe("adoptProjectDecision：通用项目", () => {
  function deps() {
    const calls: unknown[] = [];
    const promotion = {
      adoptionSource: async (_o: unknown, _u: unknown, projectId: string) =>
        guard({ kind: "project", id: projectId }, { id: "c-fact", kind: "fact", status: "accepted" }),
      adoptProjectDecision: async (_o: unknown, _u: unknown, input: unknown) => { calls.push(input); return { decisionClaimId: "a-g", actionId: "a" }; },
    } as unknown as PromotionPort;
    const d: PromotionDeps = { repo: identity(), ids: new FakeDecisionIds(), chat: {} as never, knowledge: {} as never, promotion, newId: () => "a" };
    return { d, calls };
  }
  const run = (d: PromotionDeps, userId: string) =>
    adoptProjectDecision(d, { userId, orgId: ORG, projectId: GENERAL, claimId: "c-fact", rationale: "两轮访谈都指向它" });

  it("负责人 / 协作者可以采纳；名单外 lead KG_NOT_OWNER；名单外顾问 KG_NOT_VISIBLE", async () => {
    const a = deps();
    await expect(run(a.d, "u-collab")).resolves.toMatchObject({ decisionClaimId: "a-g" });
    await expect(run(a.d, "u-owner")).resolves.toMatchObject({ decisionClaimId: "a-g" });
    expect(a.calls).toHaveLength(2);
    const b = deps();
    await expect(run(b.d, "u-lead")).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    await expect(run(b.d, "u-outsider")).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    expect(b.calls).toEqual([]);
  });
});
