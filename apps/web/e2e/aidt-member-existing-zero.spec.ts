import { expect, test, type Route } from "@playwright/test";
import { identity, project } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { aidtV2Api, createAidtV2Group, loginAidtV2 } from "./support/aidt-v2-acceptance";
import { acceptAidtExistingMemberPair } from "./support/aidt-member-multiuser-acceptance";
import { acceptAidtMemberText } from "./support/aidt-member-text-acceptance";
import { apiPath } from "./support/real-model-api";

test.skip(process.env.AIDT_MEMBER_ZERO !== "1", "Exclusive root-authorized existing collaboration fixture lane");
test.beforeAll(() => {
  expect(process.env.AIDT_MEMBER_ZERO_ROOT_GO).toBe("existing-fixture-members-approved");
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
  expect(Boolean(process.env.AIDT_MEMBER_ZERO_PROJECT_ID)).toBe(Boolean(process.env.AIDT_MEMBER_ZERO_PRIVATE_PROJECT_ID));
  for (const origin of [REAL_MODEL_SMOKE.baseUrl, process.env.AIDT_V2_API_ORIGIN ?? ""]) {
    const url = new URL(origin); expect(url.hostname).toBe("127.0.0.1"); expect(url.protocol).toBe("http:");
    expect(url.username + url.password).toBe("");
  }
});

test("existing collaboration accounts exchange real member texts and reject an unjoined QA group", async ({ page, browser }, info) => {
  const blocked: { path: string; actor: string }[] = [], phases: string[] = [];
  const generationGuard = (actor: string) => async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (path.includes("/api/copilotkit") || /\/chat\/threads\/[^/]+\/(messages|queued-messages)$/.test(path)
      || /\/agent-runs\/[^/]+\/(decision|resume|execute|retries)$/.test(path) || /\/pm-designs\/[^/]+\/(chat|variants)$/.test(path))) {
      blocked.push({ path, actor }); await route.abort("failed");
      throw new Error("AIDT_MEMBER_ZERO_UNEXPECTED_GENERATION_BLOCKED");
    } else await route.continue();
  };
  const ownerGuard = generationGuard("collaboration-lead"), memberGuard = generationGuard("collaboration-member");
  await page.context().route("**/*", ownerGuard);
  const secondContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl, viewport: { width: 1440, height: 1000 } });
  await secondContext.route("**/*", memberGuard);
  let projectId = "", privateProjectId = "";
  let membershipInitialization: unknown = { performed: false };
  try {
    await loginAidtV2(page); phases.push("lead-normal-login");
    const me = await aidtV2Api(page, `/identity/me?orgId=${encodeURIComponent(FULLSTACK_E2E.collaborationOrgId)}`); expect(me.status).toBe(200);
    expect(identity.operations.resolveIdentity.out.parse(me.data).orgRole).toBe("admin");
    const reuse = Boolean(process.env.AIDT_MEMBER_ZERO_PROJECT_ID);
    projectId = process.env.AIDT_MEMBER_ZERO_PROJECT_ID ?? await createAidtV2Group(page, "独立双账号成员文字"); phases.push(reuse ? "reuse-own-approved-QA-shared-group" : "owner-normal-UI-created-QA-group");
    const membershipPath = `/projects/${projectId}/collaborators`;
    const ownerList = await aidtV2Api(page, membershipPath); expect(ownerList.status).toBe(200);
    expect(project.operations.listNonWorkshopMembers.out.parse(ownerList.data).members).toContainEqual(expect.objectContaining({ userId: FULLSTACK_E2E.collaborationLeadUserId, role: "owner" }));
    if (reuse) {
      expect(project.operations.listNonWorkshopMembers.out.parse(ownerList.data).members).toContainEqual(expect.objectContaining({ userId: FULLSTACK_E2E.collaborationMemberUserId, role: "collaborator" }));
      phases.push("authoritative-existing-QA-memberships-read-no-write");
    } else {
      const added = await aidtV2Api(page, membershipPath, "POST", { projectId, userId: FULLSTACK_E2E.collaborationMemberUserId, role: "collaborator" });
      expect([200, 201]).toContain(added.status); expect(project.operations.addNonWorkshopMember.out.parse(added.data)).toMatchObject({ projectId, userId: FULLSTACK_E2E.collaborationMemberUserId, role: "collaborator" });
      membershipInitialization = { performed: true, scope: "本轮新建合成QA组成员初始化；未修改既有组成员或组织角色", projectId,
        actorUserId: FULLSTACK_E2E.collaborationLeadUserId, addedUserId: FULLSTACK_E2E.collaborationMemberUserId, role: "collaborator",
        transport: "normally authenticated product collaborator API", status: added.status, receipt: project.operations.addNonWorkshopMember.out.parse(added.data) };
      phases.push("normal-owner-added-existing-collaborator");
      await page.goto("/home", { waitUntil: "domcontentloaded" });
    }
    privateProjectId = process.env.AIDT_MEMBER_ZERO_PRIVATE_PROJECT_ID ?? await createAidtV2Group(page, "独立未加入组拒绝"); phases.push(reuse ? "reuse-own-approved-QA-private-group" : "owner-only-QA-group-created");
    expect(privateProjectId).not.toBe(projectId);
    const privateMemberships = await aidtV2Api(page, `/projects/${privateProjectId}/collaborators`); expect(privateMemberships.status).toBe(200);
    const privateList = project.operations.listNonWorkshopMembers.out.parse(privateMemberships.data).members;
    expect(privateList).toContainEqual(expect.objectContaining({ userId: FULLSTACK_E2E.collaborationLeadUserId, role: "owner" }));
    expect(privateList.some(item => item.userId === FULLSTACK_E2E.collaborationMemberUserId)).toBe(false);
    phases.push("private-QA-owner-and-member-exclusion-authoritatively-read");
    const second = await secondContext.newPage(); await loginAidtV2(second, "member"); phases.push("existing-member-normal-login");
    const secondMe = await aidtV2Api(second, `/identity/me?orgId=${encodeURIComponent(FULLSTACK_E2E.collaborationOrgId)}`); expect(secondMe.status).toBe(200);
    expect(identity.operations.resolveIdentity.out.parse(secondMe.data).orgRole).toBe("consultant");
    for (const current of [page, second]) {
      await current.goto(`/aidt/${projectId}?step=1&tool=outcome`, { waitUntil: "domcontentloaded" });
      await expect(current.getByTestId("aidt-workspace")).toBeVisible();
    }
    const result = await acceptAidtExistingMemberPair({ owner: page, member: second, projectId, privateProjectId, apiOrigin: new URL(apiPath("/"), REAL_MODEL_SMOKE.baseUrl).href.replace(/\/$/, "") });
    await info.attach("member-topic-real-browser", { contentType: "image/png", body: await page.screenshot({ animations: "disabled" }) });
    await page.getByTestId("project-member-topic-close").click();
    const drafts = await acceptAidtMemberText({ page, projectId, toStep: 2, request: (path, method, body) => aidtV2Api(page, path, method, body),
      checkpoint: async (name, current) => { await info.attach(`member-${name}-real-browser`, { contentType: "image/png", body: await current.screenshot({ animations: "disabled" }) }); } });
    phases.push("two-browser-channel-topic-and-isolation-complete"); expect(blocked).toEqual([]);
    await info.attach("existing-member-pair-real-browser", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      source: process.env.AIDT_MEMBER_ZERO_WEB_SOURCE, result, drafts, phases, blockedGenerationRequests: blocked,
      setup: "normal existing org admin creates own QA groups and adds the existing org consultant through the product collaborator API", membershipInitialization,
      ordinaryStudentCreatesGroupProven: false, membershipRowsWrittenThroughNormalProductApi: !reuse, previousSetupEvidenceRetained: reuse,
      providerOrTeachingSuccessClaimed: false, isolatedFromFundedAdminDeviceSession: true,
      independentOwnerModelAudit: "A1 exact collaboration tenant/project audit required; main paid org activity is unrelated",
    }, null, 2)) });
  } finally {
    await info.attach("existing-member-pair-exit-state", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      orgId: FULLSTACK_E2E.collaborationOrgId, projectId, privateProjectId, phases, blockedGenerationRequests: blocked,
      source: process.env.AIDT_MEMBER_ZERO_WEB_SOURCE, membershipInitialization, oldFundedActorUsed: false,
    }, null, 2)) });
    await secondContext.close(); await page.context().unroute("**/*", ownerGuard);
  }
});
