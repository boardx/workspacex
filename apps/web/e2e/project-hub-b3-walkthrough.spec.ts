/**
 * #4582 —— 项目中枢第三批（#4505：#4495 证据归一化 / #4496 按 AI 权限入图 / #4497 跨来源推理 /
 * #4498 采纳为决策 / #4499 观察者脱敏）的**真栈走查**。
 *
 * 第三批合入时，浏览器 e2e 只覆盖既有主流程；这条 spec 把第三批用户能看到的那几块在真栈上走一遍，
 * 并留截图作为 CI 产物（`test.info().outputPath`）。
 *
 * ## 两条路径
 * 第一条用工作坊容器走证据 / 大脑 / AI 权限 / 观察者脱敏。第二条（#4591）走研究项目：
 * #4584（PR #4588）之前这类容器谁都打不开工作台；现在负责人 / 协作者能进，工作坊专属 tab 不出现，
 * 协作者面板在设置页可达，移出后即失去访问。
 *
 * ## 证据怎么来
 * 没有「新建证据」的接口：挂载资源（`POST /projects/:id/resources`）时 `linkProjectResource`
 * 同步跑采集器。最便宜的真实来源是一份已发布问卷的一份答卷——整条链全走公开 HTTP，不往库里塞行。
 * 答案选项故意写长：摘录是「题目：答案」，要超过 80 字，观察者视角的截断才看得出来。
 *
 * ## 项目大脑
 * 证据本身不产生结论（结论要经抽取 worker 或「记到项目大脑」），所以这里断言的是「零结论时
 * 大脑面板渲染空态、不报错」——这是新项目用户第一眼看到的真实状态。
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function api<T>(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ apiBase, path, method, body }) => {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${window.localStorage.getItem("wsx.sessionToken")}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, data: (text.length > 0 ? JSON.parse(text) : null) };
  }, { apiBase: API, path, method, body }) as Promise<{ status: number; data: T }>;
}

const QUESTION = "您向同事推荐我们服务的意愿如何？";
// 超过 80 字的选项：让「题目：答案」这条摘录在观察者视角下被截断。
const LONG_ANSWER =
  "愿意推荐，因为交付周期明显缩短、对接人响应及时、方案能落到我们现场的实际约束上，而且上线后的回访也很到位，整体体验比我们之前合作过的几家都要好很多";
const SHORT_ANSWER = "不愿意";

const draft = {
  title: "第三批走查问卷",
  questions: [{
    id: "q-recommend",
    title: QUESTION,
    type: "single",
    chapterId: "general",
    order: 1,
    required: true,
    options: [LONG_ANSWER, SHORT_ANSWER],
  }],
  template: {
    id: "report-template",
    title: "走查报告",
    sections: [{
      id: "section-main",
      title: "核心结论",
      blocks: [{
        id: "recommendation-distribution",
        title: "推荐意愿分布",
        type: "bar",
        questionIds: ["q-recommend"],
        statistic: "distribution",
        samplePolicy: "valid",
        minGroupSize: 5,
      }],
    }],
  },
};

test("第三批真栈走查：问卷答卷入证据 → 来源列表 / 大脑空态 / AI 权限关来源 / 观察者脱敏", async ({ page }) => {
  test.setTimeout(240_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name), fullPage: true });

  // ① org lead 建工作坊（创建即写入 facilitator + is_host，见 pg-project-repository.ts），再把 member 设为观察者。
  await loginAs(page, FULLSTACK_E2E.leadEmail, FULLSTACK_E2E.leadPassword);
  const project = await api<{ id: string }>(page, "/projects", "POST", {
    orgId: FULLSTACK_E2E.orgId,
    name: `第三批走查 ${Date.now()}`,
    kind: "workshop",
    blueprintVersionId: null,
  });
  expect(project.status, JSON.stringify(project.data)).toBe(201);
  const projectId = project.data.id;
  const observer = await api(page, `/projects/${projectId}/members`, "POST", {
    projectId, subject: { kind: "orgUser", ref: FULLSTACK_E2E.memberUserId }, projectRole: "observer", isHost: false,
  });
  expect(observer.status, JSON.stringify(observer.data)).toBeLessThan(300);

  // ② 空态：还没挂任何资源。
  await page.goto(`/projects/${projectId}?tab=research&sub=sources`);
  await expect(page.getByTestId("project-evidence-empty")).toBeVisible();
  await shot("01-sources-empty.png");

  // ③ lead 建问卷 → 发布 → 一份答卷 → 挂到项目（挂载时同步采集证据）。
  const survey = await api<{ id: string; version: number }>(page, "/surveys", "POST", { draft, anonymity: "anonymous" });
  expect(survey.status, JSON.stringify(survey.data)).toBe(201);
  const published = await api<{ publication: { token: string } }>(page, `/surveys/${survey.data.id}/publish`, "POST", {
    expectedVersion: survey.data.version,
  });
  expect(published.status, JSON.stringify(published.data)).toBe(201);
  const submitted = await api(page, `/public/surveys/${published.data.publication.token}/responses`, "POST", {
    submissionId: `b3-walkthrough-${Date.now()}`,
    answers: [{ questionId: "q-recommend", value: LONG_ANSWER }],
  });
  expect(submitted.status, JSON.stringify(submitted.data)).toBe(201);
  const linked = await api(page, `/projects/${projectId}/resources`, "POST", {
    projectId, kind: "survey", resourceId: survey.data.id,
  });
  expect(linked.status, JSON.stringify(linked.data)).toBeLessThan(300);

  // ④ 来源列表：一条问卷答卷证据，负责人看到完整摘录。
  const evidence = await api<{ items: Array<{ id: string; sourceKind: string; excerpt: string; speakerLabel: string | null }> }>(
    page, `/projects/${projectId}/evidence`,
  );
  expect(evidence.status, JSON.stringify(evidence.data)).toBe(200);
  expect(evidence.data.items).toHaveLength(1);
  const item = evidence.data.items[0]!;
  expect(item.sourceKind).toBe("survey_response");
  expect(item.excerpt).toContain(LONG_ANSWER);

  await page.reload();
  const row = page.getByTestId(`project-evidence-${item.id}`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-source-kind", "survey_response");
  await expect(row).toContainText("问卷答卷");
  await expect(page.getByTestId(`project-evidence-${item.id}-excerpt`)).toContainText(LONG_ANSWER);
  await expect(page.getByTestId(`project-evidence-${item.id}-off`)).toHaveCount(0);
  await shot("02-sources-one-survey-response.png");

  // ⑤ 项目大脑：证据不直接产生结论 ⇒ 零结论空态，不是错误态。
  await page.goto(`/projects/${projectId}?tab=research`);
  await expect(page.getByTestId("project-brain-empty")).toBeVisible();
  await expect(page.getByTestId("project-brain-error")).toHaveCount(0);
  await shot("03-brain-empty.png");

  // ⑥ 设置页 AI 权限：关掉「问卷」并保存；来源列表里这条证据标「已关闭」。
  await page.goto(`/projects/${projectId}?tab=settings`);
  const surveyToggle = page.getByTestId("project-ai-source-survey");
  await expect(surveyToggle).toHaveAttribute("aria-checked", "true");
  await surveyToggle.click();
  await expect(surveyToggle).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("project-ai-settings-save").click();
  await expect(page.getByTestId("project-ai-settings-saved")).toBeVisible();
  await shot("04-ai-settings-survey-off.png");
  const settings = await api<{ allowedSources: string[] }>(page, `/projects/${projectId}/ai-settings`);
  expect(settings.status).toBe(200);
  expect(settings.data.allowedSources).not.toContain("survey");

  await page.goto(`/projects/${projectId}?tab=research&sub=sources`);
  await expect(page.getByTestId(`project-evidence-${item.id}-off`)).toBeVisible();
  await expect(page.getByTestId("project-evidence-filter-survey_response")).toHaveAttribute("data-off", "true");
  await shot("05-sources-survey-marked-off.png");

  // ⑦ 观察者：同一条证据，摘录被截到 80 字加「…」。
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await loginAs(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
  const observerView = await api<{ items: Array<{ id: string; excerpt: string; speakerLabel: string | null }> }>(
    page, `/projects/${projectId}/evidence`,
  );
  expect(observerView.status, JSON.stringify(observerView.data)).toBe(200);
  const redacted = observerView.data.items.find((x) => x.id === item.id)!;
  expect(redacted.speakerLabel).toBeNull();
  expect(Array.from(redacted.excerpt)).toHaveLength(81);
  expect(redacted.excerpt.endsWith("…")).toBe(true);
  expect(redacted.excerpt).not.toContain(LONG_ANSWER);

  await page.goto(`/projects/${projectId}?tab=research&sub=sources`);
  await expect(page.getByTestId(`project-evidence-${item.id}-excerpt`)).toHaveText(redacted.excerpt);
  await shot("06-sources-observer-redacted.png");
});

test("通用项目：负责人加协作者 → 协作者打开工作台（无工作坊专属 tab）→ 负责人移出后协作者被拒", async ({ page }) => {
  test.setTimeout(180_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name), fullPage: true });

  // ① org lead 建通用项目：创建即把创建者写成负责人（pg-project-repository.ts），再经 T5 接口加 member 为协作者。
  await loginAs(page, FULLSTACK_E2E.leadEmail, FULLSTACK_E2E.leadPassword);
  const project = await api<{ id: string; kind: string }>(page, "/projects", "POST", {
    orgId: FULLSTACK_E2E.orgId,
    name: `研究项目走查 ${Date.now()}`,
    kind: "general",
    blueprintVersionId: null,
  });
  expect(project.status, JSON.stringify(project.data)).toBe(201);
  const projectId = project.data.id;
  const roster = await api<{ members: Array<{ userId: string; role: string }> }>(page, `/projects/${projectId}/collaborators`);
  expect(roster.status, JSON.stringify(roster.data)).toBe(200);
  expect(roster.data.members).toContainEqual(expect.objectContaining({ userId: FULLSTACK_E2E.leadUserId, role: "owner" }));
  const added = await api(page, `/projects/${projectId}/collaborators`, "POST", {
    projectId, userId: FULLSTACK_E2E.memberUserId, role: "collaborator",
  });
  expect(added.status, JSON.stringify(added.data)).toBeLessThan(300);

  // #4615：负责人建一块白板并挂到项目——项目成员即白板成员（与白板自身成员表取并集）。
  const board = await api<{ id: string }>(page, "/whiteboards", "POST", { requestId: randomUUID(), name: `项目白板 ${Date.now()}` });
  expect(board.status, JSON.stringify(board.data)).toBeLessThan(300);
  const boardLinked = await api(page, `/projects/${projectId}/resources`, "POST", { projectId, kind: "whiteboard", resourceId: board.data.id });
  expect(boardLinked.status, JSON.stringify(boardLinked.data)).toBeLessThan(300);

  // ② 协作者登录：工作台打得开，工作坊专属 tab（准备 / 现场 / 待办）不出现。
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await loginAs(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByTestId("project-access-denied")).toHaveCount(0);
  await expect(page.getByTestId("project-tab-overview")).toBeVisible();
  await expect(page.getByTestId("project-tab-content")).toBeVisible();
  await expect(page.getByTestId("project-tab-brain")).toBeVisible();
  for (const tab of ["research", "prep", "live", "todo"]) await expect(page.getByTestId(`project-tab-${tab}`)).toHaveCount(0);
  await shot("11-research-project-collaborator-overview.png");

  // 研究 → 来源：证据区真实渲染（还没挂资源 ⇒ 空态，不是拒绝 / 错误）。
  await page.goto(`/projects/${projectId}?tab=research&sub=sources`);
  await expect(page.getByTestId("project-evidence-empty")).toBeVisible();
  await expect(page.getByTestId("project-evidence-error")).toHaveCount(0);
  await shot("12-research-project-collaborator-sources.png");

  // 内容：白板出现在项目内容里；协作者不在白板自身成员表上，但凭项目成员身份能打开它。
  await page.goto(`/projects/${projectId}?tab=content`);
  await expect(page.getByTestId(`project-content-item-whiteboard-${board.data.id}`)).toBeVisible();
  const boardAsCollaborator = await api(page, `/whiteboards/${board.data.id}`);
  expect(boardAsCollaborator.status, JSON.stringify(boardAsCollaborator.data)).toBe(200);
  await shot("12b-general-project-content-whiteboard.png");

  // 设置：协作者面板可见、两人都在；协作者不是负责人 ⇒ 没有指派表单与移出按钮。
  await page.goto(`/projects/${projectId}?tab=settings`);
  await expect(page.getByTestId(`project-collaborator-${FULLSTACK_E2E.leadUserId}`)).toBeVisible();
  await expect(page.getByTestId(`project-collaborator-${FULLSTACK_E2E.memberUserId}`)).toBeVisible();
  await expect(page.getByTestId("project-collaborators-add")).toHaveCount(0);
  await expect(page.getByTestId(`project-collaborator-remove-${FULLSTACK_E2E.leadUserId}`)).toHaveCount(0);
  await shot("13-research-project-collaborator-settings.png");

  // ③ 负责人在设置页把协作者移出。
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await loginAs(page, FULLSTACK_E2E.leadEmail, FULLSTACK_E2E.leadPassword);
  await page.goto(`/projects/${projectId}?tab=settings`);
  await expect(page.getByTestId("project-collaborators-add")).toBeVisible();
  await page.getByTestId(`project-collaborator-remove-${FULLSTACK_E2E.memberUserId}`).click();
  await expect(page.getByTestId(`project-collaborator-${FULLSTACK_E2E.memberUserId}`)).toHaveCount(0);
  await expect(page.getByTestId(`project-collaborator-${FULLSTACK_E2E.leadUserId}`)).toBeVisible();
  await shot("14-research-project-owner-removed-collaborator.png");

  // ④ 被移出的人再打开 ⇒ 拒绝页（NO_PROJECT_ROLE）。
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await loginAs(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByTestId("project-access-denied")).toHaveAttribute("data-reason", "NO_PROJECT_ROLE");
  // 被移出项目 ⇒ 项目这条白板访问来源随之撤销。
  const boardAfterRemoval = await api(page, `/whiteboards/${board.data.id}`);
  expect(boardAfterRemoval.status).toBeGreaterThanOrEqual(400);
  await shot("15-research-project-removed-collaborator-denied.png");
});
