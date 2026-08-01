/**
 * F05 -- UC-1.4 R4: "授予与失效均写审计并可检索". Two separate claims, both asserted here:
 *   1. granting writes an audit event, with the granter as actor and the grant's detail;
 *   2. the FIRST read that observes expiry writes a second audit event, with the grantee as
 *      actor (queryProvenance's own R4 audience note: the project lead and the admin
 *      themselves are the readers, but the EVENT's actor is whoever's access changed).
 * Both must be retrievable through `queryProvenance` -- the one shared audit surface
 * (`provenance.ts` file header, coherence review X-2) -- not merely present in a writer's
 * private buffer, which is why this file drives everything through `FakeQueryableProvenance`
 * (one object, both roles) rather than a write-only fake.
 */
import { describe, expect, it } from "vitest";
import { grantTemporaryRead } from "../../src/application/identity/grant-temporary-read";
import { checkTemporaryGrantAccess } from "../../src/application/identity/check-temporary-grant-access";
import { queryProvenance } from "../../src/application/provenance/query-provenance";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";
import {
  FakeAgendaSegmentStateReader,
  FakeClock,
  FakeQueryableProvenance,
  FakeTemporaryGrantRepository,
} from "../support/temporary-grant-fakes";

const ORG = toOrgId("org-f05-audit");
const WORKSHOP = "ws-f05-audit";
const SEGMENT = "seg-3";

const FACILITATOR = "u-f05a-facilitator";
const OBSERVER = "u-f05a-observer";
const LEAD = "u-f05a-lead";

const SCOPE = { action: "read.rawTranscript", groupId: "g2" } as const;

function identityRepo() {
  return new FakeRoleViewRepository({
    [FACILITATOR]: { orgRole: "consultant", projectRole: "facilitator", isHost: true },
    [OBSERVER]: { orgRole: "consultant", projectRole: "observer" },
    [LEAD]: { orgRole: "lead", projectRole: null },
  });
}

function deps() {
  return {
    repo: identityRepo(),
    ids: new FakeDecisionIds(),
    grants: new FakeTemporaryGrantRepository(),
    segments: new FakeAgendaSegmentStateReader({ [`${WORKSHOP}:${SEGMENT}`]: "active" }),
    provenance: new FakeQueryableProvenance(),
    clock: new FakeClock(),
  };
}

describe("授予留痕", () => {
  it("成功授予恰好写入一条审计事件，actor 是授予者，detail 里能查到被授权人/动作/失效环节", async () => {
    const d = deps();
    const { provenanceEventId } = await grantTemporaryRead(d, {
      granterId: FACILITATOR,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });

    expect(d.provenance.events).toHaveLength(1);
    const ev = d.provenance.events[0]!;
    expect(ev.id).toBe(provenanceEventId);
    expect(ev.actorId).toBe(FACILITATOR);
    expect(ev.target).toEqual({ kind: "project", id: WORKSHOP });
    expect(ev.detail.op).toBe("temp-grant-created");
    expect(ev.detail.granteeId).toBe(OBSERVER);
    expect(ev.detail.action).toBe(SCOPE.action);
    expect(ev.detail.groupId).toBe(SCOPE.groupId);
    expect(ev.detail.agendaSegmentId).toBe(SEGMENT);
  });

  it("项目负责人（org role lead）而非 facilitator 也能授予，同样留痕", async () => {
    const d = deps();
    await grantTemporaryRead(d, {
      granterId: LEAD,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });
    expect(d.provenance.events).toHaveLength(1);
    expect(d.provenance.events[0]!.actorId).toBe(LEAD);
  });
});

describe("失效留痕", () => {
  it("环节终结后第一次被观察到过期时写入一条 temp-grant-expired 审计事件，actor 是被授权人", async () => {
    const d = deps();
    await grantTemporaryRead(d, {
      granterId: FACILITATOR,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });
    d.segments.setState(WORKSHOP, SEGMENT, "closed");

    await checkTemporaryGrantAccess(d, { orgId: ORG, workshopId: WORKSHOP, granteeId: OBSERVER, requested: SCOPE });

    expect(d.provenance.events).toHaveLength(2);
    const expiry = d.provenance.events[1]!;
    expect(expiry.actorId).toBe(OBSERVER);
    expect(expiry.detail.op).toBe("temp-grant-expired");
    expect(expiry.detail.revokedReason).toBe("agenda-segment-terminal");
  });

  it("🔴 反向反证：过期后重复请求不重复写审计——不是每次读都追加一条", async () => {
    const d = deps();
    await grantTemporaryRead(d, {
      granterId: FACILITATOR,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });
    d.segments.setState(WORKSHOP, SEGMENT, "closed");

    await checkTemporaryGrantAccess(d, { orgId: ORG, workshopId: WORKSHOP, granteeId: OBSERVER, requested: SCOPE });
    await checkTemporaryGrantAccess(d, { orgId: ORG, workshopId: WORKSHOP, granteeId: OBSERVER, requested: SCOPE });
    await checkTemporaryGrantAccess(d, { orgId: ORG, workshopId: WORKSHOP, granteeId: OBSERVER, requested: SCOPE });

    // Exactly one grant + one expiry, however many times the now-dead grant is re-checked.
    expect(d.provenance.events).toHaveLength(2);
  });
});

describe("均可检索 -- 走唯一的 queryProvenance 查询面，不是私有缓冲区里能看见就算数", () => {
  it("项目负责人可以按 targetId（本工作坊）查到授予与失效两条事件", async () => {
    const d = deps();
    await grantTemporaryRead(d, {
      granterId: FACILITATOR,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });
    d.segments.setState(WORKSHOP, SEGMENT, "closed");
    await checkTemporaryGrantAccess(d, { orgId: ORG, workshopId: WORKSHOP, granteeId: OBSERVER, requested: SCOPE });

    const page = await queryProvenance(
      { repo: d.repo, reader: d.provenance },
      { requesterId: LEAD, orgId: ORG, filter: { targetKind: "project", targetId: WORKSHOP } },
    );

    expect(page.events.map((e) => e.detail.op).sort()).toEqual(["temp-grant-created", "temp-grant-expired"]);
  });

  it("按 actorId 单独检索授予事件（谁在什么时候给谁开了权）", async () => {
    const d = deps();
    await grantTemporaryRead(d, {
      granterId: FACILITATOR,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });

    const page = await queryProvenance(
      { repo: d.repo, reader: d.provenance },
      { requesterId: LEAD, orgId: ORG, filter: { actorId: FACILITATOR } },
    );

    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.detail.op).toBe("temp-grant-created");
  });

  it("观察者自己查自己的历史（own-history 规则）能看到失效事件，不需要 lead/admin 角色", async () => {
    const d = deps();
    await grantTemporaryRead(d, {
      granterId: FACILITATOR,
      granteeId: OBSERVER,
      orgId: ORG,
      workshopId: WORKSHOP,
      scope: SCOPE,
      agendaSegmentId: SEGMENT,
    });
    d.segments.setState(WORKSHOP, SEGMENT, "closed");
    await checkTemporaryGrantAccess(d, { orgId: ORG, workshopId: WORKSHOP, granteeId: OBSERVER, requested: SCOPE });

    const page = await queryProvenance(
      { repo: d.repo, reader: d.provenance },
      { requesterId: OBSERVER, orgId: ORG, filter: { actorId: OBSERVER } },
    );
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.detail.op).toBe("temp-grant-expired");
  });
});
