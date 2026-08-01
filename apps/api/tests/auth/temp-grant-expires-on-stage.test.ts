/**
 * F05 -- UC-1.4 R4: a temporary read granted "until this agenda segment ends" is live while
 * that segment is active, and refused the instant it terminates -- by ANY of the four ways
 * `advanceAgendaSegment` can end a segment (advance/closeEarly land on `closed` same as
 * `merge`; `skip` lands on `skipped` -- `advance-segment-outcomes.ts`).
 *
 * No `tests/support/db` import: `grantTemporaryRead` / `checkTemporaryGrantAccess` are pure
 * application logic over ports, exactly the precedent `preview-mode-no-write.test.ts` sets
 * for F04 -- fully testable against in-memory fakes.
 */
import { describe, expect, it } from "vitest";
import { grantTemporaryRead, GrantForbiddenError, GrantSegmentTerminalError } from "../../src/application/identity/grant-temporary-read";
import { checkTemporaryGrantAccess } from "../../src/application/identity/check-temporary-grant-access";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";
import {
  FakeAgendaSegmentStateReader,
  FakeClock,
  FakeQueryableProvenance,
  FakeTemporaryGrantRepository,
} from "../support/temporary-grant-fakes";

const ORG = toOrgId("org-f05-grant");
const WORKSHOP = "ws-f05-grant";
const SEGMENT = "seg-3";

const FACILITATOR = "u-f05-facilitator";
const OBSERVER = "u-f05-observer";
const GROUP_LEAD = "u-f05-grouplead";

const RAW_TRANSCRIPT_GROUP_2 = { action: "read.rawTranscript", groupId: "g2" } as const;

function repo() {
  return new FakeRoleViewRepository({
    [FACILITATOR]: { orgRole: "consultant", projectRole: "facilitator", isHost: true },
    [OBSERVER]: { orgRole: "consultant", projectRole: "observer" },
    [GROUP_LEAD]: { orgRole: "consultant", projectRole: "groupLead", groupId: "g2" },
  });
}

function deps() {
  const segments = new FakeAgendaSegmentStateReader({ [`${WORKSHOP}:${SEGMENT}`]: "active" });
  return {
    repo: repo(),
    ids: new FakeDecisionIds(),
    grants: new FakeTemporaryGrantRepository(),
    segments,
    provenance: new FakeQueryableProvenance(),
    clock: new FakeClock(),
  };
}

async function grantToObserver(d: ReturnType<typeof deps>) {
  return grantTemporaryRead(d, {
    granterId: FACILITATOR,
    granteeId: OBSERVER,
    orgId: ORG,
    workshopId: WORKSHOP,
    scope: RAW_TRANSCRIPT_GROUP_2,
    agendaSegmentId: SEGMENT,
  });
}

describe("授予：只有 facilitator/项目负责人 能开临时读权", () => {
  it("facilitator 授予成功，返回的 grant 精确指向所授予的 scope 与失效环节", async () => {
    const d = deps();
    const { grant } = await grantToObserver(d);
    expect(grant.granteeId).toBe(OBSERVER);
    expect(grant.scope).toEqual(RAW_TRANSCRIPT_GROUP_2);
    expect(grant.agendaSegmentId).toBe(SEGMENT);
    expect(grant.revokedAt).toBeNull();
  });

  it("groupLead（非 facilitator、非项目负责人）尝试授予被拒 PROJECT_ROLE_INSUFFICIENT", async () => {
    const d = deps();
    await expect(
      grantTemporaryRead(d, {
        granterId: GROUP_LEAD,
        granteeId: OBSERVER,
        orgId: ORG,
        workshopId: WORKSHOP,
        scope: RAW_TRANSCRIPT_GROUP_2,
        agendaSegmentId: SEGMENT,
      }),
    ).rejects.toBeInstanceOf(GrantForbiddenError);
  });

  it("对一个已经终结的环节授予被拒——「到该环节结束为止」的授予不能指一个已经结束的环节", async () => {
    const d = deps();
    d.segments.setState(WORKSHOP, SEGMENT, "closed");
    await expect(grantToObserver(d)).rejects.toBeInstanceOf(GrantSegmentTerminalError);
  });
});

describe("环节进行中：临时读权有效", () => {
  it("环节仍 active 时，被授权人对被授权 scope 的读取被判定为有效（反向反证的正向前提）", async () => {
    const d = deps();
    await grantToObserver(d);
    const result = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: RAW_TRANSCRIPT_GROUP_2,
    });
    expect(result.allowed).toBe(true);
  });

  it("🔴 反向反证：同一被授权人，没有被授予的 scope（另一组 / 另一动作）依旧被拒——不是「有任意 grant 就全放行」", async () => {
    const d = deps();
    await grantToObserver(d);
    const wrongGroup = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: { action: "read.rawTranscript", groupId: "g3" },
    });
    expect(wrongGroup.allowed).toBe(false);

    const wrongAction = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: { action: "read.privateChat", groupId: "g2" },
    });
    expect(wrongAction.allowed).toBe(false);
  });

  it("🔴 反向反证：从未被授予过任何 grant 的人，同样的 scope 请求被拒 NO_TEMPORARY_GRANT", async () => {
    const d = deps();
    const result = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: GROUP_LEAD,
      requested: RAW_TRANSCRIPT_GROUP_2,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reasonCode).toBe("NO_TEMPORARY_GRANT");
  });
});

describe("环节终结后（四种去向的每一种）：同一请求立即被拒", () => {
  it.each([
    ["advance/closeEarly 落地的终态 closed", "closed" as const],
    ["skip 落地的终态 skipped", "skipped" as const],
    ["merge 也落 closed，同 advance/closeEarly 共用同一终态", "closed" as const],
  ])("%s -> 推进到下一环节后同一请求被拒", async (_label, terminalState) => {
    const d = deps();
    await grantToObserver(d);
    d.segments.setState(WORKSHOP, SEGMENT, terminalState);

    const result = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: RAW_TRANSCRIPT_GROUP_2,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reasonCode).toBe("TEMPORARY_GRANT_EXPIRED");
  });

  it("环节被跳过（skip）后立即失效，不需要任何轮询/延迟 -- 同一进程内下一次请求即被拒", async () => {
    const d = deps();
    await grantToObserver(d);
    const before = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: RAW_TRANSCRIPT_GROUP_2,
    });
    expect(before.allowed).toBe(true);

    d.segments.setState(WORKSHOP, SEGMENT, "skipped");
    const after = await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: RAW_TRANSCRIPT_GROUP_2,
    });
    expect(after.allowed).toBe(false);
  });

  it("过期后仓储里的 grant 行被标记 revoked（不是只在内存判定里临时算出「不行」）", async () => {
    const d = deps();
    const { grant } = await grantToObserver(d);
    d.segments.setState(WORKSHOP, SEGMENT, "closed");
    await checkTemporaryGrantAccess(d, {
      orgId: ORG,
      workshopId: WORKSHOP,
      granteeId: OBSERVER,
      requested: RAW_TRANSCRIPT_GROUP_2,
    });
    const stored = d.grants.rows.find((g) => g.id === grant.id)!;
    expect(stored.revokedAt).not.toBeNull();
    expect(stored.revokedReason).toBe("agenda-segment-terminal");
  });
});
