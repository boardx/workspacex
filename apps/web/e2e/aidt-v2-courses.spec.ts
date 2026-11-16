import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { auth, identity, project } from "@repo/contracts";
import { operations as courses, type CourseValue } from "@repo/contracts/aidt-courses";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { V2_SEND_WIRE } from "./chat-v2-send";
import { apiPath } from "./support/real-model-api";
import { aidtV2Api, assertAidtV2Target, createAidtV2Group, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage } from "./support/aidt-v2-acceptance";

type Role = "owner" | "student" | "admin";
const actors = {
  owner: { email: FULLSTACK_E2E.collaborationLeadEmail, password: FULLSTACK_E2E.collaborationLeadPassword, userId: FULLSTACK_E2E.collaborationLeadUserId, orgRole: "admin" },
  student: { email: FULLSTACK_E2E.collaborationMemberEmail, password: FULLSTACK_E2E.collaborationMemberPassword, userId: FULLSTACK_E2E.collaborationMemberUserId, orgRole: "consultant" },
  admin: { email: FULLSTACK_E2E.collaborationAdminEmail, password: FULLSTACK_E2E.collaborationAdminPassword, userId: FULLSTACK_E2E.collaborationAdminUserId, orgRole: "admin" },
} as const;
const orgId = FULLSTACK_E2E.collaborationOrgId;
const marker = (label: string) => `FR01合成验收·${label}·${randomUUID().slice(0, 8)}`;
const exactPath = (url: string, path: string) => new URL(url).pathname === apiPath(path);

/** Existing isolated seed identities only; never create a Teacher or change organization roles. */
async function login(page: Page, role: Role) {
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").fill(actors[role].email);
    await page.getByTestId("login-password").fill(actors[role].password);
    const response = page.waitForResponse(value => value.request().method() === "POST" && exactPath(value.url(), auth.operations.login.path));
    await page.getByTestId("login-submit").click();
    expect((await response).status()).toBe(200);
    await page.waitForURL(/\/home$/);
    const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as { userId?: string; currentOrgId?: string } | null, SESSION_STORAGE_KEY);
    expect(session).toMatchObject({ userId: actors[role].userId, currentOrgId: orgId });
    const actual = await aidtV2Api(page, `/identity/me?orgId=${encodeURIComponent(orgId)}`);
    expect(actual.status).toBe(200);
    expect(identity.operations.resolveIdentity.out.parse(actual.data).orgRole).toBe(actors[role].orgRole);
  } catch (error) {
    // Login fields must not appear in automatic failure artifacts.
    await page.goto("about:blank").catch(() => undefined);
    throw error;
  }
}
function observeNoModel(context: BrowserContext) {
  const attempted: string[] = [];
  context.on("request", request => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (V2_SEND_WIRE.test(path) || /\/chat\/threads\/[^/]+\/messages$/.test(path) || /\/agent-runs(?:\/[^/]+\/retries)?$/.test(path)) attempted.push(path);
  });
  return attempted;
}
async function roster(page: Page, projectId: string) {
  const result = await aidtV2Api(page, `/projects/${projectId}/collaborators`);
  expect(result.status).toBe(200);
  return project.operations.listNonWorkshopMembers.out.parse(result.data).members;
}
async function addSyntheticStudent(page: Page, projectId: string) {
  const before = await roster(page, projectId);
  expect(before.some(member => member.userId === actors.student.userId)).toBe(false);
  const result = await aidtV2Api(page, `/projects/${projectId}/collaborators`, "POST", { projectId, userId: actors.student.userId, role: "collaborator" });
  expect(result.status).toBe(201);
  expect((await roster(page, projectId)).find(member => member.userId === actors.student.userId)?.role).toBe("collaborator");
}
async function home(page: Page) {
  const loaded = page.waitForResponse(response => response.request().method() === "GET" && exactPath(response.url(), courses.list.path));
  await page.goto("/aidt", { waitUntil: "domcontentloaded" });
  const response = await loaded; expect(response.status()).toBe(200);
  const result = courses.list.out.parse(await response.json());
  await expect(page.getByTestId("aidt-courses")).toBeVisible();
  if (result.items[0]) await expect(page.getByTestId(`aidt-course-${result.items[0].id}`)).toBeVisible();
  else await expect(page.getByTestId("aidt-courses-empty")).toBeVisible();
  return result;
}
async function selectCourse(page: Page, courseId: string) {
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const button = page.getByTestId(`aidt-course-${courseId}`);
    if (await button.count()) {
      const loaded = page.waitForResponse(response => response.request().method() === "GET" && exactPath(response.url(), `/aidt/courses/${courseId}/groups`));
      await button.click(); const response = await loaded; expect(response.status()).toBe(200);
      const result = courses.groups.out.parse(await response.json());
      await expect(page.getByTestId("aidt-course-selected")).toContainText(result.course.name);
      return result;
    }
    const more = page.getByRole("button", { name: "更多课程", exact: true });
    await expect(more, "目标课程必须通过服务端cursor分页找到，不把首屏当全量").toBeVisible();
    const loaded = page.waitForResponse(response => response.request().method() === "GET" && exactPath(response.url(), courses.list.path));
    await more.click(); expect((await loaded).status()).toBe(200);
  }
  throw new Error("AIDT_COURSE_ACCEPTANCE_PAGE_BOUND_EXCEEDED");
}
async function createCourseUi(page: Page, name: string) {
  await home(page);
  await page.getByTestId("aidt-course-name").fill(name);
  const response = page.waitForResponse(value => value.request().method() === "POST" && exactPath(value.url(), courses.create.path));
  await page.getByTestId("aidt-course-create-save").click();
  const saved = await response; expect(saved.status()).toBe(201);
  const result = courses.create.out.parse(await saved.json());
  expect(result.course.name).toBe(name); expect(result.replayed).toBe(false);
  await expect(page.getByTestId("aidt-course-selected")).toContainText(name);
  return result.course;
}
async function createCourseApi(page: Page, name: string) {
  const operationId = randomUUID();
  const response = await aidtV2Api(page, courses.create.path, "POST", { name, operationId });
  expect(response.status).toBe(201);
  return { ...courses.create.out.parse(response.data), operationId };
}
async function linkUi(page: Page, course: CourseValue, projectId: string) {
  const before = await roster(page, projectId);
  await page.getByTestId("aidt-course-link-project").selectOption(projectId);
  const response = page.waitForResponse(value => value.request().method() === "PUT" && exactPath(value.url(), `/aidt/courses/${course.id}/groups/${projectId}`));
  await page.getByTestId("aidt-course-link-save").click();
  const saved = await response; expect(saved.status()).toBe(200);
  expect(courses.link.out.parse(await saved.json())).toMatchObject({ courseId: course.id, projectId, replayed: false });
  await expect(page.getByTestId(`aidt-course-project-${projectId}`)).toBeVisible();
  expect(await roster(page, projectId), "课程关联不能自动添加成员或改变组员角色").toEqual(before);
}
async function listGroups(page: Page, courseId: string, query = "") {
  const response = await aidtV2Api(page, `/aidt/courses/${courseId}/groups${query}`);
  expect(response.status).toBe(200);
  return courses.groups.out.parse(response.data);
}
async function linkApi(page: Page, courseId: string, projectId: string) {
  return aidtV2Api(page, `/aidt/courses/${courseId}/groups/${projectId}`, "PUT", {});
}

test.beforeAll(() => assertAidtV2Target());

test("FR01 course A: real UI create and owner links, same-course group isolation, fresh login preserves original saved input", async ({ page, browser, context }, info) => {
  test.setTimeout(240_000);
  const modelRequests = observeNoModel(context);
  const adminContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  const studentContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  const otherRequests = [observeNoModel(adminContext), observeNoModel(studentContext), observeNoModel(freshContext)];
  try {
    await login(page, "owner");
    const groupA = await createAidtV2Group(page, "course-A-owner");
    await addSyntheticStudent(page, groupA);
    await openAidtV2Outcome(page, groupA, 1);
    const original = marker("A组原始问题·尚未验证");
    await page.getByLabel("初始问题", { exact: true }).fill(original);
    const saved = await saveAidtV2Stage(page, groupA, 1);
    const admin = await adminContext.newPage(); await login(admin, "admin");
    const groupB = await createAidtV2Group(admin, "course-B-owner");
    await openAidtV2Outcome(admin, groupB, 1);
    const privateText = marker("B组独有未验证内容");
    await admin.getByLabel("初始问题", { exact: true }).fill(privateText);
    const savedB = await saveAidtV2Stage(admin, groupB, 1);
    const course = await createCourseUi(page, marker("真实UI课程"));
    await linkUi(page, course, groupA);
    const adminRoster = await roster(admin, groupB);
    expect((await linkApi(admin, course.id, groupB)).status).toBe(200);
    expect(await roster(admin, groupB)).toEqual(adminRoster);
    const groupExtra = await createAidtV2Group(page, "same-course-owner-pagination");
    expect((await linkApi(page, course.id, groupExtra)).status).toBe(200);
    const ownedPage1 = await listGroups(page, course.id, "?limit=1");
    expect(ownedPage1.items).toHaveLength(1); expect(ownedPage1.nextCursor).toBeTruthy();
    const ownedPage2 = await listGroups(page, course.id, `?limit=1&cursor=${encodeURIComponent(ownedPage1.nextCursor!)}`);
    expect(ownedPage2.items).toHaveLength(1); expect(ownedPage2.nextCursor).toBeNull();
    expect(new Set([...ownedPage1.items, ...ownedPage2.items].map(item => item.project.id))).toEqual(new Set([groupA, groupExtra]));
    const second = await createCourseApi(page, marker("禁止同组多课程"));
    const replay = await aidtV2Api(page, courses.create.path, "POST", { name: second.course.name, operationId: second.operationId });
    expect(replay.status).toBe(201); expect(courses.create.out.parse(replay.data)).toEqual({ course: second.course, replayed: true });
    const conflict = await linkApi(page, second.course.id, groupA);
    expect(conflict.status).toBe(409); expect(conflict.data).toMatchObject({ reasonCode: "AIDT_COURSE_GROUP_CONFLICT" });
    expect(new Set((await listGroups(page, course.id)).items.map(item => item.project.id))).toEqual(new Set([groupA, groupExtra]));
    expect((await listGroups(admin, course.id)).items.map(item => item.project.id)).toEqual([groupB]);
    const adminFallback = await linkApi(page, course.id, groupB);
    expect(adminFallback.status).toBe(404); expect(adminFallback.data).toMatchObject({ reasonCode: "AIDT_COURSE_NOT_FOUND" });
    expect((await aidtV2Api(page, `/projects/${groupB}/aidt/stages/1`)).status).toBe(404);
    const student = await studentContext.newPage(); await login(student, "student");
    await home(student); await expect(student.getByTestId("aidt-course-create")).toHaveCount(0);
    const deniedCreate = await aidtV2Api(student, courses.create.path, "POST", { name: marker("学生不可建课"), operationId: randomUUID() });
    expect(deniedCreate.status).toBe(403); expect(deniedCreate.data).toMatchObject({ reasonCode: "AIDT_COURSE_FORBIDDEN" });
    const deniedLink = await linkApi(student, course.id, groupA); expect(deniedLink.status).toBe(403);
    const studentGroups = await selectCourse(student, course.id);
    expect(studentGroups.items.map(item => item.project.id)).toEqual([groupA]);
    expect(JSON.stringify(studentGroups)).not.toContain(privateText);
    await expect(student.getByTestId(`aidt-course-project-${groupB}`)).toHaveCount(0);
    const cross = await aidtV2Api(student, `/projects/${groupB}/aidt/stages/1`);
    expect(cross.status).toBe(404); expect(JSON.stringify(cross.data)).not.toContain(privateText);
    await student.getByTestId(`aidt-course-project-${groupA}`).click();
    await student.waitForURL(url => url.pathname === `/aidt/${groupA}`);
    await openAidtV2Outcome(student, groupA, 1);
    await expect(student.getByLabel("初始问题", { exact: true })).toHaveValue(original);
    expect(await readAidtV2Stage(student, groupA, 1)).toEqual(saved);
    const fresh = await freshContext.newPage(); await login(fresh, "student");
    await home(fresh); await selectCourse(fresh, course.id);
    await fresh.getByTestId(`aidt-course-project-${groupA}`).click();
    await fresh.waitForURL(url => url.pathname === `/aidt/${groupA}`);
    await openAidtV2Outcome(fresh, groupA, 1);
    await expect(fresh.getByLabel("初始问题", { exact: true })).toHaveValue(original);
    expect(await readAidtV2Stage(fresh, groupA, 1)).toEqual(saved);
    expect(await readAidtV2Stage(admin, groupB, 1)).toEqual(savedB);
    expect([...modelRequests, ...otherRequests.flat()]).toEqual([]);
    await info.attach("course-real-membership-isolation", { contentType: "application/json", body: Buffer.from(JSON.stringify({ courseId: course.id, groupA, groupB, groupExtra, realGroupCursorNoOverlap: true, courseCreateReplay: true, studentRole: "consultant", managerRole: "admin", explicitSyntheticStudentMembership: true, courseLinkChangedMembers: false, sameGroupSecondCourse: conflict.status, studentCreate: deniedCreate.status, adminNonmemberLink: adminFallback.status, studentCrossGroupRead: cross.status, savedRevision: saved.revision, freshLoginRestoredRevision: saved.revision, modelRequests: 0 }, null, 2)) });
  } finally { await Promise.all([adminContext.close(), studentContext.close(), freshContext.close()]); }
});

test("FR01 lifecycle: archived existing course group remains readable; new binding is rejected without mutating native members", async ({ page, context }, info) => {
  const modelRequests = observeNoModel(context); await login(page, "owner");
  const linked = await createAidtV2Group(page, "archived-linked");
  await openAidtV2Outcome(page, linked, 1);
  const original = marker("归档保留原始输入"); await page.getByLabel("初始问题", { exact: true }).fill(original);
  const saved = await saveAidtV2Stage(page, linked, 1);
  const unbound = await createAidtV2Group(page, "archived-unbound");
  const course = await createCourseUi(page, marker("归档课程")); await linkUi(page, course, linked);
  const members = await roster(page, linked);
  expect((await aidtV2Api(page, `/projects/${linked}/archive`, "POST", { projectId: linked })).status).toBe(201);
  expect((await aidtV2Api(page, `/projects/${unbound}/archive`, "POST", { projectId: unbound })).status).toBe(201);
  const current = await listGroups(page, course.id);
  expect(current.items.find(item => item.project.id === linked)?.project).toMatchObject({ status: "archived", readOnlyReason: "archived" });
  const denied = await linkApi(page, course.id, unbound);
  expect(denied.status).toBe(403); expect(denied.data).toMatchObject({ reasonCode: "AIDT_COURSE_FORBIDDEN" });
  expect((await listGroups(page, course.id)).items.map(item => item.project.id)).toEqual([linked]);
  await home(page); await selectCourse(page, course.id);
  await expect(page.getByTestId(`aidt-course-project-${linked}`)).toContainText("只读");
  await page.getByTestId(`aidt-course-project-${linked}`).click();
  await page.waitForURL(url => url.pathname === `/aidt/${linked}`);
  await openAidtV2Outcome(page, linked, 1);
  await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue(original);
  await expect(page.getByLabel("初始问题", { exact: true })).toBeDisabled();
  expect(await readAidtV2Stage(page, linked, 1)).toEqual(saved);
  expect(await roster(page, linked)).toEqual(members); expect(modelRequests).toEqual([]);
  await info.attach("course-real-archive-boundary", { contentType: "application/json", body: Buffer.from(JSON.stringify({ courseId: course.id, linked, unbound, archivedReadOnly: true, rejectedNewLink: denied.status, preservedRevision: saved.revision, membersUnchanged: true, modelRequests: 0 }, null, 2)) });
});

test("FR01 pagination and failure: real PG cursors have no overlap; native UI distinguishes offline error and explicit retry", async ({ page, context }, info) => {
  test.setTimeout(240_000); const modelRequests = observeNoModel(context); await login(page, "owner");
  const courseIds: string[] = [];
  for (let n = 0; n < 21; n++) courseIds.push((await createCourseApi(page, marker(`分页${n + 1}`))).course.id);
  const first = await aidtV2Api(page, "/aidt/courses?limit=1"); expect(first.status).toBe(200);
  const firstPage = courses.list.out.parse(first.data); expect(firstPage.items).toHaveLength(1); expect(firstPage.nextCursor).toBeTruthy();
  const second = await aidtV2Api(page, `/aidt/courses?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`); expect(second.status).toBe(200);
  const secondPage = courses.list.out.parse(second.data); expect(secondPage.items).toHaveLength(1); expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  const invalid = await aidtV2Api(page, "/aidt/courses?limit=51"); expect(invalid.status).toBe(400);
  const initial = await home(page); expect(initial.items).toHaveLength(20); expect(initial.nextCursor).toBeTruthy();
  const more = page.getByRole("button", { name: "更多课程", exact: true }); await expect(more).toBeVisible();
  await context.setOffline(true);
  try {
    await more.click();
    await expect(page.getByTestId("aidt-courses-error")).toBeVisible();
    await expect(page.getByTestId("aidt-courses-empty")).toHaveCount(0);
  } finally { await context.setOffline(false); }
  const retry = page.waitForResponse(response => response.request().method() === "GET" && exactPath(response.url(), courses.list.path));
  await page.getByRole("button", { name: "重新加载课程", exact: true }).click(); expect((await retry).status()).toBe(200);
  await expect(page.getByTestId(`aidt-course-${initial.items[0]!.id}`)).toBeVisible();
  const next = page.waitForResponse(response => response.request().method() === "GET" && exactPath(response.url(), courses.list.path));
  await page.getByRole("button", { name: "更多课程", exact: true }).click(); const nextResponse = await next; expect(nextResponse.status()).toBe(200);
  const nextPage = courses.list.out.parse(await nextResponse.json()); expect(nextPage.items.length).toBeGreaterThan(0);
  expect(nextPage.items.every(item => !initial.items.some(previous => previous.id === item.id))).toBe(true);
  for (const item of nextPage.items) await expect(page.getByTestId(`aidt-course-${item.id}`)).toBeVisible();
  expect(modelRequests).toEqual([]);
  await info.attach("course-real-pagination-and-network-failure", { contentType: "application/json", body: Buffer.from(JSON.stringify({ syntheticCourseIds: courseIds, serverCursorPageSize: 1, uiFirstPageSize: initial.items.length, uiNextPageSize: nextPage.items.length, cursorOverlap: false, offlineWasRealBrowserNetworkFailure: true, requestInterceptionOrMock: false, explicitRetry: true, invalidLimit: invalid.status, modelRequests: 0 }, null, 2)) });
});
