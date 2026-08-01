/**
 * F87 —— 研究员侧只读镜像（uc-6-3 R3 第 6 步、R5、R6/AC4、R12 V1/V4/V9）。
 *
 * 纯单元测试，用内存实现（`tests/support/subject-fakes.ts`）跑通编排逻辑，
 * 不连 Postgres（issue #74：本地只保证纯测试与 typecheck；SQL 层面的"同一张表、
 * 无第二状态列"已由 `consent-status-single-source.test.ts` 覆盖，这里不重复）。
 *
 * 覆盖：
 *   ① 镜像显示本人选择与提交时间，尚未提交显示「待签」（pending_consent）。
 *   ② 同意书三态与实际同意位一致（AC9）。
 *   ③ `grantedOfFour` 头字段口径对齐 V1「授权 3/4」。
 *   ④ **AC4 结构性断言**：`ConsentSubmissionStore` 接口上除 `submit`（append-only 写入）
 *      外没有任何"改写/覆盖他人同意位"的方法——`CONSENT_STAFF_READONLY` 不可达
 *      是因为压根没有这样的写口，不是提供了但恒拒绝（契约 `KNOWN_CONTRACT_GAPS.C_ITV_7`）。
 *   ⑤ 观察者不可读对象表（R5），因此也读不到该受访者的镜像行。
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { getConsentMirror } from "../../src/application/interview/get-consent-mirror";
import { getInterviewRosterSubjects } from "../../src/application/interview/subject-projections";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { InMemoryConsentSubmissionStore, InMemorySubjectRepository } from "../support/subject-fakes";

const ORG = toOrgId("org-f87-mirror");
const SESSION = "itv-f87-session";
const CREATOR = "u-f87-researcher";

function harness() {
  const subjects = new InMemorySubjectRepository();
  const consent = new InMemoryConsentSubmissionStore();
  const decisions = new CountingDecisionIdFactory("f87");
  // 未归组对象的可见性走 orgMembershipOf（见 subject-visibility-decision.ts）——
  // 研究员本人必须先是组织成员，「创建者恒可读」才谈得上。
  subjects.setOrgMembership(CREATOR, { orgRole: "consultant", teamId: "team-1" });
  return { subjects, consent, decisions };
}

describe("F87 — 研究员侧只读镜像", () => {
  it("尚无提交时镜像显示「待签」，submittedAt 为 null", async () => {
    const deps = harness();
    const created = await deps.subjects.create({
      orgId: ORG, displayName: "Weber", roleTitle: "采购总监", orgName: "Müller GmbH",
      groupId: null, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    await deps.subjects.attachToSession(ORG, SESSION, created.subjectId, CREATOR);

    const mirror = await getConsentMirror(deps, ORG, CREATOR, SESSION);
    const row = mirror.rows.find((r) => r.subjectId === created.subjectId);
    expect(row?.consentStatus).toBe("pending_consent");
    expect(row?.bits).toBeNull();
    expect(row?.submittedAt).toBeNull();
    expect(mirror.grantedOfFour).toBe("0/4");
  });

  it("受访者提交后镜像显示本人选择与提交时间，三态随 ai_analysis 变化（AC9）", async () => {
    const deps = harness();
    const created = await deps.subjects.create({
      orgId: ORG, displayName: "Weber", roleTitle: "采购总监", orgName: "Müller GmbH",
      groupId: null, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    await deps.subjects.attachToSession(ORG, SESSION, created.subjectId, CREATOR);

    await deps.consent.submit(ORG, SESSION, created.subjectId, {
      record: true, transcript: true, ai_analysis: false, attribution: true,
    });

    const mirror = await getConsentMirror(deps, ORG, CREATOR, SESSION);
    const row = mirror.rows.find((r) => r.subjectId === created.subjectId);
    expect(row?.consentStatus).toBe("ai_analysis_declined");
    expect(row?.bits).toEqual({ record: true, transcript: true, ai_analysis: false, attribution: true });
    expect(row?.submittedAt).toBeTruthy();
    // V1/AC1 口径：「授权 3/4」——四项里三项为 true。
    expect(mirror.grantedOfFour).toBe("3/4");

    await deps.consent.submit(ORG, SESSION, created.subjectId, {
      record: true, transcript: true, ai_analysis: true, attribution: true,
    });
    const mirrorAfter = await getConsentMirror(deps, ORG, CREATOR, SESSION);
    const rowAfter = mirrorAfter.rows.find((r) => r.subjectId === created.subjectId);
    expect(rowAfter?.consentStatus).toBe("authorized");
    expect(mirrorAfter.grantedOfFour).toBe("4/4");
  });

  it("append-only：改一次选择是追加第二条提交，不是覆盖第一条（I-16，镜像永远显示最新一条）", async () => {
    const deps = harness();
    const created = await deps.subjects.create({
      orgId: ORG, displayName: "Kraus", roleTitle: "采购经理", orgName: null,
      groupId: null, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    await deps.subjects.attachToSession(ORG, SESSION, created.subjectId, CREATOR);

    await deps.consent.submit(ORG, SESSION, created.subjectId, {
      record: true, transcript: false, ai_analysis: false, attribution: false,
    });
    await deps.consent.submit(ORG, SESSION, created.subjectId, {
      record: true, transcript: true, ai_analysis: true, attribution: true,
    });

    expect(deps.consent.historyFor(SESSION, created.subjectId)).toHaveLength(2);
    const mirror = await getConsentMirror(deps, ORG, CREATOR, SESSION);
    const row = mirror.rows.find((r) => r.subjectId === created.subjectId);
    expect(row?.consentStatus).toBe("authorized");
  });

  it("AC4 结构性断言：ConsentSubmissionStore 上除 submit 外没有任何写/改写他人同意位的方法", () => {
    const consent = new InMemoryConsentSubmissionStore();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(consent)).filter(
      (n) => n !== "constructor",
    );
    // 只读两个 + 一个 append-only 写入 + 一个测试专用的 historyFor 直读——没有 update/override/revoke 之类。
    expect(new Set(methodNames)).toEqual(new Set(["latestFor", "latestSubmissionMeta", "submit", "historyFor"]));
    for (const forbidden of ["update", "override", "revokeConsent", "setConsent", "patch"]) {
      expect(methodNames).not.toContain(forbidden);
    }
  });

  it("观察者不可读对象表，因此镜像与名单投影里都看不到该受访者（R5）", async () => {
    const deps = harness();
    const groupId = "grp-1";
    const created = await deps.subjects.create({
      orgId: ORG, displayName: "匿名受访者", roleTitle: "运营总监", orgName: null,
      groupId, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    await deps.subjects.attachToSession(ORG, SESSION, created.subjectId, CREATOR);
    await deps.consent.submit(ORG, SESSION, created.subjectId, {
      record: true, transcript: true, ai_analysis: true, attribution: true,
    });

    const OBSERVER = "u-f87-observer";
    deps.subjects.setViewerContextForGroup(OBSERVER, groupId, {
      orgRole: "consultant", teamId: "team-1", projectRole: "observer",
    });

    const observerRoster = await getInterviewRosterSubjects(deps, ORG, OBSERVER, SESSION);
    expect(observerRoster.find((r) => r.subjectId === created.subjectId)).toBeUndefined();

    const observerMirror = await getConsentMirror(deps, ORG, OBSERVER, SESSION);
    expect(observerMirror.rows.find((r) => r.subjectId === created.subjectId)).toBeUndefined();

    // 对照组：创建者本人（或有效项目角色）能看见同一行——证明上面看不见是权限判定的结果，
    // 不是数据本身丢了。
    const creatorMirror = await getConsentMirror(deps, ORG, CREATOR, SESSION);
    expect(creatorMirror.rows.find((r) => r.subjectId === created.subjectId)).toBeTruthy();
  });
});
