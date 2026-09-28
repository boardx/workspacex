/**
 * #4584 —— 研究项目 / 用户洞察两类容器的负责人、协作者能打开项目工作台（此前永远 NO_PROJECT_ROLE）。
 * 无库单测：身份假仓储 + 真实 `authorize()` / `decide()` / 用例编排。SQL 那一侧（`findNonWorkshopStanding`
 * 按 `projects.kind` 分派两张成员表）由 `non-workshop-project-access-pg.test.ts` 对真实 PostgreSQL 断言。
 *
 * 钉住：
 *   · 映射表（`nonWorkshopProjectLayer`）：owner → facilitator 行，collaborator → member 行（读共享内容 + 参与写），
 *     不在名单上的组织 lead / admin → observer 行（T5 read 行「组织 lead/admin 可读」），其余无角色；
 *   · 容器白名单（`NON_WORKSHOP_CONTAINER_ACTIONS`）：议程 / 分组 / 现场参与 / 工作坊名单对两类容器恒关，
 *     工作坊不受影响；
 *   · 用例面：listProjectEvidence / getProjectAiSettings / getProjectKnowledge 对名单上的人放行、对名单外的
 *     组织顾问拒绝；updateProjectAiSettings 负责人能写、协作者 PROJECT_ROLE_INSUFFICIENT；
 *     工作坊名单的 `member.manage` 对负责人仍关；
 *   · 工作坊热路径不变：有工作坊行时不问两档身份；观察者证据脱敏照旧。
 */
import { describe, expect, it } from "vitest";
import { authorize } from "../../src/application/identity/authorize";
import { resolveProjectLayer } from "../../src/application/identity/project-layer";
import type { NonWorkshopStandingRow } from "../../src/application/identity/ports";
import { listProjectEvidence } from "../../src/application/project/list-project-evidence";
import { getProjectAiSettings } from "../../src/application/project/get-project-ai-settings";
import { updateProjectAiSettings } from "../../src/application/project/update-project-ai-settings";
import { authorizeManageMembers } from "../../src/application/project/member-authorization";
import type {
  ProjectAiSettingsRepository,
  ProjectAiSettingsRow,
  UpsertProjectAiSettingsCommand,
  UpsertProjectAiSettingsOutcome,
} from "../../src/application/project/project-ai-settings-ports";
import type {
  ProjectEvidencePage,
  ProjectEvidencePort,
  ProjectEvidenceRow,
  ProjectEvidenceSourceKind,
} from "../../src/application/project/project-evidence-ports";
import { getProjectKnowledge } from "../../src/application/knowledge-graph/read-project-knowledge";
import type { KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import type { KnowledgeReadPort, ProjectKnowledgeData } from "../../src/application/knowledge-graph/ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import { decide } from "../../src/domain/identity/permission-decision";
import {
  NON_WORKSHOP_CONTAINER_ACTIONS,
  PROJECT_ACTIONS,
  containerAllows,
} from "../../src/domain/identity/project-role-matrix";
import {
  NON_WORKSHOP_TIER_PROJECT_ROLE,
  nonWorkshopProjectLayer,
} from "../../src/domain/project/non-workshop-member-access";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository, type FakeMembership } from "../support/role-view-fakes";

const ORG = toOrgId("org-4584");
const RESEARCH = "p-4584-research";
const INSIGHT = "p-4584-insight";
const WORKSHOP = "p-4584-workshop";

/**
 * 工作坊身份沿用 `FakeRoleViewRepository`（按 userId），两档身份按 `projectId/userId` 另存；
 * `kinds` 登记哪些项目是非工作坊容器（其余 ⇒ `findNonWorkshopStanding` 答 null，同真实仓储对工作坊的回答）。
 */
class NonWorkshopIdentity extends FakeRoleViewRepository {
  standingCalls = 0;
  constructor(
    members: Record<string, FakeMembership>,
    private readonly kinds: Record<string, NonWorkshopStandingRow["containerKind"]>,
    private readonly tiers: Record<string, NonWorkshopStandingRow["memberRole"]>,
  ) {
    super(members);
  }
  override async findNonWorkshopStanding(userId: string, projectId: string): Promise<NonWorkshopStandingRow | null> {
    this.standingCalls += 1;
    const containerKind = this.kinds[projectId];
    if (containerKind === undefined) return null;
    return { containerKind, memberRole: this.tiers[`${projectId}/${userId}`] ?? null };
  }
}

// 组织角色都在这里；工作坊角色只给 `u-ws-*`（它们只在 WORKSHOP 里有行——FakeRoleViewRepository 不分项目，
// 所以非工作坊用例里只用不带工作坊角色的用户）。
const identity = new NonWorkshopIdentity(
  {
    "u-owner": { orgRole: "consultant", projectRole: null },
    "u-collab": { orgRole: "consultant", projectRole: null },
    "u-outsider": { orgRole: "consultant", projectRole: null },
    "u-lead": { orgRole: "lead", projectRole: null },
    "u-admin": { orgRole: "admin", projectRole: null },
    "u-compliance": { orgRole: "compliance", projectRole: null },
    "u-ws-fac": { orgRole: "consultant", projectRole: "facilitator" },
    "u-ws-observer": { orgRole: "consultant", projectRole: "observer" },
  },
  { [RESEARCH]: "research_project", [INSIGHT]: "user_insight" },
  {
    [`${RESEARCH}/u-owner`]: "owner",
    [`${RESEARCH}/u-collab`]: "collaborator",
    [`${INSIGHT}/u-owner`]: "collaborator",
    [`${INSIGHT}/u-collab`]: "owner",
  },
);
const auth = () => ({ repo: identity, ids: new FakeDecisionIds() });

const judge = (userId: string, projectId: string, action: string) =>
  authorize(auth(), { userId, orgId: ORG, projectId, object: { kind: "project", id: projectId }, action });

describe("nonWorkshopProjectLayer：两档身份 → 项目层输入（纯函数）", () => {
  it("owner → facilitator 行、collaborator → member 行，恒带 containerKind、无分组、无 host", () => {
    expect(NON_WORKSHOP_TIER_PROJECT_ROLE).toEqual({ owner: "facilitator", collaborator: "member" });
    expect(nonWorkshopProjectLayer({ containerKind: "research_project", memberRole: "owner", orgRole: "consultant" }))
      .toEqual({ role: "facilitator", groupId: null, isHost: false, containerKind: "research_project" });
    expect(nonWorkshopProjectLayer({ containerKind: "user_insight", memberRole: "collaborator", orgRole: "admin" }))
      .toEqual({ role: "member", groupId: null, isHost: false, containerKind: "user_insight" });
  });

  it("不在名单上：组织 lead / admin → observer 行（只读）；顾问 / 合规 / 非组织成员 → 无角色", () => {
    const layer = (orgRole: "lead" | "admin" | "consultant" | "compliance" | null) =>
      nonWorkshopProjectLayer({ containerKind: "research_project", memberRole: null, orgRole }).role;
    expect(layer("lead")).toBe("observer");
    expect(layer("admin")).toBe("observer");
    expect(layer("consultant")).toBeNull();
    expect(layer("compliance")).toBeNull();
    expect(layer(null)).toBeNull();
  });
});

describe("容器白名单：工作坊专属机制对两类容器恒关", () => {
  it("议程 / 分组 / 现场参与 / 工作坊名单 / 本组内容不在白名单上；白名单里只有已声明的动作", () => {
    for (const a of PROJECT_ACTIONS) {
      if (a.startsWith("agendaSegment.") || a.startsWith("group.")) expect(containerAllows("research_project", a), a).toBe(false);
    }
    for (const a of ["member.manage", "content.postNote", "content.speak", "content.vote", "read.ownGroup"]) {
      expect(containerAllows("user_insight", a), a).toBe(false);
    }
    for (const a of NON_WORKSHOP_CONTAINER_ACTIONS) expect(PROJECT_ACTIONS).toContain(a);
    // 工作坊：矩阵全集，一条都不收窄。
    for (const a of PROJECT_ACTIONS) expect(containerAllows("workshop", a)).toBe(true);
  });

  it("decide()：同一个 facilitator 行，在工作坊能推进环节，在研究项目里 PROJECT_ROLE_INSUFFICIENT", () => {
    const base = { decisionId: "d", org: { role: "consultant" as const, teamId: null }, scope: { scope: "org-wide" as const, ownerTeamId: null } };
    const ws = decide({ ...base, action: "agendaSegment.advance", project: { role: "facilitator", groupId: null } });
    expect(ws.allowed).toBe(true);
    const rp = decide({
      ...base, action: "agendaSegment.advance",
      project: { role: "facilitator", groupId: null, containerKind: "research_project" },
    });
    expect(rp).toMatchObject({ allowed: false, reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    expect(rp.projectLayer).toMatchObject({ role: "facilitator", passed: false });
  });
});

describe("authorize()：项目层读两档身份（#4584 的根因修复）", () => {
  it("负责人 / 协作者读 read.published 放行（此前 NO_PROJECT_ROLE）；两类容器各按自己的名单", async () => {
    for (const [u, p] of [["u-owner", RESEARCH], ["u-collab", RESEARCH], ["u-owner", INSIGHT], ["u-collab", INSIGHT]] as const) {
      const d = await judge(u, p, "read.published");
      expect(d.allowed, `${u}@${p}`).toBe(true);
    }
    expect((await judge("u-owner", RESEARCH, "read.published")).projectLayer?.role).toBe("facilitator");
    expect((await judge("u-owner", INSIGHT, "read.published")).projectLayer?.role).toBe("member");
  });

  it("名单外的组织顾问 ⇒ NO_PROJECT_ROLE；合规 ⇒ ADMIN_NOT_SUPERUSER（同工作坊的 D-18 区分码）", async () => {
    expect(await judge("u-outsider", RESEARCH, "read.published")).toMatchObject({ allowed: false, reasonCode: "NO_PROJECT_ROLE" });
    expect(await judge("u-compliance", RESEARCH, "read.published")).toMatchObject({ allowed: false, reasonCode: "ADMIN_NOT_SUPERUSER" });
  });

  it("名单外的组织 lead / admin：能读已发布内容，读不了原始转写（observer 行）", async () => {
    expect((await judge("u-lead", RESEARCH, "read.published")).allowed).toBe(true);
    expect((await judge("u-admin", INSIGHT, "read.published")).allowed).toBe(true);
    expect(await judge("u-admin", RESEARCH, "read.rawTranscript")).toMatchObject({ allowed: false, reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });

  it("两档分工：负责人可改配置、可读原始转写；协作者读共享内容与参与写、不可改配置；两者都推不了议程", async () => {
    expect((await judge("u-owner", RESEARCH, "settings.manage")).allowed).toBe(true);
    expect((await judge("u-owner", RESEARCH, "read.rawTranscript")).allowed).toBe(true);
    expect(await judge("u-collab", RESEARCH, "settings.manage")).toMatchObject({ allowed: false, reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    expect((await judge("u-collab", RESEARCH, "read.allHands")).allowed).toBe(true);
    expect((await judge("u-collab", RESEARCH, "content.renameFile")).allowed).toBe(true);
    // member 行本来就没有原始转写（矩阵的既有分层，映射不另开）。
    expect((await judge("u-collab", RESEARCH, "read.rawTranscript")).allowed).toBe(false);
    for (const u of ["u-owner", "u-collab"]) {
      expect((await judge(u, RESEARCH, "agendaSegment.advance")).allowed).toBe(false);
      expect((await judge(u, RESEARCH, "group.submitOutput")).allowed).toBe(false);
    }
  });

  it("工作坊热路径不变：有工作坊行就不问两档身份；工作坊里没行的人仍 NO_PROJECT_ROLE", async () => {
    const before = identity.standingCalls;
    const layer = await resolveProjectLayer(identity, { userId: "u-ws-fac", projectId: WORKSHOP, orgId: ORG, orgRole: "consultant" });
    expect(layer).toEqual({ role: "facilitator", groupId: null, isHost: false, containerKind: "workshop" });
    expect(identity.standingCalls).toBe(before);
    expect(await judge("u-outsider", WORKSHOP, "read.published")).toMatchObject({ allowed: false, reasonCode: "NO_PROJECT_ROLE" });
    // 工作坊里名单外的 admin 仍是 ADMIN_NOT_SUPERUSER（AC1 对工作坊一字不动）。
    expect(await judge("u-admin", WORKSHOP, "read.published")).toMatchObject({ allowed: false, reasonCode: "ADMIN_NOT_SUPERUSER" });
  });
});

/* ───────────────────────────── 用例面 ───────────────────────────── */

const ZERO: Record<ProjectEvidenceSourceKind, number> = {
  chat_message: 0, attachment: 0, survey_response: 0, interview_segment: 0, transcript_segment: 0, research_source: 0,
};
const evidenceRow: ProjectEvidenceRow = {
  id: "ev1", projectId: RESEARCH, sourceKind: "interview_segment", resourceId: "r1", sourceRef: "s1",
  excerpt: "受访者说：我们每周都要手工对账，".repeat(8), locator: {}, speakerLabel: "受访者 A", resourceTitle: "访谈 1",
  revoked: false, createdAt: "2026-09-28T00:00:00.000Z",
};
const evidence: ProjectEvidencePort = {
  list: async (_o: OrgId, projectId: string): Promise<Guarded<ProjectEvidencePage | null>> =>
    guard({ kind: "project", id: projectId }, { items: [{ ...evidenceRow, projectId }], nextCursor: null, countsBySource: ZERO }),
  find: async () => { throw new Error("not used"); },
  upsert: async () => { throw new Error("not used"); },
  revokeBySource: async () => 0,
  listForIngestion: async () => { throw new Error("not used"); },
};

describe("listProjectEvidence（研究 → 来源）", () => {
  it("负责人、协作者看到完整证据（不脱敏）；名单外顾问 NO_PROJECT_ROLE", async () => {
    for (const u of ["u-owner", "u-collab"]) {
      const page = await listProjectEvidence({ auth: auth(), evidence }, { userId: u, orgId: ORG, projectId: RESEARCH });
      expect(page.items[0]).toMatchObject({ speakerLabel: "受访者 A", excerpt: evidenceRow.excerpt });
    }
    await expect(listProjectEvidence({ auth: auth(), evidence }, { userId: "u-outsider", orgId: ORG, projectId: RESEARCH }))
      .rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("名单外组织 admin 按 observer 行读：说话人置空（脱敏规则仍是 redactEvidenceForRole 那一份）", async () => {
    const page = await listProjectEvidence({ auth: auth(), evidence }, { userId: "u-admin", orgId: ORG, projectId: RESEARCH });
    expect(page.items[0]?.speakerLabel).toBeNull();
  });

  it("工作坊观察者照旧脱敏", async () => {
    const page = await listProjectEvidence({ auth: auth(), evidence }, { userId: "u-ws-observer", orgId: ORG, projectId: WORKSHOP });
    expect(page.items[0]?.speakerLabel).toBeNull();
  });
});

class AiRepo implements ProjectAiSettingsRepository {
  upserts: UpsertProjectAiSettingsCommand[] = [];
  row: ProjectAiSettingsRow | null = null;
  async find(): Promise<Guarded<ProjectAiSettingsRow | null>> {
    return guard({ kind: "project", id: RESEARCH }, this.row);
  }
  async upsert(cmd: UpsertProjectAiSettingsCommand): Promise<UpsertProjectAiSettingsOutcome> {
    this.upserts.push(cmd);
    this.row = { projectId: cmd.projectId, allowedSources: cmd.allowedSources, updatedBy: cmd.updatedBy, updatedAt: "2026-09-28T00:00:00.000Z" };
    return { kind: "upserted", row: this.row };
  }
}

describe("AI 权限（设置 tab）", () => {
  it("读：负责人、协作者放行；名单外顾问 NO_PROJECT_ROLE", async () => {
    const repo = new AiRepo();
    for (const u of ["u-owner", "u-collab"]) {
      await expect(getProjectAiSettings({ repo, auth: auth() }, { userId: u, orgId: ORG, projectId: RESEARCH })).resolves.toMatchObject({ projectId: RESEARCH });
    }
    await expect(getProjectAiSettings({ repo, auth: auth() }, { userId: "u-outsider", orgId: ORG, projectId: RESEARCH }))
      .rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("写：负责人能写；协作者 PROJECT_ROLE_INSUFFICIENT 且不写；名单外顾问 ORG_ROLE_INSUFFICIENT；组织 lead 照旧能写", async () => {
    const repo = new AiRepo();
    const write = (actorId: string) =>
      updateProjectAiSettings({ repo, identity }, { actorId, orgId: ORG, projectId: RESEARCH, allowedSources: ["chat"] });
    await expect(write("u-owner")).resolves.toMatchObject({ allowedSources: ["chat"] });
    await expect(write("u-collab")).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(write("u-outsider")).rejects.toMatchObject({ reasonCode: "ORG_ROLE_INSUFFICIENT" });
    await expect(write("u-lead")).resolves.toMatchObject({ allowedSources: ["chat"] });
    expect(repo.upserts.map((u) => u.updatedBy)).toEqual(["u-owner", "u-lead"]);
  });

  it("工作坊四角色名单（member.manage）对负责人仍关：同一个门，动作不在容器白名单里", async () => {
    await expect(authorizeManageMembers(identity, { actorId: "u-owner", orgId: ORG, projectId: RESEARCH }))
      .rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });
});

describe("项目大脑读（getProjectKnowledge）", () => {
  const DATA: ProjectKnowledgeData = { revision: 1, objects: [], edges: [], sharedFromPersonal: [], claims: [] };
  const kgDeps = (projectId: string): KnowledgeReadDeps => ({
    repo: identity,
    ids: new FakeDecisionIds(),
    chat: {} as never,
    knowledge: { projectKnowledge: async () => guard({ kind: "project", id: projectId }, DATA) } as unknown as KnowledgeReadPort,
  });

  it("负责人、协作者读到项目记忆（此前 KG_NOT_VISIBLE）；名单外顾问 KG_NOT_VISIBLE", async () => {
    for (const u of ["u-owner", "u-collab"]) {
      await expect(getProjectKnowledge(kgDeps(INSIGHT), { userId: u, orgId: ORG, projectId: INSIGHT }))
        .resolves.toMatchObject({ scope: { kind: "project", id: INSIGHT } });
    }
    await expect(getProjectKnowledge(kgDeps(INSIGHT), { userId: "u-outsider", orgId: ORG, projectId: INSIGHT }))
      .rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
  });
});
