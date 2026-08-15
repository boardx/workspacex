/**
 * F27 —— 议程环节状态 → 三视角首屏同时切换（`uc-2-2` R10 / I-24 / V9c，跨模块契约）。
 *
 * 「三种视角首屏同时切到新环节，且读的是同一个状态源」只有在**只有一个写入点、
 * 一个读取点**时才成立（契约 `templates.ts` 头注 + `SOLE_AGENDA_SEGMENT_STATE_OPERATION`
 * 指向 `project.advanceAgendaSegment` 是唯一写入点，`getProjectOverview.currentAgendaSegment`
 * 是读取点）。本文件不重新实现这两者——它们已是 F117/F119/F123 的交付物——而是写一条
 * 端到端断言，证明「组长推进环节后，引导师/组长/组员三种视角各自调用同一个只读接口，
 * 拿到的 currentAgendaSegment 完全相同」，把这条不变量钉成一条可执行断言，不只是注释。
 *
 * 全部用内存假仓储，不需要真实 Postgres（同 `agenda-role-matrix-edit.test.ts` 的风格），
 * 可在本地直接 `vitest run`。
 */
import { describe, expect, it } from "vitest";
import { advanceAgendaSegment, type AdvanceAgendaSegmentDeps } from "../../src/application/project/advance-agenda-segment";
import { getProjectOverview } from "../../src/application/project/get-project-overview";
import type {
  AgendaSegmentRepository,
  AgendaSegmentRow,
  AdvanceAgendaSegmentCommand,
  AdvanceAgendaSegmentResult,
  CreateAgendaSegmentCommand,
  CreateAgendaSegmentOutcome,
  OverviewAgendaSegment,
  OverviewRoleCounts,
  ProjectOverviewRepository,
  ProjectSnapshotRow,
} from "../../src/application/project/ports";
import type { IdentityRepository, OrgMembershipRow, ProjectMembershipRow, BindingRow, DecisionIdFactory } from "../../src/application/identity/ports";
import type { AclObjectRef } from "../../src/application/identity/ports";
import type { ProvenanceWriter, ProvenanceAppendInput } from "../../src/application/provenance/ports";
import type { TemporaryGrantRepository } from "../../src/application/identity/temporary-grant-ports";
import type { BindingDeps } from "../../src/application/artifact/binding-ports";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-f27-3views");
const WORKSHOP = "workshop-f27-3views";
const FACILITATOR = "u-facilitator";
const GROUP_LEAD = "u-group-lead";
const MEMBER = "u-member";

/* ───────────────────────── 假仓储：只为让本文件不依赖真实 Postgres ───────────────────────── */

class FakeIdentityRepository implements IdentityRepository {
  orgMemberships = new Map<string, OrgMembershipRow>();
  projectMemberships = new Map<string, ProjectMembershipRow>();

  async findOrganization() {
    return { id: ORG, name: "org", kind: "organization" as const, team: null, avatarUrl: null };
  }
  async findOrgMembership(userId: string, orgId: string): Promise<OrgMembershipRow | null> {
    return this.orgMemberships.get(`${userId}/${orgId}`) ?? null;
  }
  async findProjectMembership(userId: string, projectId: string): Promise<ProjectMembershipRow | null> {
    return this.projectMemberships.get(`${userId}/${projectId}`) ?? null;
  }
  async findBindings(_orgId: string, _objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    return new Map(); // 空 = org-wide 默认（见 authorize.ts DEFAULT_SCOPE）
  }
  async listMemberships() {
    return [];
  }
  async ensurePersonalLocalOrg(): Promise<never> {
    throw new Error("not used in this test file");
  }
  async findPersonalLocalOrg() {
    return null;
  }
  async countOrgMembers() {
    return 0;
  }
}

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f27-3views-d-${this.n}`;
  }
}

class FakeProvenanceWriter implements ProvenanceWriter {
  events: ProvenanceAppendInput[] = [];
  async append(input: ProvenanceAppendInput): Promise<string> {
    this.events.push(input);
    return `evt-${this.events.length}`;
  }
  async appendInTransaction(_tx: unknown, input: ProvenanceAppendInput): Promise<string> {
    return this.append(input);
  }
  async appendWithin(_session: unknown, input: ProvenanceAppendInput): Promise<string> {
    return this.append(input);
  }
}

class FakeTemporaryGrantRepository implements TemporaryGrantRepository {
  async create(): Promise<never> {
    throw new Error("not used in this test file");
  }
  async findActive() {
    return null;
  }
  async findActiveBySegment() {
    return [];
  }
  async markRevoked() {
    return false;
  }
}

/** 一份内存里的议程环节表，`advance()` 与 `getCurrentAgendaSegment()` 共读共写**同一个 Map**——
 *  这正是本测试要证明的「单一状态源」的落地方式：两个假仓储背后是同一份数据。 */
class SharedSegmentStore {
  readonly segments = new Map<string, AgendaSegmentRow>();
}

class FakeAgendaSegmentRepository implements AgendaSegmentRepository {
  constructor(private readonly store: SharedSegmentStore) {}
  async findById(_orgId: string, _workshopId: string, segmentId: string): Promise<AgendaSegmentRow | null> {
    return this.store.segments.get(segmentId) ?? null;
  }
  async advance(cmd: AdvanceAgendaSegmentCommand): Promise<AdvanceAgendaSegmentResult> {
    const current = this.store.segments.get(cmd.segmentId);
    if (current === undefined) throw new Error("segment not found");
    const updated: AgendaSegmentRow = { ...current, state: cmd.nextState, mergedInto: cmd.mergedInto };
    this.store.segments.set(cmd.segmentId, updated);

    // 紧邻下一条 pending 环节置 active（同 PgAgendaSegmentRepository 的语义）。
    const rows = [...this.store.segments.values()].sort((a, b) => a.ordinal - b.ordinal);
    const next = rows.find((r) => r.ordinal === current.ordinal + 1) ?? null;
    let activatedNext: AgendaSegmentRow | null = null;
    if (next !== null && next.state === "pending") {
      activatedNext = { ...next, state: "active" };
      this.store.segments.set(activatedNext.id, activatedNext);
    }
    return { segment: updated, activatedNext };
  }
  // #627：本文件测的是 advance/getProjectOverview 那条链，不测 create——给个最小的
  // 满足接口的实现（自增 id，永远 "created"），不复刻仓储的三态判定；那条判定已经
  // 有它自己的测试（`create-agenda-segment.test.ts`）。
  async create(cmd: CreateAgendaSegmentCommand): Promise<CreateAgendaSegmentOutcome> {
    const row: AgendaSegmentRow = {
      id: `seg-fake-${this.store.segments.size}`,
      workshopId: cmd.workshopId,
      ordinal: cmd.ordinal,
      title: cmd.title,
      duration: cmd.duration,
      state: "pending",
      mergedInto: null,
      agendaSegmentDefinitionId: cmd.agendaSegmentDefinitionId,
      acceptedSources: [],
    };
    this.store.segments.set(row.id, row);
    return { kind: "created", row };
  }
  // #853：本文件测的不是 listAgendaSegments 那条链——给个最小的满足接口的实现
  // （按 ordinal 排序全部返回），不复刻仓储的租户隔离；那条判定有它自己的测试
  // （`list-agenda-segments.test.ts`）。
  async list(_orgId: string, workshopId: string): Promise<readonly AgendaSegmentRow[]> {
    return [...this.store.segments.values()]
      .filter((r) => r.workshopId === workshopId)
      .sort((a, b) => a.ordinal - b.ordinal);
  }
}

class FakeProjectOverviewRepository implements ProjectOverviewRepository {
  constructor(private readonly store: SharedSegmentStore) {}
  async getProjectSnapshot(): Promise<ProjectSnapshotRow | null> {
    return { name: "工作坊", kind: "workshop", status: "active" };
  }
  async getCurrentAgendaSegment(): Promise<OverviewAgendaSegment | null> {
    const active = [...this.store.segments.values()].find((s) => s.state === "active");
    if (active === undefined) return null;
    return {
      id: active.id,
      workshopId: active.workshopId,
      ordinal: active.ordinal,
      title: active.title,
      duration: active.duration,
      state: active.state,
      mergedInto: active.mergedInto,
      agendaSegmentDefinitionId: active.agendaSegmentDefinitionId,
      acceptedSources: [...active.acceptedSources] as OverviewAgendaSegment["acceptedSources"],
    };
  }
  async getWorkshopRoleCounts(): Promise<OverviewRoleCounts> {
    return { facilitator: 1, groupLead: 1, member: 1, observer: 0 };
  }
}

function grantAll(identity: FakeIdentityRepository) {
  for (const userId of [FACILITATOR, GROUP_LEAD, MEMBER]) {
    identity.orgMemberships.set(`${userId}/${ORG}`, { orgRole: "consultant", teamId: null });
  }
  identity.projectMemberships.set(`${FACILITATOR}/${WORKSHOP}`, { projectRole: "facilitator", groupId: null, isHost: true });
  identity.projectMemberships.set(`${GROUP_LEAD}/${WORKSHOP}`, { projectRole: "groupLead", groupId: "group-1", isHost: false });
  identity.projectMemberships.set(`${MEMBER}/${WORKSHOP}`, { projectRole: "member", groupId: "group-1", isHost: false });
}

function seedTwoSegments(store: SharedSegmentStore) {
  const SEG_1: AgendaSegmentRow = {
    id: "seg-1",
    workshopId: WORKSHOP,
    ordinal: 0,
    title: "环节一",
    duration: 15,
    state: "active",
    mergedInto: null,
    agendaSegmentDefinitionId: null,
    acceptedSources: [],
  };
  const SEG_2: AgendaSegmentRow = {
    id: "seg-2",
    workshopId: WORKSHOP,
    ordinal: 1,
    title: "环节二",
    duration: 15,
    state: "pending",
    mergedInto: null,
    agendaSegmentDefinitionId: null,
    acceptedSources: [],
  };
  store.segments.set(SEG_1.id, SEG_1);
  store.segments.set(SEG_2.id, SEG_2);
}

/**
 * 一个假的 `BindingDeps`——`getProjectOverview` 内部复用 `listBackflow`（见该文件头注
 * 「为什么回流列表复用 listBackflow」），这里让它恒返回空表，`auth` 与调用方共享同一个
 * `AuthorizeDeps`，好让 `listBackflow` 内部第二次 `authorize()` 判到同样的角色。
 */
function fakeBindingDeps(auth: { repo: IdentityRepository; ids: DecisionIdFactory }): BindingDeps {
  return {
    bindings: {
      async listForProject() {
        return [];
      },
    } as unknown as BindingDeps["bindings"],
    artifacts: {} as BindingDeps["artifacts"],
    auth,
    ids: { next: () => "f27-3views-binding-id" },
    provenance: new FakeProvenanceWriter(),
  };
}

describe("F27：组长推进议程环节后，三种视角读到同一个 currentAgendaSegment", () => {
  it("推进前：三视角一致读到 seg-1（active）", async () => {
    const identity = new FakeIdentityRepository();
    grantAll(identity);
    const store = new SharedSegmentStore();
    seedTwoSegments(store);
    const overviewRepo = new FakeProjectOverviewRepository(store);
    const auth = { repo: identity, ids: new SeqDecisionIds() };
    const binding = fakeBindingDeps(auth);

    const views = await Promise.all(
      [FACILITATOR, GROUP_LEAD, MEMBER].map((userId) =>
        getProjectOverview(
          { repo: overviewRepo, auth, binding },
          { userId, orgId: ORG, projectId: WORKSHOP },
        ),
      ),
    );

    const segmentIds = views.map((v) => v.currentAgendaSegment?.id);
    expect(segmentIds).toEqual(["seg-1", "seg-1", "seg-1"]);
  });

  it("组长推进环节后，引导师/组长/组员三视角同时切到新环节（同一状态源）", async () => {
    const identity = new FakeIdentityRepository();
    grantAll(identity);
    const store = new SharedSegmentStore();
    seedTwoSegments(store);
    const segments = new FakeAgendaSegmentRepository(store);
    const overviewRepo = new FakeProjectOverviewRepository(store);
    const auth = { repo: identity, ids: new SeqDecisionIds() };
    const binding = fakeBindingDeps(auth);

    // 只有 facilitator（本仓「组长/引导师控场」角色映射，见 project-role-matrix.ts
    // `agendaSegment.advance` 一行）能推进——这里由 facilitator 发起，模拟「组长切换议程
    // 环节状态」（issue #323 用词的「组长」在本仓四值角色枚举里落在 `facilitator` 行，
    // 见 `advance-agenda-segment.ts` 引用的同一份矩阵）。
    const advanceDeps: AdvanceAgendaSegmentDeps = {
      auth,
      segments,
      provenance: new FakeProvenanceWriter(),
      grants: new FakeTemporaryGrantRepository(),
      clock: { now: () => "2026-08-02T00:00:00.000Z" },
    };

    await advanceAgendaSegment(advanceDeps, {
      userId: FACILITATOR,
      orgId: ORG,
      workshopId: WORKSHOP,
      segmentId: "seg-1",
      action: "advance",
      mergeIntoSegmentId: null,
    });

    // 推进之后，三种视角各自独立调用同一个只读用例——不是共享同一次调用结果，
    // 是各自发起、各自判权限、各自查询，证明「读到同一个值」不是偶然共享了同一个
    // 内存对象引用。
    const [facilitatorView, groupLeadView, memberView] = await Promise.all([
      getProjectOverview({ repo: overviewRepo, auth, binding }, { userId: FACILITATOR, orgId: ORG, projectId: WORKSHOP }),
      getProjectOverview({ repo: overviewRepo, auth, binding }, { userId: GROUP_LEAD, orgId: ORG, projectId: WORKSHOP }),
      getProjectOverview({ repo: overviewRepo, auth, binding }, { userId: MEMBER, orgId: ORG, projectId: WORKSHOP }),
    ]);

    expect(facilitatorView.currentAgendaSegment?.id).toBe("seg-2");
    expect(groupLeadView.currentAgendaSegment?.id).toBe("seg-2");
    expect(memberView.currentAgendaSegment?.id).toBe("seg-2");
    // 三者不仅 id 相同，整个环节对象相同——不是三份各自拼出来的、恰好 id 一样的副本。
    expect(facilitatorView.currentAgendaSegment).toEqual(groupLeadView.currentAgendaSegment);
    expect(groupLeadView.currentAgendaSegment).toEqual(memberView.currentAgendaSegment);
  });
});
