/**
 * F961 —— 观察/访谈对象表的**真实浏览器**门控。
 *
 * F960 给 `getInterviewSubjects`/`updateInterviewSubjects` 建了表、写了仓储、挂了路由，
 * 并用真实 Postgres 测过；但那些断言全都在**服务端**跑。到 F961 之前，
 * 「浏览器能不能真的走到这两条端点」从来没有人证过——`apps/web` 零调用方，
 * Next 的 `/projects/:path*` 代理规则对这条新路径是否真的生效，也只是「看起来应该行」。
 * 这正是本仓反复栽的那个跟头：**契约签了、后端绿了、界面接不上，而所有测试依旧全绿。**
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS `blueprint.controller.ts`
 * → application `updateInterviewSubjects`/`getInterviewSubjects` → pg 仓储 → PostgreSQL。
 *
 * ## 这里证明的三件事，组件测试证不了
 *
 * ① **浏览器真能打到这两条端点**——组件测试里 `fetch` 是 mock 的，代理规则错了它也全绿。
 * ② **真的落库，不是本地乐观拼接**——保存成功后重新打一次真实 GET，摘要行的内容
 *    来自那次响应体。
 * ③ **刷新后仍在**——唯一能区分「写进了 PostgreSQL」与「写进了 React state」的断言
 *    （同 `agenda-segment-create-smoke.spec.ts` / `project-create-smoke.spec.ts` 的纪律）。
 *
 * ⚠ 种子里这个工作坊**没有分组**（`seed-fullstack-smoke.ts` 不建 `groups` 行），
 *   而访谈对象表嵌在组卡内——所以本用例第一步先用界面真实建一个组
 *   （走 `updateGrouping`，F950 的路径），再往这个组里填对象。这不是绕路：
 *   「组不存在时对象表根本无处可挂」本身就是这条链路的真实前提。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按出现次数钉死（#387 的反空转手段），
 *   往里加登录会让那些计数失效——同 `agenda-segment-create-smoke.spec.ts` 的既有理由。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("facilitator fills a group's interview-subject table in the browser; PostgreSQL keeps it across a reload", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
      failures.push(`console error: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  const subjectName = `采购总监 W${test.info().workerIndex}`;

  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=prep`);
  await expect(page.getByTestId("project-prep")).toBeVisible();

  // ── 前提：先真实建一个组（种子没有分组，见文件头注）────────────────────────
  const groups = page.getByTestId("project-prep-groups");
  await expect(groups).toBeVisible();

  if ((await groups.locator("[data-testid^='project-prep-group-']").count()) === 0) {
    await page.getByTestId("project-prep-groups-edit").click();
    await page.getByTestId("project-prep-groups-add").click();
    // 每组必须有组长（后端 `GROUP_LEADER_REQUIRED`），选第一个可选成员。
    const leaderSelect = groups.locator("select[data-testid$='-leader']").first();
    await leaderSelect.selectOption({ index: 1 });
    await page.getByTestId("project-prep-groups-save").click();
    await expect(page.getByTestId("project-prep-groups-edit")).toBeVisible();
  }

  const groupCard = groups.locator("[data-testid^='project-prep-group-']").first();
  const groupTestId = await groupCard.getAttribute("data-testid");
  const groupId = groupTestId!.replace("project-prep-group-", "");

  // ── 反空转前提：这一组现在还没有访谈对象 ─────────────────────────────────
  const summary = page.getByTestId(`project-prep-subjects-${groupId}-summary`);
  // 摘要行必须先离开「读取中…」——它显示「未填」就证明 GET 真的回来了（且不是 503）。
  await expect(summary).toHaveText("未填");

  // ── 填一个对象并保存 ────────────────────────────────────────────────────
  await page.getByTestId(`project-prep-subjects-${groupId}-toggle`).click();
  await page.getByTestId(`project-prep-subjects-${groupId}-edit`).click();
  await page.getByTestId(`project-prep-subjects-${groupId}-add`).click();

  const panel = page.getByTestId(`project-prep-subjects-${groupId}-panel`);
  await panel.getByLabel("对象").last().fill(subjectName);
  await panel.getByLabel("方式").last().fill("远程视频");
  await panel.getByLabel("状态").last().fill("待预约");
  await page.getByTestId(`project-prep-subjects-${groupId}-save`).click();

  // 保存后摘要行的内容来自重新打的那次真实 GET（不是本地 append）。
  await expect(summary).toHaveText(subjectName);

  // ── 刷新后仍在 = 真的写进了 PostgreSQL ──────────────────────────────────
  await page.reload();
  await expect(page.getByTestId("project-prep")).toBeVisible();
  await expect(page.getByTestId(`project-prep-subjects-${groupId}-summary`)).toHaveText(subjectName);

  // 展开后六列里刚填的值也都在（证明写的是整行六列，不是只有名字那一格）。
  await page.getByTestId(`project-prep-subjects-${groupId}-toggle`).click();
  const reloaded = page.getByTestId(`project-prep-subjects-${groupId}-panel`);
  await expect(reloaded).toContainText("远程视频");
  await expect(reloaded).toContainText("待预约");

  expect(failures, `浏览器控制台不该有错误：\n${failures.join("\n")}`).toEqual([]);
});

/**
 * F961 顺带修的 F950 回归门：**定题保存**在真实浏览器里同样是 400。
 *
 * F950 的 `saveProjectTopic` 把路径参数 `projectId` 也塞进了 PUT body，而 controller 的
 * body schema 是 `saveAndSyncTopic.in.omit({projectId:true})`、契约那个 object 是
 * `.strict()`——多一个未知字段就整条请求 400。它从 F950 起一直「全绿」，因为组件测试
 * 里的 `fetch` 是 mock 的：它只记录 body，不会像真的 zod 那样拒绝，而 F950 的断言
 * 甚至**明确要求** body 里有 `projectId`，把 bug 钉成了期望行为。
 *
 * 单独一条用例而不是并进上面那条：两者是不同的端点、不同的 feature（F950 vs F961），
 * 混在一条里，将来任何一条红了都得先分辨是谁的问题。
 */
test("F950 regression: facilitator saves the project topic in the browser (path param must not be in the PUT body)", async ({ page }) => {
  const topic = `真栈定题 ${test.info().workerIndex}`;

  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=prep`);
  await expect(page.getByTestId("project-prep")).toBeVisible();

  await page.getByTestId("project-prep-topic-edit").click();
  await page.getByTestId("project-prep-topic-title-input").fill(topic);
  await page.getByTestId("project-prep-topic-save").click();

  // 400 的话这里会停在编辑态并显示错误；成功才会回到只读态并显示新标题。
  await expect(page.getByTestId("project-prep-topic-title")).toHaveText(topic);

  await page.reload();
  await expect(page.getByTestId("project-prep-topic-title")).toHaveText(topic);
});
