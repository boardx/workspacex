import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { project as C, chat as Chat, whiteboard as W } from "@repo/contracts";
import { knowledgeGraph as KG } from "@repo/contracts/chat-knowledge-graph";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
import { boardApi, boardLogin } from "./board-acceptance-support";
import { captureBoardLogin } from "./support/board-login-capture.mjs";
import { parseCreatedProject } from "./project-create-contract";

const pathOf = (url: string | URL) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
const overviewHref = (id: string) => `/projects/${encodeURIComponent(id)}?org=${encodeURIComponent(F.orgId)}&tab=overview`;
async function login(page: Page, member = false) {
  const result = await captureBoardLogin(page, () => boardLogin(page, member ? F.memberEmail : F.leadEmail, member ? F.memberPassword : F.leadPassword));
  expect(result.posts).toBe(1); expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ userId: member ? F.memberUserId : F.leadUserId });
  await page.getByTestId("language-switcher").selectOption("en");
  if (typeof result.token !== "string" || result.token.length === 0) throw new Error("Real seeded login must return its session token");
  return result.token;
}
async function create(page: Page, label: string) {
  const token = await login(page);
  const name = `原始概览 ${label} ${randomUUID()}`;
  const response = await boardApi(page.request, token, "POST", "/projects", C.operations.createProject.in.parse({ orgId: F.orgId, name, kind: "general", blueprintVersionId: null }));
  expect(response.status()).toBe(201);
  const created = parseCreatedProject(await response.json());
  expect(created.kind).toBe("general");
  return { id: created.id, name, token };
}
function paths(id: string) {
  return [`/projects/${id}/overview`, `/projects/${id}/collaborators`, `/projects/${id}/resources`, `/chat/projects/${id}/threads`, `/knowledge-graph/projects/${id}`, `/knowledge-graph/projects/${id}/reasoning`];
}
async function readRealOverview(page: Page, id: string, navigate: () => Promise<unknown> = () => page.goto(overviewHref(id))) {
  const waits = paths(id).map(path => page.waitForResponse(r => pathOf(r.url()) === path && r.request().method() === "GET"));
  await navigate(); const responses = await Promise.all(waits);
  responses.forEach(response => expect(response.status()).toBe(200));
  expect(C.operations.getProjectOverview.out.parse(await responses[0]!.json())).toMatchObject({ projectId: id, kind: "general" });
  C.operations.listNonWorkshopMembers.out.parse(await responses[1]!.json());
  const resources = C.operations.listProjectResources.out.parse(await responses[2]!.json());
  Chat.operations.listThreads.out.parse(await responses[3]!.json());
  KG.getProjectKnowledge.out.parse(await responses[4]!.json()); KG.getProjectReasoning.out.parse(await responses[5]!.json());
  return resources;
}
function monitor(page: Page, id: string) {
  const endpoint = new Set(paths(id)); const calls: string[] = [];
  const listener = (request: import("@playwright/test").Request) => { if (endpoint.has(pathOf(request.url()))) calls.push(`${request.method()} ${pathOf(request.url())}`); };
  page.on("request", listener);
  return { calls, stop: () => page.off("request", listener) };
}
async function locale(page: Page, value: "en" | "zh-CN") {
  await page.getByTestId("language-switcher").selectOption(value);
  await expect(page.getByTestId("project-general-overview-head")).toContainText(value === "en" ? "Project members" : "项目成员");
}
async function pictures(page: Page, name: string) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ["zh-CN", "en"] as const) {
      await locale(page, language);
      const guide = page.getByTestId("project-general-overview-start");
      await (await guide.count() ? guide : page.getByTestId("project-general-overview-head")).scrollIntoViewIfNeeded();
      const box = await page.getByTestId("project-general-overview").boundingBox(); expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: test.info().outputPath(`overview-${name}-${width}-${language}-top.png`), fullPage: true });
      await page.getByTestId("project-general-overview-workflow-runs").scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`overview-${name}-${width}-${language}-bottom.png`), fullPage: true });
    }
  }
}

test("project overview empty real owner page preserves raw name, links and reads through locale and reload", async ({ page }) => {
  const project = await create(page, "empty"); const resources = await readRealOverview(page, project.id);
  expect(resources.items).toHaveLength(0);
  await expect(page.getByTestId("project-title")).toHaveText(project.name);
  await expect(page.getByTestId("project-general-overview-start")).toContainText("Get started with this project");
  const link = page.getByTestId("project-general-overview-start-content"); const href = await link.getAttribute("href"); const node = await link.elementHandle();
  const observed = monitor(page, project.id);
  await pictures(page, "empty"); expect(observed.calls).toEqual([]);
  expect(await link.evaluate((current, previous) => current === previous, node)).toBe(true);
  await expect(link).toHaveAttribute("href", href!); await expect(page.getByTestId("project-title")).toHaveText(project.name);
  observed.stop(); await readRealOverview(page, project.id, () => page.reload());
  await expect(page.getByTestId("project-general-overview-head")).toContainText("Project members");
  await expect(page.getByTestId("project-general-overview-start")).toBeVisible();
});

test("project overview real linked whiteboard keeps canonical counts, raw title and href while projecting categories and date", async ({ page }) => {
  const project = await create(page, "populated"); const rawTitle = `白板原文 {raw} ${project.id}`;
  const boardResponse = await boardApi(page.request, project.token, "POST", W.operations.createBoard.path, W.CreateBoard.parse({ requestId: randomUUID(), name: rawTitle }));
  expect(boardResponse.status()).toBe(201); const board = W.Board.parse(await boardResponse.json());
  const input = C.operations.linkProjectResource.in.parse({ projectId: project.id, kind: "whiteboard", resourceId: board.id });
  const linked = await boardApi(page.request, project.token, "POST", C.operations.linkProjectResource.path.replace(":projectId", project.id), input);
  C.operations.linkProjectResource.out.parse(await linked.json());
  const resources = await readRealOverview(page, project.id); expect(resources.items).toHaveLength(1); expect(resources.items[0]).toMatchObject({ id: board.id, title: rawTitle, kind: "whiteboard" });
  const recent = page.getByTestId(`project-general-overview-recent-whiteboard-${board.id}`);
  await expect(recent).toHaveText(new RegExp("Whiteboard")); await expect(recent).toContainText(rawTitle);
  await expect(page.getByTestId("project-general-overview-count-whiteboard")).toContainText("1");
  const date = await page.evaluate(iso => new Date(iso).toLocaleDateString("en"), resources.items[0]!.updatedAt); await expect(recent).toContainText(date);
  const href = await recent.getAttribute("href"); const node = await recent.elementHandle(); const observed = monitor(page, project.id);
  await pictures(page, "populated"); expect(observed.calls).toEqual([]); observed.stop();
  expect(await recent.evaluate((current, previous) => current === previous, node)).toBe(true); await expect(recent).toHaveAttribute("href", href!); await expect(recent).toContainText(rawTitle);
  await readRealOverview(page, project.id, () => page.reload()); await expect(recent).toContainText(rawTitle); await expect(page.getByTestId("project-general-overview-head")).toContainText("Project members");
});

test("project overview independent real nonmember receives the existing access denial instead of body data", async ({ page, browser }) => {
  const project = await create(page, "private"); const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Canonical seeded baseURL is required");
  const outsider = await browser.newContext({ baseURL });
  try {
    const deniedPage = await outsider.newPage(); await login(deniedPage, true);
    const response = deniedPage.waitForResponse(r => pathOf(r.url()) === `/projects/${project.id}/overview` && r.request().method() === "GET");
    await deniedPage.goto(overviewHref(project.id)); const denied = await response; expect(denied.status()).toBe(403); expect(await denied.json()).toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    const observed = monitor(deniedPage, project.id); await deniedPage.setViewportSize({ width: 375, height: 900 });
    for (const language of ["zh-CN", "en"] as const) {
      await deniedPage.getByTestId("language-switcher").selectOption(language);
      await expect(deniedPage.getByTestId("project-access-denied")).toContainText(language === "en" ? "You are not in this project yet" : "你还不在这个项目里");
      await expect(deniedPage.getByTestId("project-general-overview")).toHaveCount(0); await expect(deniedPage.getByTestId("project-title")).not.toHaveText(project.name);
      await deniedPage.screenshot({ path: test.info().outputPath(`overview-real-denied-375-${language}.png`), fullPage: true });
    }
    expect(observed.calls).toEqual([]); observed.stop();
  } finally { await outsider.close(); }
});

test("project overview explicitly injected read failures project owned fallbacks in place without retrying on locale", async ({ page }) => {
  test.info().annotations.push({ type: "controlled-network-fault", description: "UI-only GET aborts after real owner/project creation; not a server denial, model or database failure verdict." });
  const project = await create(page, "read-failure");
  const failed = new Set([`/projects/${project.id}/collaborators`, `/knowledge-graph/projects/${project.id}`, `/knowledge-graph/projects/${project.id}/reasoning`]);
  const match = (url: URL) => failed.has(pathOf(url));
  await page.route(match, route => route.request().method() === "GET" ? route.abort("failed") : route.continue());
  try {
    const overview = page.waitForResponse(r => pathOf(r.url()) === `/projects/${project.id}/overview`);
    await page.goto(overviewHref(project.id)); expect((await overview).status()).toBe(200);
    const member = page.getByTestId("project-general-overview-members-error"); const brain = page.getByTestId("project-general-overview-brain-error");
    await expect(member).toContainText("Members are temporarily unavailable."); await expect(brain).toContainText("The project brain is temporarily unavailable.");
    const node = await member.elementHandle(); const observed = monitor(page, project.id); await page.setViewportSize({ width: 375, height: 900 });
    for (const language of ["zh-CN", "en"] as const) {
      await locale(page, language); await expect(member).toContainText(language === "en" ? "Members are temporarily unavailable." : "成员暂时读不到。");
      await expect(brain).toContainText(language === "en" ? "The project brain is temporarily unavailable." : "项目大脑暂时读不到。");
      await brain.scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath(`overview-controlled-read-failure-375-${language}.png`), fullPage: true });
    }
    expect(observed.calls).toEqual([]); expect(await member.evaluate((current, previous) => current === previous, node)).toBe(true); observed.stop();
  } finally { await page.unroute(match); }
});
